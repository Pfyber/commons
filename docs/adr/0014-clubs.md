# ADR 0014: Clubs

Status: accepted · 2026-10-22

People stay for people who expect them. A club is a small group with a
name, a crest and a room of its own in the Club Hall, a board, a weekly
meetup and goals it works on together. Clubs bring together what's
already here (group calls, the library's reading, fishing, gardens, the
arcade and the pool table) as things members do *together*.

ADR 0010 already set the rules: clubs replace the old topic corners, and
like everything players hold, **club rooms are rented, never bought**;
the members' donations to the club's treasury pay the rent. This ADR fills
in the details; where they differ from ADR 0010's sketch (founding by ten
signatures at the Town Hall), this one wins: anyone can found a club by
renting a room, and the rent itself keeps clubs meaningful.

## How it works

| Part | What |
|---|---|
| Founding | At the Club Hall's desk: a name, a crest and a colour, and the first week's rent for a club room, paid by the founder into the club's treasury. The founder is the club's owner. |
| Rent | A lease like a home's (`leases`, kind `club_room`, `assets/city/rent.json`): weekly, by tier, paid **from the club treasury**. Can't pay: a grace period and a notice to the owner and moderators, then the room is given up. The club itself carries on (members, board, treasury) and can rent a room again. |
| Treasury | Members donate coins (`club_treasury_ledger` records every coin in and out). Coins in the treasury belong to the club; they're never paid back out to players. |
| Tiers | Club room (up to 12 members) and Big club room (up to 30). Upgrading charges the difference for this week; downgrading is free if the members still fit. Club lots in the city (the fenced `club_lot` blocks) come in C3. |
| Members | Invites only, and only to your friends (so clubs grow along friendships). Up to five clubs each. Roles: owner, moderators (invite, remove members, pin), members. |
| The room | Its own zone instance (`clubroom`, one per club, like a home), reached from the Club Hall; members only. The board, the crest banner; decorating together in C2. |
| Badge | Your club's crest by your name, for the club you choose to show. |
| Board | Short posts for members, filtered like chat; the owner and moderators can remove any. |

## Care

- Invites go only between friends; club boards and room chat are filtered
  as chat is everywhere. Block and report work in clubs as anywhere.
- Under-16s can be in clubs like anywhere else in the town; before clubs
  open to strangers (public events in C3) this needs the same review as
  phone calls (ADR 0013).

## Milestones

| Step | What |
|---|---|
| **C1** | The Club Hall (enterable, with its desk and directory); founding by renting a room; the treasury and rent; invites, roles, leaving and removing; the board; the club room; badges by names; a 🛡 button for your clubs. |
| C2 | Weekly meetups (a time, reminders, a reward for showing up), club goals, a club call that rings everyone online, and decorating the room together. |
| C3 | Club lots in the city as the big tier; a weekly club leaderboard at the Club Hall; clubs hosting events open to everyone. |
