-- A version per moderation rule and per announcement, so the dashboard writes them only from the
-- state it read: a change from an old tab answers a conflict instead of overwriting a newer one.
-- Additive: it adds two columns with a default that every existing row takes.

-- 1 when the rule is created; each change adds 1.
ALTER TABLE docs_moderation ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0);

-- 1 when the announcement is created; each change, switching it on or off included, adds 1.
ALTER TABLE docs_announcements ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0);
