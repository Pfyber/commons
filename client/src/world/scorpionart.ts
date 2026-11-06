// The great scorpion: as wide as the Goliath and low to the sand, its tail
// arching as high as the Goliath's head. Drawn live from a rig, like the lions:
// a plated body, eight legs that walk in a proper alternating gait, two jointed
// pincers that open and snap, and a tail of five segments ending in a venom
// bulb and a hooked sting. Each act gives the rig a pose, and the arena eases
// the rig toward it every frame, so the whole thing moves like one animal.

import type { Graphics } from "pixi.js";

export type ScorpionAct = "idle" | "walk" | "rise" | "rear" | "wind" | "strike" | "spit" | "dead";

export interface ScorpionRig {
  /** How high its body rides (px above the sand, as a negative y). */
  body: number;
  /** Its front lower (+) than its rear. */
  pitch: number;
  /** The legs: how far through the gait, how long a stride, how far they lift. */
  stride: number;
  lift: number;
  /** How splayed they are. */
  splay: number;
  /** The pincers: raised, reached out, open. */
  clawUp: number;
  clawOut: number;
  clawOpen: number;
  /** The tail: where it leaves the body (radians), and how much it curls at each joint. */
  tailBase: number;
  tailCurl: number;
  /** A shudder through it. */
  shake: number;
  /** Lying dead, legs curled under. */
  dead: number;
}

/** The pose for what it's doing: `k` how far in (0..1). */
export function scorpionRig(act: ScorpionAct, k: number, now: number): ScorpionRig {
  const t = now / 1000;
  const u = Math.max(0, Math.min(1, k));
  const sway = Math.sin(t * 1.5);
  const r: ScorpionRig = {
    body: -20 + Math.sin(t * 1.9) * 0.5,
    pitch: 0,
    stride: 0,
    lift: 0,
    splay: 1,
    clawUp: 0.25 + sway * 0.05,
    clawOut: 0.45,
    clawOpen: 0.3 + Math.max(0, Math.sin(t * 2.7)) * 0.25,
    tailBase: -2.05 + sway * 0.04,
    tailCurl: 0.5 + Math.sin(t * 2.1) * 0.02,
    shake: 0,
    dead: 0,
  };
  switch (act) {
    case "walk":
      r.stride = 7;
      r.lift = 5;
      r.body = -20.5 + Math.sin(t * 9) * 0.7;
      r.clawUp = 0.32 + Math.sin(t * 4.5) * 0.08;
      r.clawOut = 0.6;
      r.tailBase = -2.05 + Math.sin(t * 4.5) * 0.05;
      break;
    case "rise":
      // Coming up with the wheel: hunched, pincers drawn in, tail tight.
      r.body = -16;
      r.clawUp = 0.1;
      r.clawOut = 0.1;
      r.clawOpen = 0.1;
      r.tailBase = -2.3;
      r.tailCurl = 0.62;
      break;
    case "rear": {
      // Up on its back legs: pincers flung wide, tail high, shaking with it.
      const up = Math.sin(Math.min(1, u * 2.2) * Math.PI * 0.5);
      const fade = Math.min(1, (1 - u) * 4);
      r.body = -20 - 5 * up * fade;
      r.pitch = -7 * up * fade;
      r.clawUp = 0.3 + 0.95 * up * fade;
      r.clawOut = 0.5 + 0.4 * up * fade;
      r.clawOpen = 0.3 + 0.7 * up * fade;
      r.tailBase = -2.05 + 0.28 * up * fade;
      r.tailCurl = 0.5 - 0.06 * up * fade;
      r.shake = 1.3 * up * fade;
      break;
    }
    case "wind": {
      // The tail hauled right back and quivering, pincers spread to hold you.
      const d = Math.sin(Math.min(1, u * 1.4) * Math.PI * 0.5);
      r.body = -16;
      r.pitch = 2 * d;
      r.clawUp = 0.5 * d + 0.2;
      r.clawOut = 0.8;
      r.clawOpen = 0.9;
      r.tailBase = -2.05 - 0.62 * d;
      r.tailCurl = 0.5 + 0.13 * d;
      r.shake = 0.8 * d;
      break;
    }
    case "strike":
      // Over the top and down: the sting driven in, pincers snapping shut.
      r.body = -14.5;
      r.pitch = 5;
      r.clawUp = 0.1;
      r.clawOut = 0.95;
      r.clawOpen = 0;
      r.tailBase = -1.02;
      r.tailCurl = 0.47;
      break;
    case "spit": {
      // Tail levelled over its back like a crossbow.
      const d = Math.sin(Math.min(1, u * 1.2) * Math.PI * 0.5);
      r.body = -21;
      r.pitch = -1.5 * d;
      r.clawUp = 0.35;
      r.clawOut = 0.3;
      r.tailBase = -2.05 + 0.35 * d;
      r.tailCurl = 0.5 - 0.1 * d;
      r.shake = 0.5 * d;
      break;
    }
    case "dead":
      r.body = -10;
      r.dead = 1;
      r.splay = 0.55;
      r.clawUp = -0.25;
      r.clawOut = 0.15;
      r.clawOpen = 0.9;
      r.tailBase = -3.05;
      r.tailCurl = 0.14;
      break;
    default:
      break;
  }
  return r;
}

/** How wide it is, and how tall its tail stands (px): its health bar goes above. */
export const SCORPION_HEIGHT = 104;

const LINE = 0x140a0a;
const SHELL = 0x2a1812;
const SHELL_MID = 0x46281a;
const SHELL_HI = 0x9a5e28;
const RIM = 0xe0a24a;
const JOINT = 0xc8701e;
const FAR = 0x1a0f0c;
const FAR_HI = 0x301c14;
const BELLY = 0x5e3518;
const EYE = 0xff3a1a;
const BARB = 0xe8dcc4;
const VENOM = 0x8cff4e;

/** Draws the scorpion from its rig, its middle on the sand at (fx, fy). */
/** A blow lands: it blanches toward a pale red, still itself (it's a big thing to flash, and it's hit often). */
function flash(c: number): number {
  const mix = (k: number, to: number) => Math.round(((c >> k) & 255) * 0.35 + to * 0.65) << k;
  return mix(16, 255) | mix(8, 170) | mix(0, 150);
}

export function drawScorpion(g: Graphics, fx: number, fy: number, r: ScorpionRig, face: 1 | -1, step: number, now: number, hurt: boolean) {
  const X = (x: number, w: number) => (face > 0 ? fx + x : fx - x - w);
  // (Runs of one colour go down as a single fill: most of it is.)
  let run = -1;
  const flush = () => {
    if (run >= 0) g.fill({ color: hurt ? flash(run) : run });
  };
  const px = (x: number, y: number, w: number, h: number, c: number) => {
    if (c !== run) {
      flush();
      run = c;
    }
    g.rect(Math.round(X(x, w)), Math.round(fy + y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  };
  const oval = (cx: number, cy: number, rx: number, ry: number, c: number) => {
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      const q = 1 - (y / ry) ** 2;
      if (q <= 0) continue;
      const w = Math.sqrt(q) * rx;
      px(cx - w, cy + y, w * 2, 1, c);
    }
  };
  /** A tapering capsule, in steps of a pixel or two. */
  const limb = (x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, c: number) => {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const w = w0 + (w1 - w0) * t;
      px(x0 + (x1 - x0) * t - w / 2, y0 + (y1 - y0) * t - w / 2, w, w, c);
    }
  };
  const lined = (x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, c: number) => {
    limb(x0, y0, x1, y1, w0 + 2, w1 + 2, LINE);
    limb(x0, y0, x1, y1, w0, w1, c);
  };
  const shudder = r.shake ? Math.sin(now / 24) * r.shake : 0;
  const y0 = (x: number) => r.body + (r.pitch * x) / 24 + shudder * 0.4;
  const fold = r.dead;

  // ---- a leg: up from the hip to a high knee, and down to a pointed foot ----
  const leg = (hx: number, reach: number, phase: number, far: boolean) => {
    const a = step + phase;
    const foot = hx + reach * r.splay + Math.sin(a) * r.stride;
    const liftBy = Math.max(0, Math.cos(a)) * r.lift;
    const hy = y0(hx) + (far ? 3 : 8);
    const footY = (far ? -3 : 0) - liftBy - fold * 4;
    const kx = hx + (foot - hx) * 0.55;
    const ky = hy - (far ? 9 : 5) + liftBy * 0.5 + fold * 8;
    const ax = foot + (foot - hx) * 0.12;
    const ay = (ky + footY) / 2 + 3;
    const [col, hi] = far ? [FAR, FAR_HI] : [SHELL_MID, SHELL_HI];
    lined(hx, hy, kx, ky, 5, 3.8, col);
    lined(kx, ky, ax, ay, 3.8, 2.6, col);
    lined(ax, ay, foot, footY, 2.4, 1, far ? FAR_HI : SHELL);
    px(kx - 1, ky - 1, 2, 2, far ? FAR_HI : JOINT);
    px(ax, ay, 1, 1, hi);
  };
  // Eight legs, walking as a scorpion does: each side's in turn, the two sides opposite.
  const HIPS = [11, 3, -6, -14];
  const REACH = [15, 8, -6, -16];
  HIPS.forEach((hx, i) => leg(hx - 1, REACH[i] * 1.05, (i % 2 ? 0 : Math.PI) + Math.PI / 2, true));

  // ---- a pincer: arm, forearm, the swollen hand, a fixed finger and a moving one ----
  const pincer = (far: boolean) => {
    const dip = far ? -3 : 0;
    const [col, hi] = far ? [FAR, FAR_HI] : [SHELL_MID, SHELL_HI];
    const sx = 24;
    const sy = y0(24) + 3 + dip;
    const ex = sx + 6 + r.clawOut * 7;
    const ey = sy - 1 - r.clawUp * 13;
    const wx = ex + 6 + r.clawOut * 7;
    const wy = ey - 2 - r.clawUp * 12 + shudder * 0.6;
    lined(sx, sy, ex, ey, 6.4, 5.4, col);
    lined(ex, ey, wx, wy, 5.4, 6.4, col);
    px(ex - 1.5, ey - 1.5, 3, 3, far ? FAR_HI : JOINT);
    // The hand: a great swollen crusher, ridged.
    const ang = Math.atan2(wy - ey, wx - ex) - r.clawUp * 0.2;
    const hx = wx + Math.cos(ang) * 8;
    const hy = wy + Math.sin(ang) * 8;
    oval(hx, hy, 12, 9, LINE);
    oval(hx, hy, 11, 8, col);
    oval(hx, hy + 3, 9, 4, far ? FAR : SHELL);
    if (!far) {
      oval(hx - 1, hy - 3.4, 7, 2.4, SHELL_HI);
      px(hx - 6, hy - 5.4, 9, 1, RIM);
    }
    // Fixed finger, and the moving one swinging open and shut.
    const open = 0.1 + r.clawOpen * 0.7;
    const fin = (a: number, curl: number, w: number) => {
      const mx = hx + Math.cos(ang + a) * 15;
      const my = hy + Math.sin(ang + a) * 11;
      const tx = mx + Math.cos(ang + a + curl) * 13;
      const ty = my + Math.sin(ang + a + curl) * 13;
      lined(hx + Math.cos(ang + a) * 6, hy + Math.sin(ang + a) * 5, mx, my, w, w - 1.4, col);
      lined(mx, my, tx, ty, w - 1.4, 1, far ? FAR_HI : hi);
      if (!far) px((mx + tx) / 2, (my + ty) / 2, 2, 2, RIM);
    };
    fin(-open * 0.42, 0.3, 6.4);
    fin(open * 0.8, -0.38, 5.4);
  };
  pincer(true);

  // ---- the tail: five segments, each a little narrower, then the bulb and sting ----
  {
    let x = -24;
    let y = y0(-24) - 4;
    let a = r.tailBase + shudder * 0.012;
    const LEN = [17, 17, 16, 15, 14];
    const WID = [11, 10, 9, 8, 7];
    for (let i = 0; i < 5; i++) {
      const nx = x + Math.cos(a) * LEN[i];
      const ny = y + Math.sin(a) * LEN[i];
      lined(x, y, nx, ny, WID[i], WID[i] - 1, SHELL_MID);
      // A ridge along its back, a dark waist at each joint.
      const sx = Math.sin(a);
      const sy = -Math.cos(a);
      limb(x + sx * WID[i] * 0.28, y + sy * WID[i] * 0.28, nx + sx * WID[i] * 0.28, ny + sy * WID[i] * 0.28, 2, 1.5, SHELL_HI);
      px(nx - WID[i] / 2 + 1, ny - 1, WID[i] - 2, 2, LINE);
      px(nx - 1, ny - 1, 2, 2, JOINT);
      x = nx;
      y = ny;
      a += r.tailCurl;
    }
    // The bulb, swollen with venom, and the hook.
    const bx = x + Math.cos(a) * 6;
    const by = y + Math.sin(a) * 6;
    oval(bx, by, 8, 7, LINE);
    oval(bx, by, 7, 6, SHELL_MID);
    oval(bx - 1, by - 2, 3.4, 2, SHELL_HI);
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    px(bx - 2, by + 1, 3, 2, pulse > 0.5 ? VENOM : 0x5ec032);
    const a2 = a + 0.7;
    const hx = bx + Math.cos(a) * 7;
    const hy = by + Math.sin(a) * 7;
    const tx = hx + Math.cos(a2) * 10;
    const ty = hy + Math.sin(a2) * 10;
    lined(hx, hy, tx, ty, 3.4, 0.8, BARB);
    px(tx - 1, ty - 1, 2, 2, VENOM);
    if (r.dead < 0.5) {
      // A drop of venom hanging from the tip, swelling and falling.
      const d = (now / 900) % 1;
      if (d > 0.45) px(tx - 1, ty + 1 + (d - 0.45) * 26, 2, 2, VENOM);
    }
  }

  // ---- its body: the head-shield, then seven plates back toward the tail ----
  const plates: [number, number, number][] = [
    [-23, 7.6, 7],
    [-17, 8, 8.6],
    [-11, 8, 9.8],
    [-5, 8, 10.6],
    [1, 8, 11],
    [7, 8, 10.8],
  ];
  for (const [x, rx, ry] of plates) oval(x, y0(x), rx + 1, ry + 1, LINE);
  oval(16, y0(15), 12, 10.6, LINE);
  for (const [x, rx, ry] of plates) {
    const y = y0(x);
    oval(x, y, rx, ry, SHELL);
    oval(x, y + ry * 0.42, rx - 1, ry * 0.42, BELLY);
    oval(x - 1, y - ry * 0.46, rx * 0.72, ry * 0.34, SHELL_MID);
    px(x - 2, y - ry * 0.7, 4, 1, SHELL_HI);
    // The plate's rear edge, catching the light.
    px(x + rx - 2, y - ry * 0.7, 1, ry * 1.1, RIM);
    px(x + rx - 1, y - ry * 0.7, 1, ry * 1.1, LINE);
  }
  // The head-shield, with its eyes.
  {
    const y = y0(15);
    oval(16, y, 11, 9.6, SHELL);
    oval(15, y + 4, 9.4, 4.4, BELLY);
    oval(14.5, y - 4, 8, 3.2, SHELL_MID);
    px(9, y - 7, 9, 1, RIM);
    px(8, y - 3, 1, 7, RIM);
    // Its eyes: a cluster, burning.
    px(22, y - 4, 3, 3, EYE);
    px(18, y - 5, 3, 3, EYE);
    px(25, y - 1, 2, 2, EYE);
    px(23, y - 4, 1, 1, 0xffc0a0);
    px(19, y - 5, 1, 1, 0xffc0a0);
    // Mouthparts.
    px(26, y + 2, 4, 3, JOINT);
    px(26, y + 5, 3, 1, SHELL_HI);
  }
  // The near legs and pincer, over the body.
  HIPS.forEach((hx, i) => leg(hx, REACH[i] * 1.2, (i % 2 ? Math.PI : 0) + Math.PI / 2, false));
  pincer(false);
  flush();
}
