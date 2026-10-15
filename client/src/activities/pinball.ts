// Pinball 1v1, the machine in the bar (server: zone/src/instance/arcade/
// pinball.rs). The server plays the game; this file carries it on between
// its states on your screen: from the last state it runs the same physics up
// to now, with your own flipper presses played from when you pressed them
// and the bot's choices made just as the server makes them, so flippers
// answer at once and the ball flies smoothly. Keep the two in step.

export const PINBALL = 11;
export const FLIP_TOP = 1;
export const FLIP_BOTTOM = 2;

/** The playfield, in units (as the server). */
export const PW = 260;
export const PH = 156;
export const BALL_R = 2.8;
export const HOLE_HALF = 22;
export const FLIP_LEN = 24;
export const FLIP_BASE_R = 3.6;
export const FLIP_TIP_R = 1.6;
const FLIP_UP = 15;
const FLIP_DOWN = 9;
/** Pivot x, y, resting angle, raised angle: a's top and bottom, then b's. */
export const FLIPPERS: [number, number, number, number][] = [
  [30, 50, 2.094, 1.047],
  [30, 106, -2.094, -1.047],
  [230, 50, 1.047, 2.094],
  [230, 106, -1.047, -2.094],
];
export const RAILS: [number, number, number, number][] = [
  [12, 0, 30, 50],
  [12, 156, 30, 106],
  [248, 0, 230, 50],
  [248, 156, 230, 106],
];
export const RAIL_R = 1.6;
/** Centre, radius, kick speed (0: a plain post). */
export const BUMPERS: [number, number, number, number][] = [
  [130, 78, 10, 175],
  [92, 44, 7, 165],
  [168, 44, 7, 165],
  [92, 112, 7, 165],
  [168, 112, 7, 165],
  [130, 24, 5.5, 155],
  [130, 132, 5.5, 155],
  [66, 78, 3.5, 0],
  [194, 78, 3.5, 0],
];
const TILT = 34;
const FRICTION = 10;
const MAX_SPEED = 300;
const STUCK_SPEED = 4;
const STUCK_MS = 1000;
const BUMP = 70;
const STEP_MS = 2;
const BOT_HOLD_MS = 170;
const BOT_SKILL = 78;

/** What `ArcadeState.data` says, unpacked (times as offsets from the state's t0). */
export interface PinState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  score: [number, number];
  serving: boolean;
  ang: number[];
  hits: number[];
  /** Flippers held: a's, b's. */
  keys: [number, number];
  /** The bot's timers, ms after the state's time: holding each flipper, resting. */
  botHold: [number, number];
  botRest: number;
  /** How long the ball's been all but still (ms), and the table bumps so far. */
  still: number;
  bumps: number;
}

export function unpack(d: number[]): PinState {
  return {
    x: d[0] / 10,
    y: d[1] / 10,
    vx: (d[2] - 32768) / 10,
    vy: (d[3] - 32768) / 10,
    score: [d[4], d[5]],
    serving: !!d[6],
    ang: [d[7], d[8], d[9], d[10]].map((a) => a / 1000 - 4),
    hits: d.slice(11, 20),
    keys: [d[20] & 3, (d[20] >> 2) & 3],
    botHold: [d[21] ?? 0, d[22] ?? 0],
    botRest: d[23] ?? 0,
    still: d[24] ?? 0,
    bumps: d[25] ?? 0,
  };
}

function closest(x: number, y: number, ax: number, ay: number, bx: number, by: number): [number, number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
  return [ax + dx * t, ay + dy * t, t];
}

/** The bot's luck, from the time (as the server). */
function botSaves(t: number): boolean {
  let x = Math.floor(t / 40) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x % 100 < BOT_SKILL;
}

/** Downhill: toward the nearer end's hole. */
function tilt(x: number, y: number): [number, number] {
  const end = x < PW / 2 ? 0 : PW;
  const dx = end - x;
  const dy = PH / 2 - y;
  const d = Math.sqrt(dx * dx + dy * dy);
  return d < 1 ? [0, 0] : [dx / d, dy / d];
}

/** A press of your flippers, at a server time. */
export interface Press {
  t: number;
  keys: number;
}

export interface Carried {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number[];
  /** Bumpers hit on the way (index, server time). */
  hits: [number, number][];
  /** The ball went down a hole on the way (it's waiting for the server's serve). */
  gone: boolean;
}

/**
 * The state at server time `t0`, carried on to `now`: your side's (`mine`)
 * flippers follow your `presses`, the bot's side (`bot`) plays as the
 * server's bot does, anyone else's hold what they held.
 */
export function carry(s: PinState, t0: number, now: number, mine: number, presses: Press[], bot = -1): Carried {
  let { x, y, vx, vy } = s;
  const ang = s.ang.slice();
  const keys: [number, number] = [s.keys[0], s.keys[1]];
  const hold = [t0 + s.botHold[0], t0 + s.botHold[1]];
  let rest = t0 + s.botRest;
  let still = s.still;
  let bumps = s.bumps;
  const hits: [number, number][] = [];
  if (s.serving) return { x: PW / 2, y: PH / 2, vx: 0, vy: 0, ang, hits, gone: false };
  let t = t0;
  const end = Math.min(now, t0 + 400);
  let p = 0;
  while (p < presses.length && presses[p].t <= t0) p++;
  const tip = (f: number): [number, number] => [FLIPPERS[f][0] + Math.cos(ang[f]) * FLIP_LEN, FLIPPERS[f][1] + Math.sin(ang[f]) * FLIP_LEN];
  while (t < end) {
    const ms = Math.min(STEP_MS, end - t);
    t += ms;
    const dt = ms / 1000;
    while (mine >= 0 && p < presses.length && presses[p].t <= t) keys[mine] = presses[p++].keys;
    if (bot >= 0) {
      // The server's bot, step for step.
      const toward = bot === 0 ? vx < 0 : vx > 0;
      let k = 0;
      for (let i = 0; i < 2; i++) if (t < hold[i]) k |= 1 << i;
      if (toward && t >= rest && k === 0) {
        for (let i = 0; i < 2; i++) {
          const f = bot * 2 + i;
          const [px, py] = FLIPPERS[f];
          const [tx, ty] = tip(f);
          const [cx, cy] = closest(x, y, px, py, tx, ty);
          if (Math.hypot(x - cx, y - cy) < 10) {
            if (botSaves(t)) {
              hold[i] = t + BOT_HOLD_MS;
              k |= 1 << i;
            } else {
              rest = t + 400;
            }
            break;
          }
        }
      }
      keys[bot] = k;
    }
    const spin = [0, 0, 0, 0];
    for (let f = 0; f < 4; f++) {
      const [, , restAng, up] = FLIPPERS[f];
      const held = (keys[f >> 1] & (1 << (f & 1))) !== 0;
      const goal = held ? up : restAng;
      const speed = held ? FLIP_UP : FLIP_DOWN;
      const mv = Math.min(speed * dt, Math.max(-speed * dt, goal - ang[f]));
      ang[f] += mv;
      spin[f] = mv / dt;
    }
    const [gx, gy] = tilt(x, y);
    vx += gx * TILT * dt;
    vy += gy * TILT * dt;
    let sp = Math.sqrt(vx * vx + vy * vy);
    if (sp > FRICTION * dt) {
      const k = (sp - FRICTION * dt) / sp;
      vx *= k;
      vy *= k;
    }
    x += vx * dt;
    y += vy * dt;
    if (y < BALL_R) {
      y = BALL_R;
      vy = Math.abs(vy) * 0.9;
    } else if (y > PH - BALL_R) {
      y = PH - BALL_R;
      vy = -Math.abs(vy) * 0.9;
    }
    if (Math.abs(y - PH / 2) >= HOLE_HALF) {
      if (x < BALL_R) {
        x = BALL_R;
        vx = Math.abs(vx) * 0.9;
      } else if (x > PW - BALL_R) {
        x = PW - BALL_R;
        vx = -Math.abs(vx) * 0.9;
      }
    }
    const bar = (ax: number, ay: number, bx: number, by: number, r0: number, r1: number, e: number, w: number, px: number, py: number) => {
      const [cx, cy, u] = closest(x, y, ax, ay, bx, by);
      const r = r0 + (r1 - r0) * u;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= BALL_R + r) return;
      const nx = d > 1e-9 ? dx / d : 0;
      const ny = d > 1e-9 ? dy / d : -1;
      x = cx + nx * (BALL_R + r);
      y = cy + ny * (BALL_R + r);
      const sx = -w * (cy - py);
      const sy = w * (cx - px);
      const vn = (vx - sx) * nx + (vy - sy) * ny;
      if (vn < 0) {
        vx -= (1 + e) * vn * nx;
        vy -= (1 + e) * vn * ny;
      }
    };
    for (const [ax, ay, bx, by] of RAILS) bar(ax, ay, bx, by, RAIL_R, RAIL_R, 0.5, 0, 0, 0);
    for (let f = 0; f < 4; f++) {
      const [px, py] = FLIPPERS[f];
      const [tx, ty] = tip(f);
      bar(px, py, tx, ty, FLIP_BASE_R, FLIP_TIP_R, 0.5, spin[f], px, py);
    }
    BUMPERS.forEach(([bx, by, br, kick], i) => {
      const dx = x - bx;
      const dy = y - by;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= br + BALL_R) return;
      const nx = d > 1e-9 ? dx / d : 1;
      const ny = d > 1e-9 ? dy / d : 0;
      x = bx + nx * (br + BALL_R);
      y = by + ny * (br + BALL_R);
      const vn = vx * nx + vy * ny;
      if (vn < 0) {
        const e = kick > 0 ? 1 : 0.85;
        vx -= (1 + e) * vn * nx;
        vy -= (1 + e) * vn * ny;
        hits.push([i, t]);
      }
      if (kick > 0) {
        const s2 = Math.max(1e-9, Math.sqrt(vx * vx + vy * vy));
        const k = (Math.max(s2, kick) * 1.04) / s2;
        vx *= k;
        vy *= k;
      }
    });
    sp = Math.sqrt(vx * vx + vy * vy);
    if (sp > MAX_SPEED) {
      vx *= MAX_SPEED / sp;
      vy *= MAX_SPEED / sp;
    }
    if (sp < STUCK_SPEED) {
      still += ms;
      if (still >= STUCK_MS) {
        // Balanced on something: the table gets a bump, across the slope (as the server).
        const [gx2, gy2] = tilt(x, y);
        const side = bumps % 2 === 0 ? 1 : -1;
        const [px, py] = gx2 === 0 && gy2 === 0 ? [0, 1] : [-gy2, gx2];
        vx += px * BUMP * side;
        vy += py * BUMP * side;
        bumps = (bumps + 1) & 0xffff;
        still = 0;
      }
    } else {
      still = 0;
    }
    if (x < -BALL_R || x > PW + BALL_R) return { x, y, vx, vy, ang, hits, gone: true };
  }
  return { x, y, vx, vy, ang, hits, gone: false };
}
