-- Fish by rarity, 0 common, 1 uncommon, 2 rare, 3 epic, 4 legendary,
-- 5 mythical: common ones bite often, rare ones seldom (and are harder to
-- reel in). The fisherman on the pier (or the market) pays 1–10 coins, the
-- rarer the more. Weights are catch odds, relative to each other.
UPDATE items SET rarity = v.rarity, meta = items.meta || v.meta
FROM (VALUES
    (107, 0, '{"sell": 1,  "weight": 100}'::jsonb), -- Old Boot (junk)
    (100, 0, '{"sell": 1,  "weight": 400}'::jsonb), -- Minnow
    (103, 0, '{"sell": 2,  "weight": 250}'::jsonb), -- Bluegill
    (101, 0, '{"sell": 2,  "weight": 220}'::jsonb), -- Perch
    (102, 1, '{"sell": 3,  "weight": 150}'::jsonb), -- Carp
    (104, 2, '{"sell": 5,  "weight": 80}'::jsonb),  -- Catfish (at night)
    (106, 3, '{"sell": 8,  "weight": 35}'::jsonb),  -- Moonfish (at night)
    (105, 4, '{"sell": 9,  "weight": 15}'::jsonb)   -- Golden Koi
) AS v(id, rarity, meta)
WHERE items.id = v.id;

INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (108, 'rainbow_trout', 'fish', 'Rainbow Trout', 1, '{"sell": 4,  "weight": 120}'),
    (109, 'pike',          'fish', 'Pike',          2, '{"sell": 6,  "weight": 70}'),
    (110, 'sturgeon',      'fish', 'Sturgeon',      3, '{"sell": 7,  "weight": 40}'),
    (111, 'dragonfish',    'fish', 'Dragonfish',    5, '{"sell": 10, "weight": 4}');
