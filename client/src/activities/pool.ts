// Pool at the bar (protocol PoolState / PoolShot, game rules on the server
// in commons_sim::pool). The physics below mirrors sim/src/pool.rs step for
// step, so a shot rolls on every screen exactly as the server played it;
// the PoolState that follows is where everything came to rest.

import type { PoolBall } from "../net/protocol.gen";
import * as sfx from "../ambient/sfx";
import { ChoiceModal, Panel, button, el } from "../ui/panels";

export const W = 1000;
export const H = 500;
export const R = 12;
const POCKET_R = 26;
const MOUTH = 34;
const SIDE_MOUTH = 22;
const DT = 1.0 / 240.0;
const FRICTION = 95.0;
const SLOW_SPEED = 120.0;
const SLOW_FRICTION = 40.0;
const CUSHION = 0.86;
const BALL_E = 0.975;
const MAX_STEPS = 240 * 30;
/** sim::pool::MAX_SPEED: the hardest shot. */
const MAX_SPEED = 1600;
/** sim::pool::SUBSTEP_OVER, POWER_SHOT_FROM: above this speed a step is split; from this power (of 1000) a shot is a power shot. */
const SUBSTEP_OVER = 1700;
const POWER_SHOT_FROM = 970;
const POCKETS: [number, number][] = [
  [0, 0],
  [W / 2, -8],
  [W, 0],
  [0, H],
  [W / 2, H + 8],
  [W, H],
];

/** protocol `pool::*`. */
export const EMPTY = 0;
export const PLAYING = 1;
export const A_WON = 2;
export const B_WON = 3;
export const WAITING = 4;
const SOLIDS = 1;
export const BOT = 0xfffffff3;
const V_OFFSET = 32768;

interface Ball {
  n: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  on: boolean;
}

/** What a step can tell the speakers about (pool sounds), with how hard. */
type Hit = (kind: "ball" | "cushion" | "pocket", speed: number, x: number) => void;

/**
 * One physics step (sim::pool::step); returns whether anything still moves.
 * `hit` hears about the knocks along the way and changes nothing. While
 * anything goes faster than an ordinary shot (a power shot), the step is
 * played as 2 or 4 shorter ones, as on the server.
 */
function step(balls: Ball[], hit?: Hit): boolean {
  let fastest = 0;
  for (const b of balls) {
    if (b.on) fastest = Math.max(fastest, Math.sqrt(b.vx * b.vx + b.vy * b.vy));
  }
  const parts = fastest > 2 * SUBSTEP_OVER ? 4 : fastest > SUBSTEP_OVER ? 2 : 1;
  const dt = DT / parts;
  let moving = false;
  for (let i = 0; i < parts; i++) {
    if (subStep(balls, dt, hit)) moving = true;
  }
  return moving;
}

/** `step`'s work for `dt` seconds. */
function subStep(balls: Ball[], dt: number, hit?: Hit): boolean {
  let moving = false;
  for (const b of balls) {
    if (!b.on) continue;
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    const friction = speed < SLOW_SPEED ? SLOW_FRICTION : FRICTION;
    if (speed <= friction * dt) {
      b.vx = 0;
      b.vy = 0;
      continue;
    }
    moving = true;
    const k = (speed - friction * dt) / speed;
    b.vx *= k;
    b.vy *= k;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const off = b.x < 0 || b.x > W || b.y < 0 || b.y > H;
    if (
      off ||
      POCKETS.some(([px, py]) => {
        const dx = b.x - px;
        const dy = b.y - py;
        return dx * dx + dy * dy < POCKET_R * POCKET_R;
      })
    ) {
      hit?.("pocket", speed, b.x);
      b.on = false;
      b.vx = 0;
      b.vy = 0;
      continue;
    }
    const cornerX = b.x < MOUTH || b.x > W - MOUTH;
    const cornerY = b.y < MOUTH || b.y > H - MOUTH;
    const side = (b.x - W / 2) * (b.x - W / 2) < SIDE_MOUTH * SIDE_MOUTH;
    if (!cornerY) {
      if (b.x < R) {
        hit?.("cushion", Math.abs(b.vx), b.x);
        b.x = R + (R - b.x);
        b.vx = -b.vx * CUSHION;
      } else if (b.x > W - R) {
        hit?.("cushion", Math.abs(b.vx), b.x);
        b.x = W - R - (b.x - (W - R));
        b.vx = -b.vx * CUSHION;
      }
    }
    if (!cornerX && !side) {
      if (b.y < R) {
        hit?.("cushion", Math.abs(b.vy), b.x);
        b.y = R + (R - b.y);
        b.vy = -b.vy * CUSHION;
      } else if (b.y > H - R) {
        hit?.("cushion", Math.abs(b.vy), b.x);
        b.y = H - R - (b.y - (H - R));
        b.vy = -b.vy * CUSHION;
      }
    }
  }
  const n = balls.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const bi = balls[i];
      const bj = balls[j];
      if (!bi.on || !bj.on) continue;
      let dx = bj.x - bi.x;
      let dy = bj.y - bi.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 4 * R * R) continue;
      const ux = bj.vx - bi.vx;
      const uy = bj.vy - bi.vy;
      const uu = ux * ux + uy * uy;
      const du = dx * ux + dy * uy;
      let back = 0;
      if (uu > 0 && du < 0) {
        const c = d2 - 4 * R * R;
        back = Math.min(Math.max((du + Math.sqrt(du * du - uu * c)) / uu, 0), dt);
      }
      for (const b of [bi, bj]) {
        b.x -= b.vx * back;
        b.y -= b.vy * back;
      }
      dx = bj.x - bi.x;
      dy = bj.y - bi.y;
      let d = Math.sqrt(dx * dx + dy * dy);
      let nx = d > 0 ? dx / d : 1;
      let ny = d > 0 ? dy / d : 0;
      const closing = (bi.vx - bj.vx) * nx + (bi.vy - bj.vy) * ny;
      if (closing > 0) {
        hit?.("ball", closing, (bi.x + bj.x) / 2);
        const k = (closing * (1 + BALL_E)) / 2;
        bi.vx -= k * nx;
        bi.vy -= k * ny;
        bj.vx += k * nx;
        bj.vy += k * ny;
        moving = true;
      }
      for (const b of [bi, bj]) {
        b.x += b.vx * back;
        b.y += b.vy * back;
      }
      dx = bj.x - bi.x;
      dy = bj.y - bi.y;
      d = Math.sqrt(dx * dx + dy * dy);
      if (d < 2 * R) {
        nx = d > 0 ? dx / d : 1;
        ny = d > 0 ? dy / d : 0;
        const push = (2 * R - d) / 2;
        bi.x -= nx * push;
        bi.y -= ny * push;
        bj.x += nx * push;
        bj.y += ny * push;
      }
    }
  }
  return moving;
}

/**
 * A whole shot from a standing start, ending rounded (sim::pool::simulate);
 * for the cross-check against the server in pool.test.ts.
 */
export function simulate(start: { n: number; x: number; y: number }[], vx: number, vy: number): { n: number; x: number; y: number; on: boolean }[] {
  const balls: Ball[] = start.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: 0, vy: 0, on: true }));
  balls[0].vx = vx;
  balls[0].vy = vy;
  let steps = 0;
  while (steps < MAX_STEPS) {
    steps++;
    if (!step(balls)) break;
  }
  return balls.map((b) => ({ n: b.n, x: Math.round(b.x), y: Math.round(b.y), on: b.on }));
}

/** `hole`: the pocket (index into POCKETS) the player up must sink the 8 in; NO_HOLE until they may. */
type State = { a: number; b: number; turn: number; groups: number; status: number; shot: number; hole: number; balls: PoolBall[] };
/** sim::pool::NO_HOLE. */
const NO_HOLE = 255;

const COLORS: Record<number, string> = {
  1: "#f6c343",
  2: "#3f6fa0",
  3: "#c8553d",
  4: "#7a4a8c",
  5: "#e8823a",
  6: "#3f7a4a",
  7: "#8f3a2b",
};
const color = (n: number) => (n === 0 ? "#fff8e3" : n === 8 ? "#1d1d1d" : COLORS[n > 8 ? n - 8 : n]);

// ---- the balls as little spheres, turning as they roll ----------------------------

/**
 * A ball's orientation: the rotation (row-major 3×3) taking the ball's own
 * axes to the table's (x right, y down, z up at you). The number sits on the
 * ball's ±x poles and a stripe's band runs round its z axis, so at rest
 * (this one) the number faces up.
 */
type Orient = number[];
const NUMBER_UP: Orient = [0, 0, -1, 0, 1, 0, 1, 0, 0];

/** Rolls `m` over the cloth by (dx, dy) table units: about the axis across the motion, by distance / radius. */
function roll(m: Orient, dx: number, dy: number): Orient {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return m;
  const ax = -dy / d;
  const ay = dx / d;
  const th = d / R;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const t = 1 - c;
  // Rodrigues, for an axis in the table's plane (az = 0).
  const r = [t * ax * ax + c, t * ax * ay, s * ay, t * ax * ay, t * ay * ay + c, -s * ax, -s * ay, s * ax, c];
  const out = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = r[i * 3] * m[j] + r[i * 3 + 1] * m[3 + j] + r[i * 3 + 2] * m[6 + j];
  return tidy(out);
}

/** Keeps a rotation a rotation, as rounding creeps in over many frames. */
function tidy(m: Orient): Orient {
  const a = [m[0], m[3], m[6]];
  let n = Math.hypot(a[0], a[1], a[2]);
  a[0] /= n;
  a[1] /= n;
  a[2] /= n;
  const b = [m[1], m[4], m[7]];
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  b[0] -= dot * a[0];
  b[1] -= dot * a[1];
  b[2] -= dot * a[2];
  n = Math.hypot(b[0], b[1], b[2]);
  b[0] /= n;
  b[1] /= n;
  b[2] /= n;
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
}

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const CREAM = rgb("#fff8e3");
/** Light from the top left, a little above. */
const LIGHT = (() => {
  const v = [-0.45, -0.55, 0.7];
  const n = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / n);
})();

/**
 * A ball seen from above, pixel by pixel as a lit sphere: solid colour with a
 * white number spot, or white with a plain coloured band; the cue ball plain
 * white. All turned by `m`.
 */
function drawBall(ctx: CanvasRenderingContext2D, n: number, x: number, y: number, r: number, m: Orient = NUMBER_UP) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  ctx.fillStyle = "#3b3a2e";
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.fill();
  const base = rgb(color(n));
  const ri = Math.ceil(r);
  for (let j = -ri; j < ri; j++) {
    for (let i = -ri; i < ri; i++) {
      const nx = (i + 0.5) / r;
      const ny = (j + 0.5) / r;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      // This pixel's point on the ball, in the ball's own axes.
      const bx = m[0] * nx + m[3] * ny + m[6] * nz;
      const bz = m[2] * nx + m[5] * ny + m[8] * nz;
      let col: number[];
      if (n === 0) col = CREAM;
      // Stripes: just the band (it shows them turning); solids: a small number spot.
      else if (n > 8) col = Math.abs(bz) < 0.36 ? base : CREAM;
      else if (Math.abs(bx) > 0.85) col = CREAM;
      else col = base;
      const lam = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      const f = 0.6 + 0.5 * Math.max(0, lam);
      const shine = lam > 0.94 ? 0.55 : 0;
      ctx.fillStyle = `rgb(${Math.min(255, col[0] * f + shine * 255)},${Math.min(255, col[1] * f + shine * 255)},${Math.min(255, col[2] * f + shine * 255)})`;
      ctx.fillRect(cx + i, cy + j, 1, 1);
    }
  }
}

/** Canvas pixels per table unit, and the wooden rim around the cloth. */
const SCALE = 0.5;
const RIM = 22;
/** The tray under the table where pocketed balls are laid out. */
const TRAY = 30;

/** One trip of the power meter's arrow, bottom to top and back. */
const METER_MS = 1600;

/**
 * The pool table panel: the table from above and whose shot it is. On
 * yours, the cue follows the pointer; click to lock the aim, and a power
 * meter (green to red) appears with an arrow sliding up and down it, like
 * the fishing reel; click again to strike, as hard as where the arrow is.
 */
export class PoolPanel extends Panel {
  private state: State = { a: 0, b: 0, turn: 0, groups: 0, status: EMPTY, shot: 0, hole: NO_HOLE, balls: [] };

  /** Who's playing at the table now (none between games). */
  get players(): number[] {
    return this.state.status === PLAYING ? [this.state.a, this.state.b] : [];
  }
  private balls: Ball[] = [];
  /** A shot rolling on screen, and the state to show once it stops. */
  private rolling = false;
  private pending: State | null = null;
  private canvas = document.createElement("canvas");
  /** The power meter beside the table, and its arrow. */
  private meter = document.createElement("div");
  private arrow = document.createElement("div");
  private aim: number | null = null;
  /** Aim locked, meter running since this time (null: still aiming). */
  private lockedAt: number | null = null;
  private raf = 0;
  private lastT = 0;
  private carry = 0;
  private steps = 0;
  /** Knocks sounded this frame: a break doesn't need fifteen clacks at once. */
  private knocks = 0;
  /** Play the pool shark or wait for a player: asked in the middle of the screen. */
  private choice = new ChoiceModal();
  /** The other side lining up their shot (PoolAim): where they aim, how far drawn back (0–1). */
  private theirAim: { angle: number; pull: number } | null = null;
  /** …and where their red cue is drawn, easing after it. */
  private theirShown: { angle: number; pull: number } | null = null;
  /** When their cue was last drawn (for its easing). */
  private lastDrawn = 0;
  /** Your aim as last shared, and when. */
  private aimSent = "";
  private aimSentAt = 0;
  /** How each ball (by number) has turned as it rolled. */
  private orient = new Map<number, Orient>();
  /** When the game on the table last finished (the result waits a moment). */
  private endedAt = 0;

  private knock: Hit = (kind, speed, x) => {
    if (kind === "pocket") return sfx.pocket(x);
    if (this.knocks >= 4) return;
    this.knocks++;
    if (kind === "ball") sfx.ballClack(speed, x);
    else sfx.cushion(speed, x);
  };

  constructor(
    private selfId: () => number,
    private nameOf: (id: number) => string,
    private send: (
      m: { t: "PoolJoin"; vsBot: boolean } | { t: "PoolLeave" } | { t: "PoolShoot"; angle: number; power: number } | { t: "PoolAim"; angle: number; pull: number },
    ) => void,
  ) {
    super("🎱 Pool", "pool");
    // the power meter sits beside the table
    this.enlargeable(this.canvas, 40);
    this.canvas.width = W * SCALE + RIM * 2;
    this.canvas.height = H * SCALE + RIM * 2 + TRAY;
    this.canvas.className = "pool-canvas";
    this.meter.className = "pool-meter";
    this.meter.hidden = true;
    this.arrow.className = "pool-meter-arrow";
    // The very top of the meter: a power shot.
    const zone = el("div", "pool-meter-power");
    zone.style.height = `${(1000 - POWER_SHOT_FROM) / 10}%`;
    zone.title = "Power shot!";
    this.meter.append(zone, this.arrow);
    this.meter.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.lockedAt !== null) this.strike();
    });
    const aimAt = (e: PointerEvent) => {
      const cue = this.balls.find((b) => b.n === 0 && b.on);
      if (!cue || !this.myTurn() || this.lockedAt !== null) return;
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * this.canvas.width;
      const y = ((e.clientY - r.top) / r.height) * this.canvas.height;
      this.aim = Math.atan2((y - RIM) / SCALE - cue.y, (x - RIM) / SCALE - cue.x);
      this.shareAim();
      this.draw();
    };
    this.canvas.addEventListener("pointermove", aimAt);
    // Left click: the first locks the aim, the second strikes.
    // With a finger: drag to aim, lift to lock it; then tap again (or the meter) to strike.
    let touchAiming = false;
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.myTurn()) return;
      if (this.lockedAt === null) {
        aimAt(e);
        if (e.pointerType === "touch") {
          touchAiming = true;
          this.canvas.setPointerCapture(e.pointerId);
        } else this.lock();
      } else {
        this.strike();
      }
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (!touchAiming || e.pointerType !== "touch") return;
      touchAiming = false;
      aimAt(e);
      this.lock();
    });
    // Right click or Esc: unlock and aim again.
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.unlock();
    });
    window.addEventListener("keydown", this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.lockedAt !== null) this.unlock();
  };

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    this.choice.destroy();
    super.destroy();
  }

  /** Where the arrow is on the meter now: 0 (bottom, green) to 1 (top, red). */
  private powerNow(): number {
    if (this.lockedAt === null) return 0.5;
    const t = ((performance.now() - this.lockedAt) % METER_MS) / METER_MS;
    return 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
  }

  private lock() {
    if (this.aim === null) return;
    this.lockedAt = performance.now();
    this.meter.hidden = false;
    this.render();
  }

  private unlock() {
    this.lockedAt = null;
    this.meter.hidden = true;
    if (this.open) this.render();
  }

  /** Your shot: as hard as where the arrow stopped. */
  private strike() {
    if (!this.myTurn() || this.aim === null) return;
    const power = Math.max(0.03, this.powerNow());
    const turn = ((this.aim % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const angle = Math.round((turn / (2 * Math.PI)) * 65536) % 65536;
    this.send({ t: "PoolShoot", angle, power: Math.round(power * 1000) });
    this.aimSent = "";
    this.unlock();
  }

  private myTurn(): boolean {
    const s = this.state;
    const me = this.selfId();
    return !this.rolling && s.status === PLAYING && (s.turn === 0 ? s.a : s.b) === me;
  }

  /** A PoolState from the server. */
  onState(s: State) {
    if (this.rolling) {
      this.pending = s;
      return;
    }
    this.apply(s);
  }

  /** Turns an angle (radians) into the protocol's fraction of a full turn. */
  private static turnOf(a: number): number {
    const turn = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return Math.round((turn / (2 * Math.PI)) * 65536) % 65536;
  }

  /** Lets the others at the table see you line up: your aim, and the cue drawn back with the meter. */
  private shareAim() {
    if (!this.myTurn() || this.aim === null) return;
    const now = performance.now();
    if (now - this.aimSentAt < 70) return;
    const angle = PoolPanel.turnOf(this.aim);
    const pull = this.lockedAt === null ? 0 : Math.round(this.powerNow() * 1000);
    const key = `${angle}:${pull}`;
    if (key === this.aimSent) return;
    this.aimSent = key;
    this.aimSentAt = now;
    this.send({ t: "PoolAim", angle, pull });
  }

  /** Someone else (or the pool shark) lining up their shot. */
  onAim(by: number, angle: number, pull: number) {
    if (by === this.selfId()) return;
    this.theirAim = { angle: (angle / 65536) * Math.PI * 2, pull: pull / 1000 };
  }

  /** A PoolShot: roll it on screen from where the balls are now. */
  onShot(by: number, vx: number, vy: number, shot: number) {
    if (shot !== this.state.shot + 1 || !this.open) return; // out of step, or not watching: wait for the state
    const cue = this.balls.find((b) => b.n === 0);
    if (!cue) return;
    cue.vx = vx - V_OFFSET;
    cue.vy = vy - V_OFFSET;
    const speed = Math.hypot(cue.vx, cue.vy);
    if (speed > MAX_SPEED) sfx.powerStrike(cue.x);
    else sfx.cueStrike(speed / MAX_SPEED, cue.x);
    this.rolling = true;
    this.theirAim = null;
    this.theirShown = null;
    this.aim = null;
    this.lockedAt = null;
    this.meter.hidden = true;
    this.steps = 0;
    this.carry = 0;
    this.lastT = performance.now();
    if (by !== this.selfId()) this.render();
  }

  private apply(s: State) {
    if (this.state.status === PLAYING && s.status !== PLAYING) this.endedAt = performance.now();
    // A new shot to line up: whatever aim we saw belongs to the last one.
    if (s.turn !== this.state.turn || s.shot !== this.state.shot) this.theirAim = null;
    // A fresh rack: numbers up again.
    if (s.shot === 0) this.orient.clear();
    this.state = s;
    this.balls = s.balls.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: 0, vy: 0, on: true }));
    if (this.open) this.render();
  }

  show() {
    super.show();
    cancelAnimationFrame(this.raf);
    const tick = (t: number) => {
      if (this.lockedAt !== null) {
        // The arrow slides up and down the meter; the cue draws back with it.
        this.arrow.style.bottom = `${this.powerNow() * 100}%`;
        this.shareAim();
        this.draw();
      } else if ((this.theirAim || this.state.hole !== NO_HOLE) && !this.rolling) {
        // Their red cue easing after where they aim, or the 8's pocket pulsing.
        // Their red cue easing after where they aim.
        this.draw();
      }
      if (this.rolling) {
        // Real time: 240 physics steps a second.
        this.carry += ((t - this.lastT) / 1000) * 240;
        this.lastT = t;
        let still = false;
        this.knocks = 0;
        const from = this.balls.map((b) => [b.x, b.y]);
        while (this.carry >= 1 && !still) {
          this.carry -= 1;
          this.steps++;
          still = !step(this.balls, this.knock) || this.steps >= MAX_STEPS;
        }
        // Each ball turns over as far as it rolled.
        this.balls.forEach((b, i) => {
          if (b.on) this.orient.set(b.n, roll(this.orient.get(b.n) ?? NUMBER_UP, b.x - from[i][0], b.y - from[i][1]));
        });
        // The hush of the balls over the cloth.
        sfx.poolRoll.update(still ? 0 : this.balls.reduce((s, b) => s + (b.on ? Math.hypot(b.vx, b.vy) : 0), 0));
        if (still) {
          this.rolling = false;
          if (this.pending) this.apply(this.pending);
          this.pending = null;
          this.render();
        }
        this.draw();
      }
      if (this.open) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  hide() {
    super.hide();
    this.choice.hide();
    cancelAnimationFrame(this.raf);
    sfx.poolRoll.stop();
    this.lockedAt = null;
    this.meter.hidden = true;
    // Not watching: skip to where the balls end up.
    if (this.rolling) {
      this.rolling = false;
      if (this.pending) this.apply(this.pending);
      this.pending = null;
    }
  }

  private who(id: number) {
    return id === this.selfId() ? "You" : id === BOT ? "Pool shark 🦈" : this.nameOf(id);
  }

  render() {
    const s = this.state;
    const me = this.selfId();
    this.body.replaceChildren();
    const group = (p: number) => {
      if (!s.groups) return "";
      const solids = (p === 0) === (s.groups === SOLIDS);
      return solids ? " · solids" : " · stripes";
    };
    const line = el("div", "pool-players");
    if (s.status === EMPTY) line.textContent = "The table's free. Rack 'em up?";
    else if (s.status === WAITING) line.textContent = `${this.who(s.a)} ${s.a === me ? "are" : "is"} chalking a cue, waiting for an opponent…`;
    else line.textContent = `${this.who(s.a)}${group(0)}  vs  ${this.who(s.b)}${group(1)}`;
    const status = el("p", "pool-status");
    if (s.status === PLAYING) {
      const up = s.turn === 0 ? s.a : s.b;
      status.textContent = this.rolling
        ? "Rolling…"
        : up !== me
          ? `${this.who(up)}'s shot.`
          : this.lockedAt === null
            ? s.hole !== NO_HOLE
              ? "Your shot: sink the 8 in the glowing green pocket (where your last ball went)! Point the cue and click to lock your aim."
              : "Your shot: point the cue and click to lock your aim."
            : "Click again to strike: the higher the arrow, the harder the hit. (Right-click to re-aim.)";
    } else if (s.status === A_WON || s.status === B_WON) {
      const winner = s.status === A_WON ? s.a : s.b;
      status.textContent = winner === me ? "🏆 You win!" : `🏆 ${this.who(winner)} ${winner === BOT ? "wins" : "wins"}.`;
    }
    const table = el("div", "pool-table");
    table.append(this.canvas, this.meter);
    this.body.append(line, table, status);

    const row = el("div", "pool-actions");
    const inGame = s.a === me || s.b === me;
    if (s.status === PLAYING && inGame) {
      row.append(button("Leave game", () => this.send({ t: "PoolLeave" }), "subtle"));
    } else if (s.status === WAITING && s.a === me) {
      row.append(
        button("Play the pool shark (AI bot) instead 🦈", () => this.send({ t: "PoolJoin", vsBot: true }), "primary"),
        button("Put the cue down", () => this.send({ t: "PoolLeave" }), "subtle"),
      );
    } else if (s.status === WAITING) {
      row.append(button(`🎱 Play ${this.who(s.a)}`, () => this.send({ t: "PoolJoin", vsBot: false }), "primary"));
    } else if (s.status !== PLAYING) {
      row.append(
        button("Play the pool shark (AI bot) 🦈", () => this.send({ t: "PoolJoin", vsBot: true }), "primary"),
        button("Wait for a player", () => this.send({ t: "PoolJoin", vsBot: false })),
      );
    } else {
      row.append(el("p", "hint", "A game's on. Pull up a stool and watch."));
    }
    this.body.append(row);
    this.ask();
    this.draw();
  }

  /** Stepping up to a free table (or one with someone waiting): how do you want to play? */
  private ask() {
    const s = this.state;
    const me = this.selfId();
    const join = (vsBot: boolean) => () => this.send({ t: "PoolJoin", vsBot });
    if (s.status === WAITING && s.a !== me) {
      this.choice.show(
        "Pool",
        `${this.who(s.a)} is chalking a cue, waiting for an opponent.`,
        [{ icon: "🎱", label: `Play ${this.who(s.a)}`, sub: "8-ball, head to head", primary: true, pick: join(false) }],
        () => this.hide(),
        "🍺 The Mossy Mug",
      );
      return;
    }
    if (s.status === PLAYING || s.status === WAITING) {
      this.choice.hide();
      return;
    }
    const ended = s.status === A_WON || s.status === B_WON;
    const wait = this.endedAt + 1600 - performance.now();
    if (ended && wait > 0) {
      this.choice.hide();
      window.setTimeout(() => this.open && !this.rolling && this.render(), wait + 20);
      return;
    }
    const winner = s.status === A_WON ? s.a : s.b;
    this.choice.show(
      ended ? (winner === me ? "🏆 You win!" : `🏆 ${this.who(winner)} wins`) : "Pool",
      ended ? "Rack 'em up again?" : "The table's free. 8-ball: pot your group, then the 8.",
      [
        { icon: "🦈", label: "Play the pool shark", sub: "AI bot · starts now", primary: true, pick: join(true) },
        { icon: "👥", label: "Wait for a player", sub: "Someone at the bar joins", pick: join(false) },
      ],
      () => this.hide(),
      ended ? "🎱 Pool" : "🍺 The Mossy Mug",
    );
  }

  /** The table, the balls and, on your shot, where you're aiming. */
  private draw() {
    const ctx = this.canvas.getContext("2d")!;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#3b3a2e";
    ctx.fillRect(0, 0, cw, ch - TRAY);
    this.drawTray(ctx, cw, ch);
    ctx.fillStyle = "#7d5232";
    ctx.fillRect(3, 3, cw - 6, ch - TRAY - 6);
    ctx.fillStyle = "#8a5a33";
    ctx.fillRect(6, 6, cw - 12, 4);
    ctx.fillStyle = "#2f7a4f";
    ctx.fillRect(RIM, RIM, W * SCALE, H * SCALE);
    ctx.fillStyle = "#2a6d47";
    ctx.fillRect(RIM, RIM + H * SCALE - 4, W * SCALE, 4);
    const at = (x: number, y: number): [number, number] => [RIM + x * SCALE, RIM + y * SCALE];
    // the head string and the foot spot
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(RIM + 250 * SCALE, RIM, 1, H * SCALE);
    for (const [px, py] of POCKETS) {
      const [x, y] = at(px, Math.min(Math.max(py, 0), H));
      ctx.fillStyle = "#151515";
      ctx.beginPath();
      ctx.arc(x, y, POCKET_R * SCALE, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.aim !== null && this.myTurn()) {
      const cue = this.balls.find((b) => b.n === 0 && b.on);
      if (cue) {
        const [x, y] = at(cue.x, cue.y);
        const len = 260 * SCALE;
        ctx.strokeStyle = "rgba(255,248,227,0.7)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(this.aim) * len * 2.2, y + Math.sin(this.aim) * len * 2.2);
        ctx.stroke();
        ctx.setLineDash([]);
        // the cue stick, drawn back from the ball as the power builds
        const back = 6 + this.powerNow() * (this.lockedAt === null ? 0 : 50);
        ctx.strokeStyle = "#d2a06a";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(this.aim) * back, y - Math.sin(this.aim) * back);
        ctx.lineTo(x - Math.cos(this.aim) * (back + 120), y - Math.sin(this.aim) * (back + 120));
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    this.drawEightHole(ctx, at);
    this.drawTheirCue(ctx, at);
    for (const b of this.balls) {
      if (!b.on) continue;
      const [x, y] = at(b.x, b.y);
      drawBall(ctx, b.n, x, y, R * SCALE, this.orient.get(b.n));
    }
  }

  /** Once the player up has cleared their group: the pocket the 8 must go in, pulsing see-through green. */
  private drawEightHole(ctx: CanvasRenderingContext2D, at: (x: number, y: number) => [number, number]) {
    const hole = this.state.hole;
    if (hole === NO_HOLE || this.rolling || this.state.status !== PLAYING) return;
    const [px, py] = POCKETS[hole];
    const [x, y] = at(px, Math.min(Math.max(py, 0), H));
    const pulse = 0.5 + 0.5 * Math.sin((performance.now() / 700) * Math.PI * 2);
    const r = POCKET_R * SCALE;
    ctx.fillStyle = `rgba(95, 224, 120, ${0.25 + 0.35 * pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, r + 2 + pulse * 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(160, 255, 170, ${0.5 + 0.4 * pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /** While it's the other side's shot: their red cue, swinging round and drawing back as they line up. */
  private drawTheirCue(ctx: CanvasRenderingContext2D, at: (x: number, y: number) => [number, number]) {
    const want = this.theirAim;
    if (!want || this.rolling || this.myTurn() || this.state.status !== PLAYING) {
      this.theirShown = null;
      return;
    }
    const cue = this.balls.find((b) => b.n === 0 && b.on);
    if (!cue) return;
    // Ease after their aim, the short way round.
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastDrawn) / 1000);
    this.lastDrawn = now;
    let shown = this.theirShown;
    if (!shown) shown = this.theirShown = { ...want };
    else {
      const e = 1 - Math.exp(-dt / 0.08);
      let da = want.angle - shown.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      shown.angle += da * e;
      shown.pull += (want.pull - shown.pull) * e;
    }
    const [x, y] = at(cue.x, cue.y);
    const c = Math.cos(shown.angle);
    const sn = Math.sin(shown.angle);
    // A faint line where they're looking…
    ctx.strokeStyle = "rgba(232, 86, 107, 0.45)";
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + c * 260 * SCALE * 1.4, y + sn * 260 * SCALE * 1.4);
    ctx.stroke();
    ctx.setLineDash([]);
    // …and the red cue, drawn back with their power.
    const back = 6 + shown.pull * 50;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#c8553d";
    ctx.beginPath();
    ctx.moveTo(x - c * back, y - sn * back);
    ctx.lineTo(x - c * (back + 120), y - sn * (back + 120));
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /**
   * Below the table: the balls already pocketed, under whoever they belong
   * to once solids and stripes are settled (the 8, if it's down, between).
   */
  private drawTray(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
    const top = ch - TRAY;
    ctx.fillStyle = "#4e3420";
    ctx.fillRect(0, top, cw, TRAY);
    ctx.fillStyle = "#3b2a1c";
    ctx.fillRect(0, top, cw, 3);
    const onTable = new Set(this.state.balls.map((b) => b.n));
    const down = Array.from({ length: 15 }, (_, i) => i + 1).filter((n) => !onTable.has(n));
    if (!this.state.balls.length) return;
    const r = R * SCALE;
    const y = top + TRAY / 2 + 1;
    const gap = r * 2 + 4;
    const s = this.state;
    const row = (balls: number[], x0: number, dir: 1 | -1) => balls.forEach((n, i) => drawBall(ctx, n, x0 + dir * i * gap, y, r));
    ctx.font = "bold 10px ui-rounded, system-ui, sans-serif";
    ctx.fillStyle = "#e9d4a8";
    ctx.textBaseline = "middle";
    if (!s.groups) {
      row(down.filter((n) => n !== 8), RIM + r, 1);
    } else {
      const aSolids = s.groups === SOLIDS;
      const solids = down.filter((n) => n < 8);
      const stripes = down.filter((n) => n > 8);
      const [left, right] = aSolids ? [solids, stripes] : [stripes, solids];
      ctx.textAlign = "left";
      ctx.fillText(this.who(s.a), 8, y);
      row(left, 8 + ctx.measureText(this.who(s.a)).width + r + 6, 1);
      ctx.textAlign = "right";
      ctx.fillText(this.who(s.b), cw - 8, y);
      row(right, cw - 8 - ctx.measureText(this.who(s.b)).width - r - 6, -1);
    }
    if (down.includes(8)) drawBall(ctx, 8, cw / 2, y, r);
  }
}
