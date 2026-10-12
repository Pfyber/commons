-- Town life for a quiet launch: topic quarters (starting as corners of the
-- founders' park) with boards, and town goals everyone funds together.
-- Daily notice-board requests need no table: their completion is recorded by
-- economy idempotency keys.

-- Topic quarters (spec §9). The first ones are founded by the Caretakers as
-- corners of the park; later ones go through proposals.
CREATE TABLE quarters (
    slug        text PRIMARY KEY,
    name        text NOT NULL,
    blurb       text NOT NULL,
    icon        text NOT NULL,
    sort        smallint NOT NULL DEFAULT 0
);

INSERT INTO quarters (slug, name, blurb, icon, sort) VALUES
    ('sports', 'Sports Corner', 'Matches, training, races and the people who love them.', '⚽', 1),
    ('art',    'Art Corner',    'Drawing, pixel art, photos and things people make.',     '🎨', 2),
    ('music',  'Music Corner',  'Songs, instruments, playlists and open-mic nights.',     '🎵', 3),
    ('games',  'Games Corner',  'Video games, board games, puzzles and tech talk.',        '🕹️', 4);

-- Players can belong to as many quarters as they like.
CREATE TABLE quarter_members (
    quarter     text NOT NULL REFERENCES quarters(slug) ON DELETE CASCADE,
    player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    joined_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (quarter, player_id)
);
CREATE INDEX quarter_members_player ON quarter_members (player_id);

-- Each quarter's board: short posts with up to three tags. Busy tags are how
-- niche streets ("alleys") get noticed.
CREATE TABLE board_posts (
    id          bigserial PRIMARY KEY,
    quarter     text NOT NULL REFERENCES quarters(slug) ON DELETE CASCADE,
    author_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    author_name text NOT NULL,
    body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
    tags        text[] NOT NULL DEFAULT '{}',
    hidden      boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX board_posts_quarter ON board_posts (quarter, created_at DESC);
CREATE INDEX board_posts_author ON board_posts (author_id, created_at DESC);

-- Town goals, opened one after another: the whole town donates coins and
-- something changes in the park when one is reached.
CREATE TABLE town_goals (
    id          serial PRIMARY KEY,
    key         text NOT NULL UNIQUE,
    title       text NOT NULL,
    blurb       text NOT NULL,
    target      integer NOT NULL CHECK (target > 0),
    raised      integer NOT NULL DEFAULT 0 CHECK (raised >= 0),
    seq         smallint NOT NULL UNIQUE,
    done_at     timestamptz
);

INSERT INTO town_goals (key, title, blurb, target, seq) VALUES
    ('fountain_lights', 'Light up the fountain', 'Lanterns around the fountain, glowing every evening.', 2000, 1),
    ('flower_meadow',   'Plant a flower meadow', 'Wildflowers all along the park paths.',                 5000, 2),
    ('fireworks',       'Fireworks night',       'A night of fireworks over the pond for everyone.',     10000, 3);

CREATE TABLE goal_donations (
    goal_id     integer NOT NULL REFERENCES town_goals(id) ON DELETE CASCADE,
    player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    amount      integer NOT NULL CHECK (amount > 0),
    at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goal_donations_goal ON goal_donations (goal_id, player_id);
