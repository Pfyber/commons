// The Lake's rowboats: a little wooden rowboat (under a captain, with the
// oars dipping as they row; tied up on the water by the pier), and the boat
// hire's hut on the bank.

import type { MapObject } from "./map";
import { drawPixelText, pixelWidth } from "./pixelfont";

const O = "#3b3a2e";
const TILE = 32;

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
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

/** The rowboat's length and height, in pixels; its middle sits `BOAT_MID` px in front of the captain. */
export const BOAT_W = 100;
export const BOAT_H = 30;

/**
 * A rowboat side on, bow to the right, on a `BOAT_W`×`BOAT_H` canvas with
 * the waterline near the bottom: a red-and-cream hull, thwarts, and (with
 * `oars`) a pair of oars, raised (frame 0) or dipped (frame 1).
 */
export function drawRowboat(ctx: CanvasRenderingContext2D, ox: number, oy: number, oars: boolean, frame: 0 | 1) {
  const w = BOAT_W;
  const top = oy + 12;
  // Ripples round the hull.
  px(ctx, "rgba(255,255,255,0.45)", ox + 2, oy + 27, w - 4, 1);
  px(ctx, "rgba(255,255,255,0.25)", ox + 8, oy + 29, w - 16, 1);
  // The hull: a long curve, rising at the bow and the stern.
  for (let x = 0; x < w; x++) {
    const t = x / (w - 1);
    const rise = Math.round(Math.max(0, (0.12 - t) * 40) + Math.max(0, (t - 0.84) * 34));
    const y0 = top - rise;
    const depth = 14 - Math.round(Math.abs(t - 0.5) * 8);
    px(ctx, O, ox + x, y0, 1, depth + 1);
    if (x > 0 && x < w - 1) {
      px(ctx, "#c8553d", ox + x, y0 + 1, 1, Math.max(1, depth - 4));
      px(ctx, "#fff2d6", ox + x, y0 + depth - 3, 1, 2);
      px(ctx, "#8f1f2b", ox + x, y0 + depth - 1, 1, 1);
    }
  }
  // The gunwale and three thwarts (seats) showing over it.
  px(ctx, "#8a5a33", ox + 6, top - 1, w - 18, 2);
  for (const x of [26, 48, 70]) px(ctx, "#6e4b30", ox + x, top - 3, 8, 2);
  if (!oars) return;
  // The oars from the rowlocks by the stern seat: raised, or dipped.
  const lock = { x: ox + 30, y: top - 2 };
  const tip = frame ? { x: lock.x - 22, y: oy + 27 } : { x: lock.x - 26, y: oy + 18 };
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    px(ctx, "#8a5a33", lock.x + (tip.x - lock.x) * t, lock.y + (tip.y - lock.y) * t, 1, 1);
  }
  px(ctx, O, tip.x - 3, tip.y - 1, 5, 3);
  px(ctx, "#d8b45a", tip.x - 2, tip.y, 3, 1);
}

/** The boat under a captain (frame: the oars' stroke). */
export function rowboatCanvas(frame: 0 | 1): HTMLCanvasElement {
  const [c, ctx] = canvas(BOAT_W, BOAT_H);
  drawRowboat(ctx, 0, 0, true, frame);
  return c;
}

export function boatObject(o: MapObject): { c: HTMLCanvasElement; overhang: number } | null {
  const w = o.w * TILE;
  const h = o.h * TILE;
  switch (o.kind) {
    case "boat_moored": {
      // Tied up by the pier, oars shipped, bobbing on its rope.
      const [c, ctx] = canvas(w + 40, h + 8);
      drawRowboat(ctx, 0, h + 8 - BOAT_H, false, 0);
      px(ctx, "#d9c79a", w + 18, h - 12, 20, 1);
      return { c, overhang: 8 };
    }
    case "boat_hire": {
      // A blue clapboard hut with a striped awning, oars crossed on the wall
      // and a sign: BOATS.
      const top = 44;
      const [c, ctx] = canvas(w, h + top);
      const ft = top + h;
      px(ctx, "rgba(0,0,0,0.2)", 6, ft - 6, w - 12, 6);
      // Walls in clapboard.
      px(ctx, O, 6, 26, w - 12, ft - 30);
      for (let y = 28; y < ft - 6; y += 4) {
        px(ctx, "#4f86b0", 8, y, w - 16, 3);
        px(ctx, "#3f6f94", 8, y + 3, w - 16, 1);
      }
      // A pitched roof.
      for (let i = 0; i < 18; i++) px(ctx, i < 2 ? O : "#8f3b2e", 2 + i, 26 - i, w - 4 - i * 2, 1);
      // The striped awning over the counter.
      for (let x = 10; x < w - 10; x += 8) {
        px(ctx, "#fff2d6", x, ft - 44, 4, 8);
        px(ctx, "#c8553d", x + 4, ft - 44, 4, 8);
      }
      px(ctx, O, 10, ft - 36, w - 20, 1);
      // The counter window, and a little boat-shaped sign.
      px(ctx, O, 16, ft - 34, w - 32, 18);
      px(ctx, "#f6d98a", 18, ft - 32, w - 36, 14);
      px(ctx, "#8a5a33", 14, ft - 16, w - 28, 4);
      // Crossed oars on the wall.
      for (let i = 0; i < 18; i++) {
        px(ctx, "#d8b45a", w - 22 + i * 0.6, 30 + i, 1, 1);
        px(ctx, "#d8b45a", w - 11 - i * 0.6, 30 + i, 1, 1);
      }
      // The sign: a plank with BOATS painted on it.
      px(ctx, O, 8, 2, 48, 13);
      px(ctx, "#fff2d6", 9, 3, 46, 11);
      drawPixelText(ctx, "BOATS", Math.round(32 - pixelWidth("BOATS", 1) / 2), 6, "#3f6f94", 1);
      return { c, overhang: top };
    }
  }
  return null;
}
