# ADR 0012: The Library

Status: accepted · 2026-10-22

The Library block holds every book in Project Gutenberg, all languages,
each one standing on a shelf as its own spine: about 78,000 texts in some
sixty languages. It is laid out like a real library: a grand entrance hall with
the circulation and catalogue desk and a reading room, and wings off it
shelved by the Library of Congress classification, the way research
libraries shelve. Pick a book off the shelf (or find it at the catalogue
desk), and read it in the game. Reading is meant to be done together:
sitting at the reading-room tables, in nooks, seeing what others are
reading.

## The books

- **Catalogue:** Gutenberg's own machine-readable catalogue
  (`https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv`, updated
  daily) imported into Postgres (`books`): number, title, authors,
  language(s), subjects, LoC class, bookshelves, date issued. Texts only
  (the 1,100 audio books may get a listening corner later). An importer
  (`library-import`) runs weekly; it is a few tens of megabytes.
- **Text:** fetched only when someone opens a book, by our server, never
  the player's browser (Gutenberg's site is for people, not bulk
  fetching, and doesn't allow cross-site requests). Politely: one fetch
  per book at a time, rate-limited, a proper User-Agent; then cleaned
  (Gutenberg's header and footer, between the `*** START OF` and
  `*** END OF` lines, are taken off, so the texts are plain public domain
  and carry no trademark), cut into pages at paragraph breaks and cached.
  If the library gets busy, the fetcher moves to a Gutenberg mirror.
- **Credit:** "From the collection of Project Gutenberg" on the reader;
  nothing else uses their name.
- **Care:** a few titles are still in copyright in some countries (a
  small list, hidden there); old books use old language, so under-16s
  see curated shelves first (L4).

## The building

The entrance hall is its own zone (`library`), entered from the Library
block. Each wing is a zone too, through a doorway off the hall, with a
sign over it. A wing is rows of bookcases facing south, an aisle in front
of each, the range of call numbers on a sign at each row's end, as in
real stacks; reading tables or carrels along the windows.

| Wing (zone) | Shelved | Books today |
|---|---|---|
| Literature (`library_lit`) | English literature: P (PR British, PS American, PN, PQ, PT, PA…) | 25,802 |
| World Languages (`library_world`) | every other language, by language, then class | 16,374 |
| History & Geography (`library_history`) | C, D, E, F, G | 11,526 |
| Children's Library (`library_children`) | English juvenile fiction (any PZ): painted shelves, a rug, a story circle | 7,518 |
| Philosophy, Religion & Society (`library_society`) | B, H, J, K, L | 6,699 |
| Science & Technology (`library_science`) | Q, R, S, T, U, V | 5,651 |
| Periodicals & Reference (`library_reference`) | A, Z and the unclassified | 3,369 |
| Arts & Music (`library_arts`) | M, N | 1,444 |

The hall: the circulation and catalogue desk with the librarian; the
**Reading Room** (long tables, green lamps; chat there stays there); the
**New Arrivals** case for books added since the last re-shelving.

## Decisions

| Question | Decision |
|---|---|
| Every book a spine | Yes. A bookcase is two tiles wide with five shelves of twenty: a hundred books. Spines are drawn into the bookcase's art (colour, height and the odd gold band from a hash), not as objects, so a wing costs what its floor costs. |
| Where a book is | Its wing and its place in the wing's **shelf list** (`books.wing`, `books.shelf_index`): sorted by class, then author, then title, like call numbers. Bookcase *n* holds places 100n to 100n + 99. |
| New books | Join **New Arrivals** in the hall; a **re-shelving** (run by hand, a few times a year) files them into the wings. Nothing moves in between. |
| Wing sizes | `commons_sim::library::WINGS` (rows, bookcases per row), about a third to spare; the maps are generated from it, and re-shelving refuses to overfill a wing. |
| Titles | Too small on a spine: a wing loads its shelf list a bookcase at a time as you walk up (`/api/library/case`), and the row-end signs show the range ("PR · Austen – Brontë"). Tap a spine for the book's card. |
| Finding a book | The catalogue desk searches the whole collection (title, author, subject; filter by language). "Show me" walks you to the bookcase and the spine glows. |
| Languages | All. World Languages is shelved by language (French, Finnish, German, Dutch, Italian, Spanish, Hungarian, Portuguese, Chinese, then the rest A–Z), then by class. |

## Milestones

| Step | What | Playable because |
|---|---|---|
| **L1** ✓ | Catalogue import, the shelf list, search; the hall and all eight wings with every book a spine; tap a spine for its card; the catalogue desk with "Show me". | Browse the whole collection. |
| **L2** ✓ | Reading: fetch, clean, page and cache texts; the reader; your place kept per book; "continue reading". | Read any book. |
| **L3** | Together: what someone's reading on their name tag (tap to open the same book), books pulled slightly out where they're being read, reading nooks and the reading room's quiet. | Reading near people. |
| **L4** | A book club board, recommending a book as a doorstep gift, curated shelves for under-16s, per-country hiding, re-shelving with an announcement. | Care and community. |
