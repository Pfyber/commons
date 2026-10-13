// Procedural placeholder pixel art (spec §16: warm, simple, 32×32 tiles,
// soft outlines). Drawn once into canvases and turned into nearest-filtered
// textures; replaced by real atlases from assets/ when they exist.

import { Texture } from "pixi.js";
import type { MapObject } from "./map";
import { disc, oval, polygon } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";
import { decodeLook } from "./look";

export const TILE = 32;

/** Y of the big screen's frame inside its object texture (which starts 64px above the footprint). */
export const SCREEN_FACE_TOP = 52;

export const PALETTE = {
  grass: "#86b86b",
  grassDark: "#76a85d",
  grassSpeck: "#9fcb7f",
  path: "#dcc69b",
  pathEdge: "#c8ae80",
  plaza: "#d3c6b4",
  plazaLine: "#bfb09b",
  water: "#5ea9c8",
  waterDeep: "#4f97b8",
  foam: "#bfe3ee",
  sand: "#ead9a6",
  soil: "#8b6a4b",
  soilLine: "#755639",
  bridge: "#a97b50",
  bridgeLine: "#8c6240",
  fog: "#e3e9e6",
  floor: "#b78c62",
  outline: "#3b3a2e",
  trunk: "#7a5532",
  leaf: "#5f9a48",
  leafLight: "#7dbb5c",
  pine: "#3f7a4a",
  pineLight: "#579463",
  wood: "#b07d4f",
  woodDark: "#8a5d36",
  stone: "#a9a69c",
  stoneDark: "#8b887e",
  lampGlow: "#ffe39a",
  pitch: "#79b25e",
  pitchStripe: "#86bf69",
  chalk: "#f4f6ee",
};

/** Accent colours of the topic corners (boards, flags). */
export const QUARTER_COLORS: Record<string, string> = {
  sports: "#4f8fd6",
  art: "#d6609a",
  music: "#9b6fd4",
  games: "#e0943a",
};

export function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(salt, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export function toTexture(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  return t;
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// Hard-edged circles (see pixeldraw.ts).
const circle = disc;

// ---- ground ---------------------------------------------------------------

type GroundAt = (x: number, y: number) => string | null;

/** Draws one ground tile at canvas offset (ox, oy); `at` looks up neighbours for edges. */
export function drawGround(ctx: CanvasRenderingContext2D, kind: string, tx: number, ty: number, ox: number, oy: number, at: GroundAt) {
  const P = PALETTE;
  const h = hash(tx, ty, 11);
  const base: Record<string, string> = {
    grass: P.grass,
    grass_dark: P.grassDark,
    path: P.path,
    plaza: P.plaza,
    water: P.water,
    sand: P.sand,
    soil: P.soil,
    flowers: P.grass,
    bridge: P.bridge,
    fog: P.fog,
    floor: P.floor,
    pitch: P.pitch,
  };
  px(ctx, base[kind] ?? P.grass, ox, oy, TILE, TILE);
  const differs = (dx: number, dy: number) => {
    const n = at(tx + dx, ty + dy);
    return n !== null && n !== kind && !(kind.startsWith("grass") && n.startsWith("grass"));
  };

  switch (kind) {
    case "grass":
    case "grass_dark":
    case "flowers":
      for (let i = 0; i < 5; i++) {
        const s = hash(tx, ty, i);
        px(ctx, P.grassSpeck, ox + (s % 30), oy + ((s >>> 8) % 29), 1, 3);
      }
      if (kind === "flowers") {
        const colors = ["#f4a7b9", "#ffe08a", "#ffffff", "#c9a7f4"];
        for (let i = 0; i < 6; i++) {
          const s = hash(tx, ty, 50 + i);
          const fx = ox + 3 + (s % 26);
          const fy = oy + 3 + ((s >>> 8) % 26);
          px(ctx, colors[(s >>> 16) % colors.length], fx, fy, 3, 3);
          px(ctx, "#f7d35c", fx + 1, fy + 1);
        }
      }
      break;
    case "path":
      for (let i = 0; i < 4; i++) {
        const s = hash(tx, ty, 20 + i);
        px(ctx, P.pathEdge, ox + (s % 29), oy + ((s >>> 8) % 29), 2, 2);
      }
      if (differs(0, -1)) px(ctx, P.pathEdge, ox, oy, TILE, 2);
      if (differs(0, 1)) px(ctx, P.pathEdge, ox, oy + TILE - 2, TILE, 2);
      if (differs(-1, 0)) px(ctx, P.pathEdge, ox, oy, 2, TILE);
      if (differs(1, 0)) px(ctx, P.pathEdge, ox + TILE - 2, oy, 2, TILE);
      break;
    case "plaza":
      px(ctx, P.plazaLine, ox, oy + 15, TILE, 1);
      px(ctx, P.plazaLine, ox + (ty % 2 ? 8 : 24), oy, 1, 15);
      px(ctx, P.plazaLine, ox + (ty % 2 ? 24 : 8), oy + 16, 1, 16);
      break;
    case "water": {
      if ((h & 3) === 0) px(ctx, P.waterDeep, ox + 6 + (h % 14), oy + 10 + ((h >>> 4) % 12), 8, 1);
      px(ctx, P.foam, ox + 4 + ((h >>> 8) % 20), oy + 4 + ((h >>> 12) % 20), 4, 1);
      if (differs(0, -1)) px(ctx, P.foam, ox, oy, TILE, 3);
      if (differs(-1, 0)) px(ctx, P.foam, ox, oy, 2, TILE);
      if (differs(1, 0)) px(ctx, P.foam, ox + TILE - 2, oy, 2, TILE);
      if (differs(0, 1)) px(ctx, P.foam, ox, oy + TILE - 2, TILE, 2);
      break;
    }
    case "sand":
      for (let i = 0; i < 4; i++) {
        const s = hash(tx, ty, 30 + i);
        px(ctx, "#d8c48f", ox + (s % 30), oy + ((s >>> 8) % 30), 2, 1);
      }
      break;
    case "soil":
      for (let r = 4; r < TILE; r += 8) px(ctx, P.soilLine, ox + 2, oy + r, TILE - 4, 2);
      break;
    case "bridge":
      for (let c = 0; c < TILE; c += 8) px(ctx, P.bridgeLine, ox + c, oy, 1, TILE);
      if (differs(0, -1)) px(ctx, P.woodDark, ox, oy, TILE, 3);
      if (differs(0, 1)) px(ctx, P.woodDark, ox, oy + TILE - 3, TILE, 3);
      break;
    case "fog":
      for (let i = 0; i < 3; i++) {
        const s = hash(tx, ty, 40 + i);
        circle(ctx, "rgba(255,255,255,0.55)", ox + (s % 32), oy + ((s >>> 8) % 32), 6 + (s % 8));
      }
      break;
    case "floor":
      for (let r = 0; r < TILE; r += 8) px(ctx, P.woodDark, ox, oy + r, TILE, 1);
      break;
    case "stones": {
      // Stepping stones: flat round stones over the water.
      px(ctx, P.water, ox, oy, TILE, TILE);
      px(ctx, P.foam, ox + 4 + (h % 20), oy + 4 + ((h >>> 8) % 6), 4, 1);
      const sx = ox + 9 + (h % 5);
      const sy = oy + 10 + ((h >>> 4) % 6);
      oval(ctx, "rgba(0,0,0,0.18)", sx + 7, sy + 10, 10, 5);
      oval(ctx, P.outline, sx + 7, sy + 7, 10, 6);
      oval(ctx, "#b9b4a2", sx + 7, sy + 6, 9, 5);
      px(ctx, "#d6d1bf", sx + 2, sy + 3, 6, 2);
      break;
    }
    case "pitch":
      // Mown stripes, chalk lines round the edge.
      if (tx % 2) px(ctx, P.pitchStripe, ox, oy, TILE, TILE);
      if (differs(0, -1)) px(ctx, P.chalk, ox, oy + 2, TILE, 2);
      if (differs(0, 1)) px(ctx, P.chalk, ox, oy + TILE - 4, TILE, 2);
      if (differs(-1, 0)) px(ctx, P.chalk, ox + 2, oy, 2, TILE);
      if (differs(1, 0)) px(ctx, P.chalk, ox + TILE - 4, oy, 2, TILE);
      break;
  }
}

/** Renders a chunk of ground tiles into its own canvas texture. */
export function bakeChunk(x0: number, y0: number, w: number, h: number, at: GroundAt): Texture {
  const [c, ctx] = makeCanvas(w * TILE, h * TILE);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const kind = at(x0 + x, y0 + y);
      if (kind) drawGround(ctx, kind, x0 + x, y0 + y, x * TILE, y * TILE, at);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const kind = at(x0 + x, y0 + y);
      if (kind) soften(ctx, kind, x0 + x, y0 + y, x * TILE, y * TILE, at);
    }
  }
  return toTexture(c);
}

/** Ground that paths and water round off into, and blend over. */
const SOFT = new Set(["grass", "grass_dark", "flowers", "sand"]);
/** Ground whose outer corners are rounded. */
const ROUNDED = new Set(["path", "water", "sand", "flowers", "grass_dark"]);
const CORNER = 9;

function groundColor(kind: string): string {
  const P = PALETTE;
  return (
    { grass: P.grass, grass_dark: P.grassDark, flowers: P.grass, sand: P.sand, path: P.path, water: P.water } as Record<string, string>
  )[kind] ?? P.grass;
}

/**
 * Second pass over a baked chunk: rounds the outer corners of paths, water,
 * sand and dark grass where both sides open onto softer ground, and dithers
 * the seam between light and dark grass, so diagonal edges read as curves
 * instead of staircases.
 */
function soften(ctx: CanvasRenderingContext2D, kind: string, tx: number, ty: number, ox: number, oy: number, at: GroundAt) {
  const P = PALETTE;
  if (ROUNDED.has(kind)) {
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const a = at(tx + sx, ty);
      const b = at(tx, ty + sy);
      const d = at(tx + sx, ty + sy);
      if (!a || !b || a !== b || a === kind || !SOFT.has(a) || d === kind) continue;
      if (kind === "grass_dark" && a !== "grass") continue;
      const fill = groundColor(a);
      const edge = kind === "path" ? P.pathEdge : kind === "water" ? P.foam : null;
      for (let i = 0; i < CORNER; i++) {
        const len = CORNER - i;
        const x = sx < 0 ? ox : ox + TILE - len;
        const y = sy < 0 ? oy + i : oy + TILE - 1 - i;
        px(ctx, fill, x, y, len, 1);
        if (edge) px(ctx, edge, sx < 0 ? ox + len : ox + TILE - len - 2, y, 2, 1);
      }
    }
  }
  // Dither light grass into dark grass along their seam.
  if (kind === "grass") {
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      if (at(tx + dx, ty + dy) !== "grass_dark") continue;
      for (let i = 0; i < 14; i++) {
        const hh = hash(tx * 4 + dx + 7, ty * 4 + dy + 7, i);
        const along = hh % TILE;
        const depth = Math.floor(((hh >>> 8) % 100) ** 2 / 1700); // mostly near the edge
        const x = dx === 0 ? along : dx < 0 ? depth : TILE - 1 - depth;
        const y = dy === 0 ? along : dy < 0 ? depth : TILE - 1 - depth;
        px(ctx, P.grassDark, ox + x - (x % 2), oy + y - (y % 2), 2, 2);
      }
    }
  }
}

// ---- decor (single-tile props, anchored at bottom centre) -----------------

const decorCache = new Map<string, Texture>();

export function decorTexture(kind: string, variant: number): Texture | null {
  const key = `${kind}:${variant % 3}`;
  const cached = decorCache.get(key);
  if (cached) return cached;
  const P = PALETTE;
  let c: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  const v = variant % 3;
  switch (kind) {
    case "tree": {
      [c, ctx] = makeCanvas(40, 56);
      px(ctx, "rgba(0,0,0,0.18)", 8, 50, 24, 4);
      px(ctx, P.outline, 17, 34, 7, 18);
      px(ctx, P.trunk, 18, 34, 5, 17);
      const leaf = [P.leaf, "#6aa24e", "#58913f"][v];
      circle(ctx, P.outline, 20, 22, 17);
      circle(ctx, leaf, 20, 22, 16);
      circle(ctx, P.leafLight, 14, 16, 7);
      circle(ctx, leaf, 26, 28, 7);
      px(ctx, P.leafLight, 24, 12, 3, 3);
      break;
    }
    case "pine": {
      [c, ctx] = makeCanvas(36, 60);
      px(ctx, "rgba(0,0,0,0.18)", 8, 54, 20, 4);
      px(ctx, P.trunk, 16, 46, 4, 10);
      for (let i = 0; i < 3; i++) {
        const top = 4 + i * 13;
        const half = 8 + i * 4;
        polygon(ctx, i % 2 ? P.pine : P.pineLight, [
          [18, top],
          [18 + half, top + 20],
          [18 - half, top + 20],
        ]);
      }
      break;
    }
    case "pine_secret": {
      // Looks just like a pine. Almost.
      [c, ctx] = makeCanvas(36, 60);
      px(ctx, "rgba(0,0,0,0.18)", 8, 54, 20, 4);
      px(ctx, P.trunk, 16, 46, 4, 10);
      for (let i = 0; i < 3; i++) {
        const top = 4 + i * 13;
        const half = 8 + i * 4;
        polygon(ctx, i % 2 ? P.pine : P.pineLight, [
          [18, top],
          [18 + half, top + 20],
          [18 - half, top + 20],
        ]);
      }
      px(ctx, "#fff6d0", 22, 30, 1, 1);
      break;
    }
    case "willow":
    case "willow_curtain": {
      // A weeping willow: a round crown and long hanging strands. The
      // curtain is a gap between two willows, all strands.
      [c, ctx] = makeCanvas(40, 60);
      const curtain = kind === "willow_curtain";
      const leaf = ["#9cc46e", "#a8cc74", "#93bd66"][v];
      if (!curtain) {
        px(ctx, "rgba(0,0,0,0.18)", 4, 54, 32, 4);
        px(ctx, P.outline, 18, 26, 5, 30);
        px(ctx, P.trunk, 19, 26, 3, 29);
        oval(ctx, P.outline, 20, 14, 19, 12);
        oval(ctx, leaf, 20, 14, 18, 11);
        oval(ctx, "#c3e08f", 14, 9, 7, 4);
      }
      // Long hanging strands, almost to the ground.
      for (let i = 0; i < 10; i++) {
        const sx = 2 + i * 4;
        const top = curtain ? 0 : 14 + (Math.abs(4.5 - i) | 0);
        const len = curtain ? 50 + ((i * 7 + v) % 8) : 36 + ((i * 5 + v) % 6) - (Math.abs(4.5 - i) | 0);
        px(ctx, P.outline, sx - 1, top, 1, len);
        px(ctx, curtain ? "#b2d685" : leaf, sx, top, 2, len);
        px(ctx, "#c3e08f", sx, top + len - 4, 2, 4);
      }
      break;
    }
    case "log_seat": {
      // A log lying on its side, worn smooth from sitting.
      [c, ctx] = makeCanvas(32, 22);
      px(ctx, "rgba(0,0,0,0.18)", 3, 17, 26, 4);
      px(ctx, P.outline, 2, 6, 28, 13);
      px(ctx, P.trunk, 3, 7, 26, 11);
      px(ctx, "#9a6e45", 3, 7, 26, 3);
      oval(ctx, P.outline, 28, 12, 4, 6);
      oval(ctx, "#d9b27c", 28, 12, 3, 5);
      px(ctx, "#b5844f", 27, 11, 2, 2);
      break;
    }
    case "bush": {
      [c, ctx] = makeCanvas(32, 26);
      px(ctx, "rgba(0,0,0,0.15)", 5, 22, 22, 3);
      circle(ctx, P.outline, 16, 14, 11);
      circle(ctx, ["#6fae55", "#5f9e4b", "#7cb860"][v], 16, 14, 10);
      circle(ctx, P.leafLight, 12, 10, 4);
      if (v === 1) [8, 20, 15].forEach((x, i) => px(ctx, "#e86f6f", x, 12 + i * 3, 2, 2));
      break;
    }
    // A bench, or one end/the middle of a longer bench joined across tiles.
    case "bench":
    case "bench_left":
    case "bench_right":
    case "bench_mid": {
      [c, ctx] = makeCanvas(32, 24);
      const openL = kind === "bench_right" || kind === "bench_mid";
      const openR = kind === "bench_left" || kind === "bench_mid";
      const x0 = openL ? 0 : 3;
      const x1 = openR ? 32 : 29;
      px(ctx, P.outline, x0, 6, x1 - x0, 12);
      px(ctx, P.wood, x0 + (openL ? 0 : 1), 7, x1 - x0 - (openL ? 0 : 1) - (openR ? 0 : 1), 3);
      px(ctx, P.wood, x0 + (openL ? 0 : 1), 11, x1 - x0 - (openL ? 0 : 1) - (openR ? 0 : 1), 3);
      px(ctx, P.woodDark, x0 + (openL ? 0 : 1), 15, x1 - x0 - (openL ? 0 : 1) - (openR ? 0 : 1), 2);
      if (!openL) px(ctx, P.outline, 6, 17, 2, 6);
      if (!openR) px(ctx, P.outline, 24, 17, 2, 6);
      break;
    }
    case "lamp": {
      [c, ctx] = makeCanvas(32, 56);
      circle(ctx, "rgba(255,227,154,0.25)", 16, 10, 12);
      px(ctx, P.outline, 15, 12, 3, 42);
      px(ctx, P.outline, 11, 52, 11, 3);
      px(ctx, P.outline, 11, 4, 11, 10);
      px(ctx, P.lampGlow, 12, 5, 9, 8);
      break;
    }
    case "chess_table": {
      [c, ctx] = makeCanvas(32, 28);
      px(ctx, P.outline, 3, 4, 26, 14);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 6; x++) px(ctx, (x + y) % 2 ? "#3d3b35" : "#efe6d2", 4 + x * 4, 5 + y * 3, 4, 3);
      px(ctx, P.woodDark, 13, 18, 6, 9);
      break;
    }
    case "rock": {
      [c, ctx] = makeCanvas(32, 22);
      circle(ctx, P.outline, 16, 13, 9);
      circle(ctx, P.stone, 16, 13, 8);
      px(ctx, "#c4c1b6", 11, 8, 5, 2);
      px(ctx, P.stoneDark, 12, 17, 10, 2);
      break;
    }
    case "reeds": {
      [c, ctx] = makeCanvas(32, 30);
      for (let i = 0; i < 5; i++) {
        const x = 8 + i * 4;
        px(ctx, "#5c8d3f", x, 8 + (i % 2) * 4, 1, 22 - (i % 2) * 4);
        if (i % 2 === 0) px(ctx, "#7a5532", x - 1, 6 + (i % 3) * 2, 3, 5);
      }
      break;
    }
    case "fence": {
      [c, ctx] = makeCanvas(32, 22);
      px(ctx, P.woodDark, 0, 8, 32, 3);
      px(ctx, P.woodDark, 0, 14, 32, 3);
      px(ctx, P.wood, 4, 4, 4, 17);
      px(ctx, P.wood, 22, 4, 4, 17);
      break;
    }
    case "wall": {
      [c, ctx] = makeCanvas(32, 48);
      px(ctx, P.outline, 0, 4, 32, 44);
      px(ctx, "#e9dcc3", 1, 5, 30, 34);
      px(ctx, "#cdbb9c", 1, 39, 30, 8);
      for (let y = 10; y < 38; y += 8) px(ctx, "#ddcdb0", 1, y, 30, 1);
      px(ctx, "#b5544a", 0, 0, 32, 6);
      break;
    }
    case "hedge": {
      // Clipped hedge: fills the tile edge to edge so neighbours join up.
      [c, ctx] = makeCanvas(32, 44);
      px(ctx, "rgba(0,0,0,0.18)", 0, 40, 32, 4);
      px(ctx, "#2f5e34", 0, 4, 32, 38);
      px(ctx, "#3f7a4a", 0, 2, 32, 34);
      px(ctx, "#4c8a55", 0, 2, 32, 4);
      for (let i = 0; i < 9; i++) {
        const sx = (hash(i, v, 77) % 28) + 1;
        const sy = (hash(i, v, 78) % 28) + 6;
        px(ctx, i % 2 ? "#579463" : "#2f5e34", sx, sy, 3, 2);
      }
      break;
    }
    case "apple_tree": {
      [c, ctx] = makeCanvas(40, 56);
      px(ctx, "rgba(0,0,0,0.18)", 8, 50, 24, 4);
      px(ctx, P.outline, 17, 34, 7, 18);
      px(ctx, P.trunk, 18, 34, 5, 17);
      circle(ctx, P.outline, 20, 22, 16);
      circle(ctx, "#6aa24e", 20, 22, 15);
      circle(ctx, P.leafLight, 14, 16, 6);
      for (const [ax, ay] of [[10, 22], [27, 17], [22, 29], [15, 30], [29, 26], [19, 12]]) {
        px(ctx, "#d94a4a", ax, ay, 3, 3);
        px(ctx, "#ff8a7a", ax, ay, 1, 1);
      }
      break;
    }
    case "stump": {
      [c, ctx] = makeCanvas(32, 22);
      px(ctx, "rgba(0,0,0,0.15)", 6, 18, 20, 3);
      px(ctx, P.outline, 7, 6, 18, 14);
      px(ctx, P.trunk, 8, 9, 16, 10);
      oval(ctx, P.outline, 16, 7, 9, 4);
      oval(ctx, "#c99a6a", 16, 7, 8, 3);
      oval(ctx, "#a97b50", 16, 7, 4, 1.5);
      break;
    }
    case "log": {
      [c, ctx] = makeCanvas(32, 18);
      px(ctx, "rgba(0,0,0,0.15)", 2, 14, 28, 3);
      px(ctx, P.outline, 4, 4, 24, 11);
      px(ctx, P.trunk, 4, 5, 23, 9);
      px(ctx, "#8b6a4b", 6, 7, 18, 1);
      oval(ctx, P.outline, 27, 9.5, 4, 5.5);
      oval(ctx, "#c99a6a", 27, 9.5, 3, 4.5);
      px(ctx, P.leaf, 10, 3, 4, 2);
      break;
    }
    case "mushrooms": {
      [c, ctx] = makeCanvas(32, 16);
      for (const [mx, my, r] of [[9, 9, 4], [18, 11, 3], [24, 8, 3.5]] as [number, number, number][]) {
        px(ctx, "#efe3cf", mx - 1, my, 2, 5);
        oval(ctx, P.outline, mx, my, r + 1, r * 0.7 + 1);
        oval(ctx, "#d94a4a", mx, my, r, r * 0.7);
        px(ctx, "#fff", mx - 1, my - 1, 1, 1);
        px(ctx, "#fff", mx + 1, my, 1, 1);
      }
      break;
    }
    case "tallgrass": {
      [c, ctx] = makeCanvas(32, 24);
      const greens = ["#6aa24e", "#7dbb5c", "#5f9a48"];
      for (let i = 0; i < 9; i++) {
        const bx = 2 + i * 3 + (hash(i, v, 5) % 2);
        const bh = 10 + (hash(i, v, 6) % 12);
        px(ctx, greens[(i + v) % 3], bx, 24 - bh, 2, bh);
        px(ctx, P.leafLight, bx, 24 - bh, 1, 2);
      }
      break;
    }
    case "lilypad": {
      [c, ctx] = makeCanvas(32, 20);
      oval(ctx, "#3f7a4a", 15, 11, 9, 6);
      oval(ctx, "#5f9a48", 15, 10, 8, 5);
      polygon(ctx, P.water, [[15, 10], [23, 7], [24, 12]]);
      if (v === 0) {
        px(ctx, "#f4a7b9", 10, 6, 4, 3);
        px(ctx, "#fff", 11, 5, 2, 2);
      }
      break;
    }
    case "blanket": {
      // A checked picnic blanket (flat, drawn under people).
      [c, ctx] = makeCanvas(32, 22);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 8; x++) px(ctx, (x + y) % 2 ? "#e8566b" : "#fff6ec", x * 4, 4 + y * 4, 4, 4);
      }
      px(ctx, "rgba(0,0,0,0.12)", 0, 20, 32, 2);
      break;
    }
    case "swing": {
      // A rope swing hanging from the Old Oak's branch above.
      [c, ctx] = makeCanvas(32, 128);
      px(ctx, "#8b6a4b", 7, 0, 1, 116);
      px(ctx, "#8b6a4b", 24, 0, 1, 116);
      px(ctx, P.outline, 4, 115, 24, 6);
      px(ctx, P.wood, 5, 116, 22, 3);
      px(ctx, "rgba(0,0,0,0.15)", 6, 124, 20, 3);
      break;
    }
    case "lantern": {
      [c, ctx] = makeCanvas(16, 40);
      px(ctx, P.outline, 7, 12, 2, 28);
      px(ctx, P.outline, 3, 2, 10, 12);
      px(ctx, P.lampGlow, 4, 3, 8, 10);
      px(ctx, "#fff6d0", 6, 5, 4, 5);
      px(ctx, P.outline, 2, 0, 12, 3);
      break;
    }
    case "wildflowers": {
      [c, ctx] = makeCanvas(32, 16);
      const colors = ["#f4a7b9", "#ffe08a", "#ffffff", "#c9a7f4", "#f28c6b"];
      for (let i = 0; i < 7; i++) {
        const fx = 2 + ((i * 9 + v * 5) % 28);
        const fy = 4 + ((i * 5 + v * 3) % 9);
        px(ctx, "#5f9a48", fx + 1, fy + 2, 1, 4);
        px(ctx, colors[(i + v) % colors.length], fx, fy, 3, 3);
      }
      break;
    }
    case "sign": {
      [c, ctx] = makeCanvas(32, 36);
      px(ctx, P.trunk, 14, 16, 4, 20);
      px(ctx, P.outline, 4, 4, 24, 14);
      px(ctx, P.wood, 5, 5, 22, 12);
      break;
    }
    default:
      return null;
  }
  const t = toTexture(c);
  decorCache.set(key, t);
  return t;
}

// ---- multi-tile objects ----------------------------------------------------

function label(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, color = "#3b3a2e", size = 12) {
  if (canPixel(text)) {
    let scale = Math.max(1, Math.round(size / 7));
    while (scale > 1 && pixelWidth(text, scale) > ctx.canvas.width - 4) scale--;
    drawPixelText(ctx, text, cx - pixelWidth(text, scale) / 2, y - (5 * scale) / 2, color, scale);
    return;
  }
  ctx.font = `bold ${size}px ui-rounded, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, cx, y);
}

/** Texture for a map object plus how far it extends above its footprint. */
export function objectTexture(o: MapObject): { texture: Texture; overhang: number } {
  const P = PALETTE;
  const w = o.w * TILE;
  const h = o.h * TILE;
  let overhang = 0;
  let c: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  switch (o.kind) {
    case "fountain": {
      [c, ctx] = makeCanvas(w, h + 24);
      overhang = 24;
      const cx = w / 2;
      const cy = 24 + h / 2;
      circle(ctx, P.outline, cx, cy, w / 2 - 1);
      circle(ctx, P.stone, cx, cy, w / 2 - 3);
      circle(ctx, P.water, cx, cy, w / 2 - 10);
      circle(ctx, P.foam, cx - 8, cy - 6, 3);
      px(ctx, P.stoneDark, cx - 5, cy - 30, 10, 30);
      circle(ctx, P.stone, cx, cy - 30, 9);
      circle(ctx, P.foam, cx, cy - 34, 5);
      for (let i = -2; i <= 2; i++) px(ctx, "rgba(191,227,238,0.8)", cx + i * 6, cy - 26 + Math.abs(i) * 5, 2, 10);
      break;
    }
    case "big_screen": {
      // The face sits low on short legs so it's in view from the lawn in front.
      [c, ctx] = makeCanvas(w, h + 64);
      overhang = 64;
      const top = SCREEN_FACE_TOP;
      const legTop = top + 76;
      px(ctx, P.outline, 40, legTop, 8, h + 64 - legTop);
      px(ctx, P.outline, w - 48, legTop, 8, h + 64 - legTop);
      px(ctx, P.outline, 8, top, w - 16, 76);
      px(ctx, "#2d3540", 12, top + 4, w - 24, 68);
      const grad = ctx.createLinearGradient(0, top + 4, 0, top + 72);
      grad.addColorStop(0, "#3d5a73");
      grad.addColorStop(1, "#24313c");
      ctx.fillStyle = grad;
      ctx.fillRect(14, top + 6, w - 28, 64);
      label(ctx, "Big Screen", w / 2, top + 38, "#cfe3f0", 16);
      break;
    }
    case "town_hall": {
      [c, ctx] = makeCanvas(w, h + 56);
      overhang = 56;
      const top = 56;
      px(ctx, "rgba(0,0,0,0.15)", 6, h + top - 8, w - 12, 8);
      px(ctx, P.outline, 8, top - 4, w - 16, h - 4);
      px(ctx, "#efe3cf", 10, top - 2, w - 20, h - 8);
      polygon(ctx, "#b5544a", [
        [0, top + 4],
        [w / 2, 0],
        [w, top + 4],
      ]);
      ctx.fillStyle = "#99443b";
      ctx.fillRect(0, top, w, 8);
      circle(ctx, "#efe3cf", w / 2, 30, 12);
      circle(ctx, P.outline, w / 2, 30, 9);
      circle(ctx, "#fff9ec", w / 2, 30, 8);
      px(ctx, P.outline, w / 2, 24, 1, 6);
      px(ctx, P.outline, w / 2, 30, 5, 1);
      for (let i = 0; i < 4; i++) {
        const x = 30 + i * ((w - 60) / 3) - 12;
        if (Math.abs(x + 12 - w / 2) < 40) continue;
        px(ctx, P.outline, x, top + 40, 24, 36);
        px(ctx, "#9fc9dc", x + 2, top + 42, 20, 32);
      }
      px(ctx, P.outline, w / 2 - 22, top + h - 74, 44, 66);
      px(ctx, P.woodDark, w / 2 - 20, top + h - 72, 40, 64);
      px(ctx, P.outline, w / 2 - 70, top + 14, 140, 22);
      px(ctx, "#f6efe1", w / 2 - 68, top + 16, 136, 18);
      label(ctx, o.label ?? "Town Hall", w / 2, top + 25, "#5a3b2b", 14);
      break;
    }
    case "homes_gate": {
      [c, ctx] = makeCanvas(w, h + 16);
      overhang = 16;
      px(ctx, P.outline, 4, 0, 14, h + 16);
      px(ctx, P.wood, 6, 2, 10, h + 12);
      label(ctx, "🏡", w / 2, h / 2 + 16, "#000", 20);
      break;
    }
    case "fog_gate": {
      [c, ctx] = makeCanvas(w + 64, h + 32);
      overhang = 32;
      for (let i = 0; i < 18; i++) {
        const s = hash(i, o.y, 99);
        circle(ctx, "rgba(240,244,242,0.85)", 8 + (s % (w + 48)), 16 + ((s >>> 8) % (h + 8)), 10 + (s % 10));
      }
      px(ctx, P.trunk, 10, h / 2 + 8, 4, 30);
      px(ctx, P.outline, 0, h / 2 - 8, 26, 18);
      px(ctx, P.wood, 1, h / 2 - 7, 24, 16);
      label(ctx, "?", 13, h / 2 + 1, "#5a3b2b", 12);
      break;
    }
    case "market_cart": {
      [c, ctx] = makeCanvas(w, h + 40);
      overhang = 40;
      // Striped awning on poles over a wooden cart.
      px(ctx, P.outline, 4, 6, 3, h + 30);
      px(ctx, P.outline, w - 7, 6, 3, h + 30);
      for (let i = 0; i < 8; i++) px(ctx, i % 2 ? "#f4f1d8" : "#5d8a4e", i * (w / 8), 0, w / 8, 12);
      px(ctx, P.outline, 0, 12, w, 2);
      px(ctx, P.outline, 2, 26, w - 4, h + 8);
      px(ctx, P.wood, 3, 27, w - 6, h + 6);
      for (const [x, col] of [[10, "#e8566b"], [20, "#f6c343"], [36, "#9fb7c4"], [46, "#9b7fd4"]] as [number, string][]) {
        px(ctx, col, x, 22, 6, 5);
      }
      label(ctx, "Market", w / 2, 36, "#fff9ec", 11);
      break;
    }
    case "park_gate": {
      [c, ctx] = makeCanvas(w, h + 24);
      overhang = 24;
      px(ctx, P.outline, 2, 0, 6, h + 24);
      px(ctx, P.outline, w - 8, 0, 6, h + 24);
      px(ctx, P.wood, 3, 1, 4, h + 22);
      px(ctx, P.wood, w - 7, 1, 4, h + 22);
      px(ctx, P.outline, 0, 2, w, 8);
      px(ctx, P.wood, 1, 3, w - 2, 6);
      label(ctx, "🌳", w / 2, 18, "#000", 12);
      break;
    }
    case "board_sports":
    case "board_art":
    case "board_music":
    case "board_games":
    case "notice_board":
    case "story_board": {
      // A wooden board on two posts: a coloured header with the corner's
      // name over a cork panel with pinned notes.
      [c, ctx] = makeCanvas(w, h + 30);
      overhang = 30;
      const slug = o.kind.replace("board_", "");
      const accent = o.kind === "story_board" ? "#3f7a8a" : (QUARTER_COLORS[slug] ?? "#b5544a");
      px(ctx, "rgba(0,0,0,0.15)", 6, h + 24, w - 12, 5);
      px(ctx, P.outline, 8, 26, 4, h + 4);
      px(ctx, P.outline, w - 12, 26, 4, h + 4);
      px(ctx, P.outline, 2, 2, w - 4, 36);
      px(ctx, P.wood, 3, 3, w - 6, 34);
      px(ctx, "#c99a6a", 6, 14, w - 12, 21);
      const notes = ["#fff9ec", "#fde68a", "#cfe8ff", "#ffd6e0"];
      for (let i = 0; i < 5; i++) {
        const nx = 8 + ((i * 13) % (w - 22));
        const ny = 16 + ((i * 7) % 9);
        px(ctx, notes[i % notes.length], nx, ny, 9, 8);
        px(ctx, "#b5544a", nx + 4, ny, 1, 1);
      }
      px(ctx, accent, 4, 4, w - 8, 9);
      const title = o.kind === "notice_board" ? "NOTICES" : o.kind === "story_board" ? "OUR TOWN" : slug.toUpperCase();
      label(ctx, title, w / 2, 9, "#fff9ec", 7);
      break;
    }
    case "goal": {
      // A football goal standing on the pitch's short side.
      [c, ctx] = makeCanvas(w, h + 12);
      overhang = 12;
      for (let y = 12; y < h + 8; y += 4) px(ctx, "rgba(255,255,255,0.55)", 6, y, w - 10, 1);
      for (let x = 6; x < w - 4; x += 4) px(ctx, "rgba(255,255,255,0.55)", x, 12, 1, h - 4);
      px(ctx, P.outline, 2, 8, 5, h + 4);
      px(ctx, P.chalk, 3, 9, 3, h + 2);
      px(ctx, P.outline, 2, 6, w - 4, 5);
      px(ctx, P.chalk, 3, 7, w - 6, 3);
      px(ctx, P.outline, w - 7, 8, 5, h + 4);
      px(ctx, P.chalk, w - 6, 9, 3, h + 2);
      break;
    }
    case "easels": {
      // Three easels with canvases in progress.
      [c, ctx] = makeCanvas(w, h + 30);
      overhang = 30;
      const art = [
        ["#9fd3ee", "#f6c343", "#5f9a48"],
        ["#f4a7b9", "#9b6fd4", "#fff9ec"],
        ["#ffe08a", "#e8566b", "#4f8fd6"],
      ];
      for (let i = 0; i < 3; i++) {
        const x = i * 32 + 6;
        px(ctx, P.woodDark, x + 3, 22, 2, h + 6);
        px(ctx, P.woodDark, x + 15, 22, 2, h + 6);
        px(ctx, P.woodDark, x + 9, 26, 2, h + 2);
        px(ctx, P.outline, x, 4, 20, 22);
        px(ctx, art[i][0], x + 1, 5, 18, 20);
        px(ctx, art[i][1], x + 4 + i * 2, 9, 6, 6);
        px(ctx, art[i][2], x + 3, 17, 14, 4);
        px(ctx, P.wood, x - 1, 24, 22, 3);
      }
      break;
    }
    case "bandstand": {
      // An octagonal-ish bandstand: raised platform, posts and a roof.
      [c, ctx] = makeCanvas(w, h + 44);
      overhang = 44;
      const top = 44;
      px(ctx, "rgba(0,0,0,0.15)", 6, top + h - 8, w - 12, 8);
      px(ctx, P.outline, 4, top + h - 30, w - 8, 24);
      px(ctx, "#efe3cf", 5, top + h - 29, w - 10, 6);
      px(ctx, P.wood, 5, top + h - 23, w - 10, 16);
      for (let x = 10; x < w - 10; x += 12) px(ctx, P.woodDark, x, top + h - 22, 2, 14);
      for (const x of [10, w / 2 - 2, w - 14]) px(ctx, "#fff9ec", x, 26, 4, top + h - 54);
      polygon(ctx, P.outline, [
        [0, 30],
        [w / 2, 0],
        [w, 30],
      ]);
      polygon(ctx, "#5d8a4e", [
        [3, 29],
        [w / 2, 2],
        [w - 3, 29],
      ]);
      px(ctx, P.outline, 0, 28, w, 5);
      px(ctx, "#f4f1d8", 1, 29, w - 2, 3);
      for (let x = 2; x < w - 2; x += 10) px(ctx, "#e8566b", x, 32, 5, 3);
      label(ctx, "♪", w / 2, 18, "#fff9ec", 12);
      break;
    }
    case "arcade": {
      // A row of arcade cabinets with glowing screens.
      [c, ctx] = makeCanvas(w, h + 34);
      overhang = 34;
      const bodies = ["#e0943a", "#4f8fd6", "#d6609a"];
      for (let i = 0; i < 3; i++) {
        const x = i * 32 + 4;
        px(ctx, P.outline, x, 2, 24, h + 30);
        px(ctx, bodies[i], x + 1, 3, 22, h + 28);
        px(ctx, P.outline, x + 3, 6, 18, 4);
        px(ctx, "#fff3c4", x + 4, 7, 16, 2);
        px(ctx, P.outline, x + 3, 12, 18, 16);
        px(ctx, "#1d2b3a", x + 4, 13, 16, 14);
        px(ctx, ["#7ee081", "#ffe08a", "#9fd3ee"][i], x + 6 + i * 3, 16 + i * 2, 4, 4);
        px(ctx, "#e8566b", x + 12, 22, 3, 2);
        px(ctx, P.outline, x + 2, 30, 20, 6);
        px(ctx, "#3b3a2e", x + 3, 31, 18, 4);
        px(ctx, "#e8566b", x + 6, 32, 2, 2);
        px(ctx, "#f6c343", x + 14, 32, 2, 2);
      }
      break;
    }
    case "old_oak": {
      // The Old Oak: a great gnarled tree, older than the town.
      [c, ctx] = makeCanvas(w, h + 72);
      overhang = 72;
      const ox = 0;
      px(ctx, "rgba(0,0,0,0.2)", ox + 4, h + 60, w - 8, 10);
      // Trunk and roots.
      px(ctx, P.outline, ox + 34, 70, 30, h - 4);
      px(ctx, P.trunk, ox + 36, 70, 26, h - 6);
      px(ctx, "#6a4a2c", ox + 42, 80, 3, h - 20);
      px(ctx, "#6a4a2c", ox + 52, 90, 3, h - 30);
      px(ctx, P.outline, ox + 22, h + 58, 54, 6);
      px(ctx, P.trunk, ox + 24, h + 58, 50, 4);
      // A low branch reaching out for the swing.
      px(ctx, P.outline, ox + 58, 98, 36, 7);
      px(ctx, P.trunk, ox + 59, 99, 34, 5);
      // Canopy: layered blobs.
      for (const [bx, by, r, col] of [
        [ox + 48, 46, 46, P.outline],
        [ox + 48, 46, 45, "#4f8a3d"],
        [ox + 22, 56, 26, "#4f8a3d"],
        [ox + 76, 58, 26, "#4f8a3d"],
        [ox + 48, 38, 34, P.leaf],
        [ox + 30, 34, 18, P.leafLight],
        [ox + 64, 30, 14, P.leafLight],
        [ox + 50, 64, 18, P.leaf],
      ] as [number, number, number, string][]) {
        circle(ctx, col, bx, by, r);
      }
      for (let i = 0; i < 14; i++) px(ctx, "#8fca6b", ox + 16 + (hash(i, 1, 9) % 64), 12 + (hash(i, 2, 9) % 60), 3, 2);
      break;
    }
    case "well": {
      // The wishing well: a stone ring, a little roof, a bucket.
      [c, ctx] = makeCanvas(w, h + 40);
      overhang = 40;
      const top = 40;
      px(ctx, "rgba(0,0,0,0.18)", 6, top + h - 10, w - 12, 8);
      px(ctx, P.outline, 6, top + 16, w - 12, h - 20);
      for (let r = 0; r < 4; r++) {
        for (let k = 0; k < 4; k++) px(ctx, (r + k) % 2 ? P.stone : P.stoneDark, 8 + k * 12, top + 18 + r * 9, 11, 8);
      }
      oval(ctx, P.outline, w / 2, top + 16, w / 2 - 6, 9);
      oval(ctx, "#2b4a5a", w / 2, top + 16, w / 2 - 9, 6);
      px(ctx, P.outline, 10, 6, 4, top + 12);
      px(ctx, P.outline, w - 14, 6, 4, top + 12);
      polygon(ctx, P.outline, [[2, 12], [w / 2, -2], [w - 2, 12]]);
      polygon(ctx, "#b5544a", [[5, 11], [w / 2, 1], [w - 5, 11]]);
      px(ctx, "#8b6a4b", w / 2, 12, 1, 16);
      px(ctx, P.outline, w / 2 - 4, 28, 9, 7);
      px(ctx, P.wood, w / 2 - 3, 29, 7, 5);
      break;
    }
    case "maze_heart": {
      // A stone sundial among flowers at the heart of the maze.
      [c, ctx] = makeCanvas(w, h + 20);
      overhang = 20;
      px(ctx, P.outline, 10, 18, 12, h);
      px(ctx, P.stone, 11, 19, 10, h - 2);
      oval(ctx, P.outline, 16, 16, 12, 6);
      oval(ctx, "#cfc9bb", 16, 16, 11, 5);
      polygon(ctx, P.outline, [[16, 4], [16, 16], [22, 16]]);
      for (const [fx, col] of [[3, "#f4a7b9"], [26, "#ffe08a"], [6, "#c9a7f4"], [24, "#ffffff"]] as [number, string][]) {
        px(ctx, col, fx, h + 12, 3, 3);
      }
      break;
    }
    case "tiny_door": {
      // A hollow stump with a tiny round door, and a light on inside.
      [c, ctx] = makeCanvas(w, h + 20);
      overhang = 20;
      px(ctx, P.outline, 3, 6, 26, h + 12);
      px(ctx, P.trunk, 4, 9, 24, h + 8);
      oval(ctx, P.outline, 16, 7, 13, 5);
      oval(ctx, "#c99a6a", 16, 7, 12, 4);
      disc(ctx, P.outline, 16, h + 8, 7);
      disc(ctx, "#5d8a4e", 16, h + 8, 6);
      px(ctx, "#5d8a4e", 10, h + 8, 12, 9);
      px(ctx, "#f6c343", 19, h + 10, 2, 2);
      px(ctx, "#ffe39a", 12, 18, 4, 4);
      break;
    }
    case "signpost": {
      [c, ctx] = makeCanvas(w, h + 28);
      overhang = 28;
      px(ctx, P.outline, 14, 4, 4, h + 22);
      px(ctx, P.wood, 15, 5, 2, h + 20);
      polygon(ctx, P.outline, [[3, 6], [26, 6], [30, 10], [26, 14], [3, 14]]);
      polygon(ctx, "#efe3cf", [[4, 7], [25, 7], [28, 10], [25, 13], [4, 13]]);
      polygon(ctx, P.outline, [[29, 16], [6, 16], [2, 20], [6, 24], [29, 24]]);
      polygon(ctx, "#efe3cf", [[28, 17], [7, 17], [4, 20], [7, 23], [28, 23]]);
      px(ctx, P.woodDark, 8, 10, 14, 1);
      px(ctx, P.woodDark, 10, 20, 14, 1);
      break;
    }
    case "tailor": {
      // The tailor's tent: striped canvas, a sign with a coat hanger, and a
      // curtain to change behind.
      [c, ctx] = makeCanvas(w, h + 40);
      overhang = 40;
      const top = 40;
      px(ctx, "rgba(0,0,0,0.18)", 4, top + h - 6, w - 8, 6);
      polygon(ctx, P.outline, [[2, top + h - 2], [2, top - 6], [w / 2, top - 30], [w - 2, top - 6], [w - 2, top + h - 2]]);
      for (let i = 0; i < 8; i++) {
        const x0 = 4 + i * ((w - 8) / 8);
        polygon(ctx, i % 2 ? "#f4f1d8" : "#c8553d", [[x0, top + h - 3], [x0, top - 5], [w / 2, top - 27], [x0 + (w - 8) / 8, top - 5], [x0 + (w - 8) / 8, top + h - 3]]);
      }
      px(ctx, P.outline, w / 2 - 12, top + 4, 24, h - 6);
      px(ctx, "#7a4a8c", w / 2 - 11, top + 5, 22, h - 8);
      px(ctx, "#9a6aac", w / 2 - 11, top + 5, 3, h - 8);
      px(ctx, "#9a6aac", w / 2 + 2, top + 5, 3, h - 8);
      // the sign
      px(ctx, P.outline, w / 2 - 10, top - 20, 20, 12);
      px(ctx, P.wood, w / 2 - 9, top - 19, 18, 10);
      px(ctx, P.outline, w / 2 - 1, top - 18, 2, 2);
      polygon(ctx, P.outline, [[w / 2 - 6, top - 11], [w / 2, top - 16], [w / 2 + 6, top - 11]]);
      polygon(ctx, P.wood, [[w / 2 - 4, top - 12], [w / 2, top - 15], [w / 2 + 4, top - 12]]);
      px(ctx, "#f6c343", w / 2 - 1, top - 31, 2, 3);
      break;
    }
    case "wardrobe": {
      // A tall wooden wardrobe with a mirror on one door.
      [c, ctx] = makeCanvas(w, h + 40);
      overhang = 40;
      const top = 40;
      px(ctx, P.outline, 3, top - 36, w - 6, h + 34);
      px(ctx, P.wood, 4, top - 35, w - 8, h + 32);
      px(ctx, P.woodDark, 4, top - 35, w - 8, 3);
      px(ctx, P.woodDark, w / 2 - 1, top - 32, 2, h + 28);
      px(ctx, P.outline, 8, top - 28, w / 2 - 12, h + 14);
      px(ctx, "#cfe3ea", 9, top - 27, w / 2 - 14, h + 12);
      px(ctx, "#ffffff", 11, top - 25, 2, 8);
      px(ctx, "#f6c343", w / 2 - 4, top - 10, 2, 3);
      px(ctx, "#f6c343", w / 2 + 2, top - 10, 2, 3);
      px(ctx, P.outline, 3, top + h - 3, w - 6, 3);
      break;
    }
    case "campfire": {
      // A ring of stones and crossed logs; the flames are animated on top.
      [c, ctx] = makeCanvas(w + 16, h + 8);
      overhang = 8;
      const cx = (w + 16) / 2;
      const cy = 8 + h / 2 + 4;
      oval(ctx, "rgba(0,0,0,0.2)", cx, cy + 4, 18, 7);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const sx = cx + Math.cos(a) * 15;
        const sy = cy + Math.sin(a) * 7;
        oval(ctx, P.outline, sx, sy, 4, 3);
        oval(ctx, i % 2 ? P.stone : P.stoneDark, sx, sy - 1, 3, 2);
      }
      px(ctx, P.outline, cx - 11, cy - 3, 22, 6);
      px(ctx, P.trunk, cx - 10, cy - 2, 20, 4);
      px(ctx, "#3a2a1c", cx - 4, cy - 4, 8, 3);
      break;
    }
    case "lantern_stand": {
      // A little wooden stand with paper lanterns waiting for wishes.
      [c, ctx] = makeCanvas(w + 16, h + 36);
      overhang = 36;
      const top = 36;
      px(ctx, "rgba(0,0,0,0.18)", 4, top + h - 6, w + 8, 5);
      px(ctx, P.outline, 6, top - 8, 3, h + 4);
      px(ctx, P.outline, w + 7, top - 8, 3, h + 4);
      px(ctx, P.outline, 3, top - 2, w + 10, 10);
      px(ctx, P.wood, 4, top - 1, w + 8, 8);
      for (const [lx, ly, col] of [[6, top - 14, "#f28c6b"], [16, top - 20, "#ffd27a"], [26, top - 13, "#f4a7b9"], [15, top - 6, "#ffe9a8"]] as [number, number, string][]) {
        px(ctx, P.outline, lx - 1, ly - 1, 9, 11);
        px(ctx, col, lx, ly, 7, 9);
        px(ctx, "rgba(255,255,255,0.5)", lx + 1, ly + 1, 2, 7);
      }
      px(ctx, P.outline, 3, top - 30, w + 10, 2);
      break;
    }
    case "bottles": {
      // A driftwood crate of corked bottles, and paper and a pencil.
      [c, ctx] = makeCanvas(w, h + 14);
      overhang = 14;
      px(ctx, "rgba(0,0,0,0.18)", 3, h + 8, w - 6, 5);
      px(ctx, P.outline, 4, 14, w - 8, h - 2);
      px(ctx, "#b89a74", 5, 15, w - 10, h - 4);
      px(ctx, "#8e7458", 5, 22, w - 10, 2);
      for (const [bx, col] of [[8, "#7fc4b8"], [14, "#a7d38b"], [20, "#8fb7e0"]] as [number, string][]) {
        px(ctx, P.outline, bx - 1, 3, 6, 13);
        px(ctx, col, bx, 6, 4, 9);
        px(ctx, "#c99a6a", bx + 1, 2, 2, 3);
        px(ctx, "#f4f1d8", bx + 1, 9, 2, 4);
      }
      break;
    }
    case "founders_stone": {
      // A low standing stone with names cut into it and a seedling carved on top.
      [c, ctx] = makeCanvas(w, h + 22);
      overhang = 22;
      const top = 22;
      px(ctx, "rgba(0,0,0,0.2)", 4, top + h - 8, w - 8, 7);
      polygon(ctx, P.outline, [[6, top + h - 4], [4, 12], [12, 3], [w - 12, 3], [w - 4, 12], [w - 6, top + h - 4]]);
      polygon(ctx, "#a9a493", [[7, top + h - 5], [6, 12], [13, 5], [w - 13, 5], [w - 6, 12], [w - 7, top + h - 5]]);
      px(ctx, "#bdb8a6", 9, 8, w - 18, 3);
      for (let r = 0; r < 6; r++) px(ctx, "#827d6c", 12 + (r % 2) * 4, 16 + r * 4, w - 26 - (r % 3) * 6, 1);
      px(ctx, "#5d8a4e", w / 2 - 1, 0, 2, 5);
      px(ctx, "#8fca6b", w / 2 - 5, 0, 4, 2);
      px(ctx, "#8fca6b", w / 2 + 1, -1, 4, 2);
      for (const [fx, col] of [[2, "#ffe08a"], [w - 5, "#f4a7b9"], [10, "#ffffff"], [w - 13, "#c9a7f4"]] as [number, string][]) {
        px(ctx, col, fx, top + h - 6, 3, 3);
      }
      break;
    }
    case "garden_sign": {
      [c, ctx] = makeCanvas(w, h + 16);
      overhang = 16;
      px(ctx, P.trunk, 14, 20, 4, 28);
      px(ctx, P.outline, 2, 4, 28, 18);
      px(ctx, P.wood, 3, 5, 26, 16);
      label(ctx, "🌱", 16, 13, "#000", 12);
      break;
    }
    default:
      [c, ctx] = makeCanvas(w, h);
      px(ctx, "rgba(0,0,0,0.2)", 0, 0, w, h);
  }
  return { texture: toTexture(c), overhang };
}

// ---- avatars ------------------------------------------------------------------

const SKIN = ["#f5d0b0", "#e0ac84", "#b97c55", "#7d5136"];
/** The Caretaker NPC's look: a gardener in a straw sun hat and green apron. */
export const CARETAKER_LOOK = 0xfffffff1;
const HAIR = ["#2b211c", "#5a3b25", "#a5662f", "#e3c16f", "#c4c4c4", "#b4473a", "#3f4f8f", "#6f4d8f"];
export const SKIN_COLORS = SKIN;
export const HAIR_COLORS = HAIR;

/** Colours for a look (see world/look.ts for the bit layout). */
export function lookParts(look: number) {
  const l = decodeLook(look);
  const hue = l.hue * (360 / 256);
  return {
    ...l,
    outfitColor: `hsl(${hue.toFixed(0)} 45% 58%)`,
    outfitDark: `hsl(${hue.toFixed(0)} 40% 42%)`,
    skinColor: SKIN[l.skin],
    hairColor: HAIR[l.hair],
    hatColor: `hsl(${(l.hatHue * (360 / 256)).toFixed(0)} 55% 55%)`,
  };
}

const avatarCache = new Map<string, Texture>();
const canvasCache = new Map<string, HTMLCanvasElement>();

/**
 * 24×34 avatar sprite, feet at the bottom centre. Frames 0/1 alternate the
 * legs while walking; frame 2 is sitting (body lowered, legs forward).
 */
export function avatarTexture(look: number, frame: 0 | 1 | 2): Texture {
  const key = `${look}:${frame}`;
  const cached = avatarCache.get(key);
  if (cached) return cached;
  const t = toTexture(avatarCanvas(look, frame));
  avatarCache.set(key, t);
  return t;
}

/** The avatar drawn on a 24×34 canvas (also for previews in the changing room). */
export function avatarCanvas(look: number, frame: 0 | 1 | 2): HTMLCanvasElement {
  const key = `${look}:${frame}`;
  const cached = canvasCache.get(key);
  if (cached) return cached;
  const caretaker = look === CARETAKER_LOOK;
  const p = caretaker
    ? { ...lookParts(0), outfitColor: "#e8dcc0", outfitDark: "#5f8f4e", skinColor: SKIN[1], hairColor: "#c4c4c4", hat: 0 }
    : lookParts(look);
  const [c, ctx] = makeCanvas(24, 34);
  const o = PALETTE.outline;
  const hair = p.hairColor;
  px(ctx, "rgba(0,0,0,0.2)", 5, 31, 14, 3);
  // legs
  if (frame === 2) {
    px(ctx, o, 6, 27, 12, 5);
    px(ctx, "#4a4a5a", 7, 28, 10, 3);
    px(ctx, o, 6, 31, 3, 2);
    px(ctx, o, 15, 31, 3, 2);
    ctx.translate(0, 4);
  } else {
    px(ctx, o, frame ? 7 : 8, 25, 4, 7);
    px(ctx, o, frame ? 14 : 13, 25, 4, 7);
    px(ctx, "#4a4a5a", frame ? 8 : 9, 25, 2, 6);
    px(ctx, "#4a4a5a", frame ? 15 : 14, 25, 2, 6);
  }

  // ---- behind the body: long hair, curls, buns, a ponytail, a backpack ----
  if (p.style === 1) {
    px(ctx, o, 5, 7, 14, 12);
    px(ctx, hair, 6, 8, 12, 10);
  } else if (p.style === 7) {
    px(ctx, o, 3, 1, 18, 14);
    px(ctx, o, 4, 0, 16, 16);
    px(ctx, hair, 4, 1, 16, 14);
    px(ctx, hair, 5, 0, 14, 1);
  } else if (p.style === 4) {
    for (const bx of [3, 16]) {
      px(ctx, o, bx, 0, 5, 5);
      px(ctx, hair, bx + 1, 1, 3, 3);
    }
  } else if (p.style === 3) {
    px(ctx, o, 17, 4, 5, 10);
    px(ctx, hair, 18, 5, 3, 8);
    px(ctx, "#f28c6b", 17, 6, 2, 2);
  }
  if (p.accessory === 4) {
    px(ctx, o, 3, 15, 18, 10);
    px(ctx, "#a0703f", 4, 16, 16, 8);
  }

  // ---- body and outfit ----
  const shirt = p.outfitColor;
  const dark = p.outfitDark;
  px(ctx, o, 5, 15, 14, 12);
  px(ctx, shirt, 6, 16, 12, 10);
  switch (p.outfit) {
    case 0: // tee
      px(ctx, dark, 6, 23, 12, 3);
      break;
    case 1: // overalls over a shirt
      px(ctx, "#4f6fa0", 6, 21, 12, 5);
      px(ctx, "#4f6fa0", 9, 18, 6, 4);
      px(ctx, "#4f6fa0", 7, 16, 2, 3);
      px(ctx, "#4f6fa0", 15, 16, 2, 3);
      px(ctx, "#f6c343", 9, 18, 1, 1);
      px(ctx, "#f6c343", 14, 18, 1, 1);
      break;
    case 2: // stripes
      for (const y of [17, 19, 21, 23]) px(ctx, dark, 6, y, 12, 1);
      px(ctx, dark, 6, 25, 12, 1);
      break;
    case 3: // dress
      px(ctx, o, 4, 22, 16, 6);
      px(ctx, shirt, 5, 22, 14, 5);
      px(ctx, dark, 5, 26, 14, 1);
      px(ctx, dark, 6, 21, 12, 1);
      break;
    case 4: // hoodie
      px(ctx, dark, 6, 16, 12, 2);
      px(ctx, dark, 8, 21, 8, 3);
      px(ctx, "#fff8e3", 10, 18, 1, 3);
      px(ctx, "#fff8e3", 13, 18, 1, 3);
      break;
    case 5: // open jacket over a white shirt
      px(ctx, "#f4f1d8", 10, 16, 4, 10);
      px(ctx, dark, 9, 16, 1, 6);
      px(ctx, dark, 14, 16, 1, 6);
      px(ctx, dark, 6, 24, 12, 2);
      break;
    case 6: // jumper with a heart
      px(ctx, dark, 6, 24, 12, 2);
      px(ctx, "#e8566b", 9, 18, 2, 1);
      px(ctx, "#e8566b", 13, 18, 2, 1);
      px(ctx, "#e8566b", 9, 19, 6, 1);
      px(ctx, "#e8566b", 10, 20, 4, 1);
      px(ctx, "#e8566b", 11, 21, 2, 1);
      break;
    case 7: // shirt, waistcoat and tie
      px(ctx, "#f4f1d8", 6, 16, 12, 10);
      px(ctx, shirt, 6, 17, 4, 8);
      px(ctx, shirt, 14, 17, 4, 8);
      px(ctx, dark, 6, 24, 4, 1);
      px(ctx, dark, 14, 24, 4, 1);
      px(ctx, "#b5443a", 11, 16, 2, 6);
      break;
  }
  // arms: long sleeves for stripes, hoodies, jackets and jumpers
  const sleeves = p.outfit === 2 || p.outfit === 4 || p.outfit === 5 || p.outfit === 6;
  for (const ax of [4, 18]) {
    px(ctx, sleeves ? dark : p.skinColor, ax, 18, 2, 5);
    if (sleeves) px(ctx, p.skinColor, ax, 22, 2, 1);
  }
  if (p.accessory === 4) {
    px(ctx, "#6e4b30", 7, 16, 2, 7);
    px(ctx, "#6e4b30", 15, 16, 2, 7);
  }

  // ---- head ----
  px(ctx, o, 5, 3, 14, 13);
  px(ctx, p.skinColor, 6, 4, 12, 11);
  switch (p.style) {
    case 0: // short
      px(ctx, hair, 6, 4, 12, 4);
      px(ctx, hair, 6, 8, 2, 4);
      px(ctx, hair, 16, 8, 2, 4);
      break;
    case 1: // long
      px(ctx, hair, 6, 4, 12, 4);
      px(ctx, hair, 6, 8, 2, 7);
      px(ctx, hair, 16, 8, 2, 7);
      break;
    case 2: // bob with a fringe
      px(ctx, hair, 6, 4, 12, 4);
      px(ctx, o, 4, 7, 2, 8);
      px(ctx, o, 18, 7, 2, 8);
      px(ctx, hair, 5, 7, 3, 7);
      px(ctx, hair, 16, 7, 3, 7);
      break;
    case 3: // ponytail
    case 4: // buns
      px(ctx, hair, 6, 4, 12, 3);
      px(ctx, hair, 6, 7, 1, 3);
      px(ctx, hair, 17, 7, 1, 3);
      break;
    case 5: // spiky
      px(ctx, hair, 6, 4, 12, 3);
      for (const sx of [6, 9, 12, 15]) {
        px(ctx, o, sx, 0, 3, 4);
        px(ctx, hair, sx + 1, 1, 1, 3);
      }
      px(ctx, hair, 6, 7, 2, 2);
      px(ctx, hair, 16, 7, 2, 2);
      break;
    case 6: // shaved
      px(ctx, hair, 6, 4, 12, 1);
      for (const sx of [7, 10, 13, 16]) px(ctx, hair, sx, 5, 1, 1);
      break;
    case 7: // curly
      px(ctx, hair, 6, 4, 12, 4);
      for (const sx of [7, 11, 15]) px(ctx, hair, sx, 8, 2, 1);
      px(ctx, hair, 6, 8, 1, 6);
      px(ctx, hair, 17, 8, 1, 6);
      break;
  }
  px(ctx, o, 9, 10, 2, 2);
  px(ctx, o, 14, 10, 2, 2);
  px(ctx, "#e89a8f", 8, 12, 2, 1);
  px(ctx, "#e89a8f", 15, 12, 2, 1);

  // ---- hat ----
  if (p.hat === 1) {
    px(ctx, o, 5, 1, 14, 5);
    px(ctx, p.hatColor, 6, 2, 12, 3);
    px(ctx, "#ffffff", 11, 0, 3, 2);
  } else if (p.hat === 2) {
    px(ctx, o, 5, 2, 14, 4);
    px(ctx, p.hatColor, 6, 2, 12, 3);
    px(ctx, p.hatColor, 14, 5, 7, 2);
  } else if (p.hat === 3) {
    px(ctx, "#ffd1e0", 15, 3, 4, 4);
    px(ctx, "#f7d35c", 16, 4, 2, 2);
  }

  // ---- accessories in front ----
  switch (p.accessory) {
    case 1: // glasses
      px(ctx, o, 8, 9, 4, 4);
      px(ctx, o, 13, 9, 4, 4);
      px(ctx, "#dff1f7", 9, 10, 2, 2);
      px(ctx, "#dff1f7", 14, 10, 2, 2);
      px(ctx, o, 12, 10, 1, 1);
      px(ctx, o, 9, 10, 1, 1);
      px(ctx, o, 14, 10, 1, 1);
      break;
    case 2: // sunglasses
      px(ctx, o, 7, 9, 11, 1);
      px(ctx, "#2b2a24", 8, 10, 4, 2);
      px(ctx, "#2b2a24", 13, 10, 4, 2);
      px(ctx, "#6b8ab0", 8, 10, 1, 1);
      px(ctx, "#6b8ab0", 13, 10, 1, 1);
      break;
    case 3: // scarf
      px(ctx, o, 5, 14, 14, 4);
      px(ctx, p.hatColor, 6, 15, 12, 2);
      px(ctx, o, 13, 17, 4, 6);
      px(ctx, p.hatColor, 14, 17, 2, 5);
      px(ctx, "#ffffff", 14, 21, 2, 1);
      break;
    case 5: // a bow in the hair
      px(ctx, o, 14, 1, 7, 5);
      px(ctx, "#e8566b", 15, 2, 2, 3);
      px(ctx, "#e8566b", 18, 2, 2, 3);
      px(ctx, "#b5443a", 17, 3, 1, 1);
      break;
    case 6: // headphones
      px(ctx, o, 5, 1, 14, 2);
      px(ctx, o, 3, 7, 4, 6);
      px(ctx, o, 17, 7, 4, 6);
      px(ctx, p.hatColor, 4, 8, 2, 4);
      px(ctx, p.hatColor, 18, 8, 2, 4);
      break;
    case 7: // a flower crown
      for (const [fx, col] of [[6, "#f4a7b9"], [9, "#ffe08a"], [12, "#ffffff"], [15, "#c9a7f4"]] as [number, string][]) {
        px(ctx, o, fx, 2, 4, 3);
        px(ctx, col, fx + 1, 2, 2, 2);
      }
      px(ctx, "#5f9a48", 6, 4, 12, 1);
      break;
  }

  if (caretaker) {
    // Green apron with a pocket and a trowel; a wide straw hat with a band.
    px(ctx, "#5f8f4e", 8, 18, 8, 8);
    px(ctx, "#4c7a3e", 9, 21, 4, 3);
    px(ctx, "#9aa3a8", 14, 20, 1, 3);
    px(ctx, o, 1, 4, 22, 3);
    px(ctx, "#e6c46a", 2, 5, 20, 1);
    px(ctx, o, 6, 0, 12, 5);
    px(ctx, "#e6c46a", 7, 1, 10, 4);
    px(ctx, "#b5544a", 7, 3, 10, 1);
    px(ctx, "#8fca6b", 15, 1, 2, 2);
  }
  canvasCache.set(key, c);
  return c;
}

// ---- ambient creatures (client-only, spec §7.1) -------------------------

const ambientCache = new Map<string, Texture>();

function cached(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  let t = ambientCache.get(key);
  if (!t) {
    const [c, ctx] = makeCanvas(w, h);
    draw(ctx);
    t = toTexture(c);
    ambientCache.set(key, t);
  }
  return t;
}

/** Duck facing right; `frame` bobs the head. */
export function duckTexture(frame: 0 | 1): Texture {
  return cached(`duck:${frame}`, 16, 12, (ctx) => {
    const o = PALETTE.outline;
    px(ctx, "rgba(255,255,255,0.35)", 1, 10, 13, 2);
    px(ctx, o, 2, 5, 11, 6);
    px(ctx, "#f4efe2", 3, 6, 9, 4);
    px(ctx, "#d9d0bd", 3, 8, 6, 2);
    const hy = frame ? 1 : 0;
    px(ctx, o, 9, 1 + hy, 5, 5);
    px(ctx, "#3f7a4a", 10, 2 + hy, 3, 3);
    px(ctx, "#f2a541", 14, 3 + hy, 2, 2);
    px(ctx, "#fff", 12, 2 + hy, 1, 1);
  });
}

/** Small bird seen from above; `frame` flaps the wings. */
export function birdTexture(frame: 0 | 1): Texture {
  return cached(`bird:${frame}`, 12, 8, (ctx) => {
    const c = "#4b4033";
    if (frame) {
      px(ctx, c, 0, 1, 4, 2);
      px(ctx, c, 8, 1, 4, 2);
    } else {
      px(ctx, c, 0, 4, 4, 2);
      px(ctx, c, 8, 4, 4, 2);
    }
    px(ctx, c, 4, 2, 4, 4);
    px(ctx, "#f2a541", 8, 3, 1, 1);
  });
}

export function butterflyTexture(hue: number, frame: 0 | 1): Texture {
  return cached(`fly:${hue}:${frame}`, 8, 6, (ctx) => {
    const c = `hsl(${hue} 80% 70%)`;
    const w = frame ? 2 : 3;
    px(ctx, c, 4 - w, 0, w, 3);
    px(ctx, c, 4, 0, w, 3);
    px(ctx, c, 4 - w + 1, 3, w - 1, 2);
    px(ctx, c, 4, 3, w - 1, 2);
    px(ctx, PALETTE.outline, 3, 1, 2, 4);
  });
}

export function leafTexture(variant: number): Texture {
  const colors = ["#7dbb5c", "#d9a441", "#c8693e"];
  return cached(`leaf:${variant % 3}`, 4, 3, (ctx) => {
    px(ctx, colors[variant % 3], 0, 0, 3, 2);
    px(ctx, colors[variant % 3], 1, 1, 3, 2);
  });
}
