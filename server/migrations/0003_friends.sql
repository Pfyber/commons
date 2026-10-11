-- M4 "Friends": requests, friendship points, blocks, direct messages,
-- doorstep gifts and notifications.

-- Friendship levels (spec §8.1): 1 friend, 2 close friend (earned through
-- points: gifts and time together). Level 0 "acquainted" is reserved.
ALTER TABLE friendships ADD COLUMN points integer NOT NULL DEFAULT 0;
ALTER TABLE friendships ALTER COLUMN level SET DEFAULT 1;

CREATE TABLE friend_requests (
    from_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    to_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (from_id, to_id),
    CHECK (from_id <> to_id)
);
CREATE INDEX friend_requests_to ON friend_requests (to_id);

-- Blocking is always available (spec §12): no requests, messages or visits.
CREATE TABLE blocks (
    blocker     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    blocked     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker, blocked)
);

CREATE TABLE direct_messages (
    id       bigserial PRIMARY KEY,
    from_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    to_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    body     text NOT NULL,
    sent_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX direct_messages_pair ON direct_messages (LEAST(from_id, to_id), GREATEST(from_id, to_id), id);

-- Gifts wait on the recipient's doorstep until opened (spec §8.1). The item
-- leaves the sender's inventory when sent and joins the recipient's when opened.
CREATE TABLE gifts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    to_id      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item_id    integer NOT NULL REFERENCES items(id),
    qty        integer NOT NULL CHECK (qty > 0),
    note       text NOT NULL DEFAULT '',
    sent_at    timestamptz NOT NULL DEFAULT now(),
    opened_at  timestamptz
);
CREATE INDEX gifts_unopened ON gifts (to_id) WHERE opened_at IS NULL;

CREATE TABLE notifications (
    id          bigserial PRIMARY KEY,
    player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    kind        text NOT NULL, -- friend_request | friend_accepted | gift | home_invite | close_friend
    body        jsonb NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    read_at     timestamptz
);
CREATE INDEX notifications_unread ON notifications (player_id, id) WHERE read_at IS NULL;
