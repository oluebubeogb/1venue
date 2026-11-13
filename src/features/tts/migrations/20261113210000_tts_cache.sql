-- tts (feature): cache of generated read-out audio, so the same text is only paid for once.
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_purpose_check;
ALTER TABLE files ADD CONSTRAINT files_purpose_check
  CHECK (purpose IN ('attachment','avatar','cover','post','timeline','transcript','content','chat','voice','whiteboard','sound','tts','other'));

CREATE TABLE IF NOT EXISTS tts_cache (
  hash         TEXT PRIMARY KEY,                 -- sha256 of model, voice, format, language and text
  file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  lang         TEXT NOT NULL,
  voice        TEXT NOT NULL,
  model        TEXT NOT NULL,
  chars        INTEGER NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
