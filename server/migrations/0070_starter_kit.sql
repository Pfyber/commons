-- The starter kit now has a laptop and a skateboard (`economy::WELCOME`).
-- Everyone who joined before gets what they're missing: a skateboard if
-- they've none, a laptop if they've none in their bag or at home. Kept in
-- the ledger like any grant (its own reason, one entry each).
INSERT INTO economy_ledger (player_id, item_id, delta, reason, idempotency_key)
SELECT p.id, 704, 1, 'starter_kit', 'starter_kit:0070:' || p.id || '#skateboard'
FROM players p
WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.player_id = p.id AND i.item_id = 704 AND i.qty > 0);

INSERT INTO inventory (player_id, item_id, qty)
SELECT p.id, 704, 1
FROM players p
WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.player_id = p.id AND i.item_id = 704 AND i.qty > 0)
ON CONFLICT (player_id, item_id) DO UPDATE SET qty = 1;

INSERT INTO economy_ledger (player_id, item_id, delta, reason, idempotency_key)
SELECT p.id, 467, 1, 'starter_kit', 'starter_kit:0070:' || p.id || '#laptop'
FROM players p
WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.player_id = p.id AND i.item_id = 467 AND i.qty > 0)
  AND NOT EXISTS (SELECT 1 FROM home_objects h WHERE h.owner_id = p.id AND h.item_id = 467);

INSERT INTO inventory (player_id, item_id, qty)
SELECT p.id, 467, 1
FROM players p
WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.player_id = p.id AND i.item_id = 467 AND i.qty > 0)
  AND NOT EXISTS (SELECT 1 FROM home_objects h WHERE h.owner_id = p.id AND h.item_id = 467)
ON CONFLICT (player_id, item_id) DO UPDATE SET qty = 1;
