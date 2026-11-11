// The double sofa: two tiles long, in three colours. Facing you (or away)
// it's two tiles wide (64×32); turned side on it runs back from you, two
// tiles deep (32×64). Feet at the bottom, as every piece.

const O = "#2b2233";
const LEG = "#5e3e22";

interface Sofa {
  main: string;
  light: string;
  dark: string;
  pillow: string;
}

export const SOFAS: Record<string, Sofa> = {
  double_sofa: { main: "#b5544a", light: "#cf6f63", dark: "#99443b", pillow: "#f4f1d8" },
  double_sofa_green: { main: "#5e8a5a", light: "#7aa874", dark: "#4a6e47", pillow: "#f0e6c8" },
  double_sofa_navy: { main: "#3f5f8f", light: "#5a7cb0", dark: "#2f4a72", pillow: "#f4d06b" },
};

/** Two tiles long: these. */
export const WIDE = new Set(Object.keys(SOFAS));

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function canvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  return c;
}

/** From the front: its back along the top, two seat cushions, the arms at its ends, cushions to lean on. */
function front(ctx: CanvasRenderingContext2D, s: Sofa) {
  px(ctx, O, 0, 7, 64, 23);
  px(ctx, s.main, 1, 8, 62, 10);
  px(ctx, s.light, 1, 8, 62, 1);
  // The two seats, a seam between.
  px(ctx, s.light, 5, 18, 54, 6);
  px(ctx, s.main, 5, 23, 54, 1);
  px(ctx, s.dark, 31, 18, 2, 6);
  px(ctx, s.main, 5, 18, 54, 1);
  // The arms.
  px(ctx, s.dark, 1, 15, 5, 11);
  px(ctx, s.dark, 58, 15, 5, 11);
  px(ctx, s.main, 1, 15, 5, 1);
  px(ctx, s.main, 58, 15, 5, 1);
  // Cushions propped against its back.
  px(ctx, s.pillow, 8, 11, 7, 6);
  px(ctx, O, 8, 16, 7, 1);
  px(ctx, s.pillow, 49, 11, 7, 6);
  px(ctx, O, 49, 16, 7, 1);
  // Its skirt and legs.
  px(ctx, s.dark, 1, 24, 62, 2);
  px(ctx, O, 1, 26, 62, 1);
  for (const x of [3, 30, 58]) px(ctx, LEG, x, 27, 3, 3);
}

/** From behind: the back's plain upholstery, its seams, the legs. */
function back(ctx: CanvasRenderingContext2D, s: Sofa) {
  px(ctx, O, 0, 7, 64, 23);
  px(ctx, s.dark, 1, 8, 62, 17);
  px(ctx, s.main, 1, 8, 62, 2);
  px(ctx, O, 5, 15, 1, 10);
  px(ctx, O, 58, 15, 1, 10);
  px(ctx, s.main, 31, 10, 2, 15);
  px(ctx, O, 1, 25, 62, 1);
  for (const x of [3, 30, 58]) px(ctx, LEG, x, 26, 3, 4);
}

/** Turned to face right, seen from its end: its back down the left, the two seats running away, the near arm across the bottom. */
function side(ctx: CanvasRenderingContext2D, s: Sofa) {
  px(ctx, O, 6, 3, 21, 59);
  px(ctx, s.main, 7, 4, 6, 53);
  px(ctx, s.light, 7, 4, 6, 1);
  // The far arm, at the back.
  px(ctx, s.dark, 13, 4, 13, 5);
  px(ctx, s.main, 13, 4, 13, 1);
  // The two seats going away, a seam between.
  px(ctx, s.light, 13, 9, 13, 43);
  px(ctx, O, 13, 9, 13, 1);
  px(ctx, s.dark, 13, 30, 13, 2);
  px(ctx, s.pillow, 14, 11, 4, 6);
  px(ctx, s.pillow, 14, 42, 4, 6);
  // The near arm, toward you.
  px(ctx, s.dark, 7, 52, 19, 6);
  px(ctx, s.main, 7, 52, 19, 1);
  px(ctx, O, 7, 58, 19, 1);
  px(ctx, LEG, 7, 59, 3, 3);
  px(ctx, LEG, 23, 59, 3, 3);
}

/** Double sofa `key` facing `rot` (0 toward you, 1 right, 2 away, 3 left): 64×32 facing you or away, 32×64 turned. */
export function sofaCanvas(key: string, rot: number): HTMLCanvasElement | null {
  const s = SOFAS[key];
  if (!s) return null;
  const r = rot & 3;
  if (r === 0) return canvas(64, 32, (ctx) => front(ctx, s));
  if (r === 2) return canvas(64, 32, (ctx) => back(ctx, s));
  return canvas(32, 64, (ctx) => {
    if (r === 3) {
      ctx.translate(32, 0);
      ctx.scale(-1, 1);
    }
    side(ctx, s);
  });
}

/** Its icon (the bag, the shop): its front, shrunk to a tile. */
export function drawSofaIcon(ctx: CanvasRenderingContext2D, key: string): boolean {
  const c = sofaCanvas(key, 0);
  if (!c) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, 0, 8, 32, 16);
  return true;
}
