// The arena's lions: about a gladiator's size, gold, with a great shaggy
// brown mane, a spiky golden crown to it, a heavy muzzle, far legs in shadow
// and a tail curling up to a dark tuft. Drawn live from a little rig (a hip
// height, a pitch, four legs, a jaw, a tail): each act gives the rig a pose,
// and the arena eases each lion's rig toward it every frame, so one pose
// flows into the next instead of snapping.

import type { Graphics } from "pixi.js";
import type { ScorpionRig } from "./scorpionart";

export type LionAct = "idle" | "run" | "roar" | "crouch" | "leap" | "land" | "dead";

/** A lion's pose: all numbers, so two can be blended. */
export interface LionRig {
  /** How high its middle rides (px above its feet, as a negative y). */
  body: number;
  /** Its front lower (+) than its rump. */
  pitch: number;
  /** How far its body's stretched out (px). */
  stretch: number;
  /** Its head, up and forward of where it sits. */
  headUp: number;
  headOn: number;
  /** Its jaw (0 shut, 1 wide). */
  jaw: number;
  /** Its legs' swing from straight down (+ forward): fore far, fore near, hind far, hind near. */
  ff: number;
  fn: number;
  hf: number;
  hn: number;
  /** How much the knees bend. */
  bend: number;
  /** The tail's lift (0 low, 1 high), and its lash side to side. */
  tail: number;
  lash: number;
  /** The mane streaming back. */
  stream: number;
  /** Lying dead. */
  dead: number;
  /** Claws out. */
  claws: number;
}

/** The pose for what it's doing: `k` how far in (0..1), `step` its gallop (radians). */
export function lionRig(act: LionAct, k: number, step: number, now: number): LionRig {
  const t = now / 1000;
  const u = Math.max(0, Math.min(1, k));
  const r: LionRig = { body: -11, pitch: 0, stretch: 0, headUp: Math.sin(t * 2.2) * 0.4, headOn: 0, jaw: 0, ff: 0.12, fn: -0.08, hf: 0.14, hn: -0.14, bend: 0.25, tail: 0.75, lash: Math.sin(t * 1.8) * 0.3, stream: 0, dead: 0, claws: 0 };
  r.body += Math.sin(t * 2.4) * 0.3;
  switch (act) {
    case "run": {
      // A proper gallop: gathered, then at full stretch, forelegs reaching as the hind ones drive.
      const s = Math.sin(step);
      const c = Math.cos(step);
      r.body = -11.2 + Math.abs(c) * 1.2;
      r.pitch = s * 1.1;
      r.stretch = c * 2;
      r.ff = Math.sin(step + 0.5) * 1;
      r.fn = Math.sin(step) * 1;
      r.hf = -Math.sin(step + 0.9) * 0.95;
      r.hn = -Math.sin(step + 0.4) * 0.95;
      r.bend = 0.5;
      r.headOn = 1.2;
      r.headUp = c * 0.7;
      r.tail = 0.55 + c * 0.18;
      r.lash = Math.sin(step * 0.5);
      r.stream = 1;
      break;
    }
    case "roar": {
      const up = Math.sin(Math.min(1, u * 1.4) * Math.PI * 0.5);
      const fade = Math.min(1, (1 - u) * 5);
      r.pitch = -1.6 * up;
      r.headUp = 3.4 * up * fade;
      r.jaw = up * fade;
      r.stream = Math.sin(now / 34) * 0.6 * up * fade;
      r.tail = 1;
      r.lash = Math.sin(now / 90) * 0.5;
      break;
    }
    case "crouch": {
      // Belly to the sand, rump high, its tail whipping: it's coming.
      const d = Math.sin(Math.min(1, u * 1.5) * Math.PI * 0.5);
      r.body = -11 + 3.6 * d;
      r.pitch = 2.2 * d;
      r.stretch = -2.2 * d;
      r.headOn = 2 * d;
      r.headUp = -1.5 * d;
      r.jaw = 0.3 * d;
      r.ff = 0.65 * d;
      r.fn = 0.5 * d;
      r.hf = -0.3 * d;
      r.hn = -0.15 * d;
      r.bend = 0.3 + 0.7 * d;
      r.tail = 0.9;
      r.lash = Math.sin(now / 62) * d * 1.2;
      break;
    }
    case "leap": {
      // At full stretch: claws out ahead, hind legs flung back, jaws wide.
      r.body = -11;
      r.pitch = -2.6 + 5 * u;
      r.stretch = 5;
      r.headOn = 3;
      r.headUp = 0.5;
      r.jaw = 1;
      r.ff = 1.5;
      r.fn = 1.25;
      r.hf = -1.4;
      r.hn = -1.15;
      r.bend = 0.05;
      r.tail = 0.45;
      r.lash = -0.3;
      r.stream = 1.5;
      r.claws = 1;
      break;
    }
    case "land": {
      // Down in a rake of claws, jaws snapping shut.
      const d = 1 - u;
      r.body = -8.5 - 2.5 * u;
      r.pitch = 2.6 * d;
      r.headOn = 1.6 * d;
      r.jaw = 0.85 * d;
      r.ff = 0.2 + 0.85 * d;
      r.fn = -0.1 + 1 * d;
      r.hf = -0.4 * d;
      r.hn = -0.2 * d;
      r.bend = 0.7 * d + 0.25;
      r.claws = d;
      break;
    }
    case "dead":
      r.body = -5.5;
      r.dead = 1;
      r.ff = 1.3;
      r.fn = 1.45;
      r.hf = 1.2;
      r.hn = 1.4;
      r.bend = 0.2;
      r.tail = 0;
      r.lash = 0.2;
      r.headUp = -2;
      r.headOn = 1;
      break;
    default:
      break;
  }
  return r;
}

/** Eases rig `a` toward `b` by `t` (0..1). */
export function easeRig<R extends LionRig | ScorpionRig>(a: R, b: R, t: number) {
  const [x, y] = [a as unknown as Record<string, number>, b as unknown as Record<string, number>];
  for (const key of Object.keys(x)) x[key] += (y[key] - x[key]) * t;
}

/** How tall it stands (px, feet to the top of its mane): its health bar goes above. */
export const LION_HEIGHT = 31;

const LINE = 0x3a1e0c;
const GOLD = 0xf0c020;
const GOLD_HI = 0xffec90;
const GOLD_MID = 0xdc9a10;
const GOLD_LO = 0xa8650e;
const SHADE = 0x6e3a12;
const MANE = 0x8c5014;
const MANE_MID = 0xb87416;
const MANE_DK = 0x4a2410;
const INK = 0x2a140c;
const MOUTH = 0x8a1e1e;
const TOOTH = 0xfff6e0;

type Blob = { x: number; y: number; rx: number; ry: number; c: number };
type Limb = { x0: number; y0: number; x1: number; y1: number; w0: number; w1: number; c: number };

/** Draws a lion from its rig, its feet at (fx, fy). */
export function drawLion(g: Graphics, fx: number, fy: number, r: LionRig, face: 1 | -1, now: number, hurt: boolean) {
  const X = (x: number, w: number) => (face > 0 ? fx + x : fx - x - w);
  const px = (x: number, y: number, w: number, h: number, c: number) => {
    g.rect(Math.round(X(x, w)), Math.round(fy + y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).fill({ color: hurt ? 0xffffff : c });
  };
  /** A filled oval, a row at a time. */
  const oval = (b: Blob, grow: number, c: number) => {
    const ry = b.ry + grow;
    const rx = b.rx + grow;
    for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
      const q = 1 - (y / ry) ** 2;
      if (q <= 0) continue;
      const w = Math.sqrt(q) * rx;
      px(b.x - w, b.y + y, w * 2, 1, c);
    }
  };
  /** A tapering capsule. */
  const limb = (l: Limb, grow: number, c: number) => {
    const n = Math.max(2, Math.ceil(Math.hypot(l.x1 - l.x0, l.y1 - l.y0)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const w = l.w0 + (l.w1 - l.w0) * t + grow * 2;
      px(l.x0 + (l.x1 - l.x0) * t - w / 2, l.y0 + (l.y1 - l.y0) * t - w / 2, w, w, c);
    }
  };
  const blob = (x: number, y: number, rx: number, ry: number, c: number): Blob => ({ x, y, rx, ry, c });
  /** Where along its back `x` rides. */
  const y0 = (x: number) => r.body + (r.pitch * x) / 11;
  const fold = r.dead;
  const reach = r.stretch / 2;

  // ---- its tail: curling up from the rump to a dark tuft ----
  {
    let x = -11 - reach;
    let y = y0(-11) - 2;
    let a = Math.PI - 0.7 + fold * 0.7;
    for (let i = 0; i < 9; i++) {
      x += Math.cos(a) * 1.8;
      y += Math.sin(a) * 1.8;
      a += (0.1 + r.tail * 0.2) * (1 - fold) + r.lash * 0.06;
      px(x - 1.5, y - 1.5, 3, 3, LINE);
    }
    x = -11 - reach;
    y = y0(-11) - 2;
    a = Math.PI - 0.7 + fold * 0.7;
    for (let i = 0; i < 9; i++) {
      x += Math.cos(a) * 1.8;
      y += Math.sin(a) * 1.8;
      a += (0.1 + r.tail * 0.2) * (1 - fold) + r.lash * 0.06;
      px(x - 0.5, y - 0.5, 2, 2, i % 3 === 0 ? GOLD_HI : GOLD_MID);
    }
    oval(blob(x, y, 2.6, 3, MANE), 1, LINE);
    oval(blob(x, y, 2.6, 3, MANE), 0, MANE);
    px(x - 1, y + 1, 2, 2, MANE_DK);
  }

  // ---- a leg: two joints and a big paw, claws when it strikes ----
  const leg = (hx: number, hy: number, a: number, far: boolean, fore: boolean) => {
    const b = fore ? r.bend : -r.bend;
    const kx = hx + Math.sin(a) * 4.2;
    const ky = hy + Math.cos(a) * 4.2;
    const px1 = kx + Math.sin(a - b) * 4;
    const py1 = ky + Math.cos(a - b) * 4;
    const [top, low] = far ? [SHADE, SHADE] : [GOLD, GOLD_MID];
    const parts: Limb[] = [
      { x0: hx, y0: hy, x1: kx, y1: ky, w0: fore ? 4.4 : 5.4, w1: 3.6, c: top },
      { x0: kx, y0: ky, x1: px1, y1: py1, w0: 3.6, w1: 2.8, c: low },
    ];
    for (const p of parts) limb(p, 1, LINE);
    for (const p of parts) limb(p, 0, p.c);
    // A highlight down the front of a near leg.
    if (!far) px(kx + 0.5, ky - 3, 1, 5, GOLD_HI);
    // The paw.
    const pw = blob(px1 + 1, py1 + 0.4, 2.6, 1.5, far ? SHADE : GOLD_MID);
    oval(pw, 1, LINE);
    oval(pw, 0, pw.c);
    if (!far) px(px1 + 1, py1 - 0.4, 1, 1, GOLD_HI);
    if (r.claws > 0.3) for (let i = 0; i < 3; i++) px(px1 + 3.4, py1 - 0.6 + i, 1.4, 1, TOOTH);
  };
  leg(6 + reach, y0(6) + 3, r.ff, true, true);
  leg(-8 - reach, y0(-8) + 3, r.hf, true, false);

  // ---- its body: haunch, belly, chest, with a line round the lot ----
  const body = [blob(-7 - reach, y0(-7) - 0.5, 6, 5.6, GOLD), blob(-1, y0(-1) - 1, 7 + reach, 4.3, GOLD), blob(5 + reach, y0(5), 5, 5.2, GOLD_MID)];
  for (const b of body) oval(b, 1, LINE);
  for (const b of body) oval(b, 0, b.c);
  // Shade under, a shine along the back and on the haunch.
  oval(blob(-1, y0(-1) + 2.5, 8 + reach, 1.6, GOLD_LO), 0, GOLD_LO);
  oval(blob(-8 - reach, y0(-8) - 1.5, 2.2, 2.8, GOLD_HI), 0, GOLD_HI);
  oval(blob(-1, y0(-1) - 3.4, 5, 0.9, GOLD_HI), 0, GOLD_HI);

  leg(5 + reach, y0(5) + 3.5, r.fn, false, true);
  leg(-9 - reach, y0(-9) + 3.5, r.hn, false, false);

  // ---- its head, in its mane ----
  const hx = 10 + reach + r.headOn;
  const hy = y0(9) - 7 - r.headUp + fold * 6;
  const wave = (i: number) => Math.sin(now / 95 + i * 1.6) * (0.5 + Math.abs(r.stream) * 0.7);
  // The mane: a great ruff, spreading down the neck and streaming back.
  const ruff = [blob(hx - 3.5 - r.stream, hy + 3, 7.2, 8.4, MANE), blob(hx - 0.5, hy + 0.6, 6.4, 6.6, MANE)];
  for (const b of ruff) oval(b, 1, LINE);
  for (const b of ruff) oval(b, 0, b.c);
  // Shaggy locks over it, dark and golden by turns.
  for (let i = 0; i < 9; i++) {
    const lx = hx - 8.5 + i * 1.5 - r.stream * 1.4;
    const ly = hy - 2 + ((i * 5) % 7) * 0.6;
    const len = 6 + ((i * 3) % 4);
    limb({ x0: lx, y0: ly, x1: lx - 1 - r.stream + wave(i), y1: ly + len, w0: 1.8, w1: 0.8, c: 0 }, 0, i % 3 === 0 ? MANE_DK : i % 3 === 1 ? MANE_MID : MANE);
  }
  // Its spiky golden crown.
  for (let i = 0; i < 5; i++) {
    const cx = hx - 4 + i * 1.9;
    const lean = -0.9 - r.stream * 0.8;
    limb({ x0: cx, y0: hy - 5, x1: cx + lean + wave(i) * 0.4, y1: hy - 9 - (i % 2) * 2, w0: 2, w1: 0.8, c: 0 }, 0, i % 2 ? GOLD : GOLD_MID);
  }
  // The face: skull, a long heavy muzzle, a jaw that drops.
  const open = Math.round(r.jaw * 5);
  const skull = blob(hx + 2.4, hy - 0.8, 4.6, 4.2, GOLD);
  const nose = blob(hx + 6.2, hy + 0.4, 3.6, 2.4, GOLD_HI);
  oval(skull, 1, LINE);
  oval(nose, 1, LINE);
  if (open > 0) {
    px(hx + 3, hy + 2, 7, open + 1, LINE);
    px(hx + 3.6, hy + 2.4, 5.6, open, MOUTH);
    px(hx + 8, hy + 2.4, 1, 2, TOOTH);
    px(hx + 4.6, hy + 2.4, 1, 2, TOOTH);
    if (open > 2) px(hx + 7, hy + 1 + open, 1, 2, TOOTH);
  }
  oval(skull, 0, GOLD);
  oval(nose, 0, GOLD_HI);
  // The lower jaw.
  const jaw = blob(hx + 5.4, hy + 3 + open, 3.6, 1.2, GOLD);
  oval(jaw, 1, LINE);
  oval(jaw, 0, jaw.c);
  // Nose, a brow, an eye (shut, dead), a shine down the face.
  px(hx + 8, hy - 1, 2.4, 1.6, INK);
  px(hx + 1, hy - 3.6, 5, 1, GOLD_LO);
  if (r.dead > 0.5) px(hx + 3, hy - 2, 3, 1, INK);
  else {
    px(hx + 3, hy - 2.6, 3, 2, INK);
    px(hx + 4, hy - 2.6, 1, 1, 0xfff0a0);
  }
  px(hx + 1, hy - 0.6, 1, 3, GOLD_HI);
}
