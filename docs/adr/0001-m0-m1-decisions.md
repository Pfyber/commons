# ADR 0001: Decisions made while building M0 and M1

Status: accepted · 2026-10-11

## 1. Protocol schema as Rust macros, not FlatBuffers

§2 allows FlatBuffers or a hand-rolled codec with `bytes`. We declare messages
with two `macro_rules!` macros (`records!`, `message_enum!`) that generate the
Rust types and codec, plus a runtime schema. `gen-ts` turns that schema into
TypeScript.

- One source of truth, with no external compiler in the toolchain.
- The format is little-endian, with u16-prefixed strings and vectors and a
  1-byte message tag. A `MoveStart` with a 3-corner path is 24 bytes, meeting
  §5.3.
- Safety nets: a Rust test fails if the generated TS is stale, and the client
  tests decode Rust-encoded vectors and re-encode them byte for byte.

Revisit if we need schema evolution with optional fields; a version bump plus a
`VERSION_MISMATCH` reload prompt covers us until then.

## 2. `CellLeave { cell, ids }` instead of `CellLeave { cell }`

When a subscription drops a cell, the client has to remove exactly the
entities the server had in that cell. Clients can't compute that reliably:
cell membership is decided at server tick granularity, and an entity that
moved between two still-watched cells sends no message. Sending the ids (4
bytes each, only on subscription changes) keeps the client's entity set
provably equal to the server's model. That invariant is checked every tick by
`interest_sets_stay_consistent_while_walking`.

## 3. Paths as corner waypoints; no client-side A* yet

§5.3 suggests that for paths over 8 nodes the server sends the target plus a
path hash, and clients recompute A*. Collapsing straight runs to corner
waypoints already makes typical paths 2–4 nodes, and measured bandwidth is
3.3 KB/s per client at 500 bots (the gate is 8). The shared `sim` crate is
written to be deterministic (integer costs, fixed neighbour order, explicit
tie-breaking), so the hash scheme can be added once `sim` builds to WASM for
frisbee physics (M2+).

## 4. Movement starts 150 ms in the future

`MoveStart.t0 = now + 150 ms`. Most observers receive the message before the
avatar starts walking, so remote avatars don't jump forward by their latency.
The mover's own client sees the same delay, which suits a calm game.
Server-side position tracking uses the same `t0`.

## 5. Pong is answered by the connection task, not the instance tick

Clock sync needs an accurate server timestamp. Answering in the connection task
avoids up to 100 ms of tick-batching error. The client keeps the offset from
the lowest-RTT of its last 8 samples.

## 6. Auth storage in memory for M1

The auth service keeps accounts, magic links (hashed) and refresh tokens
(hashed) in a `Mutex<HashMap>`, so the M1 stack runs with no Docker and no
Postgres. The Postgres schema is already in `server/migrations`; the store
moves there in M3 alongside the economy service. Restarting the API signs
everyone out.

## 7. Join tokens are a separate token type

All tokens are HS256 JWTs with a `typ` claim checked before decoding. The
orchestrator mints 60-second `join` tokens naming the zone and instance, and
zone servers accept only those. Bots mint join tokens with the shared secret,
so the perf gate needs only the zone server.

## 8. Labels in DOM, sprites in Pixi

Names, chat bubbles and emotes are DOM elements positioned in screen space each
frame. They stay crisp at any zoom, render emoji natively and are selectable by
assistive tech later. Names show for the nearest 25 avatars only; crowd LOD
(M5) will cap rendered avatars anyway.
