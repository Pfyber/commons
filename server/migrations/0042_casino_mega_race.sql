-- The Casino: the big machine (twenty symbols) and the horse races join the games.
ALTER TABLE casino_rounds DROP CONSTRAINT casino_rounds_game_check;
ALTER TABLE casino_rounds ADD CONSTRAINT casino_rounds_game_check
    CHECK (game IN ('slots', 'roulette', 'blackjack', 'mega', 'race'));
