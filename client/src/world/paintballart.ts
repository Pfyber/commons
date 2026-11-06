// The Splat Yard's things, in the town's pixel style: the field's chalk
// lines and bases, the power-up pads, and the cover on it (hay bales,
// crates, tyre stacks, steel drums, inflatable snakes and the big yellow X,
// hedges), each splashed with old paint from matches gone by; and in the
// hall, the sign-up desk, the racks and the way out. Drawn 3/4 top-down:
// a lit top, a shaded front face, standing up from its footprint.

import { disc, oval, polygon } from "./pixeldraw";
import { drawPixelText, pixelWidth } from "./pixelfont";

type Ctx = CanvasRenderingContext2D;
const T = 32;
const OUTLINE = "#2b2233";
/** The teams' paint, and the paint everywhere else. */
export const BLUE_PAINT = "#3fa9ff";
export const RED_PAINT = "#ff4f6a";
const PAINTS = ["#3fa9ff", "#ff4f6a", "#ffd23f", "#7ee05a", "#c77dff", "#ff9a3f"];
const CALM_SATURATION = 0.58;
const CALM_LIGHT = 0.95;

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

/** A little seeded random, so each thing gets the same paint every time. */
function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

/** A splat of paint: a blob, a few droplets round it, a highlight. */
export function splat(ctx: Ctx, color: string, cx: number, cy: number, r: number, rnd: () => number) {
  disc(ctx, color, cx, cy, r);
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * (0.7 + rnd() * 0.6);
    disc(ctx, color, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, Math.max(1, r * (0.3 + rnd() * 0.3)));
  }
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * (1.4 + rnd() * 0.9);
    px(ctx, color, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, 1 + (rnd() < 0.4 ? 1 : 0), 1);
  }
  px(ctx, "rgba(255,255,255,0.55)", cx - r * 0.4, cy - r * 0.45, Math.max(1, r * 0.4), 1);
}

function word(ctx: Ctx, text: string, cx: number, y: number, color: string, shadow = OUTLINE) {
  const x = Math.round(cx - pixelWidth(text) / 2);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawPixelText(ctx, text, x + dx, y + dy, shadow);
  drawPixelText(ctx, text, x, y, color);
}

/** Old paint on a surface: a few splats in random colours over (x, y, w, h). */
function oldPaint(ctx: Ctx, x: number, y: number, w: number, h: number, n: number, rnd: () => number, r = 3) {
  for (let i = 0; i < n; i++) splat(ctx, PAINTS[Math.floor(rnd() * PAINTS.length)], x + rnd() * w, y + rnd() * h, r * (0.6 + rnd() * 0.7), rnd);
}

/** The Yard's art, its colours calmed: so much of a muddy old barn's, so little of the paint box's. */
function calm(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d")!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const grey = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    for (let k = 0; k < 3; k++) d[i + k] = (grey + (d[i + k] - grey) * CALM_SATURATION) * CALM_LIGHT;
  }
  ctx.putImageData(img, 0, 0);
}

/** The art for one of the Yard's objects, or null if it isn't one. */
export function paintballObject(o: { kind: string; x: number; y: number; w: number; h: number; label?: string | null }): { c: HTMLCanvasElement; overhang: number } | null {
  const art = drawObject(o);
  if (art) calm(art.c);
  return art;
}

function drawObject(o: { kind: string; x: number; y: number; w: number; h: number; label?: string | null }): { c: HTMLCanvasElement; overhang: number } | null {
  const w = o.w * T;
  const h = o.h * T;
  const rnd = rand(o.x * 7919 + o.y * 104729 + o.kind.length * 31);
  switch (o.kind) {
    case "pb_field":
      return { c: field(w, h), overhang: 0 };
    case "pb_spawn": {
      // A base plate: the team's colour, worn.
      const [c, ctx] = canvas(w, h);
      const col = o.label === "red" ? RED_PAINT : BLUE_PAINT;
      oval(ctx, "rgba(0,0,0,0.18)", w / 2, h / 2 + 2, 13, 9);
      oval(ctx, col, w / 2, h / 2, 13, 9);
      oval(ctx, "rgba(255,255,255,0.35)", w / 2, h / 2, 9, 6);
      oval(ctx, col, w / 2, h / 2, 6, 4);
      return { c, overhang: 0 };
    }
    case "pb_pad": {
      // A power-up pad: a steel ring with a glowing middle (the power-up floats over it).
      const [c, ctx] = canvas(w, h);
      const cx = w / 2;
      const cy = h / 2 + 2;
      oval(ctx, "rgba(0,0,0,0.25)", cx, cy + 3, 22, 13);
      oval(ctx, "#4a4f5c", cx, cy, 22, 13);
      oval(ctx, "#8d95a6", cx, cy - 1, 20, 11);
      oval(ctx, "#2a2e38", cx, cy, 15, 8);
      oval(ctx, "#7af7ff", cx, cy, 11, 6);
      oval(ctx, "#d8fdff", cx, cy - 1, 6, 3);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        px(ctx, "#ffd23f", cx + Math.cos(a) * 18 - 1, cy + Math.sin(a) * 9.5 - 1, 2, 2);
      }
      return { c, overhang: 0 };
    }
    case "pb_hay":
      return hay(w, h, rnd);
    case "pb_crate":
      return crate(w, h, rnd);
    case "pb_tires":
      return tires(w, h, rnd);
    case "pb_drum":
      return drum(w, h, rnd);
    case "pb_snake":
      return snake(w, h, rnd);
    case "pb_x":
      return xBunker(w, h, rnd);
    case "pb_hedge":
      return hedge(w, h, rnd);
    case "pb_desk":
      return desk(w, h, rnd);
    case "pb_rack":
      return rack(w, h, o.label === "Masks", rnd);
    case "pb_exit": {
      const [c, ctx] = canvas(w, h + 16);
      px(ctx, "#3a2416", 0, 0, w, h + 16);
      px(ctx, "#6b4a2f", 3, 3, w - 6, h + 10);
      px(ctx, "#ffd23f", 6, h + 6, w - 12, 8);
      word(ctx, "EXIT", w / 2, h / 2 + 2, "#7ee05a");
      return { c, overhang: 16 };
    }
  }
  return null;
}

/** The field: turf in mown stripes, chalk lines, each side's base, netting posts round it. */
function field(w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  // Worn turf, muted, and mown in stripes.
  px(ctx, "#7c9769", 0, 0, w, h);
  for (let x = 0; x < w; x += 64) px(ctx, "rgba(255,255,255,0.05)", x, 0, 32, h);
  // The bases: three tiles deep at each end, in the team's colour, hatched.
  const base = 3 * T;
  for (const [x0, col] of [[0, BLUE_PAINT], [w - base, RED_PAINT]] as [number, string][]) {
    ctx.globalAlpha = 0.18;
    px(ctx, col, x0, 0, base, h);
    ctx.globalAlpha = 0.22;
    for (let k = -h; k < base; k += 10) {
      for (let y = 0; y < h; y += 2) {
        const x = x0 + k + y / 2;
        if (x >= x0 && x < x0 + base) px(ctx, col, x, y, 2, 2);
      }
    }
    ctx.globalAlpha = 1;
    px(ctx, col, x0 + (x0 === 0 ? base - 2 : 0), 0, 2, h);
  }
  // Chalk: the edge, the halfway line (dashed), the centre circle.
  const chalk = "rgba(255,255,255,0.75)";
  px(ctx, chalk, 2, 2, w - 4, 2);
  px(ctx, chalk, 2, h - 4, w - 4, 2);
  px(ctx, chalk, 2, 2, 2, h - 4);
  px(ctx, chalk, w - 4, 2, 2, h - 4);
  for (let y = 6; y < h - 6; y += 12) px(ctx, chalk, w / 2 - 1, y, 2, 7);
  for (let k = 0; k < 96; k++) {
    const a = (k / 96) * Math.PI * 2;
    px(ctx, chalk, w / 2 + Math.cos(a) * 88 - 1, h / 2 + Math.sin(a) * 88 - 1, 2, 2);
  }
  // Old paint scuffed into the turf.
  const rnd = rand(4242);
  for (let i = 0; i < 70; i++) {
    const col = PAINTS[Math.floor(rnd() * PAINTS.length)];
    ctx.globalAlpha = 0.35 + rnd() * 0.3;
    splat(ctx, col, 8 + rnd() * (w - 16), 8 + rnd() * (h - 16), 2 + rnd() * 3, rnd);
  }
  ctx.globalAlpha = 1;
  // Netting posts all round.
  for (let x = 0; x <= w; x += 64) {
    for (const y of [0, h - 3]) {
      px(ctx, OUTLINE, x - 2, y, 4, 3);
      px(ctx, "#c9c2b0", x - 1, y, 2, 2);
    }
  }
  for (let y = 0; y <= h; y += 64) {
    for (const x of [0, w - 3]) {
      px(ctx, OUTLINE, x, y - 2, 3, 4);
      px(ctx, "#c9c2b0", x, y - 1, 2, 2);
    }
  }
  return c;
}

/** A front-facing block: top face, front face below it, outlined; returns the faces' rects. */
function block(ctx: Ctx, w: number, H: number, face: number, top: string, front: string) {
  px(ctx, "rgba(0,0,0,0.22)", 3, H - 4, w - 2, 5);
  px(ctx, OUTLINE, 1, 1, w - 2, H - 3);
  px(ctx, top, 2, 2, w - 4, H - 4 - face);
  px(ctx, front, 2, H - 2 - face, w - 4, face - 1);
  return { top: { x: 2, y: 2, w: w - 4, h: H - 4 - face }, front: { x: 2, y: H - 2 - face, w: w - 4, h: face - 1 } };
}

function hay(w: number, h: number, rnd: () => number) {
  const over = 10;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const f = block(ctx, w, H, 12, "#e8c45a", "#c99a35");
  // Straw on top, in long strokes; the cut ends on the front.
  for (let i = 0; i < (w * f.top.h) / 18; i++) {
    const x = f.top.x + rnd() * (f.top.w - 6);
    const y = f.top.y + rnd() * f.top.h;
    px(ctx, rnd() < 0.5 ? "#f6dc80" : "#d4a843", x, y, 3 + rnd() * 5, 1);
  }
  for (let i = 0; i < (w * 10) / 6; i++) px(ctx, rnd() < 0.5 ? "#a87a26" : "#e0b54e", f.front.x + rnd() * f.front.w, f.front.y + rnd() * f.front.h, 1, 1);
  // Red twine round it.
  const across = w >= h;
  for (const k of [0.3, 0.7]) {
    if (across) {
      const x = f.top.x + f.top.w * k;
      px(ctx, "#b8323a", x, f.top.y, 2, f.top.h + f.front.h);
    } else {
      const y = f.top.y + f.top.h * k;
      px(ctx, "#b8323a", f.top.x, y, f.top.w, 2);
    }
  }
  oldPaint(ctx, f.front.x, f.front.y, f.front.w, f.front.h, 2 + Math.floor(rnd() * 2), rnd, 2.5);
  oldPaint(ctx, f.top.x, f.top.y, f.top.w, f.top.h, 1, rnd, 2);
  return { c, overhang: over };
}

function crate(w: number, h: number, rnd: () => number) {
  const over = 12;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const f = block(ctx, w, H, 14, "#b98a52", "#8f6236");
  // Planks on top; a braced front.
  for (let y = f.top.y + 5; y < f.top.y + f.top.h; y += 6) px(ctx, "#9c7040", f.top.x, y, f.top.w, 1);
  px(ctx, "#d4a86a", f.top.x, f.top.y, f.top.w, 1);
  px(ctx, "#5f3f22", f.front.x, f.front.y, f.front.w, 2);
  px(ctx, "#5f3f22", f.front.x, f.front.y + f.front.h - 2, f.front.w, 2);
  for (let k = 0; k < f.front.w; k++) {
    const y = f.front.y + 2 + Math.round((k / f.front.w) * (f.front.h - 4));
    px(ctx, "#6f4a28", f.front.x + k, y, 1, 2);
  }
  px(ctx, "#2b2233", f.front.x + f.front.w / 2 - 6, f.front.y + 4, 1, 1);
  oldPaint(ctx, f.front.x, f.front.y, f.front.w, f.front.h, 1 + Math.floor(rnd() * 2), rnd, 2.5);
  return { c, overhang: over };
}

function tires(w: number, h: number, rnd: () => number) {
  const over = 16;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  px(ctx, "rgba(0,0,0,0.22)", 3, H - 5, w - 4, 5);
  // A stack of tyres in each tile, three high.
  const cols = Math.max(1, Math.round(w / T));
  const rows = Math.max(1, Math.round(h / T));
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const cx = k * T + T / 2;
      const footY = r * T + T + over - 6;
      for (let level = 0; level < 3; level++) {
        const cy = footY - level * 7;
        oval(ctx, OUTLINE, cx, cy, 14, 8);
        oval(ctx, level === 2 ? "#3d3a42" : "#2f2c34", cx, cy, 13, 7);
        if (level === 2) {
          oval(ctx, "#4e4a55", cx, cy - 1, 13, 6);
          oval(ctx, "#18161c", cx, cy, 6, 3);
        } else px(ctx, "#4a4650", cx - 12, cy - 2, 24, 1);
      }
      // Painted bands.
      px(ctx, PAINTS[Math.floor(rnd() * PAINTS.length)], cx - 13, footY - 9, 4, 2);
      oldPaint(ctx, cx - 12, footY - 16, 24, 10, 1, rnd, 2);
    }
  }
  return { c, overhang: over };
}

function drum(w: number, h: number, rnd: () => number) {
  const over = 18;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const cx = w / 2;
  const top = 6;
  const foot = H - 6;
  oval(ctx, "rgba(0,0,0,0.25)", cx, foot + 2, 13, 4);
  // Steel: a cylinder, banded, with a hard shine (balls bounce off it).
  px(ctx, OUTLINE, cx - 12, top, 24, foot - top);
  px(ctx, "#5f7287", cx - 11, top, 22, foot - top);
  px(ctx, "#7f94aa", cx - 8, top, 6, foot - top);
  px(ctx, "#c9d8e6", cx - 6, top + 2, 2, foot - top - 4);
  px(ctx, "#3f4f60", cx + 6, top, 5, foot - top);
  for (const y of [top + 10, foot - 9]) {
    px(ctx, "#2f3c4a", cx - 11, y, 22, 2);
    px(ctx, "#9fb2c4", cx - 11, y - 1, 22, 1);
  }
  oval(ctx, OUTLINE, cx, top, 12, 5);
  oval(ctx, "#8fa3b8", cx, top, 11, 4);
  oval(ctx, "#5f7287", cx, top + 1, 7, 2);
  // A ricochet sticker: yellow and black chevrons.
  const sy = top + 14;
  px(ctx, "#ffd23f", cx - 7, sy, 14, 7);
  for (let k = 0; k < 3; k++) polygon(ctx, OUTLINE, [[cx - 6 + k * 5, sy + 1], [cx - 3 + k * 5, sy + 3.5], [cx - 6 + k * 5, sy + 6], [cx - 4 + k * 5, sy + 6], [cx - 1 + k * 5, sy + 3.5], [cx - 4 + k * 5, sy + 1]]);
  oldPaint(ctx, cx - 10, foot - 8, 20, 6, 1, rnd, 2);
  return { c, overhang: over };
}

/** An inflatable bunker's colours: lime and white, or orange and white. */
function inflatableColors(rnd: () => number): [string, string, string] {
  return rnd() < 0.5 ? ["#8fd84a", "#5fa62f", "#e9ffd4"] : ["#ff9a3f", "#d0702a", "#ffe8d0"];
}

function snake(w: number, h: number, rnd: () => number) {
  const over = 12;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const [main, dark, light] = inflatableColors(rnd);
  px(ctx, "rgba(0,0,0,0.22)", 4, H - 6, w - 6, 6);
  // A long, rounded, puffed-up tube, in segments.
  const across = w >= h;
  const segs = Math.max(1, Math.round((across ? w : h) / 16));
  for (let i = 0; i < segs; i++) {
    const cx = across ? 8 + i * ((w - 16) / Math.max(1, segs - 1)) : w / 2;
    const cy = across ? H / 2 + 2 : 10 + i * ((H - 20) / Math.max(1, segs - 1));
    const rx = across ? 10 : w / 2 - 2;
    const ry = across ? H / 2 - 4 : 10;
    oval(ctx, OUTLINE, cx, cy, rx + 1, ry + 1);
  }
  for (let i = 0; i < segs; i++) {
    const cx = across ? 8 + i * ((w - 16) / Math.max(1, segs - 1)) : w / 2;
    const cy = across ? H / 2 + 2 : 10 + i * ((H - 20) / Math.max(1, segs - 1));
    const rx = across ? 10 : w / 2 - 2;
    const ry = across ? H / 2 - 4 : 10;
    oval(ctx, dark, cx, cy, rx, ry);
    oval(ctx, i % 2 ? main : light, cx, cy - 2, rx - 2, ry - 3);
    px(ctx, "#ffffff", cx - rx / 2, cy - ry / 2 - 1, 3, 1);
  }
  oldPaint(ctx, 4, 6, w - 8, H - 14, 2, rnd, 2.5);
  return { c, overhang: over };
}

function xBunker(w: number, h: number, rnd: () => number) {
  const over = 22;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  const cx = w / 2;
  const cy = H / 2 + 6;
  oval(ctx, "rgba(0,0,0,0.25)", cx, H - 8, w / 2 - 4, 8);
  // Two crossed puffy beams, in sunshine yellow.
  const arm = (dx: number, dy: number, col: string, r: number) => {
    for (let t = -1; t <= 1.0001; t += 0.1) disc(ctx, col, cx + dx * t * (w / 2 - 12), cy + dy * t * (h / 2 - 12) - (1 - Math.abs(t)) * 10, r);
  };
  for (const [dx, dy] of [[1, 1], [1, -1]]) arm(dx, dy, OUTLINE, 11);
  for (const [dx, dy] of [[1, 1], [1, -1]]) arm(dx, dy, "#d9a915", 10);
  for (const [dx, dy] of [[1, 1], [1, -1]]) arm(dx, dy * 0.95, "#ffd23f", 8);
  disc(ctx, "#fff1a8", cx - 6, cy - 18, 4);
  px(ctx, "#ffffff", cx - 8, cy - 20, 3, 1);
  word(ctx, "X", cx, cy - 4, "#ff4f6a");
  oldPaint(ctx, 8, 14, w - 16, H - 30, 4, rnd, 3);
  return { c, overhang: over };
}

function hedge(w: number, h: number, rnd: () => number) {
  const over = 14;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  px(ctx, "rgba(0,0,0,0.2)", 3, H - 6, w - 4, 6);
  // A deep, leafy clump (you can push into it and hide).
  const lumps: [number, number, number][] = [];
  for (let i = 0; i < Math.round((w * h) / 140); i++) lumps.push([8 + rnd() * (w - 16), 10 + rnd() * (H - 22), 7 + rnd() * 5]);
  lumps.sort((a, b) => a[1] - b[1]);
  for (const [x, y, r] of lumps) disc(ctx, OUTLINE, x, y, r + 1);
  for (const [x, y, r] of lumps) disc(ctx, "#2f6b2a", x, y, r);
  for (const [x, y, r] of lumps) disc(ctx, "#3f8a37", x, y - 1, r - 2);
  for (const [x, y, r] of lumps) disc(ctx, "#5aa84a", x - r / 3, y - r / 3, r / 3);
  for (let i = 0; i < (w * H) / 30; i++) {
    const x = 4 + rnd() * (w - 8);
    const y = 6 + rnd() * (H - 14);
    px(ctx, rnd() < 0.5 ? "#2a5a25" : "#6fbd57", x, y, 2, 1);
  }
  oldPaint(ctx, 6, 8, w - 12, H - 20, 1, rnd, 2);
  return { c, overhang: over };
}

function desk(w: number, h: number, rnd: () => number) {
  const over = 34;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  // A banner on poles: SPLAT YARD, Blue on one side, Red on the other.
  px(ctx, OUTLINE, 6, 2, 2, 26);
  px(ctx, OUTLINE, w - 8, 2, 2, 26);
  px(ctx, OUTLINE, 8, 3, w - 16, 14);
  px(ctx, BLUE_PAINT, 9, 4, (w - 18) / 2, 12);
  px(ctx, RED_PAINT, 9 + (w - 18) / 2, 4, (w - 18) / 2, 12);
  word(ctx, "SPLAT YARD", w / 2, 6, "#fff6d8");
  // The counter: wood, with paint cans on it.
  const y0 = over - 2;
  px(ctx, "rgba(0,0,0,0.22)", 3, H - 4, w - 2, 5);
  px(ctx, OUTLINE, 1, y0, w - 2, h + 1);
  px(ctx, "#c99a5f", 2, y0 + 1, w - 4, 10);
  px(ctx, "#7a4f2c", 2, y0 + 11, w - 4, h - 12);
  px(ctx, "#e0b878", 2, y0 + 1, w - 4, 1);
  for (let x = 10; x < w - 10; x += 26) {
    const col = PAINTS[Math.floor(rnd() * PAINTS.length)];
    px(ctx, OUTLINE, x - 1, y0 - 9, 10, 11);
    px(ctx, "#c9ced8", x, y0 - 8, 8, 9);
    px(ctx, col, x, y0 - 6, 8, 4);
    px(ctx, col, x + 2, y0 - 2, 2, 3);
  }
  oldPaint(ctx, 4, y0 + 12, w - 8, h - 14, 3, rnd, 2.5);
  return { c, overhang: over };
}

function rack(w: number, h: number, masks: boolean, rnd: () => number) {
  const over = 30;
  const H = h + over;
  const [c, ctx] = canvas(w, H);
  px(ctx, OUTLINE, 1, 4, w - 2, H - 6);
  px(ctx, "#8f6236", 2, 5, w - 4, H - 8);
  px(ctx, "#6b4626", 2, 18, w - 4, 2);
  for (let x = 10; x < w - 8; x += 18) {
    const col = PAINTS[Math.floor(rnd() * PAINTS.length)];
    if (masks) {
      // A mask: goggles and a vented chin.
      oval(ctx, OUTLINE, x + 2, 14, 7, 8);
      oval(ctx, col, x + 2, 14, 6, 7);
      px(ctx, "#1a2a3a", x - 3, 10, 10, 4);
      px(ctx, "#7fd7ff", x - 2, 10, 3, 1);
      px(ctx, OUTLINE, x, 17, 4, 1);
      px(ctx, OUTLINE, x, 19, 4, 1);
    } else {
      // A marker: grip, body, the hopper on top, the barrel.
      px(ctx, OUTLINE, x - 4, 8, 14, 6);
      px(ctx, "#3a3f4a", x - 3, 9, 12, 4);
      px(ctx, col, x - 1, 4, 6, 5);
      px(ctx, OUTLINE, x + 9, 10, 8, 2);
      px(ctx, "#3a3f4a", x - 1, 13, 3, 6);
    }
    px(ctx, OUTLINE, x - 6, 28, 18, 1);
  }
  return { c, overhang: over };
}
