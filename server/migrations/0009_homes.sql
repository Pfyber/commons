-- Home lots in the city (ADR 0010, C3). A row is a lived-in house; lots
-- with no row are free. Lots are given free for now; C4 turns this into
-- leases with rent.
CREATE TABLE home_lots (
    lot        text PRIMARY KEY,           -- e.g. 'b0_3:5' (block, house)
    player_id  uuid NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
    since      timestamptz NOT NULL DEFAULT now()
);
