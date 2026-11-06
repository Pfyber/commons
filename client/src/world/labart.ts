// The Glowroot Labyrinth's art: old mossy stone walls (some with glowing
// roots), the stair back up, the Glowroot itself, the sleeping lanterns
// (dark, and lit) and the lost glimmers. Drawn at 32×32 a tile like the rest.

import { Texture } from "pixi.js";
import type { MapObject } from "./map";
import { disc, oval, polygon } from "./pixeldraw";

const TILE = 32;
const O = "#1d1a26";
const STONE = "#4a4f5e";
const STONE_D = "#383c49";
const STONE_L = "#5d6375";
const MORTAR = "#2c2f3a";
const MOSS = "#3f6b45";
const MOSS_L = "#5a8d55";
const MOSS_D = "#2d4d33";
const ROOT = "#6b4f3a";
const GLOW = "#8ff5e4";
const GLOW_D = "#43bfb0";

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
  ctx.fillRect(x, y, w, h);
}

function texture(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  return t;
}

/** A tiny repeatable hash for the walls' variety. */
function h(a: number, b: number): number {
  let x = Math.imul(a ^ 0x5bd1e995, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae3d);
  return (x ^ (x >>> 16)) >>> 0;
}

const cache = new Map<string, Texture>();

/** The labyrinth's decor (`lab_*`), or null if it isn't one of ours. */
export function labDecor(kind: string, variant: number): Texture | null {
  if (kind !== "lab_wall") return null;
  const v = variant % 8;
  const key = `${kind}:${v}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // A block of old stone, edge to edge so the walls join up: a mossy top,
  // a bricked face, roots hanging down; now and then a root that glows.
  const [c, ctx] = canvas(32, 48);
  px(ctx, "rgba(0,0,0,0.28)", 0, 44, 32, 4);
  // The face.
  px(ctx, STONE_D, 0, 18, 32, 27);
  for (let row = 0; row < 3; row++) {
    const y = 19 + row * 9;
    px(ctx, MORTAR, 0, y + 8, 32, 1);
    const off = (row + v) % 2 ? 0 : 8;
    for (let x = off; x < 32; x += 16) px(ctx, MORTAR, x, y, 1, 8);
    for (let x = off + 2; x < 32; x += 16) px(ctx, STONE, x, y + 1, 12, 6);
    px(ctx, STONE_L, (off + 3) % 32, y + 1, 5, 1);
  }
  // The top: moss over stone.
  px(ctx, STONE, 0, 4, 32, 15);
  px(ctx, MOSS_D, 0, 4, 32, 13);
  px(ctx, MOSS, 0, 4, 32, 10);
  for (let i = 0; i < 10; i++) {
    const x = h(i, v) % 30;
    const y = 5 + (h(i, v + 9) % 9);
    px(ctx, i % 3 ? MOSS_L : MOSS_D, x, y, 3, 2);
  }
  // Moss spilling over the edge, and roots hanging down the face.
  for (let x = 0; x < 32; x += 4) px(ctx, MOSS, x + (h(x, v) % 3), 17, 3, 1 + (h(x, v + 3) % 3));
  const roots = 1 + (v % 3);
  for (let i = 0; i < roots; i++) {
    const x = 3 + (h(i, v + 20) % 26);
    const len = 6 + (h(i, v + 21) % 14);
    const glow = v === 5 && i === 0;
    px(ctx, glow ? GLOW_D : ROOT, x, 18, 1, len);
    px(ctx, glow ? GLOW_D : ROOT, x + 1, 18 + Math.floor(len / 2), 1, Math.ceil(len / 2));
    if (glow) {
      px(ctx, GLOW, x, 18 + len - 2, 2, 2);
      px(ctx, GLOW, x - 1, 22, 1, 1);
    }
  }
  // A few glowing toadstools on top of some walls.
  if (v === 2 || v === 7) {
    const x = 6 + (h(v, 1) % 18);
    px(ctx, "#d8f7ff", x + 1, 6, 1, 3);
    px(ctx, GLOW, x, 4, 3, 2);
  }
  const t = texture(c);
  cache.set(key, t);
  return t;
}

/** The labyrinth's objects (the stair, the Glowroot), or null. */
export function labObject(o: MapObject): { texture: Texture; overhang: number; left: number } | null {
  const w = o.w * TILE;
  const hgt = o.h * TILE;
  if (o.kind === "lab_exit") {
    // An arch in the rock with worn steps going up into daylight.
    const top = 36;
    const [c, ctx] = canvas(w, hgt + top);
    px(ctx, STONE_D, 0, 0, w, hgt + top);
    px(ctx, O, 6, 4, w - 12, hgt + top - 4);
    px(ctx, "#fff3c4", 8, 6, w - 16, 10);
    px(ctx, "#f6d98a", 8, 16, w - 16, 8);
    for (let i = 0; i < 6; i++) {
      const y = 24 + i * 7;
      px(ctx, i % 2 ? STONE : STONE_L, 8, y, w - 16, 6);
      px(ctx, MORTAR, 8, y + 6, w - 16, 1);
    }
    // Daylight spilling down the steps.
    ctx.globalAlpha = 0.35;
    polygon(ctx, "#fff3c4", [[10, 8], [w - 10, 8], [w - 4, hgt + top], [4, hgt + top]]);
    ctx.globalAlpha = 1;
    // Moss round the arch.
    for (let x = 0; x < w; x += 3) px(ctx, x % 2 ? MOSS : MOSS_L, x, 0, 3, 3 + (h(x, 7) % 4));
    for (const x of [0, w - 6]) for (let y = 4; y < hgt + top; y += 5) px(ctx, MOSS_D, x + (h(y, x) % 3), y, 3, 3);
    return { texture: texture(c), overhang: top, left: 0 };
  }
  if (o.kind === "lab_heart") {
    // The Glowroot: old roots twisting up in a ring round a pool of light,
    // a shaft of daylight falling through from far above.
    const top = 56;
    const [c, ctx] = canvas(w, hgt + top);
    const cx = w / 2;
    const cy = top + hgt / 2 + 4;
    oval(ctx, "rgba(143,245,228,0.25)", cx, cy, w / 2 - 2, hgt / 2 - 6);
    oval(ctx, "rgba(220,255,248,0.45)", cx, cy, w / 2 - 14, hgt / 2 - 14);
    ctx.globalAlpha = 0.3;
    polygon(ctx, "#fff7d6", [[cx - 10, 0], [cx + 10, 0], [cx + 22, cy], [cx - 22, cy]]);
    ctx.globalAlpha = 1;
    // The roots: thick arcs rising round the pool, glowing along their seams.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const rx = Math.round(cx + Math.cos(a) * (w / 2 - 8));
      const ry = Math.round(cy + Math.sin(a) * (hgt / 2 - 10));
      const rise = 18 + (h(i, 3) % 22);
      for (let k = 0; k < rise; k++) {
        const bend = Math.round(Math.sin(k / 6 + i) * 2);
        px(ctx, O, rx + bend - 2, ry - k, 5, 1);
        px(ctx, ROOT, rx + bend - 1, ry - k, 3, 1);
        if (k % 5 === 2) px(ctx, GLOW, rx + bend, ry - k, 1, 1);
      }
      disc(ctx, GLOW, rx + Math.round(Math.sin(rise / 6 + i) * 2), ry - rise, 2);
    }
    // Motes rising in the light.
    for (let i = 0; i < 9; i++) px(ctx, i % 2 ? "#ffffff" : GLOW, cx - 14 + (h(i, 11) % 28), 10 + (h(i, 12) % (cy - 16)), 1, 1);
    return { texture: texture(c), overhang: top, left: 0 };
  }
  return null;
}

/** A sleeping lantern on its stone post: dark, or lit. */
export function lanternTexture(lit: boolean): Texture {
  const key = `lantern:${lit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(32, 60);
  px(ctx, "rgba(0,0,0,0.3)", 7, 56, 18, 3);
  // The post.
  px(ctx, O, 11, 30, 10, 27);
  px(ctx, STONE, 12, 31, 8, 25);
  px(ctx, STONE_L, 12, 31, 2, 25);
  px(ctx, MOSS, 11, 50, 10, 3);
  px(ctx, MOSS_L, 13, 49, 3, 1);
  // The lantern: iron cap, glass, base.
  polygon(ctx, O, [[7, 12], [16, 3], [25, 12]]);
  polygon(ctx, "#3b3646", [[9, 11], [16, 5], [23, 11]]);
  px(ctx, O, 8, 12, 16, 18);
  px(ctx, lit ? "#ffd36b" : "#2a3140", 10, 13, 12, 14);
  if (lit) {
    px(ctx, "#fff4c2", 13, 16, 6, 8);
    px(ctx, "#ffffff", 15, 18, 2, 4);
  } else {
    px(ctx, "#3a4458", 11, 14, 3, 6);
  }
  px(ctx, O, 15, 13, 2, 14);
  px(ctx, "#3b3646", 7, 27, 18, 3);
  const t = texture(c);
  cache.set(key, t);
  return t;
}

/** A lost glimmer: a little four-pointed star of light. */
export function glimmerTexture(): Texture {
  const hit = cache.get("glimmer");
  if (hit) return hit;
  const [c, ctx] = canvas(15, 15);
  px(ctx, "rgba(255,247,200,0.55)", 7, 0, 1, 15);
  px(ctx, "rgba(255,247,200,0.55)", 0, 7, 15, 1);
  px(ctx, "#fff3b0", 7, 2, 1, 11);
  px(ctx, "#fff3b0", 2, 7, 11, 1);
  px(ctx, "#ffe680", 6, 5, 3, 5);
  px(ctx, "#ffe680", 5, 6, 5, 3);
  px(ctx, "#ffffff", 6, 6, 3, 3);
  const t = texture(c);
  cache.set("glimmer", t);
  return t;
}

/** The heartstones' colours: rose, amber, violet. */
export const HEARTSTONE_TINTS = [0xff8fb8, 0xffc35a, 0xb48cff];
const HEARTSTONE_CSS = [
  ["#ff8fb8", "#c2577f", "#ffe0ec"],
  ["#ffc35a", "#b9822a", "#fff0c9"],
  ["#b48cff", "#7a55c4", "#ece2ff"],
];

/** A heartstone: a crystal on an old pedestal, dim till you're attuned to it. */
export function heartstoneTexture(i: number, attuned: boolean): Texture {
  const key = `heartstone:${i}:${attuned}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [light, dark, shine] = HEARTSTONE_CSS[i % 3];
  const [c, ctx] = canvas(32, 64);
  px(ctx, "rgba(0,0,0,0.3)", 5, 59, 22, 3);
  // The pedestal.
  px(ctx, O, 7, 42, 18, 18);
  px(ctx, STONE, 8, 43, 16, 16);
  px(ctx, STONE_L, 8, 43, 16, 2);
  px(ctx, MOSS, 7, 55, 18, 3);
  px(ctx, MOSS_L, 10, 54, 4, 1);
  // The crystal.
  ctx.globalAlpha = attuned ? 1 : 0.7;
  polygon(ctx, O, [[16, 4], [26, 22], [16, 44], [6, 22]]);
  polygon(ctx, dark, [[16, 6], [24, 22], [16, 42], [8, 22]]);
  polygon(ctx, light, [[16, 6], [20, 22], [16, 42], [11, 22]]);
  ctx.globalAlpha = 1;
  px(ctx, attuned ? "#ffffff" : shine, 14, 12, 2, 8);
  if (attuned) px(ctx, shine, 17, 24, 2, 6);
  const t = texture(c);
  cache.set(key, t);
  return t;
}

/** A gate, one tile of it: thick roots woven shut (a root gate), or carved stone with runes (the Great Gate); open, they're drawn back. */
export function gateTexture(great: boolean, open: boolean): Texture {
  const key = `gate:${great}:${open}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(32, 48);
  if (great) {
    // Carved stone posts either side; the door between, with glowing runes.
    px(ctx, O, 0, 2, 32, 46);
    px(ctx, STONE_D, 1, 3, 30, 44);
    px(ctx, STONE_L, 1, 3, 30, 3);
    if (!open) {
      px(ctx, "#2d3140", 3, 8, 26, 38);
      for (let y = 12; y < 44; y += 8) {
        px(ctx, GLOW_D, 9, y, 3, 1);
        px(ctx, GLOW, 15, y + 2, 2, 3);
        px(ctx, GLOW_D, 20, y, 3, 1);
      }
      px(ctx, MORTAR, 15, 8, 1, 38);
    } else {
      px(ctx, "#0e0c14", 3, 8, 26, 38);
      px(ctx, GLOW, 3, 8, 26, 1);
    }
  } else if (!open) {
    // Roots woven across the way.
    px(ctx, "rgba(0,0,0,0.25)", 0, 44, 32, 4);
    for (let i = 0; i < 7; i++) {
      const x = 1 + i * 4 + (h(i, 3) % 2);
      px(ctx, O, x, 4, 4, 42);
      px(ctx, i % 2 ? ROOT : "#7d5d43", x + 1, 4, 2, 42);
    }
    for (let y = 10; y < 44; y += 9) {
      px(ctx, O, 0, y, 32, 3);
      px(ctx, "#8a6a4c", 0, y + 1, 32, 1);
    }
    px(ctx, GLOW_D, 6, 20, 1, 1);
    px(ctx, GLOW, 24, 33, 1, 1);
    for (let x = 0; x < 32; x += 5) px(ctx, MOSS, x, 4, 4, 2);
  } else {
    // Drawn back: stubs either side.
    for (const x of [0, 28]) {
      px(ctx, O, x, 30, 4, 16);
      px(ctx, ROOT, x + 1, 30, 2, 16);
    }
  }
  const t = texture(c);
  cache.set(key, t);
  return t;
}

/** A rune stone set in the floor: lights up while it's doing its work. */
export function stoneTexture(twin: boolean, glowing: boolean): Texture {
  const key = `stone:${twin}:${glowing}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(32, 32);
  oval(ctx, O, 16, 17, 13, 10);
  oval(ctx, STONE_D, 16, 17, 12, 9);
  oval(ctx, STONE, 16, 16, 11, 8);
  const rune = glowing ? GLOW : twin ? "#a7a0c8" : "#8fa8a0";
  // A single rune for a timed stone; two linked circles for a twin.
  if (twin) {
    disc(ctx, rune, 12, 16, 3);
    disc(ctx, rune, 20, 16, 3);
    disc(ctx, STONE, 12, 16, 1);
    disc(ctx, STONE, 20, 16, 1);
  } else {
    px(ctx, rune, 15, 11, 2, 10);
    px(ctx, rune, 11, 14, 10, 2);
    px(ctx, rune, 12, 19, 8, 1);
  }
  const t = texture(c);
  cache.set(key, t);
  return t;
}

/** A wisp: a pale flame of light with a little tail. */
export function wispTexture(): Texture {
  const hit = cache.get("wisp");
  if (hit) return hit;
  const [c, ctx] = canvas(16, 22);
  disc(ctx, "rgba(190,240,255,0.45)", 8, 13, 7);
  disc(ctx, "#bdf3ff", 8, 13, 5);
  disc(ctx, "#ffffff", 8, 13, 3);
  polygon(ctx, "#bdf3ff", [[4, 11], [8, 1], [12, 11]]);
  px(ctx, "#1d2a3a", 6, 12, 1, 2);
  px(ctx, "#1d2a3a", 10, 12, 1, 2);
  const t = texture(c);
  cache.set("wisp", t);
  return t;
}
