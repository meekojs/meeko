-- The administrator login of the dashboard (F5): its sessions, the counters of its rate limits and who
-- reviewed each comment. Additive: two new tables and a nullable column.

-- Sessions of the dashboard, for SqlSessionStore of @meekojs/meeko/server: the columns of its
-- documented schema, plus last_seen_at for the inactivity limit that the dashboard's driver applies.
-- Times are milliseconds since the epoch, as Meeko writes them.
CREATE TABLE IF NOT EXISTS dashboard_sessions (
    id text PRIMARY KEY,
    -- One active ID per family: rotating keeps the family, logging out deletes it.
    family_id text NOT NULL UNIQUE,
    csrf_token text NOT NULL,
    data_json text NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    last_seen_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS dashboard_sessions_expires_at ON dashboard_sessions (expires_at);

-- Fixed windows of rateLimit (Meeko's SqlSessionDriver.rateLimit): the key is the SHA-256 of the
-- route and the subject, never an address or a user name in clear. UNLOGGED: after a crash of the
-- server the counters start again, which is acceptable for a limit.
CREATE UNLOGGED TABLE IF NOT EXISTS dashboard_rate_limits (
    key bytea PRIMARY KEY CHECK (length(key) = 32),
    window_ends_at bigint NOT NULL,
    count integer NOT NULL CHECK (count > 0)
);

CREATE INDEX IF NOT EXISTS dashboard_rate_limits_window_ends_at ON dashboard_rate_limits (window_ends_at);

-- The administrator who marked a comment as reviewed; NULL while it waits, and for the comments
-- reviewed before this migration.
ALTER TABLE docs_feedback ADD COLUMN IF NOT EXISTS reviewed_by text CHECK (reviewed_by IS NULL OR (btrim(reviewed_by) <> '' AND length(reviewed_by) <= 200));
