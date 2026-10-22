// Path motion: a TypeScript mirror of server/crates/sim/src/motion.rs.
// Keep the two in lockstep; motion.test.ts pins the shared expectations.

export interface TileXY {
  x: number;
  y: number;
}

export interface Motion {
  path: TileXY[];
  t0: number;
  speedX10: number;
  /** A walk that breaks into a sprint this many ms after `t0` (0 or absent: never). */
  sprintIn?: number;
}

/** Walking speed in tenths of a tile per second (sim::WALK_SPEED_X10). */
export const WALK_SPEED_X10 = 40;
/** On a skateboard (sim::SKATE_SPEED_X10). */
export const SKATE_SPEED_X10 = 82;
/** Sprinting (sim::SPRINT_SPEED_X10): asked for by the player, outdoors. */
export const SPRINT_SPEED_X10 = 58;

/**
 * Mirror of the server's sprint_profile: a sprint starting at `t0`; joining a
 * walk in progress (`spliced`, its stretch begun in the past), it keeps that
 * walk's pace up to `now` and speeds up from there, so there's no jump.
 */
export function sprintProfile(spliced: Motion | null, t0: number, now: number): { speedX10: number; sprintIn: number } {
  if (spliced && !sprintingAt(spliced, t0) && now > t0) return { speedX10: WALK_SPEED_X10, sprintIn: Math.min(65535, now - t0) };
  return { speedX10: SPRINT_SPEED_X10, sprintIn: 0 };
}

const segLen = (a: TileXY, b: TileXY) => Math.hypot(b.x - a.x, b.y - a.y);
const msPerTile = (m: Motion) => 10_000 / Math.max(1, m.speedX10);
const SPRINT_MS_PER_TILE = 10_000 / SPRINT_SPEED_X10;

/** Tiles covered by `t` (walking, then sprinting once `sprintIn` is up). */
function distAt(m: Motion, t: number): number {
  if (t <= m.t0) return 0;
  const dt = t - m.t0;
  const s = m.sprintIn ?? 0;
  if (!s || dt <= s) return dt / msPerTile(m);
  return s / msPerTile(m) + (dt - s) / SPRINT_MS_PER_TILE;
}

/** When `d` tiles have been covered (ms after `t0`). */
function timeFor(m: Motion, d: number): number {
  const s = m.sprintIn ?? 0;
  const walked = s / msPerTile(m);
  if (!s || d <= walked) return d * msPerTile(m);
  return s + (d - walked) * SPRINT_MS_PER_TILE;
}

/** Whether they're sprinting at `t`. */
export function sprintingAt(m: Motion, t: number): boolean {
  return m.speedX10 === SPRINT_SPEED_X10 || (!!m.sprintIn && t > m.t0 + m.sprintIn);
}

export function durationMs(m: Motion): number {
  let len = 0;
  for (let i = 1; i < m.path.length; i++) len += segLen(m.path[i - 1], m.path[i]);
  return Math.ceil(timeFor(m, len));
}

export function endT(m: Motion): number {
  return m.t0 + durationMs(m);
}

/** Fractional tile position at instance time `t`. */
export function posAt(m: Motion, t: number): TileXY {
  const first = m.path[0];
  if (t <= m.t0 || m.path.length === 1) return { x: first.x, y: first.y };
  let remaining = distAt(m, t);
  for (let i = 1; i < m.path.length; i++) {
    const a = m.path[i - 1];
    const b = m.path[i];
    const len = segLen(a, b);
    if (remaining < len) {
      const f = remaining / len;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    remaining -= len;
  }
  const last = m.path[m.path.length - 1];
  return { x: last.x, y: last.y };
}

/** Unit direction of travel at time `t`, or null when standing. */
export function headingAt(m: Motion, t: number): TileXY | null {
  if (t <= m.t0 || t >= endT(m)) return null;
  let remaining = distAt(m, t);
  for (let i = 1; i < m.path.length; i++) {
    const a = m.path[i - 1];
    const b = m.path[i];
    const len = segLen(a, b);
    if (remaining < len) return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    remaining -= len;
  }
  return null;
}

/**
 * Mirror of sim::Motion::splice: the tile just passed, the tile being walked
 * into, and when the avatar was at the former. A new path [prev, next, ...]
 * starting then continues the current walk without a seam.
 */
export function splice(m: Motion, t: number): { prev: TileXY; next: TileXY; tPrev: number } | null {
  if (t <= m.t0 || t >= endT(m)) return null;
  const travelled = distAt(m, t);
  let before = 0;
  for (let i = 1; i < m.path.length; i++) {
    const a = m.path[i - 1];
    const b = m.path[i];
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    const len = segLen(a, b);
    if (travelled < before + len) {
      const stepLen = len / steps;
      const k = Math.min(Math.floor((travelled - before) / stepLen), steps - 1);
      const prev = { x: a.x + dx * k, y: a.y + dy * k };
      return {
        prev,
        next: { x: prev.x + dx, y: prev.y + dy },
        tPrev: m.t0 + Math.round(timeFor(m, before + k * stepLen)),
      };
    }
    before += len;
  }
  return null;
}
