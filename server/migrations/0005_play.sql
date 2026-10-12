-- Corner activities that keep state: the shared easels and their gallery,
-- and the town's daily word puzzle.

-- Three shared easels in the art corner: 16×16 cells, one palette index per
-- byte (0 = blank). Shared by every instance of the park.
CREATE TABLE easels (
    id          smallint PRIMARY KEY,
    cells       bytea NOT NULL CHECK (length(cells) = 256),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO easels (id, cells) VALUES
    (0, decode(repeat('00', 256), 'hex')),
    (1, decode(repeat('00', 256), 'hex')),
    (2, decode(repeat('00', 256), 'hex'));

-- Who has painted on an easel since it was last hung (they're credited).
CREATE TABLE easel_painters (
    easel       smallint NOT NULL REFERENCES easels(id) ON DELETE CASCADE,
    player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    name        text NOT NULL,
    PRIMARY KEY (easel, player_id)
);

-- Finished paintings, hung in the gallery with everyone who painted them.
CREATE TABLE gallery (
    id          bigserial PRIMARY KEY,
    title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 40),
    cells       bytea NOT NULL CHECK (length(cells) = 256),
    painters    text[] NOT NULL,
    hung_by     text NOT NULL,
    hidden      boolean NOT NULL DEFAULT false,
    hung_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gallery_recent ON gallery (hung_at DESC);

-- The town word: one five-letter word a day that everyone solves together.
CREATE TABLE word_guesses (
    day         date NOT NULL,
    player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    name        text NOT NULL,
    guess       text NOT NULL CHECK (guess ~ '^[a-z]{5}$'),
    at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX word_guesses_day ON word_guesses (day, at);
