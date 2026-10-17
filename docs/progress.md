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

## City C1 · The city as one zone: done (2026-10-15)

The whole city runs as one zone, `city` (368 × 368), and is the default
place to join:

- **Map:** `mapgen` builds `assets/maps/city.json` from `assets/city/`:
  cobbled streets, pavements with street lamps, and a placeholder layout
  per block type with a sign on its south pavement. The Market (spawn) has
  stalls, the tailor and benches. The Park has the **gate to Founders'
  Park**. The Pond and Lake have water you can fish in. The Orchard has a
  greenhouse; Woods and Meadow are wild. Club lots are fenced. Home blocks
  have the C3 layout of seven houses around a hedged courtyard (no doors
  yet). Landmarks have a building and a forecourt; the Town Hall block has
  the real Town Hall and the Arcade block has the word game. Mapgen checks
  that nearly every walkable tile is reachable from the spawn and that no
  block is closed off.
- **Founders' Park** stays as its own zone until C2 moves its content into
  the blocks. Its fogged east bridge is now the **city gate**, and the home's
  gate leads to the city. Newcomers still doing the Caretaker's tasks start
  in the park, where those tasks are; everyone else starts at the Market.
- **Routing (`sim::path::route`, mirrored in `world/path.ts`):** on maps
  bigger than 128 × 128, A* searches only a window around the walk (24
  tiles of margin), so a short walk never allocates the whole city. Walks
  longer than 40 tiles head to a street crossing near the start, follow
  street centre lines, and walk in from a crossing near the goal. The map
  file carries `streets` so both sides know the grid. A shared test city
  checks that client and server produce the same route.
- **Streaming (`world/scene.ts`):** ground chunks, decor and objects exist
  only around the camera. Chunks are baked nearest first, a few per frame,
  and dropped with one ring of slack, so a walk across the whole city stays
  near 28 chunks and 300 sprites. The scene frees its textures on leaving a
  zone.
- **City map (C, or the map button):** the 7 × 7 grid by kind, with "you"
  on your block; tap a block to walk to its sign by the streets.
- New art: road cobbles, pavement with kerbs, landmark buildings (roof,
  windows, name board), houses and the city gate.

Checked: 500 bots in the city pass the perf gate (tick p99 2.3 ms with
cross-city walks to seats). In the browser: newcomer → park → city gate →
Market → map → Lake (50 s walk) → Park gate → Founders' Park → back.
Rendering coordinates stay plain world pixels: at 368 tiles (11,776 px)
float precision is no concern, so camera-relative drawing waits for bigger
cities.

## City C2 · Everything moves into the city: done (2026-10-15)

Founders' Park is retired as a zone; its content lives in the city blocks:

| Block | What's there now |
|---|---|
| Market (spawn) | the fountain (town goal) in a ring of flowerbeds, Story of the Town and Notice Board, stalls, the tailor, the homes gate |
| Park | chess tables (with the Park Elder), the Founders' Grove and Stone (80 seedling spots), the Old Oak and swing, the wishing well |
| Pond | the fishing pier, messages in bottles |
| Lake | the Little Island nook across stepping stones, the campfire circle |
| Meadow | the Willow Hideaway nook, the picnic lawn, wish lanterns |
| Woods | the Moss Grotto nook behind a pine that isn't one, the fairy ring, the tiny door, the hedge maze and its Heart, a brook |
| Orchard | the Community Garden (soil rows are garden plots, space `city`) |
| Fairground | the bandstand stage (jams) and the sports pitch |
| Gallery / Cinema | the easels / the outdoor big screen |

- The topic-corner boards are gone (clubs replace them in C9); the
  quarters API stays until then.
- **Named spots:** invisible `spot` objects (`pier`, `garden`, `chess`,
  `grove`, `campfire`, `picnic`…) are where the Caretaker's "Show me", the
  gathering hours, the Caretaker's rounds and Biscuit's naps go. No map
  coordinates live in client code any more. Mapgen checks that every spot,
  nook and grove slot can be walked to.
- Everyone starts at the Market, newcomers too. The Caretaker walks
  between the Market and the Park.
- **Minimap:** the whole city in the corner (under the top bar on phones),
  a pulsing dot for you, your block outlined, a dotted line to where you're
  walking, and the name of the place you're in. Tap it (or press C) for the
  **city map**: the drawn city with every place named; tap anywhere to walk
  there.
- Removed: `assets/maps/founders_park.json`, the park generator, the
  `founders_park` zone (`COMMONS_ZONES` is now `city,home`). Plots planted
  in the old park's space stay in the database but no longer show.

Checked: 500 bots pass the perf gate in the city (tick p99 3.2 ms mixed,
3.7 ms wandering). In the browser: arrive at the Market, "Show me" to the
pier, the map's tap-to-walk, the grove, the island nook (private chat),
the fairy ring discovery, the campfire, the stage and the screen; the
welcome flow end to end (fish, plant, sit at chess, plant the seedling,
the Founders' Stone) and following.

## City C3 · Homes in the city: done (2026-10-15)

Every home is now a house in one of the 24 home blocks, seven per block
(168 in all): three along the north edge, three along the south and one on
the west, each with a flower garden and a postbox, around a hedged shared
courtyard (its soil beds are shared garden plots) with a gate to the east.

- **Lots:** each house is a lot (`b0_3:5`: block, then house), shared by
  mapgen, the social service and the zone through `sim::city`. Table
  `home_lots` (migration 0009): one house per player, free for now (C4
  adds rent). `GET /api/social/homes` (who lives where, which is yours),
  `POST /api/social/homes/claim`, and `/internal/home` for the orchestrator.
- **Doors:** tap a house or its postbox. Yours: *Go inside*. Someone's:
  their name and *Knock* (visiting still needs an invitation). Free (and
  you have none): *Move in*. Mapgen puts a `door:<lot>` spot in front of
  every door and checks each can be reached.
- **No house, no home:** the orchestrator only lets you into your own home
  if you have a house, and visits need the owner to have one. Leaving a
  home (yours or a friend's) you step out of that house's front door: the
  join carries `arrive`, the orchestrator looks up the lot, the zone spawns
  you at its door.
- **Post Office** in the Market (where the homes gate was): with a home,
  *Walk home* / *Go straight inside*; without, how many houses are free and
  *Show me a free house* (walks to the nearest).
- Your door is a little gold house on the minimap and the city map.
- Fixed: tapping the Caretaker opened their panel and closed it at once
  when their walk was long (the panel was anchored to where they were
  going, not where they stood).

Checked: social tests for claiming (taken, one each, unknown lots) and the
visit rule; in the browser: Post Office → free house → move in → go inside
→ out of the same front door; another player sees "Ada's home" and is told
to get an invitation; going home with no house explains why. The welcome
flow, following and C2's tour pass again; 500 bots pass the perf gate.

Not yet: names on houses.

## City C4 · Renting: done (2026-10-16)

Everything players hold in the city is rented by the week in coins, never
bought, and nothing is ever lost when a lease ends.

| What | Tiers (coins a week) | Holds |
|---|---|---|
| House (168, home blocks) | Cottage 15 · House 40 · Big house 90 | 12 / 24 / 48 pieces of furniture |
| Apartment (8, above the Market) | Studio 10 · Flat 30 | 8 / 16 |
| Market stall (6, south side of the Market) | Small stall 10 · Big stall 30 | 4 / 10 goods on show |

- **Data:** `assets/city/rent.json` (tiers, period, grace), read through
  `sim::city::rent_catalog`. Migration 0010: `leases` (one home, house or
  apartment, and one stall per player; one tenant per plot),
  `rent_charges`, `stall_listings`; C3's free houses became Cottage leases
  with the first week free.
- **Leases** (`social/src/rent.rs`): moving in pays the first week. A
  sweeper (every minute) renews leases as they fall due; one that can't be
  paid gets three days' grace and a notice, then ends. Ending a lease moves
  furniture (or stall goods) back to the bag. Moving up pays the
  difference for the current week; moving down is free if everything still
  fits. You can pay overdue rent at once, or move out. Period, grace and
  sweep are configurable (`COMMONS_RENT_PERIOD_SECS`, `_GRACE_SECS`,
  `_SWEEP_SECS`).
- **Furniture limit:** the API won't place more than the home's tier holds.
- **Stalls** (`social/src/stalls.rs`): put things from your bag on show at
  your price; anyone can buy (coins to the seller, goods to the buyer, in
  one transaction; idempotent). The seller is told. Take things back any
  time.
- **In town:** the Post Office is now also the rent office (your home and
  stall: tier, rent, paid until, pay now, move up or down, move out or
  give up, with a second click to confirm). The Market Apartments list the
  eight flats; each stall shows its owner's goods. Notices for rent due,
  a lease ending and a stall sale.

Economy check: a fish sells for 5–20 coins, so a Cottage is two or three
catches a week, and a newcomer's 100 coins cover six weeks; a stall pays
for itself with one or two sales.

Checked: social tests for renewal, grace, release returning furniture, tier
rules and stall sales (including a repeated buy that doesn't charge twice);
the API test for the furniture cap. In the browser, with a 90-second
period: rent a flat and a stall, put seeds on show, a second player buys
one and the seller is told, move up to a Flat, out of the apartments' door,
the period renews both leases, move out. Earlier flows and 500 bots pass.

Next: C5, transit (tram ring and two metro lines).

## Mall M1 · The Commons Mall opens its doors: done (2026-10-16)

ADR 0011 plans the mall (departments, rotation, vehicles, pets by house
with daily walks, no real money). M1 is the building and its floor:

- **Market Hall** on the Market's north side: the Commons Mall's door in
  the middle, the apartments' door to the west.
- **The floor** (`mall` zone, 96 × 80, generated from
  `assets/mall/departments.json`): eleven shops round a walking loop, each
  with walls, a doorway, a sign outside and a counter ("opening soon");
  related shops side by side; concourses join the corner shops. The food
  court fills the middle: planters, a tree under the skylight and 30 café
  tables with a bench either side (60 seats). The entrance hall has the
  directory and the seasonal pop-up stand.
- **Directory:** the floor drawn with every shop named and "you are here";
  tap a shop to walk to its doorway.
- **Doors:** in by the Market Hall's door, out the same way: leaving joins
  with `arrive: "place:mall"` (public doors, generalising C3's homes) and
  you're back on the square at the mall's door.
- **Indoors:** always daylight and no weather in the mall.
- Mapgen checks every shop, spot and doorway can be walked to.

Checked: in the browser (at night, in rain outside): in, the directory to
Furniture, two players meet and sit at a café table, out onto the square
at the door. 500 bots in the mall pass the perf gate (tick p99 4.7 ms);
the city's gate, homes and the welcome flow pass again.

## Mall M2 · The first shops: done (2026-10-16)

- **Departments from data:** `assets/mall/departments.json` gives each
  shop its type, displays (`slots`) and catalog (item and price), read by
  `sim::mall` for mapgen and the API alike.
- **Furniture** (showroom): four carpeted model rooms, three pieces in each,
  standing on the floor with a price tag: walk through and look. **Seeds &
  Garden** (shelves): seeds and garden pieces on little stands.
- **Eight new pieces** (migration 0011): armchair, sofa, side table, potted
  palm, wall clock, flower box, garden gnome, birdbath, with their art.
  Garden pieces are placed like furniture for now (yards come with Home
  exterior).
- **Buying:** tap a display to see the item up close (picture, price, what
  it's for, how many you have) and buy it, or tap the counter for
  everything the shop sells. `GET /api/mall/stock`, `POST /api/mall/buy`:
  the server checks the item is on that display at that price; idempotent
  like every purchase.
- **Rules from the start:** the mall never sells what players make (an API
  test checks every catalog item); `account_bound` items can't be sold to
  the cart, given or put on a stall.
- The market cart now only buys (your catch and harvest); buying moved to
  the mall.
- Fixed: tapping inside an invisible area (a shop, a nook, a named spot)
  no longer hides the thing you actually tapped.

Checked: API tests for the catalog rule and buying (charged once, closed
shops and empty displays refused). In the browser: the cart points to the
mall, all 19 displays dressed, inspect and buy a fern (100 → 50 coins, in
the bag), the counter's 12 rows, seeds off a shelf, a closed shop says so.
500 bots in the mall pass the perf gate.

## Mall M3 · Something new every week: done (2026-10-16)

- **Weekly rotation** (`sim::mall`): each week (Monday 00:00 UTC; set
  `COMMONS_MALL_ROTATION_SECS` to change the length) every shop shows its
  `always` items and draws the rest of its displays by weight from the rest
  of its catalog. It's a pure function of the week number, so everyone sees
  the same shelves without storing them. Furniture now shows 9 of its 14
  pieces a week (one or two in each model room); Seeds & Garden keeps its
  four seeds and rotates two of three garden pieces.
- **Limited items:** a stock per week shared by everyone (`mall_stock`,
  migration 0012), taken in the same transaction as the payment; when it's
  gone, it's "Sold out this week" and nobody is charged.
- **Seasonal pop-up** by the entrance (`assets/mall/events.json`): Spring
  Blossom, Summer Fair, Autumn Harvest, Winter Lights, each with its own
  pieces and one limited one. Eleven new items with art (rocking chair,
  grandfather clock and the seasonal ones).
- **What's new:** items that weren't on show last week get a NEW tag on
  their display and a badge in the shop; the directory lists them and says
  when the shelves change; walking in, once a week, a nudge says what's
  new. Tap the pop-up stand for the season's goods.

Checked: sim tests (every display filled, `always` items stay, shelves the
same for everyone and changing weekly, every item gets its turn, the
calendar covers every day and wraps the year); API tests (the catalog rule
covers the pop-up; the last limited item goes to one buyer and the next is
told it's sold out and not charged). In the browser: the nudge, NEW tags on
this week's three new pieces, Autumn Harvest at the pop-up with "10 of 10
left", buying a pumpkin lantern, the directory's "New this week". 500 bots
in the mall pass the perf gate.

## Mall M4 · Clothing and Skins: done (2026-10-17)

- **Seventeen things to wear** (migration 0013): six outfits (denim jacket,
  raincoat, cosy sweater, sundress, kimono, a limited tuxedo), four hats
  (beanie, sun hat, wizard hat, a limited crown), three accessories
  (satchel, bow tie, limited butterfly wings) and four full-body skins (fox,
  frog, bear, a limited robot). Each has a `code`; what a player wears from
  the mall is their **style**, a byte per slot (outfit, hat, accessory,
  skin). Bought once and kept: account-bound, so never sold back, given or
  put on a stall (the gift and stall pickers leave them out). The look's
  own styles stay free.
- **Protocol v7:** `EntityInfo` and `LookChanged` carry `style`; access and
  join tokens carry it too.
- **Server-authoritative:** saving a look (`POST /api/me/look`) checks you
  own everything in the style; the zone then shows the *saved* look (it
  asks the API, `/internal/look/{player}`), never the client's word.
- **The shops:** Clothing shows 8 of its 13 pieces a week on mannequins
  (each figure wearing the piece), with two fitting rooms; Skins shows its
  four suits, with a mirror. A piece's card has **Try it on**; the fitting
  room or mirror opens on you wearing it, lists this week's things to try,
  and buys the one you're trying ("Buy the Sun Hat for 40") right next to
  **Wear it**, which only works once you own it.
- **Wardrobes everywhere** (the Tailor, home, the fitting rooms) gain a
  **Mine** tab with what you've bought, to put on or take off.
- **Drawing:** mall outfits, hats and accessories layer over the look;
  skins replace the whole figure (a hood with ears, the robot's visor).

Checked: API tests (can't wear what you haven't bought, a repeat press is
the same purchase but buying again isn't allowed, the zone reads the saved
style, made-up codes are refused); the protocol vectors round-trip in the
client. In the browser: a mannequin's card, Try it on, buy in the fitting
room, wear it out, another player nearby sees it at once, the mirror shows
a fox suit you can't wear out until it's bought, the look survives a
reload; the old wardrobe, the earlier mall steps and following pass again;
500 bots pass the perf gate.

## Mall M5 · Pets: done (2026-10-17)

- **The Pets shop opens** (migration 0014): six fenced pens on straw, each
  with an animal waiting for a home. Golden and spotted puppies, ginger and
  black kittens, a lop bunny, a duckling, a hedgehog and a limited corgi
  (two a week), 100–250 coins. Like everything else in the mall, the pens
  change weekly.
- **Adopting** takes a name and a house: pets need a garden, so not the
  apartments. One pet each. The payment and the adoption are one
  transaction, and a pet never goes in the bag.
- **At home** the pet waits in the yard by your front door, for everyone
  passing to see. Until it's had a walk today, a thought bubble with a
  ball hovers over it. Moving house takes it along; without a house it
  waits off the map until you have one.
- **Walks.** Tap your pet (or your door) and take it out: it trots at your
  heels everywhere, through the city, the mall and every door, and everyone
  sees it. Coming back to your door after a proper walk
  (`COMMONS_PET_WALK_SECS`, 3 minutes) is its walk for the day; so is going
  inside. Missing a day costs nothing (the spec has no streaks): the pet
  just looks hopeful. A pet left out for 3 hours goes home on its own.
- **Meeting.** Pets that meet (out walking, or one passing a yard) sniff
  hello with hearts, and your pet's walker hears who it met ("Say hi to
  Kai?"). Tap someone else's pet to pat it, which sends its walker a heart.
- **Protocol v8:** `EntityInfo.pet` and `LookChanged.pet`. The zone takes
  the pet from the API (`/internal/look`) when you join and when you take
  it out or home, never from the client.

Checked: API tests (a name and a house are needed, adopting charges once
and never twice for one press, a second pet is refused, a short walk
doesn't count, a proper one counts once a day, a forgotten pet goes home);
the pens are reachable (mapgen check). In the browser: two players each
rent a house and adopt at the pens, the pet waits in the yard hoping for a
walk, you take it out from the yard, it follows you, the other player sees
it, the two pets meet and sniff hello, you come back to your door and it's
the day's walk, and going inside brings the other pet home. Clothing and
Skins, the earlier mall steps, homes and following pass again, and 500 bots
pass the perf gate.

Next: M6, vehicles (skates, scooter, bike; speed outdoors, off at doors,
the test track).

## Next: M5 · Crowds

Instancing, orchestrator routing by population, crowd LOD, slow mode,
mega-event broadcast over NATS, and a 10,000-bot festival test.
