-- A one-off reset: every player holding more than 9,000 coins (the testing
-- well's grants among them) is set back to 2,000. Kept in the ledger like
-- any other change of coins (its own reason, one entry per player).
INSERT INTO economy_ledger (player_id, item_id, delta, reason, idempotency_key)
SELECT player_id, 1, 2000 - qty, 'balance_reset', 'balance_reset:0069:' || player_id || '#0'
FROM inventory
WHERE item_id = 1 AND qty > 9000;

UPDATE inventory SET qty = 2000 WHERE item_id = 1 AND qty > 9000;
