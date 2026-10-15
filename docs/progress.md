# Progress

Each milestone ends with a working build, tests passing, a botswarm run and
demo notes (spec §15).

## M0 · Skeleton: done (2026-10-11)

- Cargo workspace with `protocol`, `sim`, `common`, `zone`, `api` and
  `orchestrator`, plus `tools/botswarm`.
- Protocol codegen: messages are declared once in
  `server/crates/protocol/src/lib.rs`, and `gen-ts` emits
  `client/src/net/protocol.gen.ts` plus byte-level test vectors. Rust tests fail
  if the TS is stale, and client tests decode Rust-produced bytes and re-encode
  them byte for byte.
- `infra/docker-compose.yml` runs Postgres 16 (auto-applies
  `server/migrations`), Valkey, NATS JetStream, MinIO, Prometheus and Grafana
  (with a zone dashboard).
- Telemetry: every service has `tracing` logs (JSON with `COMMONS_LOG_JSON=1`)
  and Prometheus `/metrics` and `/healthz` endpoints.
- CI (`.github/workflows/ci.yml`) runs fmt, clippy `-D warnings`, the Rust and
  client tests, the client build and the 500-bot perf gate.
- The schema (§13) in `server/migrations/0001_core.sql` was validated against
  Postgres (PGlite): 28 tables, and append-only triggers on both ledgers.

## M1 · Walk together: done (2026-10-11)

- **Auth:** email magic links (single use, 15 min, stored hashed), sign-up with
  an age gate (13+, under-16s flagged `minor`), 15-minute access JWTs and
  rotating 30-day refresh tokens. Dev mode adds a name-only login.
- **Orchestrator:** `POST /api/join` returns a zone server URL and a 60-second
  join token (`typ: join`, so access tokens can't be replayed against zone
  servers).
- **One zone:** the founders' park (96×96) from `mapgen`. It has a plaza and
  fountain, pond, chess tables, benches, garden plots, the big screen, town
  hall, homes gate and a fogged bridge to the east.
- **Path-based movement:** the client sends `MoveTo`, and the server runs a
  deterministic 8-direction A* (no corner cutting) and broadcasts `MoveStart`
  with corner waypoints only, starting 150 ms in the future so observers
  receive it first. Everyone evaluates the same motion function (Rust `sim` and
  a TS mirror pinned by shared test cases). Keyboard walking sends ≤ 3-tile
  segments.
- **Cells and interest management:** 16×16-tile cells, with each client
  subscribed to its viewport plus a one-cell margin. A randomized test walks 6
  avatars across the map and asserts after every tick that each client's
  entity set equals the server's model.
- **Emotes** (7), **proximity chat** (8-tile radius, 140 chars, profanity mask,
  token-bucket rate limit), **spawn/despawn**, and one presence per player (a
  second login replaces the first).
- **Client:** PixiJS v8 with baked ground chunks, y-sorted props and avatars,
  procedural pixel art, DOM labels (names, bubbles, emotes), clock sync from
  min-RTT pings, reconnect with backoff, and an installable PWA.

### Botswarm results (Windows dev machine, release build, 1 instance)

| Scenario | Bots | Tick p50 | Tick p99 | Client KB/s p99 | Gate |
|---|---|---|---|---|---|
| mix (70% wander, 30% crowd) | 500 | 1.2 ms | 2.9 ms | 3.32 | PASS |
| crowd at plaza | 500 | 1.1 ms | 3.0 ms | 3.11 | PASS |

Gate: p99 tick < 20 ms, p99 per-client outbound < 8 KB/s.

### Demo notes

1. `node scripts/dev.mjs --bots 40`, then open http://localhost:5173 in two
   browsers and log in as two names.
2. Click a tile: a marker appears and the avatar walks around obstacles.
   WASD/arrows walk in short segments.
3. Press Enter and type: the bubble appears over your head and in the log of
   anyone within 8 tiles, but not for people farther away.
4. Press 1–7 or tap the emote bar to wave, dance and so on.
5. Walk away from the plaza: avatars leave and appear as cells change
   (`/debug/stats` on :8082 shows the population).

## Deviations and deferrals (see docs/adr/0001-m0-m1-decisions.md)

- `CellLeave` carries `ids` (§5.2 lists only `cell`).
- Codegen uses Rust macros instead of FlatBuffers (allowed by §2).
- Paths are sent as corner waypoints, not as hashes for client-side A*.
- Auth accounts live in memory until M3. Google OAuth and a real mailer are
  not wired up yet.
- No idle-instance shutdown yet; instances are created on demand from join
  tokens.

## M1 follow-up: smooth movement (2026-10-11)

- The local player is predicted client-side with a TypeScript mirror of the
  server's A*, so the first movement comes 16 ms after input. The server's
  agreeing `MoveStart` echo is ignored.
- Mid-walk redirects splice through the tile being entered (`Motion::splice`),
  so a new path continues the old one exactly, with no snap-back or pause.
- The camera locks to the player, and releasing a movement key stops at the
  next tile.

## M2 · Hang out: done (2026-10-11)

- **Sitting:** click a bench to walk next to it and sit, or use 🪑 to sit on
  the ground. Seats are bench tiles (ids are tile indices, derived identically
  by server, client and bots in `sim::furniture`). A `Sit` sent while walking
  applies on arrival. Walking off stands you up where you sat down from. Seat
  conflicts are refused (`SEAT_TAKEN`). New messages: `Sit`, `Stand`,
  `StateChange`.
- **Chess:** sit on either bench beside a table (left plays white, right plays
  black) and the game starts when both seats are filled. The server is
  authoritative (`chess` crate) and sends `GameState` with the legal moves, so
  the client needs no rules. Players can resign or ask for a rematch. Anyone
  within 12 tiles can click the table to watch. A player leaving abandons the
  game. Games over 400 plies are declared drawn.
- **Big screen:** the server announces the programme (`ScreenState`) from a
  schedule that's a pure function of the instance clock, and every client
  renders the same moment. The default programme is procedural (an aquarium,
  a night sky and a town noticeboard), so there's no licensing or external
  dependency. `assets/screen/playlist.json` can list video URLs, which are
  seeked to the shared time.
- **Ambient (client-only):** ducks paddling on the pond, butterflies over the
  flowerbeds, occasional flocks of birds with shadows, and leaves drifting
  from trees near the camera.
- **Day/night:** lighting follows the player's local time, with a multiply
  tint plus additive glows on lamps, the fountain and the town hall at night.
  `?hour=21.5` overrides the clock for testing.
- **Bots:** they now sit on benches (a third of the time at chess tables) and
  play random legal moves, so the perf gate exercises M2 traffic.
- **Map fix:** the path no longer runs under the big screen, and the screen
  face sits low enough to watch from the lawn.

### Botswarm (500 bots, mixed behaviour incl. sitting and chess)

| Tick p50 | Tick p99 | Client KB/s p99 | Gate |
|---|---|---|---|
| 1.2 ms | 2.6 ms | 3.30 | PASS |

### Demo notes

1. `node scripts/dev.mjs --bots 40`, then open http://localhost:5173.
2. Click a bench by the fountain to sit down; 🪑/🧍 sits you on the ground or
   stands you up.
3. At the chess tables north-east of the fountain, sit on either bench. With
   a second browser (or a bot) on the other side the game starts: click a
   piece, then a highlighted square.
4. Walk north to the big screen; every viewer sees the same fish at the same
   moment.
5. Add `?hour=22` to the URL for night, or `?hour=18.8` for dusk at the pond.

## M3 · Collect: done (2026-10-11)

- **Postgres** (local 16, or Compose). The API migrates on startup. Accounts,
  sessions and magic links moved from memory into Postgres, and new players
  start with 100 coins and 3 tulip seeds.
- **Economy service** (the only place items change): transactional and
  idempotent, with an append-only ledger and no negative stock. Public
  endpoints: `/api/catalog`, `/api/inventory`, `/api/album`,
  `/api/market/{buy,sell}` and `/api/daily` (a small daily seed gift, no
  streaks). Internal endpoints for zone servers: `/internal/grant`,
  `/internal/plots/*` and `/internal/home/*`.
- **Fishing:** tap the water and you walk to the shore and cast. The server
  picks the bite time (2.5–9 s); a needle mini-game scores the reel; the server
  rolls the catch (8 species including an old boot, rarer with better timing,
  2 only at night) and grants it.
- **Gardening:** tap a soil plot to plant, water or harvest. Each stage needs
  watering, and harvest gives 2–3 flowers and sometimes a seed back. Community
  plots are in the park, private ones at home.
- **Market cart** by the fountain: sell fish and flowers, buy seeds and 7
  pieces of furniture.
- **Album** (📖): Fish and Plants pages with ??? slots, night-only hints and a
  "Complete!" stamp. First catches toast "new in your album!".
- **Home:** the gate on the park's west edge leads to your own cottage, with a
  garden and a gate back. Place furniture from the bag, and tap it to pick it
  up again. It persists and blocks movement.
- Protocol v3: `FishCast`, `FishReel`, `PlotAction`, `Place`, `Pickup`,
  `FishEvent`, `PlotState`, `ObjectUpdate`, `Granted`.
- Fix: a Game's stage tap handler is now removed when you change zone, so
  stale handlers no longer swallow taps.

### Tests

- API integration tests on real Postgres (`commons_test`, and a Postgres
  service in CI): idempotent and atomic trades, 8 concurrent duplicates
  granting once, plant → water ×3 → harvest, place/pickup.
- Zone tests: fishing cast/bite/escape, catch odds by quality and night, plot
  validation.
- Browser end-to-end on the full stack: caught a fish, grew and harvested
  tulips, sold everything for 159 coins, bought a chair, went home, placed and
  picked it up, checked the album, and made four park↔home round trips.

### Botswarm (500 bots)

| Tick p99 | Client KB/s p99 | Gate |
|---|---|---|
| 2.6 ms | 3.38 | PASS |

### Demo notes

1. Postgres running (see README), then `node scripts/dev.mjs --bots 20`.
2. Walk to the pond (south-west) and tap the water. When it bites, stop the
   needle in the green.
3. In the fenced community garden north-west of the fountain, tap a soil plot,
   plant tulip seeds, and water at each stage (1 minute per stage in dev).
4. Sell at the market cart east of the fountain, then buy a chair.
5. Walk to the gate on the far west edge to go home. Use 🎒 → Place, tap a
   spot; tap the chair to pick it up.

See docs/adr/0002-m3-economy.md for the decisions behind this.

## M4 · Friends: done (2026-10-11)

- **Social gateway** (`server/crates/social`, :8083): one socket per client
  for live presence, messages and notifications; REST for actions; Postgres
  for friendships, requests, blocks, DMs, gifts and notifications (migration
  `0003_friends.sql`). The API crate is now lib + bin so the gateway reuses
  the economy.
- **Friends:** add by name or by tapping someone in the world. Requests
  arrive live with a 🔔 badge, and asking someone who already asked you makes
  you friends at once. The friends panel (👥, F) shows who's online and where.
- **Join friend:** the orchestrator asks the gateway where they are and
  routes you to their exact instance.
- **Messages** between friends, delivered live, with history.
- **Gifts:** give any item, and it waits as a box on the friend's doorstep
  until opened. Gifts earn friendship points; 3 gifts make you close friends.
- **Homes:** close friends can drop by any time; friends need an invitation
  (15 min). The HUD shows "Ana's home". Only the owner arranges furniture or
  gardens there.
- **Block** from the avatar menu: ends the friendship, stops contact both
  ways, and hides their chat.
- Notifications panel (🔔, N) with actions: accept, visit, go home for a gift.
- Only one panel is open at a time now (they used to stack).

### Tests

- Social integration tests on Postgres: requests and auto-accept, gifts (only
  between friends, idempotent, opened once, earning close friendship), visit
  and locate rules with invites, blocking. Hub unit tests cover out-of-order
  presence reports.
- Two-browser end-to-end: request → live badge → accept → presence → DM → gift
  on the doorstep → refused uninvited visit → invite → visit → join friend →
  block, with no errors.

### Botswarm (500 bots, separate zone server)

| Tick p99 | Client KB/s p99 | Gate |
|---|---|---|
| 2.9 ms | 3.53 | PASS |

### Demo notes

1. `node scripts/dev.mjs`, then open two browsers (one private window) and
   log in as two names.
2. 👥 → add the other by name; accept in the other window via 🔔.
3. Message, gift a seed (the other goes home through the west gate to open
   it), invite home, visit.
4. Walk somewhere and have the other press **Join**.

See docs/adr/0003-m4-social.md.

## Town life: quiet-launch batch (2026-10-12)

Things to do with few people around, and a shared sense of "town".

- **Topic corners** (seeds of future quarters): Sports (a pitch with goals),
  Art (easels by the pond), Music (a bandstand) and Games (arcade cabinets),
  each with a board. Join as many as you like; post with `#tags`; tags many
  people use show **"street forming"**, the seed of a future alley.
- **Town goal** at the fountain: everyone donates coins. Reaching a goal
  changes the park for everyone, in order: lanterns around the fountain →
  wildflowers along the paths → fireworks over the pond at night.
- **Notice board** by the plaza: three neighbours' requests a day (fish or
  flowers), paying more than the market. Each can be done once a day.
- **The Park Elder**: sit alone at a chess table and press "Play the Park
  Elder" for a gentle computer opponent. It hands its seat over to anyone
  who sits down.
- **Two-seat benches** in the park; a polish pass (camera, signs, labels,
  mobile HUD); crisp pixel art at any display scaling.

Tests: API integration tests (quarters and streets, donations capped and
idempotent, requests stable per day and done once); Park Elder engine tests
(takes free material, finds mate, varies its replies, finishes games) and a
table test (asks in, yields its seat, leaves with the player); a browser run
through every corner, the board, the notice board, a donation and a game
against the Elder; M2–M4 flows re-run.

See docs/adr/0004-town-life.md.

## Corner activities (2026-10-12)

Something to do at every corner, aimed at what people miss online: playing,
making music and making things together, with no metrics.

- **Bandstand jam** (music): eight pentatonic pads × bells, bass and drums.
  Notes snap to a shared beat from the server clock, so everyone nearby hears
  each other in time. Keys 1–8.
- **Shared easels** (art): three 16×16 canvases anyone can paint on, live
  for people nearby and saved for the next visitor. The easels in the world
  show the current paintings. Hang a finished painting in the gallery,
  credited to everyone who painted it.
- **Kickabout** (sports): a ball on the pitch, simulated on the server. Walk
  into it to kick it, or stand in its way to block it. Goals are counted
  (West – East).
- **The town word** (games): one five-letter word a day for the whole town.
  Every guess stays up for the next person; when it's solved, everyone who
  helped gets coins.

Protocol v4 (`JamNote`, `Paint`, `Ball`); migration 0005.

### Tests

Zone: a walk-in kick scoring a goal and the ball resetting, friction and
bounces, jam/paint only near the bandstand/easels. API: shared painting and
hanging with credits, word marks (repeated letters), a shared solve that
rewards helpers, limits. Browser, two players: jam notes arrive before their
beat (22–159 ms early), live strokes, the gallery, a walk-in goal, shared
word guesses.

### Botswarm (500 bots, mixed behaviour, the ball in play)

| Tick p99 | Client KB/s p99 | Gate |
|---|---|---|
| 3.0 ms | 3.35 | PASS |

See docs/adr/0005-corner-activities.md.

## A living park (2026-10-12)

The park went from a grid to a place.

- **Landscape:** winding paths, a brook from a spring in the Whispering Wood
  through the pond to the south edge (footbridges where paths cross), groves,
  a wildflower meadow, an orchard, tall grass, stumps, logs, mushrooms and
  lily pads. Soft rounded edges instead of tile staircases.
- **Landmarks:** the Old Oak with a rope swing (sit on it), the wishing well,
  a fishing pier, a picnic lawn, a hedge maze with a sundial at its heart,
  signposts at junctions (tap to read).
- **Discoveries:** the Old Oak, the well, the maze's heart, the tiny door in
  the wood, the fairy ring. Each tells a little story; "Discovery n of 5".
- **Weather everyone shares:** clear, cloudy (drifting cloud shadows), rain
  (streaks, ripples, a grey cast) and morning mist; wind sways the trees.
- **Life:** Biscuit the park cat wanders between favourite spots and naps
  (the same for everyone, and you can pet it); fireflies at night; fish
  jumping in the pond.
- **Sound:** birdsong by day, synthesised; 🔊 / M to mute.

Every earlier flow re-run on the new map (corners, activities, Elder, goals,
friends, fishing, gardening, chess); botswarm 500 bots PASS (tick p99
3.07 ms, 3.40 KB/s).

See docs/adr/0006-living-park.md.

## M6 · Govern: done (2026-10-12)

"The people here decide what comes next", ready for launch.

- **Activity days and trust tiers:** time present plus things done with
  others, reported by zone servers each minute (bots excluded) and by the
  API. Visitor → Newcomer → Resident → Steward.
- **The Story of the Town** board by the fountain: the town's name, the
  phase and what unlocks the next one, your standing, open votes, recent
  decisions.
- **The Town Hall:** votes (ideas with support, discussion, ranked-choice or
  yes/no ballots, results round by round), the archive (the public,
  append-only ledger), proposing (Residents, from Phase 1) and the
  Caretaker's desk (open founding votes, end a stage early, post temporary
  decisions, handle reports).
- **Founding votes** (decided for launch): the Caretaker opens "Name the
  town" and "Beyond the bridge"; anyone with 3 active days votes, one vote
  each. The name vote renames the town; the bridge vote opens a
  construction pool.
- **Secret ballots:** who voted and what was voted live in separate tables.
- **Reports and mutes:** Report from any player's menu; the Caretaker can
  warn or mute (1 h / 24 h). Mutes stop chat, posts, comments and
  proposals.

### Tests

API on Postgres: activity → tiers and zone activity reports; the founders
name the town by ranked choice (suggest, support, shortlist, rank, result,
the Story board, the ledger can't be edited, ballots have no voter column);
town rules need 60%; the bridge vote opens a pool; reports, mutes and
permissions. Unit: instant runoff, thresholds, voice weight, tiers. Zone: a
muted player can't chat; activity is counted for accounts, not bots.
Browser: the Caretaker opens "Name the town", three founders suggest,
support and rank, the town is named, the Story board shows it, and a report
from the avatar menu reaches the Caretaker.

### Botswarm (500 bots)

| Tick p99 | Client KB/s p99 | Gate |
|---|---|---|
| 3.1 ms | 3.44 | PASS |

### Launch checklist

1. Set `COMMONS_CARETAKERS=you@example.org` on the API.
2. Once a few people have 3 active days, open **Name the town** at the
   Town Hall (Caretaker tab), then **Beyond the bridge**.
3. Watch the report queue in the Caretaker tab.

See docs/adr/0007-governance.md.

## Launch batch: the founding experience and running for real (2026-10-12)

Spec §11, plus what a real launch needs.

- **The Caretaker:** a gardener NPC on a clock-driven round, the same for
  everyone, waiting at the fountain during gatherings. They welcome
  newcomers (the panel opens on a first visit) with three tasks: catch a
  fish, plant a seed, sit with someone (a shared bench or a chess game; the
  Park Elder counts). A chip under the place name tracks progress, and the
  Caretaker chats when you're close.
- **The Founders' Grove** east of the chess tables. Finishing the tasks in
  the founding season plants a seedling with your name. It grows over real
  months (seedling, then sapling at 7 days, young tree at 30, grown at 90),
  in five species. You also get your name on the Founders' Stone, a 🌱 by
  your name for everyone, and a Founder's Lantern. The season closes when
  the 80 spots are filled, or on a set date.
- **Gathering hours:** an evening at the fountain (daily 18:00 UTC) and chess
  night (Thursdays 18:30 UTC), shown in the player's own time zone with a
  nudge 10 minutes before.
- **Sign-in emails** over SMTP (any provider), checked at startup. In
  production a missing mailer is a visible error, not a silent "sent".
- **`infra/prod`:** one host, with Caddy for automatic HTTPS and the client,
  one image for the four services, Postgres, and nightly backups (14 kept).
  It comes with a deploy guide and a launch-day checklist.
- **Link previews** (Open Graph) for sharing the address.

### Tests

API on Postgres: tasks from a fish, a planting and a zone `sat_together`
report; founder #1 gets slot 0 and a lantern; planting twice changes
nothing; the founders list is public. Unit tests: tree stages. Zone: a
chess game marks both players as having sat together. Client: gathering
times, daily and weekly. Browser: a newcomer sees the Caretaker's panel
on their first visit, taps the Caretaker, sits at chess with another
player, sees the chip turn to "Plant your seedling!", plants, finds the
tree in the grove and the name on the Stone, and another player sees the
🌱. No errors.

### Botswarm (500 bots)

| Tick p99 | Client KB/s p99 | Gate |
|---|---|---|
| 3.8 ms | 3.38 | PASS |

See docs/adr/0008-founding-and-launch.md.

## A dreamier park: secret places and gentle ways to meet (2026-10-12)

For people who come here lonely: ways to signal you'd welcome company, small
gestures that need both people, something to talk about, private places to
talk, and moments everyone shares.

- **Secret nooks**, where chat is heard only inside (checked on the zone
  server). It's the words that are private; people inside can still be seen.
  - **The Willow Hideaway:** in the meadow; walk through the curtain of
    branches.
  - **The Moss Grotto:** in the Whispering Wood, behind a "pine" that isn't
    one.
  - **The Little Island:** stepping stones from the pier.
  - **The Heart of the Maze.**

  Each counts as a discovery. Inside, the screen edges soften and the chat
  box tells you who can hear.
- **Moods:** 💬 open to chat, 🌙 quiet company, ♟ up for a game, shown before
  your name and remembered.
- **Hugs, high fives, dancing together:** offered from someone's menu,
  accepted on a card. Each counts as "sitting with someone" for the
  Caretaker's tasks.
- **The campfire circle** on the west field: log seats, crackling flames, and
  a shared question every 4 minutes for whoever sits there.
- **Wish lanterns** at the picnic lawn: a wish rises glowing into the sky
  for everyone nearby.
- **Stargazing:** picnic blankets and logs are seats. After dark, shooting
  stars everyone sees at the same moment.
- **Messages in bottles** at the pier:
  - write a kind anonymous note (3 a day);
  - find a stranger's (one an hour, never from someone you've blocked);
  - send a thank-you back, or report the note to the Caretaker.
- **Gathering hours:** campfire stories nightly, and stargazing on Saturdays.
- **The Caretaker** drops hints about the secret places.
- Protocol v5.

### Tests

- **Zone:** nooks keep chat inside, both ways; a hug needs an offer and
  matching acceptance; moods show to newcomers; one sky lantern per half
  minute.
- **API:** a bottle reaches a stranger, never its author, once an hour;
  only the finder can thank; three a day.
- **Client:** the campfire question cycles through every question; shooting
  stars are shared and occasional.
- **Browser:** moods seen by others; a hug offered and returned; chat in the
  hideaway heard inside and not just outside the curtain; the campfire
  question; a wish lantern seen by a neighbour; a bottle thrown, found and
  thanked; walking to the island and through the grotto's passage; a
  shooting star. No errors.

### Botswarm (500 bots)

| Tick p99 | Client KB/s p99 | Gate |
|---|---|---|
| 4.4 ms | 3.42 | PASS |

See docs/adr/0009-a-dreamier-park.md.

## City C0 · Foundations: done (2026-10-15)

The world becomes a 7 × 7 city of 48-tile blocks (ADR 0010). C0 lays the
ground without changing the game:

- `assets/city/city.json`: geometry (48-tile blocks, 4-tile streets,
  13-tile cells; 368 × 368 tiles) and the block grid (Market at the centre,
  Park north, Pond south, Casino east, 24 home blocks around the edge).
- `assets/city/block_types.json`: the catalog, with the future block types
  listed but disabled.
- `sim::city` and `client/src/world/city.ts`: global ↔ block-local tiles,
  streets, which zone owns each tile (streets split down the middle), the
  zones near a point; tests on both sides check they agree and that every
  tile has exactly one owner.

Next: C1, the whole city as one zone with the client streaming nearby
blocks.

## Next: M5 · Crowds

Instancing, orchestrator routing by population, crowd LOD, slow mode,
mega-event broadcast over NATS, and a 10,000-bot festival test.
