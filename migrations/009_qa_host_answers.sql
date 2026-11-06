-- 009: Host answers on Q&A as a JSONB array of thread replies
ALTER TABLE questions ADD COLUMN IF NOT EXISTS host_answers JSONB NOT NULL DEFAULT '[]'::jsonb;
