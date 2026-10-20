# ADR 0010: From one park to a city of blocks

Status: accepted · 2026-10-15

The world stops being a single park and becomes a city: a 7 × 7 grid of
blocks separated by streets, open from day one. This ADR records the
decisions and the migration plan; each step below leaves the game playable.

## Supersedes in the spec

- **§1 pillar 4, §9 (fog, slow voted expansion):** there's no fog and no
  locked land. Growth happens by renting, by clubs and by swapping blocks
  by vote (§ Block types). "Beyond the bridge" and the fog gate go away.
- **§3 (transitions only at gates, no seamless handoff):** the outdoor city
  is seamless. Transitions happen only at doors (interiors) and transit.
- **§7 topic corners and their boards:** removed. Clubs replace them.
- **§11 (one ≈96×96 founding park):** the park is one block of the city.

## Geometry

Configured in `assets/city/city.json`:

| | |
|---|---|
| Block | **48 × 48 tiles** (`block_tiles`, configurable) |
| Street | 4 tiles between all blocks and around the city |
| Pitch | 52 tiles; the city is 7 × 52 + 4 = **368 tiles** across |
| Interest cell | 13 tiles (divides the pitch: 4 cells per block) |

`server/crates/sim/src/city.rs` and `client/src/world/city.ts` implement it
identically (tests on both sides).

**Positions.** The wire and the simulation use **global `u16` tiles**: one
path grid across blocks, the same compact messages as today. A 20 × 20
city is 1,044 tiles across, and `u16` would allow more than 1,000 blocks
across. Storage and zone addressing use **block ID + local tile**
(`b3_3`, x, y). At these sizes plain world pixels are precise enough
(1,044 tiles is about 33,000 px); the client can draw relative to the
camera's block if cities ever grow far past that.

**Zone ownership.** Each block's zone owns the block and the near half of
the streets around it (all of the outer street at the city's edge).
Authority hands over at a street's centre line. Every tile has exactly one
owner (tested).

## Layout

```
 H  H  H  H  H  H  H        MK Market (spawn)
 H  Or CH Th CL Wo  H        ring 1: Pa Park (north), Po Pond (south),
 H  CL Mu Pa Ca CL  H                Mu Museum, Ca Café, Li Library,
 H  Ga Li MK Ci Cs  H                Ci Cinema, TH Town hall, Ar Arcade
 H  CL TH Po Ar CL  H        ring 2: Or Orchard & greenhouse, Wo Woods,
 H  Me CL Fa CL La  H                Me Meadow, La Lake, Th Theater,
 H  H  H  H  H  H  H                 Ga Gallery, Fa Fairground, Cs Casino,
                                     CH Club Hall + 7 CL club lots
                             ring 3: H, 24 home blocks × 7 homes = 168
```

The tram runs on the street between rings 2 and 3, with 8 stops (corners
and midpoints). Two metro lines (north–south, east–west) run under the
market hub.

**Home block:** three houses along the north edge, three along the south
and one on the west, each facing its street. Every lot has a front garden
patch, a garage-sale table and a postbox at the curb. A shared courtyard
in the middle (benches, garden beds) has a gate opening east onto the
street. House interiors are instanced, entered through the door.

## Block types (data-driven)

`assets/city/block_types.json` is the catalog: key, name, category,
whether it's enabled, swappable by vote, which plot kinds it offers for
rent, and whether it's instanced when crowded (Market, Theater,
Fairground). The future catalog (karaoke bar, dance club, bowling alley,
sports field, mini golf, disc golf, beach & pool, hot spring, ice rink,
haunted house, cooking school, photo booth, observatory, pet shelter,
player-designed escape room) is listed but disabled. Each block's contents
come from a layout file for its type, not from code.

## Decisions

| Topic | Decision |
|---|---|
| Homes | **Scarce**: 168 home lots plus apartments above market shops. No free fallback room. Without a lease there's no home interior; furniture and items wait in **personal storage**, gifts at the **post office** in the Market. |
| Renting | Everything players hold is rented, never bought: homes, apartments, stalls, club rooms and lots. Rent in coins on a configurable cycle (default weekly), by tier; upgrade by paying the higher tier, downgrade any time. Missed rent: a grace period, then release; items go to storage, never lost. Rent is a currency sink. Never payable with real money. |
| Clubs | Replace the topic corners. Founded at the Town Hall (≈10 signatures), then built with donated materials. Club Hall room → club lot → large ring-2 lot by tier; a club that can't pay moves down. Charter, moderators, board, treasury (member donations pay the rent), custom interior, style-kit exterior, lit windows when members are in. |
| Casino | Slots, roulette, multi-seat blackjack, poker between players (the house takes a small cut), a jackpot pool, big wins on the town board. Coins only; bet limits per game; casino-only cosmetics. **Open to all players for now.** Poker anti-collusion flags go to the Caretaker's report queue until juries exist. |
| Real money | Not now. Coins and materials are never sold. Items carry an `account_bound` flag reserved for later. |
| Landmarks | Museum, Café, Library, Cinema, Theater, Gallery launch as exteriors with simple interiors; their real content comes later. |

## Migration plan

| Step | What | Playable because |
|---|---|---|
| **C0** | Geometry, city and block-type data, this ADR. | No visible change. |
| **C1** ✓ | The whole city as **one zone** (368 × 368), spawn at the Market; client streams nearby blocks; long walks route along streets; a city map. Placeholder layouts with signs. Founders' Park stayed a separate zone behind the Park block's gate until C2. | Same server model as today. |
| **C2** ✓ | Today's content moves into its blocks (pond, orchard plots, town hall, arcade, woods grotto, meadow nooks, lake island, fairground stage, Founders' Grove). Corner boards removed. | Every feature keeps working in its new place. |
| **C3** ✓ | Home blocks per the layout, doors into instanced interiors, yards, courtyards, the post office. | Lots assigned free for now. |
| **C4** ✓ | Renting: tiers, leases, recurring rent, grace, release to storage, upgrade/downgrade; market stalls and apartments. | Nothing is lost on release. |
| **C5** | Tram and two metro lines: a 3–5 s ride or a tap on the station map; "Go home" at every station. | Same connection; the ride hides loading. |
| **C6** | **One zone actor per block** in one process: neighbour subscriptions, seamless handoff, sleeping zones, protocol v11 (city clock, process-unique entity ids). | The single-zone build stays as fallback until this passes the bot tests. |
| **C7** | Sharding: NATS (one subject per zone), the orchestrator's block→process map, a gateway holding each player's socket. | |
| **C8** | Instancing only for crowded blocks, chosen on approach, friends kept together, never bounced. | |
| **C9** | Clubs. | |
| **C10** | Casino. | |

Later: 20 × 20 and beyond with district hubs and more metro lines.

## Data model (planned)

- `city_blocks(id, bx, by, block_type, layout, rotation, ring, since)`:
  the live grid, so a vote can swap a block.
- Built in C4: plots are named in the map (`b0_3:5`, `apt:2`, `stall:4`)
  and tiers live in `assets/city/rent.json`; `leases(id, kind, slot, plot,
  player_id, tier, periods_paid, paid_until, grace_until, state)`,
  `rent_charges(lease_id, period, amount)`, `stall_listings`. Clubs will
  lease as tenants too (C9).
- `personal_storage(player_id, item_id, qty)`, `post_office(...)`,
  `interiors` and `interior_objects` (replace `home_objects`),
  `yard_items`, `sale_listings`.
- `clubs`, `club_members`, `club_treasury_ledger`, founding signatures.
- `transit_lines`, `transit_stops`.
- `casino_tables`, `casino_rounds`, `casino_bets`, `jackpot`,
  `collusion_flags`.
- Changed: `plots.space` becomes a block key, `founders.slot` is remapped,
  `quarters` / `board_posts` are archived and dropped.

## Risks

- **Seamless handoff (C6–C7)** is the hardest part: walks across edges,
  chat across edges, block corners (four zones). The single-zone city
  (C1–C5) ships first and stays the fallback.
- **Pathfinding** across 368 tiles needs a street-graph layer on top of
  tile A*, and client and server must still agree exactly.
- **NATS and Redis** are in the spec but not yet in the code (C7).
- **Casino open to all:** play-money gambling for minors is restricted in
  several countries and by app stores; revisit before any public launch.
- **Economy:** weekly rent needs reliable coin income or new players can't
  hold a home; simulate it before C4 goes live.
