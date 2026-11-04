-- The fisherman's daily order (every 20 hours): how many of each fish he
-- asked for each angler has handed in, period by period. (What he asks for
-- is drawn from the angler and the period: nothing to store.)
CREATE TABLE fish_quests (
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    period     bigint NOT NULL,
    item_id    integer NOT NULL REFERENCES items(id),
    delivered  integer NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, period, item_id)
);
