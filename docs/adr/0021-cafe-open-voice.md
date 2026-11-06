# ADR 0021: The café, with open voice

Status: accepted · 2026-11-05

The Mossy Mug (the `bar` zone, in the Café block) becomes the town's café:
a bigger, cosier room, and the one place where **everyone inside hears
everyone**, like a real café. Phone calls (ADR 0013) are for friends; the
Concert Hall (ADR 0015) is one voice to many. This is the open room.

## The room

28×18 tiles (was 20×13). Wherever things moved, the zone server finds them
on the map (the pool table, the pinball machine), so nothing else changed.

- The long counter: beer taps at one end; the espresso machine, cups and a
  cake stand at the other. Shelves behind it: bottles, jars of beans, mugs.
  Seven stools in front. The barista (the old bartender) walks behind it.
  The menu now has coffee and tea (free; they're the server's `WATER`
  drink, so they sober you up), beer and water. You see ☕ or 🫖 as you sip.
- A chalkboard menu on the wall (tap it to read today's menu).
- The fireside: the fireplace, a rug, four armchairs (a new seat, `armchair`,
  in the server's and the client's furniture lists), a little table and
  cushions.
- Five café tables with a chair either side; the pool table; pinball in the
  corner; plants, barrels, lanterns.
- The city's signpost says the voice inside is open.

## Open voice

- **Warned before you go in.** Going through the café's door (or following
  someone in) asks first: *go in with the microphone on*, *go in muted
  (just listen)*, or *stay outside*. What you choose is carried into the
  café. If you get in another way (joining a friend, say), you're asked
  inside **before anything is heard**; "Not now" means no voice at all.
- One LiveKit room per café instance (`cafe-<instance>`). The social
  gateway (`crates/social/src/lounge.rs`) hands out passes that may talk and
  listen, only to those the zones' presence reports put in that café.
- Leave the café and the client hangs up. Every 5 s the gateway also takes
  out of the room anyone who's no longer in that café, so a client that
  doesn't hang up still stops hearing it.
- While you're in, a bar along the top shows who's talking (🗣️ by their name
  too), how many are listening, and buttons for your microphone, turning
  everyone down, and leaving or joining the voice.
- **Ages:** as with calls. Adults share the café's room. Under-16s hear
  nothing until `COMMONS_VOICE_MINORS` is on; then those who've switched
  voice on get a room of their own (`cafe-<instance>-u16`), never the
  adults'.
- **Blocks:** your pass lists everyone in a block with you (either way). The
  client never plays them, and lets only the others subscribe to your
  microphone (LiveKit's track permissions), so they can't hear you either.
  Block someone while you're both there and it applies at once.

## Routes

`GET /api/social/lounge` (in the café? may you use the voice?),
`POST /api/social/lounge/join` (a pass, and who's blocked),
`POST /api/social/lounge/leave`.

## Later

- A volume slider for each person, and a button to mute just one of them.
- Quiet corners: a booth whose voice only reaches the booth.
