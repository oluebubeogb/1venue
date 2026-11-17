CREATE TABLE credit_billing_sessions (
 id BIGINT PRIMARY KEY,
 history_id INTEGER UNIQUE REFERENCES meeting_history(id) ON DELETE SET NULL,
 user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 code TEXT NOT NULL,
 media_room TEXT NOT NULL UNIQUE,
 media_rooms JSONB NOT NULL DEFAULT '[]',
 media_issued BOOLEAN NOT NULL DEFAULT false,
 owner_id TEXT NOT NULL,
 started_ms BIGINT NOT NULL,
 accounted_ms BIGINT NOT NULL,
 charged_units BIGINT NOT NULL DEFAULT 0 CHECK(charged_units>=0),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','closing','closed')),
 low_credit BOOLEAN NOT NULL DEFAULT false,
 ended_ms BIGINT,
 end_reason TEXT,
 cleanup_until_ms BIGINT,
 last_cleanup_ms BIGINT,
 CHECK(state='closed' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX credit_billing_one_host ON credit_billing_sessions(user_id) WHERE state<>'closed';
CREATE UNIQUE INDEX credit_billing_one_code ON credit_billing_sessions(code) WHERE state<>'closed';
CREATE TABLE credit_billing_workers(id TEXT PRIMARY KEY, heartbeat_ms BIGINT NOT NULL, stopped BOOLEAN NOT NULL DEFAULT false);
ALTER TABLE credit_ledger ALTER COLUMN payment_id DROP NOT NULL;
ALTER TABLE credit_ledger ADD COLUMN billing_session_id BIGINT REFERENCES credit_billing_sessions(id);
ALTER TABLE credit_ledger ADD COLUMN through_ms BIGINT;
ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_kind_check;
ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_delta_units_check;
ALTER TABLE credit_ledger ADD CHECK((kind='purchase' AND payment_id IS NOT NULL AND billing_session_id IS NULL AND delta_units>0) OR (kind='usage' AND payment_id IS NULL AND billing_session_id IS NOT NULL AND delta_units<0 AND through_ms IS NOT NULL));
CREATE UNIQUE INDEX credit_ledger_usage_checkpoint ON credit_ledger(billing_session_id,through_ms) WHERE billing_session_id IS NOT NULL;
