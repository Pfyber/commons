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
}

/** Walking speed in tenths of a tile per second (sim::WALK_SPEED_X10). */
export const WALK_SPEED_X10 = 40;

const segLen = (a: TileXY, b: TileXY) => Math.hypot(b.x - a.x, b.y - a.y);
const msPerTile = (m: Motion) => 10_000 / Math.max(1, m.speedX10);

export function durationMs(m: Motion): number {
  let len = 0;
  for (let i = 1; i < m.path.length; i++) len += segLen(m.path[i - 1], m.path[i]);
  return Math.ceil(len * msPerTile(m));
}

export function endT(m: Motion): number {
  return m.t0 + durationMs(m);
}

/** Fractional tile position at instance time `t`. */
export function posAt(m: Motion, t: number): TileXY {
  const first = m.path[0];
  if (t <= m.t0 || m.path.length === 1) return { x: first.x, y: first.y };
  let remaining = (t - m.t0) / msPerTile(m);
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
  let remaining = (t - m.t0) / msPerTile(m);
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
  const travelled = (t - m.t0) / msPerTile(m);
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
        tPrev: m.t0 + Math.round((before + k * stepLen) * msPerTile(m)),
      };
    }
    before += len;
  }
  return null;
}
