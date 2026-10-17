// Procedural art for catalogue items: 16×16 icons for the UI (bag, album,
// market) and 32×32 world sprites for furniture and growing plants. Keyed by
// the item's stable `key` from the catalogue.

import { Texture } from "pixi.js";
import { PALETTE, avatarCanvas, styleFor, toTexture } from "./art";
import { petCanvas, petTexture } from "./pets";
import { vehicleCanvas, vehicleTexture } from "./vehicles";
import { disc, oval, polygon } from "./pixeldraw";

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

const FISH_COLORS: Record<string, [string, string]> = {
  minnow: ["#9fb7c4", "#7f97a4"],
  perch: ["#c9b44a", "#5d7a3a"],
  carp: ["#b8864a", "#8a5d36"],
  bluegill: ["#5d8fc4", "#f2a541"],
  catfish: ["#6b6658", "#4a463c"],
  golden_koi: ["#f6c343", "#f28c28"],
  moonfish: ["#d9d4f2", "#8f86c4"],
};

const FLOWER_COLORS: Record<string, string> = {
  tulip: "#e8566b",
  sunflower: "#f6c343",
  lavender: "#9b7fd4",
  strawberry: "#e23d3d",
};

function plantOf(key: string) {
  return key.replace(/_seeds$/, "");
}

/** Things to wear: their code by item key (set from the catalogue). */
export const COSMETIC_CODES = new Map<string, number>();
const WEARABLE = new Set(["outfit", "hat", "accessory", "skin"]);
/** The look mannequins (and bag icons) show things to wear on. */
const MANNEQUIN_LOOK = 0x0b_00_04_70;

/** Whether an item kind is something to wear. */
export function isWearable(kind: string): boolean {
  return WEARABLE.has(kind);
}

/** The figure wearing item `key`, at 24×34. */
function wearing(key: string, kind: string): HTMLCanvasElement {
  return avatarCanvas(MANNEQUIN_LOOK, 0, styleFor(kind, COSMETIC_CODES.get(key) ?? 0));
}

/** 16×16 icon for any catalogue item. */
function drawIcon(ctx: CanvasRenderingContext2D, key: string, kind: string) {
  if (kind === "vehicle") {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(vehicleCanvas(COSMETIC_CODES.get(key) ?? 3), 0, 0, 32, 24, 0, 2, 16, 12);
    return;
  }
  if (kind === "pet") {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(petCanvas(COSMETIC_CODES.get(key) ?? 1, 2), 0, 0, 24, 18, 0, 2, 16, 12);
    return;
  }
  if (WEARABLE.has(kind)) {
    // Hats show the head; everything else the whole figure.
    ctx.imageSmoothingEnabled = false;
    if (kind === "hat") ctx.drawImage(wearing(key, kind), 2, -6, 20, 20, 0, 0, 16, 16);
    else ctx.drawImage(wearing(key, kind), 0, -2, 24, 36, 2, 0, 11, 16);
    return;
  }
  if (key === "coin") {
    disc(ctx, O, 8, 8, 7);
    disc(ctx, "#f6c343", 8, 8, 6);
    px(ctx, "#fff3c4", 6, 4, 2, 2);
    px(ctx, "#c99a2a", 7, 6, 2, 5);
    return;
  }
  if (kind === "fish") {
    const [body, fin] = FISH_COLORS[key] ?? ["#9fb7c4", "#7f97a4"];
    px(ctx, O, 2, 5, 10, 7);
    px(ctx, body, 3, 6, 8, 5);
    px(ctx, fin, 5, 4, 4, 2);
    px(ctx, O, 12, 6, 3, 5);
    px(ctx, fin, 12, 7, 2, 3);
    px(ctx, "#1b1b1b", 4, 7, 1, 1);
    if (key === "golden_koi") px(ctx, "#fff", 7, 7, 2, 1);
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
    case "armchair":
      px(ctx, O, 5, 6, 22, 24);
      px(ctx, "#6f8fb5", 6, 7, 20, 10);
      px(ctx, "#8aa8cc", 9, 17, 14, 6);
      px(ctx, "#5a7598", 6, 15, 4, 10);
      px(ctx, "#5a7598", 22, 15, 4, 10);
      px(ctx, D, 7, 25, 3, 5);
      px(ctx, D, 22, 25, 3, 5);
      break;
    case "sofa":
      px(ctx, O, 0, 8, 32, 22);
      px(ctx, "#b5544a", 1, 9, 30, 9);
      px(ctx, "#cf6f63", 4, 18, 24, 6);
      px(ctx, "#99443b", 1, 16, 4, 10);
      px(ctx, "#99443b", 27, 16, 4, 10);
      px(ctx, "#f4f1d8", 6, 12, 6, 5);
      px(ctx, D, 2, 26, 3, 4);
      px(ctx, D, 27, 26, 3, 4);
      break;
    case "side_table":
      px(ctx, O, 8, 14, 16, 5);
      px(ctx, W, 9, 15, 14, 3);
      px(ctx, D, 10, 19, 3, 11);
      px(ctx, D, 19, 19, 3, 11);
      px(ctx, "#9fc3d6", 13, 9, 5, 6);
      px(ctx, "#e8566b", 14, 6, 3, 3);
      break;
    case "potted_palm":
      px(ctx, O, 10, 21, 12, 10);
      px(ctx, "#d9a05b", 11, 22, 10, 8);
      px(ctx, PALETTE.trunk, 15, 10, 2, 12);
      for (const [x, y, w] of [[4, 6, 12], [16, 6, 12], [6, 2, 9], [17, 2, 9], [12, 0, 8]] as [number, number, number][]) px(ctx, PALETTE.leaf, x, y, w, 4);
      px(ctx, PALETTE.leafLight, 8, 7, 6, 2);
      break;
    case "wall_clock":
      disc(ctx, O, 16, 13, 11);
      disc(ctx, "#f4f1d8", 16, 13, 9);
      px(ctx, O, 15, 6, 2, 8);
      px(ctx, O, 16, 12, 6, 2);
      px(ctx, D, 15, 24, 2, 7);
      px(ctx, "#f6c343", 14, 27, 4, 4);
      break;
    case "flower_box":
      px(ctx, O, 3, 19, 26, 11);
      px(ctx, W, 4, 20, 24, 9);
      px(ctx, D, 4, 20, 24, 2);
      for (let i = 0; i < 6; i++) {
        px(ctx, PALETTE.leaf, 5 + i * 4, 12, 2, 8);
        px(ctx, ["#e8566b", "#f6c343", "#9b7fd4"][i % 3], 4 + i * 4, 9, 4, 4);
      }
      break;
    case "garden_gnome":
      px(ctx, O, 10, 3, 12, 28);
      polygon(ctx, "#c8553d", [[11, 14], [16, 2], [21, 14]]);
      px(ctx, "#f5d0b0", 12, 14, 8, 5);
      px(ctx, "#fff9ec", 12, 18, 8, 5);
      px(ctx, "#5f8fc4", 11, 22, 10, 7);
      px(ctx, "#3b3a2e", 11, 28, 4, 2);
      px(ctx, "#3b3a2e", 17, 28, 4, 2);
      break;
    case "birdbath":
      oval(ctx, O, 16, 10, 13, 5);
      oval(ctx, "#c9c2b0", 16, 10, 12, 4);
      oval(ctx, "#7fc3e8", 16, 9, 9, 2.5);
      px(ctx, O, 13, 13, 6, 15);
      px(ctx, "#c9c2b0", 14, 13, 4, 15);
      px(ctx, O, 9, 27, 14, 4);
      px(ctx, "#b2aa96", 10, 28, 12, 2);
      px(ctx, "#8f6a4a", 20, 4, 4, 3);
      break;
    case "rocking_chair":
      px(ctx, O, 9, 3, 14, 22);
      px(ctx, W, 10, 4, 12, 12);
      px(ctx, D, 10, 16, 12, 4);
      px(ctx, W, 11, 20, 2, 6);
      px(ctx, W, 19, 20, 2, 6);
      oval(ctx, O, 16, 28, 12, 2.5);
      oval(ctx, D, 16, 28, 11, 1.5);
      break;
    case "grandfather_clock":
      px(ctx, O, 9, -4, 14, 35);
      px(ctx, D, 10, -3, 12, 33);
      disc(ctx, O, 16, 4, 5);
      disc(ctx, "#f4f1d8", 16, 4, 4);
      px(ctx, O, 16, 1, 1, 4);
      px(ctx, O, 16, 4, 3, 1);
      px(ctx, "#2d2a24", 12, 11, 8, 15);
      px(ctx, "#f6c343", 15, 14, 2, 9);
      disc(ctx, "#f6c343", 16, 23, 2);
      break;
    case "pumpkin_lantern":
      oval(ctx, O, 16, 21, 12, 9);
      oval(ctx, "#e07a2f", 16, 21, 11, 8);
      px(ctx, "#c8602a", 11, 14, 2, 15);
      px(ctx, "#c8602a", 19, 14, 2, 15);
      px(ctx, "#5d8a4e", 15, 9, 3, 5);
      polygon(ctx, "#ffe39a", [[10, 18], [13, 16], [14, 19]]);
      polygon(ctx, "#ffe39a", [[22, 18], [19, 16], [18, 19]]);
      px(ctx, "#ffe39a", 11, 23, 10, 3);
      break;
    case "harvest_basket":
      px(ctx, O, 6, 16, 20, 14);
      px(ctx, "#c99a6a", 7, 17, 18, 12);
      for (let i = 0; i < 4; i++) px(ctx, "#a0703f", 7, 19 + i * 3, 18, 1);
      disc(ctx, "#e8566b", 11, 15, 3);
      disc(ctx, "#f6c343", 17, 14, 3);
      disc(ctx, "#e07a2f", 22, 15, 3);
      px(ctx, O, 8, 6, 2, 11);
      px(ctx, O, 22, 6, 2, 11);
      px(ctx, O, 8, 5, 16, 2);
      break;
    case "scarecrow":
      px(ctx, PALETTE.trunk, 15, 8, 3, 23);
      px(ctx, PALETTE.trunk, 5, 13, 22, 3);
      px(ctx, O, 9, 12, 14, 12);
      px(ctx, "#5f8fc4", 10, 13, 12, 10);
      px(ctx, "#f6c343", 6, 15, 3, 3);
      px(ctx, "#f6c343", 23, 15, 3, 3);
      disc(ctx, O, 16, 7, 5);
      disc(ctx, "#ead9a6", 16, 7, 4);
      px(ctx, O, 9, 1, 14, 3);
      px(ctx, "#a0703f", 11, -2, 10, 4);
      break;
    case "string_lights":
      for (let i = 0; i < 5; i++) {
        const y = 10 + Math.round(Math.sin(i * 0.9) * 3);
        px(ctx, O, 3 + i * 6, y - 2, 1, 3);
        disc(ctx, ["#f6c343", "#e8566b", "#9fc3d6", "#a5d27a", "#f6c343"][i], 4 + i * 6, y + 2, 2);
      }
      px(ctx, O, 2, 6, 28, 1);
      px(ctx, PALETTE.woodDark, 2, 6, 2, 25);
      px(ctx, PALETTE.woodDark, 28, 6, 2, 25);
      break;
    case "snow_globe":
      disc(ctx, O, 16, 15, 10);
      disc(ctx, "#cfe8f5", 16, 15, 9);
      px(ctx, "#5d8a4e", 13, 14, 6, 6);
      polygon(ctx, "#4f8040", [[11, 16], [16, 7], [21, 16]]);
      for (const [x, y] of [[10, 10], [20, 12], [14, 8], [22, 17], [9, 17]] as [number, number][]) px(ctx, "#fff", x, y, 1, 1);
      px(ctx, O, 8, 23, 16, 7);
      px(ctx, "#a0703f", 9, 24, 14, 5);
      break;
    case "blossom_pot":
      px(ctx, O, 10, 21, 12, 10);
      px(ctx, "#c8693e", 11, 22, 10, 8);
      px(ctx, PALETTE.trunk, 15, 10, 2, 12);
      for (const [x, y] of [[9, 6], [17, 4], [12, 2], [20, 9], [7, 11], [14, 8]] as [number, number][]) disc(ctx, "#f4b6c8", x, y, 3);
      for (const [x, y] of [[10, 6], [18, 4], [13, 2]] as [number, number][]) px(ctx, "#fff", x, y, 1, 1);
      break;
    case "birdhouse":
      px(ctx, PALETTE.trunk, 15, 18, 3, 13);
      px(ctx, O, 9, 7, 14, 13);
      px(ctx, "#e6b450", 10, 8, 12, 11);
      polygon(ctx, "#b5544a", [[7, 9], [16, 1], [25, 9]]);
      disc(ctx, "#3b3a2e", 16, 13, 2);
      px(ctx, O, 15, 16, 3, 1);
      break;
    case "picnic_set":
      px(ctx, "#e8566b", 2, 14, 28, 14);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) px(ctx, "#fff9ec", 2 + i * 7 + (j % 2) * 3, 14 + j * 7, 4, 4);
      px(ctx, O, 9, 8, 14, 9);
      px(ctx, "#c99a6a", 10, 9, 12, 7);
      px(ctx, O, 12, 5, 8, 2);
      disc(ctx, "#e8566b", 24, 11, 2);
      break;
    case "beach_umbrella":
      px(ctx, O, 15, 8, 2, 23);
      polygon(ctx, O, [[2, 11], [16, 0], [30, 11]]);
      for (let i = 0; i < 4; i++) {
        polygon(ctx, i % 2 ? "#fff9ec" : "#3f7a8a", [[3 + i * 6.5, 10], [16, 1], [9.5 + i * 6.5, 10]]);
      }
      oval(ctx, "rgba(0,0,0,0.15)", 16, 30, 12, 2);
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
    url = canvas(16, 16, (ctx) => drawIcon(ctx, key, kind)).toDataURL();
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

/** Any item drawn at 32×32 (furniture as itself, anything else as its icon). */
export function itemTexture(key: string, kind: string): Texture {
  if (kind === "furniture") return furnitureTexture(key);
  if (WEARABLE.has(kind)) return cachedTex(`wear:${key}`, () => wearing(key, kind));
  if (kind === "pet") return petTexture(COSMETIC_CODES.get(key) ?? 1, 2);
  if (kind === "vehicle") return vehicleTexture(COSMETIC_CODES.get(key) ?? 3);
  return cachedTex(`item:${key}`, () =>
    canvas(32, 32, (ctx) => {
      ctx.scale(2, 2);
      drawIcon(ctx, key, kind);
    }),
  );
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
