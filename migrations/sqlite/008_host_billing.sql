CREATE TABLE credit_billing_sessions (
 id INTEGER PRIMARY KEY,
 history_id INTEGER UNIQUE REFERENCES meeting_history(id) ON DELETE SET NULL,
 user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 code TEXT NOT NULL,
 media_room TEXT NOT NULL UNIQUE,
 media_rooms TEXT NOT NULL DEFAULT '[]',
 media_issued INTEGER NOT NULL DEFAULT 0,
 owner_id TEXT NOT NULL,
 started_ms INTEGER NOT NULL,
 accounted_ms INTEGER NOT NULL,
 charged_units INTEGER NOT NULL DEFAULT 0 CHECK(charged_units>=0),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','closing','closed')),
 low_credit INTEGER NOT NULL DEFAULT 0,
 ended_ms INTEGER,
 end_reason TEXT,
 cleanup_until_ms INTEGER,
 last_cleanup_ms INTEGER,
 CHECK(state='closed' OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX credit_billing_one_host ON credit_billing_sessions(user_id) WHERE state<>'closed';
CREATE UNIQUE INDEX credit_billing_one_code ON credit_billing_sessions(code) WHERE state<>'closed';
CREATE TABLE credit_billing_workers(id TEXT PRIMARY KEY,heartbeat_ms INTEGER NOT NULL,stopped INTEGER NOT NULL DEFAULT 0);
ALTER TABLE credit_ledger RENAME TO credit_ledger_old;
CREATE TABLE credit_ledger (
 id INTEGER PRIMARY KEY,
 user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 payment_id INTEGER UNIQUE REFERENCES credit_payments(id),
 billing_session_id INTEGER REFERENCES credit_billing_sessions(id),
 through_ms INTEGER,
 kind TEXT NOT NULL,
 delta_units INTEGER NOT NULL,
 balance_after_units INTEGER NOT NULL CHECK(balance_after_units BETWEEN 0 AND 9007199254740991),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((kind='purchase' AND payment_id IS NOT NULL AND billing_session_id IS NULL AND delta_units>0) OR (kind='usage' AND payment_id IS NULL AND billing_session_id IS NOT NULL AND delta_units<0 AND through_ms IS NOT NULL))
);
INSERT INTO credit_ledger(id,user_id,payment_id,kind,delta_units,balance_after_units,created_at) SELECT id,user_id,payment_id,kind,delta_units,balance_after_units,created_at FROM credit_ledger_old;
DROP TABLE credit_ledger_old;
CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id,id DESC);
CREATE UNIQUE INDEX credit_ledger_usage_checkpoint ON credit_ledger(billing_session_id,through_ms) WHERE billing_session_id IS NOT NULL;
