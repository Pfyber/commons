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

/** How long a skate's push from setting-off speed to top speed takes (sim::SKATE_RAMP_MS). */
export const SKATE_RAMP_MS = 7_000;
const SKATE_TOP = 3;
const SKATE_BRAKE = 42e-6;
/** The Vespa (sim::VESPA_*): quicker off the mark, and it pulls on to well past the skateboard. */
export const VESPA_SPEED_X10 = 130;
export const VESPA_RAMP_MS = 4_500;
const VESPA_TOP = 3.2;
const VESPA_BRAKE = 70e-6;

/** A ride that picks up speed as it goes (sim::RampRide): setting off (tiles per ms), top (times that), ramp, braking. */
interface RampRide {
  base: number;
  top: number;
  rampMs: number;
  brake: number;
}

/** The ramp of a motion at `speedX10` (sim::ramp_ride), if it's a ramped ride. */
function rampRide(speedX10: number): RampRide | null {
  if (speedX10 === SKATE_SPEED_X10) return { base: SKATE_SPEED_X10 / 10_000, top: SKATE_TOP, rampMs: SKATE_RAMP_MS, brake: SKATE_BRAKE };
  if (speedX10 === VESPA_SPEED_X10) return { base: VESPA_SPEED_X10 / 10_000, top: VESPA_TOP, rampMs: VESPA_RAMP_MS, brake: VESPA_BRAKE };
  return null;
}

/** Whether a motion at `speedX10` picks up speed as it goes (a skateboard, a Vespa). */
export function isRamped(speedX10: number | undefined): boolean {
  return speedX10 !== undefined && rampRide(speedX10) !== null;
}

/**
 * The skating profile (sim::Skate, in lockstep): picking up speed from the
 * ramp position `ramp0` to three times setting-off speed, then braking to a
 * stop at the end of the path. Speeds in tiles per ms.
 */
class Skate {
  v0: number;
  acc: number;
  rampLeft: number;
  brakeAt = 0;
  brakeT = 0;
  brakeV = 0;
  brake: number;

  constructor(
    ride: RampRide,
    ramp0: number,
    private len: number,
  ) {
    this.brake = ride.brake;
    const base = ride.base;
    const top = base * ride.top;
    this.acc = (top - base) / ride.rampMs;
    const r = Math.max(0, Math.min(ride.rampMs, ramp0));
    this.v0 = base + this.acc * r;
    this.rampLeft = ride.rampMs - r;
    const stops = (d: number) => {
      const v = this.speedAfter(this.timeTo(d));
      return d + (v * v) / (2 * ride.brake);
    };
    if (stops(0) >= len) {
      this.brake = len > 0 ? (this.v0 * this.v0) / (2 * len) : 1;
    } else {
      let lo = 0;
      let hi = len;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (stops(mid) < len) lo = mid;
        else hi = mid;
      }
      this.brakeAt = lo;
    }
    this.brakeT = this.timeTo(this.brakeAt);
    this.brakeV = this.speedAfter(this.brakeT);
  }

  speedAfter(dt: number): number {
    return this.v0 + this.acc * Math.min(dt, this.rampLeft);
  }

  distBy(dt: number): number {
    const r = Math.min(dt, this.rampLeft);
    const d = this.v0 * r + (this.acc / 2) * r * r;
    return d + Math.max(0, dt - r) * (this.v0 + this.acc * this.rampLeft);
  }

  timeTo(d: number): number {
    const rampD = this.v0 * this.rampLeft + (this.acc / 2) * this.rampLeft * this.rampLeft;
    if (d <= rampD && this.acc > 0) return (-this.v0 + Math.sqrt(this.v0 * this.v0 + 2 * this.acc * d)) / this.acc;
    return this.rampLeft + (d - rampD) / (this.v0 + this.acc * this.rampLeft);
  }

  distAt(dt: number): number {
    if (dt <= this.brakeT) return this.distBy(dt);
    const u = Math.min(dt - this.brakeT, this.brakeV / this.brake);
    return Math.min(this.len, this.brakeAt + this.brakeV * u - (this.brake / 2) * u * u);
  }

  timeFor(d: number): number {
    if (d <= this.brakeAt) return this.timeTo(d);
    const rem = Math.min(d - this.brakeAt, this.len - this.brakeAt);
    const disc = Math.max(0, this.brakeV * this.brakeV - 2 * this.brake * rem);
    return this.brakeT + (this.brakeV - Math.sqrt(disc)) / this.brake;
  }

  speedAt(dt: number): number {
    return dt <= this.brakeT ? this.speedAfter(dt) : Math.max(0, this.brakeV - this.brake * (dt - this.brakeT));
  }
}

const pathLen = (m: Motion) => {
  let len = 0;
  for (let i = 1; i < m.path.length; i++) len += segLen(m.path[i - 1], m.path[i]);
  return len;
};

function skateOf(m: Motion): Skate | null {
  const ride = rampRide(m.speedX10);
  return ride ? new Skate(ride, m.sprintIn ?? 0, pathLen(m)) : null;
}

/** For a skate, how far along its ramp its speed at `t` is (sim::Motion::skate_ramp_at); 0 otherwise. */
export function skateRampAt(m: Motion | null, t: number): number {
  const s = m ? skateOf(m) : null;
  const ride = m ? rampRide(m.speedX10) : null;
  if (!m || !s || !ride) return 0;
  const v = s.speedAt(Math.max(0, t - m.t0));
  return Math.round(Math.max(0, Math.min(ride.rampMs, (v - ride.base) / s.acc)));
}

/** How fast a motion is going at `t`, in tiles a second (0 standing). */
export function speedAt(m: Motion, t: number): number {
  if (t <= m.t0 || t >= endT(m)) return 0;
  const s = skateOf(m);
  if (s) return s.speedAt(t - m.t0) * 1000;
  return sprintingAt(m, t) ? SPRINT_SPEED_X10 / 10 : m.speedX10 / 10;
}

/** How far a skate (or a Vespa: `speedX10`) going `tilesPerSec` glides before it stops (tiles). */
export function glideTiles(tilesPerSec: number, speedX10 = SKATE_SPEED_X10): number {
  const v = tilesPerSec / 1000;
  return (v * v) / (2 * (rampRide(speedX10)?.brake ?? SKATE_BRAKE));
}
const msPerTile = (m: Motion) => 10_000 / Math.max(1, m.speedX10);
const SPRINT_MS_PER_TILE = 10_000 / SPRINT_SPEED_X10;

/** Tiles covered by `t` (walking, then sprinting once `sprintIn` is up). */
function distAt(m: Motion, t: number): number {
  if (t <= m.t0) return 0;
  const dt = t - m.t0;
  const sk = skateOf(m);
  if (sk) return sk.distAt(dt);
  const s = m.sprintIn ?? 0;
  if (!s || dt <= s) return dt / msPerTile(m);
  return s / msPerTile(m) + (dt - s) / SPRINT_MS_PER_TILE;
}

/** When `d` tiles have been covered (ms after `t0`). */
function timeFor(m: Motion, d: number): number {
  const sk = skateOf(m);
  if (sk) return sk.timeFor(d);
  const s = m.sprintIn ?? 0;
  const walked = s / msPerTile(m);
  if (!s || d <= walked) return d * msPerTile(m);
  return s + (d - walked) * SPRINT_MS_PER_TILE;
}

/** Whether they're sprinting at `t`. */
export function sprintingAt(m: Motion, t: number): boolean {
  return m.speedX10 === SPRINT_SPEED_X10 || (!isRamped(m.speedX10) && !!m.sprintIn && t > m.t0 + m.sprintIn);
}

export function durationMs(m: Motion): number {
  return Math.ceil(timeFor(m, pathLen(m)));
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

/** What's left of the walk at time `t`: where we are, then each turn still ahead (empty once there). */
export function routeAhead(m: Motion, t: number): TileXY[] {
  if (t >= endT(m) || m.path.length < 2) return [];
  if (t <= m.t0) return m.path.map((p) => ({ x: p.x, y: p.y }));
  let remaining = distAt(m, t);
  for (let i = 1; i < m.path.length; i++) {
    const len = segLen(m.path[i - 1], m.path[i]);
    if (remaining < len) return [posAt(m, t), ...m.path.slice(i).map((p) => ({ x: p.x, y: p.y }))];
    remaining -= len;
  }
  return [];
}

/**
 * The rest of walk `m` from where it is at `t`, at another pace: the same
 * route, timed so the walker is exactly where they are now (no jump), going
 * on at `speedX10` (and `sprintIn`). Null when not mid-walk.
 */
export function retimed(m: Motion, t: number, speedX10: number, sprintIn: number): Motion | null {
  const sp = splice(m, t);
  const ahead = routeAhead(m, t);
  if (!sp || ahead.length < 2) return null;
  const [pos, ...rest] = ahead;
  const path = [sp.prev, ...rest];
  const seg = Math.hypot(rest[0].x - sp.prev.x, rest[0].y - sp.prev.y);
  const along = seg > 0 ? (segLen(sp.prev, rest[0]) * Math.hypot(pos.x - sp.prev.x, pos.y - sp.prev.y)) / seg : 0;
  const next: Motion = { path, t0: 0, speedX10, sprintIn };
  next.t0 = t - timeFor(next, along);
  return next;
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
/**
 * Mirror of sim::TURN_EARLY: turning less than this far into a step, a walk
 * turns from the tile it's just left instead of walking on into the next.
 */
export const TURN_EARLY = 0.5;

export function splice(m: Motion, t: number): { prev: TileXY; next: TileXY; tPrev: number; into: number } | null {
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
        into: Math.min(1, Math.max(0, (travelled - before) / stepLen - k)),
      };
    }
    before += len;
  }
  return null;
}
