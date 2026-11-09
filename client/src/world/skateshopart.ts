// The skatepark's shop: a little camper van parked by the fence, the old
// split-window kind, long and low, mustard yellow under cream, a bit rusty, its side hatch propped open under a
// striped awning, a giant skateboard on the roof rack for a sign, and Dusty
// selling skates out of it.
//
// It's drawn in two layers so the seller stands inside: the shop at the
// back (`sk_shop_back`: the wall of decks, wheels and skates, a neon sign,
// string lights, seen through the hatch), and the van in front of him
// (`sk_shop`: its body with the hatch cut out, the counter, the awning, the
// wheels). Both are the same size and drawn over the same spot.

import { Texture } from "pixi.js";
import type { MapObject } from "./map";
import { disc, oval, polygon } from "./pixeldraw";
import { drawPixelText, pixelWidth } from "./pixelfont";

const TILE = 32;
/** The town's outline colour. */
const O = "#3b3a2e";
/** How far the van reaches above its footprint (px). */
export const SHOP_TOP = 72;
/** The hatch, on the canvas: where the seller shows. */
const HX0 = 66;
const HX1 = 158;
const HY0 = 58;
const HY1 = 104;

// The van's paint.
const CREAM = "#fbf1d6";
const CREAM_HI = "#fffaea";
const CREAM_LO = "#e8d9b2";
const YELLOW = "#e9b93a";
const YELLOW_HI = "#f6d264";
const YELLOW_LO = "#c7972a";
const YELLOW_DARK = "#9a6f1c";
const CHROME = "#dfe6ea";
const CHROME_LO = "#9aa6ad";
const GLASS = "#8fd0dd";
const GLASS_LO = "#5fa9bb";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A box with an outline round it. */
function box(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
  px(ctx, O, x - 1, y - 1, w + 2, h + 2);
  px(ctx, color, x, y, w, h);
}

function text(ctx: CanvasRenderingContext2D, word: string, cx: number, y: number, color: string, outline: string | null, scale = 1) {
  const x = Math.round(cx - pixelWidth(word, scale) / 2);
  if (outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawPixelText(ctx, word, x + dx, y + dy, outline, scale);
  drawPixelText(ctx, word, x, y, color, scale);
}

/**
 * A rectangle with its corners rounded (radii: top left, top right, bottom
 * left, bottom right), filled a row at a time so its edges stay crisp. With
 * `fill` a function of the row, painted in bands.
 */
function rounded(ctx: CanvasRenderingContext2D, fill: string | ((y: number) => string), x0: number, y0: number, x1: number, y1: number, r: [number, number, number, number]) {
  for (let y = y0; y < y1; y++) {
    const [l, rr] = span(x0, y0, x1, y1, r, y);
    px(ctx, typeof fill === "string" ? fill : fill(y), l, y, rr - l, 1);
  }
}

/** Row `y` of a rounded rectangle (as `rounded`): from where to where. */
function span(x0: number, y0: number, x1: number, y1: number, r: [number, number, number, number], y: number): [number, number] {
  const inset = (rad: number, d: number) => (d < rad ? rad - Math.sqrt(rad * rad - (rad - d - 0.5) ** 2) : 0);
  const top = y - y0;
  const bottom = y1 - 1 - y;
  return [x0 + Math.round(Math.max(inset(r[0], top), inset(r[2], bottom))), x1 - Math.round(Math.max(inset(r[1], top), inset(r[3], bottom)))];
}

/** A skateboard deck seen flat: nose and tail rounded, grip on one side, a graphic on the other. */
function deck(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, graphic: string, grip: boolean) {
  px(ctx, O, x, y + 1, w, h - 2);
  px(ctx, O, x + 1, y, w - 2, h);
  px(ctx, grip ? "#1e1e22" : color, x + 1, y + 1, w - 2, h - 2);
  if (grip) {
    px(ctx, "#2c2c31", x + 2, y + 2, 1, h - 4);
    return;
  }
  px(ctx, graphic, x + 1, y + Math.floor(h / 2) - 1, w - 2, 2);
  px(ctx, "#fff8e3", x + Math.floor(w / 2) - 1, y + 3, 2, 2);
}

/** A daisy decal: five white petals round a yellow middle. */
function daisy(ctx: CanvasRenderingContext2D, x: number, y: number, petal = "#fffaea") {
  for (const [dx, dy] of [[0, -3], [3, -1], [2, 3], [-2, 3], [-3, -1]]) disc(ctx, petal, x + dx, y + dy, 2);
  disc(ctx, "#ffcf4a", x, y, 1.6);
}

// ---- the shop inside ----------------------------------------------------------

const DECKS: [string, string][] = [
  ["#e8566b", "#ffd23f"],
  ["#3fa7e8", "#ffffff"],
  ["#7cd36a", "#3b3a2e"],
  ["#b48cff", "#ff5fa8"],
  ["#ff8a3d", "#3fd8e8"],
  ["#ffd23f", "#e8566b"],
];

/** The shop's wall, seen through the hatch: pegboard, decks, a neon sign, a shelf, string lights. */
function inside(ctx: CanvasRenderingContext2D) {
  const wall = "#e7d8b6";
  const peg = "#c9b68c";
  px(ctx, wall, HX0 - 4, HY0 - 4, HX1 - HX0 + 8, HY1 - HY0 + 14);
  for (let y = HY0 + 2; y < HY1 + 8; y += 5) for (let x = HX0; x < HX1; x += 5) px(ctx, peg, x, y, 1, 1);
  // A wooden rail along the top, string lights hung from it.
  px(ctx, "#a8784a", HX0 - 4, HY0 - 4, HX1 - HX0 + 8, 3);
  const wave = (x: number) => HY0 + Math.round(Math.sin(((x - HX0) / (HX1 - HX0)) * Math.PI * 3) * 1.5 + 1.5);
  for (let x = HX0; x < HX1; x += 1) px(ctx, O, x, wave(x), 1, 1);
  const bulbs = ["#ffd23f", "#ff5fa8", "#3fd8e8", "#7cd36a"];
  for (let i = 0, x = HX0 + 4; x < HX1 - 2; x += 8, i++) {
    px(ctx, "rgba(255,240,180,0.35)", x - 1, wave(x), 4, 4);
    px(ctx, bulbs[i % bulbs.length], x, wave(x) + 1, 2, 2);
  }
  // Decks hung on the wall in a row, graphics out (one turned grip out).
  DECKS.forEach(([c, g], i) => deck(ctx, HX0 + 4 + i * 9, HY0 + 8, 7, 26, c, g, i === 3));
  // The neon sign, glowing, to the right of them.
  const nx = HX1 - 30;
  px(ctx, "rgba(255,95,168,0.25)", nx - 3, HY0 + 6, 32, 14);
  text(ctx, "OPEN", nx + 13, HY0 + 10, "#ff5fa8", "#7a2350");
  // A shelf: wheels in a row, a pair of roller skates.
  const sy = HY0 + 30;
  px(ctx, "#8a5a33", nx - 6, sy, 36, 2);
  for (let i = 0; i < 4; i++) {
    disc(ctx, O, nx - 2 + i * 5, sy - 3, 2.5);
    disc(ctx, ["#ffd23f", "#f3efe0", "#3fd8e8", "#ff5fa8"][i], nx - 2 + i * 5, sy - 3, 1.6);
  }
  for (const k of [0, 1]) {
    const x = nx + 18 + k * 6;
    px(ctx, O, x - 1, sy - 9, 6, 7);
    px(ctx, k ? "#ff8a3d" : "#e8566b", x, sy - 8, 4, 5);
    px(ctx, "#f3efe0", x, sy - 8, 4, 1);
    px(ctx, O, x - 1, sy - 2, 6, 1);
    px(ctx, "#ffd23f", x, sy - 1, 1, 1);
    px(ctx, "#ffd23f", x + 3, sy - 1, 1, 1);
  }
  // A polaroid or two pinned up: a skater mid-air, a sunset.
  box(ctx, "#fffaea", nx - 2, sy + 4, 12, 13);
  px(ctx, "#3fd8e8", nx - 1, sy + 5, 10, 8);
  px(ctx, O, nx + 3, sy + 7, 2, 3);
  px(ctx, O, nx + 1, sy + 10, 6, 1);
  box(ctx, "#fffaea", nx + 14, sy + 5, 12, 12);
  px(ctx, "#ff8a3d", nx + 15, sy + 6, 10, 4);
  px(ctx, "#b48cff", nx + 15, sy + 10, 10, 3);
  disc(ctx, "#ffd23f", nx + 20, sy + 10, 2);
  // Shade in the corners (it's a small space).
  ctx.fillStyle = "rgba(40,30,20,0.18)";
  ctx.fillRect(HX0 - 4, HY0 - 4, 6, HY1 - HY0 + 14);
  ctx.fillRect(HX1 - 2, HY0 - 4, 6, HY1 - HY0 + 14);
}

// ---- the van ---------------------------------------------------------------------

/** The hatch: a frame round it, the striped awning propped up over it, the counter along its bottom with its odds and ends. */
function hatch(ctx: CanvasRenderingContext2D) {
  // Its frame (the hole itself is cut out after), a rubber seal and a chrome edge.
  rounded(ctx, O, HX0 - 4, HY0 - 4, HX1 + 4, HY1 + 2, [5, 5, 2, 2]);
  rounded(ctx, CHROME, HX0 - 3, HY0 - 3, HX1 + 3, HY1 + 1, [4, 4, 1, 1]);
  px(ctx, CHROME_LO, HX0 - 3, HY0 - 1, HX1 - HX0 + 6, 1);
  // The awning, propped up and out on two struts: pink and cream stripes, a scalloped edge.
  const top = 26;
  const a = "#ff6f9f";
  const b = "#fffaea";
  polygon(ctx, O, [[HX0 - 7, HY0 - 3], [HX1 + 7, HY0 - 3], [HX1 + 15, top - 1], [HX0 - 15, top - 1]]);
  polygon(ctx, a, [[HX0 - 6, HY0 - 4], [HX1 + 6, HY0 - 4], [HX1 + 13, top], [HX0 - 13, top]]);
  const at = (f: number, y: number) => {
    const t = (y - top) / (HY0 - 4 - top);
    const x0 = HX0 - 13 + 7 * t;
    const x1 = HX1 + 13 - 7 * t;
    return x0 + (x1 - x0) * f;
  };
  const stripes = 10;
  for (let i = 1; i < stripes; i += 2) {
    const f0 = i / stripes;
    const f1 = (i + 1) / stripes;
    polygon(ctx, b, [[at(f0, HY0 - 4), HY0 - 4], [at(f1, HY0 - 4), HY0 - 4], [at(f1, top), top], [at(f0, top), top]]);
  }
  // Light on the canvas near its hinge, shade toward its edge.
  px(ctx, "rgba(255,255,255,0.18)", HX0 - 6, HY0 - 7, HX1 - HX0 + 12, 3);
  px(ctx, "rgba(60,20,30,0.12)", HX0 - 12, top + 1, HX1 - HX0 + 24, 4);
  for (let x = HX0 - 14, i = 0; x < HX1 + 14; x += 8, i++) {
    oval(ctx, O, x + 4, top + 1, 4.5, 3.2);
    oval(ctx, i % 2 ? b : a, x + 4, top + 1, 3.5, 2.2);
  }
  // The struts, chrome.
  for (const x of [HX0 + 2, HX1 - 3]) {
    for (let i = 0; i < 13; i++) {
      const sx = x + (x < 100 ? -i * 0.55 : i * 0.55);
      px(ctx, O, sx - 0.5, HY0 - 3 - i * 2, 2, 2);
      px(ctx, CHROME, sx, HY0 - 3 - i * 2, 1, 2);
    }
  }
  // The counter: a wooden ledge out the hatch's bottom, on two brackets.
  box(ctx, "#c48a54", HX0 - 7, HY1, HX1 - HX0 + 14, 5);
  px(ctx, "#e0a96e", HX0 - 7, HY1, HX1 - HX0 + 14, 1);
  px(ctx, "#9a6a3e", HX0 - 7, HY1 + 4, HX1 - HX0 + 14, 1);
  for (const x of [HX0 - 2, HX1 - 2]) {
    px(ctx, O, x, HY1 + 5, 4, 4);
    px(ctx, CHROME_LO, x + 1, HY1 + 5, 2, 3);
  }

}

/** What's on the counter (in front of the seller: drawn after the hatch is cut). */
function counterTop(ctx: CanvasRenderingContext2D) {
  // A succulent in a pot, a deck on show, a jar of stickers, a cash tin, a bell.
  box(ctx, "#e07a54", HX0 - 3, HY1 - 6, 7, 6);
  px(ctx, "#f29a74", HX0 - 3, HY1 - 6, 7, 1);
  for (const [dx, dy] of [[0, -9], [-2, -8], [2, -8], [-1, -11], [1, -11]]) px(ctx, dx ? "#6fbf5a" : "#4f9a40", HX0 + dx, HY1 + dy, 2, 3);
  for (let i = 0; i < 24; i++) px(ctx, i < 2 || i > 21 ? O : "#1e1e22", HX0 + 10 + i, HY1 - 2 - Math.floor(i / 9), 1, 2);
  px(ctx, O, HX0 + 40, HY1 - 9, 8, 9);
  px(ctx, "rgba(220,240,255,0.7)", HX0 + 41, HY1 - 8, 6, 8);
  for (const [dx, dy, c] of [[1, 2, "#ff5fa8"], [3, 4, "#ffd23f"], [2, 6, "#3fd8e8"]] as [number, number, string][]) px(ctx, c, HX0 + 41 + dx, HY1 - 8 + dy, 2, 1);
  px(ctx, "#e05a5a", HX0 + 40, HY1 - 10, 8, 2);
  box(ctx, "#5a9a6a", HX1 - 26, HY1 - 6, 12, 6);
  px(ctx, "#ffd23f", HX1 - 22, HY1 - 4, 4, 1);
  // The little bell: ring for service.
  disc(ctx, O, HX1 - 6, HY1 - 3, 3.5);
  disc(ctx, "#ffd23f", HX1 - 6, HY1 - 3, 2.5);
  px(ctx, "#fff3a8", HX1 - 7, HY1 - 5, 1, 1);
  px(ctx, O, HX1 - 9, HY1 - 1, 7, 1);
}

/** Cuts the hatch out, so the seller and the shop behind show through. */
function cut(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(HX0, HY0, HX1 - HX0, HY1 - HY0);
}

/** A whitewall tyre in its arch: black rubber, a white ring, a domed hubcap. */
function wheel(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  disc(ctx, O, cx, cy, 13);
  disc(ctx, "#26252b", cx, cy, 12);
  disc(ctx, "#f4efe2", cx, cy, 9);
  disc(ctx, "#26252b", cx, cy, 7);
  disc(ctx, CREAM, cx, cy, 5.5);
  disc(ctx, CREAM_LO, cx + 1, cy + 1, 4);
  disc(ctx, CHROME, cx, cy, 2.5);
  px(ctx, "#ffffff", cx - 1, cy - 2, 1, 1);
  px(ctx, "rgba(255,255,255,0.35)", cx - 9, cy - 7, 3, 1);
}

/** Rust: a blotch of it, darker at its heart, flaking at its edge. */
function rust(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number) {
  for (let i = 0; i < r * 5; i++) {
    const a = ((seed * 7 + i * 37) % 360) * (Math.PI / 180);
    const d = ((seed * 13 + i * 11) % 100) / 100;
    const px0 = x + Math.cos(a) * r * d;
    const py0 = y + Math.sin(a) * r * d * 0.6;
    px(ctx, d < 0.4 ? "#7a3b1e" : d < 0.75 ? "#a0522d" : "#c46a2c", px0, py0, d < 0.5 ? 2 : 1, 1);
  }
}

/**
 * The camper van, side on, its nose to the west: an old split-window bus,
 * long and low, mustard yellow under cream with the cream sweeping down into
 * a V at the nose. A split cab window, a round headlight with a little lid,
 * chrome gone a bit dull, rust coming through round the arches and along the
 * sills, a dent, faded paint, engine vents at the back, a menu board, and the
 * giant deck on the roof rack.
 */
function camper(ctx: CanvasRenderingContext2D, w: number, g: number) {
  const mid = w / 2;
  // Its shadow on the ground.
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(12, g - 7, w - 24, 7);
  ctx.fillStyle = "rgba(0,0,0,0.1)";
  ctx.fillRect(6, g - 3, w - 12, 5);

  // ---- the roof rack and its sign: a giant deck, wheels up ----
  const rackY = 20;
  px(ctx, O, 36, rackY - 1, w - 54, 4);
  px(ctx, CHROME, 37, rackY, w - 56, 2);
  px(ctx, CHROME_LO, 37, rackY + 1, w - 56, 1);
  for (const x of [42, mid, w - 26]) {
    px(ctx, O, x - 1, rackY, 4, 8);
    px(ctx, CHROME_LO, x, rackY + 1, 2, 7);
  }
  rounded(ctx, O, mid - 58, 3, mid + 58, 19, [7, 7, 7, 7]);
  rounded(ctx, "#ffd23f", mid - 57, 4, mid + 57, 18, [6, 6, 6, 6]);
  px(ctx, "#ffe680", mid - 52, 5, 104, 2);
  px(ctx, "#e8b62a", mid - 52, 15, 104, 2);
  text(ctx, "SK8 TRUCK", mid, 8, "#3b3a2e", null);
  for (const x of [mid - 40, mid + 40]) {
    px(ctx, O, x - 6, 1, 12, 3);
    px(ctx, CHROME_LO, x - 5, 2, 10, 1);
    for (const dx of [-7, 5]) {
      disc(ctx, O, x + dx + 1, 1, 2.5);
      disc(ctx, "#f4efe2", x + dx + 1, 1, 1.6);
    }
  }

  // ---- the body: long and low, rounded ----
  const x0 = 4;
  const x1 = w - 4;
  const y0 = 26;
  const y1 = 146;
  const radii: [number, number, number, number] = [26, 18, 6, 6];
  const belt = (x: number) => (x < 46 ? 92 + (46 - x) * 0.42 : 92);
  rounded(ctx, O, x0 - 1, y0 - 1, x1 + 1, y1 + 1, [27, 19, 7, 7]);
  rounded(ctx, CREAM, x0, y0, x1, y1, radii);
  for (let y = 60; y < y1; y++) {
    const [l, r] = span(x0, y0, x1, y1, radii, y);
    for (let x = l; x < r; x++) {
      const b = Math.round(belt(x));
      if (y < b) continue;
      px(ctx, y > y1 - 10 ? YELLOW_LO : y < b + 3 ? YELLOW_HI : YELLOW, x, y);
    }
  }
  px(ctx, YELLOW_DARK, x0 + 6, y1 - 3, x1 - x0 - 12, 3);
  // Faded paint: the sun's had a go at the top of the yellow, a patch here and there.
  for (let i = 0; i < 70; i++) {
    const x = 50 + ((i * 53) % (w - 90));
    const y = 98 + ((i * 29) % 30);
    px(ctx, "rgba(255,240,200,0.18)", x, y, 3 + (i % 4), 1);
  }
  // Light along the roof, shade under the cream's lower edge.
  rounded(ctx, CREAM_HI, x0 + 6, y0 + 1, x1 - 6, y0 + 4, [3, 3, 0, 0]);
  for (let x = x0 + 2; x < x1 - 2; x++) px(ctx, CREAM_LO, x, Math.round(belt(x)) - 3, 1, 2);
  // The chrome trim along the belt (round the nose's V too), a little dull.
  for (let x = x0 + 1; x < x1 - 1; x++) {
    const b = Math.round(belt(x));
    px(ctx, O, x, b - 1, 1, 1);
    px(ctx, x % 9 === 0 ? CHROME_LO : CHROME, x, b, 1, 1);
  }
  // The rain gutter, and the panel seams along the side.
  px(ctx, CREAM_LO, 30, 34, x1 - 40, 1);
  for (const sx of [mid + 50, w - 46]) px(ctx, YELLOW_LO, sx, 96, 1, y1 - 100);

  // ---- the cab (the front, west) ----
  rounded(ctx, O, 11, 37, 50, 72, [10, 4, 3, 3]);
  rounded(ctx, (y) => (y < 54 ? GLASS : GLASS_LO), 12, 38, 49, 71, [9, 3, 2, 2]);
  px(ctx, O, 29, 38, 2, 33);
  for (let i = 0; i < 9; i++) {
    px(ctx, "rgba(255,255,255,0.55)", 16 + i, 60 - i * 2, 1, 2);
    px(ctx, "rgba(255,255,255,0.35)", 34 + i, 62 - i * 2, 1, 2);
  }
  px(ctx, CREAM_LO, 54, 38, 1, belt(54) - 38);
  px(ctx, YELLOW_LO, 54, belt(54) + 1, 1, y1 - belt(54) - 4);
  box(ctx, CHROME, 42, 80, 7, 2);
  px(ctx, O, 1, 60, 6, 2);
  rounded(ctx, O, 0, 54, 6, 66, [2, 2, 2, 2]);
  rounded(ctx, CHROME, 1, 55, 5, 65, [1, 1, 1, 1]);
  // The headlight, its little lid; the indicator; the round badge on the nose.
  disc(ctx, O, 12, 106, 7.5);
  disc(ctx, CHROME, 12, 106, 6.5);
  disc(ctx, "#fff3c4", 12, 106, 4.5);
  disc(ctx, "#ffffff", 10, 104, 1.5);
  for (let i = -6; i <= 6; i++) px(ctx, YELLOW_LO, 12 + i, 98 - Math.round(Math.sqrt(Math.max(0, 36 - i * i)) * 0.35), 1, 2);
  rounded(ctx, O, 6, 117, 15, 122, [2, 2, 2, 2]);
  px(ctx, "#ffb347", 7, 118, 7, 3);
  disc(ctx, O, 24, 113, 6.5);
  disc(ctx, CHROME, 24, 113, 5.5);
  disc(ctx, CREAM, 24, 113, 4);
  px(ctx, O, 21, 113, 7, 2);
  px(ctx, "#ff6f9f", 22, 113, 5, 1);

  // ---- the back (east): its window, the engine vents, a roof vent ----
  rounded(ctx, O, w - 37, 38, w - 13, 62, [3, 7, 3, 3]);
  rounded(ctx, (y) => (y < 48 ? GLASS : GLASS_LO), w - 36, 39, w - 14, 61, [2, 6, 2, 2]);
  for (let i = 0; i < 6; i++) px(ctx, "rgba(255,255,255,0.5)", w - 33 + i, 55 - i * 2, 1, 2);
  for (let i = 0; i < 6; i++) {
    const vy = 104 + i * 4;
    px(ctx, O, w - 36, vy, 20, 2);
    px(ctx, YELLOW_HI, w - 36, vy + 2, 20, 1);
  }
  rounded(ctx, O, w - 66, 27, w - 50, 32, [2, 2, 0, 0]);
  px(ctx, CREAM_LO, w - 65, 28, 14, 3);

  // ---- the side: the menu board, the lettering, a decal ----
  box(ctx, "#a8784a", HX1 + 8, 66, 27, 30);
  px(ctx, "#2f3b35", HX1 + 10, 68, 23, 26);
  text(ctx, "DECKS", HX1 + 22, 70, "#ffd23f", null);
  text(ctx, "WHEELS", HX1 + 22, 78, "#f3efe0", null);
  text(ctx, "TRUCKS", HX1 + 22, 86, "#ff8fb4", null);
  text(ctx, "BUILD YOUR BOARD", 112, 118, CREAM_HI, YELLOW_DARK);
  daisy(ctx, 70, 132);
  daisy(ctx, w - 58, 98, "#ffd6e5");
  // A smiley sticker on the cream, half peeled.
  disc(ctx, O, 57, 50, 4.5);
  disc(ctx, "#ffd23f", 57, 50, 3.5);
  px(ctx, O, 55, 49, 1, 1);
  px(ctx, O, 58, 49, 1, 1);
  px(ctx, O, 55, 52, 4, 1);
  px(ctx, "#fffaea", 59, 47, 2, 2);

  // ---- wear and tear: a dent, rust coming through ----
  for (let i = 0; i < 10; i++) px(ctx, YELLOW_LO, mid + 18 + i, 128 + Math.round(Math.sin(i / 3) * 2), 1, 1);
  for (let i = 0; i < 10; i++) px(ctx, YELLOW_HI, mid + 18 + i, 126 + Math.round(Math.sin(i / 3) * 2), 1, 1);
  rust(ctx, 44, 130, 9, 1);
  rust(ctx, w - 44, 130, 10, 2);
  rust(ctx, 60, 142, 6, 3);
  rust(ctx, mid + 30, 143, 7, 4);
  rust(ctx, w - 18, 140, 5, 5);
  rust(ctx, 52, 120, 3, 6);

  // ---- bumpers (a bit pitted) and wheels ----
  rounded(ctx, O, 0, 138, 24, 145, [3, 0, 3, 0]);
  rounded(ctx, CHROME, 1, 139, 24, 144, [2, 0, 2, 0]);
  px(ctx, "#ffffff", 3, 140, 18, 1);
  rounded(ctx, O, w - 24, 138, w, 145, [0, 3, 0, 3]);
  rounded(ctx, CHROME, w - 24, 139, w - 1, 144, [0, 2, 0, 2]);
  px(ctx, "#ffffff", w - 22, 140, 16, 1);
  for (const x of [6, 14, w - 18, w - 9]) px(ctx, "#a0522d", x, 142, 2, 1);
  for (const cx of [44, w - 44]) {
    disc(ctx, O, cx, 147, 16);
    disc(ctx, "#1f1a12", cx, 147, 15);
  }
  wheel(ctx, 44, g - 13);
  wheel(ctx, w - 44, g - 13);

  hatch(ctx);
}

/** The shop's art: the van in front (`sk_shop`), or the shop seen inside it (`sk_shop_back`). */
export function skateShopObject(o: MapObject): { texture: Texture; overhang: number; left: number } | null {
  if (o.kind !== "sk_shop" && o.kind !== "sk_shop_back") return null;
  const w = o.w * TILE;
  const h = 3 * TILE + SHOP_TOP;
  const g = h - 6;
  const [c, ctx] = canvas(w, h);
  if (o.kind === "sk_shop_back") inside(ctx);
  else {
    camper(ctx, w, g);
    cut(ctx);
    counterTop(ctx);
  }
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  // (The back's a row further north, so it sorts behind the seller: the same canvas, drawn from the same place.)
  return { texture: t, overhang: o.kind === "sk_shop_back" ? SHOP_TOP - TILE : SHOP_TOP, left: 0 };
}

/** Where the shop glows at night: its hatch, its headlight (on its art). */
export function skateShopLights(): { x: number; y: number }[] {
  return [
    { x: (HX0 + HX1) / 2, y: (HY0 + HY1) / 2 },
    { x: HX0 + 10, y: HY0 + 2 },
    { x: HX1 - 10, y: HY0 + 2 },
  ];
}
