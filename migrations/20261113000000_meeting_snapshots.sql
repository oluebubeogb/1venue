-- Live-room snapshots written on graceful shutdown (SIGTERM) and restored when
-- people reconnect after a deploy/restart. Rows are deleted once restored or expired.
CREATE TABLE IF NOT EXISTS meeting_snapshots (
  code TEXT PRIMARY KEY,
  history_id INTEGER REFERENCES meeting_history(id) ON DELETE CASCADE,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
