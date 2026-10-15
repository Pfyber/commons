-- Rarer fish bite a little more often than before (commons are still the
-- most likely by far; the dragonfish stays a once-in-a-long-while prize).
UPDATE items SET meta = items.meta || v.meta
FROM (VALUES
    (107, '{"weight": 80}'::jsonb),  -- Old Boot
    (100, '{"weight": 330}'::jsonb), -- Minnow
    (103, '{"weight": 220}'::jsonb), -- Bluegill
    (101, '{"weight": 200}'::jsonb), -- Perch
    (102, '{"weight": 160}'::jsonb), -- Carp
    (108, '{"weight": 140}'::jsonb), -- Rainbow Trout
    (104, '{"weight": 110}'::jsonb), -- Catfish (night)
    (109, '{"weight": 100}'::jsonb), -- Pike
    (110, '{"weight": 55}'::jsonb),  -- Sturgeon
    (106, '{"weight": 50}'::jsonb),  -- Moonfish (night)
    (105, '{"weight": 20}'::jsonb)   -- Golden Koi
) AS v(id, meta)
WHERE items.id = v.id;
