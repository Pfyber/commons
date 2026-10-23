# ADR 0015: The Concert Hall

Status: accepted · 2026-10-23 · under-16s neither perform nor hear live
voice yet (as ADR 0013)

One player on stage, everyone in the hall listening: a place to sing, play
an instrument, read a story aloud or host a quiz, and a reason to gather at
a time. It stands on the Theater block of the city (until now a
placeholder), and clubs can hold their events there (ADR 0014, C3).

## How it works

| Part | What |
|---|---|
| The hall | Its own zone (`concert_hall`), behind its door on the Theater block: a stage with a microphone stand at the front, rows of seats facing it, the way out at the back. Each instance of the hall has its own stage. |
| Taking the stage | At the microphone stand, anyone 16 or over can take the stage while it's free, for up to an hour. They step up onto it, 🎤 shows by their name, and the stage lights up with their name for everyone in the hall. |
| Who hears whom | Voice goes through LiveKit, as calls do (ADR 0013), in a room per stage. The performer's pass may talk; everyone else in the hall gets a **listen-only** pass (`canPublish: false`, so LiveKit itself refuses their microphone): they hear the performer and nobody else. Listeners can turn it down or mute it for themselves. |
| Ending | The set ends when the performer steps down, leaves the hall, or the hour is up; then the gateway removes them from the voice room, so nothing they send carries on. The next person can take the stage. |
| Passes | Only for someone the zones report as in that hall instance (the social hub's presence), never on a client's say-so. |

## Care

- Performing is for 16 and over. Listening follows ADR 0013's age rules
  (`voice::may_talk` between the performer and each listener): with
  `COMMONS_VOICE_MINORS` off, under-16s see who's on stage but hear no
  live voice; switched on later, the same rule as calls applies.
- Listeners never send audio. The performer is one named, visible player,
  in a public place; reports and blocks work as anywhere (a listener who
  blocks the performer isn't given a pass for them).
- An hour at most, so the stage can't be held.
