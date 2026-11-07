-- 011: events.code must match the current 6-char lowercase alnum format used by
-- generateCode() / randCode() (same as meeting codes). The original check from
-- 002 required the old Meet-style ^[A-Z]{3}[0-9]{3}$ pattern and blocks inserts.
DO $$
BEGIN
  ALTER TABLE events DROP CONSTRAINT IF EXISTS events_code_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE events ADD CONSTRAINT events_code_check CHECK (code ~ '^[a-z0-9]{6}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Safety: normalize any leftover uppercase codes (006 already lowercased most rows).
UPDATE events SET code = lower(code) WHERE code IS NOT NULL AND code <> lower(code);
