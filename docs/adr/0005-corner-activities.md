# ADR 0005: Corner activities

Status: accepted · 2026-10-12

Each topic corner gets one activity aimed at something people miss today:
playing, making music and making things together, with no metrics.

| Corner | Activity | Live part | Saved part |
|---|---|---|---|
| Music | Bandstand jam | zone relays `JamNote` | none |
| Art | Shared easels + gallery | zone relays `Paint` | API: `easels`, `gallery` |
| Sports | Kickabout | zone simulates the ball | none (scores reset with the instance) |
| Games | The town word | none | API: `word_guesses` |

## Jam: shared beat, pentatonic pads

Musicians can't play in time over the internet, so the server's clock is the
metronome. A note is scheduled for the first beat at least 90 ms ahead
(`BEAT_MS` = 125, a sixteenth note at 120 bpm). The beat number travels with
the note, and listeners schedule it on the same beat, so everyone hears it at
the same moment as long as their latency is under the lead. The eight pads
are a pentatonic scale, so any combination sounds good. That's the point:
strangers sound like a band without any skill. Sound is synthesised with
WebAudio, with no samples. Notes are only accepted near the bandstand, and
volume falls off with distance.

## Easels: live relay through the zone, saving through the API

Strokes go to the zone server, which relays them to people nearby so they
appear live, and in batches to the API, which saves the canvas. The canvas is
shared by every instance and survives restarts. The world easels show the
current painting, so a lone visitor sees what others left behind and can
carry on. Hanging a painting credits everyone who painted on it since the
last hanging. There are no likes and no view counts.

## Ball: server-simulated, sent only when something happens

The ball moves with a closed-form friction model (`BALL_FRICTION`). The
server sends its position and velocity at `t0` only on kicks, bounces and
goals, and clients evaluate the same formula in between, so it costs about
nothing on the wire. Walking into the ball kicks it the way you're walking;
standing still blocks it, so a goalkeeper works. Goal mouths come from the
map's two `goal` objects. Measured with 500 bots: no change to tick time.

## Town word: cooperative, not competitive

One word a day for the whole town, with a shared pool of 30 guesses (6 per
person, a short gap between them). Every guess stays visible, so each visitor
builds on the last. That makes it work with few players and reward coming
back. When it's solved, everyone who guessed that day is rewarded, and the
solver gets a little more, so helping is worthwhile.
