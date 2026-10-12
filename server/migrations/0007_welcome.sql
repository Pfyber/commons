-- The founding experience (spec §11): the Caretaker's first three tasks, the
-- founders and their named seedlings in the Founders' Grove.

-- Firsts that only a zone server sees (e.g. 'sat_together': shared a bench
-- or played a game with someone).
CREATE TABLE player_marks (
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    mark       text NOT NULL,
    at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, mark)
);

-- Founders: everyone who finished the first three tasks during the founding
-- season. Each has a seedling with their name in grove slot `slot`; it grows
-- over real months. `no` is the founder number shown on the badge.
CREATE TABLE founders (
    player_id   uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    no          integer NOT NULL UNIQUE,
    slot        integer NOT NULL UNIQUE,
    name        text NOT NULL,
    planted_at  timestamptz NOT NULL DEFAULT now()
);

-- A keepsake for every founder.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (407, 'founders_lantern', 'furniture', 'Founder''s Lantern', 3, '{}');
