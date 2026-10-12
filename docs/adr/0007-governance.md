# ADR 0007: Governance for launch (M6)

Status: accepted · 2026-10-12

The spec's governance (§10) assumes a population, but a launch has a few
dozen people. These are the launch decisions, made with the project owner,
and how they're built.

## Decisions

| Question | Decision |
|---|---|
| Who votes before Phase 1? | **Founding votes.** The Caretaker opens them (the town's name, what lies beyond the bridge). One person, one vote for anyone with ≥ 3 active days. |
| Votes with several options | **Ranked choice** (instant runoff). |
| Who proposes from Phase 1 | **Residents** (7 active days): town rules (60%), events, public buildings. One open proposal each. |
| Moderation at launch | **Reports go to the Caretaker.** Juries come once there are enough Residents. |

## How it works

- **Active days (spec §10.2).** Each zone server reports every player's time
  present and meaningful interactions once a minute: chat, games, fishing,
  gardening, placing furniture, jamming, painting. Bots aren't accounts and
  are left out. API actions (posts, donations, guesses, deliveries, votes,
  comments) count too. A day is active at ≥ 10 minutes and ≥ 3
  interactions; both are configurable (`COMMONS_ACTIVE_SECS`,
  `COMMONS_ACTIVE_INTERACTIONS`). Trust tiers are recomputed at every
  sign-in.
- **Phases** advance on population (`COMMONS_PHASE1_PLAYERS`, default 50
  players with ≥ 14 active days) and are checked every 30 s. Voice weight
  (`min(4, 1 + log2(1 + days/30))`) only applies from Phase 2.
- **Proposals** move through collecting (suggestions with support; the top
  eight go on the ballot) or discussion, then voting, then the result. Stage
  lengths are 3/3/4 governance days (`COMMONS_GOV_DAY_SECS`). A 30-second
  ticker advances them, and the Caretaker can end a stage early (it's
  recorded in the ledger). Quorum is 10% of eligible weight.
- **Secret ballots.** `proposal_voters` records who voted and
  `proposal_ballots` what was voted. The two tables share no key, so they
  can't be joined. Only the counts are shown, and running tallies are hidden
  during voting to avoid bandwagons.
- **Effects.** A passed `town_name` vote renames the town. A passed
  `bridge` vote opens a construction pool, using the town-goal mechanism, for
  the chosen place. The place itself is M7.
- **The public ledger** is append-only (a database trigger refuses updates
  and deletes). It records proposals, stage changes, results, phase changes,
  Caretaker decisions (posted as temporary, with an end condition) and
  moderation outcomes without names. It's readable without signing in.
- **Moderation.** Reports (from the avatar menu) go to the Caretaker's
  queue, with how many reports the person has had. The actions are dismiss,
  warn, mute 1 h or mute 24 h. A mute travels in the access token: the zone
  server refuses chat, and the API refuses posts, comments and proposals.
  It takes effect at the next token refresh (≤ 15 min) or rejoin. A mute in
  the last 30 days holds back Steward.
- **The Caretaker** is whoever's email is in `COMMONS_CARETAKERS` (comma
  separated). In dev, signing in as "Caretaker" works.

## Not yet

Juries (§10.5), council elections (§10.4), district-scoped votes and voice
(M7), and comment moderation tools beyond mutes.
