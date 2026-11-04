-- Review of the "¿Te sirvió?" comments and the date a revision was archived. Additive: it adds
-- nullable columns, an index and a constraint that every existing row already meets.

-- When the dashboard marked a comment as reviewed; NULL while it waits.
ALTER TABLE docs_feedback ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- The comments the dashboard lists, newest first, per site.
CREATE INDEX IF NOT EXISTS docs_feedback_comments ON docs_feedback (site, created_at DESC) WHERE comment IS NOT NULL;

-- When a revision was last archived. Archiving the published revision makes the site show Git again
-- from the next snapshot, so a later date than the active snapshot's is a pending change. Revisions
-- archived before this migration keep NULL: their date is unknown.
ALTER TABLE docs_revisions ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE docs_revisions ADD CONSTRAINT docs_revisions_archived_at CHECK (archived_at IS NULL OR status = 'archived');
