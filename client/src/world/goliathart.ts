// The Goliath: the arena's giant, drawn live (pixel by pixel, posed every
// frame), not anyone's avatar blown up. A brute half again a gladiator's
// height and twice as broad: a bronze great-helm with curling horns and a
// T-slit visor (its eyes burning red when it rages), spiked bronze
// pauldrons, a bare scarred chest crossed by a leather harness, bracers, a
// studded belt over a skirt of leather strips, bronze greaves, and a torn
// crimson cape behind. Its arms are jointed (shoulder, elbow, fist) so it
// can swing its great spiked club: hanging low in its fist at rest
// (dragged as it walks), hauled up and brought crashing down, raised
// overhead for the leap, shouldered while it whirls someone in its grip.

import type { Graphics } from "pixi.js";

export type GoliathAct = "idle" | "walk" | "windup" | "smash" | "crouch" | "charge" | "air" | "land" | "grab" | "block" | "stun" | "down" | "dash";

export interface GoliathPose {
  /** Which way it faces (1 east, −1 west). */
  face: 1 | -1;
  act: GoliathAct;
  /** How far into the act (0..1). */
  k: number;
  /** The walk cycle (radians). */
  step: number;
  /** Wall time (ms): breathing, the cape, flicker. */
  now: number;
  /** Raging (or holding someone): the eyes burn. */
  rage: boolean;
  /** Just hit: a flash. */
  hurt: boolean;
  /** Whirling someone: where they are, held (px from its feet: across, down), its hands out to them. */
  hold?: { dx: number; dy: number };
}

const O = 0x2b2233;
const SKIN = 0xa86e46;
const SKIN_HI = 0xc98a5a;
const SKIN_LO = 0x7a4a2c;
const BRONZE = 0xb8862e;
const BRONZE_HI = 0xe0b85a;
const BRONZE_LO = 0x7a5418;
const LEATHER = 0x5a3a22;
const LEATHER_LO = 0x3a2414;
const RED = 0x8f2b26;
const RED_LO = 0x5a1814;
const IRON = 0x4a4a56;
const STEEL = 0xd8dce8;
const WOOD = 0x6b4426;

/** How tall it stands (px, feet to the top of its horns): its bars and name go above. */
export const GOLIATH_HEIGHT = 96;

/**
 * Draws the Goliath into `g`, its feet at (fx, fy) (already lifted, if it's
 * in the air).
 */
export function drawGoliath(g: Graphics, fx: number, fy: number, p: GoliathPose) {
  const f = p.face;
  // Mirrored by facing: x forward is +x for f = 1.
  const rect = (x: number, y: number, w: number, h: number, c: number, a = 1) => {
    const X = f > 0 ? fx + x : fx - x - w;
    g.rect(Math.round(X), Math.round(fy + y), w, h).fill({ color: c, alpha: a });
  };
  const dot = (x: number, y: number, s: number, c: number) => rect(x - s / 2, y - s / 2, s, s, c);
  /** A thick segment from (x0, y0) at angle `a` (0 forward, π/2 down), `len` long, `w` thick; returns its end. */
  const seg = (x0: number, y0: number, a: number, len: number, w: number, c: number, out = true): [number, number] => {
    const x1 = x0 + Math.cos(a) * len;
    const y1 = y0 + Math.sin(a) * len;
    const n = Math.max(1, Math.round(len));
    if (out) for (let i = 0; i <= n; i++) dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, w + 2, O);
    for (let i = 0; i <= n; i++) dot(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, w, c);
    return [x1, y1];
  };
  const t = p.now / 1000;
  const k = Math.max(0, Math.min(1, p.k));
  // ---- the pose: how low the body sits, how it leans, where its arms and club go ----
  let drop = Math.round(Math.sin(t * 2.2) * 1); // breathing
  let sway = 0;
  let legSpread = 0;
  let kneel = false;
  // Arm angles: [upper, fore] for the club arm (front) and the other (back); the club's angle.
  let front: [number, number] = [1.3, 1.45];
  let back: [number, number] = [1.78, 1.68];
  let club = 1.38;
  let clubOnBack = false;
  const stride = p.act === "walk" || p.act === "dash" ? Math.sin(p.step) : 0;
  switch (p.act) {
    case "dash":
      // Charging across the sand: hunched low and forward, arms and club trailing.
      drop += 3 + Math.round(Math.abs(Math.cos(p.step)) * 2);
      sway = 5;
      front = [2.3, 2.1];
      back = [1.1, 0.9];
      club = 2.75;
      break;
    case "walk":
      drop += Math.round(Math.abs(Math.cos(p.step)) * 2);
      front = [1.25 + stride * 0.15, 1.4 + stride * 0.1];
      back = [1.78 - stride * 0.3, 1.66 - stride * 0.25];
      club = 1.3 + stride * 0.12;
      break;
    case "windup": {
      // Hauling the club up and back over its shoulder.
      const e = 1 - (1 - k) * (1 - k);
      front = [1.3 - 3.1 * e, 1.45 - 3.6 * e];
      back = [1.78 - 0.6 * e, 1.68 - 0.9 * e];
      club = 1.38 - 3.9 * e;
      drop += Math.round(2 * e);
      sway = -3 * e;
      break;
    }
    case "smash": {
      // Brought crashing down in front of it, then hauled back up.
      const e = Math.min(1, k * 3);
      front = [-1.8 + 2.35 * e, -2.15 + 2.95 * e];
      back = [1.05, 0.75];
      club = -2.5 + 3.35 * e;
      drop += Math.round(5 * e * (1 - k));
      sway = 5 * e * (1 - k);
      legSpread = 2;
      break;
    }
    case "charge":
    case "crouch": {
      // The club up overhead in both hands, knees bent, shaking with the strain.
      const e = p.act === "crouch" ? 1 : Math.min(1, k * 2);
      const shake = p.act === "charge" && k >= 1 ? Math.sin(p.now / 28) * 1.5 : 0;
      front = [-1.45 - 0.2 * e, -1.6];
      back = [-1.2, -1.3];
      club = -Math.PI + 0.06 + shake * 0.04;
      drop += Math.round(4 * e + (p.act === "crouch" ? 4 : 0));
      sway = shake;
      legSpread = 3;
      break;
    }
    case "air":
      front = [-1.45, -1.6];
      back = [-1.2, -1.3];
      club = -Math.PI + 0.08;
      legSpread = -2;
      break;
    case "land": {
      const e = 1 - k;
      front = [0.7, 1.1];
      back = [1.4, 1.3];
      club = 1.15;
      drop += Math.round(9 * e);
      legSpread = 4;
      break;
    }
    case "grab": {
      // Both arms straight out to the one it's whirling (gripped by the legs),
      // leaning back against the pull; the club slung on its back.
      clubOnBack = true;
      legSpread = 4;
      if (p.hold) {
        const fwd = Math.abs(p.hold.dx);
        const ty = p.hold.dy;
        const a1 = Math.atan2(ty + 60, fwd - 20);
        const a2 = Math.atan2(ty + 60, fwd + 20);
        front = [a1, a1];
        back = [a2, a2];
        sway = -3;
        drop += 2;
      } else {
        front = [-0.7, -1.2];
        back = [-2.45, -1.95];
        sway = Math.sin(p.now / 70) * 1.5;
      }
      break;
    }
    case "block":
      front = [0.25, -0.7];
      back = [0.7, -0.4];
      club = -1.55;
      drop += 2;
      break;
    case "stun":
      sway = Math.sin(p.now / 45) * 3;
      front = [1.5, 1.6];
      back = [1.9, 1.8];
      club = 1.5;
      drop += 2;
      break;
    case "down":
      kneel = true;
      front = [1.1, 1.5];
      back = [1.7, 1.75];
      club = 0.15;
      drop = 20;
      break;
  }
  const by = drop; // the body's sink
  const bx = sway;
  // ---- the cape, behind ----
  const flap = Math.sin(t * 3 + (p.act === "walk" || p.act === "dash" ? p.step : 0)) * 2;
  // (Hung from both shoulders, flaring out either side below them, ragged at the hem.)
  for (let i = 0; i < 6; i++) {
    const y0 = -60 + by + i * 8;
    const half = 22 + i * 1.6;
    const sw = flap * (i / 6);
    rect(-half - 1 + bx + sw, y0 - 1, half * 2 + 2, 10, O);
    rect(-half + bx + sw, y0, half * 2, 9, i % 2 ? RED : RED_LO);
  }
  for (let x = -30; x < 30; x += 5) rect(x + bx + flap, -13 + by + (Math.abs(x) % 10 === 0 ? 3 : 0), 4, 4, RED_LO);
  // ---- the legs ----
  if (kneel) {
    rect(-14, -12, 30, 12, O);
    rect(-13, -11, 12, 10, BRONZE);
    rect(2, -11, 13, 10, BRONZE);
    rect(-13, -11, 12, 2, BRONZE_HI);
  } else {
    for (const side of [-1, 1]) {
      const lift = p.act === "walk" || p.act === "dash" ? Math.max(0, side * stride) * (p.act === "dash" ? 5 : 3) : 0;
      const sx = side * (7 + legSpread) + (p.act === "walk" || p.act === "dash" ? side * stride * (p.act === "dash" ? 7 : 4) : 0);
      const top = -28 + by;
      const len = 28 - by - lift;
      rect(sx - 6, top, 12, len, O);
      rect(sx - 5, top, 10, len * 0.45, SKIN);
      rect(sx - 5, top + len * 0.45, 10, len * 0.5, BRONZE);
      rect(sx - 5, top + len * 0.45, 3, len * 0.5, BRONZE_HI);
      rect(sx - 5, top + len * 0.45, 10, 1, BRONZE_LO);
      // A sandal.
      rect(sx - 7, -4 - lift, 14, 4, LEATHER_LO);
    }
  }
  // ---- the skirt of leather strips, the belt ----
  const swish = Math.sin(t * 4 + p.step) * 1.2;
  for (let x = -16; x < 16; x += 4) rect(x + bx + swish * ((x + 16) / 32), -34 + by, 4, 12 + ((x / 4) % 2 === 0 ? 1 : 0), (x / 4) % 2 ? RED : LEATHER);
  for (let x = -14; x < 16; x += 8) dot(x + bx, -24 + by, 2, BRONZE_HI);
  rect(-18 + bx, -38 + by, 36, 6, O);
  rect(-17 + bx, -37 + by, 34, 4, LEATHER);
  for (let x = -14; x < 16; x += 6) dot(x + bx, -35 + by, 2, BRONZE_HI);
  rect(-3 + bx, -38 + by, 7, 6, BRONZE);
  rect(-2 + bx, -37 + by, 5, 2, BRONZE_HI);
  const shoulderY = -62 + by;
  // ---- the club, slung on its back while it whirls someone ----
  if (clubOnBack) {
    const cx0 = -10 + bx;
    const cy0 = -20 + by;
    const [ex, ey] = seg(cx0, cy0, -1.15, 52, 5, WOOD);
    drawClubHead(dot, ex, ey, -1.15);
  }
  // ---- the chest: broad, bare, scarred, a harness across it ----
  rect(-21 + bx, -64 + by, 42, 28, O);
  rect(-20 + bx, -63 + by, 40, 26, p.hurt ? 0xe06a5a : SKIN);
  rect(-20 + bx, -63 + by, 40, 3, SKIN_HI);
  rect(-1 + bx, -58 + by, 2, 14, SKIN_LO); // the breastbone
  rect(-15 + bx, -52 + by, 12, 2, SKIN_LO); // pecs
  rect(3 + bx, -52 + by, 12, 2, SKIN_LO);
  for (const y of [-46, -42]) {
    rect(-8 + bx, y + by, 6, 1, SKIN_LO); // abs
    rect(2 + bx, y + by, 6, 1, SKIN_LO);
  }
  rect(6 + bx, -59 + by, 1, 6, 0xd99a8a); // a scar
  rect(7 + bx, -57 + by, 1, 3, 0xd99a8a);
  for (let i = 0; i < 22; i++) dot(-14 + i * 1.3 + bx, -62 + i * 1.2 + by, 3, LEATHER); // the harness
  dot(0 + bx, -50 + by, 5, BRONZE);
  dot(0 + bx, -50 + by, 3, BRONZE_HI);
  // ---- the head: a bronze great-helm, horns, the visor ----
  const hy = -80 + by;
  rect(-7 + bx, hy + 14, 14, 4, SKIN_LO); // the neck
  rect(-11 + bx, hy - 1, 22, 18, O);
  rect(-10 + bx, hy, 20, 16, BRONZE);
  rect(-10 + bx, hy, 20, 3, BRONZE_HI);
  rect(-10 + bx, hy + 13, 20, 3, BRONZE_LO);
  rect(-1 + bx, hy - 4, 3, 5, RED); // a crest stub
  // The T-slit visor, square to the front (a pixel toward its facing), a nose-guard down it.
  rect(-7 + bx, hy + 6, 15, 3, 0x120c0a);
  rect(-1 + bx, hy + 6, 3, 8, 0x120c0a);
  rect(0 + bx, hy + 9, 1, 5, BRONZE_LO);
  const eye = p.rage ? (Math.floor(p.now / 110) % 2 ? 0xff4f1a : 0xffd23f) : 0x9a2a14;
  rect(-5 + bx, hy + 7, 3, 1, eye);
  rect(3 + bx, hy + 7, 3, 1, eye);
  if (p.rage) rect(-8 + bx, hy + 4, 17, 7, 0xff4f1a, 0.22);
  // Rivets down each cheek-guard.
  for (const side of [-1, 1]) for (const dy of [4, 9, 13]) rect(side * 8 + bx - (side < 0 ? 0 : 1), hy + dy, 1, 1, BRONZE_HI);
  // Horns curling out and up.
  for (const side of [-1, 1]) {
    const hx = side * 10 + bx;
    const pts: [number, number][] = [
      [hx, hy + 5],
      [hx + side * 5, hy + 2],
      [hx + side * 9, hy - 3],
      [hx + side * 11, hy - 9],
      [hx + side * 10, hy - 15],
    ];
    // Joined up, thick at the root and tapering: an outline pass, then the ivory.
    const along = (fn: (x: number, y: number, i: number) => void) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        for (let s = 0; s <= 4; s++) fn(x0 + ((x1 - x0) * s) / 4, y0 + ((y1 - y0) * s) / 4, i + s / 4);
      }
    };
    along((x, y, i) => dot(x, y, Math.round(8 - i * 1.4), O));
    along((x, y, i) => dot(x, y, Math.max(2, Math.round(6 - i * 1.4)), i < 2.5 ? 0xefe4cf : 0xc8b490));
  }
  // ---- both arms, one each side, out from under the pauldrons: the off one, the club one ----
  const arm = (sx: number, ang: [number, number]): [number, number] => {
    const [ex, ey] = seg(sx + bx, shoulderY + 2, ang[0], 14, 10, SKIN);
    const hand = seg(ex, ey, ang[1], 13, 9, SKIN);
    seg(ex + Math.cos(ang[1]) * 4, ey + Math.sin(ang[1]) * 4, ang[1], 8, 10, BRONZE, false); // a bracer
    return hand;
  };
  const fist = (x: number, y: number) => {
    dot(x, y, 10, O);
    dot(x, y, 8, SKIN);
    dot(x - 1, y - 1, 3, SKIN_HI);
  };
  const [bhx, bhy] = arm(-20, back);
  const [fhx, fhy] = arm(20, front);
  // ---- the pauldrons, over the tops of the arms ----
  for (const side of [-1, 1]) {
    const px = side * 19 + bx;
    for (const [dx, dy, s] of [
      [0, 0, 14],
      [side * 2, -2, 10],
    ] as [number, number, number][]) {
      dot(px + dx, shoulderY + 1 + dy, s + 2, O);
      dot(px + dx, shoulderY + 1 + dy, s, BRONZE);
    }
    dot(px - side * 2, shoulderY - 1, 4, BRONZE_HI);
    for (let i = 0; i < 3; i++) seg(px + side * (2 + i * 3), shoulderY - 4, -1.57 + side * (0.6 - i * 0.25), 6, 2, STEEL, false);
  }
  // ---- the club, through its fist (a little behind it, most ahead); the fists over it ----
  if (!clubOnBack) {
    const sx = fhx - Math.cos(club) * 8;
    const sy = fhy - Math.sin(club) * 8;
    const [ex, ey] = seg(sx, sy, club, 46, 5, WOOD);
    drawClubHead(dot, ex, ey, club);
  }
  fist(bhx, bhy);
  fist(fhx, fhy);
  if (p.act === "down") {
    // Slumped: the helm bowed (a shadow over the visor).
    rect(-10 + bx, hy + 5, 20, 6, 0x120c0a, 0.4);
  }
}

/** The club's head: a great iron-banded knot of wood, studded with spikes. */
function drawClubHead(dot: (x: number, y: number, s: number, c: number) => void, x: number, y: number, a: number) {
  dot(x, y, 22, O);
  dot(x, y, 19, WOOD);
  dot(x - 3, y - 3, 8, 0x8a6040);
  // An iron band round it.
  for (let i = -8; i <= 8; i += 2) dot(x + Math.cos(a + Math.PI / 2) * i, y + Math.sin(a + Math.PI / 2) * i, 3, IRON);
  // Spikes all round.
  for (let s = 0; s < 8; s++) {
    const b = a + (s / 8) * Math.PI * 2;
    for (let r = 10; r < 16; r++) dot(x + Math.cos(b) * r, y + Math.sin(b) * r, r < 13 ? 3 : 2, r < 13 ? 0x9a9aa8 : STEEL);
  }
}
