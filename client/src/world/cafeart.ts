// The Cozy Cup café's art (ADR 0021): fireside armchairs, the long counter
// (beer taps at one end, the coffee machine, cups and a cake stand at the
// other), the shelves behind it (bottles, then coffee jars and mugs) and
// the chalkboard menu. Drawn at 32×32 a tile like the rest.

import { Texture } from "pixi.js";
import type { MapObject } from "./map";
import { oval } from "./pixeldraw";

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

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function texture(c: HTMLCanvasElement): Texture {
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  return t;
}

const cache = new Map<string, Texture>();

/** The café's decor (the armchair), or null if it isn't one of ours. */
export function cafeDecor(kind: string): Texture | null {
  if (kind !== "armchair") return null;
  const hit = cache.get(kind);
  if (hit) return hit;
  // A deep, worn armchair in moss-green velvet with a cream cushion.
  const [c, ctx] = canvas(32, 36);
  px(ctx, "rgba(0,0,0,0.2)", 4, 32, 24, 3);
  // back
  px(ctx, O, 6, 3, 20, 20);
  px(ctx, "#4f7a4a", 7, 4, 18, 18);
  px(ctx, "#62905a", 9, 6, 14, 3);
  px(ctx, "#3f6338", 15, 8, 2, 12);
  // arms
  px(ctx, O, 2, 13, 8, 18);
  px(ctx, O, 22, 13, 8, 18);
  px(ctx, "#4f7a4a", 3, 14, 6, 16);
  px(ctx, "#4f7a4a", 23, 14, 6, 16);
  px(ctx, "#62905a", 3, 14, 6, 2);
  px(ctx, "#62905a", 23, 14, 6, 2);
  // seat cushion
  px(ctx, O, 9, 19, 14, 9);
  px(ctx, "#efe2c4", 10, 20, 12, 7);
  px(ctx, "#d9c79f", 10, 25, 12, 2);
  // legs
  px(ctx, "#5a3a22", 4, 30, 3, 3);
  px(ctx, "#5a3a22", 25, 30, 3, 3);
  const t = texture(c);
  cache.set(kind, t);
  return t;
}

/** A coffee cup on a saucer, its steam above it. */
function cup(ctx: CanvasRenderingContext2D, x: number, y: number, steam = false) {
  px(ctx, O, x - 1, y + 6, 11, 2);
  px(ctx, "#f4ead2", x, y + 6, 9, 1);
  px(ctx, O, x + 1, y, 7, 7);
  px(ctx, "#fff8e3", x + 2, y + 1, 5, 5);
  px(ctx, "#6b4227", x + 2, y + 1, 5, 1);
  px(ctx, O, x + 8, y + 2, 2, 3);
  if (steam) {
    px(ctx, "rgba(255,255,255,0.55)", x + 3, y - 4, 1, 3);
    px(ctx, "rgba(255,255,255,0.45)", x + 5, y - 7, 1, 3);
  }
}

/** The café's objects (counter, shelves, menu), or null. */
export function cafeObject(o: MapObject): { texture: Texture; overhang: number; left: number } | null {
  if (o.kind !== "bar_counter" && o.kind !== "bottle_shelf" && o.kind !== "menu_board") return null;
  const key = `${o.kind}:${o.w}x${o.h}`;
  const w = o.w * TILE;
  const h = o.h * TILE;
  const hit = cache.get(key);
  const top = o.kind === "bar_counter" ? 30 : 40;
  if (hit) return { texture: hit, overhang: top, left: 0 };
  const [c, ctx] = canvas(w, h + top);
  if (o.kind === "bar_counter") {
    // The long counter: a polished top on a panelled front.
    px(ctx, O, 0, top - 6, w, h + 4);
    px(ctx, "#7d5232", 2, top, w - 4, h - 4);
    for (let x = 10; x < w - 10; x += 32) {
      px(ctx, "#5a3a22", x, top + 4, 24, h - 12);
      px(ctx, "#8a5a33", x + 2, top + 6, 20, h - 16);
    }
    px(ctx, "#c99567", 0, top - 10, w, 6);
    px(ctx, "#e0b47f", 0, top - 10, w, 2);
    px(ctx, O, 0, top - 11, w, 1);
    // The bar end: three taps and a mug.
    for (const [i, tx] of [40, 52, 64].entries()) {
      px(ctx, "#9aa0a6", tx, top - 22, 4, 12);
      px(ctx, O, tx - 1, top - 26, 6, 5);
      px(ctx, ["#c8553d", "#e9b949", "#5f8f4e"][i], tx, top - 25, 4, 3);
    }
    px(ctx, O, 84, top - 20, 9, 11);
    px(ctx, "#e9b949", 85, top - 17, 7, 7);
    px(ctx, "#fff8e3", 85, top - 19, 7, 3);
    px(ctx, O, 93, top - 16, 2, 5);
    // The coffee end: the espresso machine, all chrome and copper.
    const ex = Math.max(140, w - 190);
    px(ctx, O, ex, top - 30, 46, 21);
    px(ctx, "#c0c6cc", ex + 1, top - 29, 44, 19);
    px(ctx, "#e6eaee", ex + 2, top - 28, 42, 3);
    px(ctx, "#b5703f", ex + 1, top - 22, 44, 3);
    for (const gx of [ex + 8, ex + 30]) {
      px(ctx, O, gx, top - 18, 8, 4);
      px(ctx, "#6e7378", gx + 1, top - 17, 6, 2);
    }
    px(ctx, O, ex + 20, top - 27, 6, 6);
    px(ctx, "#f4ead2", ex + 21, top - 26, 4, 4);
    px(ctx, "#c8553d", ex + 23, top - 25, 1, 2);
    cup(ctx, ex + 8, top - 18, true);
    // Cups waiting, steaming.
    cup(ctx, ex + 56, top - 19, true);
    cup(ctx, ex + 70, top - 19);
    // A cake stand under a glass dome: a strawberry cake, a slice gone.
    const cx = w - 70;
    px(ctx, O, cx + 13, top - 12, 2, 3);
    px(ctx, O, cx + 4, top - 13, 20, 2);
    oval(ctx, "rgba(220,240,255,0.35)", cx + 14, top - 22, 12, 11);
    px(ctx, O, cx + 6, top - 22, 16, 9);
    px(ctx, "#f2c9d4", cx + 7, top - 21, 14, 7);
    px(ctx, "#fff3f6", cx + 7, top - 21, 14, 2);
    px(ctx, "#c8553d", cx + 9, top - 24, 3, 3);
    px(ctx, "#c8553d", cx + 15, top - 24, 3, 3);
    px(ctx, "#a0703f", cx + 18, top - 21, 3, 7);
    px(ctx, "rgba(255,255,255,0.6)", cx + 5, top - 29, 2, 6);
    // A plate of croissants.
    const px0 = w - 36;
    oval(ctx, O, px0 + 10, top - 12, 11, 3);
    oval(ctx, "#f4ead2", px0 + 10, top - 12, 10, 2);
    for (const dx of [3, 11]) {
      oval(ctx, O, px0 + dx + 3, top - 16, 5, 3);
      oval(ctx, "#e0a24f", px0 + dx + 3, top - 16, 4, 2);
      px(ctx, "#f6c878", px0 + dx + 1, top - 17, 3, 1);
    }
  } else if (o.kind === "bottle_shelf") {
    // Shelves on the back wall: bottles at the bar end, then coffee jars,
    // mugs on hooks and a sack of beans.
    px(ctx, O, 0, top - 38, w, h + 34);
    px(ctx, "#6e4b30", 2, top - 36, w - 4, h + 30);
    const colors = ["#5f8f4e", "#8f3a2b", "#e9b949", "#5f8fc4", "#9b7fd4", "#c8553d", "#3f7a4a"];
    const split = Math.min(w - 8, 150);
    for (const sy of [top - 14, top + 14]) {
      px(ctx, "#4e3420", 2, sy, w - 4, 3);
      for (let x = 6; x < split; x += 9) {
        const k = (x * 7 + sy) % colors.length;
        const tall = (x + sy) % 3 === 0 ? 14 : 11;
        px(ctx, O, x, sy - tall, 6, tall);
        px(ctx, colors[k], x + 1, sy - tall + 1, 4, tall - 1);
        px(ctx, O, x + 2, sy - tall - 3, 2, 3);
        px(ctx, "rgba(255,255,255,0.35)", x + 1, sy - tall + 3, 1, 4);
      }
      for (let x = split + 8, i = 0; x < w - 18; x += 18, i++) {
        if (sy < top) {
          // Glass jars of beans, light roast to dark.
          px(ctx, O, x, sy - 14, 12, 14);
          px(ctx, "rgba(220,240,255,0.5)", x + 1, sy - 13, 10, 12);
          px(ctx, ["#8a5a33", "#6b4227", "#4a2c18"][i % 3], x + 1, sy - 9, 10, 8);
          px(ctx, "#c99567", x, sy - 16, 12, 2);
        } else {
          // Mugs in a row, a different glaze each.
          px(ctx, O, x + 1, sy - 11, 10, 11);
          px(ctx, ["#e8566b", "#5f8fc4", "#f6c343", "#f4ead2", "#5f8f4e"][i % 5], x + 2, sy - 10, 8, 9);
          px(ctx, O, x + 11, sy - 8, 2, 5);
        }
      }
    }
    // The sack of beans on the floor at the end.
    px(ctx, O, w - 18, top + h - 18, 14, 16);
    px(ctx, "#c9ad7c", w - 17, top + h - 17, 12, 14);
    px(ctx, "#6b4227", w - 15, top + h - 20, 8, 4);
  } else {
    // A chalkboard menu in a wooden frame.
    px(ctx, O, 2, top - 36, w - 4, h + 30);
    px(ctx, "#8a5a33", 3, top - 35, w - 6, h + 28);
    px(ctx, "#2e3b33", 7, top - 31, w - 14, h + 20);
    const chalk = "rgba(244,234,210,0.85)";
    // "MENU" as little strokes, then the lines of the day.
    for (let i = 0; i < 4; i++) px(ctx, chalk, w / 2 - 14 + i * 8, top - 27, 5, 4);
    px(ctx, "#f2c9d4", w / 2 - 16, top - 21, 32, 1);
    const lines: [number, string][] = [
      [top - 14, "#f4ead2"],
      [top - 7, "#f6c343"],
      [top, "#f4ead2"],
      [top + 7, "#9fd6c0"],
    ];
    for (const [y, col] of lines) {
      px(ctx, col, 12, y, w - 44, 2);
      px(ctx, col, w - 26, y, 12, 2);
    }
    // A chalk coffee cup in the corner.
    px(ctx, chalk, 12, top + 19, 8, 1);
    px(ctx, chalk, 13, top + 14, 6, 5);
    px(ctx, chalk, 20, top + 15, 2, 2);
  }
  const t = texture(c);
  cache.set(key, t);
  return { texture: t, overhang: top, left: 0 };
}
