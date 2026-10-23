// A metro station's entrance (ADR 0016): green railings round stairs going
// down into the warm light below, and on a post the round red M sign with
// the station's name under it.

import type { MapObject } from "./map";
import { disc } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

const O = "#3b3a2e";
const TILE = 32;

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function text(ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, color: string, maxW: number, scale = 1) {
  if (!canPixel(s)) return;
  while (scale > 1 && pixelWidth(s, scale) > maxW) scale--;
  if (pixelWidth(s, scale) > maxW) return;
  drawPixelText(ctx, s, Math.round(cx - pixelWidth(s, scale) / 2), Math.round(cy - (5 * scale) / 2), color, scale);
}

export function metroObject(o: MapObject): { c: HTMLCanvasElement; overhang: number } | null {
  if (o.kind !== "metro_entrance") return null;
  const w = o.w * TILE;
  const h = o.h * TILE;
  const top = 56;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h + top;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const ft = top + h;
  // The opening: steps going down into the light.
  px(ctx, O, 6, top + 6, w - 12, h - 8);
  for (let i = 0; i < 6; i++) {
    const y = top + 8 + i * 8;
    const shade = Math.round(150 - i * 18);
    px(ctx, `rgb(${shade}, ${shade - 8}, ${shade - 20})`, 8, y, w - 16, 6);
    px(ctx, `rgb(${shade + 30}, ${shade + 22}, ${shade + 6})`, 8, y, w - 16, 1);
  }
  px(ctx, "rgba(255, 220, 140, 0.35)", 8, ft - 18, w - 16, 14);
  // Railings on three sides, the way in at the front.
  const rail = "#3f7a5a";
  for (const x of [4, w - 8]) {
    px(ctx, O, x, top - 2, 4, h);
    px(ctx, rail, x + 1, top - 1, 2, h - 2);
  }
  px(ctx, O, 4, top - 4, w - 8, 4);
  px(ctx, rail, 5, top - 3, w - 10, 2);
  for (let x = 12; x < w - 10; x += 8) px(ctx, rail, x, top - 2, 2, 8);
  disc(ctx, "#d8b45a", 6, top - 3, 2);
  disc(ctx, "#d8b45a", w - 6, top - 3, 2);
  // The sign on its post: the red M, and the name under it.
  const sx = w - 12;
  px(ctx, O, sx - 2, 10, 4, top - 10);
  disc(ctx, O, sx, 12, 12);
  disc(ctx, "#c8553d", sx, 12, 10);
  text(ctx, "M", sx, 12, "#fff8e3", 16, 2);
  const name = (o.label ?? "").toUpperCase();
  px(ctx, O, 2, 26, sx - 14, 12);
  px(ctx, "#fff8e3", 3, 27, sx - 16, 10);
  text(ctx, name, 3 + (sx - 16) / 2, 32, O, sx - 18);
  return { c, overhang: top };
}
