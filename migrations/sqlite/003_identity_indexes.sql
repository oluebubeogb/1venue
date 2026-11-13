CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_users_username_lower ON users(lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_users_email_lower ON users(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_users_accounts_id ON users(accounts_id) WHERE accounts_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_users_handle_lower ON users(lower(handle)) WHERE handle IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sqlite_venues_slug_lower ON venues(lower(slug));
CREATE INDEX IF NOT EXISTS idx_sqlite_event_speakers_email ON event_speakers(lower(email)) WHERE email IS NOT NULL;
