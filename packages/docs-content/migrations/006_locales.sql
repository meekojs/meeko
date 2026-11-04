-- The languages of the documentation: Spanish (`es`, the original and the default, URLs without
-- prefix) and English (`en`, translated in docs/en/**, URLs under /en/). Additive for the data: every
-- existing row becomes `es` through the default of its new column, and nothing is deleted. The keys
-- that named a page by `(site, path)` gain the language; the paths stay without the /en prefix.

-- Sources: one per language and page. A translation keeps the hash of the Spanish original it was
-- made from (the `source-hash` of its frontmatter), so the dashboard tells `translated` from
-- `outdated`. Only the guides and reference pages of `site` are translated in the repository.
ALTER TABLE docs_sources ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en'));
ALTER TABLE docs_sources ADD COLUMN IF NOT EXISTS source_hash text CHECK (source_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE docs_sources ADD CONSTRAINT docs_sources_translation CHECK (locale = 'es' OR (kind <> 'page' AND site = 'site'));
ALTER TABLE docs_sources ADD CONSTRAINT docs_sources_source_hash CHECK (source_hash IS NULL OR locale <> 'es');
ALTER TABLE docs_sources DROP CONSTRAINT docs_sources_site_path;
ALTER TABLE docs_sources ADD CONSTRAINT docs_sources_site_locale_path UNIQUE (site, locale, path);

-- Revisions belong to a source, so they have its language; nothing changes in docs_revisions.

-- Pages of a snapshot: one snapshot holds every language, so publishing and rolling back switch
-- both at once. `translation` is the status of a translated page, NULL for Spanish and for the pages
-- with nothing to translate; `missing` is the Spanish content published in its place.
ALTER TABLE docs_pages ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en'));
ALTER TABLE docs_pages ADD COLUMN IF NOT EXISTS translation text CHECK (translation IN ('translated', 'outdated', 'missing'));
ALTER TABLE docs_pages ADD CONSTRAINT docs_pages_translation CHECK (translation IS NULL OR locale <> 'es');
ALTER TABLE docs_pages DROP CONSTRAINT docs_pages_pkey;
ALTER TABLE docs_pages ADD CONSTRAINT docs_pages_pkey PRIMARY KEY (snapshot_id, locale, path);

-- Full-text search in the configuration of each language; `simple` (001) stays for exact words.
CREATE INDEX IF NOT EXISTS docs_pages_search_es ON docs_pages USING gin (to_tsvector('spanish', searchable_text)) WHERE locale = 'es';
CREATE INDEX IF NOT EXISTS docs_pages_search_en ON docs_pages USING gin (to_tsvector('english', searchable_text)) WHERE locale = 'en';

-- Moderation rules and announcements of one language, or of every language when `locale` is NULL.
-- The default keeps `es` for the rows that exist and for a writer that does not name the language.
ALTER TABLE docs_moderation ADD COLUMN IF NOT EXISTS locale text DEFAULT 'es' CHECK (locale IN ('es', 'en'));
ALTER TABLE docs_moderation DROP CONSTRAINT docs_moderation_site_path;
ALTER TABLE docs_moderation ADD CONSTRAINT docs_moderation_site_locale_path UNIQUE NULLS NOT DISTINCT (site, locale, path);

ALTER TABLE docs_announcements ADD COLUMN IF NOT EXISTS locale text DEFAULT 'es' CHECK (locale IN ('es', 'en'));
CREATE INDEX IF NOT EXISTS docs_announcements_locale ON docs_announcements (site, locale) WHERE active;

-- Metrics: the language of the page or the search, its path without the /en prefix.
ALTER TABLE docs_feedback ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en'));

ALTER TABLE docs_page_views ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en'));
ALTER TABLE docs_page_views DROP CONSTRAINT docs_page_views_pkey;
ALTER TABLE docs_page_views ADD CONSTRAINT docs_page_views_pkey PRIMARY KEY (site, locale, path, day);

ALTER TABLE docs_searches ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en'));
