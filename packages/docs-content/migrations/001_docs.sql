-- Apply to the dedicated site database before using server/content/db.ts.
CREATE TABLE IF NOT EXISTS docs_snapshots (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    published_at timestamptz NOT NULL DEFAULT now(),
    active boolean NOT NULL DEFAULT false
);

-- At most one complete version is visible to readers.
CREATE UNIQUE INDEX IF NOT EXISTS docs_snapshots_one_active ON docs_snapshots (active) WHERE active;

CREATE TABLE IF NOT EXISTS docs_pages (
    snapshot_id bigint NOT NULL REFERENCES docs_snapshots (id) ON DELETE CASCADE,
    path text NOT NULL,
    payload jsonb NOT NULL,
    searchable_text text NOT NULL,
    PRIMARY KEY (snapshot_id, path),
    CONSTRAINT docs_pages_path CHECK (
        path IN ('/', '/docs', '/llms.txt', '/llms-full.txt')
        OR (
            path ~ '^/docs/[^/?#[:space:]]+(/[^/?#[:space:]]+)*$'
            AND path !~ '(^|/)\.\.?(/|$)'
        )
    )
);

CREATE INDEX IF NOT EXISTS docs_pages_search ON docs_pages USING gin (to_tsvector('simple', searchable_text));
