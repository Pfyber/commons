-- The mall's weekly rotation (ADR 0011, M3): limited items have a stock per
-- rotation; a row is made on the first purchase and counts down. What's on
-- show is computed, not stored.
CREATE TABLE mall_stock (
    rotation   bigint NOT NULL,
    dept       text NOT NULL,
    item_id    integer NOT NULL REFERENCES items(id),
    remaining  integer NOT NULL CHECK (remaining >= 0),
    PRIMARY KEY (rotation, dept, item_id)
);

-- New pieces: two for the furniture rotation, the rest for the seasonal
-- pop-up (one season at a time).
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (416, 'rocking_chair',     'furniture', 'Rocking Chair',     1, '{"sell": 35, "source": "npc"}'),
    (417, 'grandfather_clock', 'furniture', 'Grandfather Clock', 2, '{"sell": 80, "source": "npc"}'),
    (418, 'pumpkin_lantern',   'furniture', 'Pumpkin Lantern',   1, '{"sell": 15, "source": "npc", "season": "autumn_harvest"}'),
    (419, 'harvest_basket',    'furniture', 'Harvest Basket',    1, '{"sell": 12, "source": "npc", "season": "autumn_harvest"}'),
    (420, 'scarecrow',         'furniture', 'Scarecrow',         2, '{"sell": 40, "source": "npc", "season": "autumn_harvest"}'),
    (421, 'string_lights',     'furniture', 'String Lights',     1, '{"sell": 18, "source": "npc", "season": "winter_lights"}'),
    (422, 'snow_globe',        'furniture', 'Snow Globe',        2, '{"sell": 30, "source": "npc", "season": "winter_lights"}'),
    (423, 'blossom_pot',       'furniture', 'Blossom Pot',       1, '{"sell": 20, "source": "npc", "season": "spring_blossom"}'),
    (424, 'birdhouse',         'furniture', 'Birdhouse',         2, '{"sell": 22, "source": "npc", "season": "spring_blossom"}'),
    (425, 'picnic_set',        'furniture', 'Picnic Set',        1, '{"sell": 25, "source": "npc", "season": "summer_fair"}'),
    (426, 'beach_umbrella',    'furniture', 'Beach Umbrella',    2, '{"sell": 35, "source": "npc", "season": "summer_fair"}')
ON CONFLICT (id) DO NOTHING;
