// The Concert Hall's art (ADR 0015): the building on the Theater block (a
// cream music hall with a marquee and arched windows); inside, the velvet
// backdrop (it reads LIVE and the performer's name while someone's on), the
// stage boards with footlights, the microphone stand, the speakers.

import type { MapObject } from "./map";
import { disc, polygon } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

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

function text(ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, color: string, maxW: number, scale = 1) {
  if (!canPixel(s)) return;
  while (scale > 1 && pixelWidth(s, scale) > maxW) scale--;
  if (pixelWidth(s, scale) > maxW) return;
  drawPixelText(ctx, s, Math.round(cx - pixelWidth(s, scale) / 2), Math.round(cy - (5 * scale) / 2), color, scale);
}

/** A concert object's art: drawn from `overhang` px above its footprint. */
export function concertObject(o: MapObject): { c: HTMLCanvasElement; overhang: number } | null {
  const w = o.w * TILE;
  const h = o.h * TILE;
  switch (o.kind) {
    case "concert_hall": {
      // A cream music hall: a stepped gable, tall arched windows, a
      // marquee of bulbs over the doors, and a treble clef on the gable.
      const top = 80;
      const [c, ctx] = canvas(w, h + top);
      const ft = top + h;
      const cream = "#efe3cf";
      const shade = "#d8c8a8";
      px(ctx, "rgba(0,0,0,0.18)", 10, ft - 8, w - 20, 8);
      polygon(ctx, O, [
        [w / 2 - 90, 40],
        [w / 2, 2],
        [w / 2 + 90, 40],
      ]);
      polygon(ctx, cream, [
        [w / 2 - 84, 39],
        [w / 2, 6],
        [w / 2 + 84, 39],
      ]);
      disc(ctx, O, w / 2, 26, 11);
      disc(ctx, "#c8553d", w / 2, 26, 10);
      text(ctx, "♪", w / 2, 26, "#fff8e3", 18, 2);
      px(ctx, O, 12, 38, w - 24, ft - 38 - 6);
      px(ctx, cream, 14, 40, w - 28, ft - 42 - 6);
      px(ctx, shade, 14, 40, w - 28, 6);
      // Arched windows with warm light.
      for (const x of [40, 104, w - 136, w - 72]) {
        px(ctx, O, x - 2, 72, 36, 110);
        disc(ctx, O, x + 16, 72, 18);
        px(ctx, "#f6d98a", x, 74, 32, 106);
        disc(ctx, "#f6d98a", x + 16, 74, 16);
        px(ctx, O, x + 15, 60, 2, 120);
        px(ctx, O, x, 120, 32, 2);
      }
      // The marquee: CONCERT HALL in lights.
      px(ctx, O, w / 2 - 120, ft - 150, 240, 40);
      px(ctx, "#8f3a2b", w / 2 - 118, ft - 148, 236, 36);
      text(ctx, "CONCERT HALL", w / 2, ft - 130, "#fff2b8", 220, 2);
      for (let x = w / 2 - 114; x < w / 2 + 116; x += 10) {
        disc(ctx, "#ffe9a8", x, ft - 146, 2);
        disc(ctx, "#ffe9a8", x, ft - 115, 2);
      }
      // Doors.
      const dw = 84;
      px(ctx, O, w / 2 - dw / 2 - 2, ft - 96, dw + 4, 92);
      px(ctx, "#6e2e2e", w / 2 - dw / 2, ft - 94, dw, 88);
      px(ctx, "#4e1f1f", w / 2 - 1, ft - 94, 2, 88);
      px(ctx, "#f6d98a", w / 2 - dw / 2 + 8, ft - 86, dw / 2 - 16, 22);
      px(ctx, "#f6d98a", w / 2 + 8, ft - 86, dw / 2 - 16, 22);
      px(ctx, O, w / 2 - dw / 2 - 12, ft - 8, dw + 24, 8);
      px(ctx, "#cfc5b1", w / 2 - dw / 2 - 11, ft - 7, dw + 22, 6);
      return { c, overhang: top };
    }
    case "concert_curtain": {
      // Velvet folds across the back of the stage, a pelmet with gold
      // fringe, and over it a board: LIVE and the name while someone's on.
      const [c, ctx] = canvas(w, h + 56);
      for (let x = 0; x < w; x += 8) {
        px(ctx, x % 16 ? "#7a1f2b" : "#8f2a36", x, 14, 8, c.height - 14);
        px(ctx, "#5e1620", x + 7, 14, 1, c.height - 14);
      }
      px(ctx, O, 0, 8, w, 10);
      px(ctx, "#a8323f", 0, 9, w, 7);
      for (let x = 2; x < w; x += 6) px(ctx, "#d8b45a", x, 16, 3, 4);
      const live = !!o.title;
      px(ctx, O, w / 2 - 110, 22, 220, 28);
      px(ctx, live ? "#2b1d0c" : "#3d3328", w / 2 - 108, 24, 216, 24);
      if (live) {
        disc(ctx, "#ff4f4f", w / 2 - 92, 36, 5);
        text(ctx, "LIVE", w / 2 - 66, 36, "#ff8a8a", 40);
        text(ctx, (o.title ?? "").toUpperCase(), w / 2 + 22, 36, "#fff2b8", 150, 2);
      } else text(ctx, "THE STAGE IS FREE", w / 2, 36, "#c9bfa6", 200);
      return { c, overhang: 56 };
    }
    case "concert_stage": {
      // Boards, a lip at the front and footlights (lit while someone's on).
      const [c, ctx] = canvas(w, h);
      px(ctx, "#8a5a33", 0, 0, w, h);
      for (let y = 0; y < h - 10; y += 8) px(ctx, "#7d5232", 0, y, w, 1);
      for (let x = 0; x < w; x += 48) px(ctx, "#6e4b30", x + ((x / 48) % 2) * 24, 0, 1, h - 10);
      px(ctx, O, 0, h - 10, w, 10);
      px(ctx, "#5a3a22", 0, h - 9, w, 8);
      const lit = !!o.title;
      for (let x = 16; x < w; x += 32) {
        disc(ctx, O, x, h - 5, 4);
        disc(ctx, lit ? "#ffe9a8" : "#8a7a5a", x, h - 5, 3);
        if (lit) px(ctx, "rgba(255,233,168,0.18)", x - 10, h - 40, 20, 32);
      }
      return { c, overhang: 0 };
    }
    case "concert_mic": {
      // A microphone on a stand.
      const [c, ctx] = canvas(w, h + 28);
      px(ctx, "rgba(0,0,0,0.2)", 8, c.height - 4, 16, 3);
      px(ctx, O, 15, 8, 3, c.height - 10);
      px(ctx, O, 9, c.height - 4, 15, 3);
      disc(ctx, O, 16, 6, 6);
      disc(ctx, "#b9b2a0", 16, 6, 5);
      for (let y = 3; y < 9; y += 2) px(ctx, "#8a8578", 13, y, 7, 1);
      return { c, overhang: 28 };
    }
    case "concert_speaker": {
      const [c, ctx] = canvas(w, h + 16);
      px(ctx, O, 2, 0, w - 4, c.height - 2);
      px(ctx, "#2e2b28", 3, 1, w - 6, c.height - 4);
      disc(ctx, O, w / 2, 16, 9);
      disc(ctx, "#4a4642", w / 2, 16, 8);
      disc(ctx, "#2e2b28", w / 2, 16, 3);
      disc(ctx, O, w / 2, c.height - 22, 11);
      disc(ctx, "#4a4642", w / 2, c.height - 22, 10);
      disc(ctx, "#2e2b28", w / 2, c.height - 22, 4);
      return { c, overhang: 16 };
    }
    case "concert_exit": {
      const [c, ctx] = canvas(w, h + 16);
      px(ctx, O, 0, 0, w, h + 16);
      px(ctx, "#cfe8b8", 3, 3, w - 6, h + 10);
      px(ctx, "#8f3a2b", 6, h + 4, w - 12, 10);
      text(ctx, "EXIT", w / 2, h / 2 + 6, O, w - 8);
      return { c, overhang: 16 };
    }
  }
  return null;
}
