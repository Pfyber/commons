# ADR 0016: The metro

Status: accepted · 2026-10-23

The city is big (seven blocks across); the metro makes all of it near.
Nine stations, spread in a cross through the middle and the four corners
(Market; North, East, South and West Homes; Orchard, Woods, Lake, Meadow),
each an entrance on a block's south sidewalk beside its signpost: green
railings round stairs going down, and a round red M sign with the
station's name.

| Part | What |
|---|---|
| The map | At an entrance, a map of the city with the lines on it (a Ring line round the outside, two Cross lines through the Market) and every station, "you are here" marked. Tap a station (or its button) to ride. The city map shows the stations too. |
| The ride | Quick and free: the screen goes underground, a little two-car train with faces in its round windows rushes through the tunnel past the lamps, "Next stop: …" (about a second and a half; still for anyone who prefers reduced motion), and you come up the stairs at the station. |
| How | A ride re-joins the city at the station (`arrive: place:metro_<key>`, spot `door:metro_<key>`), the way doors work; the orchestrator only accepts `metro_` plus lowercase letters there. |
| Followers | Anyone following you rides along (the `Going`/`Went` messages carry the station) and comes up at the same station, then follows you on again. |
