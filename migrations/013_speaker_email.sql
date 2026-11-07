-- 013: pending speaker invite by email (sync when user signs up)
ALTER TABLE event_speakers ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS idx_event_speakers_email ON event_speakers (lower(email)) WHERE email IS NOT NULL;
