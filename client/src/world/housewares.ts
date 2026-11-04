// Inside Housing (the mall's shop for indoors): paintings, lights, rugs,
// beds and plants, drawn at 32×32 like the rest of the furniture; and the
// things you use, alive when they're placed: fish tanks your catch swims
// round in, lights and gadgets that turn on (the lava lamp's blobs rise, the
// fireplace flickers, the TV and the arcade cabinet glow, the record player
// spins, the disco ball throws spots about), and the pet's bed and tree
// with your pet curled up on it (at home, if you have one).

import { Container, Graphics, Sprite } from "pixi.js";
import { disc, oval, polygon } from "./pixeldraw";
import { itemTexture } from "./items";
import { COZY_TOGGLES, cozyLive, drawCozy } from "./cozyart";

const O = "#2b2233";

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Rugs lie flat (drawn under whoever stands on them). */
export const FLAT = new Set(["round_rug", "rug_persian", "rug_stripes", "rug_heart", "floor_cushions"]);
/** Pieces that turn on and off. */
export const TOGGLES = new Set(["fairy_string", "lava_lamp", "paper_lantern", "aquarium", "record_player", "retro_tv", "fireplace", "arcade_cabinet", "disco_ball", ...COZY_TOGGLES]);
/** Fish tanks, and how many they hold (as the server's `tank`). */
export const TANKS: Record<string, number> = { fish_bowl: 3, aquarium: 8 };
/** A pet's things: it curls up on them, at home. */
export const PET_SPOTS = new Set(["dog_bed", "cat_tree", "pet_bowl"]);

/** Draws `key` (one of these) at 32×32; false if it isn't one. */
export function drawHouseware(ctx: CanvasRenderingContext2D, key: string): boolean {
  switch (key) {
    case "painting_sunset":
    case "painting_sea":
    case "painting_cat": {
      // A gilt frame hung high (by a wall it hangs on it), its picture inside.
      px(ctx, "rgba(0,0,0,0.18)", 6, 22, 22, 2);
      px(ctx, O, 4, 2, 24, 20);
      px(ctx, "#c99a2a", 5, 3, 22, 18);
      px(ctx, "#f6d36b", 5, 3, 22, 1);
      px(ctx, O, 7, 5, 18, 14);
      if (key === "painting_sunset") {
        px(ctx, "#ff9a5a", 8, 6, 16, 6);
        px(ctx, "#ffd06a", 8, 9, 16, 3);
        disc(ctx, "#fff3a8", 16, 12, 3);
        px(ctx, "#3a7a5a", 8, 13, 16, 5);
        px(ctx, "#2a5a4a", 8, 15, 6, 3);
      } else if (key === "painting_sea") {
        px(ctx, "#9fd8ff", 8, 6, 16, 6);
        px(ctx, "#2f6fae", 8, 12, 16, 6);
        for (let x = 8; x < 24; x += 3) px(ctx, "#ffffff", x, 12 + (x % 2), 2, 1);
        px(ctx, "#ffffff", 17, 8, 3, 3);
        px(ctx, "#a0522d", 16, 11, 5, 1);
      } else {
        px(ctx, "#7a4a8a", 8, 6, 16, 12);
        oval(ctx, "#f0a040", 16, 13, 5, 4);
        polygon(ctx, "#f0a040", [[11, 10], [12, 6], [14, 9]]);
        polygon(ctx, "#f0a040", [[21, 10], [20, 6], [18, 9]]);
        px(ctx, "#2b2233", 14, 12, 1, 1);
        px(ctx, "#2b2233", 18, 12, 1, 1);
        px(ctx, "#e8566b", 16, 14, 1, 1);
      }
      return true;
    }
    case "fairy_string": {
      // A little stand with a string of bulbs looped over it.
      px(ctx, O, 15, 6, 2, 24);
      px(ctx, O, 10, 28, 12, 3);
      for (let i = 0; i < 9; i++) {
        const a = i / 8;
        const x = 4 + a * 24;
        const y = 6 + Math.sin(a * Math.PI) * 10;
        px(ctx, "#5a5a6a", Math.round(x), Math.round(y) - 1, 1, 1);
        disc(ctx, ["#ff8a8a", "#ffe14f", "#8fd3ff", "#9fe07a"][i % 4], Math.round(x), Math.round(y) + 1, 1.5);
      }
      return true;
    }
    case "lava_lamp":
      polygon(ctx, O, [[11, 30], [21, 30], [19, 22], [13, 22]]);
      polygon(ctx, "#8a8a9a", [[12, 29], [20, 29], [18, 23], [14, 23]]);
      polygon(ctx, O, [[12, 22], [20, 22], [18, 6], [14, 6]]);
      polygon(ctx, "#7a3aa0", [[13, 21], [19, 21], [17, 7], [15, 7]]);
      disc(ctx, "#ff6a9a", 16, 18, 2);
      disc(ctx, "#ff6a9a", 16, 11, 1.5);
      px(ctx, O, 14, 3, 4, 4);
      px(ctx, "#8a8a9a", 15, 4, 2, 2);
      return true;
    case "paper_lantern":
      px(ctx, O, 15, 14, 2, 16);
      px(ctx, O, 11, 28, 10, 3);
      oval(ctx, O, 16, 9, 8, 8);
      oval(ctx, "#f8f0e0", 16, 9, 7, 7);
      for (const y of [4, 8, 12]) px(ctx, "#d8c8b0", 10, y, 12, 1);
      px(ctx, "#c8323a", 13, 0, 6, 2);
      return true;
    case "rug_persian":
      oval(ctx, O, 16, 22, 15, 8);
      px(ctx, O, 2, 15, 28, 14);
      px(ctx, "#8f2a2a", 3, 16, 26, 12);
      px(ctx, "#f2c94c", 5, 18, 22, 8);
      px(ctx, "#3a4a8a", 7, 19, 18, 6);
      polygon(ctx, "#f2c94c", [[16, 19], [21, 22], [16, 25], [11, 22]]);
      disc(ctx, "#8f2a2a", 16, 22, 1.5);
      for (let x = 3; x < 29; x += 2) {
        px(ctx, "#f8f0e0", x, 14, 1, 2);
        px(ctx, "#f8f0e0", x, 28, 1, 2);
      }
      return true;
    case "rug_stripes":
      px(ctx, O, 3, 16, 26, 13);
      ["#4f86d8", "#f8f0e0", "#e8566b", "#f8f0e0", "#5fb36b", "#f8f0e0"].forEach((c, i) => px(ctx, c, 4, 17 + i * 2, 24, 2));
      return true;
    case "rug_heart":
      disc(ctx, O, 11, 18, 7);
      disc(ctx, O, 21, 18, 7);
      polygon(ctx, O, [[4, 20], [28, 20], [16, 31]]);
      disc(ctx, "#ef8bb5", 11, 18, 6);
      disc(ctx, "#ef8bb5", 21, 18, 6);
      polygon(ctx, "#ef8bb5", [[5, 20], [27, 20], [16, 30]]);
      disc(ctx, "#ffc8dc", 10, 16, 2);
      return true;
    case "double_bed":
      px(ctx, O, 1, 2, 30, 29);
      px(ctx, "#8a5a33", 2, 3, 28, 6);
      px(ctx, "#f8f4ea", 2, 9, 28, 20);
      px(ctx, "#ffffff", 4, 10, 11, 5);
      px(ctx, "#ffffff", 17, 10, 11, 5);
      px(ctx, "#4f86d8", 2, 16, 28, 13);
      px(ctx, "#6a9ae8", 2, 16, 28, 2);
      px(ctx, "#8a5a33", 2, 28, 28, 3);
      return true;
    case "bunk_bed":
      px(ctx, O, 3, -4, 26, 35);
      px(ctx, "#8a5a33", 4, -3, 2, 33);
      px(ctx, "#8a5a33", 26, -3, 2, 33);
      px(ctx, "#e8566b", 6, 2, 20, 6);
      px(ctx, "#ffffff", 7, 1, 6, 3);
      px(ctx, "#8a5a33", 4, 8, 24, 2);
      px(ctx, "#5fb36b", 6, 18, 20, 7);
      px(ctx, "#ffffff", 7, 17, 6, 3);
      px(ctx, "#8a5a33", 4, 25, 24, 2);
      for (let y = 0; y < 24; y += 4) px(ctx, "#a0703f", 27, y, 3, 1);
      return true;
    case "bean_bag":
      oval(ctx, O, 16, 23, 12, 8);
      oval(ctx, "#e07a2f", 16, 23, 11, 7);
      oval(ctx, "#f09a4f", 13, 20, 6, 3);
      px(ctx, "#c8602a", 15, 24, 2, 4);
      return true;
    case "monstera":
      px(ctx, O, 10, 22, 12, 9);
      px(ctx, "#f8f0e0", 11, 23, 10, 7);
      for (const [x, y, r] of [[10, 12, 6], [21, 10, 6], [16, 5, 5], [8, 19, 4], [24, 18, 4]] as [number, number, number][]) {
        disc(ctx, O, x, y, r + 1);
        disc(ctx, "#2e8a4a", x, y, r);
        px(ctx, "#5fb36b", x - 1, y - r + 1, 1, r);
        px(ctx, O, x + 1, y - 1, r - 1, 1);
      }
      return true;
    case "cactus_pot":
      px(ctx, O, 10, 22, 12, 9);
      px(ctx, "#c8602a", 11, 23, 10, 7);
      px(ctx, O, 13, 6, 6, 17);
      px(ctx, "#5aa04a", 14, 7, 4, 16);
      px(ctx, O, 8, 11, 6, 3);
      px(ctx, O, 8, 9, 3, 5);
      px(ctx, "#5aa04a", 9, 10, 1, 3);
      px(ctx, "#5aa04a", 9, 12, 4, 1);
      px(ctx, O, 18, 14, 6, 3);
      px(ctx, O, 21, 11, 3, 5);
      px(ctx, "#5aa04a", 22, 12, 1, 3);
      px(ctx, "#5aa04a", 19, 15, 3, 1);
      disc(ctx, "#ef8bb5", 16, 5, 2);
      return true;
    case "fish_bowl":
      // A round glass bowl on a little stand (the fish swim in it when placed).
      px(ctx, O, 9, 27, 14, 4);
      px(ctx, "#8a5a33", 10, 28, 12, 2);
      disc(ctx, O, 16, 17, 11);
      disc(ctx, "#cfefff", 16, 17, 10);
      oval(ctx, "#5ab8e8", 16, 19, 9, 7);
      px(ctx, "#cfefff", 7, 12, 18, 2);
      px(ctx, "#e8c88a", 10, 24, 12, 2);
      px(ctx, "#ffffff", 9, 13, 2, 4);
      return true;
    case "aquarium":
      // A big glass tank on a wooden cabinet: gravel, weed, a light on top.
      px(ctx, O, 0, 2, 32, 30);
      px(ctx, "#5a3a1a", 1, 24, 30, 7);
      px(ctx, "#7a5a33", 1, 24, 30, 1);
      px(ctx, "#2a2a34", 1, 3, 30, 3);
      px(ctx, "#4aa8d8", 1, 6, 30, 18);
      px(ctx, "#6ac8f0", 1, 6, 30, 3);
      px(ctx, "#d8c08a", 1, 21, 30, 3);
      for (const [x, h] of [[4, 9], [7, 6], [26, 10], [28, 7]] as [number, number][]) px(ctx, "#2e8a4a", x, 21 - h, 2, h);
      px(ctx, "#ffffff", 3, 8, 1, 6);
      return true;
    case "dog_bed":
      oval(ctx, O, 16, 23, 14, 8);
      oval(ctx, "#8a5a33", 16, 23, 13, 7);
      oval(ctx, "#e8d8b8", 16, 24, 9, 4);
      px(ctx, "#a0703f", 4, 20, 24, 2);
      return true;
    case "cat_tree":
      px(ctx, O, 6, 27, 20, 4);
      px(ctx, "#a08060", 7, 28, 18, 2);
      px(ctx, O, 14, 4, 5, 24);
      px(ctx, "#d8c8a0", 15, 5, 3, 22);
      for (let y = 6; y < 26; y += 2) px(ctx, "#b8a070", 15, y, 3, 1);
      px(ctx, O, 6, 12, 14, 4);
      px(ctx, "#a08060", 7, 13, 12, 2);
      px(ctx, O, 13, 2, 14, 4);
      px(ctx, "#a08060", 14, 3, 12, 2);
      disc(ctx, "#ef8bb5", 9, 19, 2);
      px(ctx, "#c8c8dc", 9, 16, 1, 2);
      return true;
    case "pet_bowl":
      oval(ctx, O, 16, 25, 10, 5);
      oval(ctx, "#e8566b", 16, 25, 9, 4);
      oval(ctx, "#a0603a", 16, 23, 7, 2);
      for (const x of [12, 15, 18, 21]) px(ctx, "#c8803a", x, 22, 2, 2);
      return true;
    case "record_player":
      px(ctx, O, 3, 14, 26, 17);
      px(ctx, "#8a5a33", 4, 15, 24, 15);
      px(ctx, "#2a2a34", 5, 16, 22, 8);
      disc(ctx, O, 14, 20, 6);
      disc(ctx, "#1a1a24", 14, 20, 5);
      disc(ctx, "#e8566b", 14, 20, 2);
      px(ctx, "#c8c8dc", 22, 16, 2, 7);
      px(ctx, "#c8c8dc", 19, 22, 4, 1);
      px(ctx, "#f6c343", 6, 26, 3, 2);
      px(ctx, "#f6c343", 23, 26, 3, 2);
      return true;
    case "retro_tv":
      px(ctx, O, 2, 6, 28, 22);
      px(ctx, "#8a5a33", 3, 7, 26, 20);
      px(ctx, O, 5, 9, 17, 15);
      px(ctx, "#3a4a4a", 6, 10, 15, 13);
      disc(ctx, "#c8c8dc", 25, 12, 2);
      disc(ctx, "#c8c8dc", 25, 18, 2);
      px(ctx, O, 7, 28, 3, 3);
      px(ctx, O, 22, 28, 3, 3);
      px(ctx, O, 10, 1, 1, 5);
      px(ctx, O, 21, 1, 1, 5);
      return true;
    case "fireplace":
      px(ctx, O, 1, 4, 30, 27);
      px(ctx, "#b8503a", 2, 5, 28, 25);
      for (let y = 7; y < 30; y += 4) for (let x = 2 + ((y / 4) % 2) * 3; x < 30; x += 6) px(ctx, "#8a3a2a", x, y, 5, 1);
      px(ctx, "#d8c8b0", 1, 4, 30, 3);
      px(ctx, O, 8, 13, 16, 17);
      px(ctx, "#1a1418", 9, 14, 14, 16);
      px(ctx, "#6a4a2a", 10, 26, 12, 3);
      return true;
    case "arcade_cabinet":
      polygon(ctx, O, [[5, 31], [27, 31], [27, 2], [5, 2]]);
      px(ctx, "#3a2a6a", 6, 3, 20, 27);
      px(ctx, "#ff5a8a", 6, 3, 20, 4);
      px(ctx, O, 8, 8, 16, 11);
      px(ctx, "#1a1a2a", 9, 9, 14, 9);
      px(ctx, "#5a4a8a", 6, 20, 20, 4);
      disc(ctx, "#ff5a5a", 11, 22, 1.5);
      disc(ctx, "#5ab8ff", 16, 22, 1.5);
      disc(ctx, "#ffe14f", 21, 22, 1.5);
      return true;
    case "disco_ball":
      px(ctx, O, 15, 0, 2, 6);
      disc(ctx, O, 16, 13, 8);
      disc(ctx, "#b8c0d0", 16, 13, 7);
      for (let y = 7; y < 20; y += 2) for (let x = 9; x < 24; x += 2) if ((x + y) % 4 === 0) px(ctx, "#ffffff", x, y, 1, 1);
      px(ctx, "#ffffff", 12, 9, 2, 2);
      px(ctx, O, 12, 26, 8, 5);
      px(ctx, "#8a8a9a", 13, 27, 6, 3);
      px(ctx, "#8a8a9a", 15, 21, 2, 5);
      return true;
  }
  // The cozy home's things (cozyart.ts).
  return drawCozy(ctx, key);
}

/** A placed piece's live part, drawn over its picture each frame. */
export interface Alive {
  view: Container;
  update(now: number, on: boolean): void;
}

/** A fish swimming in a tank: where it is, which way it goes. */
interface Swimmer {
  s: Sprite;
  x: number;
  y: number;
  vx: number;
  phase: number;
}

/** The live part of piece `key` (null if it has none); its tile's top-left is the sprite's origin (32×32, feet at the bottom). */
export function alive(key: string): Alive | null {
  const g = new Graphics();
  const view = new Container();
  view.addChild(g);
  switch (key) {
    case "fairy_string":
      return {
        view,
        update(now, on) {
          g.clear();
          if (!on) return;
          for (let i = 0; i < 9; i++) {
            const a = i / 8;
            const tw = 0.5 + 0.5 * Math.sin(now / 300 + i * 1.7);
            g.circle(4 + a * 24, 7 + Math.sin(a * Math.PI) * 10, 2.5).fill({ color: [0xff8a8a, 0xffe14f, 0x8fd3ff, 0x9fe07a][i % 4], alpha: 0.35 + 0.5 * tw });
          }
        },
      };
    case "lava_lamp":
      return {
        view,
        update(now, on) {
          g.clear();
          if (!on) return;
          g.circle(16, 14, 9).fill({ color: 0xff6a9a, alpha: 0.12 });
          for (let i = 0; i < 3; i++) {
            const t = ((now / 2600 + i / 3) % 1) * 13;
            const y = 20 - t;
            const w = 1.5 + Math.sin(now / 500 + i) * 0.6;
            g.ellipse(16 + Math.sin(now / 700 + i * 2) * 1, y, w, 1.8).fill({ color: 0xff8ab0 });
          }
        },
      };
    case "paper_lantern":
      return {
        view,
        update(now, on) {
          g.clear();
          if (!on) return;
          const f = 0.85 + 0.15 * Math.sin(now / 180);
          g.circle(16, 9, 13).fill({ color: 0xffd28a, alpha: 0.18 * f });
          g.ellipse(16, 9, 6, 6).fill({ color: 0xffe8b0, alpha: 0.7 * f });
        },
      };
    case "record_player": {
      const notes = new Container();
      view.addChild(notes);
      return {
        view,
        update(now, on) {
          g.clear();
          // The record spinning: a highlight going round; notes rising off it.
          if (!on) return;
          const a = now / 300;
          g.moveTo(14, 20).lineTo(14 + Math.cos(a) * 4, 20 + Math.sin(a) * 4).stroke({ color: 0x8a8a9a, width: 1 });
          for (let i = 0; i < 3; i++) {
            const t = ((now / 1600 + i / 3) % 1);
            const x = 12 + i * 5 + Math.sin(t * 6 + i) * 2;
            const y = 12 - t * 14;
            const alpha = 1 - t;
            g.rect(x, y, 1, 4).fill({ color: 0x2b2233, alpha });
            g.ellipse(x - 1, y + 4, 1.6, 1.2).fill({ color: 0x2b2233, alpha });
          }
        },
      };
    }
    case "retro_tv":
      return {
        view,
        update(now, on) {
          g.clear();
          if (!on) return;
          // A cartoon on: a sky, a hill, a little sun bobbing; the screen's glow and scanlines.
          g.rect(6, 10, 15, 13).fill({ color: 0x7ad8ff });
          g.rect(6, 18, 15, 5).fill({ color: 0x5fb36b });
          g.circle(9 + ((now / 80) % 15), 13 + Math.sin(now / 200) * 1.5, 2).fill({ color: 0xffe14f });
          for (let y = 10; y < 23; y += 2) g.rect(6, y, 15, 1).fill({ color: 0x000000, alpha: 0.12 });
          if (Math.floor(now / 90) % 31 === 0) g.rect(6, 10, 15, 13).fill({ color: 0xffffff, alpha: 0.4 });
          g.rect(2, 6, 28, 22).fill({ color: 0x9fe8ff, alpha: 0.06 });
        },
      };
    case "fireplace":
      return {
        view,
        update(now, on) {
          g.clear();
          if (!on) return;
          // Flames licking up off the logs, sparks, and the glow on the floor.
          g.ellipse(16, 31, 18, 4).fill({ color: 0xff8a3f, alpha: 0.18 + 0.05 * Math.sin(now / 120) });
          for (let i = 0; i < 5; i++) {
            const h = 7 + Math.sin(now / (90 + i * 13) + i) * 3;
            const x = 11 + i * 2.5;
            g.poly([x - 2, 26, x + 2, 26, x + Math.sin(now / 150 + i) * 1.2, 26 - h]).fill({ color: i % 2 ? 0xff6a2a : 0xffb02a });
          }
          g.poly([13, 26, 19, 26, 16 + Math.sin(now / 110), 20]).fill({ color: 0xffe14f });
          const sp = (now / 600) % 1;
          g.rect(14 + Math.sin(now / 200) * 3, 22 - sp * 9, 1, 1).fill({ color: 0xffe14f, alpha: 1 - sp });
        },
      };
    case "arcade_cabinet":
      return {
        view,
        update(now, on) {
          g.clear();
          if (!on) return;
          // The attract screen: a little ship dodging falling blocks, a blinking "PLAY".
          g.rect(9, 9, 14, 9).fill({ color: 0x1a1a2a });
          const t = now / 400;
          for (let i = 0; i < 4; i++) g.rect(10 + ((i * 4 + Math.floor(t)) % 12), 9 + ((t * 3 + i * 2) % 7), 2, 2).fill({ color: [0xff5a8a, 0x5ab8ff, 0xffe14f, 0x9fe07a][i] });
          g.poly([15 + Math.sin(t) * 4, 17, 17 + Math.sin(t) * 4, 17, 16 + Math.sin(t) * 4, 15]).fill({ color: 0xffffff });
          if (Math.floor(now / 500) % 2) g.rect(13, 4, 6, 2).fill({ color: 0xffffff });
          g.rect(5, 2, 22, 28).fill({ color: 0xff5a8a, alpha: 0.05 + 0.03 * Math.sin(now / 300) });
        },
      };
    case "disco_ball":
      return {
        view,
        update(now, on) {
          g.clear();
          if (!on) return;
          // Glints on the ball, and spots of light thrown round the room, turning.
          for (let i = 0; i < 12; i++) {
            const a = now / 1400 + (i / 12) * Math.PI * 2;
            const r = 30 + (i % 3) * 18;
            g.circle(16 + Math.cos(a) * r, 22 + Math.sin(a) * r * 0.5, 2).fill({ color: [0xff8ab0, 0x8fd3ff, 0xffe14f, 0x9fe07a][i % 4], alpha: 0.55 });
          }
          for (let i = 0; i < 4; i++) {
            const a = now / 300 + i * 1.6;
            g.rect(16 + Math.cos(a) * 5, 13 + Math.sin(a) * 4, 1, 1).fill({ color: 0xffffff });
          }
        },
      };
    case "aquarium":
      // The tank: its light (on) and bubbles; the fish are added by \`Tank\`.
      return {
        view,
        update(now, on) {
          g.clear();
          for (let i = 0; i < 3; i++) {
            const t = ((now / 1800 + i / 3) % 1) * 15;
            g.circle(6 + i * 9, 21 - t, 0.8).fill({ color: 0xffffff, alpha: 0.7 });
          }
          if (on) {
            g.rect(1, 6, 30, 18).fill({ color: 0xbfefff, alpha: 0.12 });
            g.rect(1, 3, 30, 3).fill({ color: 0xfff3a8, alpha: 0.5 });
          }
        },
      };
    case "fish_bowl":
      return {
        view,
        update(now) {
          g.clear();
          const t = ((now / 1500) % 1) * 9;
          g.circle(19, 22 - t, 0.8).fill({ color: 0xffffff, alpha: 0.7 });
        },
      };
  }
  // The cozy home's things (cozyart.ts).
  const live = cozyLive(key);
  if (live) {
    return {
      view,
      update(now, on) {
        g.clear();
        live(g, now, on);
      },
    };
  }
  return null;
}

/** The fish swimming round a tank: the catch you've put in it, each its own sprite. */
export class Tank {
  readonly view = new Container();
  private swimmers: Swimmer[] = [];
  private keys: string[] = [];

  constructor(private key: string) {}

  /** Where fish can swim, in the tile's 32×32 (x0, y0, x1, y1). */
  private get water(): [number, number, number, number] {
    return this.key === "aquarium" ? [3, 8, 29, 20] : [9, 14, 23, 23];
  }

  /** The fish in it now (their item keys). */
  set(keys: string[]) {
    if (keys.join() === this.keys.join()) return;
    this.keys = keys;
    for (const s of this.swimmers) s.s.destroy();
    const [x0, y0, x1, y1] = this.water;
    const big = this.key === "aquarium";
    this.swimmers = keys.map((k, i) => {
      const s = new Sprite(itemTexture(k, "fish"));
      s.anchor.set(0.5);
      s.scale.set(big ? 0.3 : 0.24);
      this.view.addChild(s);
      return { s, x: x0 + ((i * 7) % (x1 - x0)), y: y0 + ((i * 5) % (y1 - y0)), vx: (i % 2 ? 1 : -1) * (0.15 + Math.random() * 0.15), phase: Math.random() * 6 };
    });
  }

  update(now: number, dt: number) {
    const [x0, y0, x1, y1] = this.water;
    for (const f of this.swimmers) {
      f.x += f.vx * dt;
      if (f.x < x0 || f.x > x1) {
        f.vx = -f.vx;
        f.x = Math.max(x0, Math.min(x1, f.x));
      }
      // Now and then one turns about for nothing.
      if (Math.random() < 0.004 * dt) f.vx = -f.vx;
      const y = Math.max(y0, Math.min(y1, f.y + Math.sin(now / 900 + f.phase) * 2));
      f.s.position.set(Math.round(f.x), Math.round(y));
      // The drawings face left: flip for the right; a little wiggle.
      const sc = Math.abs(f.s.scale.y);
      f.s.scale.x = f.vx > 0 ? -sc : sc;
      f.s.rotation = Math.sin(now / 200 + f.phase) * 0.08;
    }
  }
}
