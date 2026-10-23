// The Casino's art (ADR 0017): the building on the Casino block (deep green
// with gold trim, card-suit windows and a marquee of bulbs), and inside the
// slot machines, the roulette table on its baize, the cashier's cage and
// the way out.

import type { MapObject } from "./map";
import { disc, polygon } from "./pixeldraw";
import { canPixel, drawPixelText, pixelWidth } from "./pixelfont";

const O = "#3b3a2e";
const TILE = 32;
const GOLD = "#d8b45a";

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

/** A card suit, `s` of ♠♥♦♣, in a 12-px box at (x, y). */
function suit(ctx: CanvasRenderingContext2D, s: number, x: number, y: number, color: string) {
  if (s === 1 || s === 0) {
    // Heart (spade upside down).
    disc(ctx, color, x + 3, y + 4, 3);
    disc(ctx, color, x + 8, y + 4, 3);
    polygon(ctx, color, s === 1 ? [[x, y + 5], [x + 11, y + 5], [x + 5.5, y + 11]] : [[x, y + 6], [x + 11, y + 6], [x + 5.5, y]]);
    if (s === 0) px(ctx, color, x + 5, y + 7, 2, 5);
  } else if (s === 2) {
    polygon(ctx, color, [[x + 5.5, y], [x + 11, y + 6], [x + 5.5, y + 12], [x, y + 6]]);
  } else {
    disc(ctx, color, x + 5.5, y + 3, 3);
    disc(ctx, color, x + 2.5, y + 7, 3);
    disc(ctx, color, x + 8.5, y + 7, 3);
    px(ctx, color, x + 5, y + 7, 2, 5);
  }
}

export function casinoObject(o: MapObject): { c: HTMLCanvasElement; overhang: number } | null {
  const w = o.w * TILE;
  const h = o.h * TILE;
  switch (o.kind) {
    case "casino": {
      const top = 76;
      const [c, ctx] = canvas(w, h + top);
      const ft = top + h;
      const green = "#1f4a3a";
      px(ctx, "rgba(0,0,0,0.2)", 10, ft - 8, w - 20, 8);
      // A stepped parapet with gold caps.
      px(ctx, O, 10, 30, w - 20, ft - 36);
      px(ctx, green, 12, 32, w - 24, ft - 40);
      for (let x = 12; x < w - 12; x += 40) {
        px(ctx, O, x, 18, 24, 14);
        px(ctx, green, x + 2, 20, 20, 12);
        px(ctx, GOLD, x, 18, 24, 3);
      }
      px(ctx, GOLD, 12, 32, w - 24, 3);
      px(ctx, GOLD, 12, ft - 12, w - 24, 3);
      // Card-suit windows, lit warm.
      const xs = [40, 104, w - 148, w - 84];
      xs.forEach((x, i) => {
        px(ctx, O, x - 2, 98, 48, 60);
        px(ctx, "#f6d98a", x, 100, 44, 56);
        suit(ctx, i % 4, x + 16, 120, i % 4 === 1 || i % 4 === 2 ? "#c8553d" : O);
      });
      // The marquee in bulbs.
      px(ctx, O, w / 2 - 110, 44, 220, 42);
      px(ctx, "#8f1f2b", w / 2 - 108, 46, 216, 38);
      text(ctx, "CASINO", w / 2, 65, "#fff2b8", 200, 3);
      for (let x = w / 2 - 102; x < w / 2 + 106; x += 12) {
        disc(ctx, "#ffe9a8", x, 49, 2);
        disc(ctx, "#ffe9a8", x, 81, 2);
      }
      // Revolving-style doors under a gold canopy.
      const dw = 80;
      px(ctx, O, w / 2 - dw / 2 - 12, ft - 112, dw + 24, 14);
      px(ctx, GOLD, w / 2 - dw / 2 - 10, ft - 110, dw + 20, 10);
      px(ctx, O, w / 2 - dw / 2 - 2, ft - 98, dw + 4, 94);
      px(ctx, "#2b2723", w / 2 - dw / 2, ft - 96, dw, 90);
      for (const x of [w / 2 - dw / 2 + 4, w / 2 + 4]) px(ctx, "#f6d98a", x, ft - 90, dw / 2 - 8, 70);
      px(ctx, O, w / 2 - 1, ft - 96, 2, 90);
      px(ctx, "#8f1f2b", w / 2 - dw / 2 - 16, ft - 8, dw + 32, 6);
      return { c, overhang: top };
    }
    case "slot_machine": {
      // A cabinet with three reel windows, a lit top, a pay tray and a lever.
      const [c, ctx] = canvas(w + 8, h + 32);
      px(ctx, "rgba(0,0,0,0.2)", 4, c.height - 6, w - 6, 5);
      px(ctx, O, 2, 6, w - 4, c.height - 10);
      px(ctx, "#8f1f2b", 4, 8, w - 8, c.height - 14);
      px(ctx, O, 6, 2, w - 12, 12);
      px(ctx, "#ffe9a8", 7, 3, w - 14, 10);
      text(ctx, "777", w / 2, 8, "#c8553d", w - 18);
      px(ctx, O, 8, 22, w - 16, 20);
      for (let i = 0; i < 3; i++) {
        const x = 9 + i * ((w - 18) / 3);
        px(ctx, "#fff8e3", x, 23, (w - 18) / 3 - 1, 18);
      }
      px(ctx, "#c8553d", 12, 30, 4, 4);
      disc(ctx, "#e0a43a", w / 2, 32, 3);
      px(ctx, "#5d8a4e", w - 18, 30, 4, 4);
      px(ctx, O, 10, c.height - 22, w - 20, 8);
      px(ctx, GOLD, 11, c.height - 21, w - 22, 6);
      // The lever.
      px(ctx, O, w - 2, 18, 4, 26);
      disc(ctx, O, w, 16, 5);
      disc(ctx, "#c8553d", w, 16, 4);
      return { c, overhang: 32 };
    }
    case "roulette_table": {
      // Green baize on a wooden rim: the wheel at one end, the numbers at the other.
      const [c, ctx] = canvas(w, h + 16);
      px(ctx, "rgba(0,0,0,0.22)", 6, c.height - 8, w - 12, 8);
      px(ctx, O, 2, 4, w - 4, c.height - 10);
      px(ctx, "#6e4b30", 3, 5, w - 6, c.height - 12);
      px(ctx, "#2f6f4a", 9, 11, w - 18, c.height - 24);
      // The wheel.
      const cx = 48;
      const cy = c.height / 2 - 2;
      disc(ctx, O, cx, cy, 30);
      disc(ctx, "#6e4b30", cx, cy, 29);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        ctx.fillStyle = i % 2 ? "#c8553d" : "#2b2723";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, 25, a, a + Math.PI / 9);
        ctx.fill();
      }
      disc(ctx, GOLD, cx, cy, 10);
      disc(ctx, "#fff8e3", cx + 18, cy - 10, 2);
      // The betting layout.
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 12; k++) {
          const x = 90 + k * 13;
          const y = 20 + r * 20;
          const n = k * 3 + (3 - r);
          const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(n);
          if (x + 12 > w - 10) continue;
          px(ctx, "#fff8e3", x, y, 12, 18);
          px(ctx, red ? "#c8553d" : "#2b2723", x + 1, y + 1, 10, 16);
        }
      }
      return { c, overhang: 16 };
    }
    case "casino_cage": {
      // The cashier's window: brass bars, a counter, stacks of coins.
      const [c, ctx] = canvas(w, h + 40);
      px(ctx, O, 0, 0, w, c.height - 4);
      px(ctx, "#6e4b30", 1, 1, w - 2, c.height - 6);
      px(ctx, "#f6d98a", 6, 10, w - 12, 34);
      for (let x = 8; x < w - 6; x += 7) px(ctx, GOLD, x, 10, 2, 34);
      px(ctx, O, 2, 2, w - 4, 8);
      px(ctx, "#8f1f2b", 3, 3, w - 6, 6);
      text(ctx, "CASHIER", w / 2, 6, "#fff2b8", w - 8);
      px(ctx, "#8a5a33", 0, 44, w, 8);
      for (const x of [14, 26, w - 30]) {
        for (let i = 0; i < 4; i++) {
          disc(ctx, O, x, 44 - i * 3, 5);
          disc(ctx, "#e0a43a", x, 43 - i * 3, 4);
        }
      }
      return { c, overhang: 40 };
    }
    case "casino_exit": {
      const [c, ctx] = canvas(w, h + 16);
      px(ctx, O, 0, 0, w, h + 16);
      px(ctx, "#cfe8b8", 3, 3, w - 6, h + 10);
      px(ctx, "#8f1f2b", 6, h + 4, w - 12, 10);
      text(ctx, "EXIT", w / 2, h / 2 + 6, O, w - 8);
      return { c, overhang: 16 };
    }
  }
  return null;
}
