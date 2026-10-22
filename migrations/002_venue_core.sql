-- 002: 1venue core. Adds profiles, preferences, events and discovery, social graph,
-- timeline, comments, polls, Q&A, transcripts, AI summaries, files, Bible cache,
-- and personal whiteboards.
-- Every table has explicit constraints and indexes on its hot paths.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Profiles ------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accounts_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_accounts_id ON users(accounts_id) WHERE accounts_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_handle ON users(LOWER(handle)) WHERE handle IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT chk_users_bio_len CHECK (bio IS NULL OR char_length(bio) <= 500);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- array_to_string is only STABLE; generated columns need an IMMUTABLE wrapper.
CREATE OR REPLACE FUNCTION venue_tags_text(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(array_to_string($1, ' '), '') $$;

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme          TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark')),
  accent         TEXT NOT NULL DEFAULT '#2563eb' CHECK (accent ~ '^#[0-9a-fA-F]{6}$'),
  accent2        TEXT CHECK (accent2 IS NULL OR accent2 ~ '^#[0-9a-fA-F]{6}$'),
  font_scale     NUMERIC(3,2) NOT NULL DEFAULT 1.00 CHECK (font_scale BETWEEN 0.80 AND 1.50),
  reduce_motion  BOOLEAN NOT NULL DEFAULT FALSE,
  bible_translation TEXT NOT NULL DEFAULT 'eng_kjv',
  caption_lang   TEXT,
  extra          JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Events and discovery ------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  code          TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{3}[0-9]{3}$'),
  host_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_name     TEXT,
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  description   TEXT CHECK (description IS NULL OR char_length(description) <= 5000),
  category      TEXT NOT NULL DEFAULT 'meeting'
                CHECK (category IN ('talk_show','presentation','seminar','sermon','webinar','workshop','meeting','concert','class','other')),
  tags          TEXT[] NOT NULL DEFAULT '{}',
  language      TEXT NOT NULL DEFAULT 'en',
  visibility    TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted','private')),
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft','scheduled','live','ended','cancelled')),
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  cover_url     TEXT,
  theme         JSONB NOT NULL DEFAULT '{}'::jsonb,       -- {accent, accent2} owner's theme for QR and branding
  speaker_seats SMALLINT NOT NULL DEFAULT 4 CHECK (speaker_seats BETWEEN 1 AND 50),
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,       -- Meet meeting settings snapshot
  template_slug TEXT,
  live_viewers  INTEGER NOT NULL DEFAULT 0 CHECK (live_viewers >= 0),
  peak_viewers  INTEGER NOT NULL DEFAULT 0 CHECK (peak_viewers >= 0),
  total_joins   INTEGER NOT NULL DEFAULT 0 CHECK (total_joins >= 0),
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search        TSVECTOR GENERATED ALWAYS AS (
                  setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(host_name,'')), 'B') ||
                  setweight(to_tsvector('simple', venue_tags_text(tags)), 'B') ||
                  setweight(to_tsvector('simple', coalesce(description,'')), 'C')
                ) STORED,
  CONSTRAINT chk_events_time CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS idx_events_search ON events USING GIN (search);
CREATE INDEX IF NOT EXISTS idx_events_title_trgm ON events USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_events_host ON events(host_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_public_live ON events(started_at DESC) WHERE status = 'live' AND visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_events_public_upcoming ON events(starts_at) WHERE status = 'scheduled' AND visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category, status);
CREATE INDEX IF NOT EXISTS idx_events_tags ON events USING GIN (tags);

CREATE TABLE IF NOT EXISTS event_speakers (
  id           BIGSERIAL PRIMARY KEY,
  event_id     BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  headline     TEXT CHECK (headline IS NULL OR char_length(headline) <= 140),
  avatar_url   TEXT,
  sort_order   SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_speakers_event ON event_speakers(event_id, sort_order);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id   BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_rsvps_user ON event_rsvps(user_id, created_at DESC);

ALTER TABLE meeting_history ADD COLUMN IF NOT EXISTS event_id BIGINT REFERENCES events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_history_event ON meeting_history(event_id);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(artifact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_messages_thread_created ON dm_messages(thread_id, created_at DESC);

-- Social graph and timeline -------------------------------------------------
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT chk_follow_self CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS posts (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id      BIGINT REFERENCES events(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL DEFAULT 'post' CHECK (kind IN ('post','event_scheduled','event_live','event_recap','summary')),
  body          TEXT CHECK (body IS NULL OR char_length(body) <= 4000),
  media         JSONB NOT NULL DEFAULT '[]'::jsonb,
  like_count    INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

-- Social comments (on events, live rooms and posts), with likes and threaded replies
CREATE TABLE IF NOT EXISTS comments (
  id           BIGSERIAL PRIMARY KEY,
  target_type  TEXT NOT NULL CHECK (target_type IN ('event','post','room')),
  target_key   TEXT NOT NULL,                        -- event id, post id or room code
  parent_id    BIGINT REFERENCES comments(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_key   TEXT NOT NULL,                        -- user:<id> or participant id
  author_name  TEXT NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 80),
  body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  like_count   INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  reply_count  INTEGER NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
  status       TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','flagged')),
  moderation   JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_key, created_at DESC) WHERE parent_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id, created_at);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  liker_key  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, liker_key)
);

-- Polls and Q&A -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS polls (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT NOT NULL,
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE CASCADE,
  question     TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 300),
  options      JSONB NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 10),
  multi        BOOLEAN NOT NULL DEFAULT FALSE,
  anonymous    BOOLEAN NOT NULL DEFAULT TRUE,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_polls_meeting ON polls(meeting_history_id);
CREATE INDEX IF NOT EXISTS idx_polls_code ON polls(code, created_at DESC);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id    BIGINT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  voter_key  TEXT NOT NULL,
  option_idx SMALLINT NOT NULL CHECK (option_idx BETWEEN 0 AND 9),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, voter_key, option_idx)
);

CREATE TABLE IF NOT EXISTS questions (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT NOT NULL,
  meeting_history_id INTEGER REFERENCES meeting_history(id) ON DELETE CASCADE,
  author_key   TEXT NOT NULL,
  author_name  TEXT NOT NULL,
  body         TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  upvotes      INTEGER NOT NULL DEFAULT 0 CHECK (upvotes >= 0),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','dismissed','live')),
  ai_answer    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_questions_meeting ON questions(meeting_history_id, status);

CREATE TABLE IF NOT EXISTS question_votes (
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  voter_key   TEXT NOT NULL,
  PRIMARY KEY (question_id, voter_key)
);

-- Transcripts and AI --------------------------------------------------------
CREATE TABLE IF NOT EXISTS transcript_segments (
  id            BIGSERIAL PRIMARY KEY,
  meeting_history_id INTEGER NOT NULL REFERENCES meeting_history(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  speaker_key   TEXT,
  speaker_name  TEXT NOT NULL,
  text          TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
  lang          TEXT,
  source        TEXT NOT NULL DEFAULT 'stt' CHECK (source IN ('stt','webspeech','manual','import')),
  spoken_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transcript_meeting ON transcript_segments(meeting_history_id, spoken_at, id);

CREATE TABLE IF NOT EXISTS ai_summaries (
  id            BIGSERIAL PRIMARY KEY,
  meeting_history_id INTEGER NOT NULL REFERENCES meeting_history(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'summary' CHECK (kind IN ('summary','action_items','catchup','recap')),
  content       TEXT NOT NULL,
  provider      TEXT,
  model         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_summaries_meeting ON ai_summaries(meeting_history_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_usage (
  id         BIGSERIAL PRIMARY KEY,
  use_case   TEXT NOT NULL,
  provider   TEXT NOT NULL,
  model      TEXT,
  ok         BOOLEAN NOT NULL,
  latency_ms INTEGER,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at DESC);

-- Files (local disk or S3) ---------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{16,64}$'),
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_key     TEXT,
  driver        TEXT NOT NULL CHECK (driver IN ('local','s3')),
  object_key    TEXT NOT NULL,
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL CHECK (size_bytes >= 0),
  purpose       TEXT NOT NULL DEFAULT 'attachment' CHECK (purpose IN ('attachment','avatar','cover','post','timeline','transcript','other')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_user_id, created_at DESC);

-- Bible chapter cache (open-licence translations) ---------------------------
CREATE TABLE IF NOT EXISTS bible_cache (
  translation TEXT NOT NULL,
  book        TEXT NOT NULL,
  chapter     SMALLINT NOT NULL CHECK (chapter > 0),
  payload     JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (translation, book, chapter)
);

-- Personal whiteboards (owner-only, autosaved) -----------------------------
CREATE TABLE IF NOT EXISTS whiteboards (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'My board',
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, title)
);

INSERT INTO meeting_templates (slug, name, description, settings_json, sort_order) VALUES
 ('sermon','Sermon / service','Stage for ministers, scripture panel, audience Q&A','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":false,"participantMicrophone":false,"participantCamera":false,"raiseHand":true,"stage":true,"speakerSeats":3}',6),
 ('talk_show','Talk show','Host and guests on stage, audience requests to speak','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":false,"participantMicrophone":false,"participantCamera":false,"raiseHand":true,"stage":true,"speakerSeats":4}',7),
 ('seminar','Seminar','Presenter-first, polls and Q&A','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":false,"participantMicrophone":false,"raiseHand":true,"stage":true,"speakerSeats":6}',8)
ON CONFLICT (slug) DO NOTHING;
