-- The rarest catches are the prize: a dragonfish (mythical) fetches 100
-- coins but hardly ever bites (about 1 bite in 1,500); a golden koi
-- (legendary) 10; everything else stays under that.
UPDATE items SET meta = meta || '{"sell": 100, "weight": 1}'::jsonb WHERE id = 111; -- Dragonfish
UPDATE items SET meta = meta || '{"sell": 10}'::jsonb WHERE id = 105;               -- Golden Koi
