-- Clubs C3 (ADR 0014): club events open to everyone, and the weekly club
-- awards. Clubhouses on the city's club lots are leases too (kind
-- `club_room`, tier 3, plot `lot:<bx>_<by>`): no new table.

-- An event a club holds for everyone, at a public place in the city.
CREATE TABLE club_events (
    id         bigserial PRIMARY KEY,
    club_id    uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    title      text NOT NULL,
    -- A spot in the city (`stage`, `arena`, or the club's own `lot:…`).
    place      text NOT NULL,
    starts_at  timestamptz NOT NULL,
    ends_at    timestamptz NOT NULL CHECK (ends_at > starts_at),
    created_by uuid REFERENCES players(id) ON DELETE SET NULL,
    cancelled  boolean NOT NULL DEFAULT false,
    started    boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX club_events_upcoming ON club_events (ends_at) WHERE NOT cancelled;

-- Who's going (anyone can be), and whether they've been reminded.
CREATE TABLE club_event_rsvps (
    event_id  bigint NOT NULL REFERENCES club_events(id) ON DELETE CASCADE,
    player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    reminded  boolean NOT NULL DEFAULT false,
    at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, player_id)
);

-- The clubs of each week (top three by club points), paid once.
CREATE TABLE club_week_awards (
    week    date NOT NULL,
    club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    rank    smallint NOT NULL CHECK (rank BETWEEN 1 AND 3),
    points  integer NOT NULL,
    coins   integer NOT NULL,
    PRIMARY KEY (week, club_id),
    UNIQUE (week, rank)
);
