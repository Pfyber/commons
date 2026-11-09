// The skatepark's art: smooth poured concrete, and its pieces drawn the way
// the park's rules see them (activities/skatesim.ts), so you ride on what you
// see. Each piece is a height field: every point of it drawn as high up the
// screen as it stands, north to south, so the near parts cover the far, and
// whatever's under a top shows as a face below it (the risers of the stairs,
// the funbox's sides, a quarter pipe's wall). Then the steel: coping along
// the lips and ledges, the rails on their posts. A few tags sprayed about.

import { Texture } from "pixi.js";
import { kickerHeight, QUARTER_H, rampHeight, type Dir, type Ramp } from "../activities/skatesim";
import type { MapObject } from "./map";
import { drawPixelText, pixelWidth } from "./pixelfont";

const TILE = 32;
const O = "#3b3a2e";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function texture(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  return t;
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

type RGB = [number, number, number];
const rgb = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Poured concrete: lit tops, the faces under them darker, the ramps' faces in between by how they face the light. */
const LIT: RGB = [222, 219, 210];
const SHADE: RGB = [150, 147, 140];
const FACE: RGB = [160, 156, 148];
const FACE_DARK: RGB = [128, 124, 117];
/** The light, from up and to the north-west (a unit vector toward it: east, south, up). */
const LIGHT = (() => {
  const v = [-0.45, -0.55, 0.7];
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
})();

/**
 * Paints a height field `w`×`d` px (ground px from the top-left), `top` px
 * of headroom above it: `z(x, y)` its height there. Each point's top drawn
 * where it shows (up the screen by its height), lit by its slope; under it,
 * down to the ground, its face.
 */
function heightField(ctx: CanvasRenderingContext2D, w: number, d: number, top: number, z: (x: number, y: number) => number, salt: number) {
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < d; y++) {
      const h = z(x, y);
      if (h <= 0.5) continue;
      const sy = top + y - Math.round(h);
      // The slope: how it faces the light.
      const dzx = (z(Math.min(w - 1, x + 1), y) - z(Math.max(0, x - 1), y)) / 2;
      const dzy = (z(x, Math.min(d - 1, y + 1)) - z(x, Math.max(0, y - 1))) / 2;
      const n = Math.hypot(dzx, dzy, 1);
      const lit = Math.max(0, (-dzx * LIGHT[0] - dzy * LIGHT[1] + LIGHT[2]) / n);
      const k = hash(x, y, salt);
      let c = mix(SHADE, LIT, Math.min(1, lit * 1.15));
      if (k % 11 === 0) c = mix(c, [120, 116, 110], 0.18);
      else if (k % 13 === 0) c = mix(c, [250, 248, 240], 0.25);
      px(ctx, rgb(c), x, sy);
      // Down to the next point south: a slope (the same surface, stretched
      // down the screen), or a drop (a face, down to what's in front: the
      // ground, at the south end).
      const next = y + 1 < d ? z(x, y + 1) : 0;
      const fall = Math.round(h) - Math.round(next);
      if (fall <= 0) continue;
      const slope = y + 1 < d && fall <= 3;
      for (let f = 1; f <= fall; f++) {
        if (slope) {
          px(ctx, rgb(hash(x, sy + f, salt + 2) % 13 === 0 ? mix(c, [120, 116, 110], 0.15) : c), x, sy + f);
          continue;
        }
        const t = f / Math.max(1, fall);
        let fc = mix(FACE, FACE_DARK, t * 0.8);
        if (hash(x, sy + f, salt + 1) % 17 === 0) fc = mix(fc, [100, 96, 90], 0.2);
        px(ctx, rgb(fc), x, sy + f);
      }
    }
  }
}

/** A steel coping pipe along a line of screen points. */
function coping(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  for (const [x, y] of pts) px(ctx, O, x, y - 2, 1, 5);
  for (const [x, y] of pts) {
    px(ctx, "#9aa4ad", x, y - 1, 1, 3);
    px(ctx, "#e4ebf0", x, y - 1, 1, 1);
    px(ctx, "#6d7680", x, y + 1, 1, 1);
  }
}

/** A tag sprayed on: an outlined word in a bright colour. */
function tag(ctx: CanvasRenderingContext2D, word: string, x: number, y: number, color: string, scale = 1) {
  const w = pixelWidth(word, scale);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawPixelText(ctx, word, x - w / 2 + dx, y + dy, "#1f1b2e", scale);
  drawPixelText(ctx, word, x - w / 2, y, color, scale);
}

const TAGS = ["SK8", "RAD", "OLLIE", "GRIND", "SHRED", "ZOOM", "WOAH", "COMMONS"];
const SPRAY = ["#ff5fa8", "#3fd8e8", "#ffd23f", "#7cf26a", "#b48cff", "#ff8a3d"];

/** A quarter pipe, kicker or stair set as a height field, on a canvas of its own. */
function ramp(o: MapObject, kind: Ramp["kind"], dir: Dir, h: number): { c: HTMLCanvasElement; top: number } {
  const w = o.w * TILE;
  const d = o.h * TILE;
  // Room above for its height, and (a quarter pipe) the deck behind its lip.
  const top = Math.ceil(h) + (kind === "quarter" ? 10 : 4);
  const [c, ctx] = canvas(w, d + top);
  const r: Ramp = { kind, dir, h, x0: 0, y0: 0, x1: w, y1: d, id: 0 };
  const up = (x: number, y: number) => {
    switch (dir) {
      case "n":
        return (d - y) / d;
      case "s":
        return y / d;
      case "e":
        return x / w;
      case "w":
        return (w - x) / w;
    }
  };
  heightField(ctx, w, d, top, (x, y) => rampHeight(r, up(x + 0.5, y + 0.5)), o.x * 7 + o.y);
  if (kind === "quarter") {
    // The coping along the lip, and the deck behind it (a strip of it).
    const lip: [number, number][] = [];
    if (dir === "n") {
      px(ctx, rgb(LIT), 0, top - h - 8, w, 7);
      px(ctx, rgb(SHADE), 0, top - h - 2, w, 1);
      for (let x = 0; x < w; x++) lip.push([x, top - h]);
    } else if (dir === "e" || dir === "w") {
      // The lip runs north to south, up at the wall end: the deck's edge beside it.
      const lx = dir === "e" ? w - 2 : 1;
      for (let y = 0; y < d; y++) lip.push([lx, top + y - h]);
      px(ctx, rgb(LIT), dir === "e" ? w - 1 : 0, top - h, 1, d);
    } else {
      for (let x = 0; x < w; x++) lip.push([x, top + d - h]);
    }
    coping(ctx, lip);
    // A tag or two on the steep part.
    const k = hash(o.x, o.y, 5);
    if (dir === "n" && w >= 5 * TILE) {
      tag(ctx, TAGS[k % TAGS.length], w * 0.3, top - h + 14, SPRAY[k % SPRAY.length]);
      tag(ctx, TAGS[(k >>> 8) % TAGS.length], w * 0.72, top - h + 18, SPRAY[(k >>> 4) % SPRAY.length]);
    }
  }
  if (kind === "kicker") {
    // Steel plate at its foot, where you roll on, and its top edge.
    const edge: [number, number][] = [];
    if (dir === "e" || dir === "w") {
      const ex = dir === "e" ? w - 1 : 0;
      for (let y = 0; y < d; y++) edge.push([ex, top + y - h]);
      const fx = dir === "e" ? 0 : w - 3;
      px(ctx, "#8f99a2", fx, top, 3, d);
      px(ctx, "#c3ccd3", fx, top, 3, 1);
    } else if (dir === "n") {
      for (let x = 0; x < w; x++) edge.push([x, top - h]);
      px(ctx, "#8f99a2", 0, top + d - 3, w, 3);
      px(ctx, "#c3ccd3", 0, top + d - 3, w, 1);
    }
    coping(ctx, edge);
  }
  if (kind === "stairs") {
    // A nosing of steel on each step's edge.
    const steps = 4;
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      const z = h * (s / (steps + 1));
      if (dir === "n") {
        const y = Math.round(d - f * d);
        px(ctx, "#b8c0c8", 0, top + y - z, w, 1);
      }
    }
  }
  return { c, top };
}

/** A box: a top with steel coping round its edges, sides below. */
function box(o: MapObject, h: number): { c: HTMLCanvasElement; top: number } {
  const w = o.w * TILE;
  const d = o.h * TILE;
  const top = h + 4;
  const [c, ctx] = canvas(w, d + top);
  heightField(ctx, w, d, top, () => h, o.x * 5 + o.y * 3);
  // Coping round the top: along the front and back, down the sides.
  const front: [number, number][] = [];
  const back: [number, number][] = [];
  for (let x = 0; x < w; x++) {
    front.push([x, top + d - 1 - h]);
    back.push([x, top - h]);
  }
  coping(ctx, back);
  coping(ctx, front);
  for (let y = 0; y < d; y++) {
    px(ctx, "#b8c0c8", 0, top + y - h, 1, 1);
    px(ctx, "#8a939c", w - 1, top + y - h, 1, 1);
  }
  // The deck (a tall box): its top's expansion joints; the funbox and ledges, a tag on the front.
  if (h >= 20) {
    for (let x = TILE * 2; x < w; x += TILE * 2) px(ctx, "#b9b6ae", x, top - h + 2, 1, d - 3);
    for (let y = TILE * 2; y < d; y += TILE * 2) px(ctx, "#b9b6ae", 1, top + y - h, w - 2, 1);
  } else if (h >= 7 && w >= 3 * TILE) {
    const k = hash(o.x, o.y, 9);
    const word = TAGS[k % TAGS.length];
    if (pixelWidth(word, 1) < w - 8 && h >= 9) tag(ctx, word, w / 2, top + d - h + 2, SPRAY[k % SPRAY.length]);
  }
  return { c, top };
}

/** A rail: a steel bar on posts, `axis` across or down its tile(s), from `za` to `zb` px up. */
function rail(o: MapObject, axis: string, za: number, zb: number): { c: HTMLCanvasElement; top: number } {
  const w = o.w * TILE;
  const d = o.h * TILE;
  const top = Math.max(za, zb) + 6;
  const [c, ctx] = canvas(w, d + top);
  const post = (x: number, y: number, z: number) => {
    const len = Math.min(z, 16);
    px(ctx, O, x - 1, top + y - z, 3, len + 1);
    px(ctx, "#6d7680", x, top + y - z, 1, len);
    // Its foot, bolted down.
    px(ctx, "#4e555c", x - 2, top + y - z + len, 5, 1);
  };
  if (axis === "v") {
    const x = w / 2;
    const y0 = 4;
    const y1 = d - 4;
    const zAt = (y: number) => za + ((zb - za) * (y - y0)) / (y1 - y0);
    post(x, y0 + 2, zAt(y0 + 2));
    post(x, y1 - 2, zAt(y1 - 2));
    for (let y = y0; y <= y1; y++) {
      const sy = top + y - zAt(y);
      px(ctx, O, x - 2, sy - 1, 5, 4);
    }
    for (let y = y0; y <= y1; y++) {
      const sy = top + y - zAt(y);
      px(ctx, "#a8b2bb", x - 1, sy, 3, 2);
      px(ctx, "#eef3f6", x - 1, sy, 1, 1);
    }
  } else {
    const y = d / 2;
    const x0 = 4;
    const x1 = w - 4;
    const zAt = (x: number) => za + ((zb - za) * (x - x0)) / (x1 - x0);
    for (let x = x0 + 6; x < x1; x += 2 * TILE - 8) post(x, y, zAt(x));
    post(x1 - 6, y, zAt(x1 - 6));
    for (let x = x0; x <= x1; x++) px(ctx, O, x, top + y - zAt(x) - 2, 1, 5);
    for (let x = x0; x <= x1; x++) {
      const sy = top + y - zAt(x);
      px(ctx, "#a8b2bb", x, sy - 1, 1, 3);
      px(ctx, "#eef3f6", x, sy - 1, 1, 1);
      px(ctx, "#6d7680", x, sy + 1, 1, 1);
    }
    // Its shadow on what's under it.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(x0 + 4, top + y - Math.min(za, zb) + 16 + 2, x1 - x0 - 4, 2);
  }
  return { c, top };
}

/** The park's board by its gate: a painted sign on two posts. */
function board(o: MapObject): { c: HTMLCanvasElement; top: number } {
  const w = o.w * TILE;
  const d = o.h * TILE;
  const top = 46;
  const [c, ctx] = canvas(w, d + top);
  const y0 = 4;
  // Posts.
  for (const x of [10, w - 14]) {
    px(ctx, O, x - 1, y0 + 10, 6, top + d - y0 - 12);
    px(ctx, "#7a5232", x, y0 + 10, 4, top + d - y0 - 13);
  }
  // The board.
  px(ctx, O, 2, y0, w - 4, 44);
  px(ctx, "#2b2f45", 3, y0 + 1, w - 6, 42);
  px(ctx, "#3a4060", 3, y0 + 1, w - 6, 2);
  tag(ctx, "SKATEPARK", w / 2, y0 + 5, "#ffd23f");
  // Today's best, in little bars.
  const cols = ["#ff5fa8", "#3fd8e8", "#7cf26a"];
  for (let i = 0; i < 3; i++) {
    const y = y0 + 18 + i * 7;
    px(ctx, "#f3efe0", 10, y, 6, 3);
    px(ctx, cols[i], 20, y, w - 50 - i * 12, 3);
  }
  px(ctx, "#ff5fa8", w - 22, y0 + 34, 12, 6);
  drawPixelText(ctx, "GO", w - 21, y0 + 35, "#fff", 1);
  // Its shadow.
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(6, top + d - 6, w - 12, 4);
  return { c, top };
}

/** A logo painted on the concrete, worn by wheels: big letters, an outline, stars. */
function paint(o: MapObject, word: string): { c: HTMLCanvasElement; top: number } {
  const w = o.w * TILE;
  const d = o.h * TILE;
  const [c, ctx] = canvas(w, d);
  let scale = 5;
  while (scale > 1 && pixelWidth(word, scale) > w - 24) scale--;
  const tw = pixelWidth(word, scale);
  const x = (w - tw) / 2;
  const y = (d - 5 * scale) / 2;
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (Math.abs(dx) + Math.abs(dy) >= 2) drawPixelText(ctx, word, x + dx, y + dy, "#3fd8e8", scale);
  drawPixelText(ctx, word, x, y, "#ff5fa8", scale);
  // Stars either side.
  for (const sx of [10, w - 16]) {
    px(ctx, "#ffd23f", sx + 2, y + 2, 2, 8);
    px(ctx, "#ffd23f", sx - 1, y + 5, 8, 2);
  }
  // Worn: wheels have scuffed the paint off in streaks.
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 260; i++) {
    const k = hash(i, o.x, 3);
    ctx.fillStyle = `rgba(0,0,0,${0.35 + (k % 50) / 100})`;
    ctx.fillRect(k % w, (k >>> 9) % d, 2 + (k % 7), 1);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  return { c, top: 0 };
}

/** The skatepark's pieces' art (null: not one of them). */
export function skateObject(o: MapObject): { texture: Texture; overhang: number; left: number } | null {
  if (!o.kind.startsWith("sk_")) return null;
  const label = o.label ?? "";
  let made: { c: HTMLCanvasElement; top: number };
  switch (o.kind) {
    case "sk_quarter":
      made = ramp(o, "quarter", label as Dir, QUARTER_H);
      break;
    case "sk_kicker":
      made = ramp(o, "kicker", label.split(":")[0] as Dir, kickerHeight(o));
      break;
    case "sk_stairs": {
      const [down, h] = label.split(":");
      const back: Record<string, Dir> = { n: "s", s: "n", e: "w", w: "e" };
      made = ramp(o, "stairs", back[down] ?? "n", Number(h) || 24);
      break;
    }
    case "sk_box":
      made = box(o, Number(label) || 12);
      break;
    case "sk_rail": {
      const [axis, a, b] = label.split(":");
      made = rail(o, axis, Number(a) || 14, Number(b) || Number(a) || 14);
      break;
    }
    case "sk_board":
      made = board(o);
      break;
    case "sk_paint":
      made = paint(o, label);
      break;
    default: {
      const [c] = canvas(1, 1);
      return { texture: texture(c), overhang: 0, left: 0 };
    }
  }
  return { texture: texture(made.c), overhang: made.top, left: 0 };
}

/**
 * One tile of the inner ring road where it runs through the park: the same
 * asphalt as the rest of the ring (so the road reads on through), worn
 * smooth, with wheel marks and the odd chalked arrow.
 */
export function drawSkateRoad(ctx: CanvasRenderingContext2D, tx: number, ty: number, ox: number, oy: number) {
  px(ctx, "#a7a39a", ox, oy, TILE, TILE);
  for (let i = 0; i < 8; i++) {
    const s = hash(tx, ty, 60 + i);
    px(ctx, i % 2 ? "#9b978e" : "#b3afa6", ox + (s % 31), oy + ((s >>> 8) % 31), 1 + (s % 2), 1);
  }
  const k = hash(tx, ty, 61);
  if (k % 5 === 0) {
    ctx.fillStyle = "rgba(40,36,32,0.16)";
    ctx.fillRect(ox + (k % 10), oy + 8 + ((k >>> 4) % 12), 16 + (k % 10), 1);
    ctx.fillRect(ox + (k % 10), oy + 13 + ((k >>> 4) % 12), 16 + (k % 10), 1);
  }
  // A chalked arrow now and then.
  if (k % 41 === 0) {
    px(ctx, "rgba(240,236,224,0.6)", ox + 8, oy + 15, 14, 2);
    px(ctx, "rgba(240,236,224,0.6)", ox + 18, oy + 12, 2, 8);
    px(ctx, "rgba(240,236,224,0.6)", ox + 20, oy + 14, 2, 4);
  }
}

/** One tile of the park's concrete: smooth, warm grey, flecked, with a saw-cut joint every few tiles. */
export function drawSkateGround(ctx: CanvasRenderingContext2D, tx: number, ty: number, ox: number, oy: number, differs: (dx: number, dy: number) => boolean) {
  // Big soft patches, a shade lighter or darker, so the slab isn't one flat colour.
  const patch = (hash(tx >> 2, ty >> 2, 31) % 3) - 1 + ((hash(tx >> 1, ty >> 1, 32) % 3) - 1) * 0.5;
  const base: RGB = [184 + patch * 5, 180 + patch * 5, 171 + patch * 5];
  px(ctx, rgb(base), ox, oy, TILE, TILE);
  for (let i = 0; i < 9; i++) {
    const s = hash(tx, ty, 40 + i);
    px(ctx, rgb(i % 3 ? mix(base, [140, 136, 128], 0.35) : mix(base, [235, 232, 224], 0.5)), ox + (s % 31), oy + ((s >>> 8) % 31), 1 + (s % 2), 1);
  }
  // Wheel marks and the odd stain.
  const k = hash(tx, ty, 77);
  if (k % 9 === 0) {
    ctx.fillStyle = "rgba(60,55,50,0.10)";
    ctx.fillRect(ox + 4 + (k % 12), oy + 6 + ((k >>> 4) % 14), 14 + (k % 9), 1);
    ctx.fillRect(ox + 4 + (k % 12), oy + 10 + ((k >>> 4) % 14), 14 + (k % 9), 1);
  }
  if (k % 23 === 0) {
    ctx.fillStyle = "rgba(70,65,60,0.08)";
    ctx.fillRect(ox + 8, oy + 8, 12, 9);
  }
  // Saw-cut joints every four tiles.
  if (tx % 4 === 0) px(ctx, "#8f8b83", ox, oy, 1, TILE);
  if (ty % 4 === 0) px(ctx, "#8f8b83", ox, oy, TILE, 1);
  // A rounded edge where it meets the grass.
  if (differs(0, -1)) px(ctx, "#bdb9b0", ox, oy, TILE, 2);
  if (differs(-1, 0)) px(ctx, "#bdb9b0", ox, oy, 2, TILE);
  if (differs(1, 0)) px(ctx, "#a9a59c", ox + TILE - 2, oy, 2, TILE);
  if (differs(0, 1)) px(ctx, "#a9a59c", ox, oy + TILE - 2, TILE, 2);
}
