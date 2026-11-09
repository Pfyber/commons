// The Cozy Cup's outside: an old timber tavern. A big shingled roof gone
// green with moss, a lit dormer window, a stone chimney with smoke curling
// off it and a carved name board with gold letters; string lights along the
// eaves; log walls with log-end corners and an ivy-wrapped post; leaded
// windows glowing amber between green shutters, flower boxes under them; a
// porch with two hanging lanterns over an arched plank door (iron hinges, a
// stained-glass mug); barrels, a bench with a sleeping cat, a chalkboard
// menu and pots of flowers out front, all on a fieldstone footing.

import { oval, polygon } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

/** Room above the roof for the chimney smoke. */
const SKY = 24;

/** How far the art reaches above the building's footprint. */
export const MUG_TOP = 84 + SKY;

const O = "#2b2119";
const LOG = ["#8f5e36", "#986640", "#875832"];
const LOG_HI = "#b98556";
const LOG_LO = "#6a4225";
const CHINK = "#3e2717";
const SHINGLE = ["#7c4a2f", "#6c3f27", "#86533a", "#744530"];
const SHINGLE_GAP = "#3a2116";
const SHINGLE_HI = "#a06a46";
const MOSS = ["#4f7a33", "#668f3f", "#7fab4c", "#9cc663"];
const STONE = ["#9a978c", "#878378", "#aeaa9e", "#7b776d"];
const MORTAR = "#4f4b44";
const GLASS = "#ffc964";
const GLASS_HI = "#ffe4a0";
const LEAD = "#5a3a1e";
const SHUTTER = "#4f7a4a";
const SHUTTER_HI = "#68955f";
const SHUTTER_LO = "#36573a";
const IRON = "#2a2a30";
const GOLD = "#f3c95a";

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A steady little hash, so the art comes out the same every time. */
function hash(a: number, b: number, salt = 0): number {
  let h = (a * 374761393 + b * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function pick<T>(xs: T[], n: number): T {
  return xs[n % xs.length];
}

/**
 * A cushion of moss: a few lumps run together, darker underneath and lit
 * on top, flecked with lighter tufts.
 */
function moss(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number) {
  const lumps = 2 + (n % 3);
  const at: [number, number, number][] = [];
  for (let i = 0; i < lumps; i++) {
    const k = hash(n, i, 13);
    const lr = r * (0.55 + ((k % 100) / 100) * 0.5);
    at.push([x + ((k >>> 8) % 100) / 100 * r * 1.8 - r * 0.9, y + ((k >>> 16) % 100) / 100 * r * 0.5 - r * 0.25, lr]);
  }
  for (const [ax, ay, lr] of at) oval(ctx, MOSS[0], ax, ay + 1, lr + 1, lr * 0.6 + 1);
  for (const [ax, ay, lr] of at) oval(ctx, MOSS[1 + (n % 2)], ax, ay, lr, lr * 0.6);
  for (const [ax, ay, lr] of at) oval(ctx, MOSS[2 + (n % 2)], ax - lr * 0.25, ay - lr * 0.2, lr * 0.5, lr * 0.28);
  for (let i = 0; i < r; i++) {
    const k = hash(n, i, 17);
    px(ctx, i % 2 ? MOSS[3] : "#b8d878", x - r + (k % (r * 2 + 1)), y - 1 - ((k >>> 8) % 3), 1, 1);
  }
  if (n % 4 === 0) px(ctx, "#f2e6a6", x + r * 0.3, y - 2, 1, 1);
}

/** A row of logs from x0 to x1, top at y, `hgt` tall. */
function log(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, hgt: number, i: number) {
  px(ctx, pick(LOG, i), x0, y, x1 - x0, hgt);
  px(ctx, LOG_HI, x0, y + 1, x1 - x0, 2);
  px(ctx, LOG_LO, x0, y + hgt - 3, x1 - x0, 2);
  px(ctx, CHINK, x0, y + hgt - 1, x1 - x0, 1);
  // Bark streaks and the odd knot.
  for (let x = x0 + 4; x < x1 - 6; x += 7) {
    const k = hash(x, y, 3);
    if (k % 4 === 0) px(ctx, LOG_LO, x, y + 4 + (k % 3), 4 + (k % 5), 1);
    if (k % 5 === 0) px(ctx, LOG_HI, x + 2, y + 5, 3, 1);
    if (k % 37 === 0) {
      oval(ctx, LOG_LO, x, y + hgt / 2, 2.5, 2);
      px(ctx, CHINK, x, y + hgt / 2 - 0.5, 1, 1);
    }
  }
}

/** A stack of round log ends: a building's corner. */
function logEnds(ctx: CanvasRenderingContext2D, cx: number, y0: number, y1: number, rows: number) {
  px(ctx, O, cx - 9, y0, 18, y1 - y0);
  for (let y = y0; y + rows <= y1; y += rows) {
    const r = rows / 2;
    oval(ctx, O, cx, y + r, 9, r);
    oval(ctx, "#c99a68", cx, y + r, 8, r - 1);
    oval(ctx, "#a87a4c", cx, y + r, 5, r - 3);
    oval(ctx, "#c99a68", cx, y + r, 3.5, r - 4.2);
    oval(ctx, "#7a5432", cx, y + r, 1.5, 1.2);
  }
}

/** A leaded window, glowing amber, with things on the sill inside. */
function windowPane(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  // The frame, with an arched head.
  px(ctx, O, x - 4, y - 4, w + 8, h + 8);
  px(ctx, "#5e3a20", x - 3, y - 3, w + 6, h + 6);
  px(ctx, "#7a4e2c", x - 3, y - 3, w + 6, 2);
  // The glass: lighter up top, deeper at the bottom.
  for (let r = 0; r < h; r++) {
    const t = r / h;
    px(ctx, t < 0.3 ? GLASS_HI : t < 0.75 ? GLASS : "#f0a94c", x, y + r, w, 1);
  }
  // The room inside: a shelf of bottles and mugs, a hanging plant, a candle.
  const shelf = y + Math.round(h * 0.42);
  px(ctx, "#a8683a", x, shelf, w, 2);
  for (let i = 0; i * 9 + 6 < w; i++) {
    const k = hash(i, seed, 9);
    const bx = x + 4 + i * 9;
    if (k % 3 === 0) {
      px(ctx, "#8a4b2a", bx, shelf - 7, 5, 7);
      px(ctx, "#fff1c9", bx, shelf - 7, 5, 2);
      px(ctx, "#8a4b2a", bx + 5, shelf - 5, 2, 3);
    } else {
      const col = pick(["#4f8a5a", "#9a4a3a", "#6a5a9a", "#3f7a8a"], k);
      px(ctx, col, bx + 1, shelf - 10, 4, 10);
      px(ctx, col, bx + 2, shelf - 13, 2, 3);
      px(ctx, "rgba(255,255,255,0.5)", bx + 1, shelf - 9, 1, 6);
    }
  }
  // A plant hanging from the top in one corner.
  const hx = x + (seed % 2 ? w - 16 : 12);
  px(ctx, "#6b4a2a", hx, y, 1, 8);
  px(ctx, "#b0643a", hx - 4, y + 8, 9, 5);
  for (let i = 0; i < 9; i++) oval(ctx, MOSS[1 + (i % 2)], hx - 6 + ((i * 5) % 13), y + 13 + ((i * 3) % 9), 2.5, 2);
  // A candle glowing on the sill.
  const cx = x + w / 2 + (seed % 2 ? -14 : 14);
  oval(ctx, "rgba(255,255,230,0.7)", cx, y + h - 13, 6, 6);
  px(ctx, "#fff6e0", cx - 2, y + h - 10, 4, 8);
  px(ctx, "#fffbe8", cx - 1, y + h - 15, 2, 4);
  px(ctx, "#ff9a3a", cx - 0.5, y + h - 14, 1, 2);
  // The leading: a diamond lattice over little panes.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let d = -h; d < w + h; d += 12) {
    for (let s = 0; s < h; s++) {
      px(ctx, "rgba(90,58,30,0.55)", x + d + s, y + s, 1, 1);
      px(ctx, "rgba(90,58,30,0.55)", x + d + h - s, y + s, 1, 1);
    }
  }
  ctx.restore();
  // The mullion and transom.
  px(ctx, LEAD, x + w / 2 - 2, y, 4, h);
  px(ctx, LEAD, x, y + Math.round(h * 0.3), w, 3);
  // A gleam on the glass.
  for (let i = 0; i < 10; i++) px(ctx, "rgba(255,255,255,0.45)", x + 5 + i, y + 16 - i, 1, 1);
  for (let i = 0; i < 6; i++) px(ctx, "rgba(255,255,255,0.35)", x + 5 + i, y + 22 - i, 1, 1);
  // The sill.
  px(ctx, O, x - 6, y + h + 3, w + 12, 6);
  px(ctx, "#9a6a40", x - 5, y + h + 4, w + 10, 3);
  px(ctx, "#c08a58", x - 5, y + h + 4, w + 10, 1);
}

/** A green shutter, with its Z brace. */
function shutter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  px(ctx, O, x - 1, y - 1, w + 2, h + 2);
  px(ctx, SHUTTER, x, y, w, h);
  for (let sx = x + 3; sx < x + w; sx += 5) px(ctx, SHUTTER_LO, sx, y, 1, h);
  px(ctx, SHUTTER_HI, x, y, w, 2);
  px(ctx, SHUTTER_LO, x, y + 6, w, 3);
  px(ctx, SHUTTER_LO, x, y + h - 9, w, 3);
  for (let i = 0; i < h - 18; i++) px(ctx, SHUTTER_LO, x + Math.round(((w - 2) * i) / (h - 18)), y + h - 9 - i, 2, 1);
  // A little heart cut out at the top.
  px(ctx, "#2a3f28", x + w / 2 - 2, y + 13, 2, 2);
  px(ctx, "#2a3f28", x + w / 2 + 1, y + 13, 2, 2);
  px(ctx, "#2a3f28", x + w / 2 - 1, y + 15, 3, 2);
}

/** A flower box under a window, flowers spilling over and ivy trailing down. */
function flowerBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, seed: number) {
  // Leaves, then the flowers on top.
  for (let i = 0; i < w / 4; i++) {
    const k = hash(i, seed, 5);
    oval(ctx, MOSS[1 + (k % 3)], x + 2 + i * 4, y - 3 - (k % 4), 3.5, 3);
  }
  const petals = ["#e8566b", "#f6c343", "#f28c9b", "#ffffff", "#b07ad8"];
  for (let i = 0; i < w / 7; i++) {
    const k = hash(i, seed, 6);
    const fx = x + 4 + i * 7 + (k % 3);
    const fy = y - 6 - (k % 5);
    const col = pick(petals, k);
    px(ctx, col, fx - 2, fy, 5, 1);
    px(ctx, col, fx - 1, fy - 1, 3, 3);
    px(ctx, "#ffe08a", fx, fy, 1, 1);
  }
  px(ctx, O, x - 1, y - 1, w + 2, 13);
  px(ctx, "#8a5530", x, y, w, 11);
  px(ctx, "#a86c40", x, y, w, 2);
  px(ctx, "#6a3e22", x, y + 8, w, 3);
  for (let bx = x + 10; bx < x + w - 4; bx += 22) px(ctx, "#6a3e22", bx, y + 2, 1, 7);
  // Ivy trailing over the front.
  for (let i = 0; i < 5; i++) {
    const k = hash(i, seed, 8);
    const vx = x + 6 + ((k % 1000) / 1000) * (w - 12);
    const len = 6 + (k % 12);
    for (let j = 0; j < len; j += 3) oval(ctx, MOSS[1 + ((j + i) % 2)], vx + (j % 6 ? 1 : -1), y + 10 + j, 2, 1.6);
  }
}

/** A lantern hanging from a hook: an iron cage round a warm flame. */
function lantern(ctx: CanvasRenderingContext2D, cx: number, y: number) {
  px(ctx, IRON, cx - 0.5, y, 1, 6);
  oval(ctx, "rgba(255,210,120,0.35)", cx, y + 16, 14, 13);
  px(ctx, IRON, cx - 5, y + 6, 10, 3);
  px(ctx, IRON, cx - 6, y + 9, 12, 14);
  px(ctx, "#ffd36e", cx - 5, y + 10, 10, 12);
  px(ctx, "#fff3c4", cx - 2, y + 12, 4, 7);
  px(ctx, IRON, cx - 0.5, y + 9, 1, 14);
  px(ctx, IRON, cx - 6, y + 15, 12, 1);
  px(ctx, IRON, cx - 4, y + 23, 8, 3);
  px(ctx, IRON, cx - 1, y + 26, 2, 2);
}

/** A barrel, standing. */
function barrel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  px(ctx, O, x + 2, y - 1, w - 4, h + 2);
  px(ctx, O, x, y + 3, w, h - 6);
  px(ctx, "#93603a", x + 1, y + 3, w - 2, h - 6);
  px(ctx, "#93603a", x + 3, y, w - 6, h);
  px(ctx, "#b07a4c", x + 4, y + 1, 4, h - 2);
  px(ctx, "#6e4426", x + w - 8, y + 1, 4, h - 2);
  for (let sx = x + 9; sx < x + w - 4; sx += 6) px(ctx, "#6e4426", sx, y + 1, 1, h - 2);
  for (const by of [y + 4, y + h - 8]) {
    px(ctx, IRON, x, by, w, 3);
    px(ctx, "#5a5a63", x + 2, by, w - 4, 1);
  }
  px(ctx, "#7a4e2c", x + 3, y - 1, w - 6, 3);
}

/** The pixel letters of the name board, or the canvas font where they can't do it. */
function boardText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, max: number) {
  if (canPixel(text)) {
    let s = 2;
    if (pixelWidth(text, s) > max) s = 1;
    const x = cx - pixelWidth(text, s) / 2;
    const y = cy - (5 * s) / 2;
    drawPixelText(ctx, text, x + 1, y + 1, "#2a160c", s);
    drawPixelText(ctx, text, x, y, GOLD, s);
    return;
  }
  ctx.font = `bold 13px ui-rounded, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#2a160c";
  ctx.fillText(text, cx + 1, cy + 1, max);
  ctx.fillStyle = GOLD;
  ctx.fillText(text, cx, cy, max);
}

/** A little foaming mug, for the board's ends and the door's window. */
function mug(ctx: CanvasRenderingContext2D, x: number, y: number) {
  px(ctx, O, x - 1, y - 1, 12, 14);
  px(ctx, O, x + 10, y + 3, 5, 8);
  px(ctx, "#e9a83a", x, y + 3, 10, 9);
  px(ctx, "#f6c35a", x + 1, y + 4, 2, 7);
  px(ctx, "#fff8e3", x, y, 10, 4);
  px(ctx, "#fff8e3", x + 2, y - 2, 4, 2);
  px(ctx, "#e9a83a", x + 11, y + 5, 2, 4);
}

/**
 * Draws the Mug, `w` across and `h` deep on the ground (the art reaching
 * `MUG_TOP` higher), its door at the middle of its front.
 */
export function mugArt(w: number, h: number, name: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  // (Laid out from the roof down; the smoke rises into the room above.)
  const H = h + MUG_TOP - SKY;
  c.width = w;
  c.height = H + SKY;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(0, SKY);
  const cx = w / 2;
  const RIDGE = 30;
  const EAVE = 196;
  const WALL = 200;
  const FOOT = H - 34;
  const inset = 84;

  // Its shadow on the ground.
  px(ctx, "rgba(0,0,0,0.18)", 8, H - 12, w - 16, 10);
  px(ctx, "rgba(0,0,0,0.1)", 2, H - 8, w - 4, 6);

  // ---- the roof ----
  const edgeL = (y: number) => inset * (1 - (y - RIDGE) / (EAVE - RIDGE));
  polygon(ctx, O, [[inset - 3, RIDGE - 3], [w - inset + 3, RIDGE - 3], [w + 1, EAVE + 3], [-1, EAVE + 3]]);
  polygon(ctx, SHINGLE[0], [[inset, RIDGE], [w - inset, RIDGE], [w, EAVE], [0, EAVE]]);
  // Shingles, row by row, staggered.
  for (let y = RIDGE + 4, r = 0; y < EAVE; y += 10, r++) {
    const l = edgeL(y + 10);
    const x0 = Math.max(0, Math.ceil(edgeL(y + 5)));
    for (let x = (r % 2 ? -8 : 0) + Math.floor(l / 16) * 16 - 16; x < w; x += 16) {
      const k = hash(x, r, 21);
      const sx0 = Math.max(x0, x);
      const sx1 = Math.min(w - x0, x + 16);
      if (sx1 <= sx0) continue;
      // A wooden shake: its butt end rounded off at the bottom, the grain
      // running down it, a few weathered paler or split ones.
      const hgt = Math.min(11, EAVE - y);
      const col = k % 11 === 0 ? "#9a6a4a" : pick(SHINGLE, k);
      px(ctx, col, sx0, y, sx1 - sx0, hgt - 1);
      px(ctx, SHINGLE_HI, sx0, y, sx1 - sx0, 1);
      px(ctx, "rgba(255,220,180,0.12)", sx0, y + 1, Math.min(4, sx1 - sx0), hgt - 3);
      px(ctx, "rgba(30,12,4,0.22)", sx0, y + hgt - 4, sx1 - sx0, 2);
      px(ctx, SHINGLE_GAP, sx0, y + hgt - 2, sx1 - sx0, 2);
      if (x >= sx0) {
        px(ctx, SHINGLE_GAP, x, y, 1, hgt);
        px(ctx, SHINGLE_GAP, x + 1, y + hgt - 3, 1, 1);
      }
      if (x + 15 < sx1) px(ctx, SHINGLE_GAP, x + 15, y + hgt - 3, 1, 1);
      px(ctx, "#5a3220", sx0 + 5 + (k % 5), y + 2, 1, hgt - 6);
      if (k % 9 === 0) px(ctx, SHINGLE_GAP, sx0 + 9, y + 3, 1, hgt - 4);
    }
  }
  // Light falls from up and left: the left of the roof a touch brighter.
  for (let y = RIDGE; y < EAVE; y++) {
    const l = Math.ceil(edgeL(y));
    px(ctx, "rgba(255,230,180,0.08)", l, y, Math.max(0, cx - l - 40), 1);
    px(ctx, "rgba(20,10,0,0.08)", cx + 60, y, Math.max(0, w - l - cx - 60), 1);
  }
  // The bargeboards down its sloping ends.
  for (let y = RIDGE; y < EAVE + 2; y++) {
    const l = edgeL(y);
    px(ctx, "#5a3520", l - 1, y, 6, 1);
    px(ctx, "#5a3520", w - l - 5, y, 6, 1);
    px(ctx, "#7a4e30", l + 1, y, 1, 1);
  }
  // The ridge, capped.
  px(ctx, O, inset - 6, RIDGE - 8, w - inset * 2 + 12, 10);
  px(ctx, "#5e3a26", inset - 5, RIDGE - 7, w - inset * 2 + 10, 8);
  for (let x = inset - 2; x < w - inset; x += 12) {
    px(ctx, "#7a4c32", x, RIDGE - 7, 9, 3);
    px(ctx, O, x + 10, RIDGE - 7, 1, 8);
  }
  // ---- the chimney, standing up out of the roof ----
  const chx = w - 132;
  const chw = 42;
  const chTop = 30;
  const chBot = 112;
  px(ctx, O, chx - 2, chTop, chw + 4, chBot - chTop);
  for (let y = chTop + 2, r = 0; y < chBot - 2; y += 9, r++) {
    for (let x = chx + (r % 2 ? -6 : 0); x < chx + chw; x += 13) {
      const k = hash(x, y, 11);
      const x0 = Math.max(chx, x);
      const x1 = Math.min(chx + chw, x + 12);
      px(ctx, pick(STONE, k), x0, y, x1 - x0, Math.min(8, chBot - 2 - y));
      px(ctx, "rgba(255,255,255,0.2)", x0, y, x1 - x0, 1);
    }
    px(ctx, MORTAR, chx, y + 8, chw, 1);
  }
  // Light on its left, shade on its right, and soot up top.
  px(ctx, "rgba(255,240,210,0.15)", chx, chTop, 6, chBot - chTop);
  px(ctx, "rgba(20,10,0,0.25)", chx + chw - 8, chTop, 8, chBot - chTop);
  px(ctx, "rgba(30,25,20,0.35)", chx, chTop, chw, 8);
  // The lead flashing where it meets the roof, moss at its foot.
  px(ctx, O, chx - 5, chBot - 4, chw + 10, 7);
  px(ctx, "#6d7680", chx - 4, chBot - 3, chw + 8, 5);
  px(ctx, "#8d96a0", chx - 4, chBot - 3, chw + 8, 1);
  for (let i = 0; i < 5; i++) moss(ctx, chx - 4 + i * 11, chBot + 2, 3 + (i % 2), i + 1);
  // Its cap, two pots, and the smoke curling off.
  px(ctx, O, chx - 6, chTop - 6, chw + 12, 10);
  px(ctx, "#6f6b62", chx - 5, chTop - 5, chw + 10, 8);
  px(ctx, "#8d897e", chx - 5, chTop - 5, chw + 10, 2);
  for (const [px0, ph] of [[chx + 6, 12], [chx + 24, 9]] as [number, number][]) {
    px(ctx, O, px0 - 1, chTop - 6 - ph, 14, ph + 1);
    px(ctx, "#a4563a", px0, chTop - 5 - ph, 12, ph);
    px(ctx, "#c8704a", px0, chTop - 5 - ph, 3, ph);
    px(ctx, O, px0 - 2, chTop - 7 - ph, 16, 3);
    px(ctx, "#2a1a14", px0 + 2, chTop - 6 - ph, 8, 1);
  }
  for (const [sx, sy, r, a] of [[chx + 14, chTop - 24, 6, 0.42], [chx + 20, chTop - 32, 7, 0.34], [chx + 30, chTop - 40, 8, 0.26], [chx + 44, chTop - 46, 9, 0.18], [chx + 60, chTop - 50, 10, 0.1]] as [number, number, number, number][]) {
    oval(ctx, `rgba(232,232,238,${a})`, sx, sy, r, r * 0.75);
    oval(ctx, `rgba(255,255,255,${a * 0.6})`, sx - r * 0.3, sy - r * 0.25, r * 0.5, r * 0.35);
  }

  // Moss: thick along the ridge and in the hollows, thinning down the roof.
  // (Kept off the chimney and out from under the dormer and name board.)
  const bare = (x: number, y: number) =>
    (x > chx - 6 && x < chx + chw + 6 && y < chBot) || (x > cx - 66 && x < cx + 66 && y > 40 && y < 140) || (x > cx - 124 && x < cx + 124 && y > 140);
  // Along the ridge, one long mossy cushion.
  for (let x = inset - 4; x < w - inset + 4; x += 9) {
    if (!bare(x, RIDGE)) moss(ctx, x, RIDGE - 5 + (hash(x, 1, 3) % 3), 5 + (hash(x, 2, 3) % 3), x);
  }
  // Big soft patches spreading from the ridge's shady corners and the top left.
  for (const [px0, py0, n] of [[inset + 20, RIDGE + 12, 14], [inset + 60, RIDGE + 30, 8], [w - inset - 20, RIDGE + 14, 10], [60, 150, 9], [w - 70, 140, 7]] as [number, number, number][]) {
    for (let i = 0; i < n; i++) {
      const k = hash(px0, i, 33);
      const x = px0 + (k % 40) - 20;
      const y = py0 + ((k >>> 8) % 22) - 11;
      if (x > edgeL(y) + 6 && x < w - edgeL(y) - 6 && !bare(x, y)) moss(ctx, x, y, 4 + (k % 3), k);
    }
  }
  // Threads of it growing along the shakes' butt ends.
  for (let y = RIDGE + 12, r = 0; y < EAVE - 4; y += 10, r++) {
    const k = hash(r, 9, 35);
    if (k % 3 === 0) continue;
    const l = edgeL(y) + 8;
    const x0 = l + ((k >>> 6) % 1000) / 1000 * (w - l * 2 - 60);
    const len = 14 + (k % 40);
    for (let x = x0; x < x0 + len; x += 5) {
      if (!bare(x, y)) moss(ctx, x, y + 9, 2 + (hash(x, r, 37) % 2), hash(x, r, 39));
    }
  }
  // A few odd tufts dotted about.
  for (let i = 0; i < 18; i++) {
    const k = hash(i, 7, 31);
    const y = RIDGE + 10 + ((k % 1000) / 1000) * (EAVE - RIDGE - 20);
    const l = edgeL(y) + 10;
    const x = l + (((k >>> 10) % 1000) / 1000) * (w - l * 2);
    if (!bare(x, y)) moss(ctx, x, y, 2 + (k % 2), k);
  }
  // And it creeps over the eave's edge, hanging in little beards.
  for (let x = 10; x < w - 10; x += 6) {
    const k = hash(x, 5, 41);
    if (k % 3 !== 0) continue;
    moss(ctx, x, EAVE - 2, 3, k);
    for (let j = 0; j < 2 + (k % 4); j++) px(ctx, MOSS[(j % 2) + 1], x - 1 + (j % 2), EAVE + 1 + j * 2, 2, 2);
  }
  // A few ferns and a tiny mushroom growing up there.
  for (const [fx, fy] of [[inset + 30, RIDGE + 10], [w - inset - 60, RIDGE + 16], [130, 120]] as [number, number][]) {
    for (let i = 0; i < 5; i++) px(ctx, MOSS[2], fx - 6 + i * 3, fy - 2 - Math.abs(2 - i) * -1 - (i % 2) * 2, 2, 5);
  }
  px(ctx, "#e8e0cc", 118, 114, 2, 3);
  px(ctx, "#c8553d", 116, 112, 6, 2);
  px(ctx, "#ffffff", 118, 112, 1, 1);

  // ---- the dormer ----
  const dw = 104;
  const dx = cx - dw / 2;
  const dTop = 52;
  px(ctx, O, dx - 2, 82, dw + 4, 56);
  for (let y = 84, i = 0; y < 136; y += 9, i++) log(ctx, dx, dx + dw, y, 9, i);
  windowPane(ctx, cx - 26, 92, 52, 34, 1);
  // Its curtains, tied back.
  px(ctx, "#c45a5a", cx - 26, 92, 7, 26);
  px(ctx, "#c45a5a", cx + 19, 92, 7, 26);
  px(ctx, "#e07a72", cx - 26, 92, 2, 22);
  px(ctx, "#e07a72", cx + 19, 92, 2, 22);
  px(ctx, "#f2d08a", cx - 26, 110, 8, 2);
  px(ctx, "#f2d08a", cx + 18, 110, 8, 2);
  // Its own little gable.
  polygon(ctx, O, [[cx, dTop - 6], [dx - 14, 90], [dx + dw + 14, 90]]);
  polygon(ctx, SHINGLE[2], [[cx, dTop - 2], [dx - 9, 87], [dx + dw + 9, 87]]);
  for (let y = dTop + 4, r = 0; y < 86; y += 8, r++) {
    const half = ((y - dTop) / (87 - dTop)) * (dw / 2 + 9);
    for (let x = cx - half + (r % 2 ? 6 : 0); x < cx + half; x += 12) {
      const x1 = Math.min(cx + half, x + 12);
      px(ctx, pick(SHINGLE, hash(x, r, 41)), x, y, x1 - x, 8);
      px(ctx, SHINGLE_GAP, x, y + 6, x1 - x, 2);
      px(ctx, SHINGLE_GAP, x, y, 1, 8);
    }
  }
  for (let i = 0; i <= 44; i++) {
    const t = i / 44;
    px(ctx, "#5a3520", cx - t * (dw / 2 + 12) - 2, dTop - 2 + t * 36, 5, 2);
    px(ctx, "#5a3520", cx + t * (dw / 2 + 12) - 2, dTop - 2 + t * 36, 5, 2);
  }
  // A carved finial on its peak, and moss on its roof.
  px(ctx, O, cx - 2, dTop - 16, 4, 12);
  oval(ctx, "#7a4e30", cx, dTop - 16, 3, 3);
  for (let i = 0; i < 6; i++) moss(ctx, cx - 30 + i * 12, dTop + 18 + (i % 2) * 8, 3 + (i % 3), i + 5);

  // ---- the name board, hung on the roof over the porch ----
  const bw = 236;
  const bx = cx - bw / 2;
  const by = 146;
  px(ctx, IRON, bx + 30, by - 8, 2, 9);
  px(ctx, IRON, bx + bw - 32, by - 8, 2, 9);
  px(ctx, O, bx - 3, by - 2, bw + 6, 34);
  px(ctx, "#6a3c22", bx - 2, by - 1, bw + 4, 32);
  px(ctx, "#4a2814", bx + 3, by + 4, bw - 6, 22);
  for (let y = by + 6; y < by + 25; y += 4) px(ctx, "#57301a", bx + 4, y, bw - 8, 1);
  px(ctx, "#8a5432", bx - 2, by - 1, bw + 4, 2);
  px(ctx, "#c8963f", bx + 3, by + 4, bw - 6, 1);
  px(ctx, "#c8963f", bx + 3, by + 25, bw - 6, 1);
  boardText(ctx, name, cx, by + 15, bw - 44);
  mug(ctx, bx + 8, by + 9);
  mug(ctx, bx + bw - 22, by + 9);

  // ---- the fascia under the eaves, scalloped, and the string lights ----
  px(ctx, O, 0, EAVE - 2, w, 10);
  px(ctx, "#5e3a24", 0, EAVE - 1, w, 8);
  px(ctx, "#7a4e30", 0, EAVE - 1, w, 2);

  // ---- the log walls ----
  px(ctx, O, 6, WALL, w - 12, FOOT - WALL);
  for (let y = WALL + 6, i = 0; y < FOOT; y += 12, i++) log(ctx, 18, w - 18, y, Math.min(12, FOOT - y), i);
  // Shade under the eaves.
  for (let i = 0; i < 10; i++) px(ctx, `rgba(20,10,0,${0.32 - i * 0.03})`, 18, WALL + i, w - 36, 1);
  // The scallops on the fascia (over the wall's top).
  for (let x = 4; x < w - 4; x += 14) {
    oval(ctx, O, x + 7, EAVE + 7, 7, 5);
    oval(ctx, "#5e3a24", x + 7, EAVE + 6, 6, 4);
  }
  // Log ends at both corners.
  logEnds(ctx, 16, WALL + 4, FOOT, 12);
  logEnds(ctx, w - 16, WALL + 4, FOOT, 12);

  // ---- the windows and their shutters, flower boxes under ----
  const ww = 104;
  const wh = 66;
  const wy = 226;
  for (const [wx, seed] of [[54, 2], [w - 54 - ww, 3]] as [number, number][]) {
    shutter(ctx, wx - 24, wy - 4, 18, wh + 8);
    shutter(ctx, wx + ww + 6, wy - 4, 18, wh + 8);
    windowPane(ctx, wx, wy, ww, wh, seed);
    flowerBox(ctx, wx - 4, wy + wh + 12, ww + 8, seed);
  }

  // ---- the ivy up the left corner and along the eave ----
  for (let y = FOOT; y > EAVE - 30; y -= 3) {
    const k = hash(y, 1, 51);
    const vx = 18 + Math.sin(y / 9) * 5;
    px(ctx, "#4a5a2a", vx, y, 1, 3);
    if (k % 2 === 0) oval(ctx, MOSS[1 + (k % 3)], vx + (k % 4 < 2 ? -4 : 4), y, 3.5, 2.6);
  }
  for (let x = 18; x < 150; x += 4) {
    const k = hash(x, 2, 52);
    if (k % 3) oval(ctx, MOSS[1 + (k % 3)], x, EAVE + 2 + (k % 5), 3, 2.4);
    if (k % 5 === 0) for (let j = 0; j < 4 + (k % 8); j += 3) oval(ctx, MOSS[1], x, EAVE + 8 + j, 2, 1.6);
  }

  // ---- the fieldstone footing ----
  px(ctx, O, 4, FOOT, w - 8, 22);
  for (let y = FOOT + 1, r = 0; y < FOOT + 21; y += 10, r++) {
    for (let x = 5 + (r % 2 ? 9 : 0); x < w - 5; ) {
      const k = hash(x, r, 71);
      const sw = 14 + (k % 12);
      const x1 = Math.min(w - 5, x + sw);
      px(ctx, pick(STONE, k), x, y, x1 - x, 9);
      px(ctx, "rgba(255,255,255,0.2)", x, y, x1 - x, 1);
      px(ctx, "rgba(0,0,0,0.18)", x, y + 7, x1 - x, 2);
      if (k % 4 === 0) oval(ctx, MOSS[1], x + 3, y + 8, 3, 1.5);
      x = x1 + 1;
    }
  }
  // (The footing's mortar shows in the gaps.)
  ctx.globalCompositeOperation = "destination-over";
  px(ctx, MORTAR, 5, FOOT + 1, w - 10, 20);
  ctx.globalCompositeOperation = "source-over";

  // ---- the porch: a little shingled roof on two posts ----
  const pw = 150;
  const pxl = cx - pw / 2;
  const pTop = 210;
  const pBot = 232;
  for (const postX of [pxl + 10, pxl + pw - 18]) {
    px(ctx, O, postX - 1, pBot, 10, FOOT - pBot + 14);
    px(ctx, "#8a5a33", postX, pBot, 8, FOOT - pBot + 13);
    px(ctx, "#a8744a", postX + 1, pBot, 2, FOOT - pBot + 13);
    px(ctx, "#5a3a22", postX + 6, pBot, 2, FOOT - pBot + 13);
    // Brackets up to the porch beam.
    for (let i = 0; i < 10; i++) px(ctx, "#6a4428", postX + (postX < cx ? 8 + i : -i - 2), pBot + 10 - i, 2, 2);
  }
  polygon(ctx, O, [[pxl + 6, pTop - 3], [pxl + pw - 6, pTop - 3], [pxl + pw + 3, pBot + 2], [pxl - 3, pBot + 2]]);
  for (let y = pTop, r = 0; y < pBot - 2; y += 6, r++) {
    const t = (y - pTop) / (pBot - pTop);
    const l = pxl + 6 - t * 9;
    for (let x = l + (r % 2 ? 5 : 0); x < pxl + pw + 3 - (6 - t * 9) - 6 + 6; x += 10) {
      const x1 = Math.min(pxl + pw - 6 + t * 9, x + 10);
      if (x1 <= x) continue;
      px(ctx, pick(SHINGLE, hash(x, r, 61)), x, y, x1 - x, 6);
      px(ctx, SHINGLE_GAP, x, y + 5, x1 - x, 1);
      px(ctx, SHINGLE_GAP, x, y, 1, 6);
    }
  }
  px(ctx, O, pxl - 3, pBot - 2, pw + 6, 6);
  px(ctx, "#6a4428", pxl - 2, pBot - 1, pw + 4, 4);
  px(ctx, "#8a5a33", pxl - 2, pBot - 1, pw + 4, 1);
  for (let i = 0; i < 8; i++) moss(ctx, pxl + 12 + i * 18, pTop + 2 + (i % 2) * 3, 3 + (i % 2), i + 2);

  // ---- the door: arched planks, iron straps, a stained-glass mug ----
  const doorW = 56;
  const ddx = cx - doorW / 2;
  const dTopY = 246;
  const dBot = H - 14;
  const archR = doorW / 2;
  px(ctx, O, ddx - 6, dTopY + archR - 4, doorW + 12, dBot - dTopY - archR + 4);
  oval(ctx, O, cx, dTopY + archR, archR + 6, archR + 6);
  px(ctx, "#7a7468", ddx - 5, dTopY + archR, doorW + 10, dBot - dTopY - archR);
  oval(ctx, "#7a7468", cx, dTopY + archR, archR + 5, archR + 5);
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    oval(ctx, pick(STONE, i), cx + Math.cos(a) * (archR + 2), dTopY + archR + Math.sin(a) * (archR + 2), 4, 3.5);
  }
  px(ctx, "#3a2414", ddx, dTopY + archR, doorW, dBot - dTopY - archR);
  oval(ctx, "#3a2414", cx, dTopY + archR, archR, archR);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ddx, dTopY, doorW, dBot - dTopY);
  ctx.clip();
  for (let i = 0; i < 7; i++) {
    const x = ddx + 1 + i * 8;
    const top = dTopY + archR - Math.sqrt(Math.max(0, archR * archR - (x + 4 - cx) * (x + 4 - cx))) + 1;
    px(ctx, pick(["#7a4e2e", "#845634", "#6e4428"], i), x, top, 7, dBot - top);
    px(ctx, "#9a6a40", x, top, 1, dBot - top);
  }
  ctx.restore();
  px(ctx, "#2a160c", cx - 1, dTopY + 4, 2, dBot - dTopY - 4);
  for (const sy of [dTopY + 44, dBot - 18]) {
    px(ctx, IRON, ddx, sy, doorW, 4);
    px(ctx, "#4a4a52", ddx, sy, doorW, 1);
    for (const nx of [ddx + 4, cx - 6, cx + 4, ddx + doorW - 6]) px(ctx, "#8a8a92", nx, sy + 1, 2, 2);
  }
  // The window in it: a round of stained glass with a mug.
  const gy = dTopY + 22;
  oval(ctx, O, cx, gy, 13, 13);
  oval(ctx, IRON, cx, gy, 12, 12);
  oval(ctx, "#ffcf6b", cx, gy, 10, 10);
  oval(ctx, "#e8823a", cx - 5, gy + 4, 5, 5);
  oval(ctx, "#7fab4c", cx + 6, gy - 5, 4, 4);
  mug(ctx, cx - 6, gy - 6);
  // Ring handles, and the welcome mat.
  for (const hx of [cx - 9, cx + 7]) {
    oval(ctx, "#c8963f", hx + 1, dBot - 40, 3.5, 3.5);
    oval(ctx, "#3a2414", hx + 1, dBot - 40, 2, 2);
  }
  // The stone steps.
  px(ctx, O, cx - 44, dBot - 1, 88, 9);
  px(ctx, "#9a978c", cx - 43, dBot, 86, 7);
  px(ctx, "#b3b0a4", cx - 43, dBot, 86, 2);
  px(ctx, O, cx - 52, dBot + 7, 104, 7);
  px(ctx, "#878378", cx - 51, dBot + 8, 102, 6);
  px(ctx, "#a4a094", cx - 51, dBot + 8, 102, 1);
  px(ctx, "#8a3a2e", cx - 22, dBot + 1, 44, 5);
  px(ctx, "#c8963f", cx - 20, dBot + 2, 40, 1);
  // The lanterns, hanging from the porch beam.
  lantern(ctx, pxl + 30, pBot + 2);
  lantern(ctx, pxl + pw - 30, pBot + 2);

  // ---- out front: barrels, a bench with a cat, the menu board, pots ----
  // Barrels stacked by the left corner.
  barrel(ctx, 6, H - 46, 30, 38);
  barrel(ctx, 34, H - 42, 28, 34);
  barrel(ctx, 20, H - 80, 28, 34);
  // A bench under the left window, a ginger cat curled up asleep on it.
  const benchX = 72;
  const benchY = H - 34;
  px(ctx, O, benchX - 1, benchY - 1, 90, 7);
  px(ctx, "#a8744a", benchX, benchY, 88, 5);
  px(ctx, "#c99567", benchX, benchY, 88, 1);
  for (const lx of [benchX + 6, benchX + 76]) {
    px(ctx, O, lx - 1, benchY + 5, 7, 18);
    px(ctx, "#7a4e2c", lx, benchY + 5, 5, 17);
  }
  oval(ctx, O, benchX + 30, benchY - 6, 12, 7);
  oval(ctx, "#e8913a", benchX + 30, benchY - 6, 11, 6);
  oval(ctx, "#f6b066", benchX + 27, benchY - 9, 6, 2.5);
  for (const sx of [benchX + 24, benchX + 30, benchX + 36]) px(ctx, "#c06a24", sx, benchY - 11, 2, 4);
  oval(ctx, O, benchX + 41, benchY - 7, 6, 5);
  oval(ctx, "#e8913a", benchX + 41, benchY - 7, 5, 4);
  px(ctx, "#e8913a", benchX + 39, benchY - 13, 2, 3);
  px(ctx, "#e8913a", benchX + 44, benchY - 13, 2, 3);
  px(ctx, O, benchX + 38, benchY - 7, 2, 1);
  px(ctx, O, benchX + 43, benchY - 7, 2, 1);
  px(ctx, "#f28c9b", benchX + 41, benchY - 5, 1, 1);
  px(ctx, "#e8913a", benchX + 18, benchY - 4, 10, 3);
  px(ctx, "#c06a24", benchX + 18, benchY - 4, 3, 3);
  // A pot of flowers either side of the steps.
  for (const pX of [pxl - 10, pxl + pw - 6]) {
    px(ctx, O, pX - 1, H - 28, 18, 18);
    px(ctx, "#b0643a", pX, H - 27, 16, 16);
    px(ctx, "#c87a4a", pX, H - 27, 16, 3);
    px(ctx, "#8a4a2a", pX + 12, H - 24, 4, 13);
    for (let i = 0; i < 7; i++) oval(ctx, MOSS[1 + (i % 3)], pX + 2 + ((i * 5) % 13), H - 31 - (i % 3) * 3, 3.5, 3);
    for (let i = 0; i < 4; i++) {
      const col = pick(["#e8566b", "#f6c343", "#ffffff", "#b07ad8"], i + (pX % 3));
      px(ctx, col, pX + 2 + i * 4, H - 37 + (i % 2) * 3, 3, 3);
    }
  }
  // The chalkboard menu, out front on the right.
  const mx = pxl + pw + 22;
  const my = H - 58;
  for (let i = 0; i < 46; i++) {
    px(ctx, "#6a4428", mx + 2 - i * 0.12, my + 6 + i, 2, 1);
    px(ctx, "#6a4428", mx + 34 + i * 0.12, my + 6 + i, 2, 1);
  }
  px(ctx, O, mx - 1, my - 1, 38, 38);
  px(ctx, "#8a5a33", mx, my, 36, 36);
  px(ctx, "#2f3a33", mx + 3, my + 3, 30, 30);
  px(ctx, "#f3efe0", mx + 7, my + 7, 22, 2);
  px(ctx, "#f3efe0", mx + 7, my + 13, 14, 1);
  px(ctx, "#f3efe0", mx + 7, my + 17, 18, 1);
  px(ctx, "#f3efe0", mx + 7, my + 21, 12, 1);
  px(ctx, "#f6c343", mx + 23, my + 19, 5, 6);
  px(ctx, "#fff8e3", mx + 23, my + 18, 5, 2);
  px(ctx, "#f28c9b", mx + 7, my + 26, 4, 3);
  px(ctx, "#f28c9b", mx + 12, my + 26, 4, 3);
  px(ctx, "#f28c9b", mx + 8, my + 28, 7, 2);
  // Crates of apples and a watering can by the right corner.
  const crX = w - 70;
  for (const [x, y] of [[crX, H - 38], [crX + 30, H - 38], [crX + 14, H - 64]] as [number, number][]) {
    px(ctx, O, x - 1, y - 1, 30, 28);
    px(ctx, "#b98556", x, y, 28, 26);
    px(ctx, "#8a5a33", x, y + 8, 28, 2);
    px(ctx, "#8a5a33", x, y + 17, 28, 2);
    px(ctx, "#8a5a33", x + 13, y, 2, 26);
    for (let i = 0; i < 5; i++) oval(ctx, i % 2 ? "#c8553d" : "#e86a4a", x + 4 + i * 5, y - 1, 3, 3);
    px(ctx, "#ffffff", x + 4, y - 3, 1, 1);
  }
  return c;
}

/** Where the Mug's lights glow at night (its porch lanterns and its windows), on its art. */
export function mugLights(w: number): { x: number; y: number }[] {
  const cx = w / 2;
  return [
    { x: cx - 45, y: SKY + 248 },
    { x: cx + 45, y: SKY + 248 },
    { x: 54 + 52, y: SKY + 259 },
    { x: w - 54 - 52, y: SKY + 259 },
    { x: cx, y: SKY + 109 },
  ];
}
