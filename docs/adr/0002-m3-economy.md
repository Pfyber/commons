# ADR 0002: The economy service and M3 persistence

Status: accepted · 2026-10-11

## 1. Postgres is required from M3 on; the API migrates it

Accounts, the item catalogue, inventories, the ledger, the album, garden plots
and home furniture live in Postgres 16. The API runs `server/migrations` on
startup (`sqlx::migrate!`), so a fresh empty database is all a developer or
deployment needs. Local development uses a native Postgres 16 install with a
`commons` role and database (see README). Docker Compose works the same way.

## 2. Zone → economy over HTTP, not NATS (for now)

The spec routes zone-server grants through NATS request/reply. M3 uses plain
HTTP to internal API endpoints (`/internal/*`), authenticated by a 60-second
`service` JWT signed with the shared secret. This keeps the local stack to
Postgres alone. The contract is what matters: zone servers never touch
inventory, every mutation carries an idempotency key, and the economy answers
with new totals. That maps one-to-one onto a NATS subject when M5 adds the bus.

## 3. Idempotency and atomicity

- Every economy change is one Postgres transaction writing one append-only
  `economy_ledger` row per delta, keyed `<key>#<n>`. The ledger is protected
  by a trigger against UPDATE and DELETE.
- A reused key returns the current totals with `duplicate: true` and changes
  nothing. A race between two requests with the same key is resolved by the
  ledger's unique index, and the loser also reports `duplicate`. The test
  `concurrent_duplicates_grant_once` fires 8 at once.
- Spending uses `UPDATE … SET qty = qty + delta` against `CHECK (qty >= 0)`.
  An upsert won't do here: Postgres checks the constraint on the proposed
  insert row first, which would reject every purchase.
- Compound actions (buy, plant, harvest, place, pickup) change the world row
  (plot, home object) and the inventory in the same transaction.
- Zone-side keys are `<kind>:<random instance prefix>:<counter>`, unique per
  instance lifetime. Client-side keys (market) are `crypto.randomUUID()` per
  press.

## 4. Who decides what

| Decision | Where |
|---|---|
| When a fish bites, what is caught | zone server (`roll_fish`; rarer catches with better timing, night-only fish) |
| Reel timing quality | client (a local mini-game, as the spec intends); the server enforces the bite window and a minimum score |
| Plant growth | `sim::garden::Growth`, a pure function shared by API (persisted) and zone (display) |
| Prices, catalogue | `items` table (`meta` JSON), loaded at startup by API and zone |
| Inventory, coins, album | economy only |

## 5. Gardens are per space and real-time

Plots are keyed by `space` (`founders_park` or `home:<player>`) and tile. A
plant advances one stage per period only if watered during that stage, and
neglect delays it rather than skipping stages. The period is 6 h in
production (`COMMONS_GROWTH_STAGE_SECS`); the dev script uses 60 s. In the
community garden, the planter gets the first 12 h after ripening to pick;
after that anyone can harvest.

## 6. Homes are owner-keyed private instances

Join tokens may carry `owner`. The registry keys instances by
`(zone, number, owner)`, and the orchestrator issues home tokens for your own
home only (friends' visits come with M4). Each instance has its own copy of
the collision grid, so placed furniture blocks movement, mirrored client-side.

## Known gaps

- Market proximity isn't enforced server-side (selling from afar is harmless).
- Several instances of the same zone don't yet share garden updates live;
  that needs the M5 event bus. They do share the persisted state.
- Bots don't fish or garden (their join tokens aren't real accounts).
