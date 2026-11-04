-- The fisherman's magnet: dropped in the pond instead of a line, it brings
-- up scrap (the salvage game), which he buys like fish.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (120, 'magnet', 'tool', 'Salvage Magnet', 3, '{"buy": 250}'),
    (121, 'rusty_can', 'scrap', 'Rusty Can', 0, '{"sell": 3, "weight": 520}'),
    (122, 'bike_chain', 'scrap', 'Bike Chain', 0, '{"sell": 4, "weight": 400}'),
    (123, 'old_key', 'scrap', 'Old Key', 1, '{"sell": 10, "weight": 240}'),
    (124, 'hubcap', 'scrap', 'Hubcap', 1, '{"sell": 14, "weight": 180}'),
    (125, 'pocket_watch', 'scrap', 'Pocket Watch', 2, '{"sell": 35, "weight": 90}'),
    (126, 'ship_anchor', 'scrap', 'Little Anchor', 3, '{"sell": 80, "weight": 40}'),
    (127, 'old_safe', 'scrap', 'Old Safe', 4, '{"sell": 220, "weight": 12}'),
    (128, 'meteorite', 'scrap', 'Meteorite', 5, '{"sell": 600, "weight": 2}');
