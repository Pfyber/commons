# ADR 0013: Phone calls

Status: accepted · 2026-10-22 · calls for under-16s built, **switched off**

Buy a Mobile Phone at the mall and you can call your friends by voice.
Anyone in a call can ring another friend in, so calls become group
calls; answering a call while you're in another moves you over. Others
see who's on the phone: the phone at their ear and 📞 by their name.

## How it works

| Part | Where |
|---|---|
| The phone | Item 950 `phone` (kind `gadget`), 250 coins at the mall's Tools & Gadgets shop; kept for good, not giftable. |
| Ringing, who's in which call, invites, hanging up | The social gateway (`social/src/calls.rs`): it already knows friends and who's online, and has a socket to every client. Calls live in memory, like presence. |
| The voices | **LiveKit** (open source, self-hosted): one room per call, `call-<id>`. The gateway signs a short pass (2 minutes, to connect) for that room only: talk and listen, microphone only, nothing else. |
| In the world | Protocol v19: `Calling` / `CallingShown` / `EntityInfo.calling`. |
| The client | `livekit-client`; `calls.ts`, the 📱 HUD button and phone panel, the incoming-call card with a ringtone. |

Why LiveKit: group calls need a server that forwards everyone's audio
(browser-to-browser "mesh" calls break down past three or four people,
especially on phones); LiveKit is that server, built for browsers, with
a JavaScript SDK. It handles difficult home networks itself, and it runs
on our own machines (in the EU), so nobody's voice goes through a third
party. `livekit-server --dev` runs it locally (`LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; an empty URL turns calls off).

## Who can call whom

- Friends only, both with a phone, the person you ring online; nobody in
  a call blocking anyone else in it.
- Up to eight in a call (counting those being rung).
- A phone rings for 30 seconds, then gives up; ringing is rate-limited.
- Going offline hangs you up. A call down to one person ends.
- Whoever started a call is its host and can remove people (the gateway
  asks LiveKit's room service to cut them off, so it holds even if their
  client doesn't play along). If the host leaves, whoever's been on
  longest takes over.
- Nothing is recorded. The call log keeps who called whom, how it went
  and how long it lasted, for 90 days; never what was said.

## Under 16

Built, tested and **off** (`COMMONS_VOICE_MINORS=false`, the default):

- While off, under-16s aren't sold a phone, can't call, and can't be
  called. Their phone screen says calls for under-16s aren't open yet.
- Once on: under-16s talk only with other under-16s, never with adults
  (age groups never share a call, checked against everyone in it). Each
  under-16 must switch calls on themselves (`players.voice_ok`, off by
  default), and switching off hangs up.
- The rules live in one place, `commons_common::voice::may_talk`.

Before switching it on: decide on parental consent (the switch could be
a parent's, not the child's), check the reporting and moderation path for
voice (today: block and report the person; nothing is recorded, so a
report rests on what's said about it), and review it against our safety
and privacy commitments.

## Milestones

| Step | What |
|---|---|
| **V1** ✓ | The phone; ringing, answering, declining; group calls and moving between calls; mute; the phone at your ear; the under-16 rules, off. |
| **V2** ✓ | The host (whoever started the call; whoever's been on longest, if they leave) removes people, cut off in LiveKit too through its room service; a call log (90 days). |
| V3 | Optional: voices of people standing near you in the world (proximity voice). |
