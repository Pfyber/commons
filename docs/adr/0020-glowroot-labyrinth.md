# ADR 0020: The Glowroot Labyrinth

Status: accepted · 2026-11-05

A reason to come back each day that's the same for everyone (so the town
can talk it over), costs nothing to author, takes real effort, and suits a
calm park-town: no combat, no timer, no streak to lose. Fine alone; better
with friends; helping whoever comes after you is part of it.

## Getting there

- The sundial at the **heart of the hedge maze** (`maze_heart`, in the
  Woods) hides a stair. Tap it once you've reached the heart (within two
  tiles) and you go down into **today's labyrinth**, at the foot of its
  stair. Anyone following you comes too.
- Back up by the stair (the HUD's Leave button walks you there) or the
  **Glowroot**. Either way you come out beside the sundial
  (`arrive: place:maze`; the city has no `door:maze` spot, so the zone
  server falls back to the `maze_heart` object).

## The expedition

- **The goal:** the Glowroot, the way back up, in a **sealed chamber** (3×3
  cells) at the very centre. Its only way in is the **Great Gate**.
- **Heartstones** (rose, amber, violet): the furthest cells (on foot) in the
  north-west, the north-east and the southern corners. Touch each to be
  **attuned** (yours, for the day). The Great Gate opens for anyone attuned
  to all three, and stays open while they're by it, so whoever's with them
  walks in too: a friend who's done the legwork can bring you.
- **Wisps** (10): pale lights drifting back and forth along the longest
  straight corridors, weaving from lane to lane. Touch one and it blows your
  light out: you wake by the **last lantern you passed** (the stair, if
  none), with four seconds before one can have you again. Never over quest
  spots or rune stones.
- **Sleeping lanterns** (20, at crossings): walk past one and it lights for
  **everyone** there today; each is also your checkpoint.
- **Root gates** (6): shortcuts through walls between cells that are close
  as the crow flies but far apart on foot.
  - *Timed*: a rune stone one cell back opens it for 6 s. Run.
  - *Twin*: two rune stones in front of it; it opens while both have
    someone on them (and 8 s after). A real co-op shortcut.
  The maze never needs them.
- **Lost glimmers** (8, in the deepest dead ends): each yours once a day,
  10 coins. The Glowroot: 100 coins the first time each day, and everyone
  down there hears you found it (and how many did before you).
- It's always dusk (`DayNight` with a fixed hour): lanterns glow, fireflies
  come out; no weather, no birds, **no minimap**, and no zooming far out
  (`Scene.closeView`): the maze is for finding your way through, not seeing
  from above. Everyone carries a soft light, so you see others coming.
  Heartstones and the Glowroot glow from far off, something to head for.

## A new maze every day

- `commons_sim::labyrinth::generate(day)`: `day` is days since 1970-01-01,
  UTC. Pure integer maths (xorshift32, fixed neighbour orders), so the zone
  server and the API make the same maze. 25×25 cells (82×82 tiles), each a
  2×2 floor with a wall line between: corridors two tiles wide.
- Carved by a depth-first walk round the chamber; about a quarter of the
  dead ends then opened on through (loops). Four **glades** (2×2 cells as
  one room) with a pool, log seats and mushrooms.
- Wisps move by the **instance clock** with `labyrinth::wisp_at` on the
  server and `wispAt` on the client: the same sums, with a test on each side
  pinning the same numbers.

## Zones and instances

- The zone is `labyrinth`, but there's no map file: the orchestrator joins
  you to `labyrinth` with `owner` = today's day (`"20762"`), so each day has
  its own instance. The registry makes that day's `ZoneDef` on first visit
  and lets past days go (`labyrinth::open`: yesterday, today, tomorrow).
- The client fetches the day's map from `GET /api/labyrinth/{day}` (the
  ticket's `owner`), `Cache-Control: no-cache` so an update that changes
  the generator can't leave a browser walking yesterday's walls.
- Gates are collision: shut, their two tiles are blocked; open, the zone
  server clears them in its grid and tells everyone (the client clears them
  in its map too). A gate never shuts on someone standing in or by it.
- `load_home` now runs only for homes and club rooms (an owner is no
  longer always a player).
- Rewards are keyed by day and player (`lab:<day>:<player>:glimmer<n>`,
  `…:out`), paid once a day whatever happens. A server restart forgets
  what was lit, opened and attuned; never who was paid.
- Protocol (v43): `LabState { lit, gates, found, attuned, finishers, out }`
  to newcomers; `LabEvent { kind, id, n }` (`lab::LIT`, `GLIMMER`, `OUT`,
  `ATTUNED`, `GATE_OPEN`, `GATE_SHUT`, `CAUGHT`).

## Later

- A board at the Glowroot with today's first few names.
- Seasonal labyrinths (snow on the walls in winter, blossom in spring).
- Chalk: marks you leave on the floor for whoever comes after.
- The 3D view down here (ADR to come).
