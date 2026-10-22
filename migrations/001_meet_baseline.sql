-- 001: Meet baseline schema (idempotent; safe on existing Meet databases)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS meeting_history (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  host_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  host_display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  max_participants INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_meeting_history_host ON meeting_history(host_user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_history_code ON meeting_history(code);
CREATE INDEX IF NOT EXISTS idx_meeting_history_created ON meeting_history(created_at DESC);

CREATE TABLE IF NOT EXISTS meeting_participants_log (
  id SERIAL PRIMARY KEY,
  meeting_history_id INTEGER NOT NULL REFERENCES meeting_history(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  participant_id TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mpl_meeting ON meeting_participants_log(meeting_history_id);
CREATE INDEX IF NOT EXISTS idx_mpl_user ON meeting_participants_log(user_id);

CREATE TABLE IF NOT EXISTS scheduled_meetings (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_display_name TEXT,
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_scheduled_host ON scheduled_meetings(host_user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_start ON scheduled_meetings(scheduled_start);
CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_meetings(status);

CREATE TABLE IF NOT EXISTS meeting_activity (
  id SERIAL PRIMARY KEY,
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id TEXT,
  actor_name TEXT,
  event_type TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_code ON meeting_activity(code);
CREATE INDEX IF NOT EXISTS idx_activity_meeting ON meeting_activity(meeting_history_id);

CREATE TABLE IF NOT EXISTS meeting_recordings (
  id SERIAL PRIMARY KEY,
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  started_by_user_id INTEGER,
  started_by_name TEXT,
  options_json TEXT,
  status TEXT NOT NULL DEFAULT 'recording',
  file_path TEXT,
  file_url TEXT,
  artifact_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rec_code ON meeting_recordings(code);

CREATE TABLE IF NOT EXISTS meeting_membership (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  user_id INTEGER,
  participant_id TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'participant',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(code, user_id),
  UNIQUE(code, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_membership_code ON meeting_membership(code);
CREATE INDEX IF NOT EXISTS idx_membership_user ON meeting_membership(user_id);

CREATE TABLE IF NOT EXISTS meeting_templates (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  settings_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meeting_artifacts (
  id SERIAL PRIMARY KEY,
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE CASCADE,
  short_code TEXT NOT NULL,
  artifact_slug TEXT NOT NULL UNIQUE,
  is_live BOOLEAN NOT NULL DEFAULT false,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_artifacts_code ON meeting_artifacts(short_code);
CREATE INDEX IF NOT EXISTS idx_artifacts_history ON meeting_artifacts(meeting_history_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  meeting_history_id INTEGER,
  artifact_id INTEGER REFERENCES meeting_artifacts(id) ON DELETE CASCADE,
  session_id TEXT,
  sender_id TEXT,
  sender_name TEXT,
  sender_user_id INTEGER,
  body TEXT,
  attachments JSONB,
  group_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_artifact ON chat_messages(artifact_id);
CREATE INDEX IF NOT EXISTS idx_chat_history ON chat_messages(meeting_history_id);

CREATE TABLE IF NOT EXISTS personal_notes (
  id SERIAL PRIMARY KEY,
  artifact_id INTEGER NOT NULL REFERENCES meeting_artifacts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(artifact_id, user_id)
);

-- Cross-meeting private DMs between logged-in users (and guest-aware) 
CREATE TABLE IF NOT EXISTS dm_threads (
  id SERIAL PRIMARY KEY,
  user_a_id INTEGER,
  user_b_id INTEGER,
  guest_key TEXT,
  guest_display_name TEXT,
  peer_is_guest BOOLEAN NOT NULL DEFAULT FALSE,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dm_threads_a ON dm_threads(user_a_id);
CREATE INDEX IF NOT EXISTS idx_dm_threads_b ON dm_threads(user_b_id);
CREATE INDEX IF NOT EXISTS idx_dm_threads_guest ON dm_threads(guest_key);

CREATE TABLE IF NOT EXISTS dm_messages (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_user_id INTEGER,
  sender_participant_id TEXT,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL,
  meeting_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dm_messages_thread ON dm_messages(thread_id);

-- In-meeting sub-groups (host/cohost managed) 
CREATE TABLE IF NOT EXISTS chat_groups (
  id TEXT PRIMARY KEY,
  meeting_code TEXT NOT NULL,
  meeting_history_id INTEGER,
  title TEXT NOT NULL,
  created_by_participant_id TEXT,
  created_by_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_groups_code ON chat_groups(meeting_code);

CREATE TABLE IF NOT EXISTS chat_group_members (
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  participant_id TEXT,
  user_id INTEGER,
  display_name TEXT,
  PRIMARY KEY (group_id, participant_id)
);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender_user_id INTEGER;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_chat_group ON chat_messages(group_id);

INSERT INTO meeting_templates (slug, name, description, settings_json, sort_order) VALUES
 ('blank','Blank meeting','Default permissions','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":true}',0),
 ('research','Research meeting','Waiting room on, focused discussion','{"waitingRoom":true,"guestAccess":true,"participantScreenShare":true,"raiseHand":true}',1),
 ('classroom','Classroom','Raise hand + waiting room, limited guest share','{"waitingRoom":true,"guestAccess":false,"participantScreenShare":false,"raiseHand":true,"participantsCanInvite":false}',2),
 ('team','Team meeting','Open collaboration','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":true,"chat":true,"reactions":true}',3),
 ('interview','Interview','Waiting room, no guest invite','{"waitingRoom":true,"guestAccess":true,"participantScreenShare":false,"guestsCanInvite":false}',4),
 ('presentation','Presentation','Presenter-focused, limited participant share','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":false,"raiseHand":true}',5)
ON CONFLICT (slug) DO NOTHING;
