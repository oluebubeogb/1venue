-- 005: persist "venue is open" so guest door polls see live even if this process's Map is empty.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS active_history_id INTEGER REFERENCES meeting_history(id) ON DELETE SET NULL;
