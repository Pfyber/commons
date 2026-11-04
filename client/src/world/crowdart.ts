// The arena's crowd: Romans, drawn the size of anyone in town (24×34, the
// feet at the bottom, as the avatars are), in the clothes of their day:
// citizens in white togas edged with a coloured band, senators with the
// broad purple stripe and a laurel wreath, women in a stola with a palla
// drawn over the head, off-duty legionaries in red with a crested bronze
// helmet, folk in hooded cloaks, and plain tunics in earthy dyes, belted.
// Seated, or up on their feet cheering, arms in the air.

import type { Texture } from "pixi.js";
import { toTexture } from "./art";

const O = "#2b2233";
const SKINS = ["#f2c8a0", "#e0b088", "#c08a5c", "#8a5a38"];
const HAIRS = ["#2b1d14", "#4a2e1a", "#6b4426", "#1a1210", "#8a8a8a", "#b08848"];
const TUNICS = ["#a8743a", "#8a5a2e", "#6e7a3a", "#9c4a2e", "#7a6a5a", "#b89a5a", "#5a6a7a", "#8a3a2e"];
const BANDS = ["#8f2b26", "#6a2a8a", "#2f5a8a", "#a87a22"];
const STOLAS = ["#c98a7a", "#7a9ab0", "#c9b07a", "#9a7ab0", "#a8b88a", "#d8c8b0"];
const CLOAKS = ["#6b4a2e", "#5a4a3a", "#7a5a3a", "#4a4a3a"];

/** Who: what they wear (0 toga, 1 senator, 2 stola, 3 legionary, 4 cloak, 5 tunic) and their colours. */
export interface Roman {
  kind: number;
  skin: string;
  hair: string;
  cloth: string;
  band: string;
  beard: boolean;
}

/** A Roman from a number (the same number, the same Roman). */
export function roman(n: number): Roman {
  const r = (k: number) => {
    const v = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const pick = <T>(a: T[], k: number) => a[Math.floor(r(k) * a.length)];
  const kindRoll = r(1);
  const kind = kindRoll < 0.26 ? 0 : kindRoll < 0.34 ? 1 : kindRoll < 0.56 ? 2 : kindRoll < 0.66 ? 3 : kindRoll < 0.76 ? 4 : 5;
  const cloth = kind === 2 ? pick(STOLAS, 2) : kind === 4 ? pick(CLOAKS, 2) : kind === 3 ? "#a8322a" : kind <= 1 ? "#ece4d0" : pick(TUNICS, 2);
  return { kind, skin: pick(SKINS, 3), hair: pick(HAIRS, 4), cloth, band: kind === 1 ? "#6a2a8a" : pick(BANDS, 5), beard: kind !== 2 && r(6) < 0.35 };
}

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function shadeHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + k));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const cache = new Map<string, Texture>();

/** A Roman, seated (pose 0) or on their feet cheering (1). */
export function spectatorTexture(n: number, pose: 0 | 1): Texture {
  const key = `${n}:${pose}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = roman(n);
  const c = document.createElement("canvas");
  c.width = 24;
  c.height = 34;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const dark = shadeHex(p.cloth, -38);
  const long = p.kind === 2; // a stola reaches the feet
  // The shadow, the legs and sandals (sat: knees forward, the body lower).
  px(ctx, "rgba(0,0,0,0.2)", 5, 31, 14, 3);
  if (pose === 0) {
    px(ctx, O, 6, 27, 12, 5);
    px(ctx, long ? p.cloth : p.skin, 7, 28, 10, 3);
    px(ctx, "#7a4f2a", 6, 31, 3, 2);
    px(ctx, "#7a4f2a", 15, 31, 3, 2);
    ctx.translate(0, 4);
  } else if (!long) {
    for (const x of [8, 13]) {
      px(ctx, O, x, 25, 4, 7);
      px(ctx, p.skin, x + 1, 25, 2, 6);
      px(ctx, "#7a4f2a", x, 30, 4, 2);
    }
  }
  // The body: a tunic (or the stola, down to the feet).
  const bottom = long && pose === 1 ? 32 : 27;
  px(ctx, O, 5, 15, 14, bottom - 15);
  px(ctx, p.cloth, 6, 16, 12, bottom - 17);
  px(ctx, dark, 6, bottom - 4, 12, 2);
  if (p.kind === 0 || p.kind === 1) {
    // The toga: wrapped over the left shoulder, a fold across the chest, its edge banded.
    for (let k = 0; k < 9; k++) px(ctx, "#cfc4ac", 6 + k, 16 + k, 2, 1);
    for (let k = 0; k < 9; k++) px(ctx, p.band, 7 + k, 17 + k, 1, 1);
    px(ctx, "#cfc4ac", 6, 16, 4, 9);
    if (p.kind === 1) px(ctx, p.band, 11, 16, 2, 10); // the senator's broad stripe
  } else if (p.kind === 5 || p.kind === 3) {
    // A belt.
    px(ctx, p.kind === 3 ? "#5a3a1a" : "#4a3020", 6, 21, 12, 2);
    if (p.kind === 3) px(ctx, "#c99a2a", 11, 21, 2, 2);
  } else if (p.kind === 2) {
    // The stola's girdle, high under the chest.
    px(ctx, dark, 6, 19, 12, 1);
  }
  // The arms: down at the sides, or up in the air.
  const arm = p.kind === 4 || p.kind === 2 ? p.cloth : p.skin;
  for (const [x, dir] of [
    [3, -1],
    [19, 1],
  ] as [number, number][]) {
    if (pose === 1) {
      px(ctx, O, x - 1, 5, 4, 12);
      px(ctx, arm, x, 6, 2, 10);
      px(ctx, p.skin, x, 5, 2, 2);
    } else {
      px(ctx, O, x - (dir < 0 ? 0 : 1), 16, 3, 9);
      px(ctx, arm, x + (dir < 0 ? 1 : 0), 17, 2, 7);
      px(ctx, p.skin, x + (dir < 0 ? 1 : 0), 23, 2, 1);
    }
  }
  // The head.
  px(ctx, O, 6, 2, 12, 14);
  px(ctx, p.skin, 7, 3, 10, 12);
  px(ctx, O, 9, 8, 1, 2);
  px(ctx, O, 14, 8, 1, 2);
  px(ctx, shadeHex(p.skin, -40), 11, 11, 2, 1);
  if (p.beard) {
    px(ctx, p.hair, 7, 11, 10, 4);
    px(ctx, p.skin, 9, 11, 6, 2);
  }
  switch (p.kind) {
    case 2: // the palla, drawn up over the hair
    case 4: // the hood
      px(ctx, O, 5, 1, 14, 6);
      px(ctx, p.kind === 2 ? shadeHex(p.cloth, 18) : p.cloth, 6, 2, 12, 4);
      px(ctx, O, 5, 6, 2, 9);
      px(ctx, O, 17, 6, 2, 9);
      px(ctx, p.kind === 2 ? shadeHex(p.cloth, 18) : p.cloth, 6, 6, 1, 8);
      px(ctx, p.kind === 2 ? shadeHex(p.cloth, 18) : p.cloth, 17, 6, 1, 8);
      break;
    case 3: // a bronze helmet, a red crest
      px(ctx, O, 5, 1, 14, 7);
      px(ctx, "#c99a2a", 6, 2, 12, 5);
      px(ctx, "#e8c25a", 7, 2, 8, 1);
      px(ctx, O, 8, -1, 8, 3);
      px(ctx, "#b8322c", 9, 0, 6, 2);
      px(ctx, "#c99a2a", 6, 7, 2, 5);
      px(ctx, "#c99a2a", 16, 7, 2, 5);
      break;
    default:
      // Short Roman hair, combed forward.
      px(ctx, p.hair, 7, 3, 10, 3);
      px(ctx, p.hair, 7, 6, 2, 2);
      px(ctx, p.hair, 15, 6, 2, 2);
      if (p.kind === 1) {
        // The laurel wreath.
        for (let x = 6; x < 18; x += 2) px(ctx, "#5f8f4e", x, 4, 2, 1);
        px(ctx, "#7aae5a", 7, 3, 1, 1);
        px(ctx, "#7aae5a", 16, 3, 1, 1);
      }
  }
  const t = toTexture(c);
  cache.set(key, t);
  return t;
}
