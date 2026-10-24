# ADR 0017: The Casino

Status: accepted · 2026-10-23 · K1, K2 · **16 and over** (`COMMONS_CASINO_MINORS`, off)

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
| **Limits:** bets of 1–20 coins on slots, 1–50 on roulette (100 a spin at most) and 1–50 a blackjack hand, and a **daily loss limit** (300 coins a day, by UTC day): a bet that could take you past it is refused. Bets on a table count from when they're placed. | Coins pay rent; nobody should lose their home at the slots. |
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

## K2: the tables are shared

The casino is social. Every casino instance has one roulette wheel and
two blackjack tables (`social::tables`), held in memory and pushed live
(`{t: "casino_tables"}`) to everyone in that instance. You can play alone,
or with whoever else is there, as in a real casino.

- **Roulette:**
  - Everyone bets on the same spin. The first chip opens betting for 20
    seconds, and anyone can add chips; each player sees everyone else's.
  - When everyone who has bet presses "Spin!" (alone, that's at once), or
    time's up, the wheel spins. Everyone watches the same spin land, and
    every chip is paid.
  - The solo roulette from K1 is gone.
- **Blackjack:**
  - Two tables of five seats each, against the dealer. Six decks; the
    dealer stands on 17 and peeks for blackjack; blackjack pays 3:2; you
    can double on your first two cards. There's no splitting or insurance
    yet.
  - Seated players bet, and the hand is dealt when all of them have, or
    15 seconds after the first bet.
  - Players act in seat order, with 20 seconds a turn; after that, the
    seat stands. The dealer's hole card stays face down until every player
    is done, and the shoe is never sent to clients.
  - Anyone can watch. A player who leaves the casino gets their undealt
    bet back; a hand already in play stands and is paid.
- **The coins:**
  - A table bet leaves the player's coins when it's placed, as an
    unsettled `casino_rounds` row, and is settled when the round ends.
    That way the daily limit counts bets that are on the table.
  - If the gateway restarts mid-round, every unsettled bet is refunded.
- **Big wins are told to the whole floor:** a slots line of 20× or more,
  a straight-up roulette number, a blackjack.

### The roulette table, as a real one

The roulette table plays like the one in a casino, together:

- **The felt:**
  - The window shows the layout: 0, the numbers, the dozens and the
    even-money boxes. Tap a box to put your chip there.
  - Every player's chips show on the felt in their own colour (the same
    on every screen), with a list of who's playing and their totals.
  - "Same bet" backs a friend's latest bet with your chip.
- **The board:** the last 12 numbers, newest first.
- **The room:** the table shows the chips on its own felt and the ball
  racing round the wheel, so anyone walking by can watch. After a spin, a
  marker shows the number that came up.
- **The croupier** behind the table calls the game: "Place your bets,
  please!", "Last bets…", "No more bets!", "17, black! Ada wins 360!".
  Winners get a 🎉 over their heads. Tap the croupier for tips, and for
  the table.
- **Fresh state:** every table update carries a sequence number. A
  client ignores a reply that left the server before news it has already
  had, so a late "Spin!" reply can't roll the wheel back and hide a
  win.

Later: **K3** poker between players
(the house takes a small cut, collusion flags to the Caretaker), a jackpot
pool, big wins on the town board, casino-only cosmetics.
