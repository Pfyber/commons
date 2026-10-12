-- Messages in bottles: a short, kind, anonymous note thrown into the pond,
-- found later by someone else, who can send a warm thank-you back.

CREATE TABLE bottles (
    id          bigserial PRIMARY KEY,
    author_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    body        text NOT NULL CHECK (char_length(body) BETWEEN 2 AND 200),
    created_at  timestamptz NOT NULL DEFAULT now(),
    found_by    uuid REFERENCES players(id) ON DELETE SET NULL,
    found_at    timestamptz,
    thanked     boolean NOT NULL DEFAULT false,
    hidden      boolean NOT NULL DEFAULT false
);
CREATE INDEX bottles_adrift ON bottles (created_at) WHERE found_by IS NULL AND NOT hidden;
CREATE INDEX bottles_author ON bottles (author_id, created_at DESC);
CREATE INDEX bottles_finder ON bottles (found_by, found_at DESC);
