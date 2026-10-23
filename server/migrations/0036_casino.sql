-- The Casino, K1 (ADR 0017): every round played, and breaks players take.
-- Coins only, never real money.

CREATE TABLE casino_rounds (
    id        bigserial PRIMARY KEY,
    player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game      text NOT NULL CHECK (game IN ('slots', 'roulette')),
    bet       integer NOT NULL CHECK (bet > 0),
    payout    integer NOT NULL CHECK (payout >= 0),
    -- What happened: the reels, or the number and what was bet on.
    outcome   jsonb NOT NULL,
    -- The client's key for this round: pressing twice plays once.
    key       text NOT NULL UNIQUE,
    at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX casino_rounds_today ON casino_rounds (player_id, at);

-- "Take a break": the casino stays closed to the player until then.
CREATE TABLE casino_breaks (
    player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    until     timestamptz NOT NULL
);
