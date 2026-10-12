# ADR 0008: The founding experience and running for real

Status: accepted · 2026-10-12

Spec §11 describes the cold start: a Caretaker with three first tasks, a
founder badge and named seedling for first-season players, and gathering
hours. This ADR covers how those are built, and what launch needs to run.

## The Caretaker's three tasks

- **The tasks:** catch a fish, plant a seed, sit with someone. The first
  two are read from existing data: a fish in the album, and a `plant` entry
  in the economy ledger.
- **Sitting with someone** is only visible to the zone server. It's set when
  you sit on a seat right next to someone else's, or when a chess game
  starts. Playing the Park Elder counts, so a lone player at launch can
  still finish. The zone sends it with the minute's activity report
  (`sat_together`), and the API records it in `player_marks`.
- **The NPC** is client-only and clock-driven, like Biscuit: everyone sees
  the Caretaker in the same place without any messages. During a gathering
  the Caretaker waits at its spot.
- **The tracker:** a chip under the place name shows progress. The panel
  opens by itself on a player's first visit. Tasks are re-checked after a
  catch or a planting, and every 20 s while unfinished.

## Founders and the grove

- **A deviation from the spec:** the spec gives a seedling to every
  first-season player. We give it to those who **finish the three tasks**
  during the season. The tasks take about ten minutes and keep the grove
  for people who actually stayed.
- **The season closes** when the grove's 80 slots are full
  (`GROVE_SLOTS`, which mapgen asserts against the map) or on
  `COMMONS_FOUNDING_SEASON_END`. That makes "one of the first 80"
  something to tell friends about.
- **Slots** are `grove_slot` map objects, ordered from the Founders' Stone
  outwards. Planting takes an advisory lock, so founder numbers and slots
  stay dense.
- **Trees** grow by age: seedling, then sapling at 7 days, young tree at
  30 and grown at 90 (`COMMONS_GROVE_DAY_SECS` shortens a day for testing).
  The species comes from the founder number.
- **Founders get** a 🌱 by their name for everyone (from the public
  `/api/founders` list), their name on the Founders' Stone, and a Founder's
  Lantern for their home.

## Gathering hours

- **Times:** an evening at the fountain daily at 18:00 UTC, and chess night
  on Thursdays at 18:30 UTC.
- **Display:** shown in the viewer's own time zone. A toast fires 10 minutes
  before each one starts and while it's on.
- **Where it lives:** client-side only. Changing a time is a client
  release.

## Running for real

- **Email:** sign-in links go over SMTP with `lettre` (rustls), configured
  by `SMTP_URL` / `MAIL_FROM`. The connection is checked at startup. Outside
  dev mode, an unset or failing mailer is an error the player sees, not a
  silent "sent".
- **Hosting:** `infra/prod` puts everything on one host. Caddy handles
  automatic HTTPS, serves the client and routes `/api/join`,
  `/api/social/*`, `/api/*` and `/ws`. One image holds all four services.
  Postgres sits on a volume, with a nightly `pg_dump` (14 kept). The
  internal routes are never proxied.
