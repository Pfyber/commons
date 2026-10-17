-- Pets (ADR 0011, M5): adopted at the mall's Pets shop, one per player, and
-- only with a house (a pet needs a garden). Where a pet lives is its owner's
-- house, so moving takes it along. `code` in the item's meta is what the
-- zone draws at a walker's heels: species in the low byte, coat above.
CREATE TABLE pets (
    owner       uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    item_id     integer NOT NULL REFERENCES items(id),
    name        text NOT NULL,
    adopted_at  timestamptz NOT NULL DEFAULT now(),
    walks       integer NOT NULL DEFAULT 0,
    -- The day (UTC) of the last walk that counted; one a day.
    last_walk   date,
    -- Out on a walk since (NULL: at home).
    out_since   timestamptz
);

INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (600, 'puppy_golden',  'pet', 'Golden Puppy',  0, '{"code": 257, "account_bound": true, "source": "npc"}'),
    (601, 'puppy_spotted', 'pet', 'Spotted Puppy', 0, '{"code": 513, "account_bound": true, "source": "npc"}'),
    (602, 'corgi',         'pet', 'Corgi',         2, '{"code": 769, "account_bound": true, "source": "npc"}'),
    (603, 'kitten_ginger', 'pet', 'Ginger Kitten', 0, '{"code": 258, "account_bound": true, "source": "npc"}'),
    (604, 'kitten_black',  'pet', 'Black Kitten',  0, '{"code": 514, "account_bound": true, "source": "npc"}'),
    (605, 'bunny',         'pet', 'Lop Bunny',     1, '{"code": 259, "account_bound": true, "source": "npc"}'),
    (606, 'duckling',      'pet', 'Duckling',      1, '{"code": 260, "account_bound": true, "source": "npc"}'),
    (607, 'hedgehog',      'pet', 'Hedgehog',      1, '{"code": 261, "account_bound": true, "source": "npc"}')
ON CONFLICT (id) DO NOTHING;
