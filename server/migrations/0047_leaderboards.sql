-- The leaderboards: tallies the economy doesn't keep (gladiator matches
-- won, paintball matches won), counted by the zones as they happen. (The
-- richest are their coins; the anglers, their catches in the ledger.)
CREATE TABLE player_stats (
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    stat       text NOT NULL,
    value      bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, stat)
);
CREATE INDEX player_stats_board ON player_stats (stat, value DESC);
