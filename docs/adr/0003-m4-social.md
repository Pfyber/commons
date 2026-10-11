# ADR 0003: The social gateway

Status: accepted · 2026-10-11

## 1. A separate gateway that reuses the API as a library

`server/crates/social` is its own binary (spec §4.1: one persistent socket per
client, independent of zone). To share the economy and account code without
duplicating it, the API crate is now a library plus a thin binary
(`commons_api::{economy, store, auth, …}`). Gifts move items with the same
transactional, idempotent `economy::apply` that everything else uses.

## 2. Socket for pushes, REST for actions

The socket (`/api/social/ws?token=…`) only pushes small JSON events:
`presence`, `dm`, `notify`, and `friends` (refetch). Every action is a REST
call with an ordinary request/response and error message. Volume here is tiny
next to zone traffic, so JSON is fine and debuggable; the binary codec stays
for the zone hot path.

## 3. Presence

- Online means "has a social socket open".
- Location comes from zone servers: they report every arrival and departure
  (`POST /internal/presence`, fire-and-forget, bots skipped). Each report is
  timestamped, the gateway ignores reports older than the newest it has
  applied, and a departure only clears the location if it still matches. Two
  HTTP posts can arrive in either order, so this is what stops "left the park"
  from overwriting "arrived home".
- It's held in memory in one gateway process. With several gateways it moves
  to Redis plus NATS fan-out (M5).

## 4. Friendship rules

| Level | How | Unlocks |
|---|---|---|
| Friend (1) | request accepted (or both asked each other) | presence and location, join friend, direct messages, gifts, home invitations |
| Close friend (2) | 30 points; each gift is worth 10 | visit their home any time, no invite needed |

- Level 0 "acquainted" is reserved: it needs time-together tracking from zone
  servers, which isn't built yet.
- Home visits: always allowed for the owner and close friends; friends need an
  invitation, valid for 15 minutes. The orchestrator asks the gateway
  (`/internal/can_visit`, `/internal/locate`) before issuing join tokens.
- Blocking (spec §12) ends the friendship and pending requests, and stops
  requests, messages and visits both ways. The blocker's client also hides the
  blocked player's chat bubbles.

## 5. Gifts wait on the doorstep

Sending a gift takes the item from the sender and inserts a `gifts` row in one
transaction. Opening it marks it opened and grants it, also in one
transaction, so a gift can only be opened once. The recipient sees boxes in
front of their cottage door. Notifications (requests, gifts, invitations,
close friendship) are stored, so offline players get them later, and pushed
live when they're online.
