-- M3 "Collect": accounts move to Postgres, the item catalogue, collections
-- (album), garden plots and home furniture.

CREATE TABLE magic_links (
    token_hash  text PRIMARY KEY, -- sha256 hex; raw tokens are never stored
    email       text NOT NULL,
    expires_at  timestamptz NOT NULL
);

-- Stable string keys for catalogue items, used by clients for art and by code.
ALTER TABLE items ADD COLUMN key text UNIQUE;

-- meta: sell/buy prices in coins; fish: weight (catch odds), night (only after
-- dark); seeds: grows (plant item); plants: seed (item returned sometimes).
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (1,   'coin',            'currency',  'Coin',             0, '{}'),
    (100, 'minnow',          'fish',      'Minnow',           0, '{"sell": 5,   "weight": 40}'),
    (101, 'perch',           'fish',      'Perch',            0, '{"sell": 12,  "weight": 25}'),
    (102, 'carp',            'fish',      'Carp',             1, '{"sell": 20,  "weight": 18}'),
    (103, 'bluegill',        'fish',      'Bluegill',         0, '{"sell": 15,  "weight": 20}'),
    (104, 'catfish',         'fish',      'Catfish',          1, '{"sell": 35,  "weight": 8, "night": true}'),
    (105, 'golden_koi',      'fish',      'Golden Koi',       3, '{"sell": 120, "weight": 2}'),
    (106, 'moonfish',        'fish',      'Moonfish',         2, '{"sell": 90,  "weight": 3, "night": true}'),
    (107, 'old_boot',        'junk',      'Old Boot',         0, '{"sell": 1,   "weight": 10}'),
    (200, 'tulip_seeds',     'seed',      'Tulip Seeds',      0, '{"buy": 10, "grows": 300}'),
    (201, 'sunflower_seeds', 'seed',      'Sunflower Seeds',  0, '{"buy": 15, "grows": 301}'),
    (202, 'lavender_seeds',  'seed',      'Lavender Seeds',   1, '{"buy": 20, "grows": 302}'),
    (203, 'strawberry_seeds','seed',      'Strawberry Seeds', 1, '{"buy": 25, "grows": 303}'),
    (300, 'tulip',           'plant',     'Tulip',            0, '{"sell": 18, "seed": 200}'),
    (301, 'sunflower',       'plant',     'Sunflower',        0, '{"sell": 26, "seed": 201}'),
    (302, 'lavender',        'plant',     'Lavender',         1, '{"sell": 34, "seed": 202}'),
    (303, 'strawberry',      'plant',     'Strawberries',     1, '{"sell": 44, "seed": 203}'),
    (400, 'wooden_chair',    'furniture', 'Wooden Chair',     0, '{"buy": 60,  "sell": 20}'),
    (401, 'small_table',     'furniture', 'Small Table',      0, '{"buy": 80,  "sell": 25}'),
    (402, 'floor_lamp',      'furniture', 'Floor Lamp',       0, '{"buy": 90,  "sell": 30}'),
    (403, 'potted_fern',     'furniture', 'Potted Fern',      0, '{"buy": 50,  "sell": 15}'),
    (404, 'round_rug',       'furniture', 'Round Rug',        0, '{"buy": 70,  "sell": 20}'),
    (405, 'bookshelf',       'furniture', 'Bookshelf',        1, '{"buy": 150, "sell": 50}'),
    (406, 'cozy_bed',        'furniture', 'Cozy Bed',         1, '{"buy": 200, "sell": 70}');
SELECT setval('items_id_seq', 1000);

-- The album (spec §8.2): first-of-kind finds and running totals.
CREATE TABLE collection (
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item_id    integer NOT NULL REFERENCES items(id),
    first_at   timestamptz NOT NULL DEFAULT now(),
    total      integer NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, item_id)
);

-- Garden plots keyed by "space" (a zone, or a player's home) and tile.
-- Replaces the placeholder garden_plots table from 0001.
DROP TABLE garden_plots;
CREATE TABLE plots (
    space             text NOT NULL, -- 'founders_park' or 'home:<player uuid>'
    x                 smallint NOT NULL,
    y                 smallint NOT NULL,
    owner_id          uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    plant_item_id     integer NOT NULL REFERENCES items(id),
    planted_at        timestamptz NOT NULL DEFAULT now(),
    stage             smallint NOT NULL DEFAULT 0,
    stage_started_at  timestamptz NOT NULL DEFAULT now(),
    watered           boolean NOT NULL DEFAULT false,
    PRIMARY KEY (space, x, y)
);

-- Furniture placed in a player's home (one object per tile).
CREATE TABLE home_objects (
    owner_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    x          smallint NOT NULL,
    y          smallint NOT NULL,
    item_id    integer NOT NULL REFERENCES items(id),
    placed_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_id, x, y)
);
