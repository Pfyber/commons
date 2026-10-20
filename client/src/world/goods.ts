// The last mall shops' goods (ADR 0011, M7): their 16×16 icons, the rod and
// watering can drawn in an avatar's hands, a doorstep gift in its wrapping,
// and the bits of a done-up house (fences, yard decor).

import type { Texture } from "pixi.js";
import { toTexture } from "./art";

const O = "#3b3a2e";

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function canvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  return c;
}

const cache = new Map<string, Texture>();
function cached(key: string, make: () => HTMLCanvasElement): Texture {
  let t = cache.get(key);
  if (!t) {
    t = toTexture(make());
    cache.set(key, t);
  }
  return t;
}

/** Rod colours by code (0: the plain bamboo one everybody has). */
const ROD = ["#c9a95a", "#a0473f", "#2f3440", "#f2c94c"];
/** Watering can colours by code (0: plain green). */
const CAN = ["#5d8a4e", "#c07a4a", "#e8a3b5"];
/** Wrapping paper by code: base colour, pattern colour, pattern. */
const WRAP: Record<number, [string, string, "dots" | "stripes" | "stars" | "plain"]> = {
  0: ["#e8566b", "#f6c343", "plain"],
  1: ["#4f8fc0", "#fff6e6", "dots"],
  2: ["#5d8a4e", "#f2e6c8", "stripes"],
  3: ["#2c3e66", "#f6d64a", "stars"],
  4: ["#b08a5a", "#e9dcc0", "plain"],
};
/** Cards by code: colour and what's on the front. */
export const CARDS: Record<number, { color: string; title: string; icon: string }> = {
  1: { color: "#fff6e6", title: "A thank-you card", icon: "🙏" },
  2: { color: "#f6d0dc", title: "A birthday card", icon: "🎂" },
  3: { color: "#e3f0d4", title: "A flower card", icon: "🌷" },
  4: { color: "#dce8f6", title: "A just-because card", icon: "💌" },
};

/** Draws a rod (pointing up and right from the hand at its bottom left). */
function rod(ctx: CanvasRenderingContext2D, code: number, x: number, y: number, len: number) {
  const c = ROD[code] ?? ROD[0];
  for (let i = 0; i < len; i++) px(ctx, i % 4 === 3 ? O : c, x + Math.floor(i * 0.7), y - i, 2, 1);
  px(ctx, O, x - 1, y - 1, 3, 3);
}

function can(ctx: CanvasRenderingContext2D, code: number, x: number, y: number) {
  const c = CAN[code] ?? CAN[0];
  px(ctx, O, x, y + 2, 9, 7);
  px(ctx, c, x + 1, y + 3, 7, 5);
  px(ctx, O, x + 8, y + 3, 4, 1);
  px(ctx, O, x + 11, y + 1, 2, 3);
  px(ctx, O, x + 2, y, 5, 2);
  if (code === 2) px(ctx, "#fff6e6", x + 3, y + 5, 2, 2);
}

function box(ctx: CanvasRenderingContext2D, wrap: number, x: number, y: number, w: number, h: number) {
  const [base, mark, pattern] = WRAP[wrap] ?? WRAP[0];
  px(ctx, O, x, y, w, h);
  px(ctx, base, x + 1, y + 1, w - 2, h - 2);
  for (let yy = y + 2; yy < y + h - 1; yy += 3) {
    for (let xx = x + 2; xx < x + w - 1; xx += 3) {
      if (pattern === "dots" && (xx + yy) % 2 === 0) px(ctx, mark, xx, yy);
      if (pattern === "stars" && (xx * 3 + yy) % 4 === 0) px(ctx, mark, xx, yy);
    }
    if (pattern === "stripes") px(ctx, mark, x + 1, yy, w - 2, 1);
  }
}

function fencePiece(ctx: CanvasRenderingContext2D, code: number, x: number, y: number, w: number) {
  if (code === 2) {
    // A low hedge.
    px(ctx, O, x, y + 2, w, 8);
    px(ctx, "#4f7d43", x + 1, y + 3, w - 2, 6);
    for (let i = x + 2; i < x + w - 2; i += 4) px(ctx, "#6b9a59", i, y + 4, 2, 2);
    return;
  }
  // White pickets on two rails.
  px(ctx, O, x, y + 4, w, 2);
  px(ctx, O, x, y + 8, w, 2);
  for (let i = x; i < x + w - 2; i += 5) {
    px(ctx, O, i, y, 4, 12);
    px(ctx, "#fbf6ea", i + 1, y + 1, 2, 10);
  }
}

function yard(ctx: CanvasRenderingContext2D, code: number, x: number, y: number) {
  switch (code) {
    case 1: // A gnome with a red hat.
      px(ctx, O, x + 3, y, 6, 6);
      px(ctx, "#d9475b", x + 4, y + 1, 4, 5);
      px(ctx, O, x + 2, y + 6, 8, 9);
      px(ctx, "#f2d2b0", x + 3, y + 6, 6, 3);
      px(ctx, "#f4efe4", x + 3, y + 8, 6, 3);
      px(ctx, "#3f7a8a", x + 3, y + 11, 6, 3);
      break;
    case 2: // A bird bath.
      px(ctx, O, x, y + 3, 14, 4);
      px(ctx, "#c9c2b0", x + 1, y + 4, 12, 2);
      px(ctx, "#7fb5d8", x + 3, y + 4, 8, 1);
      px(ctx, O, x + 5, y + 7, 4, 7);
      px(ctx, "#b2aa96", x + 6, y + 7, 2, 7);
      px(ctx, O, x + 3, y + 13, 8, 2);
      px(ctx, "#e39b4a", x + 9, y + 1, 3, 2);
      break;
    case 3: // A flower arch.
      for (let i = 0; i < 14; i++) {
        const t = (i / 13) * Math.PI;
        const ax = Math.round(x + 7 - Math.cos(t) * 7);
        const ay = Math.round(y + 12 - Math.sin(t) * 11);
        px(ctx, "#4f7d43", ax, ay, 2, 2);
        if (i % 3 === 0) px(ctx, i % 2 ? "#f28c9b" : "#f6d64a", ax, ay - 1, 2, 2);
      }
      px(ctx, "#4f7d43", x, y + 12, 2, 4);
      px(ctx, "#4f7d43", x + 14, y + 12, 2, 4);
      break;
  }
}

function instrument(ctx: CanvasRenderingContext2D, code: number) {
  switch (code) {
    case 3: // Ukulele.
      px(ctx, O, 3, 6, 8, 9);
      px(ctx, "#c98a4a", 4, 7, 6, 7);
      px(ctx, O, 6, 9, 2, 2);
      px(ctx, O, 6, 0, 2, 7);
      px(ctx, "#6e543d", 6, 1, 2, 5);
      break;
    case 4: // Kalimba.
      px(ctx, O, 2, 4, 12, 10);
      px(ctx, "#c9a95a", 3, 5, 10, 8);
      for (let i = 0; i < 5; i++) px(ctx, "#d9d4c6", 4 + i * 2, 3 + Math.abs(2 - i), 1, 6);
      px(ctx, O, 7, 10, 2, 2);
      break;
    default: // Flute.
      for (let i = 0; i < 14; i++) px(ctx, O, 1 + i, 13 - i, 2, 2);
      for (let i = 0; i < 12; i++) px(ctx, "#d9d4c6", 2 + i, 13 - i, 1, 1);
      for (const i of [4, 7, 10]) px(ctx, O, 1 + i, 13 - i, 1, 1);
  }
}

function toy(ctx: CanvasRenderingContext2D, code: number) {
  switch (code) {
    case 8: // Bubble wand.
      px(ctx, O, 7, 7, 2, 8);
      px(ctx, O, 4, 1, 8, 7);
      px(ctx, "#bfe3ee", 5, 2, 6, 5);
      px(ctx, "#fff", 6, 3, 2, 1);
      break;
    case 9: // Kite.
      for (let i = 0; i < 6; i++) {
        px(ctx, "#e8566b", 8 - i, 1 + i, i * 2 + 1, 1);
        px(ctx, "#f6c343", 8 - (5 - i), 7 + i, (5 - i) * 2 + 1, 1);
      }
      px(ctx, O, 8, 1, 1, 12);
      px(ctx, O, 9, 13, 1, 3);
      break;
    case 10: // Yo-yo.
      px(ctx, O, 3, 6, 10, 10);
      px(ctx, "#3f7a8a", 4, 7, 8, 8);
      px(ctx, "#7fb5d8", 7, 7, 2, 8);
      px(ctx, O, 8, 0, 1, 7);
      break;
    default: // Pinwheel.
      px(ctx, O, 7, 7, 2, 9);
      for (const [dx, dy, c] of [
        [0, -5, "#e8566b"],
        [4, 0, "#f6c343"],
        [0, 4, "#4f8fc0"],
        [-5, 0, "#5d8a4e"],
      ] as [number, number, string][]) {
        px(ctx, c, 6 + dx, 6 + dy, 4, 4);
      }
      px(ctx, O, 7, 7, 2, 2);
  }
}

function exterior(ctx: CanvasRenderingContext2D, slot: string, code: number) {
  if (slot === "facade") {
    const [walls] = FACADES[code] ?? FACADES[1];
    // A paint pot.
    px(ctx, O, 3, 4, 10, 11);
    px(ctx, "#c9c2b0", 4, 5, 8, 9);
    px(ctx, walls, 4, 5, 8, 4);
    px(ctx, O, 2, 3, 12, 2);
    px(ctx, walls, 6, 1, 3, 3);
  } else if (slot === "fence") fencePiece(ctx, code, 1, 3, 15);
  else if (slot === "yard") yard(ctx, code, 1, 0);
  else {
    const c = POSTBOX[code] ?? POSTBOX[0];
    px(ctx, O, 7, 9, 2, 7);
    px(ctx, O, 3, 2, 10, 8);
    px(ctx, c[0], 4, 3, 8, 6);
    px(ctx, c[1], 4, 3, 8, 2);
  }
}

/** House colours by facade code: walls, roof. */
export const FACADES: Record<number, [string, string]> = {
  1: ["#cfe0c4", "#5d7a4e"],
  2: ["#f2d0d4", "#a0473f"],
  3: ["#cfe2ef", "#3f5f7a"],
  4: ["#f6e3a1", "#c27a3c"],
};
/** Postbox colours by code: body, lid. */
export const POSTBOX: Record<number, [string, string]> = {
  0: ["#c8553d", "#e07a5f"],
  1: ["#3f6f9a", "#6a9cc4"],
  2: ["#8a6a4a", "#b08a5a"],
};

/** The 16×16 icon of one of these goods; false if it isn't one. */
export function drawGoodsIcon(ctx: CanvasRenderingContext2D, kind: string, meta: { code?: number; tool?: string; slot?: string }): boolean {
  const code = meta.code ?? 0;
  switch (kind) {
    case "tool":
      if (meta.tool === "can") can(ctx, code, 1, 4);
      else rod(ctx, code, 2, 14, 18);
      return true;
    case "instrument":
      instrument(ctx, code);
      return true;
    case "toy":
      toy(ctx, code);
      return true;
    case "wrap": {
      // A roll of paper.
      box(ctx, code, 1, 5, 14, 7);
      px(ctx, O, 13, 4, 3, 9);
      return true;
    }
    case "card": {
      const c = CARDS[code] ?? CARDS[1];
      px(ctx, O, 2, 2, 12, 12);
      px(ctx, c.color, 3, 3, 10, 10);
      px(ctx, "#e8566b", 6, 6, 4, 3);
      px(ctx, "#e8566b", 7, 9, 2, 1);
      return true;
    }
    case "exterior":
      exterior(ctx, meta.slot ?? "", code);
      return true;
  }
  return false;
}

/** A rod in an avatar's hands while fishing (24×34 avatar space). */
export function heldRodTexture(code: number): Texture {
  return cached(`rod:${code}`, () => canvas(24, 24, (ctx) => rod(ctx, code, 3, 20, 22)));
}

/** A watering can tipped to pour, with drops. */
export function heldCanTexture(code: number): Texture {
  return cached(`can:${code}`, () =>
    canvas(20, 16, (ctx) => {
      can(ctx, code, 0, 2);
      px(ctx, "#7fb5d8", 15, 7, 1, 2);
      px(ctx, "#7fb5d8", 17, 10, 1, 2);
      px(ctx, "#7fb5d8", 14, 12, 1, 2);
    }),
  );
}

/** A doorstep gift in its wrapping (24×24). */
export function wrappedTexture(wrap: number): Texture {
  return cached(`gift:${wrap}`, () =>
    canvas(24, 24, (ctx) => {
      px(ctx, "rgba(0,0,0,0.18)", 3, 21, 18, 3);
      box(ctx, wrap, 2, 8, 20, 14);
      px(ctx, "#f6c343", 10, 9, 4, 12);
      box(ctx, wrap, 1, 5, 22, 5);
      px(ctx, "#f6c343", 10, 6, 4, 3);
      px(ctx, "#f6c343", 6, 1, 5, 5);
      px(ctx, "#f6c343", 13, 1, 5, 5);
    }),
  );
}

/** A stretch of fence (or hedge) `tiles` wide. */
export function fenceTexture(code: number, tiles: number): Texture {
  return cached(`fence:${code}:${tiles}`, () => canvas(tiles * 32, 14, (ctx) => fencePiece(ctx, code, 0, 1, tiles * 32)));
}

/** Yard decor, drawn at double size. */
export function yardTexture(code: number): Texture {
  return cached(`yard:${code}`, () =>
    canvas(32, 32, (ctx) => {
      ctx.scale(2, 2);
      yard(ctx, code, 0, 0);
    }),
  );
}
