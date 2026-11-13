-- Full local SQLite schema, derived from PostgreSQL migrations 001-013.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  display_name TEXT,
  accounts_id TEXT,
  avatar_url TEXT,
  bio TEXT,
  handle TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  plan TEXT NOT NULL DEFAULT 'free'
);

CREATE TABLE IF NOT EXISTS meeting_history (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  host_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  host_display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at TEXT,
  max_participants INTEGER NOT NULL DEFAULT 1,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS meeting_participants_log (
  id INTEGER PRIMARY KEY,
  meeting_history_id INTEGER NOT NULL REFERENCES meeting_history(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  participant_id TEXT,
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  left_at TEXT
);

CREATE TABLE IF NOT EXISTS scheduled_meetings (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_display_name TEXT,
  scheduled_start TEXT NOT NULL,
  scheduled_end TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS meeting_activity (
  id INTEGER PRIMARY KEY,
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_id TEXT,
  actor_name TEXT,
  event_type TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS meeting_recordings (
  id INTEGER PRIMARY KEY,
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at TEXT,
  started_by_user_id INTEGER,
  started_by_name TEXT,
  options_json TEXT,
  status TEXT NOT NULL DEFAULT 'recording',
  file_path TEXT,
  file_url TEXT,
  artifact_id INTEGER
);

CREATE TABLE IF NOT EXISTS meeting_membership (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  user_id INTEGER,
  participant_id TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'participant',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  email TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(code, user_id),
  UNIQUE(code, participant_id)
);

CREATE TABLE IF NOT EXISTS meeting_templates (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  settings_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meeting_artifacts (
  id INTEGER PRIMARY KEY,
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE CASCADE,
  short_code TEXT NOT NULL,
  artifact_slug TEXT NOT NULL UNIQUE,
  is_live INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  meeting_history_id INTEGER,
  artifact_id INTEGER REFERENCES meeting_artifacts(id) ON DELETE CASCADE,
  session_id TEXT,
  sender_id TEXT,
  sender_name TEXT,
  sender_user_id INTEGER,
  body TEXT,
  attachments TEXT,
  group_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS personal_notes (
  id INTEGER PRIMARY KEY,
  artifact_id INTEGER NOT NULL REFERENCES meeting_artifacts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(artifact_id, user_id)
);

CREATE TABLE IF NOT EXISTS dm_threads (
  id INTEGER PRIMARY KEY,
  user_a_id INTEGER,
  user_b_id INTEGER,
  guest_key TEXT,
  guest_display_name TEXT,
  peer_is_guest INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS dm_messages (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_user_id INTEGER,
  sender_participant_id TEXT,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL,
  meeting_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS chat_groups (
  id TEXT PRIMARY KEY,
  meeting_code TEXT NOT NULL,
  meeting_history_id INTEGER,
  title TEXT NOT NULL,
  created_by_participant_id TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS chat_group_members (
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  participant_id TEXT,
  user_id INTEGER,
  display_name TEXT,
  PRIMARY KEY (group_id, participant_id)
);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'system',
  accent TEXT NOT NULL DEFAULT '#2563eb',
  accent2 TEXT,
  font_scale REAL NOT NULL DEFAULT 1.00,
  reduce_motion INTEGER NOT NULL DEFAULT 0,
  bible_translation TEXT NOT NULL DEFAULT 'eng_kjv',
  caption_lang TEXT,
  extra TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_name TEXT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'meeting',
  tags TEXT NOT NULL DEFAULT '[]',
  language TEXT NOT NULL DEFAULT 'en',
  visibility TEXT NOT NULL DEFAULT 'public',
  status TEXT NOT NULL DEFAULT 'scheduled',
  starts_at TEXT,
  ends_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  cover_url TEXT,
  theme TEXT NOT NULL DEFAULT '{}',
  speaker_seats INTEGER NOT NULL DEFAULT 4,
  settings TEXT NOT NULL DEFAULT '{}',
  template_slug TEXT,
  live_viewers INTEGER NOT NULL DEFAULT 0,
  peak_viewers INTEGER NOT NULL DEFAULT 0,
  total_joins INTEGER NOT NULL DEFAULT 0,
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS event_speakers (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  headline TEXT,
  avatar_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  email TEXT
);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'post',
  body TEXT,
  media TEXT NOT NULL DEFAULT '[]',
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_key TEXT NOT NULL,
  parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_key TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'visible',
  moderation TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  liker_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (comment_id, liker_key)
);

CREATE TABLE IF NOT EXISTS polls (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  multi INTEGER NOT NULL DEFAULT 0,
  anonymous INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  option_idx INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (poll_id, voter_key, option_idx)
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE CASCADE,
  author_key TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  upvotes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  ai_answer TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  host_answers TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS question_votes (
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  PRIMARY KEY (question_id, voter_key)
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id INTEGER PRIMARY KEY,
  meeting_history_id INTEGER NOT NULL REFERENCES meeting_history(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  speaker_key TEXT,
  speaker_name TEXT NOT NULL,
  text TEXT NOT NULL,
  lang TEXT,
  source TEXT NOT NULL DEFAULT 'stt',
  spoken_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ai_summaries (
  id INTEGER PRIMARY KEY,
  meeting_history_id INTEGER NOT NULL REFERENCES meeting_history(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'summary',
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY,
  use_case TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  ok INTEGER NOT NULL,
  latency_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_key TEXT,
  driver TEXT NOT NULL,
  object_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'attachment',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  room_code TEXT
);

CREATE TABLE IF NOT EXISTS bible_cache (
  translation TEXT NOT NULL,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (translation, book, chapter)
);

CREATE TABLE IF NOT EXISTS whiteboards (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'My board',
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  opened_at TEXT,
  active_history_id INTEGER REFERENCES meeting_history(id) ON DELETE SET NULL,
  is_custom INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attendance_shares (
  id INTEGER PRIMARY KEY,
  meeting_history_id INTEGER NOT NULL REFERENCES meeting_history(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  is_public INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS venue_admins (
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (venue_id, user_id)
);

CREATE TABLE IF NOT EXISTS venue_audit (
  id INTEGER PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS event_materials (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_sqlite_events_42 ON events(status, visibility, starts_at);

CREATE INDEX IF NOT EXISTS idx_sqlite_events_43 ON events(host_user_id);

CREATE INDEX IF NOT EXISTS idx_sqlite_meeting_history_44 ON meeting_history(code);

CREATE INDEX IF NOT EXISTS idx_sqlite_venues_45 ON venues(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_sqlite_venues_46 ON venues(lower(slug));

CREATE INDEX IF NOT EXISTS idx_sqlite_chat_messages_47 ON chat_messages(meeting_history_id, created_at);

CREATE INDEX IF NOT EXISTS idx_sqlite_transcript_segments_48 ON transcript_segments(meeting_history_id, spoken_at);

CREATE INDEX IF NOT EXISTS idx_sqlite_posts_49 ON posts(created_at);

CREATE INDEX IF NOT EXISTS idx_sqlite_comments_50 ON comments(target_type, target_key, created_at);

CREATE INDEX IF NOT EXISTS idx_sqlite_files_51 ON files(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_sqlite_files_52 ON files(room_code);

CREATE INDEX IF NOT EXISTS idx_sqlite_whiteboards_53 ON whiteboards(user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_sqlite_materials_54 ON materials(owner_user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_sqlite_attendance_shares_55 ON attendance_shares(token);

INSERT INTO meeting_templates (slug, name, description, settings_json, sort_order) VALUES
 ('blank','Blank meeting','Default permissions','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":true}',0),
 ('research','Research meeting','Waiting room on, focused discussion','{"waitingRoom":true,"guestAccess":true,"participantScreenShare":true,"raiseHand":true}',1),
 ('classroom','Classroom','Raise hand + waiting room, limited guest share','{"waitingRoom":true,"guestAccess":false,"participantScreenShare":false,"raiseHand":true,"participantsCanInvite":false}',2),
 ('team','Team meeting','Open collaboration','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":true,"chat":true,"reactions":true}',3),
 ('interview','Interview','Waiting room, no guest invite','{"waitingRoom":true,"guestAccess":true,"participantScreenShare":false,"guestsCanInvite":false}',4),
 ('presentation','Presentation','Presenter-focused, limited participant share','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":false,"raiseHand":true}',5)
ON CONFLICT (slug) DO NOTHING;
