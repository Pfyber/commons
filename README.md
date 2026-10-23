# Commons

A calm, persistent 2D park-town MMO where players hang out, collect and create,
and where the community democratically governs and expands the world.

The spec is in [docs/spec.md](docs/spec.md) and progress is tracked in
[docs/progress.md](docs/progress.md). Milestones M0 (Skeleton), M1 (Walk
together), M2 (Hang out), M3 (Collect) and M4 (Friends) are done.

## Quick start

You need Rust (stable), Node 22 and PostgreSQL 16. On Windows you also need
the MSVC build tools. Create the database once (the API runs migrations
itself):

```sh
psql -U postgres -c "CREATE ROLE commons LOGIN PASSWORD 'commons'"   -c "CREATE DATABASE commons OWNER commons" -c "CREATE DATABASE commons_test OWNER commons"
```

```sh
cd client && npm install && cd ..
node scripts/dev.mjs            # api :8080, orchestrator :8081, zone :8082, social :8083, voice :7880, web :5173, 20 bots
node scripts/dev.mjs --bots 50  # more bots (--bots 0 for none)
node scripts/dev.mjs --no-voice # without the LiveKit voice server (no phone calls)
```

Open http://localhost:5173 and use **Dev quick login** with any name, or the
email flow (in dev mode the magic link is shown on screen). Click or tap to
walk, or use WASD/arrows (double-tap, or press a direction twice, to
sprint outdoors); the mouse wheel or a pinch zooms. Press Enter to chat, and 1–8 for emotes (8 is the robot). Click a
bench to sit (🪑 sits on the ground); sit beside a chess table to play. Add
`?hour=22` to the URL to see the park at night. Tap the pond to fish, tap a
soil plot to garden, visit the market cart by the fountain, and take the west
gate home. 🎒 is your bag (B), 📖 your album (L), 👥 friends (F) and 🔔
notifications (N). Tap another player to befriend, message or block them, or
to play rock paper scissors (anyone, not just friends). The dev bots are
real (dev) players: they accept friend requests, follows and games, wave
back, and stop when you walk up to them.
Tap a corner's board (sports, art, music, games) to read and post, the
notice board for daily requests, and the fountain for the town goal. Sit
alone at a chess table to play the Park Elder. Corner activities: jam at
the bandstand (keys 1–8), paint at the easels, kick the ball on the pitch
(walk into it), and solve the town word at the arcade. Explore: the Old
Oak, the wishing well by the Town Hall, the hedge maze, the Whispering Wood (there's a tiny
door somewhere), and pet Biscuit the cat. In the Café block, the Mossy Mug:
a beer from the bartender (5 coins) makes you woozy for a minute (water
sobers you up), the pool table plays real 8-ball against a friend or the
pool shark bot, and there's pinball. In the Arcade block: Pong, Light
Cycles, Connect Four, Memory Match, Basket Catch, Turbo Racer, Tank Duel
and the Dance Off machine, each against its AI bot or whoever joins you;
wins earn tickets for the prize counter. At the foot of the pond's pier, the
Fisherman buys your catch. Skateboards, bikes and the rest are at the
Commons Mall's Vehicles shop.
West of the square, the Library holds every Project Gutenberg book, in
every language, each one a spine on a shelf: ask at the catalogue desk
("Show me" walks you to it), or browse the eight wings, shelved like a
real library. Tap "Read" on a book's card to read it, a page at a time; it
opens where you left off, and the catalogue lists what you've been
reading. Books stay in the library unless you Borrow them (up to five,
for three weeks): then they're under 📚 at the top, to read anywhere.
Whoever's reading holds their book open for all to see: tap them to open
the same one. The API stocks the Library itself from Gutenberg's catalogue
(about 20 MB) when it starts with none, and looks for new books weekly;
`cargo run --bin library-import` does it by hand (`--csv <file>` to use a
copy, `--reshelve` to file new arrivals).
Buy a Mobile Phone at the mall's Tools & Gadgets shop to call friends who
have one (📱 at the top); anyone on a call can ring more friends in. Voice
goes through a LiveKit server, which `scripts/dev.mjs` starts for you (it
uses `livekit-server` from your PATH, or fetches the official release into
`tools/livekit/` the first time). Calls for under-16s are built but off
(`COMMONS_VOICE_MINORS`).
Clubs (🛡 at the top, or K): found one at the Club Hall's desk, next to
the Town Hall, by renting its room (25 coins for the first week; a Big
club room for 30 members costs 60). After that the club's treasury pays
the rent, from what members chip in; if it can't, the room is given up
after a grace period, but the club carries on. Owners and moderators
invite friends; the board, roles and your club's crest by your name are
on the club's page, and the stairs lead up to its room. Each club can set
a weekly meetup (20 coins for staying 10 minutes of it in the room), works
on four weekly goals that pay its treasury, can ring every member who's
online with 📞 Call the club, and decorates its room from members' bags
(each piece stays its owner's). Bigger clubs can rent a Clubhouse on one
of the city's club lots (120 a week): its door leads into their room. Clubs
plan events for everyone at public places (📅 What's on, at the Club Hall
or in the 🛡 panel), and the Club Hall's leaderboard names the week's top
three clubs, which win coins for their treasuries.
The Casino (on the Casino block, 16 and over): slot machines, a shared
roulette wheel (everyone in the room bets on the same spin), two blackjack
tables of five seats against the dealer, and the cashier, for coins only. There's a daily loss limit of 300
coins, and at the cashier you can take a break for a day or a week.
The metro: nine stations around the city (look for the red M); at one,
tap a station on the map to ride there, and anyone following you comes too.
Houses have a yard stand by the front door: put things from your bag on
it (2, 4 or 6, by the house's tier) at your own price, and anyone walking
past sees them on the counter and can buy them.
The Concert Hall (on the Theater block): take the stage at the microphone
and everyone in the hall hears you, and only you, for up to an hour (16
and over; listeners get listen-only voice passes and a volume slider).
`COMMONS_CLUB_SWEEP_SECS`
(default 60) sets how often the club sweep runs; each run counts as a
minute.
Testing on a dev server: a wish at the wishing well (on the Town Hall's
plaza) grants 10,000 coins, every time; real servers don't have it.
🔊 or M toggles sound;
`?weather=rain` (clear, cloudy, rain, mist) previews the weather.

Newcomers meet the Caretaker by the fountain: three first tasks (catch a
fish, plant a seed, sit with someone), then a named seedling in the
Founders' Grove.

Governance: the Story of the Town board by the fountain and the Town Hall.
In dev, sign in as **Caretaker** to open founding votes, end stages early
and handle reports; in production list Caretaker emails in
`COMMONS_CARETAKERS`.

Valkey, NATS, MinIO, Prometheus and Grafana aren't needed yet. To run the full
set of backing services, including a containerised Postgres:

```sh
docker compose -f infra/docker-compose.yml up -d   # Grafana at http://localhost:3000
```

## Running for real

One server with Docker: see [infra/prod/README.md](infra/prod/README.md)
(HTTPS via Caddy, sign-in emails over SMTP, nightly backups, launch-day
checklist).

## Layout

```
client/                 TypeScript + PixiJS v8 + Vite (PWA)
  src/net/              protocol.gen.ts (generated), socket, auth API
  src/world/            map, motion (mirrors sim), procedural art, scene, avatars
  src/ui/               login, HUD
server/crates/
  protocol/             message definitions, binary codec, TS generator
  sim/                  deterministic map grid, A*, path motion; mapgen
  zone/                 zone server: 10 Hz instance actors, cells, interest management
  api/                  HTTP API (M1: auth)
  orchestrator/         POST /api/join → zone server + join token (zones, friends, homes)
  social/               social gateway: friends, presence, DMs, gifts, notifications
  common/               config, JWT, telemetry, rate limits, chat filter
server/migrations/      Postgres schema (spec §13)
tools/botswarm/         load-test bots and the CI performance gate
infra/                  docker-compose, Dockerfile, Prometheus, Grafana dashboard
assets/maps/            zone maps (generated by mapgen)
assets/city/            the city grid and block catalog (ADR 0010)
```

## Common tasks

| Task | Command |
|---|---|
| All Rust tests (includes a check that the generated TS is current) | `cargo test --workspace` |
| Client tests (decodes Rust-produced bytes) | `cd client && npm test` |
| Regenerate the TS protocol after editing `server/crates/protocol/src/lib.rs` | `cargo run -p commons-protocol --bin gen-ts` |
| Regenerate the maps (city, mall, bar, arcade, library, home) | `cargo run -p commons-sim --bin mapgen` |
| Fill or update the Library's catalogue (weekly) | `cargo run --bin library-import [-- --reshelve]` |
| Perf gate (start the zone server first) | `cargo run --release --bin botswarm -- --bots 500 --gate` |

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `COMMONS_DEV` | `true` | all; enables dev login and on-screen magic links |
| `COMMONS_SECRET` | dev secret | all; HMAC key, ≥ 32 bytes, **required in production** |
| `COMMONS_LOG_JSON` | `false` | all |
| `API_BIND` / `ORCHESTRATOR_BIND` / `ZONE_BIND` | `0.0.0.0:8080/8081/8082` | each service |
| `COMMONS_CLIENT_URL` | `http://localhost:5173` | api (magic-link URLs) |
| `ZONE_PUBLIC_URL` | `ws://localhost:8082/ws` | orchestrator |
| `COMMONS_ZONES` | `city,home,mall,bar,arcade,library`, the eight `library_<wing>`s, `club_hall,clubroom,bowling,concert_hall,casino` | orchestrator |
| `COMMONS_MAPS_DIR` | `assets/maps` | zone |
| `DATABASE_URL` | `postgres://commons:commons@localhost:5432/commons` | api |
| `TEST_DATABASE_URL` | `…/commons_test` | api tests |
| `LIBRARY_CATALOG_URL` / `LIBRARY_CONTACT` | Gutenberg's `pg_catalog.csv` / (none) | library-import: where to fetch, and a contact for its User-Agent (api too) |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | `ws://localhost:7880` / `devkey` / `secret` | social: the voice server for phone calls (empty URL: no calls) |
| `COMMONS_VOICE_MINORS` | `false` | api, social: phone calls for under-16s (under-16s with under-16s only, each switching calls on) |
| `LIBRARY_AUTO_STOCK` | `true` | api: stock the Library from Gutenberg when it's empty, and weekly |
| `LIBRARY_TEXT_URL` | `https://www.gutenberg.org/cache/epub/{id}/pg{id}.txt` | api: where book texts come from (a mirror, if the library gets busy) |
| `LIBRARY_FETCH_PAUSE_MS` | `1500` | api: the pause between fetching books from Gutenberg |
| `COMMONS_API_INTERNAL_URL` | `http://127.0.0.1:8080` | zone (economy calls) |
| `COMMONS_SOCIAL_INTERNAL_URL` | `http://127.0.0.1:8083` | zone, orchestrator |
| `SOCIAL_BIND` | `0.0.0.0:8083` | social |
| `COMMONS_CARETAKERS` | (none; dev: "Caretaker") | api: comma-separated Caretaker emails |
| `COMMONS_FOUNDING_DAYS` | `3` | api: active days to vote in founding votes |
| `COMMONS_PHASE1_PLAYERS` | `50` | api: players with 14 active days for Phase 1 |
| `COMMONS_GOV_DAY_SECS` | `86400` | api: length of a governance day (stage timers) |
| `SMTP_URL` / `MAIL_FROM` | (none) | api: sign-in emails (required unless `COMMONS_DEV`) |
| `COMMONS_FOUNDING_SEASON_END` | (none) | api: date the founding season closes (else when the grove is full) |
| `COMMONS_GROVE_DAY_SECS` | `86400` | api: length of a day for founders' trees growing |
| `COMMONS_RENT_PERIOD_SECS` | from `assets/city/rent.json` (a week) | social: how often rent is due |
| `COMMONS_RENT_GRACE_SECS` | from `assets/city/rent.json` (three days) | social: time to pay overdue rent before a lease ends |
| `COMMONS_RENT_SWEEP_SECS` | `60` | social: how often leases are checked |
| `COMMONS_MALL_ROTATION_SECS` | `604800` (a week) | api: how often the mall's shelves change |
| `COMMONS_PET_WALK_SECS` | `180` | api: how long a pet's walk has to be to count as the day's walk |
| `COMMONS_GROWTH_STAGE_SECS` | `21600` (6 h; dev script: 60) | api, zone |
