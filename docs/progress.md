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

## Mall M6 · Vehicles: done (2026-10-17)

- **The Vehicles shop opens** (migration 0015): roller skates (150 coins,
  1.3× walking speed), a kick scooter (220, 1.5×), a city bike (320, 1.8×)
  and a limited vintage bike with a basket (400, 1.8×, three a week).
  Bought once and kept (account-bound).
- **The test track:** a two-lane loop round a fenced lawn, filling most of
  the shop. Anything on show there can be taken for a test ride without
  buying it, on the track only. Walk out of the shop and you hand it back.
- **Riding:** a ride button on the bar (R) appears once you own something
  to ride, and there's a Ride button in the bag ("To ride"). Riding is
  faster anywhere outdoors in the city, and everyone sees you on it: you
  stride on skates, stand on the scooter and sit on a bike, with the
  wheels turning. You hop off at every door ("It'll be waiting when you're
  back outside").
- **A ride-along:** whoever is following you keeps your pace, so friends
  on foot aren't left behind. The zone now remembers who follows whom.
- **The server decides the speed.** Saving a ride checks you own it (or,
  for a test ride, that it's on show this week). The zone gets the ride
  from the API and applies it only where it may: owned rides outdoors in
  the city, test rides on the track's ground. Protocol v9:
  `EntityInfo.vehicle` and `LookChanged.vehicle`. The client predicts the
  same pace and takes the server's pace when they differ.

Checked: zone tests (a bike outdoors, no test rides in the street, parked
at the door indoors, a test ride fast on the track and walking off it, a
follower keeping up until they stop following); API tests (no riding what
you don't own, a test ride of what's on show, not things that aren't for
riding, bought once). In the browser: a test ride round the track at bike
speed, handed back on leaving the shop, buying the bike (1100 → 780), the
ride button outside, riding at bike speed, another player seeing it and
keeping up while following, and getting off at the mall door. The
earlier steps pass again, and 500 bots pass the perf gate.

## Mall M7 · The last shops: done (2026-10-17)

Every storefront in the mall is open now (migration 0016).

- **Tools:** a cherrywood, carbon or (limited) golden rod and a copper or
  floral watering can. They're cosmetic, with no effect on catches or growth.
  Put one to use from the bag; everyone sees the rod in your hands while you
  fish and the can when you water (the client spots who was standing at a
  plot that just got watered). Protocol v10: `EntityInfo.tool` and
  `LookChanged.tool`.
- **Music:** a ukulele, a kalimba and a flute, each a new sound at the
  bandstand jam. The pads show the instruments you own; the zone only plays
  notes on instruments you own.
- **Toys & Games:** a bubble wand, a kite, a yo-yo and a pinwheel. A toys
  button on the bar (and Play in the bag) plays with one, and everyone
  nearby sees it. The zone checks you own the toy. Toys can be given to
  friends.
- **Gift Shop:** four wrapping papers and four cards. When you leave a
  doorstep gift you can wrap it and add a card. Both are used up, the box
  waits on the doorstep in that paper, and opening it shows the card with
  your note.
- **Home Exterior:** paint (sage, rose, sky, sunny), a picket fence or low
  hedge, a gnome, a bird bath or (limited) a flower arch for the yard, and
  blue or cottage postboxes. "Decorate outside" at your front door puts them
  up. Paint recolours the house; the postbox changes; the fence runs along
  the garden with a gap for the path. Everyone passing sees it, and it moves
  with you if you move house.
- **Bought once:** tools, instruments, toys and exterior pieces (like
  clothes and vehicles); wrapping and cards are bought by the piece.
- **Behind it:** the zone gets your tools and kit (a bit per instrument or
  toy owned) from `/internal/look`. `home_exterior` keeps each resident's
  house look; gifts keep the wrapping and card used.

Checked: zone tests (no kite, nothing to fly; with one, everyone sees it;
a new rod is seen by everyone); API tests (no tool you haven't bought,
bought once, rod and can in use and the kit reach the zone, no house no
fence, a fence isn't yard decor, everyone sees the done-up house); social
test (a gift wrapped with a card uses both up and arrives with them). In
the browser: buying in every new shop, using a rod and can from the bag
(another player sees them), flying a kite from the toys button (seen by
another player), the ukulele at the bandstand (only for its owner),
painting the house and putting up the fence, gnome and blue postbox (seen
by another player), and a wrapped birthday gift arriving on a doorstep and
opening to its card. The earlier steps pass again, and 500 bots pass the
perf gate.

## Merge: the arcade, the bar and the fishing update (2026-10-22)

The `mancro5/commons` fork's work (8 commits, branched before the city)
merged into the city and mall, keeping its history:

- **The arcade** in the Arcade block: a neon hall with Pong, Light Cycles,
  Connect Four, Memory Match, Basket Catch, Turbo Racer, Tank Duel, the
  Dance Off (light-up floor, a scoreboard, an AI dancer) and claw machines.
  Play someone or the AI bot; wins earn arcade tickets (10, or 5 against
  the bot). The **prize counter** now trades tickets for mall things (toys,
  hats, a bow tie, a satchel, gift wrap), kept-for-good ones won once
  (`/api/arcade/prizes`, `/api/arcade/redeem`).
- **The Mossy Mug**, the bar in the Café block: a beer (5 coins, a woozy
  minute) or a glass of water, eight-ball pool against a friend or the
  pool shark, and pinball.
- **Fishing 3.0:** fish by rarity (common to mythical), five new fish, a
  treasure chest, the catch held up for all to see, rare fish flopping on
  the bank to be tapped, and **the Fisherman** at the foot of the pond's
  pier who buys your catch and sells the Angler's Rod (fish bite sooner).
  The rod you use from the mall's Tools shop colours the rod you're seen
  with.
- **Moving and being together:** sprinting outdoors (double-tap or
  double key press), mouse-wheel and pinch zoom (remembered), dozing on
  your feet when away, real hugs and high fives, rock paper scissors, the
  Robot dance (emote 8), sound effects, and smoother keyboard walking.
- **Kept from our side:** the free looks and the mall's clothes (the
  fork's clothes shop and its paid look pieces are not merged), and the
  vehicles: the fork's skateboard is now a fifth mall vehicle (180 coins,
  1.6× outdoors), with the fork's push-off animation.
- **Renumbered:** the fork's migrations follow ours (0017–0023), the
  ticket is item 900 (600 is a pet), the toys' emotes moved to 9–12
  (0024), the skateboard is item 704 (0025). Protocol v17 (MoveTo.sprint,
  EntityInfo.sprint_in and away, and the arcade, bar, pool, rock paper
  scissors and fishing messages).
- **One UI:** money reads in coins everywhere again (the fork had "$"),
  and the play pop-up and the pool and arcade windows use the game's paper
  panels; the game screens inside them stay dark.

Checked: every server test (API 34, sim 34, zone 54 with the fork's
arcade, pool, rock paper scissors and fishing tests, social 10); the
client's 76 tests (with the fork's pool and pinball physics vectors). In
the browser: into the arcade from its block and out of its door, a Pong
cabinet, the prize counter; into the bar, water from the bartender, the
pool table; the fisherman's board; zoom; a skateboard at its speed; a
sprint. 500 bots pass the perf gate.

Next: M8, polish (shopkeepers, music and lighting per department, a
crowded-mall bot test).

## Library L1 · Every book on a shelf: done (2026-10-22)

ADR 0012. The Library block's building is now a door: behind it, the
entrance hall and eight wings, holding all 78,383 Project Gutenberg texts
in every language, each one a spine on a shelf.

- **Catalogue:** `books` (migration 0026), filled by `library-import`
  from Gutenberg's `pg_catalog.csv` (texts only; titles, authors,
  languages, subjects, LoC classes, bookshelves). Re-running it adds new
  books to the New Arrivals case; `--reshelve` files everything. A full
  import takes about 20 s; a re-run with nothing new, 5 s.
- **Shelving like a real library** (`commons_sim::library`): other
  languages to World Languages (French, Finnish, German, Dutch, Italian,
  Spanish, Hungarian, Portuguese, Chinese, then the rest by name); English
  by class: juvenile fiction to the Children's Library, P to Literature,
  C–G History & Geography, B/H–L Philosophy, Religion & Society, Q–V
  Science & Technology, M–N Arts & Music, the rest Periodicals &
  Reference. Within a wing: class, author, title (articles ignored).
  Bookcases hold 100 (five shelves of twenty); wings are sized with a
  third to spare and the maps are generated from the same table.
- **The hall** (`library`): marble and a red runner, the circulation
  desk with the Librarian and two card catalogues, the eight wing doors
  along the north gallery, the Reading Room (long tables with green
  lamps; a nook, so chat stays there), New Arrivals, armchairs, a globe.
- **The wings** (`library_<wing>`): rows of bookcases facing south, an
  aisle in front of each, two banks either side of a central aisle (one
  in Arts & Music, with a reading corner), call-number signs at the row
  ends (the class, or the language in World Languages; tap for the
  range), carrels along the walls, reading tables by the door. The
  Children's Library has painted shelves and a story circle of cushions.
- **Browsing:** tap a bookcase to see it close up, every spine with its
  title; walk along the row with Previous/Next; tap a spine for the
  book's card (authors, language, subjects, classes, where it stands,
  and a link to read it at Gutenberg until L2 brings reading in).
- **The catalogue:** search title, author and subject in any language,
  filter by language, or a book number; "Show me" takes you to the
  wing, walks you to the bookcase, opens it with the book picked out and
  points a bookmark at the glowing spine.
- **Doors:** leaving a wing puts you at its door in the hall; leaving the
  hall, at the Library's door in the city. Indoors, birds no longer fly
  across the ceiling (in the mall, bar and arcade too).

Checked: server tests (API 35 with the catalogue test: arrivals, search,
the language filter, re-shelving and every route; sim 36 with shelving
order; mapgen: every bookcase and wing door reachable), clippy clean;
client 79 tests. In the browser: into the Library from the city, search
"pride and prejudice" and French-only "misérables", a card, Show me into
Literature with the spine marked, 100 spines on a full bookcase,
browsing along a row, a row sign, out to the Literature door in the
hall, World Languages (signs read FRE … FIN), the Children's story
circle, the Reading Room, and out of the Library's door; and the shelf
panel at phone width.

Next: L2, reading (fetch, clean, page and cache texts; the reader; your
place kept).

## Library L2 · Reading: done (2026-10-22)

Any of the 78,383 books can now be read in the game.

- **Fetching, politely** (`api/src/reading.rs`, migration 0027): the
  first time anyone opens a book, the API server fetches its plain text
  from Gutenberg (`LIBRARY_TEXT_URL`), one book at a time with a pause
  between (`LIBRARY_FETCH_PAUSE_MS`, 1.5 s), a proper User-Agent, a 24 MB
  cap; too many readers waiting gets "the stacks are busy". A book that
  can't be found is remembered as missing. Opening Pride and Prejudice
  the first time takes about 1.5 s; after that it's from our database.
- **Cleaning:** Gutenberg's header and footer come off (everything
  outside the `*** START OF` / `*** END OF` lines), so what's kept is
  plain public-domain text. Hard-wrapped prose is joined back into
  paragraphs; verse keeps its lines (long lines that all start with a
  capital are verse: The Raven), and so do headings and lists. A bracketed
  note over several paragraphs (`[Illustration: …]`) stays one.
- **Pages and contents:** cut at paragraph breaks into pages of about
  2,400 characters (an over-long paragraph at sentence ends); chapter
  headings (Chapter, Book, Part, Act, Letter, Stave, Canto, Chapitre,
  Kapitel, Capítulo, Luku …) make the contents, the printed table of
  contents ignored. `TEXT_VERSION` marks how a text was made: raise it and
  books are fetched and paged again as they're next opened.
- **The reader:** a paper page in a serif face, three text sizes, the
  contents to jump by, a page slider, page turns by button, arrow keys
  (the avatar stays put) or a swipe, the next page fetched ahead,
  pictures shown as their captions, Gutenberg's _italics_ as italics,
  "From the collection of Project Gutenberg" at the foot. Your place is
  kept a moment after each turn and the book opens there next time; the
  catalogue lists what you've been reading. The reader stays open as you
  walk, so you can take a book out to a bench.

Checked: server tests (API 41 with the reading routes against a stored
text: header gone, contents, place kept, a missing book, sign-in
needed; six cleaning and paging tests), clippy clean; client 79 tests.
In the browser, from Gutenberg itself: Pride and Prejudice (349 pages,
63 contents entries, chapter 34 by the contents, arrows turn pages,
reopens at page 180), The Raven's stanzas, Les Misérables in French,
Continue reading at the catalogue, and the reader at phone width.

Next: L3, reading together (what someone's reading on their name tag,
reading nooks).

## Library: stocked by itself (2026-10-22)

The books weren't showing in a fresh game: only the test database had
been filled. Now the API stocks the Library itself (`api/src/stocking.rs`):
when it starts with no books it downloads Gutenberg's catalogue and files
every book into the wings, then looks for new ones weekly (new arrivals go
to the hall's case; failures retry in an hour; `LIBRARY_AUTO_STOCK=false`
turns it off). `library-import` shares the same code. The catalogue desk
says the books are still being unpacked while it happens.

Checked: an empty database stocked to all 78,383 books, shelved in their
eight wings, 16 s after the API started; the main database is stocked.

## Library L3 · Taking books home, reading together: done (2026-10-22)

- **Borrowing** (`api/src/loans.rs`, migration 0028): Borrow on a book's
  card puts it on your library card, up to five for three weeks
  (borrowing again renews; past due, it's simply back). There are always
  more copies in the stacks, so anyone can borrow anything; while someone
  has a book out, its place on the shelf is a gap (in the world and,
  faded, in the bookcase panel) and its card says "On loan to N readers".
  Books stay in the library otherwise: leave with one open that isn't
  borrowed and it's put back, with a word about borrowing.
- **Your books:** a pixel 📚 button joins the HUD while you have books
  out, with how many; it lists them with your page and when they're due,
  to read anywhere (the park, home) or bring back.
- **Reading together** (protocol v18: `Reading`, `ReadingShown`,
  `EntityInfo.reading`): whoever has a book open holds it in both hands,
  its cover the book's colour, with 📖 by their name. Tap them: "What are
  they reading?" opens its card, and you can read the same book.
- Your place is kept as soon as you open a book, not only on a turn.

Checked: API 43 tests (borrowing: five, a sixth refused, renewing,
bringing back, the gap, the counts), zone 55 (reading shown, and to
newcomers), protocol vectors, client 82; clippy clean. In the browser
with two players: Ada borrows Pride and Prejudice, Bo sees the gap at
its place, Ada reads it and Bo sees it in her hands and 📖 on her tag,
taps her and opens the same book; Ada walks out to the city still
reading; Bo, who didn't borrow, has it put back at the door; Ada's 📚
list shows page 1 of 349 and due in 21 days; bringing it back clears
the button.

## Phone calls V1: done (2026-10-22)

ADR 0013. Buy a Mobile Phone (250 coins, Tools & Gadgets, now six
displays) and call your friends who have one; ring more friends into a
call, up to eight; answering while in a call moves you over.

- **Social gateway** (`calls.rs`): ringing (30 s, rate-limited), answer
  and decline, group calls, hanging up (and going offline), all checked
  against friendship, blocks and the age rules for everyone in the call.
  Pushes `call_ring`, `call`, `call_declined`, `call_unanswered`,
  `call_missed`, `call_ended`.
- **Voice through LiveKit**, self-hosted: a room per call; the gateway
  signs a two-minute pass for that room, talk-and-listen only
  (`commons_common::voice::LiveKit`).
- **Under-16s: built and off.** `COMMONS_VOICE_MINORS=false`: no phone
  sold to them, no calls to or from them. When on: under-16s only with
  under-16s, each switching calls on (`players.voice_ok`, migration 0029).
- **Client**: `livekit-client`; a 📱 HUD button once you own a phone (lit
  during a call), the phone panel (contacts with why someone can't be
  called, the call's members with who's talking, mute, add someone, hang
  up), an incoming-call card with a soft ringtone, the phone at your ear
  and 📞 by your name for everyone to see (protocol v19). Back on your
  call after a reload.

Checked: server tests (common: the age rules and the signed pass; social
13 with a call test: no phone, offline, ringing, answering, a third
joining, the under-16 refusals, hanging up to the end; API 44 with
"phones are for 16 and over for now"; zone 55 with the phone shown),
clippy clean, client 84. In the browser with a real LiveKit server and
three players (fake microphones): Ada calls Bo, both connected and
hearing each other, Bo sees Ada's phone at her ear; Bo rings Cy in, a
call of three, the talking indicator; mute; Bo hangs up, Ada and Cy carry
on; Ada hangs up and Cy's told it's over.

## Phone calls V2: removing people, a call log; coins from the well (2026-10-22)

- **Removing someone:** whoever started a call is its host (shown on the
  call; if they leave, whoever's been on longest takes over) and can remove
  anyone else, or stop ringing them. The gateway also asks LiveKit's room
  service to cut them off (an admin pass for that room only), so it holds
  whatever their client does; they're told who removed them.
- **Call log** (migration 0030): a line per person per call: out or in,
  talked / no answer / missed / declined / removed, everyone who was on it
  (or who you rang), how long. The phone's Recent tab, with a call-back
  button for one-to-one calls. Kept 90 days; never what was said.
- **Testing:** on a dev server (`COMMONS_DEV`), a wish at the wishing well
  grants 10,000 coins each time (`/api/dev/well`); elsewhere it's a 404.

Checked: social 14 (only the host removes, handing over, removing a ring,
the log for all three sides and a declined call), common (the admin pass),
API 45 (the well: twice on dev, not at all on a real server), clippy clean,
client 84. In the browser with LiveKit: a call of three, Bo (not the host)
has no Remove buttons, Ada removes Cy, LiveKit's rooms drop to two and Cy
is told; the Recent tab for Ada ("↗ Bo, Cy · 5 s") and Cy ("removed"); a
click on the well takes coins from 100 to 10,100.

## Clubs C1 · The Club Hall: done (2026-10-22)

ADR 0014. Clubs give people a reason to come back: a few friends with a
name, a crest, a room of their own and a board. Like everything players
hold, **club rooms are rented, never bought**.

- **The Club Hall**, a red-brick clubhouse strung with pennants on the
  block east of the Town Hall (`club_hall` in the city). Inside
  (`club_hall` zone) are the desk, the directory of clubs and the stairs
  up to the club rooms.
- **Founding** (`clubs.rs`) means renting a Club room for the first week
  (25 coins, paid by the founder through the new club's treasury). Each
  club needs a name (3 to 24 characters, filtered, unique among open
  clubs), a crest (16 to choose from) and a colour (8).
- **Rent from the treasury.** A club room is a lease like a home
  (`leases`, kind `club_room`, migration 0031). The sweeper charges the
  club's treasury, not a player, through `clubs::spend`, which is
  idempotent per charge.
  - When rent can't be paid: a grace period, with a notice to the owner
    and moderators. Then the room is given up, but the club itself
    carries on and can rent again.
  - Tiers: Club room (12 members, 25 a week) and Big club room (30
    members, 60 a week). Moving up costs the difference for this week.
  - Members chip in; `club_treasury_ledger` records every coin in and
    out.
- **Members:**
  - Invites go to friends only. Each player can be in up to five clubs.
  - Roles are owner, moderator and member. The owner can hand the club
    over, and the lease goes with it.
  - Leaving and removing members are supported. The owner can only leave
    by handing over or closing the club, and when the last member leaves,
    the club closes and its room is given up.
- **The board:** short posts, filtered like chat. The owner and
  moderators can remove any post; members can remove their own.
- **The room** is its own instance per club (`clubroom`, owned by the
  club, members only, checked through social `/internal/club_room`). It
  has the club's banner (its crest on its colour, with its name) and the
  board.
- **Client:**
  - A 🛡 HUD button (K), marked while an invite waits or rent is due.
  - One clubs panel for your clubs and invites, founding, the directory,
    the stairs, and a club's page (board, members, inviting, treasury,
    room and tiers, badge, leaving).
  - Join from the notification.
  - The crest of the club you show appears by your name for everyone.
    Badges are fetched in batches and refreshed when someone joins or
    leaves, or you change place.

Checked:
- Server: social 16, with the whole club lifecycle (founding and its
  rent, a taken name, invites only to friends, members can't invite,
  chipping in twice with the same key gives once, the board's rights,
  badges, members-only room, moving up, rent due then paid from the
  treasury, handing over, the last one out closing it). Also sim
  (mapgen: everything in the hall and room reachable), orchestrator, API
  45 and zone 55; clippy clean; client 84.
- In the browser, two players who are friends:
  - Owl walks into the Club Hall, founds "Night Owls" at the desk
    (100 → 75 coins) and invites Fox, who joins from the notification.
  - Both go up to the room (Owl by the stairs, Fox from the 🛡 panel).
    The banner shows the crest, colour and name, and each sees the
    other's crest by their name.
  - A post on the board.
  - Down the stairs to the hall, and out at the Club Hall's door.

## Merge: bowling, the arena, lucky crates and lures (2026-10-22)

From the fork (mancro5/commons): "Fishing 3.5 + Bowling" and "Lucky
Block, New Lamp+Lighting+Fixes".

- **What came in:**
  - The bowling alley: four lanes against the bot or a player, and the
    shoe counter.
  - The gladiator arena, out in the open.
  - Lucky crates that turn up around the city, to pick up and open from
    the bag.
  - The fisherman's glimmer lure, which draws rarer fish.
  - Followers now come through doors with whoever they follow.
  - New lighting, a digits font, and other fixes.
- **Fitted to the city:**
  - The fork placed these in the old park. Here, the bowling alley has
    its own block next to the Arcade (`bowling`, with its door), and the
    arena has the block south of the Town Hall (`arena`).
  - Two of the eight club lots became these blocks, so six remain.
  - The arena's inner band is paved, not stepping stones.
- **Renumbered:**
  - Protocol messages: ours first, then the fork's; protocol v25.
  - The fork's migrations are now 0032 (lure) and 0033 (lucky crate).
    0017 and 0018 were taken here.
- Every door now goes through the fork's `goTo`, so followers come along
  everywhere (the Library, the Club Hall, the mall). `main.ts` still
  works out where you come out.

Checked: all server tests (API 45, sim 49, social 16, zone 58 with the
fork's bowling and arena tests), clippy and fmt clean, client 88. In the
browser:
- Into the bowling alley, open a lane's game, and back out at its door.
- The arena's sign offers fight the bot, fight a player, or spectate.
- A lucky crate is out in the city.
- The clubs run still passes.
- No errors.

## Next: M5 · Crowds

Instancing, orchestrator routing by population, crowd LOD, slow mode,
mega-event broadcast over NATS, and a 10,000-bot festival test.
