-- The fisherman's legendary lure: its circle of water turns gold for three
-- minutes and nothing below epic bites there. The glimmer lure goes up to
-- 100 coins.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (119, 'gold_lure', 'tool', 'Legendary Lure', 4, '{"buy": 1000}');
UPDATE items SET meta = jsonb_set(meta, '{buy}', '100') WHERE id = 117;
