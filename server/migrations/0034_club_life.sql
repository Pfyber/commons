-- Clubs C2 (ADR 0014): a weekly meetup, club goals, and decorating the
-- club room together.

-- The club's weekly meetup: a weekday (0 Monday … 6 Sunday) and a minute of
-- the day, both UTC (clients show it in local time). Null: no meetup set.
ALTER TABLE clubs
    ADD COLUMN meetup_dow    smallint CHECK (meetup_dow BETWEEN 0 AND 6),
    ADD COLUMN meetup_minute smallint CHECK (meetup_minute BETWEEN 0 AND 1439);

-- Each meetup's reminder and start notice, sent once.
CREATE TABLE club_meetup_runs (
    club_id   uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    reminded  boolean NOT NULL DEFAULT false,
    started   boolean NOT NULL DEFAULT false,
    PRIMARY KEY (club_id, starts_at)
);

-- Who came to a meetup, for how long, and whether they've had the reward.
CREATE TABLE club_meetup_visits (
    club_id   uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    minutes   integer NOT NULL DEFAULT 0,
    rewarded  boolean NOT NULL DEFAULT false,
    PRIMARY KEY (club_id, starts_at, player_id)
);

-- Minutes members spent in the club room, by week (starting Monday, UTC).
CREATE TABLE club_room_minutes (
    club_id   uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    week      date NOT NULL,
    player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    minutes   integer NOT NULL DEFAULT 0,
    PRIMARY KEY (club_id, week, player_id)
);

-- The week's goals a club has reached (each pays the treasury once).
CREATE TABLE club_goals_done (
    club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    week    date NOT NULL,
    goal    text NOT NULL,
    at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (club_id, week, goal)
);

-- Furniture in a club room, one piece per tile. It stays the placer's: it
-- goes back to their bag if they pick it up, leave the club, or the room is
-- given up.
CREATE TABLE club_objects (
    club_id   uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    x         smallint NOT NULL,
    y         smallint NOT NULL,
    item_id   integer NOT NULL REFERENCES items(id),
    placed_by uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    placed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (club_id, x, y)
);
CREATE INDEX club_objects_placer ON club_objects (club_id, placed_by);
