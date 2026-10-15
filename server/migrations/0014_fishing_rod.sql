-- The fisherman's upgraded rod: fish bite a quarter sooner, the reel game's
-- needle swings a little slower and once more before the fish gets away.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (112, 'pro_rod', 'tool', 'Angler''s Rod', 3, '{"buy": 120}');

-- And for everyone: rarer fish bite a touch more often (commons a touch less).
UPDATE items SET meta = items.meta || v.meta
FROM (VALUES
    (107, '{"weight": 75}'::jsonb),  -- Old Boot
    (100, '{"weight": 310}'::jsonb), -- Minnow
    (103, '{"weight": 205}'::jsonb), -- Bluegill
    (101, '{"weight": 185}'::jsonb), -- Perch
    (102, '{"weight": 175}'::jsonb), -- Carp
    (108, '{"weight": 155}'::jsonb), -- Rainbow Trout
    (104, '{"weight": 120}'::jsonb), -- Catfish (night)
    (109, '{"weight": 110}'::jsonb), -- Pike
    (110, '{"weight": 62}'::jsonb),  -- Sturgeon
    (106, '{"weight": 56}'::jsonb),  -- Moonfish (night)
    (105, '{"weight": 23}'::jsonb)   -- Golden Koi
) AS v(id, meta)
WHERE items.id = v.id;
