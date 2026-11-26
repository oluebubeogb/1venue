-- Post-redenomination unit balances can exceed int4 (2,147,483,647). These
-- columns were already declared BIGINT in current migrations; widen any leftover
-- INTEGER columns so a settle/update cannot fail with pg 22003.
-- SQLite INTEGER is already 64-bit, so no sqlite twin is needed.

DO $$
DECLARE
  col RECORD;
BEGIN
  FOR col IN
    SELECT * FROM (VALUES
      ('credit_wallets', 'balance_units'),
      ('credit_wallets', 'plan_balance_units'),
      ('credit_wallets', 'plan_grant_units'),
      ('credit_wallets', 'period_used_units'),
      ('credit_payments', 'credit_units'),
      ('credit_ledger', 'delta_units'),
      ('credit_ledger', 'balance_after_units'),
      ('credit_billing_sessions', 'charged_units'),
      ('events', 'meeting_entry_units'),
      ('paid_meeting_sessions', 'entry_units'),
      ('paid_meeting_entries', 'entry_units'),
      ('paid_meeting_entries', 'refund_units'),
      ('paid_meeting_extensions', 'units'),
      ('paid_meeting_transfers', 'units'),
      ('paid_meeting_earnings', 'gross_units'),
      ('paid_meeting_earnings', 'refund_units'),
      ('paid_meeting_earnings', 'host_units'),
      ('paid_meeting_earnings', 'platform_units'),
      ('paid_meeting_earnings', 'transferred_units'),
      ('paid_usage_meters', 'billed_units')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = col.tbl
        AND c.column_name = col.col
        AND c.data_type IN ('integer', 'smallint')
    ) THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE BIGINT', col.tbl, col.col);
    END IF;
  END LOOP;
END $$;
