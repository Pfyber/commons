-- The Casino, K2 (ADR 0017): shared tables. A bet on a table is recorded
-- when it's placed (the coins leave then) and settled when the round ends;
-- blackjack joins the games.
ALTER TABLE casino_rounds ADD COLUMN settled boolean NOT NULL DEFAULT true;
ALTER TABLE casino_rounds DROP CONSTRAINT casino_rounds_game_check;
ALTER TABLE casino_rounds ADD CONSTRAINT casino_rounds_game_check
    CHECK (game IN ('slots', 'roulette', 'blackjack'));
CREATE INDEX casino_rounds_unsettled ON casino_rounds (id) WHERE NOT settled;
