-- One-time cleanup of machine-generated usernames from imported accounts:
--   "accounts:<id>", "acc_<name>", "u1a2b3c4d_<name>"  ->  "<name>" (letters, digits, underscore)
-- If the clean name is taken, a number is appended (name_2, name_3, ...). Profile links that
-- used the prefixed form stop working; the clean form already worked before.
DO $$
DECLARE
  r RECORD;
  base TEXT;
  cand TEXT;
  n INT;
BEGIN
  FOR r IN SELECT id, username, email FROM users
           WHERE username LIKE 'accounts:%' OR username LIKE 'acc\_%' OR username ~* '^u[0-9a-f]{8}_'
           ORDER BY id
  LOOP
    base := r.username;
    base := regexp_replace(base, '^accounts:', '');
    base := regexp_replace(base, '^acc_', '');
    base := regexp_replace(base, '^u[0-9a-fA-F]{8}_', '');
    base := lower(regexp_replace(base, '[^a-zA-Z0-9_]', '', 'g'));
    -- "accounts:<uuid>" leaves a uuid-ish string: use the email's local part instead
    IF base = '' OR base ~ '^[0-9a-f]{20,}$' OR r.username LIKE 'accounts:%' THEN
      base := lower(regexp_replace(split_part(COALESCE(r.email, ''), '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
    END IF;
    IF length(base) < 3 THEN base := base || 'user'; END IF;
    base := left(base, 20);
    cand := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM users WHERE lower(username) = lower(cand) AND id <> r.id) LOOP
      n := n + 1;
      cand := left(base, 20) || '_' || n;
    END LOOP;
    UPDATE users SET username = cand, updated_at = NOW() WHERE id = r.id;
  END LOOP;
END $$;
