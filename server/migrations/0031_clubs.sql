-- Clubs (ADR 0014, C1): a name, a crest and a colour, members with roles,
-- a board, and a treasury the members donate to, which pays the rent on the
-- club's room in the Club Hall (a lease like a home's, kind `club_room`).
CREATE TABLE clubs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    crest      text NOT NULL,
    color      text NOT NULL,
    -- Coins the club holds (only ever spent on its rent).
    treasury   integer NOT NULL DEFAULT 0 CHECK (treasury >= 0),
    founded_by uuid REFERENCES players(id) ON DELETE SET NULL,
    founded_at timestamptz NOT NULL DEFAULT now(),
    closed_at  timestamptz
);
CREATE UNIQUE INDEX clubs_name_open ON clubs (lower(name)) WHERE closed_at IS NULL;

CREATE TABLE club_members (
    club_id   uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    role      text NOT NULL CHECK (role IN ('owner', 'mod', 'member')),
    -- The club whose crest this player shows by their name.
    badge     boolean NOT NULL DEFAULT false,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (club_id, player_id)
);
CREATE INDEX club_members_player ON club_members (player_id);
CREATE UNIQUE INDEX club_members_one_badge ON club_members (player_id) WHERE badge;

CREATE TABLE club_invites (
    club_id    uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    invited_by uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (club_id, player_id)
);

CREATE TABLE club_posts (
    id        bigserial PRIMARY KEY,
    club_id   uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    author_id uuid REFERENCES players(id) ON DELETE SET NULL,
    text      text NOT NULL,
    at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX club_posts_recent ON club_posts (club_id, at DESC);

-- Every coin into and out of a treasury: donations (+) and rent (-).
CREATE TABLE club_treasury_ledger (
    id        bigserial PRIMARY KEY,
    club_id   uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    player_id uuid REFERENCES players(id) ON DELETE SET NULL,
    delta     integer NOT NULL,
    reason    text NOT NULL,
    key       text NOT NULL UNIQUE,
    at        timestamptz NOT NULL DEFAULT now()
);

-- Club rooms are leases too: held for a club (paid from its treasury), in
-- the leaseholder's "club" slot (one club room per leaseholder).
ALTER TABLE leases ADD COLUMN club_id uuid REFERENCES clubs(id) ON DELETE CASCADE;
ALTER TABLE leases DROP CONSTRAINT leases_kind_check;
ALTER TABLE leases ADD CONSTRAINT leases_kind_check CHECK (kind IN ('home', 'apartment', 'stall', 'club_room'));
DROP INDEX leases_player_slot_open;
ALTER TABLE leases DROP COLUMN slot;
ALTER TABLE leases ADD COLUMN slot text GENERATED ALWAYS AS (
    CASE kind WHEN 'stall' THEN 'stall' WHEN 'club_room' THEN 'club' ELSE 'home' END
) STORED;
CREATE UNIQUE INDEX leases_player_slot_open ON leases (player_id, slot) WHERE state <> 'ended';
CREATE UNIQUE INDEX leases_club_open ON leases (club_id) WHERE state <> 'ended' AND club_id IS NOT NULL;
