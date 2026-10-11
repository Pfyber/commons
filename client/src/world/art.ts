// Procedural placeholder pixel art (spec §16: warm, simple, 32×32 tiles,
// soft outlines). Drawn once into canvases and turned into nearest-filtered
// textures; replaced by real atlases from assets/ when they exist.

import { Texture } from "pixi.js";
import type { MapObject } from "./map";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

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

function circle(ctx: CanvasRenderingContext2D, color: string, cx: number, cy: number, r: number) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

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
  return toTexture(c);
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
        ctx.fillStyle = i % 2 ? P.pine : P.pineLight;
        ctx.beginPath();
        ctx.moveTo(18, top);
        ctx.lineTo(18 + half, top + 20);
        ctx.lineTo(18 - half, top + 20);
        ctx.closePath();
        ctx.fill();
      }
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
    case "bench": {
      [c, ctx] = makeCanvas(32, 24);
      px(ctx, P.outline, 3, 6, 26, 12);
      px(ctx, P.wood, 4, 7, 24, 3);
      px(ctx, P.wood, 4, 11, 24, 3);
      px(ctx, P.woodDark, 4, 15, 24, 2);
      px(ctx, P.outline, 6, 17, 2, 6);
      px(ctx, P.outline, 24, 17, 2, 6);
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
      ctx.fillStyle = "#b5544a";
      ctx.beginPath();
      ctx.moveTo(0, top + 4);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(w, top + 4);
      ctx.closePath();
      ctx.fill();
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
const HAIR = ["#2b211c", "#5a3b25", "#a5662f", "#e3c16f", "#c4c4c4", "#b4473a", "#3f4f8f", "#6f4d8f"];

/** Decodes the 32-bit look seed into avatar parts (modular layers later). */
export function lookParts(look: number) {
  const hue = (look & 0xff) * (360 / 256);
  return {
    outfit: `hsl(${hue.toFixed(0)} 45% 58%)`,
    outfitDark: `hsl(${hue.toFixed(0)} 40% 42%)`,
    skin: SKIN[(look >>> 8) & 3],
    hair: HAIR[(look >>> 10) & 7],
    hat: (look >>> 13) & 3, // 0 none, 1 beanie, 2 cap, 3 flower
    hatColor: `hsl(${(((look >>> 16) & 0xff) * (360 / 256)).toFixed(0)} 55% 55%)`,
  };
}

const avatarCache = new Map<string, Texture>();

/**
 * 24×34 avatar sprite, feet at the bottom centre. Frames 0/1 alternate the
 * legs while walking; frame 2 is sitting (body lowered, legs forward).
 */
export function avatarTexture(look: number, frame: 0 | 1 | 2): Texture {
  const key = `${look}:${frame}`;
  const cached = avatarCache.get(key);
  if (cached) return cached;
  const p = lookParts(look);
  const [c, ctx] = makeCanvas(24, 34);
  const o = PALETTE.outline;
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
  // body
  px(ctx, o, 5, 15, 14, 12);
  px(ctx, p.outfit, 6, 16, 12, 10);
  px(ctx, p.outfitDark, 6, 23, 12, 3);
  px(ctx, p.skin, 4, 18, 2, 5);
  px(ctx, p.skin, 18, 18, 2, 5);
  // head
  px(ctx, o, 5, 3, 14, 13);
  px(ctx, p.skin, 6, 4, 12, 11);
  px(ctx, p.hair, 6, 4, 12, 4);
  px(ctx, p.hair, 6, 8, 2, 4);
  px(ctx, p.hair, 16, 8, 2, 4);
  px(ctx, o, 9, 10, 2, 2);
  px(ctx, o, 14, 10, 2, 2);
  px(ctx, "#e89a8f", 8, 12, 2, 1);
  px(ctx, "#e89a8f", 15, 12, 2, 1);
  // hat
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
  const t = toTexture(c);
  avatarCache.set(key, t);
  return t;
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
