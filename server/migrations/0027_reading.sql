-- Reading in the Library (ADR 0012, L2). A book's text is fetched from
-- Gutenberg the first time someone opens it, cleaned (Gutenberg's header and
-- footer off), cut into pages at paragraph breaks and kept here; `missing`
-- marks a book whose text couldn't be found, so it isn't asked for again.
CREATE TABLE book_texts (
    book_id    integer PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    status     text NOT NULL,                  -- 'ok' or 'missing'
    pages      integer NOT NULL DEFAULT 0,
    chars      integer NOT NULL DEFAULT 0,
    -- Chapters and the like: [{"page": 3, "title": "CHAPTER I."}, …]
    contents   jsonb NOT NULL DEFAULT '[]',
    -- How it was cleaned and paged (`reading::TEXT_VERSION`): older texts
    -- are fetched and paged again when next opened.
    version    integer NOT NULL DEFAULT 0,
    fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE book_pages (
    book_id integer NOT NULL REFERENCES book_texts(book_id) ON DELETE CASCADE,
    page    integer NOT NULL,
    -- Paragraphs separated by a blank line; line breaks kept in verse.
    body    text NOT NULL,
    PRIMARY KEY (book_id, page)
);

-- Where each player is in each book they've opened.
CREATE TABLE reading (
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    book_id    integer NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page       integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, book_id)
);
CREATE INDEX reading_recent ON reading (player_id, updated_at DESC);
