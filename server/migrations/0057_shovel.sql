-- The pond is plain water with soft corners now, and a shovel digs up what's in a yard.
UPDATE items SET name = 'Garden Pond' WHERE key = 'round_pond';
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (1205, 'shovel', 'tool', 'Shovel', 0, '{"buy":150,"sell":50,"market":true}');
