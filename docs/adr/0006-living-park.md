# ADR 0006: A living park

Status: accepted · 2026-10-12

The park was functional but flat: a grid of straight paths, trees sprinkled
evenly, rectangular patches and silence. This batch makes it feel made, alive
and worth exploring, without adding server load.

## 1. An organic landscape, still generated

`mapgen` stays deterministic, but now composes the park from shapes instead
of rectangles:

- **Splines.** Roads and trails are Catmull-Rom splines stamped with a round
  brush, and the brook is the same brush with water. Where a path meets
  water it becomes a bridge.
- **Value noise.** Grass shading, meadow drifts, groves and the pond's
  shoreline come from smooth noise.
- **Reserved areas.** The scatter stays out of the plaza, the maze, the
  garden and anywhere near a path.
- **A hedge maze**, carved by a seeded depth-first search.
- **Saved state is untouched.** Everything with coordinates in the database
  stays where it was: garden plots, easels, chess tables, the town hall door
  and the corners.

The client softens tile edges in a second pass: rounded outer corners on
paths, water, sand and dark grass, and dithered seams between light and dark
grass.

## 2. Atmosphere is client-side and deterministic

None of this sends messages, and all of it agrees between players:

- **Weather** is a hash of two-hour UTC spells: clear, cloudy, rain, or mist
  in the morning. Everyone sees the same sky. Clouds cast soft drifting
  shadows; rain brings streaks, ripples on the water and a grey cast. Wind
  strength drives how much the trees and grass sway.
- **Biscuit the cat** follows a schedule derived from the wall clock: legs of
  80 s between favourite spots, walked with the same pathfinding every client
  runs, then a nap until the leg ends. Everyone sees Biscuit in the same place.
- **Fireflies, jumping fish and the soundscape** are local and random by
  design. The only ambient sound is birdsong by day, synthesised with
  WebAudio (water, wind, rain, crickets and the cat's purr were tried and
  removed: just birds keeps it calm). It can be muted (🔊 or M), and the
  choice is remembered.

## 3. Discoveries

Five things to find: the Old Oak, the wishing well, the heart of the maze,
the tiny door in the wood, and the fairy ring (walk into the clearing). Each
gives a line of story and counts toward "Discovery n of 5". For now they're
remembered per browser (localStorage). They belong in the player's saved
state later, alongside the album.

## 4. Pathfinding limit

Routes into the maze are long detours, so the A* expansion limit goes from
8,000 to 12,000 on both server and client. They must match, or the client's
prediction would disagree with the server. Measured with 500 bots: tick p99
3.07 ms (gate 20 ms).
