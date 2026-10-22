// What the arcade's games and the Dance Off's music share (kept apart so
// neither module has to import the other).

/** Dance off: a beat every `BEAT_MS` (protocol `arcade::BEAT_MS`), for `DANCE_BEATS` beats (40 s). */
export const BEAT_MS = 500;
export const DANCE_BEATS = 80;

/**
 * Arrows on beat `b` of the dance (protocol `arcade::dance_notes`): none in
 * the count-in, every other beat for the first 12 s, then every beat.
 */
export function danceNotes(b: number): number {
  if (b < 2) return 0;
  if (b < 24) return b % 2 === 0 ? 1 : 0;
  return b < DANCE_BEATS - 1 ? 1 : 0;
}

/** Whether beat `b` may have an extra arrow half a beat on (`arcade::dance_half`). */
export function danceHalf(b: number): boolean {
  return b >= 52 && b < DANCE_BEATS - 2;
}

/** A small, fast, seeded random number generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
