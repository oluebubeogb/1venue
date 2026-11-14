-- Match PostgreSQL CHECK constraints for both fresh and existing local databases.

CREATE TRIGGER IF NOT EXISTS check_users_insert BEFORE INSERT ON users
WHEN NOT (NEW.bio IS NULL OR length(NEW.bio)<=500) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: users');
END;

CREATE TRIGGER IF NOT EXISTS check_users_update BEFORE UPDATE ON users
WHEN NOT (NEW.bio IS NULL OR length(NEW.bio)<=500) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: users');
END;

CREATE TRIGGER IF NOT EXISTS check_user_prefs_insert BEFORE INSERT ON user_prefs
WHEN NOT (NEW.theme IN ('system','light','dark') AND regexp('^#[0-9a-fA-F]{6}$',NEW.accent) AND (NEW.accent2 IS NULL OR regexp('^#[0-9a-fA-F]{6}$',NEW.accent2)) AND NEW.font_scale BETWEEN 0.8 AND 1.5) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: user_prefs');
END;

CREATE TRIGGER IF NOT EXISTS check_user_prefs_update BEFORE UPDATE ON user_prefs
WHEN NOT (NEW.theme IN ('system','light','dark') AND regexp('^#[0-9a-fA-F]{6}$',NEW.accent) AND (NEW.accent2 IS NULL OR regexp('^#[0-9a-fA-F]{6}$',NEW.accent2)) AND NEW.font_scale BETWEEN 0.8 AND 1.5) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: user_prefs');
END;

CREATE TRIGGER IF NOT EXISTS check_events_insert BEFORE INSERT ON events
WHEN NOT (regexp('^[a-z0-9][a-z0-9-]{2,80}$',NEW.slug) AND regexp('^[a-z0-9]{6}$',NEW.code) AND length(NEW.title) BETWEEN 2 AND 120 AND (NEW.description IS NULL OR length(NEW.description)<=5000) AND NEW.category IN ('talk_show','presentation','seminar','sermon','webinar','workshop','meeting','concert','class','other') AND NEW.visibility IN ('public','unlisted','private') AND NEW.status IN ('draft','scheduled','live','ended','cancelled') AND NEW.speaker_seats BETWEEN 1 AND 50 AND NEW.live_viewers>=0 AND NEW.peak_viewers>=0 AND NEW.total_joins>=0 AND (NEW.ends_at IS NULL OR NEW.starts_at IS NULL OR julianday(NEW.ends_at)>=julianday(NEW.starts_at))) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: events');
END;

CREATE TRIGGER IF NOT EXISTS check_events_update BEFORE UPDATE ON events
WHEN NOT (regexp('^[a-z0-9][a-z0-9-]{2,80}$',NEW.slug) AND regexp('^[a-z0-9]{6}$',NEW.code) AND length(NEW.title) BETWEEN 2 AND 120 AND (NEW.description IS NULL OR length(NEW.description)<=5000) AND NEW.category IN ('talk_show','presentation','seminar','sermon','webinar','workshop','meeting','concert','class','other') AND NEW.visibility IN ('public','unlisted','private') AND NEW.status IN ('draft','scheduled','live','ended','cancelled') AND NEW.speaker_seats BETWEEN 1 AND 50 AND NEW.live_viewers>=0 AND NEW.peak_viewers>=0 AND NEW.total_joins>=0 AND (NEW.ends_at IS NULL OR NEW.starts_at IS NULL OR julianday(NEW.ends_at)>=julianday(NEW.starts_at))) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: events');
END;

CREATE TRIGGER IF NOT EXISTS check_event_speakers_insert BEFORE INSERT ON event_speakers
WHEN NOT (length(NEW.display_name) BETWEEN 1 AND 80 AND (NEW.headline IS NULL OR length(NEW.headline)<=140)) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: event_speakers');
END;

CREATE TRIGGER IF NOT EXISTS check_event_speakers_update BEFORE UPDATE ON event_speakers
WHEN NOT (length(NEW.display_name) BETWEEN 1 AND 80 AND (NEW.headline IS NULL OR length(NEW.headline)<=140)) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: event_speakers');
END;

CREATE TRIGGER IF NOT EXISTS check_follows_insert BEFORE INSERT ON follows
WHEN NOT (NEW.follower_id<>NEW.followee_id) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: follows');
END;

CREATE TRIGGER IF NOT EXISTS check_follows_update BEFORE UPDATE ON follows
WHEN NOT (NEW.follower_id<>NEW.followee_id) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: follows');
END;

CREATE TRIGGER IF NOT EXISTS check_posts_insert BEFORE INSERT ON posts
WHEN NOT (NEW.kind IN ('post','event_scheduled','event_live','event_recap','summary') AND (NEW.body IS NULL OR length(NEW.body)<=4000) AND NEW.like_count>=0 AND NEW.comment_count>=0) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: posts');
END;

CREATE TRIGGER IF NOT EXISTS check_posts_update BEFORE UPDATE ON posts
WHEN NOT (NEW.kind IN ('post','event_scheduled','event_live','event_recap','summary') AND (NEW.body IS NULL OR length(NEW.body)<=4000) AND NEW.like_count>=0 AND NEW.comment_count>=0) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: posts');
END;

CREATE TRIGGER IF NOT EXISTS check_comments_insert BEFORE INSERT ON comments
WHEN NOT (NEW.target_type IN ('event','post','room') AND length(NEW.author_name) BETWEEN 1 AND 80 AND length(NEW.body) BETWEEN 1 AND 2000 AND NEW.like_count>=0 AND NEW.reply_count>=0 AND NEW.status IN ('visible','hidden','flagged')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: comments');
END;

CREATE TRIGGER IF NOT EXISTS check_comments_update BEFORE UPDATE ON comments
WHEN NOT (NEW.target_type IN ('event','post','room') AND length(NEW.author_name) BETWEEN 1 AND 80 AND length(NEW.body) BETWEEN 1 AND 2000 AND NEW.like_count>=0 AND NEW.reply_count>=0 AND NEW.status IN ('visible','hidden','flagged')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: comments');
END;

CREATE TRIGGER IF NOT EXISTS check_polls_insert BEFORE INSERT ON polls
WHEN NOT (length(NEW.question) BETWEEN 1 AND 300 AND json_type(NEW.options)='array' AND json_array_length(NEW.options) BETWEEN 2 AND 10 AND NEW.status IN ('open','closed')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: polls');
END;

CREATE TRIGGER IF NOT EXISTS check_polls_update BEFORE UPDATE ON polls
WHEN NOT (length(NEW.question) BETWEEN 1 AND 300 AND json_type(NEW.options)='array' AND json_array_length(NEW.options) BETWEEN 2 AND 10 AND NEW.status IN ('open','closed')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: polls');
END;

CREATE TRIGGER IF NOT EXISTS check_poll_votes_insert BEFORE INSERT ON poll_votes
WHEN NOT (NEW.option_idx BETWEEN 0 AND 9) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: poll_votes');
END;

CREATE TRIGGER IF NOT EXISTS check_poll_votes_update BEFORE UPDATE ON poll_votes
WHEN NOT (NEW.option_idx BETWEEN 0 AND 9) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: poll_votes');
END;

CREATE TRIGGER IF NOT EXISTS check_questions_insert BEFORE INSERT ON questions
WHEN NOT (length(NEW.body) BETWEEN 1 AND 1000 AND NEW.upvotes>=0 AND NEW.status IN ('open','answered','dismissed','live')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: questions');
END;

CREATE TRIGGER IF NOT EXISTS check_questions_update BEFORE UPDATE ON questions
WHEN NOT (length(NEW.body) BETWEEN 1 AND 1000 AND NEW.upvotes>=0 AND NEW.status IN ('open','answered','dismissed','live')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: questions');
END;

CREATE TRIGGER IF NOT EXISTS check_transcript_segments_insert BEFORE INSERT ON transcript_segments
WHEN NOT (length(NEW.text) BETWEEN 1 AND 4000 AND NEW.source IN ('stt','webspeech','manual','import')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: transcript_segments');
END;

CREATE TRIGGER IF NOT EXISTS check_transcript_segments_update BEFORE UPDATE ON transcript_segments
WHEN NOT (length(NEW.text) BETWEEN 1 AND 4000 AND NEW.source IN ('stt','webspeech','manual','import')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: transcript_segments');
END;

CREATE TRIGGER IF NOT EXISTS check_ai_summaries_insert BEFORE INSERT ON ai_summaries
WHEN NOT (NEW.kind IN ('summary','action_items','catchup','recap')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: ai_summaries');
END;

CREATE TRIGGER IF NOT EXISTS check_ai_summaries_update BEFORE UPDATE ON ai_summaries
WHEN NOT (NEW.kind IN ('summary','action_items','catchup','recap')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: ai_summaries');
END;

CREATE TRIGGER IF NOT EXISTS check_files_insert BEFORE INSERT ON files
WHEN NOT (regexp('^[A-Za-z0-9_-]{16,64}$',NEW.id) AND NEW.driver IN ('local','s3') AND NEW.size_bytes>=0 AND NEW.purpose IN ('attachment','avatar','cover','post','timeline','transcript','content','chat','voice','whiteboard','sound','other')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: files');
END;

CREATE TRIGGER IF NOT EXISTS check_files_update BEFORE UPDATE ON files
WHEN NOT (regexp('^[A-Za-z0-9_-]{16,64}$',NEW.id) AND NEW.driver IN ('local','s3') AND NEW.size_bytes>=0 AND NEW.purpose IN ('attachment','avatar','cover','post','timeline','transcript','content','chat','voice','whiteboard','sound','other')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: files');
END;

CREATE TRIGGER IF NOT EXISTS check_bible_cache_insert BEFORE INSERT ON bible_cache
WHEN NOT (NEW.chapter>0) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: bible_cache');
END;

CREATE TRIGGER IF NOT EXISTS check_bible_cache_update BEFORE UPDATE ON bible_cache
WHEN NOT (NEW.chapter>0) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: bible_cache');
END;

CREATE TRIGGER IF NOT EXISTS check_venues_insert BEFORE INSERT ON venues
WHEN NOT (NEW.slug=lower(NEW.slug)) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: venues');
END;

CREATE TRIGGER IF NOT EXISTS check_venues_update BEFORE UPDATE ON venues
WHEN NOT (NEW.slug=lower(NEW.slug)) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: venues');
END;

CREATE TRIGGER IF NOT EXISTS check_attendance_shares_insert BEFORE INSERT ON attendance_shares
WHEN NOT (length(NEW.token) BETWEEN 24 AND 80) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: attendance_shares');
END;

CREATE TRIGGER IF NOT EXISTS check_attendance_shares_update BEFORE UPDATE ON attendance_shares
WHEN NOT (length(NEW.token) BETWEEN 24 AND 80) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: attendance_shares');
END;

CREATE TRIGGER IF NOT EXISTS check_materials_insert BEFORE INSERT ON materials
WHEN NOT (length(NEW.title) BETWEEN 1 AND 120 AND NEW.kind IN ('slides','image','youtube','pdf','pptx')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: materials');
END;

CREATE TRIGGER IF NOT EXISTS check_materials_update BEFORE UPDATE ON materials
WHEN NOT (length(NEW.title) BETWEEN 1 AND 120 AND NEW.kind IN ('slides','image','youtube','pdf','pptx')) BEGIN
 SELECT RAISE(ABORT, 'CHECK constraint failed: materials');
END;

INSERT INTO meeting_templates (slug, name, description, settings_json, sort_order) VALUES
 ('sermon','Sermon / service','Stage for ministers, scripture panel, audience Q&A','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":false,"participantMicrophone":false,"participantCamera":false,"raiseHand":true,"stage":true,"speakerSeats":3}',6),
 ('talk_show','Talk show','Host and guests on stage, audience requests to speak','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":false,"participantMicrophone":false,"participantCamera":false,"raiseHand":true,"stage":true,"speakerSeats":4}',7),
 ('seminar','Seminar','Presenter-first, polls and Q&A','{"waitingRoom":false,"guestAccess":true,"participantScreenShare":false,"participantMicrophone":false,"raiseHand":true,"stage":true,"speakerSeats":6}',8)
ON CONFLICT (slug) DO NOTHING;
