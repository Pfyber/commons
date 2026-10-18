-- Three more fish (a rare, an epic and a legendary), and legendary catches
-- are worth $50 to the fisherman now.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (114, 'bass',          'fish', 'Largemouth Bass', 2, '{"sell": 6,  "weight": 100}'),
    (115, 'electric_eel',  'fish', 'Electric Eel',    3, '{"sell": 8,  "weight": 48}'),
    (116, 'arowana',       'fish', 'Silver Arowana',  4, '{"sell": 50, "weight": 18}');
UPDATE items SET meta = meta || '{"sell": 50}'::jsonb WHERE id = 105; -- Golden Koi
