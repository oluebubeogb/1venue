-- 003: widen files.purpose, track upload room/size for quotas, multi-board whiteboards.
-- Idempotent: every statement uses IF EXISTS / IF NOT EXISTS, so re-running it is harmless.

ALTER TABLE files DROP CONSTRAINT IF EXISTS files_purpose_check;
ALTER TABLE files ADD CONSTRAINT files_purpose_check
  CHECK (purpose IN ('attachment','avatar','cover','post','timeline','transcript','content','chat','voice','whiteboard','sound','other'));
ALTER TABLE files ADD COLUMN IF NOT EXISTS room_code TEXT;
CREATE INDEX IF NOT EXISTS idx_files_owner_user ON files(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_owner_key ON files(owner_key) WHERE owner_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_room ON files(room_code) WHERE room_code IS NOT NULL;

-- Several boards per user, addressed by id. Titles no longer need to be unique.
ALTER TABLE whiteboards DROP CONSTRAINT IF EXISTS whiteboards_user_id_title_key;
CREATE INDEX IF NOT EXISTS idx_whiteboards_user ON whiteboards(user_id, updated_at DESC);
