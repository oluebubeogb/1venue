-- Local accounts: sessions, email/reset tokens, OAuth identities. See docs/AUTH.md.

-- Users: password is optional (Google-only and imported users have none until they set one)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
-- true for imported accounts without a usable password: they get a "set your password" email
ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_password_setup BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN users.accounts_id IS 'External account id from an earlier import. Unused; kept for reference.';

-- Imported users got a random placeholder password (bcrypt cost 8, never told to anyone).
-- Clear it so they go through "set a password" instead. Local sign-ups used cost 10 and are untouched.
UPDATE users
   SET password_hash = NULL, needs_password_setup = true
 WHERE accounts_id IS NOT NULL
   AND password_hash LIKE '$2_$08$%';

-- Sign-in sessions: one row per device. Only hashes of refresh tokens are stored.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,
  prev_token_hash TEXT,
  rotated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  max_expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  revoke_reason   TEXT,
  method          TEXT NOT NULL DEFAULT 'password',
  user_agent      TEXT,
  ip              TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_prev ON auth_sessions(prev_token_hash) WHERE prev_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id) WHERE revoked_at IS NULL;

-- One-time email tokens: verify | email_change | reset | set_password. Only hashes are stored.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('verify', 'email_change', 'reset', 'set_password')),
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, kind) WHERE used_at IS NULL;

-- External sign-in identities (Google today). subject = the provider's stable user id ("sub").
CREATE TABLE IF NOT EXISTS oauth_identities (
  provider      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(user_id);
