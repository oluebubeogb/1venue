CREATE TABLE users_new (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  display_name TEXT,
  accounts_id TEXT,
  avatar_url TEXT,
  bio TEXT,
  handle TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  plan TEXT NOT NULL DEFAULT 'free'
);

INSERT INTO users_new (id,username,email,password_hash,created_at,display_name,accounts_id,avatar_url,bio,handle,updated_at,plan) SELECT id,username,email,password_hash,created_at,display_name,accounts_id,avatar_url,bio,handle,updated_at,plan FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

ALTER TABLE users ADD COLUMN needs_password_setup INTEGER NOT NULL DEFAULT false;







CREATE TABLE IF NOT EXISTS auth_sessions (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,
  prev_token_hash TEXT,
  rotated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at      TEXT NOT NULL,
  max_expires_at  TEXT NOT NULL,
  revoked_at      TEXT,
  revoke_reason   TEXT,
  method          TEXT NOT NULL DEFAULT 'password',
  user_agent      TEXT,
  ip              TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_prev ON auth_sessions(prev_token_hash) WHERE prev_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id) WHERE revoked_at IS NULL;


CREATE TABLE IF NOT EXISTS auth_tokens (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('verify', 'email_change', 'reset', 'set_password')),
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, kind) WHERE used_at IS NULL;


CREATE TABLE IF NOT EXISTS oauth_identities (
  provider      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(user_id);


ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_users_username_lower ON users(lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_users_email_lower ON users(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_users_accounts_id ON users(accounts_id) WHERE accounts_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_users_handle_lower ON users(lower(handle)) WHERE handle IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_venues_slug_lower ON venues(lower(slug));
CREATE INDEX IF NOT EXISTS idx_sqlite_event_speakers_email ON event_speakers(lower(email)) WHERE email IS NOT NULL;


-- Match PostgreSQL CHECK constraints for both fresh and existing local databases.

CREATE TRIGGER IF NOT EXISTS check_users_insert BEFORE INSERT ON users
WHEN NOT (NEW.bio IS NULL OR length(NEW.bio)<=500) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: users');
END;

CREATE TRIGGER IF NOT EXISTS check_users_update BEFORE UPDATE ON users
WHEN NOT (NEW.bio IS NULL OR length(NEW.bio)<=500) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: users');
END;



CREATE TABLE IF NOT EXISTS meeting_snapshots (
  code TEXT PRIMARY KEY,
  history_id INTEGER REFERENCES meeting_history(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);


CREATE TABLE IF NOT EXISTS tts_cache (
  hash         TEXT PRIMARY KEY,
  file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  lang         TEXT NOT NULL,
  voice        TEXT NOT NULL,
  model        TEXT NOT NULL,
  chars        INTEGER NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);


DROP TRIGGER check_files_insert;
CREATE TRIGGER IF NOT EXISTS check_files_insert BEFORE INSERT ON files
WHEN NOT (regexp('^[A-Za-z0-9_-]{16,64}$',NEW.id) AND NEW.driver IN ('local','s3') AND NEW.size_bytes>=0 AND NEW.purpose IN ('attachment','avatar','cover','post','timeline','transcript','content','chat','voice','whiteboard','sound','tts','other')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: files');
END;

DROP TRIGGER check_files_update;
CREATE TRIGGER IF NOT EXISTS check_files_update BEFORE UPDATE ON files
WHEN NOT (regexp('^[A-Za-z0-9_-]{16,64}$',NEW.id) AND NEW.driver IN ('local','s3') AND NEW.size_bytes>=0 AND NEW.purpose IN ('attachment','avatar','cover','post','timeline','transcript','content','chat','voice','whiteboard','sound','tts','other')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: files');
END;
