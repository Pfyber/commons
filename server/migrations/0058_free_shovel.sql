-- Everyone has a shovel, free, from the start: it isn't sold or traded.
UPDATE items SET meta = '{"account_bound":true}' WHERE key = 'shovel';
INSERT INTO economy_ledger (player_id, item_id, delta, reason, idempotency_key)
SELECT p.id, 1205, 1, 'free_shovel', 'free_shovel:' || p.id FROM players p
WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.player_id = p.id AND i.item_id = 1205 AND i.qty > 0);
INSERT INTO inventory (player_id, item_id, qty)
SELECT p.id, 1205, 1 FROM players p
ON CONFLICT (player_id, item_id) DO UPDATE SET qty = GREATEST(inventory.qty, 1);
