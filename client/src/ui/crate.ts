// The daily crate: the popup when it's yours ("Daily crate added to your
// bag", its picture, Open now / Close), and opening it, all of it pixel art:
// a chest in the middle of the screen; tap it and it shakes, harder each
// time, light leaking round the lid; it bursts open in the colour of the best
// thing inside (common grey to legendary gold): a flash, a banded glow,
// pixel rays turning behind it, a beam up out of it, chunky sparks; three
// cards come out face down (poker backs, a "?" on each). Each is tapped to
// turn it over: it charges up first (longer, glowing its colour, the rarer it
// is), then flips. All three seen, Collect: they fly into the bag.
//
// The light's drawn on two low-resolution canvases (one behind the chest,
// one in front: see `PixelFx`), scaled up without smoothing, every value
// quantised into hard bands, so it's all big square pixels like the art.

import * as fx from "../ambient/cratesfx";
import type { Applied, Economy } from "../economy";
import { iconCanvas } from "../world/items";
import { TIERS } from "./rarity";

const O = "#2b1d0c";
const GOLD = "#f2bf3a";
const GOLD_D = "#a8761c";
const CREAM = "#fff6dc";

function px(ctx: CanvasRenderingContext2D, c: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function canvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  return c;
}

// ---- the chest -----------------------------------------------------------------

/** The chest's size in art pixels: its lid, and the body under it. */
export const CHEST_W = 40;
export const LID_H = 15;
export const BODY_H = 19;

/**
 * The chest's own palette, by hand: light from the top left, every ramp
 * leaning warm in its lights and purple in its darks (not just lighter and
 * darker of one colour), and a warm dark outline rather than black.
 */
const CH: Record<string, string> = {
  o: "#2a1418", // outline
  D: "#45231c", // wood: darkest (seams, the side in shadow)
  d: "#663424", // dark
  w: "#8c4c2e", // mid
  l: "#b16a3c", // light
  h: "#d38f55", // highlight, worn edges
  G: "#6e3f1f", // gold: darkest
  g: "#a8701f", // dark
  y: "#ddaa35", // mid
  Y: "#f6d368", // light
  W: "#fff6c6", // glint
  k: "#160b0f", // the keyhole
};

/** Paints `rows` (one string per row, a palette letter per pixel, "." for none) at (x, y). */
function sprite(ctx: CanvasRenderingContext2D, x: number, y: number, rows: string[]) {
  rows.forEach((row, ry) => [...row].forEach((c, rx) => c !== "." && CH[c] && px(ctx, CH[c], x + rx, y + ry)));
}

/** A run of one palette letter. */
function run(ctx: CanvasRenderingContext2D, c: string, x: number, y: number, w = 1, h = 1) {
  px(ctx, CH[c], x, y, w, h);
}

/**
 * The wood's colour at column `x` of the front (1–33): lit from the left,
 * falling off toward the corner, `lift` brighter (the lid catches more light).
 */
function woodAt(x: number, lift = 0): string {
  const t = x / 33 - lift * 0.18;
  return t < 0.16 ? "l" : t < 0.78 ? "w" : "d";
}

/** A strap down the front at `x` (4 wide: lit, mid, dark, shadow), rows y0..y1, rivets at `rivets`. */
function strap(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, rivets: number[]) {
  for (let y = y0; y <= y1; y++) {
    run(ctx, "Y", x, y);
    run(ctx, "y", x + 1, y, 2);
    run(ctx, "g", x + 3, y);
  }
  for (const r of rivets) sprite(ctx, x + 1, r, ["Wy", "yG"]);
}

/**
 * The chest's lid (40×15), in three-quarter view: the front of a rounded lid
 * (the front face 1–33, its right end in shadow 35–38), planks with grain,
 * a knot, worn edges, gold straps, rim and corners, and the hasp.
 */
export function chestLid(): HTMLCanvasElement {
  return canvas(CHEST_W, LID_H, (ctx) => {
    // The silhouette: a dome (its curve stepping down, a little flatter on the right as it turns away).
    run(ctx, "o", 9, 0, 21, 1);
    run(ctx, "o", 5, 1, 30, 1);
    run(ctx, "o", 3, 2, 34, 1);
    run(ctx, "o", 1, 3, 37, 1);
    run(ctx, "o", 0, 4, 40, 11);
    // The dome's top, in the light: brightest along its crown, warmer down its front.
    run(ctx, "h", 9, 1, 18, 1);
    run(ctx, "l", 27, 1, 7, 1);
    run(ctx, "h", 5, 2, 10, 1);
    run(ctx, "l", 15, 2, 15, 1);
    run(ctx, "w", 30, 2, 4, 1);
    run(ctx, "l", 3, 3, 18, 1);
    run(ctx, "w", 21, 3, 13, 1);
    // A soft line where the curve turns down to the front.
    run(ctx, "d", 1, 4, 33, 1);
    run(ctx, "w", 2, 4, 5, 1);
    for (let x = 1; x <= 33; x++) for (let y = 5; y <= 12; y++) run(ctx, woodAt(x), x, y);
    // A seam, and the light catching the plank's edge below it.
    run(ctx, "D", 1, 8, 33, 1);
    run(ctx, "l", 2, 9, 8, 1);
    run(ctx, "w", 10, 9, 9, 1);
    // Grain: broken streaks, and a knot.
    for (const [x, y, w] of [[11, 6, 5], [19, 7, 4], [3, 11, 3], [22, 11, 5], [28, 6, 3]]) run(ctx, "d", x, y, w);
    sprite(ctx, 15, 10, [".dd.", "dDDd", ".dd."]);
    // Worn chips along the crown.
    run(ctx, "W", 11, 1);
    run(ctx, "W", 6, 2);
    // The side, turned away: darker, its edge where the faces meet.
    run(ctx, "D", 34, 3, 1, 10);
    run(ctx, "w", 35, 3, 2, 1);
    for (let y = 4; y <= 12; y++) run(ctx, "d", 35, y, 3);
    run(ctx, "D", 35, 4, 3, 1);
    run(ctx, "D", 35, 8, 3, 1);
    // Straps, over the dome and down the front.
    strap(ctx, 6, 2, 12, [4, 10]);
    strap(ctx, 25, 1, 12, [4, 10]);
    // The rim, catching the light on the left, and a gold cap on each corner.
    run(ctx, "Y", 1, 13, 10, 1);
    run(ctx, "y", 11, 13, 20, 1);
    run(ctx, "g", 31, 13, 3, 1);
    run(ctx, "G", 1, 14, 33, 1);
    run(ctx, "g", 34, 13, 5, 1);
    run(ctx, "G", 34, 14, 5, 1);
    sprite(ctx, 1, 9, ["YYy", "Yyg", "yyg", "ygG"]);
    sprite(ctx, 35, 9, ["yg", "gG", "gG", "GG"]);
    // The hasp, hanging over the lock.
    sprite(ctx, 14, 10, [
      ".oooooo.",
      "oYYyyygo",
      "oYy..ygo",
      "oYy..ygo",
      ".oyyggo.",
    ]);
    run(ctx, "k", 16, 12, 2, 2);
  });
}

/**
 * The chest itself (40×19), in three-quarter view: planks with grain and
 * worn edges, gold straps, corner brackets, a shield-shaped lock plate with a
 * keyhole, its right end in shadow, and feet.
 */
export function chestBody(): HTMLCanvasElement {
  return canvas(CHEST_W, BODY_H, (ctx) => {
    run(ctx, "o", 0, 0, 40, 17);
    for (let x = 1; x <= 33; x++) for (let y = 0; y <= 15; y++) run(ctx, woodAt(x), x, y);
    // In the lid's shadow along the top; planks; the bottom edge.
    run(ctx, "D", 1, 0, 33, 1);
    run(ctx, "d", 1, 1, 33, 1);
    run(ctx, "D", 1, 6, 33, 1);
    run(ctx, "D", 1, 11, 33, 1);
    run(ctx, "l", 2, 7, 8, 1);
    run(ctx, "w", 10, 7, 10, 1);
    run(ctx, "l", 2, 12, 5, 1);
    run(ctx, "d", 1, 15, 33, 1);
    // Grain and a worn chip or two.
    for (const [x, y, w] of [[11, 3, 4], [19, 4, 6], [4, 9, 3], [22, 9, 5], [13, 13, 4], [29, 14, 3]]) run(ctx, "d", x, y, w);
    sprite(ctx, 27, 3, [".dd.", "dDDd", ".dd."]);
    run(ctx, "h", 2, 2);
    run(ctx, "h", 3, 8);
    // The side, turned away.
    run(ctx, "D", 34, 0, 1, 16);
    for (let y = 0; y <= 15; y++) run(ctx, y === 0 || y === 6 || y === 11 ? "D" : "d", 35, y, 3);
    run(ctx, "D", 35, 15, 3, 1);
    // Straps.
    strap(ctx, 6, 0, 15, [3, 9, 13]);
    strap(ctx, 25, 0, 15, [3, 9, 13]);
    // Corner brackets: the front's, lit; the side's, in shadow.
    sprite(ctx, 1, 11, ["Yg..", "Yg..", "Yyyg", "gggG"]);
    sprite(ctx, 30, 11, ["..yG", "..yG", "yyyG", "gGGG"]);
    sprite(ctx, 35, 11, ["gG.", "gG.", "gGG", "GGG"]);
    // The lock plate: a shield, a keyhole, a glint.
    sprite(ctx, 12, 1, [
      "oooooooooo",
      "oWYYyyyygo",
      "oYYyyyyygo",
      "oYyykkyygo",
      "oYykkkkygo",
      "oYyykkyygo",
      "oyyykkyygo",
      "oyykkkkggo",
      ".oyyyyggo.",
      "..oyyggo..",
      "...oooo...",
    ]);
    // Feet: the left one square on, the right one partly round the side.
    sprite(ctx, 2, 16, ["oDDDDo", ".oooo."]);
    sprite(ctx, 31, 16, ["oDDDDDDo", ".oooooo."]);
  });
}

/** The whole chest, closed (40×34): for the popup. */
export function chestClosed(): HTMLCanvasElement {
  return canvas(CHEST_W, LID_H + BODY_H, (ctx) => {
    ctx.drawImage(chestBody(), 0, LID_H);
    ctx.drawImage(chestLid(), 0, 0);
  });
}

let closedUrl = "";
function chestUrl(): string {
  return (closedUrl ||= chestClosed().toDataURL());
}

// ---- the cards -----------------------------------------------------------------

/** A card's size in art pixels (drawn at `--cs` screen pixels each). */
export const CARD_W = 30;
export const CARD_H = 42;

/** The "?" on a card's back (9×13): a bold stroke, a round hook. */
const QMARK = ["..XXXXX..", ".XXXXXXX.", "XXX...XXX", "XX.....XX", ".......XX", "......XXX", "....XXXX.", "...XXX...", "...XX....", "...XX....", ".........", "...XX....", "...XX...."];

/** `a` mixed toward `b` by `t` (0–1), as hex. */
function mix(a: string, b: string, t: number): string {
  const A = parseInt(a.slice(1), 16);
  const B = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((A >> sh) & 255) + (((B >> sh) & 255) - ((A >> sh) & 255)) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** A rectangle with its four corner pixels off (a card's rounded corner). */
function rounded(ctx: CanvasRenderingContext2D, c: string, x: number, y: number, w: number, h: number) {
  px(ctx, c, x + 1, y, w - 2, h);
  px(ctx, c, x, y + 1, w, h - 2);
}

/** A diamond at (cx, cy), `rx` wide and `ry` high to its points, of colour `c` (`inset`: shrunk, for an inner fill). */
function diamond(ctx: CanvasRenderingContext2D, c: string, cx: number, cy: number, rx: number, ry: number, inset = 0) {
  for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++)
    for (let x = Math.ceil(cx - rx); x <= Math.floor(cx + rx); x++) if (Math.abs(x - cx) / rx + Math.abs(y - cy) / ry <= 1 - inset) px(ctx, c, x, y);
}

/** The "?" glyph at (x, y) in `c`, outlined in `o`, a highlight down its left. */
function qmark(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, o: string) {
  const dots = (dx: number, dy: number, col: string) => QMARK.forEach((row, ry) => [...row].forEach((ch, rx) => ch === "X" && px(ctx, col, x + rx + dx, y + ry + dy)));
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) dots(dx, dy, o);
  dots(0, 0, c);
  const hl = mix(c, "#ffffff", 0.55);
  px(ctx, hl, x + 2, y + 1, 3, 1);
  px(ctx, hl, x + 1, y + 2, 1, 1);
  px(ctx, hl, x + 3, y + 8, 1, 1);
  px(ctx, hl, x + 3, y + 11, 1, 1);
}

/**
 * A card's back, in its rarity's colour: a cream border, a deep field of
 * that colour with a lattice of diamonds, a flourish in each corner, and a
 * cream diamond in the middle with the "?" in the colour.
 */
export function cardBack(color: string): HTMLCanvasElement {
  const deep = mix(color, "#120a1e", 0.62);
  const line = mix(color, "#120a1e", 0.3);
  const dot = mix(color, "#ffffff", 0.35);
  return canvas(CARD_W, CARD_H, (ctx) => {
    rounded(ctx, O, 0, 0, CARD_W, CARD_H);
    rounded(ctx, CREAM, 1, 1, CARD_W - 2, CARD_H - 2);
    px(ctx, mix(color, "#000000", 0.2), 3, 3, CARD_W - 6, CARD_H - 6);
    px(ctx, deep, 4, 4, CARD_W - 8, CARD_H - 8);
    // The lattice: diagonals both ways, a bright dot where they cross.
    for (let y = 4; y < CARD_H - 4; y++)
      for (let x = 4; x < CARD_W - 4; x++) {
        const a = (x + y) % 5 === 0;
        const b = (x - y + 500) % 5 === 0;
        if (a && b) px(ctx, dot, x, y);
        else if (a || b) px(ctx, line, x, y);
      }
    // A flourish in each corner: a small cream diamond, the colour at its heart.
    for (const [cx, cy] of [[7, 7], [CARD_W - 8, 7], [7, CARD_H - 8], [CARD_W - 8, CARD_H - 8]]) {
      diamond(ctx, O, cx, cy, 3, 3);
      diamond(ctx, CREAM, cx, cy, 2, 2);
      px(ctx, color, cx, cy);
    }
    // The diamond in the middle, outlined, with the "?".
    const mx = (CARD_W - 1) / 2;
    const my = (CARD_H - 1) / 2;
    diamond(ctx, O, mx, my, 10, 14);
    diamond(ctx, mix(color, "#ffffff", 0.75), mx, my, 9, 13);
    diamond(ctx, CREAM, mx, my, 8, 12);
    qmark(ctx, Math.round(mx) - 4, Math.round(my) - 6, color, O);
  });
}

/**
 * A card's front: cream paper in a frame of its rarity's colour, a gold
 * line inside it, the thing's picture up top (its own pixels, one to one),
 * a band below for its rarity's name (the text goes over it).
 */
export function cardFront(color: string, icon: HTMLCanvasElement | null): HTMLCanvasElement {
  return canvas(CARD_W, CARD_H, (ctx) => {
    rounded(ctx, O, 0, 0, CARD_W, CARD_H);
    rounded(ctx, color, 1, 1, CARD_W - 2, CARD_H - 2);
    px(ctx, mix(color, "#ffffff", 0.45), 2, 1, CARD_W - 4, 1);
    px(ctx, mix(color, "#ffffff", 0.45), 1, 2, 1, CARD_H - 4);
    px(ctx, GOLD_D, 3, 3, CARD_W - 6, CARD_H - 6);
    px(ctx, CREAM, 4, 4, CARD_W - 8, CARD_H - 8);
    px(ctx, "#ffffff", 4, 4, CARD_W - 8, 1);
    // The picture, in a little gold frame.
    px(ctx, GOLD_D, 6, 6, 18, 18);
    px(ctx, GOLD, 7, 7, 16, 16);
    px(ctx, "#fffdf2", 8, 8, 14, 14);
    if (icon) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(icon, 7, 7, 16, 16);
    }
    // The band for its rarity, the colour, a highlight along its top.
    px(ctx, GOLD_D, 4, CARD_H - 10, CARD_W - 8, 1);
    px(ctx, color, 4, CARD_H - 9, CARD_W - 8, 5);
    px(ctx, mix(color, "#ffffff", 0.4), 4, CARD_H - 9, CARD_W - 8, 1);
  });
}

// ---- the light: a pixel effects layer --------------------------------------------

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A spark: where and how it moves (art pixels), how long it has, its colour, whether it's a little star. */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  color: string;
  star: boolean;
  big: boolean;
}

/**
 * The light, in big pixels: two canvases a few screen pixels to the pixel,
 * behind the chest (the dark, its glow, the rays, the beam, the leak round
 * the lid) and in front (the flash, the sparks).
 */
class PixelFx {
  readonly back = document.createElement("canvas");
  readonly fore = document.createElement("canvas");
  /** Screen pixels to the art pixel. */
  P = 5;
  private w = 0;
  private h = 0;
  /** The chest's mouth (art pixels), and its lid seam. */
  mouth = { x: 0, y: 0 };
  seam = { x: 0, y: 0, half: 0 };
  /** The best thing's colour; how lit it is (0 shut – 1 burst open); the rays turning. */
  tier: [number, number, number] = [255, 255, 255];
  rank = 0;
  glow = 0;
  private rot = 0;
  /** Light leaking round the lid while it's shaken (0–1). */
  leak = 0;
  /** The flash on bursting: frames left. */
  private flash = 0;
  sparks: Spark[] = [];
  private frame = 0;

  constructor() {
    this.back.className = "crate-px crate-px-back";
    this.fore.className = "crate-px crate-px-fore";
    this.fit();
  }

  /** Sized to the screen (on a phone, fewer, bigger pixels keep it quick). */
  fit() {
    this.P = Math.max(3, Math.round(window.innerWidth / 220));
    this.w = Math.ceil(window.innerWidth / this.P);
    this.h = Math.ceil(window.innerHeight / this.P);
    for (const c of [this.back, this.fore]) {
      c.width = this.w;
      c.height = this.h;
    }
  }

  /** Where the chest is on screen (CSS px): its mouth and lid seam, in art pixels. */
  placeChest(r: DOMRect) {
    const P = this.P;
    const seamY = r.top + (r.height * LID_H) / (LID_H + BODY_H);
    this.mouth = { x: (r.left + r.width / 2) / P, y: seamY / P };
    this.seam = { x: this.mouth.x, y: seamY / P, half: (r.width * 0.46) / P };
  }

  /** Bursting open: the flash. */
  flashNow() {
    this.flash = 11;
  }

  /** Sparks out of (x, y) (CSS px): `n` of them, `spread` of a circle round `dir` (radians), at up to `speed`. */
  burst(x: number, y: number, n: number, dir: number, spread: number, speed: number, color: string, stars = 0.3) {
    const P = this.P;
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const v = (0.3 + Math.random() * speed) / P;
      this.sparks.push({ x: x / P, y: y / P, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 40 + Math.random() * 50, age: 0, color: Math.random() < 0.35 ? "#ffffff" : color, star: Math.random() < stars, big: Math.random() < 0.3 });
    }
  }

  /** A mote drifting up from (x, y) (CSS px). */
  mote(x: number, y: number, color: string) {
    const P = this.P;
    this.sparks.push({ x: x / P, y: y / P, vx: 0, vy: -(0.3 + Math.random() * 0.5) / P, life: 40 + Math.random() * 40, age: 0, color, star: Math.random() < 0.2, big: false });
  }

  render() {
    this.frame++;
    this.drawBack();
    this.drawFore();
  }

  /** The dark (lighter: the town stays in view) and, round the chest only, its light in hard bands. */
  private drawBack() {
    const { w, h } = this;
    const ctx = this.back.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const [tr, tg, tb] = this.tier;
    const dark = [14, 10, 24];
    const warm = [255, 236, 170];
    const cx = w / 2;
    const cy = h / 2;
    const far = Math.hypot(cx, cy);
    const mx = this.mouth.x;
    const my = this.mouth.y;
    // How far the light reaches: a glow a little wider than the cards, rays a little further.
    const R = h * 0.4;
    const R2 = h * 0.56;
    const rays = this.rank >= 4 ? 16 : 12;
    this.rot += this.rank >= 4 ? 0.012 : 0.005;
    const glow = this.glow;
    const leak = this.leak * (0.85 + 0.15 * Math.sin(this.frame / 3));
    const beamHalf = (CHEST_W * 6 * 0.4) / this.P;
    const beamH = (h * 0.38) | 0;
    const leakW = this.seam.half * 1.35 + 6;
    let i = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i += 4) {
        // The dark: a light veil, a little heavier toward the corners.
        const vd = Math.hypot(x - cx, y - cy) / far;
        const alpha = Math.round((0.56 + 0.2 * vd * vd) * 32) / 32;
        let light = 0;
        let lr = tr;
        let lg = tg;
        let lb = tb;
        if (glow > 0) {
          const dx = x - mx;
          const dy = y - my;
          const r = Math.hypot(dx, dy);
          if (r < R2) {
            const fall = Math.max(0, 1 - r / R);
            light += glow * fall * fall * 1.15;
            // The rays, turning: hard-edged wedges, fading out further off.
            const ang = Math.atan2(dy, dx) + this.rot;
            // (Wrapped into 0–1 all the way round: a plain % goes negative on one side, and that side filled solid.)
            const turn = (ang * rays) / (Math.PI * 2);
            const wedge = turn - Math.floor(turn);
            if (wedge < 0.4) light += glow * 0.42 * (1 - r / R2);
            // The beam, up out of its mouth.
            if (dy < 0 && dy > -beamH) {
              const up = -dy / beamH;
              const half = beamHalf * (0.5 + up * 0.8);
              if (Math.abs(dx) < half) light += glow * (1 - up) * (1 - up) * 0.9;
            }
          }
        }
        if (leak > 0) {
          const dx = x - this.seam.x;
          const dy = y - this.seam.y;
          if (Math.abs(dy) < 8 && Math.abs(dx) < leakW) {
            light += leak * (1 - Math.abs(dy) / 8) * (1 - (Math.abs(dx) / leakW) * 0.5) * 1.1;
            lr = warm[0];
            lg = warm[1];
            lb = warm[2];
          }
        }
        // Into five hard bands (no dither: clean rings, as old games drew light); the brightest whitens.
        const q = Math.min(1.25, Math.floor(light * 5) / 5);
        const k = Math.min(1, q);
        const wh = Math.max(0, q - 0.8) * 2;
        d[i] = dark[0] + (lr - dark[0]) * k + (255 - lr) * wh;
        d[i + 1] = dark[1] + (lg - dark[1]) * k + (255 - lg) * wh;
        d[i + 2] = dark[2] + (lb - dark[2]) * k + (255 - lb) * wh;
        // (Lit: the veil thins too, so the light reads as light, not paint.)
        d[i + 3] = alpha * (1 - 0.35 * k) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** In front: the flash, and the sparks. */
  private drawFore() {
    const { w, h } = this;
    const ctx = this.fore.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    if (this.flash > 0) {
      // A clean flash: an even wash, white then the colour, fading in steps;
      // and a ring of the colour racing out from the chest's mouth.
      const f = this.flash--;
      const [tr, tg, tb] = this.tier;
      ctx.fillStyle = f > 9 ? "rgba(255,255,255,0.75)" : `rgba(${tr},${tg},${tb},${[0.08, 0.14, 0.2, 0.28, 0.36, 0.45, 0.52, 0.58, 0.62][f - 1] ?? 0.6})`;
      ctx.fillRect(0, 0, w, h);
      const r = (12 - f) * (h / 22);
      const thick = Math.max(1, Math.round(f / 3));
      ctx.fillStyle = f > 6 ? "#ffffff" : `rgb(${tr},${tg},${tb})`;
      for (let a = 0; a < 96; a++) {
        const t = (a / 96) * Math.PI * 2;
        ctx.fillRect(Math.round(this.mouth.x + Math.cos(t) * r), Math.round(this.mouth.y + Math.sin(t) * r * 0.85), thick, thick);
      }
    }
    this.sparks = this.sparks.filter((s) => s.age < s.life);
    for (const s of this.sparks) {
      s.age++;
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.035;
      s.vx *= 0.985;
      // Fading: thinner on and off, then gone (no half-transparent pixels).
      const left = 1 - s.age / s.life;
      if (left < 0.5 && (this.frame + s.age) % (left < 0.25 ? 3 : 2) === 0) continue;
      ctx.fillStyle = s.color;
      const X = Math.floor(s.x);
      const Y = Math.floor(s.y);
      if (s.star && left > 0.3) {
        ctx.fillRect(X - 1, Y, 3, 1);
        ctx.fillRect(X, Y - 1, 1, 3);
      } else if (s.big && left > 0.5) ctx.fillRect(X, Y, 2, 2);
      else ctx.fillRect(X, Y, 1, 1);
    }
  }
}

// ---- the popup -------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** One of a crate's three: coins or a piece, how many, its rarity (0–4). */
interface Slot {
  item: number;
  qty: number;
  rarity: number;
}

interface Opened {
  slots: Slot[];
  best: number;
  applied: Applied;
}

/** "Daily crate added to your bag": its picture, Open now, or Close (it stays in the bag). */
export function showCrateToast(open: () => void) {
  document.querySelector(".crate-toast")?.remove();
  const t = el("div", "crate-toast");
  t.setAttribute("role", "dialog");
  t.setAttribute("aria-label", "Daily crate");
  const pic = el("img", "crate-toast-pic");
  pic.src = chestUrl();
  pic.alt = "";
  const text = el("div", "crate-toast-text");
  text.append(el("strong", "", "🎁 Daily crate!"), el("span", "", "Added to your bag. What's inside?"));
  const row = el("div", "crate-toast-row");
  const go = el("button", "primary", "Open now");
  go.type = "button";
  const shut = el("button", "", "Close");
  shut.type = "button";
  const gone = () => {
    t.classList.add("leaving");
    window.setTimeout(() => t.remove(), 260);
  };
  go.onclick = () => {
    gone();
    open();
  };
  shut.onclick = gone;
  row.append(go, shut);
  text.append(row);
  t.append(pic, text);
  document.body.append(t);
  fx.arrive(0.9);
}

// ---- opening it ------------------------------------------------------------------

const tierOf = (r: number) => TIERS[Math.max(0, Math.min(4, r))];

/**
 * Opening a daily crate, in the middle of the screen. `opened` asks the
 * server (one fewer crate; what was inside), `done` once it's put away.
 */
export class CrateOpening {
  private root = el("div", "crate-ov");
  private px = new PixelFx();
  private stage = el("div", "crate-stage");
  private chest = el("div", "crate-chest");
  private lid = el("div", "crate-lid");
  private cards = el("div", "crate-cards");
  private label = el("div", "crate-tier");
  private hint = el("div", "crate-hint", "Tap the crate to open it");
  private collectBtn = el("button", "crate-collect", "Collect");
  private phase: "ready" | "shaking" | "open" | "revealed" | "done" = "ready";
  /** Cards turned over (or turning) so far. */
  private seen = 0;
  private knocks = 0;
  private result: Opened | null = null;
  private failed = "";
  private raf = 0;
  private applied = false;
  /** The screen shaking (CSS px left), and cards charging up (sparks come off them). */
  private shake = 0;
  private charging = new Map<HTMLElement, string>();

  constructor(
    private eco: Economy,
    private opened: () => Promise<Opened>,
    private done: () => void = () => {},
  ) {
    const lidImg = chestLid();
    const bodyImg = chestBody();
    lidImg.className = "crate-lid-img";
    bodyImg.className = "crate-body-img";
    this.lid.append(lidImg);
    this.chest.append(this.lid, bodyImg);
    this.stage.append(this.cards, this.chest);
    const close = el("button", "crate-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "✕";
    close.onclick = (e) => {
      e.stopPropagation();
      this.finish();
    };
    this.collectBtn.type = "button";
    this.collectBtn.hidden = true;
    this.collectBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.collectBtn.onclick = (e) => {
      e.stopPropagation();
      this.finish();
    };
    this.root.append(this.px.back, this.stage, this.px.fore, this.label, this.hint, this.collectBtn, close);
    this.root.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.tap();
    });
    document.body.append(this.root);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onResize);
    requestAnimationFrame(() => this.root.classList.add("in"));
    fx.arrive();
    this.px.placeChest(this.chest.getBoundingClientRect());
    this.loop();
  }

  private onResize = () => {
    this.px.fit();
    this.px.placeChest(this.chest.getBoundingClientRect());
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      this.finish();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (this.phase === "open") {
        const next = ([...this.cards.children] as HTMLElement[]).findIndex((c) => !c.classList.contains("charging") && !c.classList.contains("flipped"));
        if (next >= 0) this.turn(this.cards.children[next] as HTMLElement, next);
      } else if (this.phase === "revealed") this.finish();
      else this.tap();
    }
  };

  private tap() {
    switch (this.phase) {
      case "ready":
        this.phase = "shaking";
        this.hint.textContent = "";
        void this.opened()
          .then((r) => (this.result = r))
          .catch((e) => (this.failed = e instanceof Error ? e.message : "That didn't open."));
        this.knock();
        break;
      case "shaking":
        // (Impatient: one more knock.)
        this.knock();
        break;
      case "open":
        // (Each card's tapped itself: see `turn`. Tapping beside them: a nudge to.)
        this.hint.classList.remove("nudge");
        void this.hint.offsetWidth;
        this.hint.classList.add("nudge");
        break;
    }
  }

  /** A knock on the crate: it shakes, harder each time, light leaking out; after the third (and the server's answer), open. */
  private knock() {
    this.knocks++;
    const k = Math.min(this.knocks, 4);
    fx.knock(this.knocks - 1);
    this.chest.style.setProperty("--shake", String(k));
    this.chest.classList.remove("shake");
    void this.chest.offsetWidth;
    this.chest.classList.add("shake");
    this.px.leak = Math.min(1, k / 3);
    this.root.style.setProperty("--leak", String(this.px.leak));
    this.root.classList.add("leaking");
    this.shake = Math.max(this.shake, 2 + k * 2);
    // Motes of light out of the seam.
    const r = this.chest.getBoundingClientRect();
    this.px.burst(r.left + r.width / 2, r.top + (r.height * LID_H) / (LID_H + BODY_H), 3 + k * 3, -Math.PI / 2, Math.PI * 1.2, 1.5 + k * 0.5, "#fff0a0", 0.5);
    if (this.knocks === 1) {
      window.setTimeout(() => this.phase === "shaking" && this.knocks < 2 && this.knock(), 420);
      window.setTimeout(() => this.phase === "shaking" && this.knocks < 3 && this.knock(), 760);
      window.setTimeout(() => this.waitToOpen(), 1050);
    }
  }

  /** Once the server's said what's inside: burst open (or say what went wrong). */
  private waitToOpen() {
    if (this.phase !== "shaking") return;
    if (this.failed) {
      this.hint.textContent = this.failed;
      this.phase = "revealed";
      return;
    }
    if (!this.result) {
      window.setTimeout(() => this.waitToOpen(), 120);
      return;
    }
    this.burst(this.result);
  }

  /** It bursts open: the lid off, a flash and rays in the best thing's colour, its rarity's name, three cards out face down. */
  private burst(r: Opened) {
    this.phase = "open";
    const tier = tierOf(r.best);
    this.root.style.setProperty("--tier", tier.color);
    this.root.classList.remove("leaking");
    this.root.classList.add("opened", `best-${r.best}`);
    this.chest.classList.remove("shake");
    this.px.leak = 0;
    this.px.tier = rgb(tier.color);
    this.px.rank = r.best;
    this.px.flashNow();
    this.shake = 10 + r.best * 4;
    fx.burstOpen(r.best);
    fx.cardsOut();
    this.label.textContent = r.best >= 4 ? `${tier.name.toUpperCase()}!!` : r.best >= 2 ? `${tier.name}!` : tier.name;
    this.label.style.color = tier.color;
    // Sparks up out of it, more the rarer.
    const box = this.chest.getBoundingClientRect();
    this.px.burst(box.left + box.width / 2, box.top + (box.height * LID_H) / (LID_H + BODY_H), 50 + r.best * 35, -Math.PI / 2, Math.PI * 1.3, 9 + r.best * 3, tier.color);
    // The cards, face down, rising out of it.
    this.cards.replaceChildren();
    r.slots.forEach((s, i) => {
      const t = tierOf(s.rarity);
      const card = el("div", `crate-card tier-${s.rarity}`);
      card.style.setProperty("--i", String(i));
      card.style.setProperty("--c", t.color);
      const inner = el("div", "crate-card-inner");
      const back = el("div", "crate-card-face crate-card-back");
      back.append(cardBack(t.color), el("div", "crate-card-charge"));
      const front = el("div", "crate-card-face crate-card-front");
      const coin = s.item === 1;
      const it = this.eco.items.get(s.item);
      front.append(
        cardFront(t.color, it ? iconCanvas(it.key, it.kind) : null),
        el("strong", "crate-card-name", coin ? `${s.qty} coins` : (it?.name ?? "Something")),
        el("span", "crate-card-tier", t.name),
      );
      inner.append(back, front);
      card.append(inner);
      card.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (e.button === 0) this.turn(card, i);
      });
      card.addEventListener("pointerenter", () => {
        if (this.phase === "open" && !card.classList.contains("charging") && !card.classList.contains("flipped")) fx.nudge();
      });
      this.cards.append(card);
    });
    window.setTimeout(() => {
      if (this.phase === "open" && this.seen === 0) this.hint.textContent = "Tap each card to turn it over";
    }, 900);
  }

  /**
   * A card tapped: it charges up (shaking, its colour glowing through, longer
   * the rarer it is), then turns over. All three over: Collect.
   */
  private turn(card: HTMLElement, i: number) {
    const r = this.result;
    if (!r || this.phase !== "open" || card.classList.contains("charging") || card.classList.contains("flipped")) return;
    const s = r.slots[i];
    const t = tierOf(s.rarity);
    const secs = [0.3, 0.45, 0.65, 1, 1.4][Math.max(0, Math.min(4, s.rarity))];
    this.seen++;
    this.hint.textContent = "";
    card.style.setProperty("--charge", `${secs}s`);
    card.classList.add("charging");
    this.charging.set(card, t.color);
    fx.charge(s.rarity, secs);
    window.setTimeout(() => {
      this.charging.delete(card);
      card.classList.remove("charging");
      // The flip: squashed to a sliver, the other face, back out, a pop.
      card.classList.add("flipping");
      window.setTimeout(() => card.classList.add("flipped"), 130);
      window.setTimeout(() => card.classList.remove("flipping"), 300);
      fx.reveal(s.rarity, i);
      if (s.item === 1) fx.coinsIn(s.qty);
      const b = card.getBoundingClientRect();
      this.px.burst(b.left + b.width / 2, b.top + b.height / 2, 12 + s.rarity * 14, -Math.PI / 2, Math.PI * 2, 3 + s.rarity, t.color, 0.4);
      if (s.rarity >= 3) this.shake = Math.max(this.shake, 6 + s.rarity * 2);
      if (this.seen === r.slots.length && !this.cards.querySelector(".charging")) this.allSeen();
    }, secs * 1000);
  }

  /** All three turned over: a ta-da, and Collect. */
  private allSeen() {
    const r = this.result;
    if (!r || this.phase !== "open") return;
    this.phase = "revealed";
    window.setTimeout(() => {
      fx.allSeen(r.best);
      this.hint.textContent = "";
      this.collectBtn.hidden = false;
    }, 650);
  }

  /** What was inside, into the bag (and the coins counted). */
  private apply() {
    if (this.applied || !this.result) return;
    this.applied = true;
    this.eco.applyResult(this.result.applied);
  }

  /** Put away (whatever was inside is in your bag, opened or not yet looked at); collected, the cards fly into the bag. */
  private finish() {
    if (this.phase === "done") return;
    const collected = this.phase === "revealed";
    if (this.result && this.phase !== "ready") this.apply();
    if (this.applied) fx.collect();
    this.phase = "done";
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onResize);
    this.collectBtn.hidden = true;
    let wait = 0;
    const bag = document.querySelector(".bag-btn")?.getBoundingClientRect();
    if (collected && bag) {
      ([...this.cards.children] as HTMLElement[]).forEach((card, i) => {
        const b = card.getBoundingClientRect();
        card.style.setProperty("--fly-x", `${bag.left + bag.width / 2 - (b.left + b.width / 2)}px`);
        card.style.setProperty("--fly-y", `${bag.top + bag.height / 2 - (b.top + b.height / 2)}px`);
        card.style.setProperty("--fly-d", `${i * 0.08}s`);
        card.classList.add("flying");
      });
      wait = 650;
      window.setTimeout(() => {
        document.querySelector(".bag-btn")?.classList.add("crate-got");
        this.px.burst(bag.left + bag.width / 2, bag.top + bag.height / 2, 18, -Math.PI / 2, Math.PI * 2, 3, "#fff0a0", 0.5);
      }, 500);
      window.setTimeout(() => document.querySelector(".bag-btn")?.classList.remove("crate-got"), 1100);
    }
    window.setTimeout(() => this.root.classList.add("leaving"), wait);
    window.setTimeout(() => {
      cancelAnimationFrame(this.raf);
      this.root.remove();
      this.done();
    }, wait + 280);
  }

  /** Each frame: the light, the sparks, the screen shaking, motes off a charging card and a rare chest. */
  private loop = () => {
    const px = this.px;
    const r = this.result;
    const lit = this.phase === "open" || this.phase === "revealed" || (this.phase === "done" && this.applied);
    px.glow = lit ? Math.min(1, px.glow + 0.08) : 0;
    if (r && lit && r.best >= 2 && Math.random() < 0.1 + r.best * 0.08) {
      const b = this.chest.getBoundingClientRect();
      px.mote(b.left + Math.random() * b.width, b.top - Math.random() * b.height, Math.random() < 0.5 ? "#ffffff" : tierOf(r.best).color);
    }
    for (const [card, color] of this.charging) {
      const b = card.getBoundingClientRect();
      if (Math.random() < 0.6) px.mote(b.left + Math.random() * b.width, b.bottom, color);
    }
    // The screen shaking: whole art pixels, dying down.
    if (this.shake > 0.5) {
      const P = px.P;
      const dx = Math.round(((Math.random() * 2 - 1) * this.shake) / P) * P;
      const dy = Math.round(((Math.random() * 2 - 1) * this.shake) / P) * P;
      this.stage.style.transform = `translate(${dx}px, ${dy}px)`;
      this.shake *= 0.82;
    } else if (this.stage.style.transform) this.stage.style.transform = "";
    px.render();
    this.raf = requestAnimationFrame(this.loop);
  };
}

/** The crate's icon, small (the bag): its closed picture. */
export function crateIconUrl(): string {
  return chestUrl();
}
