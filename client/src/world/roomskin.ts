// A home's walls and floor: wallpaper and flooring patterns, in any colour.
// The ground and wall painters (art.ts) ask here while you're in a home; the
// rest of the world's floors never see a skin. Also what's drawn for the
// home-life pieces: the planter, the UV light, the display shelf.

import { Texture } from "pixi.js";
import { disc } from "./pixeldraw";

export interface RoomSkin {
  wall: string;
  wallColor: string;
  floor: string;
  floorColor: string;
}

export const PLAIN_SKIN: RoomSkin = { wall: "plain", wallColor: "#d9b98f", floor: "plank", floorColor: "#a9774a" };

let skin: RoomSkin | null = null;
const walls = new Map<string, Texture>();

export function setRoomSkin(s: RoomSkin | null) {
  skin = s;
}

export function roomSkin(): RoomSkin | null {
  return skin;
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** `hex` lightened (amount > 0) or darkened. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amount)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** One tile of the floor. */
export function paintFloor(ctx: CanvasRenderingContext2D, ox: number, oy: number, tx: number, ty: number) {
  const s = skin ?? PLAIN_SKIN;
  const c = s.floorColor;
  px(ctx, c, ox, oy, 32, 32);
  const dark = shade(c, -0.09);
  const light = shade(c, 0.06);
  switch (s.floor) {
    case "parquet":
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const across = (tx + ty + i + j) % 2 === 0;
          const [x, y] = [ox + i * 16, oy + j * 16];
          for (let k = 0; k < 16; k += 4) px(ctx, k % 8 ? light : dark, across ? x : x + k, across ? y + k : y, across ? 16 : 1, across ? 1 : 16);
          px(ctx, dark, x, y, 16, 1);
          px(ctx, dark, x, y, 1, 16);
        }
      }
      break;
    case "tile":
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if ((tx * 2 + ty * 2 + i + j) % 2) px(ctx, shade(c, -0.2), ox + i * 16, oy + j * 16, 16, 16);
      px(ctx, dark, ox, oy, 32, 1);
      px(ctx, dark, ox, oy, 1, 32);
      break;
    case "carpet":
      for (let i = 0; i < 40; i++) {
        const h = (tx * 31 + ty * 17 + i * 13) * 2654435761;
        px(ctx, i % 2 ? dark : light, ox + ((h >>> 8) % 31), oy + ((h >>> 16) % 31), 2, 1);
      }
      break;
    case "stone": {
      const shift = ty % 2 ? 11 : 0;
      px(ctx, dark, ox, oy, 32, 1);
      px(ctx, dark, ox, oy + 16, 32, 1);
      px(ctx, dark, ox + shift + 4, oy, 1, 16);
      px(ctx, dark, ox + ((shift + 20) % 32), oy + 16, 1, 16);
      px(ctx, light, ox + 6, oy + 5, 5, 1);
      px(ctx, light, ox + 20, oy + 22, 6, 1);
      break;
    }
    case "marble":
      for (let i = 0; i < 26; i++) {
        const v = ((tx * 7 + ty * 3) % 16) + i;
        px(ctx, shade(c, 0.13), ox + (v * 3) % 32, oy + i, 2, 1);
        px(ctx, dark, ox + (31 - i), oy + (i * 2 + tx) % 32, 1, 1);
      }
      px(ctx, shade(c, -0.14), ox, oy, 32, 1);
      px(ctx, shade(c, -0.14), ox, oy, 1, 32);
      break;
    default:
      // Planks, joints staggered.
      for (let r = 0; r < 32; r += 8) {
        px(ctx, dark, ox, oy + r, 32, 1);
        px(ctx, light, ox, oy + r + 1, 32, 1);
        px(ctx, dark, ox + ((tx * 13 + ty * 5 + r * 3) % 32), oy + r, 1, 8);
      }
  }
}

function paintWallpaper(ctx: CanvasRenderingContext2D, x0: number, y0: number, h: number, v: number) {
  const s = skin ?? PLAIN_SKIN;
  const c = s.wallColor;
  px(ctx, c, x0, y0, 32, h);
  const dark = shade(c, -0.1);
  const light = shade(c, 0.08);
  switch (s.wall) {
    case "stripes":
      for (let x = 0; x < 32; x += 8) px(ctx, dark, x0 + x, y0, 4, h);
      break;
    case "damask":
      for (let y = 0; y < h; y += 14) {
        for (let x = (y % 28 ? 8 : 0); x < 32; x += 16) {
          disc(ctx, dark, x0 + x, y0 + y + 6, 3);
          px(ctx, dark, x0 + x, y0 + y, 1, 13);
          px(ctx, dark, x0 + x - 4, y0 + y + 6, 9, 1);
        }
      }
      break;
    case "brick":
      for (let y = 0; y < h; y += 8) {
        px(ctx, light, x0, y0 + y, 32, 1);
        for (let x = y % 16 ? 8 : 0; x < 32; x += 16) px(ctx, light, x0 + x, y0 + y, 1, 8);
        px(ctx, dark, x0 + ((v * 7 + y) % 26), y0 + y + 3, 5, 2);
      }
      break;
    case "panels":
      for (let x = 0; x < 32; x += 16) {
        px(ctx, dark, x0 + x, y0, 1, h);
        px(ctx, light, x0 + x + 1, y0, 1, h);
      }
      break;
    case "stars":
      for (let i = 0; i < 7; i++) {
        const x = (v * 11 + i * 9) % 30;
        const y = (i * 13 + v * 5) % Math.max(1, h - 2);
        px(ctx, light, x0 + x, y0 + y + 1, 3, 1);
        px(ctx, light, x0 + x + 1, y0 + y, 1, 3);
      }
      break;
    case "floral":
      for (let y = 4; y < h; y += 13) {
        for (let x = (y % 2 ? 6 : 14); x < 32; x += 16) {
          for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) disc(ctx, shade(c, -0.14), x0 + x + dx, y0 + y + dy, 1.4);
          disc(ctx, light, x0 + x, y0 + y, 1.2);
        }
      }
      break;
  }
}

/** A home's wall tiles, in the skin of the moment. */
export function homeWall(kind: string, variant: number): Texture {
  const s = skin ?? PLAIN_SKIN;
  const key = `${kind}:${variant % 4}:${s.wall}:${s.wallColor}`;
  const had = walls.get(key);
  if (had) return had;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const trim = "#5a3d28";
  if (kind === "home_wall_cap") {
    // Seen from above: the wall's top, dark as the room's edge.
    c.width = 32;
    c.height = 36;
    px(ctx, "#2b1f17", 0, 0, 32, 36);
    px(ctx, trim, 6, 0, 20, 34);
    px(ctx, "#6d4b32", 8, 0, 16, 34);
  } else if (kind === "home_wall_low") {
    // The front wall, low enough to see the room over it.
    c.width = 32;
    c.height = 44;
    px(ctx, "#2b1f17", 0, 12, 32, 32);
    px(ctx, trim, 0, 14, 32, 8);
    px(ctx, "#6d4b32", 0, 14, 32, 3);
    paintWallpaper(ctx, 0, 22, 18, variant);
    px(ctx, trim, 0, 38, 32, 5);
  } else {
    c.width = 32;
    c.height = 72;
    px(ctx, "#2b1f17", 0, 0, 32, 72);
    paintWallpaper(ctx, 0, 6, 58, variant);
    // Crown moulding, wainscot rail, skirting.
    px(ctx, trim, 0, 4, 32, 4);
    px(ctx, "#7a5438", 0, 4, 32, 1);
    px(ctx, trim, 0, 48, 32, 2);
    px(ctx, trim, 0, 62, 32, 8);
    px(ctx, "#7a5438", 0, 62, 32, 1);
    px(ctx, "rgba(0,0,0,0.22)", 0, 70, 32, 2);
    if (kind === "home_window") {
      px(ctx, trim, 4, 12, 24, 30);
      px(ctx, "#bfe6ff", 6, 14, 20, 26);
      px(ctx, "#e6f6ff", 6, 14, 20, 7);
      px(ctx, "#9fd07a", 6, 34, 20, 6);
      px(ctx, trim, 15, 14, 2, 26);
      px(ctx, trim, 6, 26, 20, 2);
      px(ctx, "#b5544a", 3, 11, 5, 26);
      px(ctx, "#b5544a", 24, 11, 5, 26);
      px(ctx, "#8f3f37", 5, 11, 1, 26);
      px(ctx, "#8f3f37", 26, 11, 1, 26);
      px(ctx, trim, 2, 42, 28, 3);
    }
  }
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  walls.set(key, t);
  return t;
}

/** The little swatch a wallpaper or flooring shows in your bag. */
function drawSkinIcon(ctx: CanvasRenderingContext2D, key: string, pattern: string, part: string) {
  const old = skin;
  skin = part === "wall" ? { ...PLAIN_SKIN, wall: pattern, wallColor: "#c9a3d8" } : { ...PLAIN_SKIN, floor: pattern, floorColor: "#c79a68" };
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  if (part === "wall") paintWallpaper(g, 0, 0, 32, key.length);
  else paintFloor(g, 0, 0, 1, 1);
  skin = old;
  px(ctx, "#2b2233", 1, 1, 30, 30);
  ctx.drawImage(c, 0, 0, 28, 28, 2, 2, 28, 28);
}

/** Draws a home-life piece at 32×32; false if `key` isn't one. */
export function drawHomeLife(ctx: CanvasRenderingContext2D, key: string, meta?: { skin?: string; pattern?: string }): boolean {
  const O = "#2b2233";
  if (meta?.skin && meta.pattern) {
    drawSkinIcon(ctx, key, meta.pattern, meta.skin);
    return true;
  }
  switch (key) {
    case "round_pond":
      ctx.drawImage(pondCanvas(), 0, 0, 32, 32);
      return true;
    case "shovel":
      px(ctx, O, 21, 2, 8, 4);
      px(ctx, "#c8a06a", 22, 3, 6, 2);
      px(ctx, O, 23, 5, 4, 15);
      px(ctx, "#a97545", 24, 5, 2, 15);
      px(ctx, O, 7, 18, 20, 3);
      px(ctx, O, 9, 21, 16, 5);
      px(ctx, O, 12, 26, 10, 3);
      px(ctx, O, 15, 29, 4, 2);
      px(ctx, "#b8c0ca", 9, 19, 16, 2);
      px(ctx, "#9aa4b0", 10, 21, 14, 5);
      px(ctx, "#b8c0ca", 13, 26, 8, 2);
      return true;
    case "lawn_chair":
      // A folding lawn chair: a white frame, striped webbing.
      px(ctx, "rgba(0,0,0,0.18)", 6, 28, 21, 3);
      px(ctx, O, 7, 6, 18, 3);
      px(ctx, O, 7, 6, 3, 24);
      px(ctx, O, 22, 6, 3, 24);
      px(ctx, "#f4f1ea", 8, 7, 16, 1);
      px(ctx, "#f4f1ea", 8, 7, 1, 22);
      px(ctx, "#f4f1ea", 23, 7, 1, 22);
      for (let y = 9; y < 26; y += 4) {
        px(ctx, "#4f86d8", 10, y, 12, 2);
        px(ctx, "#f2c94c", 10, y + 2, 12, 2);
      }
      px(ctx, O, 7, 18, 18, 2);
      px(ctx, "#f4f1ea", 8, 18, 16, 1);
      return true;
    case "planter_pot":
      px(ctx, "rgba(0,0,0,0.2)", 7, 28, 18, 3);
      px(ctx, O, 6, 15, 20, 3);
      px(ctx, "#c8693f", 7, 16, 18, 2);
      px(ctx, O, 8, 18, 16, 12);
      px(ctx, "#b5583a", 9, 18, 14, 11);
      px(ctx, "#d98559", 10, 18, 3, 11);
      px(ctx, "#4a3322", 8, 14, 16, 2);
      return true;
    case "uv_light":
      px(ctx, O, 15, 8, 2, 20);
      px(ctx, O, 10, 28, 12, 3);
      px(ctx, "#6a6a7a", 11, 29, 10, 1);
      px(ctx, O, 3, 3, 26, 7);
      px(ctx, "#4a4a5a", 4, 4, 24, 3);
      px(ctx, "#d58cff", 5, 7, 22, 2);
      px(ctx, "#f4dcff", 8, 7, 16, 1);
      return true;
    case "display_shelf":
      px(ctx, O, 3, 1, 26, 30);
      px(ctx, "#8a5a33", 4, 2, 24, 28);
      px(ctx, "#5f3d22", 6, 4, 20, 11);
      px(ctx, "#5f3d22", 6, 17, 20, 11);
      px(ctx, "#a97545", 6, 15, 20, 2);
      px(ctx, "#a97545", 4, 2, 24, 1);
      return true;
    case "fish_food":
      px(ctx, O, 8, 6, 16, 24);
      px(ctx, "#e8a13a", 9, 7, 14, 22);
      px(ctx, "#f8f0e0", 9, 13, 14, 9);
      px(ctx, "#4f86d8", 13, 16, 6, 3);
      px(ctx, "#4f86d8", 19, 15, 2, 5);
      px(ctx, O, 10, 2, 12, 5);
      px(ctx, "#c8323a", 11, 3, 10, 3);
      return true;
  }
  return false;
}

let pond: HTMLCanvasElement | null = null;
let pondTex: Texture | null = null;

/** The garden pond, as a preview and in your bag: soft-cornered water, 64×64 (two tiles by two). */
function pondCanvas(): HTMLCanvasElement {
  if (pond) return pond;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e8f6fb";
  g.beginPath();
  g.roundRect(0, 0, 64, 64, 12);
  g.fill();
  g.fillStyle = "#5ea9c8";
  g.beginPath();
  g.roundRect(2, 2, 60, 60, 10);
  g.fill();
  px(g, "#4f97b8", 14, 20, 12, 2);
  px(g, "#4f97b8", 36, 42, 14, 2);
  pond = c;
  return c;
}

export function pondTexture(): Texture {
  if (!pondTex) {
    pondTex = Texture.from(pondCanvas());
    pondTex.source.scaleMode = "nearest";
  }
  return pondTex;
}
