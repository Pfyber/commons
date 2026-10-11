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

## Next: M3 · Collect

The economy service and inventory (Postgres, idempotent grants, append-only
ledger), fishing, gardening, the album, and a home zone with furniture.
