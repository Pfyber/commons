// The town's trees, drawn richer: crowns built of overlapping clumps of
// leaves, lit from the upper left (a dark underside, mid tones, sunlit tops
// and glints), flecked with leaf texture; trunks with bark, a lit side and
// a shaded one, roots flaring at the foot; a soft shadow on the grass. Six
// shapes of each so a wood doesn't repeat.

import { disc, oval, polygon } from "./pixeldraw";
/** Small integer hash (as art.ts), for scattering leaves. */
function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(salt, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

const OUTLINE = "#2b3a26";
const TRUNK = { line: "#3b2a1c", base: "#7a5532", dark: "#5a3d24", light: "#9c7148" };

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Leaf colours: darkest under the crown to the sunlit glints on top. */
interface Leaves {
  dark: string;
  mid: string;
  light: string;
  hi: string;
}

const GREENS: Leaves[] = [
  { dark: "#3d6b33", mid: "#579443", light: "#78b456", hi: "#a5d479" },
  { dark: "#466f30", mid: "#679f45", light: "#8bbf5d", hi: "#b6dd85" },
  { dark: "#33603a", mid: "#4b8749", light: "#69a95b", hi: "#94c97c" },
];

type Clump = [number, number, number];

/** A trunk from `top` down to the ground at `foot`, `w` wide, centred on `cx`. */
function trunk(ctx: CanvasRenderingContext2D, cx: number, top: number, foot: number, w: number, seed: number) {
  const x0 = cx - Math.floor(w / 2);
  px(ctx, TRUNK.line, x0 - 1, top, w + 2, foot - top);
  px(ctx, TRUNK.base, x0, top, w, foot - top - 1);
  px(ctx, TRUNK.light, x0, top, 2, foot - top - 1);
  px(ctx, TRUNK.dark, x0 + w - 2, top, 2, foot - top - 1);
  // Roots flaring out at the foot.
  px(ctx, TRUNK.line, x0 - 3, foot - 3, w + 6, 3);
  px(ctx, TRUNK.base, x0 - 2, foot - 3, w + 4, 2);
  px(ctx, TRUNK.light, x0 - 2, foot - 3, 2, 1);
  px(ctx, TRUNK.dark, x0 + w, foot - 2, 2, 1);
  // Bark: a few dark notches.
  for (let i = 0; i < 4; i++) {
    const h = hash(i, seed, 31);
    px(ctx, TRUNK.dark, x0 + 1 + (h % Math.max(1, w - 2)), top + 3 + ((h >>> 8) % Math.max(1, foot - top - 8)), 1, 2);
  }
}

/** A crown of overlapping clumps, shaded and flecked with leaves. */
function crown(ctx: CanvasRenderingContext2D, clumps: Clump[], c: Leaves, seed: number) {
  for (const [x, y, r] of clumps) disc(ctx, OUTLINE, x, y, r + 1);
  for (const [x, y, r] of clumps) disc(ctx, c.dark, x, y, r);
  for (const [x, y, r] of clumps) disc(ctx, c.mid, x - 1, y - 2, r - 2);
  for (const [x, y, r] of clumps) disc(ctx, c.light, x - 2, y - 4, Math.max(1, Math.round(r * 0.5)));
  const top = Math.min(...clumps.map(([, y, r]) => y - r));
  for (const [x, y, r] of clumps) if (y - r <= top + 6) disc(ctx, c.hi, x - 3, y - r + 3, Math.max(1, Math.round(r * 0.22)));
  // Leaf flecks: lit ones high up, shadowed ones low down.
  const inside = (x: number, y: number) => clumps.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 < (r - 1) ** 2);
  const bottom = Math.max(...clumps.map(([, y, r]) => y + r));
  for (let i = 0; i < 140; i++) {
    const h = hash(i, seed, 97);
    const x = (h % 48) | 0;
    const y = top + ((h >>> 8) % Math.max(1, bottom - top));
    if (!inside(x, y) || !inside(x + 1, y)) continue;
    const t = (y - top) / Math.max(1, bottom - top);
    const col = t < 0.35 ? (i % 3 ? c.hi : c.light) : t < 0.7 ? (i % 2 ? c.light : c.dark) : c.dark;
    if (i % 4) px(ctx, col, x, y, 2, 1);
    else px(ctx, col, x, y, 1, 2);
  }
}

/** The six crown shapes of a broadleaf tree, in a 44-wide canvas. */
const SHAPES: Clump[][] = [
  [[22, 25, 12], [12, 29, 8], [32, 29, 8], [22, 15, 10], [14, 19, 8], [30, 19, 8]],
  [[22, 23, 11], [22, 13, 9], [14, 26, 8], [30, 27, 8], [22, 31, 8]],
  [[22, 25, 12], [10, 28, 8], [34, 28, 8], [16, 17, 9], [29, 17, 9]],
  [[21, 24, 12], [31, 18, 9], [13, 18, 8], [24, 12, 8], [30, 30, 7], [12, 30, 7]],
  [[22, 21, 13], [13, 28, 8], [31, 28, 8], [22, 30, 9]],
  [[23, 24, 11], [14, 22, 9], [31, 23, 9], [19, 13, 8], [28, 14, 7], [22, 31, 8]],
];

/** A broadleaf tree (44×60). */
function broadleaf(v: number, leaves: Leaves, fruit: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(44, 60);
  oval(ctx, "rgba(0,0,0,0.2)", 22, 56, 15, 3);
  const shape = SHAPES[v % SHAPES.length];
  trunk(ctx, 22, 32, 58, 6, v);
  // Two boughs reaching up into the crown.
  px(ctx, TRUNK.line, 16, 31, 4, 2);
  px(ctx, TRUNK.line, 25, 30, 4, 2);
  px(ctx, TRUNK.base, 17, 31, 3, 1);
  px(ctx, TRUNK.base, 25, 30, 3, 1);
  crown(ctx, shape.map(([x, y, r]) => [x, y + 3, r] as Clump), leaves, 11 + v);
  if (fruit) {
    // Apples among the leaves, each catching the light, a couple fallen.
    const inside = (x: number, y: number) => shape.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy - 3) ** 2 < (r - 3) ** 2);
    let n = 0;
    for (let i = 0; i < 60 && n < 9; i++) {
      const h = hash(i, v, 53);
      const x = 6 + (h % 32);
      const y = 9 + ((h >>> 8) % 30);
      if (!inside(x, y) || !inside(x + 2, y + 2)) continue;
      px(ctx, "#7a1f22", x, y + 1, 3, 2);
      px(ctx, "#d8393a", x, y, 3, 2);
      px(ctx, "#ff9a86", x, y, 1, 1);
      px(ctx, "#5a3d24", x + 1, y - 1, 1, 1);
      n++;
    }
    for (const [x, y] of v % 2 ? [[12, 55], [30, 56]] : [[33, 55]]) {
      px(ctx, "#7a1f22", x, y + 1, 3, 1);
      px(ctx, "#d8393a", x, y, 3, 1);
      px(ctx, "#ff9a86", x, y, 1, 1);
    }
  }
  return c;
}

/** A pine (40×64): tiers of needles, each lit on the left, ragged below. */
function pine(v: number, glint: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(40, 64);
  oval(ctx, "rgba(0,0,0,0.2)", 20, 60, 13, 3);
  trunk(ctx, 20, 48, 62, 4, v + 7);
  const greens = [
    ["#2c5a3a", "#3f7a4a", "#5a9a5e", "#86bf7e"],
    ["#2a5636", "#3a7345", "#539157", "#7cb874"],
    ["#30603e", "#467f4e", "#62a064", "#8fc683"],
  ][v % 3];
  const [dark, mid, light, hi] = greens;
  const tiers = 4;
  const lean = (v % 6) - 2.5;
  for (let i = 0; i < tiers; i++) {
    const top = 3 + i * 11;
    const half = 7 + i * 3.5 + (v >= 3 ? 1 : 0);
    const base = top + 17;
    const cx = 20 + (i === 0 ? lean * 0.3 : 0);
    polygon(ctx, OUTLINE, [
      [cx, top - 1],
      [cx + half + 1.5, base + 1],
      [cx - half - 1.5, base + 1],
    ]);
    polygon(ctx, dark, [
      [cx, top],
      [cx + half, base],
      [cx - half, base],
    ]);
    polygon(ctx, mid, [
      [cx, top + 1],
      [cx + half * 0.45, base - 2],
      [cx - half + 1, base - 1],
    ]);
    polygon(ctx, light, [
      [cx - 1, top + 3],
      [cx - 1, base - 4],
      [cx - half * 0.7, base - 2],
    ]);
    // Ragged needle ends along the tier's foot.
    for (let x = Math.ceil(cx - half); x < cx + half; x += 3) {
      px(ctx, OUTLINE, x, base + 1, 2, 1);
      px(ctx, x < cx ? mid : dark, x, base, 2, 1);
    }
    // Needle flecks.
    for (let k = 0; k < 10; k++) {
      const h = hash(k, i * 7 + v, 61);
      const y = top + 4 + (h % 12);
      const spread = ((y - top) / 17) * half - 2;
      const x = Math.round(cx - spread + ((h >>> 8) % Math.max(1, Math.round(spread * 2))));
      px(ctx, x < cx ? hi : light, x, y, 1, 2);
    }
  }
  if (glint) px(ctx, "#fff6d0", 24, 32, 1, 1);
  return c;
}

/** A weeping willow (44×62), or the curtain of strands between two. */
function willow(v: number, curtain: boolean): HTMLCanvasElement {
  const [c, ctx] = canvas(44, 62);
  const pal = [
    ["#5f8a40", "#86b25a", "#a3ca70", "#cfe89c"],
    ["#67923f", "#90ba62", "#accf7a", "#d6eca4"],
    ["#5a853c", "#80ab56", "#9cc46c", "#c9e396"],
  ][v % 3];
  const [dark, mid, light, hi] = pal;
  // Where the dome of the crown is at column x (its strands hang from there).
  const dome = (x: number) => 16 - Math.sqrt(Math.max(0, 1 - ((x - 22) / 21) ** 2)) * 12;
  // Strands: a row behind, darker, then the front ones; uneven, tapering,
  // swaying a little, with gaps you glimpse the trunk through.
  const strands = (back: boolean) => {
    for (let i = 0; i < 22; i++) {
      const h = hash(i, v * 3 + (back ? 1 : 0), 71);
      if (!curtain && !back && h % 5 === 0) continue;
      const sx = 1 + i * 2 + (back ? 1 : 0);
      if (sx > 42) continue;
      const top = curtain ? 0 : Math.round(dome(sx)) + 6;
      const edge = Math.abs(sx - 22) / 22;
      const len = curtain ? 50 + (h % 10) : Math.round(30 + (h % 14) - edge * 10);
      const tone = back ? dark : (h >>> 4) % 3 === 0 ? light : mid;
      for (let y = 0; y < len; y++) {
        const sway = Math.round(Math.sin((y + i * 3) / 9) * (y / len) * 1.5);
        const w = y < len * 0.7 ? 2 : 1;
        px(ctx, tone, sx + sway, top + y, w, 1);
        if (!back && w === 2 && hash(y, i + v * 31, 75) % 11 === 0) px(ctx, hi, sx + sway, top + y, 1, 1);
      }
      px(ctx, back ? mid : hi, sx + Math.round(Math.sin((len + i * 3) / 9) * 1.5), top + len - 2, 1, 2);
    }
  };
  if (!curtain) {
    oval(ctx, "rgba(0,0,0,0.2)", 22, 58, 17, 3);
    trunk(ctx, 22, 20, 60, 5, v + 3);
  }
  strands(true);
  if (!curtain) {
    // The crown's dome, shaded like the other trees'.
    oval(ctx, OUTLINE, 22, 15, 21, 12);
    oval(ctx, dark, 22, 15, 20, 11);
    oval(ctx, mid, 21, 13, 17, 9);
    oval(ctx, light, 17, 10, 10, 5);
    oval(ctx, hi, 13, 8, 4, 2);
    for (let i = 0; i < 40; i++) {
      const h = hash(i, v, 73);
      const x = 4 + (h % 36);
      const y = 5 + ((h >>> 8) % 18);
      if (((x - 22) / 19) ** 2 + ((y - 15) / 10) ** 2 > 1) continue;
      px(ctx, y < 12 ? hi : y < 18 ? light : dark, x, y, 2, 1);
    }
  }
  strands(false);
  return c;
}

/** The town's trees by decor kind, or null for anything else. */
export function treeCanvas(kind: string, variant: number): HTMLCanvasElement | null {
  const v = variant % 6;
  switch (kind) {
    case "tree":
      return broadleaf(v, GREENS[v % 3], false);
    case "apple_tree":
      return broadleaf(v, GREENS[1], true);
    case "pine":
      return pine(v, false);
    case "pine_secret":
      return pine(v, true);
    case "willow":
      return willow(v, false);
    case "willow_curtain":
      return willow(v, true);
    default:
      return null;
  }
}
