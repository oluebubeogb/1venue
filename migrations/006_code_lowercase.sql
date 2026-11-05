-- 006: meeting/venue room codes are now 6 lowercase alnum (e.g. y5yi87). Lowercase every stored code.
-- Idempotent: only touches tables/columns that exist, and only rows not already lowercase.
DO $$
DECLARE t TEXT; c TEXT;
BEGIN
  FOR t, c IN SELECT * FROM (VALUES
    ('venues','code'), ('meeting_history','code'), ('scheduled_meetings','code'), ('meeting_activity','code'),
    ('meeting_recordings','code'), ('meeting_membership','code'), ('meeting_artifacts','short_code'),
    ('events','code'), ('chat_groups','meeting_code'), ('dm_messages','meeting_code'), ('files','room_code')) AS x(t, c)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = t AND column_name = c) THEN
      EXECUTE format('UPDATE %I SET %I = lower(%I) WHERE %I IS NOT NULL AND %I <> lower(%I)', t, c, c, c, c, c);
    END IF;
  END LOOP;
END $$;
