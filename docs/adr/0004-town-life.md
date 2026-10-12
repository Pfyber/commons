# ADR 0004: Town life for a quiet launch

Status: accepted · 2026-10-12

At launch the park will often hold only a handful of people. This batch
gives a lone player things to do, and gives a small group a shared sense of
"town", without faking a population.

## 1. Quarters start as corners of the park

The spec's districts (§9) are topic communities founded by vote. With few
players, separate districts would feel empty, so the first four topics (Sports,
Art, Music, Games) start as **corners of the founders' park**: a landmark plus
a board. A corner that gets busy can later become its own district through the
normal `new_district` proposal. Politics waits until M6, when trust tiers and
juries exist.

- **Membership:** a player can join any number of quarters
  (`quarter_members`). Posting in a quarter joins it. Per-district voice
  weight (spec §10) will come from this.
- **Boards:** short posts (≤ 280 characters), cleaned like chat and
  rate-limited (one every 20 s, 30 a day). `#tags` are taken from the text
  (at most three).
- **Streets forming:** a tag used by ≥ 8 different people in 21 days is
  flagged "street forming", the signal for an alley (spec §9.2) to be proposed
  later. It's based on real activity, not petitions. Both thresholds are
  constants in `town.rs`.

## 2. Town goals go through the economy

Donations are economy operations (`reason = town_goal`). That makes them
idempotent per button press, keeps them atomic with the goal's total (one
transaction, with the goal row locked), and stops them overspending. A
donation never overshoots: only what the goal still needs is taken. Goals
open one after another (`seq`). Reaching one changes the park for everyone:
lanterns around the fountain, wildflowers along the paths, fireworks over the
pond at night. The effects are drawn client-side from the list of reached
goals.

## 3. Daily requests need no table

Each day's three requests are derived from the UTC date with a hash, so every
server and client agrees on them. Delivering one is a single economy
operation whose idempotency key includes the player, the day and the request
number, so it can only be done once a day. Rewards are about 1.6 × the market
price + 10 coins: more than selling, so the requests are worth doing.

## 4. The Park Elder is honest

The computer chess opponent is never disguised as a player. It is shown as
"Park Elder 🧓", is never an avatar or a presence, and only plays when someone
sitting alone asks it to (`GameMove "elder"`). It gives its seat up as soon as
a real person sits there, which starts a fresh game between the two people,
and it leaves when the table empties. Its strength is deliberately gentle: it
looks two plies ahead on material only, with a little noise, so it doesn't
hang pieces but can be beaten.
