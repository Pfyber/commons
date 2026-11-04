-- More to bring up with the magnet, in every rarity: the commons, a good few
-- uncommon things, and rare, epic, legendary and mythical finds. The rare
-- ones weigh about the same, so none's a needle in the haystack for his
-- magnet order.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (129, 'bent_fork', 'scrap', 'Bent Fork', 0, '{"sell": 3, "weight": 320}'),
    (130, 'bottle_cap', 'scrap', 'Bottle Cap', 0, '{"sell": 2, "weight": 340}'),
    (131, 'padlock', 'scrap', 'Rusted Padlock', 1, '{"sell": 12, "weight": 110}'),
    (132, 'horseshoe', 'scrap', 'Lucky Horseshoe', 1, '{"sell": 16, "weight": 100}'),
    (133, 'brass_bell', 'scrap', 'Brass Bell', 1, '{"sell": 13, "weight": 84}'),
    (134, 'brass_compass', 'scrap', 'Brass Compass', 2, '{"sell": 38, "weight": 65}'),
    (135, 'oil_lantern', 'scrap', 'Old Oil Lantern', 2, '{"sell": 42, "weight": 65}'),
    (136, 'diving_helmet', 'scrap', 'Diving Helmet', 3, '{"sell": 95, "weight": 25}'),
    (137, 'ship_wheel', 'scrap', 'Ship''s Wheel', 3, '{"sell": 110, "weight": 20}'),
    (138, 'gold_idol', 'scrap', 'Golden Idol', 4, '{"sell": 260, "weight": 6}'),
    (139, 'sunken_crown', 'scrap', 'Sunken Crown', 4, '{"sell": 300, "weight": 4}'),
    (140, 'sea_trident', 'scrap', 'Trident of the Deep', 5, '{"sell": 700, "weight": 1}'),
    (141, 'kraken_pearl', 'scrap', 'Kraken''s Pearl', 5, '{"sell": 750, "weight": 1}');
UPDATE items SET meta = jsonb_set(meta, '{weight}', '70') WHERE id = 125;
UPDATE items SET meta = jsonb_set(meta, '{weight}', '30') WHERE id = 126;
UPDATE items SET meta = jsonb_set(meta, '{weight}', '10') WHERE id = 127;
