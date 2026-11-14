-- Case-insensitive unique usernames + optional phone (E.164). Safe on a fresh or lightly-used DB:
-- any case-only clashes are renamed before the unique index is applied. Phone is not unique
-- and is not verified by SMS (phone_verified stays false until a later flow exists).

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
  r RECORD;
  cand TEXT;
  n INT;
BEGIN
  FOR r IN
    SELECT a.id, a.username
    FROM users a
    JOIN users b ON lower(a.username) = lower(b.username) AND a.id > b.id
  LOOP
    n := 2;
    cand := left(r.username, 27) || '_' || n;
    WHILE EXISTS (SELECT 1 FROM users WHERE lower(username) = lower(cand) OR username = cand) LOOP
      n := n + 1;
      cand := left(r.username, 27) || '_' || n;
    END LOOP;
    UPDATE users SET username = cand, updated_at = NOW() WHERE id = r.id;
  END LOOP;
END $$;

DROP INDEX IF EXISTS idx_users_username_lower;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));
