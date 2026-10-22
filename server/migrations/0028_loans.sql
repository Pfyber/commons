-- Borrowing from the Library (ADR 0012, L3): take a book out on your library
-- card to read it anywhere. Up to five at a time, for three weeks (borrowing
-- it again renews it); while anyone has a book out, its place on the shelf
-- shows a gap. There are always more copies in the stacks, so nobody waits.
CREATE TABLE loans (
    player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    book_id     integer NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    borrowed_at timestamptz NOT NULL DEFAULT now(),
    due_at      timestamptz NOT NULL,
    PRIMARY KEY (player_id, book_id)
);
CREATE INDEX loans_book ON loans (book_id, due_at);
