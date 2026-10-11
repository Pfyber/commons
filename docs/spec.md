# Commons: Technical & Design Specification

> A calm, persistent 2D park-town MMO where players hang out, collect and create, and where the **community democratically governs and expands the world**. No feed, no algorithm, no ads.

This document is the source of truth for implementation. Build in the milestone order in §14. When a decision is not covered here, prefer: **simple > clever, server-authoritative for anything valuable, client-side for anything cosmetic.**

---

## 1. Product pillars

1. **Simple on the surface.** Walk, sit, chat, emote, fish, garden, play a table game. Enjoyable in the first minute.
2. **Deep if wanted.** Collections, crafting, stalls, roles, district founding, governance.
3. **Governed by players.** Proposals, votes, juries, councils. Voice grows slowly with time in game, is capped, and decays with absence.
4. **Slow, earned expansion.** New land is fogged; the community votes on it and builds it together with donated materials.
5. **Transparent and informative.** Public ledger of every decision, player-written town paper, visible history in the map itself.
6. **Massive crowds in hot spots.** A single plaza must handle thousands of simultaneous players without degrading (§6).

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Client | TypeScript, **PixiJS v8** (WebGL), Vite, PWA | Fast 2D batching, runs on mobile + desktop browsers, no install |
| Realtime servers | **Rust** (tokio, axum + tokio-tungstenite) | Predictable latency, high fan-out per core, no GC pauses |
| HTTP API services | **Rust** (axum), same Cargo workspace | Shared types with realtime, one toolchain |
| Wire protocol | Binary, schema in **FlatBuffers** (or hand-rolled with `bytes`), codegen for Rust + TS | Small packets, zero-copy decode |
| Transport | WebSocket (binary) v1; WebTransport datagrams as optional later upgrade for movement | Universal support first |
| Primary DB | **PostgreSQL 16** | Accounts, inventory, economy, governance, ledger |
| Hot state / presence | **Redis** (or Valkey) | Presence, session routing, rate limits, instance population |
| Event bus | **NATS** (JetStream for durable streams) | Cross-instance fan-out, mega-events, service events |
| Object storage | S3-compatible (MinIO self-hosted) + CDN | Player pixel art, map chunk files, assets |
| Observability | OpenTelemetry → Prometheus + Grafana, structured logs (tracing crate) | Required from M1, not later |
| Deployment | Docker Compose for dev; Kubernetes (or Nomad) for prod; zone servers as a scalable pool | Horizontal scaling of zone servers |

---

## 3. World model

```
World
 └─ District        (topic community: "Central Park", "Pixel Art Quarter")
     └─ Zone        (a map area of a district, e.g. 128×128 tiles; connected via gates/paths)
         └─ Instance (a parallel live copy of a Zone when population exceeds cap)
             └─ Cell (16×16 tile spatial-hash bucket for interest management)
```

- **Tiles:** 32×32 px art, top-down or 3/4 view. Map stored as chunked tile layers (ground, decor, collision, placeables).
- **Persistent world state is shared across instances of a zone** (gardens, buildings, boards, stalls, district decorations). **Presence is per instance** (who you see walking).
- **Zone transitions happen through gates/portals** (bridge, tram stop, district gate) with a short fade. This avoids seamless server handoff complexity and hides reconnects.
- **Fog:** unbuilt land beyond the map edge, rendered as soft fog. Becomes buildable only through the district/expansion process (§9).

---

## 4. Server architecture

```
            ┌──────────────┐        ┌───────────────┐
 Client ───►│ Edge / LB    │──HTTP─►│ API services  │──► Postgres
   │        └──────────────┘        │ (auth, inv,   │
   │                                │ economy, gov, │
   │ WS (social)                    │ districts)    │
   ├──────────►┌──────────────┐     └──────┬────────┘
   │           │ Social GW    │◄───────────┤ NATS
   │           │ friends,DMs, │            │
   │           │ notifications│            │
   │ WS (zone) └──────────────┘            │
   └──────────►┌──────────────┐◄───────────┘
               │ Zone servers │ (pool; each process hosts many instances)
               └──────┬───────┘
                      │ Redis (presence, routing, populations)
               ┌──────┴───────┐
               │ Orchestrator │ assigns instances → zone server processes
               └──────────────┘
```

### 4.1 Services
- **Auth service:** email magic link + OAuth (Google). Issues short-lived JWT + refresh token. Age gate at signup.
- **Router / Orchestrator:** `POST /join {zone_id, prefer_friend_id?}` → returns `{server_url, instance_id, join_token}`. Picks instance by: friend's instance > instance with friends > least-full instance under soft cap > spin up new instance.
- **Zone server:** authoritative realtime simulation for its instances (movement validation, emotes, proximity chat, table games, fishing outcomes, placeables). Single-threaded actor per instance, many instances per process (tokio tasks), pinned work-stealing runtime.
- **Social gateway:** one persistent WS per client, independent of zone. Friends presence, "join friend", DMs, gifts, notifications, town hall alerts.
- **Economy service:** the **only** place items/currency change. Transactional (Postgres `SERIALIZABLE` or row locks), idempotency keys on every mutation. Zone servers request grants ("caught fish X") via NATS request/reply; never mutate inventory themselves.
- **Governance service:** proposals, votes, elections, juries, voice weight computation, public ledger.
- **District service:** district lifecycle, charters, plots, construction pools, theme config.
- **Content service:** pixel-art uploads, town paper articles, boards; moderation queue.

### 4.2 Authority rules
- **Server-authoritative:** position validity (collision, speed), inventory, currency, votes, ownership, placements, game moves, fishing/garden outcomes.
- **Client-only (never synced):** ducks, birds, leaves, water, ambient NPC wandering, pet follow path, particle effects, idle animations.
- **Deterministic shared simulation:** frisbee/disc flights, thrown items. Server broadcasts one event `{thrower, origin, angle, power, seed, t0}`; every client simulates identically; server resolves outcome (landing cell, who caught) using the same simulation code compiled to WASM for client and native for server.

---

## 5. Networking protocol

### 5.1 Movement (the biggest bandwidth lever)
- Movement is **path-based, not stream-based.** Client sends `MoveTo {target_tile}` (click/tap) or short keyboard segments (≤ 3 tiles ahead, re-sent as keys held).
- Server validates path (A* on collision grid, speed limit), then broadcasts `MoveStart {entity_id, path[], speed, t0}`.
- Clients simulate motion locally from `t0`. No per-tick position updates for walking avatars.
- Server corrects with `Snap {entity_id, tile}` only on mismatch or teleport.
- Server tick: **10 Hz** for event batching; outgoing messages per client are batched per tick into a single frame.

### 5.2 Message catalogue (v1)
Client → Server: `Hello`, `MoveTo`, `Sit {seat_id}`, `Stand`, `Emote {id}`, `ChatSay {text}`, `Interact {object_id, action}`, `GameMove {table_id, move}`, `Throw {...}`, `FishCast`, `FishReel {timing}`, `Place {item_id, tile}`, `Pickup {object_id}`, `Ping`.

Server → Client: `Welcome {instance, self, cells}`, `CellEnter {cell, entities[], objects[]}`, `CellLeave {cell}`, `Spawn`, `Despawn`, `MoveStart`, `Snap`, `StateChange {entity, state}` (sitting, fishing, on_swing), `EmoteShown`, `ChatBubble`, `ObjectUpdate`, `GameState`, `ThrowEvent`, `CrowdDensity {cell, count, emote_counts}`, `WorldEvent` (festival start, stage show), `Pong`, `Error`.

### 5.3 Encoding
- Entity ids: u32 per instance (mapped from global UUID on spawn).
- Tile coords: u16 pairs. Times: u32 ms offset from instance epoch.
- Target: ≤ 24 bytes per `MoveStart` with a short path (paths > 8 nodes sent as compressed target + server-chosen path hash; clients recompute A* deterministically on the shared collision grid).
- Per-message compression off; per-frame `permessage-deflate` off (CPU cost). Rely on compact binary.

---

## 6. Scaling for massive crowds

**Targets**
- **Instance:** 250 fully-rendered avatars (soft cap), up to 500 hard cap.
- **Zone server process:** ≥ 5,000 connected clients across its instances on 8 vCPU.
- **Single hot spot (festival plaza):** 10,000+ simultaneous players experiencing one shared event.
- **Cluster:** 100,000 concurrent players via horizontal zone-server scaling.

### 6.1 Interest management
- Spatial hash of 16×16-tile cells. Client subscribes to the cells overlapping its viewport + 1-cell margin (typically 3×3 to 4×5).
- Server only sends events for subscribed cells. Cell membership changes trigger `CellEnter` / `CellLeave`.

### 6.2 Crowd LOD
When a cell exceeds **N visible avatars (default 40 per cell, 150 per viewport)**:
- Render priority: friends > people you're interacting with (same table, same picnic, chatting) > nearest > rest.
- Avatars beyond the cap are sent only as **`CrowdDensity`** (count per cell, aggregated emote counts) and rendered as low-detail **crowd silhouettes** placed procedurally on the client. Visually busy, near-zero bandwidth.
- Chat in crowded cells: only bubbles from prioritized avatars render; others shown as a "murmur" indicator. **Slow mode** auto-enables (1 message / 5 s) above threshold.

### 6.3 Instancing
- When an instance reaches soft cap, new joiners go to a new instance of the same zone. Instances shown as "Central Park · 2".
- Players can hop instances at any signpost; "join friend" always routes to the friend's instance (allowed to exceed soft cap up to hard cap).
- Empty instances merge: if an instance drops below 15% for 10 minutes, offer occupants a seamless move to a fuller one.

### 6.4 Mega-events (cross-instance shared moments)
For concerts, festival openings, election results, district openings:
- The **stage/performance is a broadcast stream** published on NATS subject `event.{event_id}` and replicated into every instance of the zone. Every instance sees the same performer, same countdown, same fireworks.
- Audience reactions aggregated globally: each instance publishes emote counts per second; a reducer publishes totals ("12,402 clapping"), shown as global crowd effects.
- Performer actions are `WorldEvent`s, so 10k+ players across 40+ instances get a shared experience while each instance stays within its cap.

### 6.5 Write path
- Zone servers keep instance state in memory. Durable changes (placements, garden state, board posts) go through the owning service via NATS with idempotency keys; zone server applies optimistic local update, rolls back on rejection.
- Shared persistent world state per zone is cached in Redis and pushed to all instances via NATS subject `zone.{zone_id}.objects`.

### 6.6 Load testing (mandatory)
- `tools/botswarm`: headless Rust bots speaking the real protocol, with behaviours (wander, sit, chat, emote, fish, crowd-at-point).
- CI performance gate: 1 instance × 500 bots, 10 Hz, p99 server tick < 20 ms, p99 outbound per client < 8 KB/s.
- Pre-release: 10,000-bot festival scenario across instances.

---

## 7. Activities

All activities must be satisfying, inviting, intuitive and cheap to sync. Column "Sync" is the network model.

| Activity | Player experience | Sync |
|---|---|---|
| Walk / explore | Click/tap or WASD | Path events |
| Sit | Benches, blankets, fountain edge, grass spots | State change |
| Emotes | Wave, laugh, clap, dance, sleep, cheer, heart | Discrete event |
| Proximity chat | Bubbles over head, radius ~8 tiles | Discrete, rate-limited |
| Table games | Chess, checkers, connect four, cards (later). Walk up to join/spectate | Turn events |
| Fishing | Cast, wait, timing mini-game (local); catch broadcast | Outcome event |
| Gardening | Personal + community plots; plant, water, harvest; grows over real days | Slow discrete events |
| Picnic blanket | Place, invite, add snacks, others sit | Placed object + seat list |
| Big screen | Synced video/stream, everyone on blankets | Timestamp sync |
| Music spot / DJ | Pick from licensed/royalty-free library; nearby players hear it locally | Timestamp sync |
| Frisbee / disc golf | Throw with angle + power; deterministic flight; holes in park | Deterministic event |
| Pets | Companion follows you; tricks; pets "greet" each other | Local follow + trick events |
| Playground | Swings, slide, sandbox stamps | State/animation events |
| Market stall | List items, others buy | Economy service |
| Pixel boards | 32×32 or 64×64 palette canvases on district walls | Content service, moderated |
| Town paper | Player-written weekly issues | Content service |

### 7.1 Ambient (client-only)
Ducks, birds, butterflies, falling leaves, wind sway, day/night lighting tied to the player's local time, seasonal palette swaps.

---

## 8. Progression & retention

### 8.1 Social
- **Friends list** with online status and current location; **join friend** in one tap.
- **Friendship levels** (Sky-inspired): Acquainted → Friend → Close friend. Unlocks DMs, home visits without invite, teleport-to.
- **Gifts** delivered to the doorstep of the recipient's home.

### 8.2 Collections
- **Album:** fish, plants, insects (later), event items. Completion stamps per page.
- **Town museum:** players donate first-of-kind finds; donor name on the exhibit.
- **Cosmetics:** outfits, hats, colours, avatar accessories.
- **Home furniture:** decorate a personal home (instanced private zone).
- **Limited items:** event-only items that never return. Visible event badges.

### 8.3 Rhythm
- Real-time growth (plants take real days).
- Seasons change the palette and ambient life.
- **Monthly festival** with exclusive items + one mega-event moment.
- Tiny daily gift (e.g. a daily flower) with no streak punishment.
- Hidden secrets: rare spawns, hidden rooms, easter eggs.

### 8.4 Economy
- **Materials:** gathered from activities (fish, flowers, wood, stone, clay). Used for crafting and community construction.
- **Coins (soft currency):** from selling at stalls or to NPC buyers. No real-money purchase of coins or materials in v1.
- **Sinks:** construction pools, crafting, district upkeep events, cosmetics from NPC shops.
- All grants/spends through Economy service with an append-only `economy_ledger`.

---

## 9. Districts (subreddit-style, on the map)

### 9.1 Lifecycle state machine
```
PROPOSED → FOUNDING → APPROVED → CONSTRUCTING → OPEN ⇄ GROWING
                                                  ↓
                                                QUIET → DORMANT → (REVIVAL) → FOUNDING
```
- **PROPOSED:** resident posts proposal at the town hall: name, purpose, draft charter, desired region, theme.
- **FOUNDING:** needs ≥ 10 founding signatures (configurable) from eligible residents within 14 days.
- **APPROVED:** passes a town-wide vote (simple majority, quorum per §10).
- **CONSTRUCTING:** a construction pool opens (materials target). Anyone can donate. Progress visible as scaffolding on the map.
- **OPEN:** opening ceremony (mega-event-capable). Contributors' names carved on the entrance stone.
- **GROWING:** residents vote to expand plot by plot; each expansion has its own construction pool.
- **QUIET:** activity below threshold for 30 days; lights dim, grass overgrows (visual only).
- **DORMANT:** below threshold for 90 days; becomes a walkable archive, read-only.
- **REVIVAL:** new founding circle re-opens it, keeping history.

### 9.2 District identity
- **Charter:** up to 7 short rules, voted by district residents. Shown on entrance sign. Enforced by district juries.
- **Theme:** chosen from preset palettes (tileset, colour grade, ambient sound, music set).
- **Signature building:** one per district (gallery wall, stage, reading room, workshop, tournament hall).
- **Unlockable activities:** districts choose activity modules fitting their topic.
- **Alleys (sub-districts):** side streets inside a district with their own name + mini-charter.

### 9.3 Map placement
- Districts radiate from the **founders' park** at the centre. New districts claim plots at the fog edge.
- **Adjacency suggestion:** proposal UI highlights plots next to related districts (tags), so regions form naturally.
- **Trams / lantern paths** connect distant districts to the central square; distance never punishes a district.
- **Central square signposts** show the liveliest districts right now (current population, upcoming events), never algorithmic ranking.

---

## 10. Governance

### 10.1 Phases (unlocked by population, not dates)
| Phase | Trigger | Rules |
|---|---|---|
| 0, Founding | Launch | **Caretaker** (dev team as NPC gardener) decides; every decision posted publicly as temporary with an end condition |
| 1, Equal voice | ≥ 50 players with ≥ 14 active days | One person, one vote for anyone with ≥ 7 active days |
| 2, Time-weighted | ≥ 300 such players and ≥ 90 days since Phase 1 | Voice weight formula active (§10.2) |
| 3, Self-governing | First council elected | Caretaker restricted to safety, legal, technical matters |

Current phase and next unlock condition shown on the **"Story of the Town"** board at spawn.

### 10.2 Voice weight
- **Active day:** ≥ 10 minutes present **and** ≥ 3 meaningful interactions (chat, game, gift, donation, etc.).
- `weight = min(4.0, 1 + log2(1 + active_days_last_365 / 30))`
- Decays naturally because it uses a rolling 365-day window.
- District votes use activity **in that district** only.
- Weights are public per vote (aggregated), votes themselves are secret.

### 10.3 Proposals
Types: `new_district`, `district_expansion`, `town_rule`, `event`, `public_building`, `charter_change`, `revival`.
- Lifecycle: draft → discussion (3 days, comments on the town hall board) → voting (4 days) → result.
- **Quorum:** 10% of eligible voice weight (town) / 20% (district).
- Passing: simple majority; charter changes and town rules need 60%.
- Rate limit: one active proposal per player.

### 10.4 Council
- Elected each season (3 months). 5 seats town-wide; districts may elect a 3-person district council.
- Powers: schedule events, set festival themes, tie-break, appoint temporary wardens. Cannot override votes or global rules.

### 10.5 Juries (moderation)
- A report creates a case. **5 random eligible residents** (trust tier ≥ Resident, not involved, not friends with parties) are summoned via notification.
- Verdicts: keep / hide / remove + optional sanction (mute 1 h, mute 24 h, district ban 7 d).
- Majority of responses within 2 hours; fallback to a larger pool, then council, then Caretaker.
- Sanctions are **local** (per district) except global-rule violations.
- **Global rules** (legal, safety, harassment, sexual content, minors' safety) are enforced by platform staff and cannot be overridden by any vote.

### 10.6 Trust tiers
Visitor → Newcomer (1 active day) → Resident (7 active days) → Steward (60 active days + no sanctions in 30 days).
- Visitor/Newcomer: walk, emote, chat (rate-limited), games.
- Resident: place objects, boards, stalls, vote, jury.
- Steward: propose districts, council eligibility.

### 10.7 Public ledger
Append-only `governance_ledger` table: every proposal, result, election, charter change, sanction count (anonymised), Caretaker decision. Browsable in-game at the town hall archive and via public read-only API.

---

## 11. Founding experience (cold start)

- **Tiny initial map:** one park (≈ 96×96 tiles): pond, chess tables, benches, garden plots, big screen, town hall, homes gate, one fogged bridge.
- **Caretaker NPC** gives the first three gentle tasks: catch a fish, plant a seed, sit with someone.
- **Founder badge** + **named seedling** in the central park for every first-season player; grows into a tree over real months.
- **First town vote:** name of the town, then what lies beyond the first bridge.
- **Gathering hours:** daily "evening at the fountain", weekly chess night, shown in the calendar.
- **Async traces:** gardens, stalls and doorstep gifts persist so solo visits feel inhabited.

---

## 12. Safety & content

- Age gate; under-16 accounts default to friends-only DMs and filtered chat.
- Text: profanity/abuse filter + rate limits + slow mode in crowds. Block and mute always available.
- Player art: **palette-constrained pixel canvases only** (no image uploads in v1). New boards visible to the author + friends until a short review window or community approval passes.
- No free-form voice chat in v1.
- Reports route to juries (§10.5) or staff for global-rule categories.
- GDPR: data export + account deletion; EU hosting.

---

## 13. Data model (core tables, PostgreSQL)

```
accounts(id uuid pk, email, created_at, birth_year, status)
players(id uuid pk, account_id fk, display_name unique, avatar jsonb, trust_tier, created_at)
activity_days(player_id, day date, district_id, minutes, interactions, pk(player_id, day, district_id))
friendships(a, b, level, since, pk(a,b))
items(id serial pk, kind, name, rarity, limited_event_id null, meta jsonb)
inventory(player_id, item_id, qty, pk(player_id, item_id))
economy_ledger(id bigserial, player_id, item_id, delta, reason, idempotency_key unique, at)
districts(id uuid pk, slug, name, state, charter jsonb, theme jsonb, tags text[], founded_at, last_active_at)
district_plots(id, district_id, region polygon, state, opened_at)
zones(id uuid pk, district_id, map_chunk_url, soft_cap, hard_cap)
construction_pools(id, target_type, target_id, requirements jsonb, progress jsonb, state)
contributions(pool_id, player_id, item_id, qty, at)
world_objects(id uuid pk, zone_id, kind, tile_x, tile_y, owner_id, state jsonb, updated_at)
garden_plots(id, zone_id, owner_id null, plant_item_id, planted_at, watered_at, stage)
proposals(id uuid pk, type, scope_district_id null, author_id, body jsonb, state, opens_at, closes_at)
votes(proposal_id, voter_id, choice, weight, cast_at, pk(proposal_id, voter_id))
elections(id, scope, season, state); candidacies(...); ballots(...)
jury_cases(id, scope, subject_ref, reason, state, verdict, created_at, resolved_at)
jury_members(case_id, player_id, response, responded_at)
sanctions(id, player_id, scope, kind, until, case_id)
governance_ledger(id bigserial, kind, ref_id, summary jsonb, at)
boards(id, district_id, tile, pixels bytea, palette_id, author_id, state, at)
paper_issues(id, issue_no, published_at); paper_articles(id, issue_id, author_id, body, state)
events(id, kind, zone_id, starts_at, ends_at, config jsonb)
```
Redis keys: `presence:{player}`, `instance:{zone}:{n}:pop`, `route:{player}`, `ratelimit:{player}:{action}`.

---

## 14. Repository layout

```
commons/
  client/                 # TS + PixiJS + Vite
    src/net/              # protocol codegen output, socket, interpolation
    src/world/            # tilemap, cells, crowd LOD renderer
    src/ui/               # HUD, chat, inventory, town hall, album
    src/activities/       # fishing, tables, frisbee, garden...
    src/ambient/          # ducks, birds, weather (client-only)
  server/                 # Cargo workspace
    crates/protocol/      # schema + generated types (Rust); TS gen target
    crates/sim/           # deterministic shared sim (frisbee etc.) → also builds to WASM for client
    crates/zone/          # zone server binary
    crates/social/        # social gateway binary
    crates/api/           # axum HTTP: auth, economy, governance, districts, content
    crates/orchestrator/
    crates/common/        # config, db, nats, redis, telemetry
  tools/botswarm/         # load-test bots
  tools/mapedit/          # (later) Tiled-compatible import
  infra/                  # docker-compose, k8s manifests, grafana dashboards
  assets/                 # tilesets, sprites, audio (source + exported atlases)
  docs/                   # ADRs, this spec
```

---

## 15. Milestones

Each milestone ends with: working build, tests passing, botswarm run, short demo notes in `docs/progress.md`.

- **M0, Skeleton:** workspace, protocol codegen (Rust + TS), docker-compose (Postgres, Redis, NATS, MinIO), telemetry wired, CI.
- **M1, Walk together:** auth, one zone, path-based movement, cells, spawn/despawn, emotes, proximity chat. Botswarm 500 in one instance passes perf gate.
- **M2, Hang out:** sitting, table game (chess), big screen sync, ambient life, day/night.
- **M3, Collect:** economy service, inventory, fishing, gardening, album, home zone with furniture.
- **M4, Friends:** social gateway, friends list, join friend, gifts, notifications.
- **M5, Crowds:** instancing, orchestrator routing, crowd LOD, slow mode, mega-event broadcast. 10,000-bot festival test.
- **M6, Govern:** trust tiers, activity days, town hall, proposals, voting, juries, ledger, phases, Caretaker tools, Story of the Town board.
- **M7, Expand:** districts lifecycle, construction pools, fog, plot claiming, charters, themes, signposts, trams.
- **M8, Live:** monthly festival framework, limited items, town paper, pixel boards with moderation, museum.

---

## 16. Art direction

- Simple, warm 2D pixel art, 32×32 tiles, limited palette per season, soft outlines.
- Avatars: small, readable at distance, strong silhouettes; modular layers (body, outfit, hat, accessory) composited into a per-player atlas at login.
- Crowd silhouettes: single-colour simplified avatar sprites with idle bobbing.
- UI: minimal, rounded, large touch targets; no persistent clutter. Emote wheel, chat, map, bag, town hall.
- Audio: gentle ambient loops per district theme; activity sounds satisfying and short.

---

## 17. Non-goals (v1)
Real-time combat, player collisions, physics piles, free image upload, voice chat, real-money currency, procedural world generation, native mobile apps.

---

## 18. Open questions (decide before M6)
- Final voice-weight cap and formula tuning after Phase 1 data.
- Founding signature threshold relative to population.
- Music licensing source for DJ spots.
- Whether instances of a zone should share proximity chat across instances during mega-events.