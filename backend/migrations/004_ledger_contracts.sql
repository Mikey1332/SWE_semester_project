-- Record which contracts each buy, sell and payout moved, so users can see
-- their trade history. Empty for grants and for trades made before this change.
ALTER TABLE ledger_entries
    ADD COLUMN side     text     CHECK (side IN ('yes', 'no')),
    ADD COLUMN quantity bigint   CHECK (quantity > 0),
    ADD COLUMN price    smallint CHECK (price BETWEEN 1 AND 100); -- Music Notes per contract
