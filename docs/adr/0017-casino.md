# ADR 0017: The Casino

Status: accepted · 2026-10-23 · K1 · **16 and over** (`COMMONS_CASINO_MINORS`, off)

The Casino block was a placeholder ("opening soon"). ADR 0010 sketched it
(slots, roulette, blackjack, poker, a jackpot, coins only) and flagged the
risk: play-money gambling for minors is restricted in several countries
and by the app stores. This ADR builds it, carefully.

## Rules that hold for every game

| Rule | Why |
|---|---|
| **Coins only, never real money.** Nothing in the casino can be bought or cashed out for money, now or later. | It's a game in a game. |
| **16 and over**, as live voice is (ADR 0013): the orchestrator turns under-16s away at the casino's door and the games refuse them. `COMMONS_CASINO_MINORS=true` opens it to everyone. | The app stores and several countries restrict simulated gambling for minors. |
| **Every outcome on the server** (`commons_sim::casino`, the OS's random numbers). Clients only show what happened. | Nobody can cheat it. |
| **The house edge is small and known**: slots return about 95 % of what's bet, roulette (one zero) 97.3 %, both checked exactly by tests. | Fair, and it says so on the machines. |
| **Limits:** bets of 1–20 coins on slots and 1–50 on roulette, and a **daily loss limit** (300 coins a day, by UTC day): a bet that could take you past it is refused. | Coins pay rent; nobody should lose their home at the slots. |
| **Take a break:** at the cashier's desk, close the casino to yourself for a day or a week (it can't be undone early). After 30 minutes playing, a gentle reminder of how long and how today's gone. | Care, built in. |

## K1 (this step)

The building on the Casino block (marquee, card-suit windows); inside
(`casino` zone), six slot machines, a roulette table, the cashier's desk
(the rules, the limits, today's net, taking a break) and the way out.

- **Slots:** three reels of 🍒 🍋 🔔 ⭐ 💎 7️⃣ (weighted 9, 8, 6, 5, 3, 2).
  Three alike pay 5× (cherries), 10×, 20×, 40×, 90× and 250× (sevens); two
  cherries pay 2×. That returns 95.1 % of what's bet, and about one spin
  in five wins something. The reels spin and stop one by one.
- **Roulette:** a single-zero wheel. Red or black, odd or even, 1–18 or
  19–36 pay 1:1; a dozen pays 2:1; a single number 35:1. The wheel spins
  and the ball lands.
- Every round is recorded (`casino_rounds`): game, bet, payout, outcome.

Later: **K2** blackjack at shared tables; **K3** poker between players
(the house takes a small cut, collusion flags to the Caretaker), a jackpot
pool, big wins on the town board, casino-only cosmetics.
