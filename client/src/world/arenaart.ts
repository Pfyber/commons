// The arena's stonework, in the town's pixel style: the two sandstone
// pillars on the sand (a twisted column on a stepped plinth, scrolled
// volutes, a brazier of coals on top, ivy winding down), and the iron spike
// plates set into the floor
// (a riveted grate with its holes, a band of warning paint round it; the
// spikes themselves come up out of it in the show, see activities/arena.ts).

import { bowlArt } from "./amphitheatre";
import { disc, oval } from "./pixeldraw";
import { drawPixelText, pixelWidth } from "./pixelfont";

type Ctx = CanvasRenderingContext2D;
const T = 32;
const OUTLINE = "#2b2233";

function px(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** The art for one of the arena's objects, or null if it isn't one. */
export function arenaObject(o: { kind: string; x: number; y: number; w: number; h: number }): { c: HTMLCanvasElement; overhang: number } | null {
  const w = o.w * T;
  const h = o.h * T;
  if (o.kind === "arena_pillar") return smallPillar(w, h, (o.x * 7 + o.y) % 2);
  if (o.kind === "arena_spikes") return plate(w, h);
  if (o.kind === "arena_gate") return gate(w, h);
  if (o.kind === "arena_court") return court(w, h);
  if (o.kind === "arena_carpet") return carpet(w, h);
  if (o.kind === "arena_gate_w" || o.kind === "arena_gate_e") return sideGate(w, h, o.kind === "arena_gate_e");
  if (o.kind === "arena_bowl") return bowlArt(o.w, o.h);
  return null;
}

/**
 * A gladiators' gate: its art stands this far above its footprint; where its
 * two torches burn and where its iron doors close (from the art's top-left,
 * for the west gate, whose doors face east: the east gate's mirrored).
 */
export const SIDE_GATE_OVERHANG = 10;
export const SIDE_GATE_FIRES: [number, number][] = [
  [52, 2],
  [52, 98],
];
export const SIDE_GATE_DOOR = { x0: 20, x1: 60, y0: 16, y1: 90 };

/**
 * A gladiators' gate in the podium wall, facing the middle of the sand: a
 * heavy frame of dressed stone round three sides (an arch at its back,
 * iron-bolted, a keystone), and through it the dark of the tunnel the
 * fighters come up out of. Its great iron doors are drawn live (they open
 * for each round's march, see activities/arena.ts). `east`: mirrored, for
 * the gate on the east side.
 */
function sideGate(w: number, h: number, east: boolean): { c: HTMLCanvasElement; overhang: number } {
  const ov = SIDE_GATE_OVERHANG;
  const H = h + ov;
  const [c, ctx] = canvas(w, H);
  if (east) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  const stone = "#c9ad7a";
  const hi = "#e2c896";
  const lo = "#a08458";
  const dk = "#7a6040";
  const D = SIDE_GATE_DOOR;
  // The frame: a block of dressed stone, outlined.
  px(ctx, "rgba(0,0,0,0.25)", 2, H - 4, w - 2, 4);
  px(ctx, OUTLINE, 0, 0, w, H - 2);
  px(ctx, stone, 1, 1, w - 2, H - 4);
  // Courses of big blocks.
  for (let y = 1; y < H - 3; y += 9) {
    px(ctx, dk, 1, y + 8, w - 2, 1);
    const off = (y / 9) % 2 ? 0 : 7;
    for (let x = 1 + off; x < w - 1; x += 14) px(ctx, dk, x, y, 1, 8);
  }
  px(ctx, hi, 1, 1, w - 2, 2);
  px(ctx, lo, 1, H - 6, w - 2, 3);
  // The opening: an arch at its back (west), open to the sand (east).
  const r = (D.y1 - D.y0) / 2;
  const cy = (D.y0 + D.y1) / 2;
  for (let y = D.y0 - 3; y < D.y1 + 3; y++) {
    const dy = y + 0.5 - cy;
    const back = D.x0 + Math.round(Math.max(0, 10 - Math.sqrt(Math.max(0, (r + 3) * (r + 3) - dy * dy)) * (10 / (r + 3))) * 2);
    if (y < D.y0 || y >= D.y1) {
      // The arch's ring of voussoirs, over the opening's top and bottom.
      px(ctx, (y >> 1) % 2 ? hi : stone, back - 2, y, w - back + 2, 1);
      continue;
    }
    // The tunnel: dark, darker to the back.
    for (let x = back; x < w; x++) {
      const t = (x - back) / (w - back);
      px(ctx, t < 0.25 ? "#120c0a" : t < 0.6 ? "#1d1410" : "#2b1d14", x, y, 1, 1);
    }
    px(ctx, OUTLINE, back - 1, y, 1, 1);
  }
  // A keystone at the back of the arch, iron bolts round the frame.
  px(ctx, OUTLINE, 6, cy - 7, 10, 14);
  px(ctx, hi, 7, cy - 6, 8, 12);
  px(ctx, "#d9a83a", 9, cy - 2, 4, 4);
  for (const [bx, by] of [
    [24, 6],
    [40, 6],
    [56, 6],
    [24, H - 12],
    [40, H - 12],
    [56, H - 12],
  ]) {
    px(ctx, OUTLINE, bx - 1, by - 1, 4, 4);
    px(ctx, "#6a6a78", bx, by, 2, 2);
  }
  // The torches' brackets (their fire's live).
  for (const [fx, fy] of SIDE_GATE_FIRES) {
    px(ctx, OUTLINE, fx - 2, fy + 2, 4, 6);
    px(ctx, "#6e4b30", fx - 1, fy + 3, 2, 4);
  }
  return { c, overhang: ov };
}

/** A pillar's art stands this far (px) above its footprint. */
const PILLAR_ART_OVERHANG = 86;
/** The pillars are drawn at this size (their art's made for a 2×2 footprint; they stand on one tile). */
export const PILLAR_SCALE = 0.5;
export const PILLAR_OVERHANG = PILLAR_ART_OVERHANG * PILLAR_SCALE;
/** Where its brazier's fire sits, from the top of the art (px; centred). */
export const PILLAR_FIRE_Y = 12 * PILLAR_SCALE;

/** A pillar a tile thick: the full-size art (made for 2×2), drawn down to size, in the middle of its place. */
function smallPillar(w: number, h: number, v: number): { c: HTMLCanvasElement; overhang: number } {
  const big = pillar(2 * T, 2 * T, v);
  const bw = Math.round(big.c.width * PILLAR_SCALE);
  const bh = Math.round(big.c.height * PILLAR_SCALE);
  const [c, ctx] = canvas(w, h + PILLAR_OVERHANG);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(big.c, Math.round((w - bw) / 2), c.height - bh, bw, bh);
  return { c, overhang: PILLAR_OVERHANG };
}

/**
 * A pillar: a twisted (Solomonic) sandstone column on a stepped plinth, its
 * fluting spiralling round it, an Ionic capital with scrolled volutes, a
 * bronze brazier of glowing coals on top (the flames themselves are drawn
 * live: see activities/arena.ts), and ivy winding down it, flowering.
 */
function pillar(w: number, h: number, v: number): { c: HTMLCanvasElement; overhang: number } {
  const over = PILLAR_ART_OVERHANG;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const cx = w / 2;
  const foot = H - 6;
  // Sandstone, lit from the upper left.
  const STONE = ["#f4dfae", "#e6c98f", "#d6b477", "#c09a5e", "#a07c46", "#7d5e34"];
  const shadeAt = (k: number) => STONE[Math.max(0, Math.min(STONE.length - 1, Math.round(k * (STONE.length - 1))))];
  oval(ctx, "rgba(0,0,0,0.28)", cx + 3, foot + 2, w / 2 - 1, 7);

  // The plinth: three steps, each a lit top and a shaded face.
  const step = (x0: number, x1: number, y: number, hgt: number) => {
    px(ctx, OUTLINE, x0 - 1, y - 1, x1 - x0 + 2, hgt + 2);
    px(ctx, STONE[1], x0, y, x1 - x0, 2);
    px(ctx, STONE[0], x0, y, x1 - x0, 1);
    for (let x = x0; x < x1; x++) px(ctx, shadeAt(0.35 + ((x - x0) / (x1 - x0)) * 0.5), x, y + 2, 1, hgt - 2);
    px(ctx, STONE[5], x0, y + hgt - 1, x1 - x0, 1);
  };
  step(2, w - 2, foot - 9, 9);
  step(6, w - 6, foot - 16, 7);
  // A torus moulding where the column meets the base.
  const colW = 30;
  const x0 = cx - colW / 2;
  for (let x = x0 - 3; x < x0 + colW + 3; x++) {
    const k = (x - (x0 - 3)) / (colW + 6);
    const lit = Math.sin(k * Math.PI);
    px(ctx, shadeAt(1 - lit * 0.85), x, foot - 21, 1, 5);
  }
  px(ctx, OUTLINE, x0 - 4, foot - 22, colW + 8, 1);
  px(ctx, OUTLINE, x0 - 4, foot - 16, colW + 8, 1);
  px(ctx, OUTLINE, x0 - 4, foot - 22, 1, 7);
  px(ctx, OUTLINE, x0 + colW + 3, foot - 22, 1, 7);

  // The column: round (lit on the left, falling into shade on the right),
  // its grooves twisting round it in a spiral.
  const top = 40;
  const bottom = foot - 22;
  px(ctx, OUTLINE, x0 - 1, top, colW + 2, bottom - top);
  for (let y = top; y < bottom; y++) {
    for (let x = x0; x < x0 + colW; x++) {
      const u = (x - x0 + 0.5) / colW; // 0 left … 1 right
      const ang = Math.asin(Math.max(-1, Math.min(1, u * 2 - 1))); // across the round
      // Lighting: brightest a third from the left.
      let k = 0.25 + Math.abs(u - 0.32) * 1.25;
      // The spiral: grooves at a slant that follows the surface round.
      const twist = (ang / Math.PI) * 18 + y * 0.55;
      const band = ((twist % 9) + 9) % 9;
      if (band < 2) k += 0.32;
      else if (band < 3) k -= 0.12;
      px(ctx, shadeAt(k), x, y, 1, 1);
    }
  }
  // Weathering: specks and a crack.
  let seed = 1234 + v * 77;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 40; i++) px(ctx, rnd() < 0.5 ? "rgba(90,60,30,0.25)" : "rgba(255,245,220,0.3)", x0 + 2 + rnd() * (colW - 4), top + rnd() * (bottom - top), 1, 1);
  for (let k = 0; k < 9; k++) px(ctx, STONE[5], x0 + colW - 8 + Math.round(Math.sin(k) * 1.5), top + 30 + k, 1, 1);

  // The capital: an echinus, scrolled volutes either side, the abacus slab.
  const capY = top - 12;
  px(ctx, OUTLINE, x0 - 4, capY + 4, colW + 8, 9);
  for (let x = x0 - 3; x < x0 + colW + 3; x++) {
    const k = (x - (x0 - 3)) / (colW + 6);
    px(ctx, shadeAt(0.9 - Math.sin(k * Math.PI) * 0.8), x, capY + 5, 1, 7);
  }
  // Egg-and-dart along it.
  for (let x = x0; x < x0 + colW; x += 5) {
    px(ctx, STONE[4], x, capY + 7, 3, 3);
    px(ctx, STONE[1], x, capY + 7, 1, 1);
  }
  const volute = (vx: number, dir: number) => {
    // A rolled scroll: a disc, the spiral line wound into it.
    disc(ctx, OUTLINE, vx, capY + 9, 7);
    disc(ctx, STONE[1], vx, capY + 9, 6);
    disc(ctx, STONE[0], vx - 2, capY + 7, 2.5);
    for (let t = 0; t < Math.PI * 4.2; t += 0.12) {
      const r = 5.6 * (1 - t / (Math.PI * 4.6));
      px(ctx, STONE[5], vx + Math.cos(t * dir) * r, capY + 9 + Math.sin(t * dir) * r, 1, 1);
    }
    px(ctx, STONE[4], vx, capY + 9, 1, 1);
  };
  volute(x0 - 3, 1);
  volute(x0 + colW + 3, -1);
  // The abacus: a slab on top, wider than all.
  px(ctx, OUTLINE, x0 - 9, capY - 1, colW + 18, 6);
  px(ctx, STONE[1], x0 - 8, capY, colW + 16, 4);
  px(ctx, STONE[0], x0 - 8, capY, colW + 16, 1);
  px(ctx, STONE[3], x0 - 8, capY + 3, colW + 16, 1);

  // The brazier: a bronze bowl on three short legs, full of glowing coals.
  const by = capY - 2;
  px(ctx, OUTLINE, cx - 6, by - 4, 2, 5);
  px(ctx, OUTLINE, cx + 4, by - 4, 2, 5);
  px(ctx, OUTLINE, cx - 1, by - 4, 2, 5);
  for (let y = 0; y < 8; y++) {
    const half = Math.round(13 - (y * y) / 7);
    px(ctx, OUTLINE, cx - half - 1, by - 12 + y, half * 2 + 2, 1);
    for (let x = -half; x < half; x++) {
      const k = (x + half) / (half * 2);
      px(ctx, k < 0.3 ? "#e0a050" : k < 0.7 ? "#b8783a" : "#7a4a24", cx + x, by - 12 + y, 1, 1);
    }
  }
  // The rim, and the coals heaped in it (the fire burns on these).
  px(ctx, OUTLINE, cx - 15, by - 14, 30, 3);
  px(ctx, "#f0c070", cx - 14, by - 14, 28, 1);
  px(ctx, "#c48a44", cx - 14, by - 13, 28, 1);
  for (let i = 0; i < 18; i++) {
    const x = cx - 11 + rnd() * 22;
    const y = by - 16 + rnd() * 3;
    px(ctx, ["#ff4f1a", "#ff9a3f", "#ffd23f", "#8a2a10"][i % 4], x, y, 2, 2);
  }

  // Ivy winding down the column: in front where it's on our side, hidden
  // where it's gone round the back; leaves along it, a few little flowers.
  const leafA = "#3f8a3a";
  const leafB = "#5fb04a";
  const leafC = "#2f6a2c";
  for (const [phase, flower] of [
    [v ? 0.6 : 0, "#ff6a8a"],
    [v ? 3.7 : 3.1, "#ffffff"],
  ] as [number, string][]) {
    let n = 0;
    for (let y = capY + 8; y < bottom + 4; y++) {
      const t = y * 0.11 + phase;
      const side = Math.cos(t); // > 0: in front
      if (side < -0.15) continue;
      const x = cx + Math.sin(t) * (colW / 2 + 1);
      px(ctx, leafC, x, y, 1, 1);
      px(ctx, "#4a7a2c", x + 1, y, 1, 1);
      if (++n % 4 === 0) {
        const lx = x + ((n / 4) % 2 ? 2 : -3);
        px(ctx, leafC, lx - 1, y - 1, 4, 3);
        px(ctx, n % 8 ? leafA : leafB, lx, y - 1, 2, 2);
        px(ctx, "#86cf6a", lx, y - 1, 1, 1);
      }
      if (n % 23 === 11) {
        px(ctx, flower, x - 1, y + 1, 2, 2);
        px(ctx, "#ffd23f", x, y + 1, 1, 1);
      }
    }
    // A tendril trailing over the plinth.
    for (let k = 0; k < 6; k++) px(ctx, leafA, cx + (phase > 2 ? 10 : -12) + k, foot - 20 + k, 2, 1);
  }
  return { c, overhang: over };
}

function plate(w: number, h: number): { c: HTMLCanvasElement; overhang: number } {
  const [c, ctx] = canvas(w, h);
  // A band of warning paint (faded), the iron grate inside it.
  for (let x = 0; x < w; x += 6) {
    for (const y of [0, h - 3]) px(ctx, (x / 6) % 2 ? "#3a2f24" : "#d9a915", x, y, 6, 3);
  }
  for (let y = 0; y < h; y += 6) {
    for (const x of [0, w - 3]) px(ctx, (y / 6) % 2 ? "#3a2f24" : "#d9a915", x, y, 3, 6);
  }
  px(ctx, OUTLINE, 3, 3, w - 6, h - 6);
  px(ctx, "#5f6670", 4, 4, w - 8, h - 8);
  px(ctx, "#7a828c", 4, 4, w - 8, 1);
  // The holes the spikes come up through.
  for (let y = 9; y < h - 6; y += 9) {
    for (let x = 9 + ((y / 9) % 2) * 4; x < w - 6; x += 9) {
      px(ctx, "#1a1c22", x - 2, y - 2, 4, 4);
      px(ctx, "#8a929c", x - 2, y + 2, 4, 1);
    }
  }
  // Rivets in the corners, a little rust.
  for (const [rx, ry] of [[6, 6], [w - 8, 6], [6, h - 8], [w - 8, h - 8]] as [number, number][]) {
    px(ctx, "#2b2e34", rx, ry, 3, 3);
    px(ctx, "#b8c0ca", rx, ry, 1, 1);
  }
  px(ctx, "rgba(150,70,30,0.45)", w * 0.6, h * 0.3, 6, 3);
  px(ctx, "rgba(150,70,30,0.35)", w * 0.25, h * 0.7, 4, 2);
  return { c, overhang: 0 };
}

// ---- the grand entrance and Caesar's court ------------------------------------

/** The south archway: how far its art stands above its footprint, and where its two braziers burn (from the art's top-left). */
export const GATE_OVERHANG = 104;
export const GATE_FIRES: [number, number][] = [
  [32, 10],
  [224, 10],
];
/** Caesar's dais: its art's overhang, and where Caesar's head is (for his words), from the art's top-left. */
export const COURT_OVERHANG = 78;
export const COURT_CAESAR: [number, number] = [80, 46];
/** The two candles on the dais, either side of Caesar: where their flames sit (x from the art's left, y up from its foot). */
export const COURT_CANDLES: [number, number][] = [
  [54, 59],
  [106, 59],
];
/** The torches on their stands either side of the dais's foot: how far out past its sides, and down past its footprint, they stand. */
export const COURT_TORCH_OUT = 10;
export const COURT_TORCH_DOWN = 18;
/** How tall a torch stand is, foot to the flame. */
export const TORCH_HEIGHT = 46;

/**
 * A torch on its stand: three bronze feet, a slim pole with a collar and
 * rings, and a flared cup of pitch at the top (its fire's live). 16 wide,
 * its foot at the bottom middle.
 */
export function torchStand(): HTMLCanvasElement {
  const H = TORCH_HEIGHT + 4;
  const [c, ctx] = canvas(16, H);
  const BRONZE = "#b07a34";
  const BRONZE_L = "#e0a85a";
  const BRONZE_D = "#6e4a1c";
  oval(ctx, "rgba(0,0,0,0.3)", 8, H - 2, 7, 2);
  // The feet.
  px(ctx, OUTLINE, 1, H - 5, 14, 3);
  px(ctx, BRONZE_D, 2, H - 4, 12, 1);
  px(ctx, OUTLINE, 6, H - 8, 4, 4);
  // The pole.
  px(ctx, OUTLINE, 6, 9, 4, H - 16);
  px(ctx, BRONZE, 7, 9, 2, H - 16);
  px(ctx, BRONZE_L, 7, 9, 1, H - 16);
  for (const y of [18, 30]) {
    px(ctx, OUTLINE, 5, y, 6, 2);
    px(ctx, GOLD, 6, y, 4, 1);
  }
  // The cup, flaring out, its pitch black.
  px(ctx, OUTLINE, 2, 2, 12, 8);
  px(ctx, BRONZE, 3, 3, 10, 6);
  px(ctx, BRONZE_L, 3, 3, 2, 6);
  px(ctx, BRONZE_D, 11, 3, 2, 6);
  px(ctx, GOLD, 3, 3, 10, 1);
  px(ctx, "#2a1a10", 4, 2, 8, 1);
  px(ctx, OUTLINE, 5, 10, 6, 1);
  return c;
}

const SAND = ["#f4dfae", "#e6c98f", "#d6b477", "#c09a5e", "#a07c46", "#7d5e34"];
const GOLD = "#e8b828";
const GOLD_LIGHT = "#fff0a0";
const GOLD_DARK = "#a87a14";
const RED = "#b8323a";
const RED_DARK = "#7a1e24";
const RED_LIGHT = "#e05a50";

/** Gold letters with a dark edge. */
function inscribe(ctx: Ctx, text: string, cx: number, y: number) {
  const x = Math.round(cx - pixelWidth(text) / 2);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawPixelText(ctx, text, x + dx, y + dy, "#3a2410");
  drawPixelText(ctx, text, x, y, GOLD_LIGHT);
}

/** A block of masonry: shaded across (lit left), courses of stone. */
function masonry(ctx: Ctx, x0: number, y0: number, w: number, h: number) {
  for (let x = x0; x < x0 + w; x++) {
    const k = (x - x0) / w;
    const c = SAND[Math.min(5, Math.max(0, Math.round(1 + k * 2.6)))];
    px(ctx, c, x, y0, 1, h);
  }
  for (let y = y0 + 7; y < y0 + h; y += 8) {
    px(ctx, "rgba(90,60,30,0.35)", x0, y, w, 1);
    const off = (Math.floor((y - y0) / 8) % 2) * 8;
    for (let x = x0 + off + 4; x < x0 + w; x += 16) px(ctx, "rgba(90,60,30,0.35)", x, y - 7, 1, 7);
  }
  px(ctx, SAND[0], x0, y0, 2, h);
}

/** A hanging banner: red, a gold border and fringe, a golden eagle, SPQR. */
function banner(ctx: Ctx, cx: number, y0: number, w: number, h: number) {
  px(ctx, OUTLINE, cx - w / 2 - 2, y0 - 2, w + 4, 3);
  px(ctx, GOLD_DARK, cx - w / 2 - 1, y0 - 1, w + 2, 1);
  px(ctx, OUTLINE, cx - w / 2 - 1, y0, w + 2, h + 1);
  px(ctx, RED, cx - w / 2, y0, w, h);
  px(ctx, RED_LIGHT, cx - w / 2, y0, 2, h);
  px(ctx, RED_DARK, cx + w / 2 - 2, y0, 2, h);
  px(ctx, GOLD, cx - w / 2 + 2, y0 + 2, w - 4, 1);
  px(ctx, GOLD, cx - w / 2 + 2, y0 + h - 3, w - 4, 1);
  // The eagle: wings up, head turned.
  const ey = y0 + 10;
  px(ctx, GOLD, cx - 1, ey, 3, 8);
  for (let k = 0; k < 6; k++) {
    px(ctx, GOLD, cx - 2 - k, ey - 2 + Math.floor(k / 2), 1, 4);
    px(ctx, GOLD, cx + 2 + k, ey - 2 + Math.floor(k / 2), 1, 4);
  }
  px(ctx, GOLD_LIGHT, cx, ey - 2, 2, 2);
  px(ctx, GOLD_DARK, cx - 2, ey + 8, 6, 1);
  inscribe(ctx, "SPQR", cx, y0 + h - 13);
  // A fringe of gold tassels.
  for (let x = cx - w / 2; x < cx + w / 2; x += 3) px(ctx, GOLD, x, y0 + h, 1, 3);
}

/** A bronze brazier full of coals (the fire's drawn live). */
function brazier(ctx: Ctx, cx: number, by: number) {
  for (let y = 0; y < 7; y++) {
    const half = Math.round(11 - (y * y) / 6);
    px(ctx, OUTLINE, cx - half - 1, by + y, half * 2 + 2, 1);
    for (let x = -half; x < half; x++) px(ctx, x < -half / 3 ? "#e0a050" : x < half / 3 ? "#b8783a" : "#7a4a24", cx + x, by + y, 1, 1);
  }
  px(ctx, OUTLINE, cx - 13, by - 2, 26, 3);
  px(ctx, "#f0c070", cx - 12, by - 2, 24, 1);
  for (let i = 0; i < 12; i++) px(ctx, ["#ff4f1a", "#ff9a3f", "#ffd23f", "#8a2a10"][i % 4], cx - 9 + ((i * 7) % 18), by - 4 + (i % 3), 2, 2);
}

/**
 * The arena's grand south entrance: two great piers (masonry, a capital, a
 * brazier blazing on each, a banner of the eagle hanging down the face), an
 * arch between them (voussoirs, a keystone with a laurel wreath), and over
 * it all the inscription: SPQR · THE ARENA. The way runs under the arch.
 */
function gate(w: number, h: number): { c: HTMLCanvasElement; overhang: number } {
  const over = GATE_OVERHANG;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const foot = H - 4;
  const pierW = 56;
  const top = 26;
  for (const x0 of [4, w - 4 - pierW]) {
    oval(ctx, "rgba(0,0,0,0.25)", x0 + pierW / 2 + 4, foot, pierW / 2 + 4, 6);
    // Its base, the pier, its capital.
    px(ctx, OUTLINE, x0 - 5, foot - 14, pierW + 10, 15);
    masonry(ctx, x0 - 4, foot - 13, pierW + 8, 13);
    px(ctx, SAND[0], x0 - 4, foot - 13, pierW + 8, 1);
    px(ctx, OUTLINE, x0 - 1, top, pierW + 2, foot - 14 - top);
    masonry(ctx, x0, top, pierW, foot - 14 - top);
    px(ctx, OUTLINE, x0 - 5, top - 8, pierW + 10, 9);
    px(ctx, SAND[1], x0 - 4, top - 7, pierW + 8, 4);
    px(ctx, SAND[3], x0 - 4, top - 3, pierW + 8, 3);
    px(ctx, SAND[0], x0 - 4, top - 7, pierW + 8, 1);
    brazier(ctx, x0 + pierW / 2, top - 14);
    // The banner down its face.
    banner(ctx, x0 + pierW / 2, top + 14, 30, 56);
  }
  // The arch: voussoirs round the opening, spandrels filled, a keystone.
  const ax0 = 4 + pierW;
  const ax1 = w - 4 - pierW;
  const acx = (ax0 + ax1) / 2;
  const span = (ax1 - ax0) / 2;
  const springY = top + 34;
  const lintelTop = top + 2;
  for (let x = ax0; x < ax1; x++) {
    const dx = (x + 0.5 - acx) / span;
    const archY = springY - Math.sqrt(Math.max(0, 1 - dx * dx)) * 26;
    // Spandrel stone above the curve.
    for (let y = lintelTop; y < archY; y++) {
      const shade = 1.4 + (y - lintelTop) / 30;
      px(ctx, SAND[Math.min(4, Math.round(shade))], x, y, 1, 1);
    }
    // The voussoir ring (lighter, with joints radiating).
    for (let t = 0; t < 7; t++) {
      const y = Math.round(archY) - t;
      const ang = Math.atan2(archY - springY, x - acx);
      const joint = Math.abs(((ang * 7) % 1)) < 0.12;
      px(ctx, joint ? SAND[4] : t < 2 ? SAND[3] : SAND[1], x, y, 1, 1);
    }
    px(ctx, OUTLINE, x, Math.round(archY), 1, 1);
  }
  // The keystone, a laurel wreath on it.
  px(ctx, OUTLINE, acx - 9, lintelTop + 4, 18, 22);
  px(ctx, SAND[0], acx - 8, lintelTop + 5, 16, 20);
  px(ctx, SAND[2], acx + 4, lintelTop + 5, 4, 20);
  for (let t = 0; t < Math.PI * 1.6; t += 0.3) {
    const x = acx + Math.cos(t + Math.PI * 0.7) * 5;
    const y = lintelTop + 15 + Math.sin(t + Math.PI * 0.7) * 5;
    px(ctx, "#4f9a3a", x, y, 2, 2);
    px(ctx, "#86cf6a", x, y, 1, 1);
  }
  px(ctx, RED, acx - 1, lintelTop + 20, 3, 3);
  // The entablature over it all: a cornice, the inscription panel.
  px(ctx, OUTLINE, 0, 2, w, lintelTop + 1);
  masonry(ctx, 1, 3, w - 2, lintelTop - 2);
  px(ctx, SAND[0], 1, 3, w - 2, 2);
  px(ctx, SAND[4], 1, lintelTop - 2, w - 2, 2);
  px(ctx, OUTLINE, acx - 62, 8, 124, 14);
  px(ctx, "#5a3a20", acx - 61, 9, 122, 12);
  inscribe(ctx, "SPQR  THE ARENA", acx, 11);
  for (const x of [acx - 58, acx + 54]) {
    px(ctx, GOLD, x, 13, 4, 4);
    px(ctx, GOLD_LIGHT, x, 13, 1, 1);
  }
  // Dentils under the cornice.
  for (let x = 4; x < w - 4; x += 6) px(ctx, SAND[4], x, lintelTop - 2, 3, 2);
  return { c, overhang: over };
}

/**
 * The red carpet out from the grand entrance: deep red, worn a little down
 * the middle, gold borders with a running key pattern, tasselled at its end.
 */
function carpet(w: number, h: number): { c: HTMLCanvasElement; overhang: number } {
  const [c, ctx] = canvas(w, h);
  const x0 = 6;
  const x1 = w - 6;
  px(ctx, "rgba(0,0,0,0.18)", x0 + 2, 2, x1 - x0, h - 4);
  px(ctx, RED_DARK, x0, 0, x1 - x0, h - 4);
  px(ctx, RED, x0 + 5, 0, x1 - x0 - 10, h - 4);
  // Worn a touch paler where everyone walks.
  px(ctx, "rgba(255,180,160,0.12)", w / 2 - 10, 0, 20, h - 4);
  // Gold borders, a key pattern in them.
  for (const bx of [x0 + 1, x1 - 5]) {
    px(ctx, GOLD, bx, 0, 4, h - 4);
    for (let y = 2; y < h - 6; y += 6) {
      px(ctx, GOLD_DARK, bx + 1, y, 2, 1);
      px(ctx, GOLD_DARK, bx + 2, y + 1, 1, 2);
    }
  }
  // Little gold laurels down the middle.
  for (let y = 14; y < h - 10; y += 32) {
    px(ctx, GOLD, w / 2 - 1, y, 2, 6);
    for (let k = 0; k < 3; k++) {
      px(ctx, GOLD, w / 2 - 3 - k, y + 1 + k, 1, 1);
      px(ctx, GOLD, w / 2 + 2 + k, y + 1 + k, 1, 1);
    }
  }
  // Its end, tasselled.
  px(ctx, GOLD, x0, h - 5, x1 - x0, 1);
  for (let x = x0; x < x1; x += 3) px(ctx, GOLD, x, h - 4, 1, 3);
  return { c, overhang: 0 };
}

/** Feet at (cx, fy), mirrored when facing left. */
function figure(ctx: Ctx, cx: number, dir: number) {
  return (color: string, dx: number, dy: number, w = 1, h = 1) => px(ctx, color, dir > 0 ? cx + dx : cx - dx - w + 1, dy, w, h);
}

/**
 * A legionary at attention: a galea (a steel helmet with cheek guards, a
 * red horsehair crest), a lorica segmentata of steel bands over a red
 * tunic, leather strips at the hips, a red cape, caligae; the big curved
 * scutum (red, gold-rimmed, its boss and lightning) on his outer arm and his
 * pilum held upright. `dir` 1 faces right.
 */
function legionary(ctx: Ctx, cx: number, fy: number, dir: number) {
  const p = figure(ctx, cx, dir);
  const SKIN = "#e0ac84";
  const STEEL = "#c9d2dc";
  const STEEL_D = "#8a929c";
  const STEEL_DD = "#5a626c";
  oval(ctx, "rgba(0,0,0,0.25)", cx, fy + 1, 11, 3);
  // The pilum, upright in his inner hand (behind him, then in front).
  p(OUTLINE, 9, fy - 66, 3, 64);
  p("#8a5f36", 10, fy - 56, 1, 54);
  p("#a87a4a", 10, fy - 56, 1, 20);
  p(STEEL_D, 10, fy - 66, 1, 10);
  p(STEEL, 9, fy - 70, 3, 4);
  p(STEEL, 10, fy - 72, 1, 2);
  // The cape behind.
  p(RED_DARK, -8, fy - 30, 14, 22);
  p(RED, -7, fy - 30, 12, 20);
  // Caligae and legs.
  p(OUTLINE, -5, fy - 9, 4, 9);
  p(OUTLINE, 1, fy - 9, 4, 9);
  p(SKIN, -4, fy - 9, 2, 6);
  p(SKIN, 2, fy - 9, 2, 6);
  p("#6b4a2a", -5, fy - 3, 4, 3);
  p("#6b4a2a", 1, fy - 3, 4, 3);
  p("#8a5f36", -4, fy - 7, 2, 1);
  p("#8a5f36", 2, fy - 7, 2, 1);
  // The tunic's hem, and the leather strips (pteruges) over it.
  p(OUTLINE, -7, fy - 15, 14, 7);
  p(RED, -6, fy - 15, 12, 5);
  for (let k = -6; k < 6; k += 2) p("#7a4a24", k, fy - 15, 1, 6);
  // The lorica: steel bands round the body, shoulder plates, a belt with studs.
  p(OUTLINE, -8, fy - 31, 16, 17);
  for (let b = 0; b < 4; b++) {
    p(b % 2 ? STEEL_D : STEEL, -7, fy - 29 + b * 3, 14, 3);
    p(STEEL_DD, -7, fy - 27 + b * 3, 14, 1);
  }
  p("#ffffff", -6, fy - 29, 3, 1);
  p(OUTLINE, -9, fy - 32, 6, 5);
  p(STEEL, -8, fy - 31, 4, 3);
  p(OUTLINE, 3, fy - 32, 6, 5);
  p(STEEL, 4, fy - 31, 4, 3);
  p("#6b4a2a", -7, fy - 17, 14, 2);
  for (let k = -6; k < 7; k += 3) p(GOLD, k, fy - 17, 1, 1);
  // His inner arm, holding the pilum.
  p(OUTLINE, 6, fy - 29, 5, 10);
  p(SKIN, 7, fy - 28, 3, 7);
  p(SKIN, 8, fy - 22, 3, 3);
  // The head: face under the helmet.
  p(OUTLINE, -5, fy - 42, 11, 11);
  p(SKIN, -4, fy - 40, 9, 8);
  p(OUTLINE, 2, fy - 38, 1, 2);
  p("#c48a64", 3, fy - 35, 2, 1);
  // The galea: bowl, brow ridge, neck guard, cheek guards.
  p(OUTLINE, -6, fy - 47, 13, 8);
  p(STEEL, -5, fy - 46, 11, 6);
  p("#ffffff", -4, fy - 46, 3, 1);
  p(STEEL_D, -5, fy - 41, 11, 1);
  p(STEEL_DD, -7, fy - 41, 3, 4);
  p(STEEL, -1, fy - 39, 2, 6);
  p(STEEL_D, 4, fy - 39, 2, 6);
  p(GOLD, -1, fy - 47, 3, 1);
  // The crest: red horsehair, across.
  p(OUTLINE, -7, fy - 53, 15, 7);
  p("#d8342f", -6, fy - 52, 13, 5);
  for (let k = -6; k < 7; k += 2) p("#ff6a5a", k, fy - 52, 1, 2);
  p(RED_DARK, -6, fy - 48, 13, 1);
  // The scutum, on his outer arm: tall, curved, red, gold-rimmed.
  const sx = -14;
  p(OUTLINE, sx - 1, fy - 37, 12, 31);
  p(RED_DARK, sx, fy - 36, 10, 29);
  p(RED, sx + 1, fy - 36, 7, 29);
  p(RED_LIGHT, sx + 1, fy - 36, 2, 29);
  p(GOLD, sx, fy - 36, 10, 1);
  p(GOLD, sx, fy - 8, 10, 1);
  p(GOLD, sx, fy - 36, 1, 29);
  p(GOLD, sx + 9, fy - 36, 1, 29);
  // Its boss, and lightning either side.
  p(OUTLINE, sx + 2, fy - 25, 6, 6);
  p(STEEL, sx + 3, fy - 24, 4, 4);
  p("#ffffff", sx + 3, fy - 24, 1, 1);
  for (const [dx, dy] of [[3, -33], [4, -32], [3, -31], [5, -30], [4, -29], [3, -16], [4, -15], [3, -14], [5, -13], [4, -12]] as [number, number][]) p(GOLD, sx + dx, fy + dy, 1, 1);
}

/**
 * Caesar: a laurel wreath on his brow, a white toga with its purple and gold
 * border, a red cloak, a scroll in one hand and the other raised, beckoning:
 * who will fight?
 */
function caesar(ctx: Ctx, cx: number, fy: number) {
  const SKIN = "#e8b890";
  const TOGA = "#f6f1e6";
  const TOGA_D = "#d9d2c2";
  const PURPLE = "#6a2a8a";
  oval(ctx, "rgba(0,0,0,0.25)", cx, fy + 1, 12, 3);
  // The red cloak behind, falling to his heels.
  px(ctx, OUTLINE, cx - 11, fy - 34, 22, 33);
  px(ctx, RED_DARK, cx - 10, fy - 33, 20, 31);
  px(ctx, RED, cx - 9, fy - 33, 7, 30);
  // Sandals.
  px(ctx, "#8a5f36", cx - 6, fy - 3, 5, 3);
  px(ctx, "#8a5f36", cx + 1, fy - 3, 5, 3);
  px(ctx, SKIN, cx - 5, fy - 5, 3, 2);
  px(ctx, SKIN, cx + 2, fy - 5, 3, 2);
  // The toga: draped, folds, its purple-and-gold border along the hem and across.
  px(ctx, OUTLINE, cx - 9, fy - 33, 18, 29);
  for (let y = fy - 32; y < fy - 4; y++) {
    const spread = 8 + Math.round((y - (fy - 32)) / 9);
    px(ctx, TOGA, cx - spread + 1, y, spread * 2 - 2, 1);
  }
  for (let k = 0; k < 4; k++) {
    for (let t = 0; t < 22; t++) px(ctx, TOGA_D, cx - 6 + k * 4 + Math.round(t / 5), fy - 28 + t, 1, 1);
  }
  px(ctx, PURPLE, cx - 10, fy - 7, 20, 2);
  px(ctx, GOLD, cx - 10, fy - 8, 20, 1);
  for (let t = 0; t < 22; t++) {
    px(ctx, PURPLE, cx - 8 + Math.round(t * 0.75), fy - 32 + t, 3, 1);
    if (t % 2 === 0) px(ctx, GOLD, cx - 8 + Math.round(t * 0.75), fy - 32 + t, 1, 1);
  }
  // A gold brooch at the shoulder.
  px(ctx, OUTLINE, cx + 4, fy - 33, 5, 5);
  px(ctx, GOLD, cx + 5, fy - 32, 3, 3);
  px(ctx, GOLD_LIGHT, cx + 5, fy - 32, 1, 1);
  // The arm with the scroll, at his side.
  px(ctx, OUTLINE, cx - 13, fy - 30, 5, 14);
  px(ctx, TOGA, cx - 12, fy - 29, 3, 8);
  px(ctx, SKIN, cx - 12, fy - 21, 3, 4);
  px(ctx, OUTLINE, cx - 15, fy - 19, 8, 4);
  px(ctx, "#f4ecd8", cx - 14, fy - 18, 6, 2);
  px(ctx, GOLD, cx - 15, fy - 18, 1, 2);
  px(ctx, GOLD, cx - 8, fy - 18, 1, 2);
  // The other arm raised high, beckoning.
  for (let k = 0; k < 13; k++) {
    px(ctx, OUTLINE, cx + 8 + Math.round(k * 0.5), fy - 31 - k, 4, 2);
    px(ctx, k < 6 ? TOGA : SKIN, cx + 9 + Math.round(k * 0.5), fy - 31 - k, 2, 1);
  }
  px(ctx, OUTLINE, cx + 13, fy - 49, 5, 6);
  px(ctx, SKIN, cx + 14, fy - 48, 3, 4);
  px(ctx, SKIN, cx + 15, fy - 50, 1, 2);
  // His head: stern, short dark hair, the laurel wreath.
  px(ctx, OUTLINE, cx - 6, fy - 46, 13, 14);
  px(ctx, SKIN, cx - 5, fy - 44, 11, 11);
  px(ctx, "#c48a64", cx + 3, fy - 38, 2, 2);
  px(ctx, OUTLINE, cx - 3, fy - 41, 2, 2);
  px(ctx, OUTLINE, cx + 2, fy - 41, 2, 2);
  px(ctx, "#5a3a20", cx - 4, fy - 42, 3, 1);
  px(ctx, "#5a3a20", cx + 1, fy - 42, 3, 1);
  px(ctx, "#9a5a44", cx - 1, fy - 36, 3, 1);
  px(ctx, "#3a2a1a", cx - 5, fy - 46, 11, 3);
  px(ctx, "#3a2a1a", cx - 6, fy - 44, 2, 4);
  for (let k = 0; k < 7; k++) {
    const lx = cx - 6 + k * 2;
    px(ctx, "#3f7a2c", lx, fy - 47 - (k % 2), 2, 2);
    px(ctx, "#7ccf5a", lx, fy - 47 - (k % 2), 1, 1);
  }
  px(ctx, "#3f7a2c", cx - 7, fy - 45, 2, 3);
  px(ctx, "#3f7a2c", cx + 7, fy - 45, 2, 3);
  px(ctx, GOLD, cx + 6, fy - 45, 1, 1);
}

/**
 * Caesar's court beside the carpet: a stepped marble dais, a red carpet up
 * its middle, two standards (the eagle on top, SPQR beneath) at its back
 * corners, and on it Caesar between his two legionaries.
 */
function court(w: number, h: number): { c: HTMLCanvasElement; overhang: number } {
  const over = COURT_OVERHANG;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const fy = H - 40;
  const MARBLE = ["#ffffff", "#f1ece0", "#ddd4c2", "#c4b9a2", "#a39780"];
  oval(ctx, "rgba(0,0,0,0.25)", w / 2 + 4, H - 4, w / 2, 7);
  // The steps: three slabs, wider as they come down.
  const slab = (x0: number, x1: number, y: number, hh: number) => {
    px(ctx, OUTLINE, x0 - 1, y - 1, x1 - x0 + 2, hh + 2);
    px(ctx, MARBLE[1], x0, y, x1 - x0, 3);
    px(ctx, MARBLE[0], x0, y, x1 - x0, 1);
    px(ctx, MARBLE[3], x0, y + 3, x1 - x0, hh - 3);
    px(ctx, MARBLE[4], x0, y + hh - 1, x1 - x0, 1);
    for (let x = x0 + 9; x < x1; x += 18) px(ctx, MARBLE[4], x, y + 3, 1, hh - 4);
  };
  slab(2, w - 2, H - 16, 12);
  slab(10, w - 10, H - 28, 12);
  slab(16, w - 16, fy - 4, H - 28 - (fy - 4));
  // Veins in the marble.
  for (let i = 0; i < 6; i++) px(ctx, "rgba(150,140,120,0.5)", 20 + i * 22, fy + 2 + (i % 3) * 3, 6, 1);
  // The carpet up the middle, gold-edged.
  const cl = w / 2 - 14;
  px(ctx, RED_DARK, cl, fy - 4, 28, H - (fy - 4) - 4);
  px(ctx, RED, cl + 2, fy - 4, 24, H - (fy - 4) - 4);
  px(ctx, GOLD, cl + 1, fy - 4, 1, H - (fy - 4) - 4);
  px(ctx, GOLD, cl + 26, fy - 4, 1, H - (fy - 4) - 4);
  for (const y of [H - 28, H - 16]) px(ctx, RED_DARK, cl, y, 28, 1);
  // The standards at the back corners: a pole, the eagle, a banner.
  for (const sx of [10, w - 11]) {
    px(ctx, OUTLINE, sx - 1, 4, 3, fy - 4);
    px(ctx, "#8a5f36", sx, 6, 1, fy - 8);
    // The eagle on top.
    px(ctx, GOLD, sx - 1, 4, 3, 5);
    for (let k = 0; k < 4; k++) {
      px(ctx, GOLD, sx - 2 - k, 2 + Math.floor(k / 2), 1, 3);
      px(ctx, GOLD, sx + 2 + k, 2 + Math.floor(k / 2), 1, 3);
    }
    px(ctx, GOLD_LIGHT, sx, 3, 1, 1);
    // Its banner.
    px(ctx, OUTLINE, sx - 8, 12, 17, 22);
    px(ctx, RED, sx - 7, 13, 15, 20);
    px(ctx, GOLD, sx - 7, 13, 15, 1);
    px(ctx, GOLD, sx - 7, 32, 15, 1);
    inscribe(ctx, "SPQR", sx, 19);
    for (let x = sx - 7; x < sx + 8; x += 3) px(ctx, GOLD, x, 33, 1, 2);
  }
  // A candle either side of Caesar, on a little gold stand (their flames
  // are live).
  for (const [x, up] of COURT_CANDLES) {
    const top = H - up;
    px(ctx, OUTLINE, x - 4, fy - 5, 9, 3);
    px(ctx, GOLD, x - 3, fy - 4, 7, 1);
    px(ctx, OUTLINE, x - 1, fy - 9, 3, 5);
    px(ctx, GOLD_DARK, x, fy - 8, 1, 4);
    px(ctx, OUTLINE, x - 3, fy - 11, 7, 3);
    px(ctx, GOLD, x - 2, fy - 10, 5, 1);
    px(ctx, OUTLINE, x - 2, top + 1, 5, fy - 10 - top - 1);
    px(ctx, "#f6efd8", x - 1, top + 1, 3, fy - 11 - top - 1);
    px(ctx, "#ffffff", x - 1, top + 1, 1, fy - 11 - top - 1);
    px(ctx, "#f6efd8", x + 1, top + 3, 1, 3);
    px(ctx, OUTLINE, x, top, 1, 1);
  }
  // On the dais: a legionary either side of Caesar, facing in.
  legionary(ctx, 34, fy, 1);
  legionary(ctx, w - 34, fy, -1);
  caesar(ctx, w / 2, fy);
  return { c, overhang: over };
}
