-- 012: reusable presentation materials (PDF, PPTX, images, YouTube) per user; optional event link
CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  kind TEXT NOT NULL CHECK (kind IN ('slides', 'image', 'youtube', 'pdf', 'pptx')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_materials_owner ON materials(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS event_materials (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, material_id)
);
CREATE INDEX IF NOT EXISTS idx_event_materials_event ON event_materials(event_id, sort_order);
