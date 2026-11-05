-- 007: plans + custom venue slugs.
-- users.plan: free (5 chars + "-venue") | premium (4–16, no suffix) | slug3 (3+ chars) | slug2 (2+ chars)
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE venues ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_slug_lower ON venues (lower(slug));
