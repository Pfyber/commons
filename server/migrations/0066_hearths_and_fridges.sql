-- Fish food is free: the tanks' fish are fed from a pinch always to hand,
-- so the Market no longer sells it.
UPDATE items SET meta = meta - 'buy' - 'market' WHERE key = 'fish_food';

-- Fireplaces to buy and put where you like (homes no longer have one built
-- in): grey stone, and black obsidian with a green fire, alongside the red
-- brick one. A mini fridge for fish, and the Rotten Fish they turn into
-- after a week out of one.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (1328, 'fireplace_grey', 'furniture', 'Grey Stone Fireplace', 3, '{"buy":360,"sell":120,"use":"toggle","market":true}'),
    (1329, 'fireplace_obsidian', 'furniture', 'Obsidian Fireplace', 3, '{"buy":900,"sell":300,"use":"toggle","market":true}'),
    (1330, 'mini_fridge', 'furniture', 'Mini Fridge', 1, '{"buy":250,"sell":80,"market":true}'),
    (1331, 'rotten_fish', 'supply', 'Rotten Fish', 0, '{"sell":2}');

-- Each lot of fish in a bag, and when it came: a fish keeps a week (see
-- api::fridge). Spending fish uses the oldest first.
CREATE TABLE fish_lots (
    id         bigserial PRIMARY KEY,
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item_id    integer NOT NULL REFERENCES items(id),
    qty        integer NOT NULL CHECK (qty > 0),
    since      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fish_lots_player ON fish_lots (player_id, since);

-- What's in a player's mini fridges (fish keep there, never going off).
CREATE TABLE fridge_fish (
    owner_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item_id   integer NOT NULL REFERENCES items(id),
    qty       integer NOT NULL CHECK (qty >= 0),
    PRIMARY KEY (owner_id, item_id)
);
