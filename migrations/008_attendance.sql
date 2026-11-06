-- 008: Attendance shares — long random public/private links to meeting attendance lists
CREATE TABLE IF NOT EXISTS attendance_shares (
  id                 SERIAL PRIMARY KEY,
  meeting_history_id INTEGER NOT NULL REFERENCES meeting_history(id) ON DELETE CASCADE,
  token              TEXT NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 24 AND 80),
  is_public          BOOLEAN NOT NULL DEFAULT TRUE,
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attendance_history ON attendance_shares(meeting_history_id);
CREATE INDEX IF NOT EXISTS idx_attendance_token ON attendance_shares(token);
