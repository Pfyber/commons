-- The Library (ADR 0012): Project Gutenberg's catalogue, every text in every
-- language, filled in by `library-import`. A book stands in its wing at
-- `shelf_index` in the wing's shelf list (bookcase n holds 100n..100n+99);
-- books added since the last re-shelving have none and stand on the New
-- Arrivals case in the hall.
CREATE TABLE books (
    id          integer PRIMARY KEY,          -- Gutenberg's ebook number
    title       text NOT NULL,
    authors     text NOT NULL DEFAULT '',     -- "Austen, Jane, 1775-1817; …"
    languages   text NOT NULL,                -- "en" or "en; fr"
    subjects    text NOT NULL DEFAULT '',
    locc        text NOT NULL DEFAULT '',     -- Library of Congress classes: "PR; PZ"
    bookshelves text NOT NULL DEFAULT '',
    issued      date,
    wing        text NOT NULL,
    shelf_index integer,
    added_at    timestamptz NOT NULL DEFAULT now(),
    search      tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', title), 'A')
        || setweight(to_tsvector('simple', authors), 'B')
        || setweight(to_tsvector('simple', subjects || ' ' || bookshelves), 'C')
    ) STORED
);

CREATE UNIQUE INDEX books_shelf ON books (wing, shelf_index);
CREATE INDEX books_arrivals ON books (id DESC) WHERE shelf_index IS NULL;
CREATE INDEX books_search ON books USING gin (search);
