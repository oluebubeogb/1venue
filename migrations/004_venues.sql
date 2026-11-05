-- 004: permanent Venues — a short, case-insensitive /v/{slug} link that always opens the same room
-- code with the waiting room forced on. Meetings held there are read back from meeting_history by code.
CREATE TABLE IF NOT EXISTS venues (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE CHECK (slug = lower(slug)),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_venues_owner ON venues(owner_user_id, created_at DESC);
