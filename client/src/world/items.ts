// Procedural art for catalogue items: 16×16 icons for the UI (bag, album,
// market) and 32×32 world sprites for furniture and growing plants. Keyed by
// the item's stable `key` from the catalogue.

import { Texture } from "pixi.js";
import { PALETTE, toTexture } from "./art";
import { drawFish } from "./fish";
import { disc, oval } from "./pixeldraw";

type Draw = (ctx: CanvasRenderingContext2D) => void;

function canvas(w: number, h: number, draw: Draw): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  return c;
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

const O = PALETTE.outline;

const FLOWER_COLORS: Record<string, string> = {
  tulip: "#e8566b",
  sunflower: "#f6c343",
  lavender: "#9b7fd4",
  strawberry: "#e23d3d",
};

function plantOf(key: string) {
  return key.replace(/_seeds$/, "");
}

/** 16×16 icon for any catalogue item. */
function drawIcon(ctx: CanvasRenderingContext2D, key: string, kind: string) {
  if (key === "lucky_crate") {
    // A golden "?" block: dark rim, a bright top and right edge, rivets in
    // the corners, and a shaded question mark (its dot the bottom rivet).
    const rim = "#2b1d0c";
    const dark = "#765b00";
    const shade = "#c9a524";
    px(ctx, rim, 1, 0, 14, 16);
    px(ctx, rim, 0, 1, 16, 14);
    px(ctx, "#ffcf0a", 1, 1, 14, 14);
    px(ctx, "#fff06a", 1, 1, 14, 1);
    px(ctx, "#fff06a", 14, 1, 1, 14);
    for (const [x, y] of [[2, 2], [12, 2], [2, 13], [12, 13], [7, 13]]) {
      px(ctx, dark, x, y, 1, 1);
      px(ctx, shade, x + 1, y, 1, 1);
    }
    // The question mark.
    px(ctx, dark, 5, 3, 5, 1);
    px(ctx, dark, 4, 4, 2, 3);
    px(ctx, dark, 9, 4, 2, 3);
    px(ctx, dark, 8, 7, 2, 1);
    px(ctx, dark, 7, 8, 2, 4);
    px(ctx, shade, 10, 3, 1, 1);
    px(ctx, shade, 6, 4, 1, 1);
    px(ctx, shade, 11, 4, 1, 3);
    px(ctx, shade, 10, 7, 1, 1);
    px(ctx, shade, 9, 8, 1, 4);
    return;
  }
  if (key === "arcade_ticket") {
    // A pink ticket with a notch and a star.
    px(ctx, O, 1, 4, 14, 9);
    px(ctx, "#ff4fa3", 2, 5, 12, 7);
    px(ctx, O, 1, 7, 2, 3);
    px(ctx, O, 13, 7, 2, 3);
    px(ctx, "#ffe14f", 7, 6, 2, 5);
    px(ctx, "#ffe14f", 6, 8, 4, 1);
    return;
  }
  if (key === "coin") {
    disc(ctx, O, 8, 8, 7);
    disc(ctx, "#f6c343", 8, 8, 6);
    px(ctx, "#fff3c4", 6, 4, 2, 2);
    px(ctx, "#c99a2a", 7, 6, 2, 5);
    return;
  }
  if (key === "pro_rod") {
    // A golden rod, bent, with its reel and a line to a red bobber.
    for (let i = 0; i < 11; i++) px(ctx, i < 3 ? "#5a3a1a" : "#f6c343", 2 + i, 13 - i, 2, 2);
    px(ctx, O, 3, 9, 4, 4);
    px(ctx, "#c8c8dc", 4, 10, 2, 2);
    px(ctx, "#e8e8f0", 14, 3, 1, 8);
    px(ctx, O, 13, 11, 3, 3);
    px(ctx, "#e8566b", 14, 12, 1, 1);
    return;
  }
  if (key === "fish_lure") {
    // A shiny spoon lure: a gold teardrop with a blue eye, a hook and a sparkle.
    px(ctx, O, 5, 2, 6, 10);
    px(ctx, O, 4, 4, 8, 6);
    px(ctx, "#f6c343", 5, 4, 6, 6);
    px(ctx, "#f6c343", 6, 3, 4, 8);
    px(ctx, "#fff3c4", 6, 4, 2, 3);
    px(ctx, "#4fa8ff", 8, 7, 2, 2);
    px(ctx, "#c8c8dc", 7, 0, 2, 2);
    px(ctx, "#c8c8dc", 8, 12, 1, 3);
    px(ctx, "#c8c8dc", 9, 14, 2, 1);
    px(ctx, "#c8c8dc", 11, 12, 1, 2);
    px(ctx, "#ffffff", 13, 2, 1, 3);
    px(ctx, "#ffffff", 12, 3, 3, 1);
    return;
  }
  if (key === "treasure_chest") {
    // A little chest, banded in gold, a coin peeking out of the lid.
    px(ctx, O, 1, 5, 14, 10);
    px(ctx, "#8a5a2a", 2, 6, 12, 8);
    px(ctx, "#a8743a", 2, 6, 12, 3);
    px(ctx, O, 1, 8, 14, 1);
    px(ctx, "#f6c343", 2, 9, 12, 1);
    px(ctx, "#f6c343", 7, 8, 2, 4);
    px(ctx, O, 7, 11, 2, 1);
    px(ctx, "#f6c343", 4, 4, 3, 2);
    px(ctx, "#fff3c4", 5, 4, 1, 1);
    return;
  }
  if (key === "old_boot") {
    px(ctx, O, 4, 2, 6, 10);
    px(ctx, "#7a5532", 5, 3, 4, 8);
    px(ctx, O, 4, 10, 10, 4);
    px(ctx, "#7a5532", 5, 11, 8, 2);
    px(ctx, "#5ea9c8", 11, 3, 2, 2);
    return;
  }
  if (kind === "seed") {
    const c = FLOWER_COLORS[plantOf(key)] ?? "#8bc34a";
    px(ctx, O, 3, 2, 10, 13);
    px(ctx, "#efe3c8", 4, 3, 8, 11);
    px(ctx, c, 6, 5, 4, 4);
    px(ctx, "#5f9a48", 7, 9, 2, 4);
    return;
  }
  if (kind === "plant") {
    const c = FLOWER_COLORS[key] ?? "#e8566b";
    px(ctx, "#5f9a48", 7, 7, 2, 8);
    px(ctx, "#5f9a48", 4, 10, 3, 2);
    px(ctx, "#5f9a48", 9, 9, 3, 2);
    if (key === "strawberry") {
      for (const [x, y] of [[3, 4], [9, 3], [6, 7]]) {
        px(ctx, O, x, y, 5, 5);
        px(ctx, c, x + 1, y + 1, 3, 3);
        px(ctx, "#fff3c4", x + 2, y + 2, 1, 1);
      }
    } else if (key === "lavender") {
      for (let i = 0; i < 4; i++) px(ctx, c, 6 + (i % 2), 1 + i * 2, 3, 2);
    } else if (key === "sunflower") {
      px(ctx, c, 3, 1, 10, 8);
      px(ctx, "#7a5532", 6, 3, 4, 4);
    } else {
      px(ctx, O, 4, 1, 8, 7);
      px(ctx, c, 5, 2, 6, 5);
      px(ctx, c, 4, 1, 2, 2);
      px(ctx, c, 10, 1, 2, 2);
    }
    return;
  }
  if (kind === "furniture") {
    const ctx16 = ctx;
    ctx16.save();
    ctx16.scale(0.5, 0.5);
    drawFurniture(ctx16, key);
    ctx16.restore();
    return;
  }
  px(ctx, O, 3, 3, 10, 10);
  px(ctx, "#ccc", 4, 4, 8, 8);
}

/** 32×32 furniture, drawn to sit on its tile. */
function drawFurniture(ctx: CanvasRenderingContext2D, key: string) {
  const W = PALETTE.wood;
  const D = PALETTE.woodDark;
  switch (key) {
    case "wooden_chair":
      px(ctx, O, 9, 4, 14, 26);
      px(ctx, W, 10, 5, 12, 12);
      px(ctx, D, 10, 17, 12, 4);
      px(ctx, W, 10, 21, 3, 8);
      px(ctx, W, 19, 21, 3, 8);
      break;
    case "small_table":
      px(ctx, O, 3, 10, 26, 8);
      px(ctx, W, 4, 11, 24, 5);
      px(ctx, D, 6, 18, 3, 11);
      px(ctx, D, 23, 18, 3, 11);
      px(ctx, "#f4f1d8", 12, 8, 8, 3);
      break;
    case "floor_lamp":
      px(ctx, O, 15, 8, 3, 22);
      px(ctx, O, 10, 28, 13, 3);
      px(ctx, O, 8, 1, 17, 9);
      px(ctx, "#ffe39a", 9, 2, 15, 7);
      break;
    case "potted_fern":
      px(ctx, O, 9, 20, 14, 11);
      px(ctx, "#c8693e", 10, 21, 12, 9);
      for (let i = 0; i < 6; i++) px(ctx, i % 2 ? PALETTE.leaf : PALETTE.leafLight, 6 + i * 3, 6 + (i % 3) * 3, 3, 15 - (i % 3) * 3);
      break;
    case "round_rug":
      oval(ctx, "#b5544a", 16, 22, 15, 8);
      oval(ctx, "#e6b450", 16, 22, 9, 4.5);
      break;
    case "bookshelf":
      px(ctx, O, 3, 0, 26, 31);
      px(ctx, D, 4, 1, 24, 29);
      for (let r = 0; r < 3; r++) {
        px(ctx, W, 4, 9 + r * 9, 24, 2);
        for (let b = 0; b < 6; b++) px(ctx, ["#b5544a", "#5d8a4e", "#3f6fa0", "#e6b450"][(b + r) % 4], 6 + b * 3.6, 2 + r * 9, 3, 7);
      }
      break;
    case "founders_lantern":
      // A lantern on a post with a leaf on its cap: every founder's keepsake.
      px(ctx, O, 14, 12, 4, 18);
      px(ctx, PALETTE.woodDark, 15, 13, 2, 16);
      px(ctx, O, 9, 29, 14, 3);
      px(ctx, O, 9, 2, 14, 13);
      px(ctx, "#ffe39a", 10, 4, 12, 9);
      px(ctx, "#fff5c8", 13, 6, 6, 5);
      px(ctx, O, 8, 1, 16, 2);
      px(ctx, "#5d8a4e", 14, -1, 4, 2);
      px(ctx, "#8fca6b", 17, -2, 3, 2);
      break;
    case "cozy_bed":
      px(ctx, O, 1, 4, 30, 27);
      px(ctx, D, 2, 5, 28, 25);
      px(ctx, "#f4f1d8", 4, 6, 24, 7);
      px(ctx, "#7fa7d4", 4, 13, 24, 15);
      px(ctx, "#a9c4e4", 4, 13, 24, 3);
      break;
    default:
      px(ctx, O, 6, 6, 20, 20);
      px(ctx, W, 7, 7, 18, 18);
  }
}

const iconCache = new Map<string, string>();

/** Data URL of the 16×16 icon, for <img> tags. */
export function itemIconUrl(key: string, kind: string): string {
  let url = iconCache.get(key);
  if (!url) {
    url = iconCanvas(key, kind).toDataURL();
    iconCache.set(key, url);
  }
  return url;
}

const texCache = new Map<string, Texture>();

function cachedTex(key: string, draw: () => HTMLCanvasElement): Texture {
  let t = texCache.get(key);
  if (!t) {
    t = toTexture(draw());
    texCache.set(key, t);
  }
  return t;
}

/** An item's icon canvas: fish at 32×32 (they have the detail), the rest 16×16. */
function iconCanvas(key: string, kind: string): HTMLCanvasElement {
  if (kind === "fish") return canvas(32, 32, (ctx) => drawFish(ctx, key));
  return canvas(16, 16, (ctx) => drawIcon(ctx, key, kind));
}

/** An item's icon as a texture (the fish you just caught, held up). */
export function itemTexture(key: string, kind: string): Texture {
  return cachedTex(`icon:${key}`, () => iconCanvas(key, kind));
}

export function furnitureTexture(key: string): Texture {
  return cachedTex(`furn:${key}`, () => canvas(32, 32, (ctx) => drawFurniture(ctx, key)));
}

/** A plant growing in a plot: stage 0 seed mound … 3 in bloom. */
export function plantTexture(plantKey: string, stage: number): Texture {
  return cachedTex(`plant:${plantKey}:${stage}`, () =>
    canvas(32, 32, (ctx) => {
      const leaf = PALETTE.leaf;
      if (stage === 0) {
        px(ctx, "#6d5038", 11, 22, 10, 4);
        px(ctx, "#a7865f", 14, 21, 2, 1);
        return;
      }
      if (stage === 1) {
        px(ctx, leaf, 15, 18, 2, 8);
        px(ctx, PALETTE.leafLight, 11, 17, 4, 3);
        px(ctx, PALETTE.leafLight, 17, 15, 4, 3);
        return;
      }
      px(ctx, leaf, 15, 10, 2, 17);
      px(ctx, leaf, 10, 18, 5, 3);
      px(ctx, leaf, 17, 15, 5, 3);
      if (stage === 2) {
        px(ctx, PALETTE.leafLight, 13, 7, 6, 5);
        return;
      }
      const c = FLOWER_COLORS[plantKey] ?? "#e8566b";
      if (plantKey === "strawberry") {
        for (const [x, y] of [[8, 13], [19, 11], [13, 20]]) {
          px(ctx, O, x, y, 6, 6);
          px(ctx, c, x + 1, y + 1, 4, 4);
        }
      } else if (plantKey === "sunflower") {
        px(ctx, c, 9, 1, 14, 12);
        px(ctx, "#7a5532", 13, 4, 6, 6);
      } else if (plantKey === "lavender") {
        for (let i = 0; i < 5; i++) px(ctx, c, 13 + (i % 2) * 2, 2 + i * 3, 4, 3);
      } else {
        px(ctx, O, 10, 2, 12, 10);
        px(ctx, c, 11, 3, 10, 8);
        px(ctx, c, 10, 1, 3, 3);
        px(ctx, c, 19, 1, 3, 3);
      }
    }),
  );
}

export function wetSoilTexture(): Texture {
  return cachedTex("wet", () => canvas(32, 32, (ctx) => px(ctx, "rgba(40,25,15,0.35)", 1, 1, 30, 30)));
}

export function bobberTexture(): Texture {
  return cachedTex("bobber", () =>
    canvas(8, 10, (ctx) => {
      px(ctx, O, 1, 1, 6, 8);
      px(ctx, "#e8566b", 2, 2, 4, 3);
      px(ctx, "#fff", 2, 5, 4, 3);
      px(ctx, "rgba(255,255,255,0.6)", 0, 8, 8, 2);
    }),
  );
}

export function giftBoxTexture(): Texture {
  return cachedTex("giftbox", () =>
    canvas(24, 24, (ctx) => {
      px(ctx, "rgba(0,0,0,0.18)", 3, 21, 18, 3);
      px(ctx, O, 2, 8, 20, 14);
      px(ctx, "#e8566b", 3, 9, 18, 12);
      px(ctx, "#f6c343", 10, 9, 4, 12);
      px(ctx, O, 1, 5, 22, 5);
      px(ctx, "#f28c9b", 2, 6, 20, 3);
      px(ctx, "#f6c343", 10, 6, 4, 3);
      px(ctx, "#f6c343", 6, 1, 5, 5);
      px(ctx, "#f6c343", 13, 1, 5, 5);
    }),
  );
}
