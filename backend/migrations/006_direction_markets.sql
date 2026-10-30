DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM markets) THEN
        RAISE EXCEPTION 'Use a fresh development database for direction markets. Existing orders must not change meaning.';
    END IF;
END $$;
ALTER TABLE markets DROP CONSTRAINT markets_outcome_check;
ALTER TABLE markets ADD CONSTRAINT markets_outcome_check CHECK (outcome IN ('yes', 'no', 'refund'));
ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_kind_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_kind_check CHECK (kind IN ('grant', 'buy', 'sell', 'payout', 'refund'));
