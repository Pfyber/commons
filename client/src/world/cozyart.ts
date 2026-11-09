// More for indoors (the cozy home): tables that things stand on, small
// things for on them, things that hang on the wall, and more for the floor;
// drawn at 32×32 like the rest, and the live part of those that switch on
// (lamps and candles glow, the radio and the piano play notes, the laptop's
// screen scrolls, the snow globe snows, the neon heart buzzes, Christmas
// lights twinkle, the cuckoo pops out, the window's curtains open on the sky,
// the Christmas tree's lights chase round to its star, popcorn pops, and the
// fountain trickles all the time).

import { Graphics } from "pixi.js";
import { disc, oval, polygon } from "./pixeldraw";

const O = "#2b2233";
const WOOD = "#8a5a33";
const WOOD_D = "#5e3e22";
const WOOD_L = "#b07a4a";

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** How high each table's top is above the tile's bottom (px): what stands on it sits there. */
export const SURFACE_H: Record<string, number> = {
  coffee_table: 16,
  dining_table: 17,
  writing_desk: 17,
  nightstand: 18,
  low_cabinet: 17,
  bar_cart: 16,
  small_table: 21,
  side_table: 17,
};
/** Small things that can stand on a table (or the floor). */
export const TOPS = new Set(["table_lamp", "candle_trio", "vase_flowers", "tea_set", "book_stack", "succulent", "radio", "laptop", "snow_globe", "photo_frame", "cake_stand", "desk_globe", "fish_bowl", "aquarium", "record_player", "retro_tv", "lava_lamp", "cactus_pot"]);
/** Things that hang on a wall. */
export const WALLS = new Set(["uv_light", "wall_mirror", "neon_heart", "xmas_lights", "wreath", "cuckoo_clock", "wall_shelf", "bunting", "window_curtains", "painting_sunset", "painting_sea", "painting_cat", "wall_clock"]);
/** These switch on and off too. */
export const COZY_TOGGLES = ["table_lamp", "candle_trio", "radio", "laptop", "snow_globe", "neon_heart", "xmas_lights", "cuckoo_clock", "window_curtains", "christmas_tree", "piano", "popcorn_machine", "floor_candles"];

/** A table top: a slab at height `h` (px above the tile's bottom), legs below. */
function table(ctx: CanvasRenderingContext2D, h: number, top: string, edge: string, legs: string, x0 = 2, w = 28) {
  const y = 32 - h - 4;
  px(ctx, O, x0, y - 1, w, 6);
  px(ctx, top, x0 + 1, y, w - 2, 3);
  px(ctx, edge, x0 + 1, y + 3, w - 2, 1);
  px(ctx, O, x0 + 2, y + 4, 3, h + 1);
  px(ctx, O, x0 + w - 5, y + 4, 3, h + 1);
  px(ctx, legs, x0 + 3, y + 4, 1, h);
  px(ctx, legs, x0 + w - 4, y + 4, 1, h);
}

/** Draws `key` (one of these) at 32×32; false if it isn't one. */
export function drawCozy(ctx: CanvasRenderingContext2D, key: string): boolean {
  switch (key) {
    // ---- tables ----
    case "coffee_table":
      table(ctx, 12, WOOD_L, WOOD_D, WOOD);
      px(ctx, "#f8f0e0", 8, 17, 6, 1);
      return true;
    case "dining_table":
      table(ctx, 13, "#f8f4ea", "#d8c8b0", WOOD);
      for (let x = 4; x < 28; x += 4) px(ctx, "#e8566b", x, 15, 2, 1);
      return true;
    case "writing_desk":
      table(ctx, 13, WOOD, WOOD_D, WOOD_D);
      px(ctx, O, 18, 20, 9, 9);
      px(ctx, WOOD, 19, 21, 7, 3);
      px(ctx, WOOD, 19, 25, 7, 3);
      px(ctx, "#f6c343", 22, 22, 2, 1);
      px(ctx, "#f6c343", 22, 26, 2, 1);
      return true;
    case "nightstand":
      px(ctx, O, 7, 14, 18, 17);
      px(ctx, WOOD_L, 8, 15, 16, 3);
      px(ctx, WOOD, 8, 18, 16, 12);
      px(ctx, WOOD_D, 8, 23, 16, 1);
      disc(ctx, "#f6c343", 16, 21, 1);
      disc(ctx, "#f6c343", 16, 26, 1);
      return true;
    case "low_cabinet":
      px(ctx, O, 2, 15, 28, 16);
      px(ctx, WOOD_L, 3, 16, 26, 3);
      px(ctx, WOOD, 3, 19, 26, 11);
      px(ctx, WOOD_D, 16, 19, 1, 11);
      disc(ctx, "#f6c343", 14, 24, 1);
      disc(ctx, "#f6c343", 19, 24, 1);
      return true;
    case "bar_cart":
      table(ctx, 12, "#c8c8d4", "#8a8a9a", "#a8a8b8", 4, 24);
      px(ctx, "#8a8a9a", 6, 26, 20, 2);
      disc(ctx, O, 8, 30, 2);
      disc(ctx, O, 24, 30, 2);
      px(ctx, "#5aa04a", 9, 22, 3, 4);
      px(ctx, "#c8323a", 14, 21, 3, 5);
      return true;
    // ---- small things (they stand at the tile's bottom; on a table, they're lifted onto it) ----
    case "table_lamp":
      polygon(ctx, O, [[9, 13], [23, 13], [20, 4], [12, 4]]);
      polygon(ctx, "#f8e8c0", [[10, 12], [22, 12], [19, 5], [13, 5]]);
      px(ctx, O, 15, 13, 2, 13);
      px(ctx, O, 11, 26, 10, 5);
      px(ctx, "#5a7a9a", 12, 27, 8, 3);
      return true;
    case "candle_trio":
      for (const [x, h] of [[9, 10], [15, 14], [21, 8]] as [number, number][]) {
        px(ctx, O, x - 1, 30 - h, 5, h + 1);
        px(ctx, "#f8f0e0", x, 31 - h, 3, h - 1);
        px(ctx, O, x + 1, 28 - h, 1, 2);
      }
      oval(ctx, "#c8a070", 16, 30, 11, 2);
      return true;
    case "vase_flowers":
      polygon(ctx, O, [[11, 31], [21, 31], [23, 21], [9, 21]]);
      polygon(ctx, "#4f86d8", [[12, 30], [20, 30], [22, 22], [10, 22]]);
      px(ctx, "#2e8a4a", 14, 10, 1, 12);
      px(ctx, "#2e8a4a", 17, 8, 1, 14);
      px(ctx, "#2e8a4a", 20, 12, 1, 10);
      disc(ctx, "#e8566b", 14, 9, 3);
      disc(ctx, "#f6c343", 18, 7, 3);
      disc(ctx, "#ef8bb5", 21, 11, 3);
      return true;
    case "tea_set":
      oval(ctx, O, 12, 25, 8, 6);
      oval(ctx, "#f8f4ea", 12, 25, 7, 5);
      px(ctx, "#4f86d8", 7, 24, 10, 2);
      px(ctx, O, 3, 22, 3, 2);
      px(ctx, O, 11, 18, 3, 2);
      oval(ctx, O, 24, 28, 5, 3);
      oval(ctx, "#f8f4ea", 24, 27, 4, 2);
      oval(ctx, "#a0603a", 24, 27, 3, 1);
      return true;
    case "book_stack":
      for (const [y, c, dx] of [[25, "#c8323a", 0], [21, "#4f86d8", 2], [17, "#5aa04a", -1], [13, "#f6c343", 1]] as [number, string, number][]) {
        px(ctx, O, 7 + dx, y, 18, 5);
        px(ctx, c, 8 + dx, y + 1, 16, 3);
        px(ctx, "#f8f0e0", 22 + dx, y + 1, 2, 3);
      }
      return true;
    case "succulent":
      px(ctx, O, 10, 22, 12, 9);
      px(ctx, "#d8d8e0", 11, 23, 10, 7);
      for (const [x, y] of [[16, 15], [12, 18], [20, 18], [14, 20], [18, 20]]) {
        disc(ctx, O, x, y, 3.5);
        disc(ctx, "#7ac08a", x, y, 2.5);
      }
      disc(ctx, "#ef8bb5", 16, 15, 1);
      return true;
    case "radio":
      px(ctx, O, 4, 14, 24, 17);
      px(ctx, "#c8803a", 5, 15, 22, 15);
      disc(ctx, O, 12, 22, 5);
      disc(ctx, "#5e3e22", 12, 22, 4);
      for (let y = 19; y < 26; y += 2) px(ctx, "#8a5a33", 9, y, 7, 1);
      px(ctx, "#f8f0e0", 19, 17, 6, 4);
      disc(ctx, "#f6c343", 20, 25, 1.5);
      disc(ctx, "#f6c343", 24, 25, 1.5);
      px(ctx, O, 23, 6, 1, 8);
      return true;
    case "laptop":
      polygon(ctx, O, [[5, 31], [27, 31], [25, 26], [7, 26]]);
      polygon(ctx, "#a8a8b8", [[6, 30], [26, 30], [24, 27], [8, 27]]);
      px(ctx, O, 7, 12, 18, 15);
      px(ctx, "#2a2a34", 8, 13, 16, 12);
      return true;
    case "photo_frame":
      polygon(ctx, O, [[9, 31], [23, 31], [22, 13], [10, 13]]);
      px(ctx, "#c99a2a", 10, 14, 12, 16);
      px(ctx, "#9fd8ff", 12, 16, 8, 12);
      disc(ctx, "#f0c8a0", 16, 21, 2);
      px(ctx, "#4f86d8", 14, 24, 5, 4);
      return true;
    case "cake_stand":
      px(ctx, O, 14, 25, 4, 6);
      oval(ctx, O, 16, 25, 11, 2.5);
      oval(ctx, "#f8f4ea", 16, 25, 10, 1.5);
      px(ctx, O, 8, 15, 16, 10);
      px(ctx, "#ef8bb5", 9, 16, 14, 8);
      px(ctx, "#f8f4ea", 9, 16, 14, 2);
      for (let x = 10; x < 23; x += 3) px(ctx, "#f8f4ea", x, 18, 1, 2);
      disc(ctx, "#c8323a", 16, 13, 2);
      return true;
    case "desk_globe":
      px(ctx, O, 11, 28, 10, 3);
      px(ctx, "#c99a2a", 15, 22, 2, 7);
      disc(ctx, O, 16, 14, 9);
      disc(ctx, "#4f86d8", 16, 14, 8);
      polygon(ctx, "#5fb36b", [[12, 9], [17, 8], [16, 14], [11, 15]]);
      polygon(ctx, "#5fb36b", [[18, 15], [22, 13], [21, 19], [18, 19]]);
      px(ctx, "#c99a2a", 7, 13, 1, 3);
      px(ctx, "#c99a2a", 24, 13, 1, 3);
      return true;
    // ---- on the wall (drawn high on the tile: on a wall, it hangs there) ----
    case "wall_mirror":
      oval(ctx, O, 16, 13, 10, 12);
      oval(ctx, "#c99a2a", 16, 13, 9, 11);
      oval(ctx, "#bfe8f8", 16, 13, 7, 9);
      polygon(ctx, "#ffffff", [[11, 9], [14, 6], [15, 7], [12, 10]]);
      polygon(ctx, "#e8f8ff", [[17, 18], [21, 13], [21, 15], [18, 19]]);
      return true;
    case "neon_heart":
      px(ctx, O, 5, 3, 22, 19);
      px(ctx, "#2a2a34", 6, 4, 20, 17);
      disc(ctx, "#8a3a5a", 12, 10, 4);
      disc(ctx, "#8a3a5a", 20, 10, 4);
      polygon(ctx, "#8a3a5a", [[8, 11], [24, 11], [16, 19]]);
      disc(ctx, "#2a2a34", 12, 10, 2.5);
      disc(ctx, "#2a2a34", 20, 10, 2.5);
      polygon(ctx, "#2a2a34", [[11, 12], [21, 12], [16, 16]]);
      return true;
    case "xmas_lights":
      for (let x = 0; x < 32; x++) px(ctx, "#2e5a3a", x, Math.round(6 + Math.sin(x / 32 * Math.PI * 2) * 3), 1, 1);
      for (let i = 0; i < 6; i++) {
        const x = 3 + i * 5;
        const y = Math.round(6 + Math.sin(x / 32 * Math.PI * 2) * 3);
        px(ctx, ["#c8323a", "#f6c343", "#4f86d8", "#5fb36b", "#ef8bb5", "#ff8a3f"][i], x - 1, y + 1, 3, 4);
      }
      return true;
    case "wreath":
      disc(ctx, O, 16, 12, 10);
      disc(ctx, "#2e7a3a", 16, 12, 9);
      disc(ctx, "#3a9a4a", 15, 11, 7);
      disc(ctx, O, 16, 12, 4);
      disc(ctx, "#1e5a2a", 16, 12, 3);
      for (const [x, y] of [[9, 9], [22, 8], [11, 18], [21, 17], [16, 3]]) disc(ctx, "#c8323a", x, y, 1.5);
      polygon(ctx, "#c8323a", [[12, 21], [16, 19], [20, 21], [16, 25]]);
      return true;
    case "cuckoo_clock":
      polygon(ctx, O, [[5, 9], [16, 1], [27, 9]]);
      polygon(ctx, WOOD_D, [[7, 9], [16, 3], [25, 9]]);
      px(ctx, O, 7, 8, 18, 15);
      px(ctx, WOOD, 8, 9, 16, 13);
      px(ctx, O, 14, 3, 4, 5);
      px(ctx, "#2a1a10", 15, 4, 2, 3);
      disc(ctx, O, 16, 16, 4);
      disc(ctx, "#f8f0e0", 16, 16, 3);
      px(ctx, O, 16, 14, 1, 3);
      px(ctx, O, 16, 16, 2, 1);
      px(ctx, "#c99a2a", 12, 23, 1, 6);
      px(ctx, "#c99a2a", 20, 23, 1, 4);
      disc(ctx, "#c99a2a", 12, 29, 1.5);
      disc(ctx, "#c99a2a", 20, 27, 1.5);
      return true;
    case "wall_shelf":
      px(ctx, O, 3, 14, 26, 4);
      px(ctx, WOOD_L, 4, 15, 24, 2);
      px(ctx, O, 6, 17, 2, 4);
      px(ctx, O, 24, 17, 2, 4);
      px(ctx, O, 6, 6, 5, 8);
      px(ctx, "#c8323a", 7, 7, 3, 7);
      px(ctx, O, 11, 8, 4, 6);
      px(ctx, "#4f86d8", 12, 9, 2, 5);
      px(ctx, O, 18, 9, 7, 5);
      px(ctx, "#c8602a", 19, 10, 5, 4);
      disc(ctx, "#5fb36b", 21, 7, 3);
      return true;
    case "bunting":
      for (let x = 0; x < 32; x++) px(ctx, "#8a6a40", x, Math.round(4 + Math.sin(x / 32 * Math.PI) * 4), 1, 1);
      for (let i = 0; i < 5; i++) {
        const x = 2 + i * 6;
        const y = Math.round(4 + Math.sin((x + 2) / 32 * Math.PI) * 4);
        polygon(ctx, ["#c8323a", "#f6c343", "#4f86d8", "#5fb36b", "#ef8bb5"][i], [[x, y], [x + 5, y], [x + 2.5, y + 7]]);
      }
      return true;
    case "window_curtains":
      // A window: the panes (the sky behind) and the curtains drawn across it.
      px(ctx, O, 4, 1, 24, 22);
      px(ctx, "#f8f4ea", 5, 2, 22, 20);
      px(ctx, "#9fd8ff", 7, 4, 18, 16);
      px(ctx, "#f8f4ea", 15, 4, 2, 16);
      px(ctx, "#f8f4ea", 7, 11, 18, 2);
      px(ctx, O, 3, 0, 26, 2);
      px(ctx, "#c8323a", 4, 2, 12, 20);
      px(ctx, "#c8323a", 16, 2, 12, 20);
      for (let x = 5; x < 28; x += 3) px(ctx, "#a02a2a", x, 3, 1, 18);
      return true;
    // ---- for the floor ----
    case "christmas_tree":
      px(ctx, O, 14, 26, 5, 5);
      px(ctx, WOOD_D, 15, 27, 3, 4);
      for (const [y, w] of [[18, 13], [11, 10], [5, 6]] as [number, number][]) {
        polygon(ctx, O, [[16 - w - 1, y + 9], [16 + w + 1, y + 9], [16, y - 1]]);
        polygon(ctx, "#2e7a3a", [[16 - w, y + 8], [16 + w, y + 8], [16, y]]);
        polygon(ctx, "#3a9a4a", [[16 - w + 3, y + 7], [16, y + 1], [16, y + 7]]);
      }
      for (const [x, y] of [[11, 22], [20, 24], [13, 15], [19, 17], [15, 10]]) disc(ctx, "#c8323a", x, y, 1.2);
      polygon(ctx, "#f6c343", [[16, 0], [17, 2], [19, 2], [17, 3], [18, 5], [16, 4], [14, 5], [15, 3], [13, 2], [15, 2]]);
      px(ctx, O, 5, 26, 7, 5);
      px(ctx, "#4f86d8", 6, 27, 5, 3);
      px(ctx, "#f6c343", 8, 26, 1, 5);
      return true;
    case "piano":
      px(ctx, O, 2, 2, 28, 29);
      px(ctx, "#1a1418", 3, 3, 26, 27);
      px(ctx, "#2a2028", 3, 3, 26, 3);
      px(ctx, O, 3, 16, 26, 5);
      px(ctx, "#f8f4ea", 3, 17, 26, 3);
      for (let x = 4; x < 29; x += 3) px(ctx, O, x, 17, 1, 3);
      for (let x = 5; x < 28; x += 6) {
        px(ctx, O, x, 17, 2, 2);
        px(ctx, O, x + 3, 17, 2, 2);
      }
      px(ctx, "#c99a2a", 13, 8, 6, 5);
      px(ctx, "#f8f4ea", 14, 9, 4, 3);
      px(ctx, O, 4, 21, 2, 9);
      px(ctx, O, 26, 21, 2, 9);
      return true;
    case "teddy_bear":
      disc(ctx, O, 16, 22, 8);
      disc(ctx, "#b07a4a", 16, 22, 7);
      disc(ctx, "#e8c8a0", 16, 23, 4);
      disc(ctx, O, 16, 11, 7);
      disc(ctx, "#b07a4a", 16, 11, 6);
      disc(ctx, O, 10, 6, 3);
      disc(ctx, O, 22, 6, 3);
      disc(ctx, "#b07a4a", 10, 6, 2);
      disc(ctx, "#b07a4a", 22, 6, 2);
      oval(ctx, "#e8c8a0", 16, 13, 3, 2);
      px(ctx, O, 13, 10, 1, 1);
      px(ctx, O, 19, 10, 1, 1);
      px(ctx, O, 15, 12, 2, 1);
      px(ctx, "#c8323a", 12, 16, 8, 2);
      return true;
    case "toy_chest":
      px(ctx, O, 3, 10, 26, 21);
      px(ctx, "#4f86d8", 4, 11, 24, 6);
      px(ctx, "#6a9ae8", 4, 11, 24, 2);
      px(ctx, "#f6c343", 4, 17, 24, 2);
      px(ctx, "#4f86d8", 4, 19, 24, 11);
      polygon(ctx, "#c8323a", [[12, 22], [16, 20], [20, 22], [16, 28]]);
      disc(ctx, "#f6c343", 16, 18, 2);
      px(ctx, "#5fb36b", 8, 7, 3, 4);
      disc(ctx, "#ef8bb5", 22, 9, 3);
      return true;
    case "floor_cushions":
      for (const [x, y, c] of [[10, 22, "#e07a2f"], [21, 20, "#4f86d8"], [15, 26, "#ef8bb5"]] as [number, number, string][]) {
        oval(ctx, O, x, y, 7, 4.5);
        oval(ctx, c, x, y, 6, 3.5);
        px(ctx, "rgba(255,255,255,0.5)", x - 3, y - 2, 3, 1);
        disc(ctx, "rgba(0,0,0,0.25)", x, y, 1);
      }
      return true;
    case "bookcase_full":
      px(ctx, O, 3, -2, 26, 33);
      px(ctx, WOOD, 4, -1, 24, 31);
      for (const y of [-1, 9, 19]) {
        px(ctx, WOOD_D, 5, y + 1, 22, 9);
        let x = 6;
        let i = 0;
        while (x < 25) {
          const w = 2 + ((x * 7 + y) % 3);
          const h = 6 + ((x + y * 3) % 3);
          px(ctx, ["#c8323a", "#4f86d8", "#5fb36b", "#f6c343", "#ef8bb5", "#8a4fb0"][(i + y) % 6], x, y + 10 - h, w, h);
          x += w + 1;
          i++;
        }
      }
      return true;
    case "plant_stand":
      px(ctx, O, 10, 18, 12, 13);
      px(ctx, WOOD_L, 11, 18, 10, 2);
      px(ctx, WOOD, 12, 20, 2, 10);
      px(ctx, WOOD, 18, 20, 2, 10);
      px(ctx, O, 10, 11, 12, 8);
      px(ctx, "#c8602a", 11, 12, 10, 6);
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * Math.PI;
        const x = 16 - Math.cos(a) * 11;
        polygon(ctx, "#3a9a4a", [[16, 11], [x - 2, 8 - Math.sin(a) * 8], [x + 2, 10 - Math.sin(a) * 6]]);
      }
      return true;
    case "indoor_fountain":
      oval(ctx, O, 16, 25, 14, 6);
      oval(ctx, "#a8a8b8", 16, 25, 13, 5);
      oval(ctx, "#4aa8d8", 16, 24, 11, 3);
      px(ctx, O, 14, 9, 4, 16);
      px(ctx, "#c8c8d4", 15, 10, 2, 15);
      oval(ctx, O, 16, 10, 7, 3);
      oval(ctx, "#c8c8d4", 16, 10, 6, 2);
      oval(ctx, "#6ac8f0", 16, 9, 4, 1);
      return true;
    case "popcorn_machine":
      px(ctx, O, 6, 2, 20, 29);
      px(ctx, "#c8323a", 7, 3, 18, 5);
      px(ctx, "#f6c343", 9, 4, 14, 3);
      px(ctx, O, 7, 8, 18, 14);
      px(ctx, "#d8f0ff", 8, 9, 16, 12);
      for (let i = 0; i < 12; i++) disc(ctx, "#fff8d0", 9 + ((i * 5) % 15), 18 + (i % 3), 1.3);
      px(ctx, "#c8323a", 7, 22, 18, 8);
      px(ctx, "#f6c343", 7, 24, 18, 1);
      px(ctx, O, 8, 30, 3, 1);
      px(ctx, O, 21, 30, 3, 1);
      return true;
    case "cozy_armchair":
      px(ctx, O, 3, 6, 26, 25);
      px(ctx, "#8a4fb0", 4, 7, 24, 14);
      px(ctx, "#a06ac8", 6, 8, 20, 3);
      px(ctx, "#8a4fb0", 3, 15, 6, 13);
      px(ctx, "#8a4fb0", 23, 15, 6, 13);
      px(ctx, "#a06ac8", 9, 19, 14, 8);
      px(ctx, "#e8d8b8", 11, 13, 10, 8);
      for (let y = 14; y < 21; y += 2) px(ctx, "#d8c098", 11, y, 10, 1);
      px(ctx, O, 5, 28, 2, 3);
      px(ctx, O, 25, 28, 2, 3);
      return true;
    case "blanket_basket":
      px(ctx, O, 6, 17, 20, 14);
      px(ctx, "#c99a6a", 7, 18, 18, 12);
      for (let y = 19; y < 30; y += 3) px(ctx, "#a0703f", 7, y, 18, 1);
      polygon(ctx, O, [[5, 18], [27, 18], [24, 8], [9, 9]]);
      polygon(ctx, "#5f8fc4", [[6, 17], [15, 17], [14, 9], [9, 10]]);
      polygon(ctx, "#e8566b", [[15, 17], [26, 17], [23, 9], [14, 9]]);
      for (let x = 16; x < 25; x += 3) px(ctx, "#f8f0e0", x, 10, 1, 7);
      return true;
    case "floor_candles":
      for (const [x, h] of [[7, 18], [16, 24], [25, 14]] as [number, number][]) {
        px(ctx, O, x - 3, 31 - 3, 7, 3);
        px(ctx, "#c99a2a", x - 2, 29, 5, 2);
        px(ctx, O, x - 2, 30 - h, 5, h - 1);
        px(ctx, "#f8f0e0", x - 1, 31 - h, 3, h - 3);
        px(ctx, O, x, 28 - h, 1, 2);
      }
      return true;
  }
  return false;
}

/** The live part of piece `key`, if one of these has one: draws into `g` each frame. */
export function cozyLive(key: string): ((g: Graphics, now: number, on: boolean) => void) | null {
  const flame = (g: Graphics, x: number, y: number, now: number, i: number) => {
    const f = Math.sin(now / 90 + i * 2) * 0.6;
    g.ellipse(x + f * 0.3, y - 2, 1.4, 2.6 + f).fill({ color: 0xffb02a });
    g.ellipse(x + f * 0.3, y - 1.5, 0.7, 1.4).fill({ color: 0xfff3a8 });
    g.circle(x, y - 2, 6).fill({ color: 0xffb04a, alpha: 0.12 });
  };
  const notes = (g: Graphics, now: number, x0: number, y0: number, color = 0x2b2233) => {
    for (let i = 0; i < 3; i++) {
      const t = (now / 1500 + i / 3) % 1;
      const x = x0 + i * 4 + Math.sin(t * 6 + i) * 2;
      const y = y0 - t * 14;
      g.rect(x, y, 1, 4).fill({ color, alpha: 1 - t });
      g.ellipse(x - 1, y + 4, 1.6, 1.2).fill({ color, alpha: 1 - t });
    }
  };
  switch (key) {
    case "table_lamp":
      return (g, _now, on) => {
        if (!on) return;
        g.circle(16, 9, 16).fill({ color: 0xffe0a0, alpha: 0.16 });
        g.poly([10, 12, 22, 12, 19, 5, 13, 5]).fill({ color: 0xfff3c8, alpha: 0.75 });
      };
    case "candle_trio":
      return (g, now, on) => {
        if (!on) return;
        flame(g, 10, 20, now, 0);
        flame(g, 16, 16, now, 1);
        flame(g, 22, 22, now, 2);
      };
    case "floor_candles":
      return (g, now, on) => {
        if (!on) return;
        flame(g, 7, 12, now, 0);
        flame(g, 16, 6, now, 1);
        flame(g, 25, 16, now, 2);
        g.ellipse(16, 31, 16, 3).fill({ color: 0xffb04a, alpha: 0.12 });
      };
    case "radio":
      return (g, now, on) => {
        if (!on) return;
        notes(g, now, 10, 12);
        g.rect(19, 17, 6, 4).fill({ color: 0xfff3a8, alpha: 0.8 });
        g.rect(19 + ((now / 400) % 5), 17, 1, 4).fill({ color: 0xc8323a });
      };
    case "laptop":
      return (g, now, on) => {
        if (!on) return;
        g.rect(8, 13, 16, 12).fill({ color: 0x3a6aa8 });
        const s = Math.floor(now / 250);
        for (let i = 0; i < 4; i++) g.rect(10, 15 + i * 2.5, 6 + ((s + i * 3) % 8), 1).fill({ color: 0xbfefff });
        if (Math.floor(now / 500) % 2) g.rect(10 + ((s + 3) % 8) + 6, 22.5, 1, 1.5).fill({ color: 0xffffff });
        g.rect(7, 12, 18, 15).fill({ color: 0x9fd8ff, alpha: 0.08 });
      };
    case "snow_globe":
      return (g, now, on) => {
        if (!on) return;
        // Shaken: snow whirling down in the glass.
        for (let i = 0; i < 9; i++) {
          const t = (now / 2400 + i / 9) % 1;
          g.rect(10 + ((i * 7) % 12) + Math.sin(now / 300 + i) * 1.5, 8 + t * 12, 1, 1).fill({ color: 0xffffff });
        }
      };
    case "neon_heart":
      return (g, _now, on) => {
        if (!on) return;
        const buzz = Math.random() < 0.02 ? 0.3 : 1;
        g.circle(12, 10, 4).stroke({ color: 0xff4f9a, width: 2, alpha: buzz });
        g.circle(20, 10, 4).stroke({ color: 0xff4f9a, width: 2, alpha: buzz });
        g.poly([8.5, 12, 23.5, 12, 16, 19]).stroke({ color: 0xff4f9a, width: 2, alpha: buzz });
        g.circle(16, 12, 14).fill({ color: 0xff4f9a, alpha: 0.12 * buzz });
      };
    case "xmas_lights":
      return (g, now, on) => {
        if (!on) return;
        for (let i = 0; i < 6; i++) {
          const x = 3 + i * 5;
          const y = Math.round(6 + Math.sin(x / 32 * Math.PI * 2) * 3);
          const lit = (Math.floor(now / 350) + i) % 3 !== 0;
          if (!lit) continue;
          const c = [0xff4a4a, 0xffe14f, 0x6ab8ff, 0x7adf6a, 0xff8ad0, 0xffa04a][i];
          g.circle(x + 0.5, y + 3, 4).fill({ color: c, alpha: 0.25 });
          g.rect(x - 1, y + 1, 3, 4).fill({ color: c });
        }
      };
    case "cuckoo_clock":
      return (g, now, on) => {
        // The pendulum swings anyway; on, the cuckoo pops out every few seconds.
        const a = Math.sin(now / 500) * 0.4;
        g.moveTo(16, 21).lineTo(16 + Math.sin(a) * 7, 21 + Math.cos(a) * 7).stroke({ color: 0xc99a2a, width: 1 });
        g.circle(16 + Math.sin(a) * 7, 21 + Math.cos(a) * 7, 1.5).fill({ color: 0xc99a2a });
        if (!on) return;
        const t = (now / 3000) % 1;
        if (t < 0.25) {
          // Out of its little door and back: a yellow bird, beak open.
          const out = Math.sin((t / 0.25) * Math.PI) * 3;
          const bx = 16 - out;
          g.ellipse(bx, 5.5, 2.5, 2).fill({ color: 0xf6c343 });
          g.poly([bx - 2, 5, bx - 4.5, 5.5, bx - 2, 6.5]).fill({ color: 0xff8a3f });
          g.rect(bx - 1, 4.5, 1, 1).fill({ color: 0x2b2233 });
        }
      };
    case "window_curtains":
      return (g, now, on) => {
        if (!on) return;
        // Curtains drawn back: the sky, clouds drifting by; light falls in.
        g.rect(7, 4, 18, 16).fill({ color: 0x9fd8ff });
        const cx = ((now / 120) % 28) - 4;
        g.ellipse(7 + cx, 8, 3, 1.5).fill({ color: 0xffffff });
        g.ellipse(7 + ((cx + 12) % 28) - 4, 14, 4, 1.5).fill({ color: 0xffffff });
        g.rect(15, 4, 2, 16).fill({ color: 0xf8f4ea });
        g.rect(7, 11, 18, 2).fill({ color: 0xf8f4ea });
        g.rect(4, 2, 4, 20).fill({ color: 0xc8323a });
        g.rect(24, 2, 4, 20).fill({ color: 0xc8323a });
        g.poly([7, 22, 25, 22, 30, 34, 2, 34]).fill({ color: 0xfff3c8, alpha: 0.12 });
      };
    case "christmas_tree":
      return (g, now, on) => {
        if (!on) return;
        const lights = [[10, 25], [14, 23], [19, 24], [23, 25], [12, 18], [17, 16], [21, 19], [14, 11], [18, 12], [16, 7]];
        lights.forEach(([x, y], i) => {
          const lit = (Math.floor(now / 250) + i) % 4 !== 0;
          if (!lit) return;
          const c = [0xff4a4a, 0xffe14f, 0x6ab8ff, 0xff8ad0][i % 4];
          g.circle(x, y, 2.5).fill({ color: c, alpha: 0.3 });
          g.circle(x, y, 1).fill({ color: c });
        });
        const s = 0.5 + 0.5 * Math.sin(now / 300);
        g.circle(16, 2, 5).fill({ color: 0xfff3a8, alpha: 0.2 + 0.25 * s });
      };
    case "piano":
      return (g, now, on) => {
        if (!on) return;
        // Playing itself: keys dipping in turn, notes rising.
        for (let i = 0; i < 3; i++) {
          const k = (Math.floor(now / 180) * 7 + i * 5) % 8;
          g.rect(4 + k * 3, 17, 2, 3).fill({ color: 0xd8d0c0 });
        }
        notes(g, now, 9, 10, 0xf8f4ea);
      };
    case "popcorn_machine":
      return (g, now, on) => {
        if (!on) return;
        g.rect(8, 9, 16, 12).fill({ color: 0xfff3c8, alpha: 0.25 });
        for (let i = 0; i < 6; i++) {
          const t = (now / 700 + i / 6) % 1;
          const x = 10 + ((i * 5) % 13) + Math.sin(i + now / 200) * 1;
          const y = 19 - Math.sin(t * Math.PI) * 9;
          g.circle(x, y, 1.3).fill({ color: 0xfff8d0 });
        }
      };
    case "indoor_fountain":
      return (g, now) => {
        // Always running: water falling from the top bowl, ripples below.
        for (let i = 0; i < 4; i++) {
          const t = (now / 600 + i / 4) % 1;
          g.rect(10 + (i % 2) * 11, 11 + t * 11, 1, 2).fill({ color: 0x9fe8ff, alpha: 1 - t * 0.5 });
        }
        const r = ((now / 900) % 1) * 9;
        g.ellipse(16, 24, r + 2, (r + 2) * 0.3).stroke({ color: 0xffffff, width: 1, alpha: 0.6 * (1 - r / 9) });
      };
  }
  return null;
}
