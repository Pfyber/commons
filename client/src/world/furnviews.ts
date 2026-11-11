// Furniture turned round: each piece seen from its back and its side, drawn
// as pictures of their own (32×32, feet at the bottom, as the front ones in
// items.ts, housewares.ts, cozyart.ts and roomskin.ts), not the front one
// squashed or skewed.
//
// `rot` is which way a piece faces: 0 toward you (south), 1 right (east),
// 2 away (north), 3 left (west). Facing left is its right-facing picture
// mirrored. A piece that looks the same from every side (a pot, a lamp, a
// globe) keeps its one picture; what lies flat (a rug) turns as it lies; a
// piece hung on a side wall is seen side on, a narrow strip off the wall.

import { PALETTE } from "./art";
import { FIREPLACES, drawFireplace } from "./fireplaces";
import { disc, oval, polygon } from "./pixeldraw";

const O = "#2b2233";
const W = PALETTE.wood;
const D = PALETTE.woodDark;
const WOOD = "#8a5a33";
const WOOD_D = "#5e3e22";
const WOOD_L = "#b07a4a";

type Ctx = CanvasRenderingContext2D;
type Draw = (ctx: Ctx) => void;

function px(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** A table seen from its end (or its back): a narrower slab at height `h`, legs below (as cozyart's `table`). */
function table(ctx: Ctx, h: number, top: string, edge: string, legs: string, x0: number, w: number) {
  const y = 32 - h - 4;
  px(ctx, O, x0, y - 1, w, 6);
  px(ctx, top, x0 + 1, y, w - 2, 3);
  px(ctx, edge, x0 + 1, y + 3, w - 2, 1);
  px(ctx, O, x0 + 2, y + 4, 3, h + 1);
  px(ctx, O, x0 + w - 5, y + 4, 3, h + 1);
  px(ctx, legs, x0 + 3, y + 4, 1, h);
  px(ctx, legs, x0 + w - 4, y + 4, 1, h);
}

/** A plain box seen side on: outline, its top, its side. */
function box(ctx: Ctx, x: number, y: number, w: number, h: number, top: string, side: string, topH = 3) {
  px(ctx, O, x, y, w, h);
  px(ctx, top, x + 1, y + 1, w - 2, topH);
  px(ctx, side, x + 1, y + 1 + topH, w - 2, h - 2 - topH);
}

/** A chair's turned pictures, by its colours (the wooden chair, the rocking chair). */
function chairBack(ctx: Ctx) {
  px(ctx, O, 9, 4, 14, 26);
  px(ctx, D, 10, 5, 12, 15);
  for (const x of [13, 16, 19]) px(ctx, W, x, 6, 1, 13);
  px(ctx, W, 10, 5, 12, 1);
  px(ctx, O, 9, 20, 14, 1);
  px(ctx, W, 10, 21, 3, 8);
  px(ctx, W, 19, 21, 3, 8);
}
function chairSide(ctx: Ctx, legs = true) {
  px(ctx, O, 8, 4, 5, 26);
  px(ctx, O, 8, 15, 16, 6);
  px(ctx, W, 9, 5, 3, 24);
  px(ctx, W, 9, 16, 14, 2);
  px(ctx, D, 9, 18, 14, 2);
  if (legs) {
    px(ctx, O, 19, 20, 4, 10);
    px(ctx, W, 20, 20, 2, 9);
  }
}

/** Upholstered chairs: [main, light, dark] colours. */
function armchairBack(ctx: Ctx, c: [string, string, string], x0 = 5, w = 22) {
  px(ctx, O, x0, 6, w, 24);
  px(ctx, c[2], x0 + 1, 7, w - 2, 18);
  px(ctx, c[0], x0 + 1, 7, w - 2, 2);
  px(ctx, O, x0 + 4, 15, 1, 10);
  px(ctx, O, x0 + w - 5, 15, 1, 10);
  px(ctx, O, x0 + 1, 24, w - 2, 1);
  px(ctx, D, x0 + 2, 25, 3, 5);
  px(ctx, D, x0 + w - 5, 25, 3, 5);
}
function armchairSide(ctx: Ctx, c: [string, string, string]) {
  // The back up on its left, the near arm along the bottom, the seat's cushion between.
  px(ctx, O, 5, 6, 8, 24);
  px(ctx, O, 5, 13, 22, 17);
  px(ctx, c[0], 6, 7, 6, 22);
  px(ctx, c[1], 6, 7, 6, 2);
  px(ctx, c[1], 12, 14, 14, 3);
  px(ctx, c[2], 6, 17, 20, 8);
  px(ctx, c[0], 6, 17, 20, 1);
  px(ctx, O, 6, 25, 20, 1);
  px(ctx, D, 7, 26, 3, 4);
  px(ctx, D, 22, 26, 3, 4);
}

/** A bookcase (or shelf) from its side: its side panel; from behind: its back boards. */
function caseSide(ctx: Ctx, y0: number, h: number, wood: string, dark: string) {
  px(ctx, O, 11, y0, 10, h);
  px(ctx, wood, 12, y0 + 1, 8, h - 2);
  px(ctx, dark, 19, y0 + 1, 1, h - 2);
  px(ctx, dark, 12, y0 + 1, 8, 1);
  for (let y = y0 + 6; y < y0 + h - 2; y += 9) px(ctx, dark, 13, y, 5, 1);
}
function caseBack(ctx: Ctx, y0: number, h: number, wood: string, dark: string) {
  px(ctx, O, 3, y0, 26, h);
  px(ctx, dark, 4, y0 + 1, 24, h - 2);
  for (const x of [10, 16, 22]) px(ctx, wood, x, y0 + 1, 1, h - 2);
  px(ctx, wood, 4, y0 + 1, 24, 1);
}

/** Beds, seen top down: head at the end it's turned from. [frame, sheet, blanket, fold, pillow] */
function bedSide(ctx: Ctx, c: [string, string, string, string, string]) {
  // Turned to face right: the head (its headboard, the pillow) on the left, the foot on the right.
  px(ctx, O, 1, 8, 30, 23);
  px(ctx, c[0], 2, 9, 28, 21);
  px(ctx, c[1], 6, 10, 23, 12);
  px(ctx, c[4], 7, 11, 6, 10);
  px(ctx, c[2], 14, 10, 15, 12);
  px(ctx, c[3], 14, 10, 2, 12);
  px(ctx, O, 1, 3, 6, 28);
  px(ctx, c[0], 2, 4, 4, 26);
  px(ctx, O, 2, 22, 28, 1);
  px(ctx, c[0], 7, 23, 22, 6);
}
function bedBack(ctx: Ctx, c: [string, string, string, string, string]) {
  // Turned away: the foot toward you at the top, the pillow and headboard at the bottom.
  px(ctx, O, 1, 2, 30, 29);
  px(ctx, c[0], 2, 3, 28, 4);
  px(ctx, c[2], 2, 7, 28, 11);
  px(ctx, c[3], 2, 16, 28, 2);
  px(ctx, c[1], 2, 18, 28, 7);
  px(ctx, c[4], 4, 18, 11, 5);
  px(ctx, c[4], 17, 18, 11, 5);
  px(ctx, O, 1, 24, 30, 1);
  px(ctx, c[0], 2, 25, 28, 5);
  px(ctx, PALETTE.wood, 2, 25, 28, 1);
}

/** The pieces with a back and a side of their own. */
const VIEWS: Record<string, { back?: Draw; side?: Draw }> = {
  wooden_chair: { back: chairBack, side: (ctx) => chairSide(ctx) },
  rocking_chair: {
    back: (ctx) => {
      px(ctx, O, 9, 3, 14, 22);
      px(ctx, D, 10, 4, 12, 15);
      for (const x of [13, 16, 19]) px(ctx, W, x, 5, 1, 13);
      px(ctx, W, 10, 4, 12, 1);
      px(ctx, W, 11, 20, 2, 6);
      px(ctx, W, 19, 20, 2, 6);
      oval(ctx, O, 16, 28, 12, 2.5);
      oval(ctx, D, 16, 28, 11, 1.5);
    },
    side: (ctx) => {
      px(ctx, O, 8, 3, 5, 23);
      px(ctx, O, 8, 14, 16, 6);
      px(ctx, W, 9, 4, 3, 21);
      px(ctx, W, 9, 15, 14, 2);
      px(ctx, D, 9, 17, 14, 2);
      px(ctx, O, 19, 19, 4, 7);
      px(ctx, W, 20, 19, 2, 6);
      // The rocker: a long curve under it, up at both ends.
      polygon(ctx, O, [[3, 23], [6, 27], [12, 29], [20, 29], [26, 27], [29, 23], [30, 24], [27, 29], [20, 31], [12, 31], [5, 29], [2, 24]]);
      polygon(ctx, D, [[4, 25], [7, 28], [12, 30], [20, 30], [25, 28], [28, 25], [26, 29], [20, 30.5], [12, 30.5], [6, 29]]);
    },
  },
  armchair: { back: (ctx) => armchairBack(ctx, ["#6f8fb5", "#8aa8cc", "#5a7598"]), side: (ctx) => armchairSide(ctx, ["#6f8fb5", "#8aa8cc", "#5a7598"]) },
  cozy_armchair: {
    back: (ctx) => {
      armchairBack(ctx, ["#a06ac8", "#a06ac8", "#8a4fb0"], 3, 26);
      // The blanket thrown over its back, hanging down behind.
      px(ctx, O, 10, 5, 12, 10);
      px(ctx, "#e8d8b8", 11, 6, 10, 8);
      for (let y = 7; y < 14; y += 2) px(ctx, "#d8c098", 11, y, 10, 1);
    },
    side: (ctx) => {
      armchairSide(ctx, ["#8a4fb0", "#a06ac8", "#7a3fa0"]);
      // The blanket folded over the top of its back.
      px(ctx, O, 4, 5, 10, 6);
      px(ctx, "#e8d8b8", 5, 6, 8, 4);
      px(ctx, "#d8c098", 5, 8, 8, 1);
    },
  },
  sofa: {
    back: (ctx) => {
      px(ctx, O, 0, 8, 32, 22);
      px(ctx, "#99443b", 1, 9, 30, 16);
      px(ctx, "#b5544a", 1, 9, 30, 2);
      px(ctx, O, 5, 16, 1, 9);
      px(ctx, O, 26, 16, 1, 9);
      px(ctx, O, 1, 25, 30, 1);
      px(ctx, D, 2, 26, 3, 4);
      px(ctx, D, 27, 26, 3, 4);
    },
    side: (ctx) => {
      // Seen from its end: the back along its left, the seat going away, the near arm across the bottom.
      px(ctx, O, 6, 3, 21, 27);
      px(ctx, "#b5544a", 7, 4, 6, 21);
      px(ctx, "#cf6f63", 7, 4, 6, 1);
      px(ctx, "#99443b", 13, 4, 13, 4);
      px(ctx, "#cf6f63", 13, 8, 13, 12);
      px(ctx, O, 13, 8, 13, 1);
      px(ctx, "#f4f1d8", 14, 10, 4, 5);
      px(ctx, "#99443b", 7, 20, 19, 6);
      px(ctx, "#b5544a", 7, 20, 19, 1);
      px(ctx, O, 7, 26, 19, 1);
      px(ctx, D, 7, 27, 3, 3);
      px(ctx, D, 23, 27, 3, 3);
    },
  },
  lawn_chair: {
    back: (ctx) => {
      px(ctx, "rgba(0,0,0,0.18)", 6, 28, 21, 3);
      px(ctx, O, 7, 6, 18, 3);
      px(ctx, O, 7, 6, 3, 24);
      px(ctx, O, 22, 6, 3, 24);
      px(ctx, "#d8d4ca", 8, 7, 16, 1);
      for (let y = 9; y < 18; y += 4) {
        px(ctx, "#3a64a8", 10, y, 12, 2);
        px(ctx, "#c8a03a", 10, y + 2, 12, 2);
      }
      px(ctx, O, 7, 18, 18, 2);
      px(ctx, O, 10, 22, 12, 1);
    },
    side: (ctx) => {
      // Folded open from the side: the back leaning, the seat, the legs crossed under it.
      px(ctx, "rgba(0,0,0,0.18)", 6, 28, 21, 3);
      polygon(ctx, O, [[6, 5], [10, 5], [13, 19], [9, 19]]);
      polygon(ctx, "#f4f1ea", [[7, 6], [9, 6], [12, 18], [10, 18]]);
      for (let y = 7; y < 18; y += 4) px(ctx, "#4f86d8", 9 + (y - 6) / 4, y, 2, 2);
      px(ctx, O, 9, 17, 16, 3);
      px(ctx, "#f4f1ea", 10, 18, 14, 1);
      px(ctx, "#f2c94c", 12, 17, 10, 1);
      polygon(ctx, O, [[10, 19], [13, 19], [24, 30], [21, 30]]);
      polygon(ctx, O, [[21, 19], [24, 19], [12, 30], [9, 30]]);
      polygon(ctx, "#f4f1ea", [[11, 19], [12, 19], [23, 29], [22, 29]]);
      polygon(ctx, "#f4f1ea", [[22, 19], [23, 19], [11, 29], [10, 29]]);
    },
  },
  cozy_bed: {
    back: (ctx) => bedBack(ctx, [D, "#f4f1d8", "#7fa7d4", "#a9c4e4", "#f4f1d8"]),
    side: (ctx) => bedSide(ctx, [D, "#f4f1d8", "#7fa7d4", "#a9c4e4", "#f4f1d8"]),
  },
  double_bed: {
    back: (ctx) => bedBack(ctx, ["#8a5a33", "#f8f4ea", "#4f86d8", "#6a9ae8", "#ffffff"]),
    side: (ctx) => {
      bedSide(ctx, ["#8a5a33", "#f8f4ea", "#4f86d8", "#6a9ae8", "#ffffff"]);
      // Two pillows side by side, up its head.
      px(ctx, "#f8f4ea", 7, 15, 6, 1);
    },
  },
  bunk_bed: {
    back: (ctx) => {
      px(ctx, O, 3, -4, 26, 35);
      px(ctx, "#8a5a33", 4, -3, 2, 33);
      px(ctx, "#8a5a33", 26, -3, 2, 33);
      px(ctx, "#c8464b", 6, 2, 20, 6);
      px(ctx, "#8a5a33", 4, 8, 24, 2);
      px(ctx, "#4a9a5a", 6, 18, 20, 7);
      px(ctx, "#8a5a33", 4, 25, 24, 2);
      px(ctx, "#8a5a33", 6, -1, 20, 2);
      px(ctx, "#8a5a33", 6, 13, 20, 2);
    },
    side: (ctx) => {
      // From its end: two posts, the two mattresses' ends, the ladder edge on (its rungs toward you).
      px(ctx, O, 7, -4, 18, 35);
      px(ctx, "#8a5a33", 8, -3, 2, 33);
      px(ctx, "#8a5a33", 22, -3, 2, 33);
      px(ctx, "#a0703f", 10, -1, 12, 2);
      px(ctx, "#ffffff", 10, 1, 5, 3);
      px(ctx, "#e8566b", 15, 1, 7, 7);
      px(ctx, "#ffffff", 10, 4, 5, 4);
      px(ctx, "#8a5a33", 10, 8, 12, 2);
      px(ctx, "#a0703f", 10, 13, 12, 2);
      px(ctx, "#ffffff", 10, 17, 5, 8);
      px(ctx, "#5fb36b", 15, 17, 7, 8);
      px(ctx, "#8a5a33", 10, 25, 12, 2);
      px(ctx, O, 25, 0, 4, 31);
      px(ctx, "#a0703f", 26, 0, 2, 31);
      for (let y = 2; y < 30; y += 4) px(ctx, "#5e3e22", 26, y, 2, 1);
    },
  },
  small_table: {
    side: (ctx) => {
      px(ctx, O, 9, 10, 14, 8);
      px(ctx, W, 10, 11, 12, 5);
      px(ctx, D, 10, 18, 3, 11);
      px(ctx, D, 19, 18, 3, 11);
      px(ctx, "#f4f1d8", 13, 8, 6, 3);
    },
  },
  coffee_table: { side: (ctx) => table(ctx, 12, WOOD_L, WOOD_D, WOOD, 9, 14) },
  dining_table: {
    side: (ctx) => {
      table(ctx, 13, "#f8f4ea", "#d8c8b0", WOOD, 8, 16);
      for (let x = 10; x < 23; x += 4) px(ctx, "#e8566b", x, 15, 2, 1);
    },
  },
  writing_desk: {
    back: (ctx) => {
      table(ctx, 13, WOOD, WOOD_D, WOOD_D, 2, 28);
      // The drawers' plain back, on the other side from behind.
      px(ctx, O, 5, 20, 9, 9);
      px(ctx, WOOD_D, 6, 21, 7, 7);
      px(ctx, WOOD, 6, 21, 7, 1);
    },
    side: (ctx) => {
      table(ctx, 13, WOOD, WOOD_D, WOOD_D, 9, 14);
      px(ctx, O, 9, 20, 14, 9);
      px(ctx, WOOD_D, 10, 21, 12, 7);
      px(ctx, WOOD, 10, 21, 12, 1);
    },
  },
  bar_cart: {
    side: (ctx) => {
      table(ctx, 12, "#c8c8d4", "#8a8a9a", "#a8a8b8", 9, 14);
      px(ctx, "#8a8a9a", 11, 26, 10, 2);
      disc(ctx, O, 12, 30, 2);
      disc(ctx, O, 20, 30, 2);
      px(ctx, "#5aa04a", 13, 22, 3, 4);
      px(ctx, "#c8323a", 17, 21, 2, 5);
    },
  },
  nightstand: {
    back: (ctx) => box(ctx, 7, 14, 18, 17, WOOD_L, WOOD_D),
    side: (ctx) => box(ctx, 10, 14, 12, 17, WOOD_L, WOOD),
  },
  low_cabinet: {
    back: (ctx) => {
      box(ctx, 2, 15, 28, 16, WOOD_L, WOOD_D);
      for (const x of [9, 16, 23]) px(ctx, WOOD, x, 19, 1, 11);
    },
    side: (ctx) => box(ctx, 9, 15, 14, 16, WOOD_L, WOOD),
  },
  toy_chest: {
    back: (ctx) => {
      px(ctx, O, 3, 10, 26, 21);
      px(ctx, "#4f86d8", 4, 11, 24, 6);
      px(ctx, "#6a9ae8", 4, 11, 24, 2);
      px(ctx, "#f6c343", 4, 17, 24, 2);
      px(ctx, "#3f6fb8", 4, 19, 24, 11);
      px(ctx, "#5fb36b", 21, 7, 3, 4);
      disc(ctx, "#ef8bb5", 10, 9, 3);
    },
    side: (ctx) => {
      px(ctx, O, 9, 10, 14, 21);
      px(ctx, "#4f86d8", 10, 11, 12, 6);
      px(ctx, "#6a9ae8", 10, 11, 12, 2);
      px(ctx, "#f6c343", 10, 17, 12, 2);
      px(ctx, "#3f6fb8", 10, 19, 12, 11);
      // A handle on its end.
      px(ctx, O, 13, 22, 6, 3);
      px(ctx, "#f6c343", 14, 23, 4, 1);
      px(ctx, "#5fb36b", 12, 7, 3, 4);
      disc(ctx, "#ef8bb5", 19, 9, 2.5);
    },
  },
  bookshelf: { back: (ctx) => caseBack(ctx, 0, 31, W, D), side: (ctx) => caseSide(ctx, 0, 31, W, D) },
  bookcase_full: { back: (ctx) => caseBack(ctx, -2, 33, WOOD, WOOD_D), side: (ctx) => caseSide(ctx, -2, 33, WOOD, WOOD_D) },
  display_shelf: { back: (ctx) => caseBack(ctx, 1, 30, "#a97545", "#5f3d22"), side: (ctx) => caseSide(ctx, 1, 30, "#8a5a33", "#5f3d22") },
  flower_box: {
    side: (ctx) => {
      px(ctx, O, 10, 19, 12, 11);
      px(ctx, W, 11, 20, 10, 9);
      px(ctx, D, 11, 20, 10, 2);
      for (let i = 0; i < 3; i++) {
        px(ctx, PALETTE.leaf, 12 + i * 3, 12, 2, 8);
        px(ctx, ["#e8566b", "#f6c343", "#9b7fd4"][i], 11 + i * 3, 9 + (i % 2) * 2, 4, 4);
      }
    },
  },
  harvest_basket: {
    side: (ctx) => {
      px(ctx, O, 9, 16, 14, 14);
      px(ctx, "#c99a6a", 10, 17, 12, 12);
      for (let i = 0; i < 4; i++) px(ctx, "#a0703f", 10, 19 + i * 3, 12, 1);
      disc(ctx, "#e8566b", 13, 15, 3);
      disc(ctx, "#f6c343", 19, 14, 3);
      // The handle, seen edge on: one bar up over it.
      px(ctx, O, 15, 5, 2, 12);
    },
  },
  retro_tv: {
    back: (ctx) => {
      px(ctx, O, 2, 6, 28, 22);
      px(ctx, "#7a4a28", 3, 7, 26, 20);
      px(ctx, O, 8, 10, 16, 14);
      px(ctx, "#5e3e22", 9, 11, 14, 12);
      for (let y = 13; y < 22; y += 2) px(ctx, "#2b2233", 11, y, 10, 1);
      px(ctx, O, 7, 28, 3, 3);
      px(ctx, O, 22, 28, 3, 3);
      px(ctx, O, 10, 1, 1, 5);
      px(ctx, O, 21, 1, 1, 5);
    },
    side: (ctx) => {
      // A deep cabinet: the screen's edge glints on the side it faces.
      px(ctx, O, 7, 6, 18, 22);
      px(ctx, "#7a4a28", 8, 7, 16, 20);
      px(ctx, "#8a5a33", 8, 7, 16, 2);
      px(ctx, O, 21, 9, 3, 16);
      px(ctx, "#3a4a4a", 22, 10, 2, 14);
      for (let y = 12; y < 22; y += 3) px(ctx, "#5e3e22", 10, y, 8, 1);
      px(ctx, O, 9, 28, 3, 3);
      px(ctx, O, 20, 28, 3, 3);
      px(ctx, O, 14, 1, 1, 5);
      px(ctx, O, 17, 0, 1, 6);
    },
  },
  record_player: {
    back: (ctx) => {
      px(ctx, O, 3, 14, 26, 17);
      px(ctx, "#7a4a28", 4, 15, 24, 15);
      px(ctx, "#2a2a34", 5, 16, 22, 8);
      disc(ctx, O, 18, 20, 6);
      disc(ctx, "#1a1a24", 18, 20, 5);
      disc(ctx, "#e8566b", 18, 20, 2);
      px(ctx, "#c8c8dc", 8, 16, 2, 7);
      px(ctx, "#5e3e22", 6, 26, 20, 1);
    },
    side: (ctx) => {
      px(ctx, O, 9, 14, 14, 17);
      px(ctx, "#8a5a33", 10, 15, 12, 15);
      px(ctx, "#2a2a34", 10, 16, 12, 6);
      oval(ctx, O, 15, 19, 5, 2.5);
      oval(ctx, "#1a1a24", 15, 19, 4, 1.5);
      px(ctx, "#e8566b", 14, 18, 2, 1);
      px(ctx, "#c8c8dc", 20, 16, 1, 6);
      px(ctx, "#f6c343", 19, 26, 2, 2);
    },
  },
  radio: {
    back: (ctx) => {
      px(ctx, O, 4, 14, 24, 17);
      px(ctx, "#a0602a", 5, 15, 22, 15);
      for (let y = 18; y < 28; y += 2) px(ctx, "#7a4a22", 8, y, 16, 1);
      px(ctx, O, 8, 6, 1, 8);
    },
    side: (ctx) => {
      px(ctx, O, 10, 14, 12, 17);
      px(ctx, "#c8803a", 11, 15, 10, 15);
      px(ctx, "#a0602a", 11, 15, 2, 15);
      px(ctx, "#f6c343", 20, 24, 1, 2);
      px(ctx, O, 15, 6, 1, 8);
    },
  },
  laptop: {
    back: (ctx) => {
      polygon(ctx, O, [[5, 31], [27, 31], [25, 26], [7, 26]]);
      polygon(ctx, "#a8a8b8", [[6, 30], [26, 30], [24, 27], [8, 27]]);
      px(ctx, O, 7, 12, 18, 15);
      px(ctx, "#b8b8c8", 8, 13, 16, 13);
      px(ctx, "#d8d8e8", 8, 13, 16, 1);
      disc(ctx, "#f8f8ff", 16, 19, 2);
    },
    side: (ctx) => {
      // Open: the lid stood up at its back, the keyboard reaching out toward where it faces.
      px(ctx, O, 8, 12, 4, 19);
      px(ctx, "#a8a8b8", 9, 13, 2, 17);
      px(ctx, "#5a7aa0", 11, 14, 1, 12);
      px(ctx, O, 8, 27, 18, 4);
      px(ctx, "#a8a8b8", 9, 28, 16, 2);
      px(ctx, "#2a2a34", 13, 28, 10, 1);
    },
  },
  arcade_cabinet: {
    back: (ctx) => {
      px(ctx, O, 5, 2, 22, 29);
      px(ctx, "#2a1a4a", 6, 3, 20, 27);
      px(ctx, "#3a2a6a", 6, 3, 20, 2);
      for (let y = 8; y < 16; y += 2) px(ctx, O, 10, y, 12, 1);
      px(ctx, O, 14, 24, 4, 5);
      px(ctx, "#c8c8dc", 15, 25, 2, 3);
    },
    side: (ctx) => {
      // The classic profile: tall at the back, the screen leaning out, the controls jutting forward.
      polygon(ctx, O, [[7, 31], [24, 31], [24, 24], [28, 22], [28, 19], [23, 17], [21, 7], [22, 2], [7, 2]]);
      polygon(ctx, "#3a2a6a", [[8, 30], [23, 30], [23, 23], [27, 21.5], [27, 19.5], [22, 18], [20, 7], [21, 3], [8, 3]]);
      polygon(ctx, "#ff5a8a", [[8, 9], [19, 4], [19, 7], [8, 12]]);
      px(ctx, "#5a4a8a", 22, 19, 5, 2);
      disc(ctx, "#ff5a5a", 25, 18, 1.5);
      px(ctx, "#1a1a2a", 20, 8, 1, 9);
    },
  },
  popcorn_machine: {
    back: (ctx) => {
      px(ctx, O, 6, 2, 20, 29);
      px(ctx, "#a8282e", 7, 3, 18, 5);
      px(ctx, O, 7, 8, 18, 14);
      px(ctx, "#d8f0ff", 8, 9, 16, 12);
      for (let i = 0; i < 12; i++) disc(ctx, "#fff8d0", 9 + ((i * 7) % 15), 18 + (i % 3), 1.3);
      px(ctx, "#a8282e", 7, 22, 18, 8);
      px(ctx, O, 8, 30, 3, 1);
      px(ctx, O, 21, 30, 3, 1);
    },
    side: (ctx) => {
      px(ctx, O, 10, 2, 12, 29);
      px(ctx, "#c8323a", 11, 3, 10, 5);
      px(ctx, "#f6c343", 12, 4, 8, 3);
      px(ctx, O, 11, 8, 10, 14);
      px(ctx, "#d8f0ff", 12, 9, 8, 12);
      for (let i = 0; i < 7; i++) disc(ctx, "#fff8d0", 13 + ((i * 5) % 7), 18 + (i % 3), 1.3);
      px(ctx, "#c8323a", 11, 22, 10, 8);
      px(ctx, "#f6c343", 11, 24, 10, 1);
      px(ctx, O, 11, 30, 3, 1);
      px(ctx, O, 18, 30, 3, 1);
    },
  },
  piano: {
    back: (ctx) => {
      px(ctx, O, 2, 2, 28, 29);
      px(ctx, "#1a1418", 3, 3, 26, 27);
      px(ctx, "#2a2028", 3, 3, 26, 3);
      for (const x of [9, 22]) px(ctx, "#241c22", x, 6, 1, 24);
      px(ctx, "#241c22", 3, 17, 26, 1);
      px(ctx, O, 6, 28, 20, 1);
    },
    side: (ctx) => {
      // Upright, from its end: the tall body, the keyboard's shelf reaching out, a leg under it.
      px(ctx, O, 6, 2, 13, 29);
      px(ctx, "#1a1418", 7, 3, 11, 27);
      px(ctx, "#2a2028", 7, 3, 11, 3);
      px(ctx, O, 18, 15, 8, 6);
      px(ctx, "#1a1418", 19, 16, 6, 4);
      px(ctx, "#f8f4ea", 19, 16, 6, 1);
      px(ctx, O, 22, 21, 3, 10);
      px(ctx, "#2a2028", 23, 21, 1, 9);
    },
  },
  aquarium: {
    // (Glass all round: from behind it's as from the front, its fish swimming.)
    side: (ctx) => {
      px(ctx, O, 8, 2, 16, 30);
      px(ctx, "#5a3a1a", 9, 24, 14, 7);
      px(ctx, "#7a5a33", 9, 24, 14, 1);
      px(ctx, "#2a2a34", 9, 3, 14, 3);
      px(ctx, "#4aa8d8", 9, 6, 14, 18);
      px(ctx, "#6ac8f0", 9, 6, 14, 3);
      px(ctx, "#d8c08a", 9, 21, 14, 3);
      for (const [x, h] of [[11, 8], [19, 6]] as [number, number][]) px(ctx, "#2e8a4a", x, 21 - h, 2, h);
      px(ctx, "#ffffff", 10, 8, 1, 6);
    },
  },
  mini_fridge: {
    back: (ctx) => {
      px(ctx, "rgba(0,0,0,0.2)", 7, 29, 19, 2);
      px(ctx, O, 7, 4, 18, 26);
      px(ctx, O, 8, 3, 16, 1);
      px(ctx, "#6ab8a4", 8, 4, 16, 25);
      px(ctx, "#8fd8c4", 8, 4, 16, 2);
      // The coils at the back.
      px(ctx, O, 10, 9, 12, 16);
      for (let y = 10; y < 25; y += 2) px(ctx, "#5a6470", 11, y, 10, 1);
      px(ctx, O, 9, 29, 3, 2);
      px(ctx, O, 20, 29, 3, 2);
    },
    side: (ctx) => {
      px(ctx, "rgba(0,0,0,0.2)", 9, 29, 15, 2);
      px(ctx, O, 9, 4, 14, 26);
      px(ctx, O, 10, 3, 12, 1);
      px(ctx, "#7cc8b4", 10, 4, 12, 25);
      px(ctx, "#b4ecdc", 10, 4, 12, 2);
      px(ctx, "#8fd8c4", 20, 4, 2, 25);
      px(ctx, O, 20, 11, 2, 1);
      // Its handles, standing proud of the doors' edge.
      px(ctx, O, 22, 6, 2, 4);
      px(ctx, O, 22, 14, 2, 8);
      px(ctx, "#e8eef4", 22, 15, 1, 6);
      px(ctx, O, 11, 29, 3, 2);
      px(ctx, O, 18, 29, 3, 2);
    },
  },
  grandfather_clock: {
    back: (ctx) => {
      px(ctx, O, 9, -4, 14, 35);
      px(ctx, D, 10, -3, 12, 33);
      px(ctx, W, 10, -3, 12, 1);
      px(ctx, W, 15, 0, 2, 28);
    },
    side: (ctx) => {
      px(ctx, O, 12, -4, 9, 35);
      px(ctx, D, 13, -3, 7, 33);
      px(ctx, W, 13, -3, 7, 1);
      px(ctx, O, 11, -4, 11, 2);
      px(ctx, "#f4f1d8", 19, 1, 1, 7);
      px(ctx, W, 14, 10, 1, 16);
    },
  },
  garden_gnome: {
    back: (ctx) => {
      px(ctx, O, 10, 3, 12, 28);
      polygon(ctx, "#c8553d", [[11, 17], [16, 2], [21, 17]]);
      px(ctx, "#fff9ec", 11, 16, 2, 5);
      px(ctx, "#fff9ec", 19, 16, 2, 5);
      px(ctx, "#5f8fc4", 11, 21, 10, 8);
      px(ctx, "#4a78ac", 11, 25, 10, 1);
      px(ctx, "#3b3a2e", 11, 28, 4, 2);
      px(ctx, "#3b3a2e", 17, 28, 4, 2);
    },
    side: (ctx) => {
      px(ctx, O, 10, 3, 12, 28);
      polygon(ctx, "#c8553d", [[11, 14], [13, 2], [20, 14]]);
      px(ctx, "#f5d0b0", 15, 14, 6, 5);
      px(ctx, "#e8a890", 20, 15, 2, 2);
      px(ctx, O, 18, 15, 1, 1);
      px(ctx, "#fff9ec", 15, 18, 6, 5);
      px(ctx, "#5f8fc4", 11, 22, 9, 7);
      px(ctx, "#3b3a2e", 12, 28, 8, 2);
    },
  },
  scarecrow: {
    back: (ctx) => {
      px(ctx, PALETTE.trunk, 15, 8, 3, 23);
      px(ctx, PALETTE.trunk, 5, 13, 22, 3);
      px(ctx, O, 9, 12, 14, 12);
      px(ctx, "#4a78ac", 10, 13, 12, 10);
      px(ctx, "#f6c343", 6, 15, 3, 3);
      px(ctx, "#f6c343", 23, 15, 3, 3);
      disc(ctx, O, 16, 7, 5);
      disc(ctx, "#ead9a6", 16, 7, 4);
      px(ctx, "#f6c343", 14, 10, 4, 2);
      px(ctx, O, 9, 1, 14, 3);
      px(ctx, "#a0703f", 11, -2, 10, 4);
    },
    side: (ctx) => {
      px(ctx, PALETTE.trunk, 15, 8, 3, 23);
      px(ctx, O, 12, 12, 9, 12);
      px(ctx, "#5f8fc4", 13, 13, 7, 10);
      px(ctx, PALETTE.trunk, 14, 13, 5, 3);
      px(ctx, "#f6c343", 19, 15, 3, 3);
      disc(ctx, O, 16, 7, 5);
      disc(ctx, "#ead9a6", 16, 7, 4);
      px(ctx, O, 19, 7, 1, 1);
      px(ctx, O, 11, 1, 11, 3);
      px(ctx, "#a0703f", 12, -2, 8, 4);
    },
  },
  teddy_bear: {
    back: (ctx) => {
      disc(ctx, O, 16, 22, 8);
      disc(ctx, "#b07a4a", 16, 22, 7);
      disc(ctx, O, 16, 11, 7);
      disc(ctx, "#b07a4a", 16, 11, 6);
      disc(ctx, O, 10, 6, 3);
      disc(ctx, O, 22, 6, 3);
      disc(ctx, "#b07a4a", 10, 6, 2);
      disc(ctx, "#b07a4a", 22, 6, 2);
      px(ctx, "#c8323a", 12, 16, 8, 2);
      disc(ctx, "#c8323a", 16, 17, 1.5);
      disc(ctx, "#e8c8a0", 16, 27, 1.5);
    },
    side: (ctx) => {
      disc(ctx, O, 15, 22, 7.5);
      disc(ctx, "#b07a4a", 15, 22, 6.5);
      disc(ctx, "#e8c8a0", 18, 23, 3);
      disc(ctx, O, 16, 11, 7);
      disc(ctx, "#b07a4a", 16, 11, 6);
      disc(ctx, O, 14, 5, 3);
      disc(ctx, "#b07a4a", 14, 5, 2);
      oval(ctx, O, 22, 13, 3, 2.5);
      oval(ctx, "#e8c8a0", 22, 13, 2, 1.5);
      px(ctx, O, 24, 12, 1, 1);
      px(ctx, O, 19, 10, 1, 1);
      px(ctx, "#c8323a", 12, 16, 8, 2);
    },
  },
  pumpkin_lantern: {
    back: (ctx) => {
      oval(ctx, O, 16, 21, 12, 9);
      oval(ctx, "#e07a2f", 16, 21, 11, 8);
      px(ctx, "#c8602a", 11, 14, 2, 15);
      px(ctx, "#c8602a", 19, 14, 2, 15);
      px(ctx, "#5d8a4e", 15, 9, 3, 5);
    },
    side: (ctx) => {
      oval(ctx, O, 16, 21, 11, 9);
      oval(ctx, "#e07a2f", 16, 21, 10, 8);
      px(ctx, "#c8602a", 14, 14, 2, 15);
      px(ctx, "#5d8a4e", 15, 9, 3, 5);
      // Its face round on the side it looks at: an eye and the grin's end.
      polygon(ctx, "#ffe39a", [[22, 18], [24, 16], [25, 19]]);
      px(ctx, "#ffe39a", 21, 23, 4, 3);
    },
  },
  birdhouse: {
    back: (ctx) => {
      px(ctx, PALETTE.trunk, 15, 18, 3, 13);
      px(ctx, O, 9, 7, 14, 13);
      px(ctx, "#d4a040", 10, 8, 12, 11);
      polygon(ctx, "#b5544a", [[7, 9], [16, 1], [25, 9]]);
    },
    side: (ctx) => {
      px(ctx, PALETTE.trunk, 15, 18, 3, 13);
      px(ctx, O, 11, 6, 10, 14);
      px(ctx, "#e6b450", 12, 7, 8, 12);
      // The roof from its side: one sloping pane.
      px(ctx, O, 9, 3, 14, 5);
      px(ctx, "#b5544a", 10, 4, 12, 3);
      px(ctx, "#d06a5a", 10, 4, 12, 1);
      px(ctx, O, 20, 15, 4, 1);
    },
  },
  photo_frame: {
    back: (ctx) => {
      polygon(ctx, O, [[9, 31], [23, 31], [22, 13], [10, 13]]);
      px(ctx, "#8a5a33", 10, 14, 12, 16);
      px(ctx, "#a0703f", 10, 14, 12, 1);
      px(ctx, O, 15, 19, 2, 12);
    },
    side: (ctx) => {
      px(ctx, O, 14, 13, 4, 18);
      px(ctx, "#c99a2a", 15, 14, 2, 16);
      polygon(ctx, O, [[13, 20], [15, 20], [10, 31], [8, 31]]);
    },
  },
  string_lights: {
    side: (ctx) => {
      // Down its length: the near post, the string's lights hanging off toward the far one.
      px(ctx, PALETTE.woodDark, 15, 6, 2, 25);
      px(ctx, O, 12, 6, 8, 1);
      for (let i = 0; i < 3; i++) {
        px(ctx, O, 13 + i * 3, 7, 1, 2 + i);
        disc(ctx, ["#f6c343", "#e8566b", "#9fc3d6"][i], 13.5 + i * 3, 10 + i, 1.5);
      }
    },
  },
  picnic_set: {
    side: (ctx) => {
      // The blanket turned lengthways, the basket on it as ever.
      px(ctx, "#e8566b", 9, 3, 14, 28);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) px(ctx, "#fff9ec", 9 + j * 7 + (i % 2) * 3, 3 + i * 7, 4, 4);
      px(ctx, O, 10, 10, 12, 9);
      px(ctx, "#c99a6a", 11, 11, 10, 7);
      px(ctx, O, 12, 7, 8, 2);
      disc(ctx, "#e8566b", 21, 22, 2);
    },
  },
};

// The fireplaces (red brick, grey stone, obsidian): their backs and sides, as fireplaces.ts draws them.
for (const key of Object.keys(FIREPLACES)) VIEWS[key] = { back: (ctx) => drawFireplace(ctx, key, "back"), side: (ctx) => drawFireplace(ctx, key, "side") };

/** What lies flat on the floor (seen from above): it turns as it lies. */
const LIES_FLAT = new Set(["round_rug", "rug_persian", "rug_stripes", "rug_heart", "floor_cushions"]);
/** What doesn't turn (it only fits the room one way round). */
const FIXED = new Set(["pool_table", "round_pond"]);

/** Whether `key` turned `rot` is a picture of its own (not its front): its live part (a screen, a flame) is drawn for the front. */
export function turnedAway(key: string, rot: number): boolean {
  const r = rot & 3;
  if (r === 0) return false;
  const v = VIEWS[key];
  return !!v && !!(r === 2 ? v.back : v.side);
}

/**
 * Piece `key` facing `rot`, drawn from its front picture (`front`, a 32×32
 * canvas), on a wall's side (`sideWall`: hung on a side wall, seen side on).
 */
export function turnedPiece(front: HTMLCanvasElement, key: string, rot: number, sideWall: boolean): HTMLCanvasElement {
  const r = rot & 3;
  if (r === 0 || FIXED.has(key)) return front;
  const c = document.createElement("canvas");
  c.width = front.width;
  c.height = front.height;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const mirrored = (draw: () => void) => {
    ctx.save();
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    draw();
    ctx.restore();
  };
  if (sideWall && (r === 1 || r === 3)) {
    sideOn(ctx, front, r === 3);
    return c;
  }
  if (LIES_FLAT.has(key)) {
    // Turned about its middle, then set back down where it lay: centred, its near edge on the same floor line.
    const [, , , y1] = bounds(front);
    const t = document.createElement("canvas");
    t.width = 64;
    t.height = 64;
    const tc = t.getContext("2d")!;
    tc.imageSmoothingEnabled = false;
    tc.translate(32, 32);
    tc.rotate((r * Math.PI) / 2);
    tc.drawImage(front, -16, -16);
    const [a0, b0, a1, b1] = bounds(t);
    const h = b1 - b0;
    const top = Math.max(0, Math.min(y1, c.height) - h);
    ctx.drawImage(t, a0, b0, a1 - a0, h, Math.round(16 - (a1 - a0) / 2), top, a1 - a0, h);
    return c;
  }
  const v = VIEWS[key];
  if (r === 2) {
    if (!v?.back) return front;
    v.back(ctx);
    return c;
  }
  if (!v?.side) return front;
  if (r === 1) v.side(ctx);
  else mirrored(() => v.side!(ctx));
  return c;
}

/** Where on `c` anything's drawn: [x0, y0, x1, y1] (exclusive ends). */
function bounds(c: HTMLCanvasElement): [number, number, number, number] {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width;
  let y0 = c.height;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] < 40) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  return x1 > x0 ? [x0, y0, x1, y1] : [0, 0, c.width, c.height];
}

/**
 * A piece hung on a side wall, seen side on: its front picture narrowed to a
 * strip (whole pixels, no skew) standing off the wall, the wall side of it
 * in shadow, its outline kept. `left`: on the right-hand wall, facing left.
 */
function sideOn(ctx: Ctx, front: HTMLCanvasElement, left: boolean) {
  const [x0, y0, x1, y1] = bounds(front);
  const bw = x1 - x0;
  const nw = Math.max(4, Math.min(9, Math.round(bw * 0.3)));
  const src = front.getContext("2d")!.getImageData(0, 0, front.width, front.height);
  const out = ctx.createImageData(front.width, front.height);
  const dx0 = Math.round(16 - nw / 2);
  for (let y = y0; y < y1; y++)
    for (let i = 0; i < nw; i++) {
      // The columns this one stands for: the solid pixel nearest their middle (so a thin pole or string isn't lost).
      const sa = x0 + Math.floor((i * bw) / nw);
      const sb = Math.max(sa + 1, x0 + Math.floor(((i + 1) * bw) / nw));
      const mid = (sa + sb - 1) / 2;
      let sx = Math.round(mid);
      let best = Infinity;
      for (let x = sa; x < sb; x++) {
        const d = Math.abs(x - mid);
        if (src.data[(y * front.width + x) * 4 + 3] > 40 && d < best) {
          best = d;
          sx = x;
        }
      }
      const s = (y * front.width + sx) * 4;
      const t = (y * front.width + dx0 + i) * 4;
      // The half toward the wall a shade darker (turned from the light).
      const wallSide = left ? i >= nw / 2 : i < nw / 2;
      const k = wallSide ? 0.8 : 1;
      out.data[t] = src.data[s] * k;
      out.data[t + 1] = src.data[s + 1] * k;
      out.data[t + 2] = src.data[s + 2] * k;
      out.data[t + 3] = src.data[s + 3];
    }
  ctx.putImageData(out, 0, 0);
  // Its edge on the wall: a dark line down it, where it meets the wall.
  ctx.fillStyle = O;
  for (let y = y0; y < y1; y++) {
    const row = (y * front.width + dx0 + (left ? nw - 1 : 0)) * 4;
    if (out.data[row + 3] > 40) ctx.fillRect(dx0 + (left ? nw - 1 : 0), y, 1, 1);
  }
}
