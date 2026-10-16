-- Renting (ADR 0010, C4): everything players hold in the city is leased,
-- never bought. A lease is on one plot (a house lot, an apartment or a
-- market stall), paid in coins each period, with a grace period before it
-- ends. Ending a lease never loses anything: furniture and stall goods go
-- back to the player's bag.
CREATE TABLE leases (
    id            bigserial PRIMARY KEY,
    kind          text NOT NULL CHECK (kind IN ('home', 'apartment', 'stall')),
    -- A house and an apartment are both "a home": one of them at a time.
    slot          text GENERATED ALWAYS AS (CASE WHEN kind = 'stall' THEN 'stall' ELSE 'home' END) STORED,
    plot          text NOT NULL,             -- 'b0_3:5', 'apt:2', 'stall:4'
    player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    tier          smallint NOT NULL,
    periods_paid  integer NOT NULL DEFAULT 0,
    started_at    timestamptz NOT NULL DEFAULT now(),
    paid_until    timestamptz NOT NULL,
    grace_until   timestamptz,
    state         text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'grace', 'ended')),
    ended_at      timestamptz,
    end_reason    text
);
CREATE UNIQUE INDEX leases_plot_open ON leases (plot) WHERE state <> 'ended';
CREATE UNIQUE INDEX leases_player_slot_open ON leases (player_id, slot) WHERE state <> 'ended';
CREATE INDEX leases_due ON leases (paid_until) WHERE state <> 'ended';

-- One row per period paid (the ledger has the coins; this is the history).
CREATE TABLE rent_charges (
    lease_id  bigint NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
    period    integer NOT NULL,
    amount    integer NOT NULL,
    at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lease_id, period)
);

-- Goods on a stall: taken out of the seller's bag while listed.
CREATE TABLE stall_listings (
    id          bigserial PRIMARY KEY,
    lease_id    bigint NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
    item_id     integer NOT NULL REFERENCES items(id),
    qty         integer NOT NULL CHECK (qty > 0),
    price       integer NOT NULL CHECK (price BETWEEN 1 AND 9999),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stall_listings_lease ON stall_listings (lease_id);

-- C3's free houses become first-tier leases, with the first week on the house.
INSERT INTO leases (kind, plot, player_id, tier, paid_until, started_at)
SELECT 'home', lot, player_id, 1, now() + interval '7 days', since FROM home_lots;
DROP TABLE home_lots;
