// Fireplaces you buy and set against a wall: red brick, grey stone, and
// black obsidian (its fire burns green). Each drawn from the front, the
// back and the side (32×32, feet at the bottom), and its fire alive while
// it's lit: tongues of flame licking up off the logs, the coals breathing,
// sparks rising, and its light flickering on the hearth.

import type { Graphics } from "pixi.js";

const O = "#2b2233";

type Ctx = CanvasRenderingContext2D;

interface Fireplace {
  /** The bricks, their mortar, a lighter brick here and there, and the mantel (its top, its edge). */
  brick: string;
  mortar: string;
  fleck: string;
  mantel: string;
  mantelEdge: string;
  /** The fire: its outer flame, its middle, its white-hot core; the glow it throws (pixi colours). */
  flame: [number, number, number];
  glow: number;
}

export const FIREPLACES: Record<string, Fireplace> = {
  fireplace: { brick: "#b8503a", mortar: "#8a3a2a", fleck: "#cc6a4e", mantel: "#d8c8b0", mantelEdge: "#a8987e", flame: [0xff5a1f, 0xffa02a, 0xffe98a], glow: 0xff9a4a },
  fireplace_grey: { brick: "#8d9099", mortar: "#5f626b", fleck: "#a9acb4", mantel: "#d6d2c8", mantelEdge: "#a39f96", flame: [0xff5a1f, 0xffa02a, 0xffe98a], glow: 0xff9a4a },
  fireplace_obsidian: { brick: "#211c2e", mortar: "#0d0a15", fleck: "#4b3d74", mantel: "#352c4c", mantelEdge: "#6c5aa6", flame: [0x14a04a, 0x4aff7a, 0xd8ffd0], glow: 0x4aff7a },
};

function px(ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Bricks over a rectangle: staggered courses, mortar between, a few lighter. */
function bricks(ctx: Ctx, f: Fireplace, x0: number, y0: number, w: number, h: number) {
  px(ctx, f.brick, x0, y0, w, h);
  for (let y = y0; y < y0 + h; y++) {
    const course = Math.floor((y - y0) / 3);
    if ((y - y0) % 3 === 2) {
      px(ctx, f.mortar, x0, y, w, 1);
      continue;
    }
    for (let x = x0 + (course % 2) * 3; x < x0 + w; x += 6) {
      px(ctx, f.mortar, x, y, 1, 1);
      if ((x * 7 + course * 5) % 11 === 0) px(ctx, f.fleck, x + 1, y, Math.min(4, x0 + w - x - 1), 1);
    }
  }
}

/** A fireplace from the front: the chimney breast, the mantel, the arched firebox, the logs and the hearth. */
function front(ctx: Ctx, f: Fireplace) {
  px(ctx, O, 1, 4, 30, 27);
  bricks(ctx, f, 2, 5, 28, 25);
  // The mantel shelf, a little proud of the bricks.
  px(ctx, O, 0, 2, 32, 5);
  px(ctx, f.mantel, 1, 3, 30, 2);
  px(ctx, f.mantelEdge, 1, 5, 30, 1);
  // The firebox: an arch, soot-black inside, darker up its throat.
  px(ctx, O, 7, 11, 18, 19);
  px(ctx, O, 9, 10, 14, 1);
  px(ctx, "#1a1014", 8, 12, 16, 17);
  px(ctx, "#1a1014", 10, 11, 12, 1);
  px(ctx, "#24161a", 9, 19, 14, 10);
  px(ctx, "#2e1c16", 9, 24, 14, 5);
  // The arch's keystone and its bricks round the top.
  px(ctx, f.mantelEdge, 15, 9, 2, 2);
  // The logs on their grate.
  px(ctx, "#6a4a2a", 10, 25, 12, 2);
  px(ctx, "#8a6038", 11, 25, 4, 1);
  px(ctx, "#4a3020", 12, 27, 9, 1);
  px(ctx, "#3a2a24", 9, 28, 14, 1);
  // The hearth stone before it.
  px(ctx, O, 4, 29, 24, 2);
  px(ctx, f.mantel, 5, 29, 22, 1);
}

/** From behind: the chimney breast's plain back and the flue going up. */
function back(ctx: Ctx, f: Fireplace) {
  px(ctx, O, 1, 4, 30, 27);
  bricks(ctx, f, 2, 5, 28, 25);
  px(ctx, O, 0, 2, 32, 5);
  px(ctx, f.mantel, 1, 3, 30, 2);
  px(ctx, f.mantelEdge, 1, 5, 30, 1);
  px(ctx, O, 11, -2, 10, 6);
  bricks(ctx, f, 12, -1, 8, 4);
}

/** From its side (facing right): the breast's depth, the mantel's end, the fire's light round the opening. */
function side(ctx: Ctx, f: Fireplace) {
  px(ctx, O, 9, 4, 14, 27);
  bricks(ctx, f, 10, 5, 12, 25);
  px(ctx, O, 8, 2, 17, 5);
  px(ctx, f.mantel, 9, 3, 15, 2);
  px(ctx, f.mantelEdge, 9, 5, 15, 1);
  px(ctx, O, 20, 29, 6, 2);
  px(ctx, f.mantel, 20, 29, 5, 1);
}

/** Draws fireplace `key` from `view`; false if it isn't one. */
export function drawFireplace(ctx: Ctx, key: string, view: "front" | "back" | "side" = "front"): boolean {
  const f = FIREPLACES[key];
  if (!f) return false;
  if (view === "back") back(ctx, f);
  else if (view === "side") side(ctx, f);
  else front(ctx, f);
  return true;
}

/** Its fire, alive while it's lit (drawn into `g` over the front picture, the tile's top left its origin). */
export function fireplaceFire(key: string): ((g: Graphics, now: number, on: boolean) => void) | null {
  const f = FIREPLACES[key];
  if (!f) return null;
  const [outer, mid, core] = f.flame;
  return (g, now, on) => {
    g.clear();
    if (!on) {
      // Out: the coals still just warm.
      g.rect(11, 26, 10, 1).fill({ color: outer, alpha: 0.25 + 0.1 * Math.sin(now / 900) });
      return;
    }
    const t = now / 1000;
    // Its light: on the hearth, up the inside of the firebox, out on the floor before it.
    const flick = 0.75 + 0.15 * Math.sin(t * 9.1) + 0.1 * Math.sin(t * 23.7);
    g.ellipse(16, 32, 20, 5).fill({ color: f.glow, alpha: 0.2 * flick });
    g.rect(8, 12, 16, 17).fill({ color: f.glow, alpha: 0.12 * flick });
    g.rect(9, 19, 14, 10).fill({ color: mid, alpha: 0.12 * flick });
    // The coals: glowing, breathing.
    for (let i = 0; i < 5; i++) {
      const b = 0.5 + 0.5 * Math.sin(t * 2.3 + i * 1.7);
      g.rect(10 + i * 2.5, 26, 2, 1).fill({ color: b > 0.6 ? core : mid, alpha: 0.6 + 0.4 * b });
    }
    // The flames: tongues off the logs, each its own height and sway, outer, then middle, then the hot core.
    const tongue = (x: number, w: number, h: number, sway: number, color: number, alpha = 1) =>
      g.poly([x - w, 26, x - w * 0.4, 26 - h * 0.55, x + sway, 26 - h, x + w * 0.4, 26 - h * 0.5, x + w, 26]).fill({ color, alpha });
    for (let i = 0; i < 6; i++) {
      const x = 10.5 + i * 2.2;
      const h = 7 + 3.5 * Math.abs(Math.sin(t * 5.3 + i * 1.3)) + 1.5 * Math.sin(t * 11.1 + i * 2.1);
      tongue(x, 2.1, h, Math.sin(t * 6.7 + i) * 1.4, outer, 0.95);
    }
    for (let i = 0; i < 4; i++) {
      const x = 12 + i * 2.6;
      const h = 5 + 2.5 * Math.abs(Math.sin(t * 6.1 + i * 1.9));
      tongue(x, 1.7, h, Math.sin(t * 7.9 + i * 1.4) * 1.1, mid);
    }
    tongue(16, 2.6, 3.5 + 1.2 * Math.abs(Math.sin(t * 8.3)), Math.sin(t * 9.7) * 0.8, core);
    // Sparks, rising and going out.
    for (let i = 0; i < 4; i++) {
      const life = (t * 0.9 + i * 0.27) % 1;
      const x = 12 + ((i * 5) % 8) + Math.sin(t * 3 + i * 2) * 1.5;
      g.rect(Math.round(x), Math.round(24 - life * 12), 1, 1).fill({ color: core, alpha: 1 - life });
    }
  };
}
