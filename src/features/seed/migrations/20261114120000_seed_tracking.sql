-- Demo ("seed") data: flagged so it can be removed exactly, leaving real accounts untouched.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_is_seed ON users (is_seed) WHERE is_seed;

-- Rows the seed created that are not owned (and cascaded) through a seed user.
CREATE TABLE IF NOT EXISTS seed_rows (
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tbl, row_id)
);
