-- Vehicles (ADR 0011, M6): a speed-up anywhere outdoors in the city, off at
-- every door. `code` is what the zone draws and how fast it goes (the speeds
-- live in commons_sim::vehicles; `speed` here is the same, for reading).
-- Bought once and kept: account-bound.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (700, 'roller_skates', 'vehicle', 'Roller Skates', 0, '{"code": 1, "speed": 1.3, "account_bound": true, "source": "npc"}'),
    (701, 'kick_scooter',  'vehicle', 'Kick Scooter',  0, '{"code": 2, "speed": 1.5, "account_bound": true, "source": "npc"}'),
    (702, 'city_bike',     'vehicle', 'City Bike',     1, '{"code": 3, "speed": 1.8, "account_bound": true, "source": "npc"}'),
    (703, 'vintage_bike',  'vehicle', 'Vintage Bike',  2, '{"code": 4, "speed": 1.8, "account_bound": true, "source": "npc"}')
ON CONFLICT (id) DO NOTHING;
