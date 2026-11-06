-- 010: Venue admins and audit log
CREATE TABLE IF NOT EXISTS venue_admins (
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (venue_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_venue_admins_user ON venue_admins(user_id);

CREATE TABLE IF NOT EXISTS venue_audit (
  id BIGSERIAL PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_venue_audit_venue ON venue_audit(venue_id, created_at DESC);
