-- Sources, revisions, moderation and metrics of the documentation dashboard. Additive: it creates
-- tables and adds nullable columns, and changes no existing row.

-- Who or why each snapshot was published (docs:sync, the dashboard, a rollback note).
ALTER TABLE docs_snapshots
    ADD COLUMN IF NOT EXISTS published_by text,
    ADD COLUMN IF NOT EXISTS note text;

-- One row per public page of the three sites, keyed by its URL path. Guides and reference pages of
-- `site` keep the Markdown of Git they were imported from; `.meeko` pages of `ui` and `i18n` have
-- none and are only supervised, moderated and measured.
CREATE TABLE docs_sources (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site text NOT NULL CHECK (site IN ('site', 'ui', 'i18n')),
    path text NOT NULL CHECK (path ~ '^/[^?#[:space:]]*$' AND length(path) <= 512),
    kind text NOT NULL CHECK (kind IN ('guide', 'reference', 'page')),
    title text NOT NULL CHECK (btrim(title) <> ''),
    -- File of the Markdown in the repository, from its root: docs/api.md, packages/meeko/README.md.
    source_file text CHECK (source_file ~ '^[^/\\][^\\]*\.md$' AND source_file !~ '(^|/)\.\.?(/|$)'),
    base_markdown text,
    -- SHA-256 (hex) of base_markdown with \n line endings.
    base_hash text CHECK (base_hash ~ '^[0-9a-f]{64}$'),
    -- When base_markdown or the title last changed in an import.
    imported_at timestamptz NOT NULL DEFAULT now(),
    -- Set when the last import of its site no longer found it; revisions are kept.
    removed_at timestamptz,
    CONSTRAINT docs_sources_site_path UNIQUE (site, path),
    -- Markdown, its file and its hash go together, only for guides and reference pages of `site`.
    CONSTRAINT docs_sources_markdown CHECK (
        (kind = 'page' AND source_file IS NULL AND base_markdown IS NULL AND base_hash IS NULL)
        OR (kind <> 'page' AND site = 'site' AND source_file IS NOT NULL AND base_markdown IS NOT NULL AND base_hash IS NOT NULL)
    )
);

-- A Markdown file backs one current page; a removed one keeps its file for its history.
CREATE UNIQUE INDEX docs_sources_file ON docs_sources (source_file) WHERE source_file IS NOT NULL AND removed_at IS NULL;

-- Edited Markdown over a source. The published one replaces the file of Git when a snapshot is
-- rendered; archived ones stay as history.
CREATE TABLE docs_revisions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id bigint NOT NULL REFERENCES docs_sources (id) ON DELETE RESTRICT,
    markdown text NOT NULL,
    author text NOT NULL CHECK (btrim(author) <> '' AND length(author) <= 200),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    note text CHECK (note IS NULL OR length(note) <= 2000),
    -- base_hash of the source when the revision was written, to tell later changes of Git apart.
    base_hash text CHECK (base_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    CONSTRAINT docs_revisions_published_at CHECK (
        (status = 'draft' AND published_at IS NULL)
        OR (status = 'published' AND published_at IS NOT NULL)
        OR status = 'archived'
    )
);

-- At most one published revision per source.
CREATE UNIQUE INDEX docs_revisions_one_published ON docs_revisions (source_id) WHERE status = 'published';
CREATE INDEX docs_revisions_source ON docs_revisions (source_id, created_at DESC);

-- One rule per page: hide it from the site or feature it.
CREATE TABLE docs_moderation (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site text NOT NULL CHECK (site IN ('site', 'ui', 'i18n')),
    path text NOT NULL CHECK (path ~ '^/[^?#[:space:]]*$' AND length(path) <= 512),
    action text NOT NULL CHECK (action IN ('hide', 'feature')),
    reason text CHECK (reason IS NULL OR length(reason) <= 2000),
    author text NOT NULL CHECK (btrim(author) <> '' AND length(author) <= 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT docs_moderation_site_path UNIQUE (site, path)
);

-- Notices shown on a site while active and within their dates.
CREATE TABLE docs_announcements (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site text NOT NULL CHECK (site IN ('site', 'ui', 'i18n')),
    message text NOT NULL CHECK (btrim(message) <> '' AND length(message) <= 500),
    tone text NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'success', 'warning', 'danger')),
    starts_at timestamptz,
    ends_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    author text NOT NULL CHECK (btrim(author) <> '' AND length(author) <= 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT docs_announcements_window CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX docs_announcements_active ON docs_announcements (site, starts_at, ends_at) WHERE active;

-- "¿Te sirvió?" answers of readers.
CREATE TABLE docs_feedback (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site text NOT NULL CHECK (site IN ('site', 'ui', 'i18n')),
    path text NOT NULL CHECK (path ~ '^/[^?#[:space:]]*$' AND length(path) <= 512),
    helpful boolean NOT NULL,
    comment text CHECK (comment IS NULL OR (btrim(comment) <> '' AND length(comment) <= 2000)),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX docs_feedback_page ON docs_feedback (site, path, created_at DESC);
CREATE INDEX docs_feedback_created ON docs_feedback (created_at);

-- Page views counted per day; no visitor data.
CREATE TABLE docs_page_views (
    site text NOT NULL CHECK (site IN ('site', 'ui', 'i18n')),
    path text NOT NULL CHECK (path ~ '^/[^?#[:space:]]*$' AND length(path) <= 512),
    day date NOT NULL,
    views bigint NOT NULL DEFAULT 0 CHECK (views >= 0),
    PRIMARY KEY (site, path, day)
);

CREATE INDEX docs_page_views_day ON docs_page_views (day, site);

-- Queries of the site search and how many results they had; no visitor data.
CREATE TABLE docs_searches (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site text NOT NULL CHECK (site IN ('site', 'ui', 'i18n')),
    query text NOT NULL CHECK (btrim(query) <> '' AND length(query) <= 200),
    results integer NOT NULL CHECK (results >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX docs_searches_created ON docs_searches (site, created_at DESC);
CREATE INDEX docs_searches_empty ON docs_searches (site, created_at DESC) WHERE results = 0;
