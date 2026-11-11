-- Friends drop by: by default, your friends can visit your home any time
-- (through your door, or from the friends list), no invitation needed. Off,
-- it's as before: close friends, and friends you've invited.
ALTER TABLE players ADD COLUMN friends_drop_in boolean NOT NULL DEFAULT true;

-- A rented house comes with a picket fence out front, yours and put up (so a
-- house that's lived in shows it). Those already living in a house, with no
-- fence up, get theirs now.
INSERT INTO economy_ledger (player_id, item_id, delta, reason, idempotency_key)
SELECT DISTINCT l.player_id, 845, 1, 'default_fence', 'default_fence:' || l.player_id || '#0'
FROM leases l
WHERE l.kind = 'home' AND l.state <> 'ended' AND l.player_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM home_exterior e WHERE e.owner = l.player_id AND e.slot = 'fence')
  AND NOT EXISTS (SELECT 1 FROM inventory i WHERE i.player_id = l.player_id AND i.item_id = 845 AND i.qty > 0)
ON CONFLICT DO NOTHING;
INSERT INTO inventory (player_id, item_id, qty)
SELECT DISTINCT l.player_id, 845, 1
FROM leases l
WHERE l.kind = 'home' AND l.state <> 'ended' AND l.player_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM home_exterior e WHERE e.owner = l.player_id AND e.slot = 'fence')
ON CONFLICT (player_id, item_id) DO UPDATE SET qty = GREATEST(inventory.qty, 1);
INSERT INTO home_exterior (owner, slot, item_id)
SELECT DISTINCT l.player_id, 'fence', 845
FROM leases l
WHERE l.kind = 'home' AND l.state <> 'ended' AND l.player_id IS NOT NULL
ON CONFLICT (owner, slot) DO NOTHING;
