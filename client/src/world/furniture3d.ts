// Furniture built up in the 3D (2.5D) view, not stood up flat like a card:
// what faces you stands at its front edge, a bed's covers, a table's top, a
// mantel or a seat's cushion lie flat going back from it, and a chair's or a
// sofa's back stands up behind its seat. Each piece is described by how high
// its top is and how far back it goes (art px); the picture is then mapped
// onto that shape, row by row (see `Scene.setRelief`).

import type { Relief } from "./skateart";

/**
 * `h`: how high its top (or its seat) is; `d`: how far back it reaches;
 * `seat`: rows of seat cushion before its back stands up (a chair, a sofa).
 */
interface Shape {
  h: number;
  d: number;
  seat?: number;
  /** A solid box (no legs to see between): its sides are drawn in. */
  solid?: boolean;
}

const SHAPES: Record<string, Shape> = {
  // Beds: lying down, a little lip at the foot.
  cozy_bed: { h: 3, d: 26, solid: true },
  double_bed: { h: 3, d: 28, solid: true },
  // Tables and low furniture: their tops lie flat.
  coffee_table: { h: 12, d: 18 },
  dining_table: { h: 13, d: 20 },
  writing_desk: { h: 13, d: 18 },
  bar_cart: { h: 12, d: 16 },
  small_table: { h: 13, d: 16 },
  side_table: { h: 12, d: 12 },
  nightstand: { h: 13, d: 14, solid: true },
  low_cabinet: { h: 12, d: 16, solid: true },
  toy_chest: { h: 14, d: 14, solid: true },
  radio: { h: 16, d: 8, solid: true },
  // Tall things: their fronts stand, their tops (a mantel, a lid) lie back.
  fireplace: { h: 25, d: 8, solid: true },
  fireplace_grey: { h: 25, d: 8, solid: true },
  fireplace_obsidian: { h: 25, d: 8, solid: true },
  aquarium: { h: 26, d: 10, solid: true },
  bookshelf: { h: 29, d: 8, solid: true },
  bookcase_full: { h: 31, d: 8, solid: true },
  display_shelf: { h: 28, d: 8, solid: true },
  mini_fridge: { h: 25, d: 12, solid: true },
  arcade_cabinet: { h: 27, d: 10, solid: true },
  popcorn_machine: { h: 27, d: 10, solid: true },
  retro_tv: { h: 22, d: 12, solid: true },
  grandfather_clock: { h: 33, d: 8, solid: true },
  piano: { h: 27, d: 10, solid: true },
  // Seats: the front of the seat, the cushion going back, the back standing behind.
  wooden_chair: { h: 9, d: 14, seat: 3 },
  rocking_chair: { h: 10, d: 14, seat: 3 },
  armchair: { h: 7, d: 16, seat: 5 },
  cozy_armchair: { h: 8, d: 18, seat: 6 },
  sofa: { h: 6, d: 18, seat: 5 },
  double_sofa: { h: 6, d: 18, seat: 6 },
  double_sofa_green: { h: 6, d: 18, seat: 6 },
  double_sofa_navy: { h: 6, d: 18, seat: 6 },
};

/** Whether `key` is built up in 3D. */
export function hasShape(key: string): boolean {
  return key in SHAPES;
}

/** Where on `c` anything's drawn: its top and bottom rows (exclusive bottom). */
function rows(c: HTMLCanvasElement): [number, number] {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let top = c.height;
  let bot = 0;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] < 40) continue;
      top = Math.min(top, y);
      bot = Math.max(bot, y + 1);
    }
  return bot > top ? [top, bot] : [0, c.height];
}

const made = new WeakMap<HTMLCanvasElement, Relief>();

/**
 * A solid piece's side: as wide as its front is halfway up (its outline
 * columns), as high as its top and as deep as it goes back; its colour, its
 * front's just inside that edge, a shade darker (turned from the light).
 */
function sideOf(c: HTMLCanvasElement, front: number, bot: number, s: Shape): NonNullable<Relief["side"]> {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  const y = Math.max(0, Math.min(c.height - 1, Math.round((front + bot) / 2)));
  let x0 = 0;
  let x1 = c.width;
  while (x0 < c.width && d[(y * c.width + x0) * 4 + 3] < 40) x0++;
  while (x1 > x0 && d[(y * c.width + x1 - 1) * 4 + 3] < 40) x1--;
  const at = (y * c.width + Math.min(x1 - 1, x0 + 1)) * 4;
  const k = 0.68;
  const color = (Math.round(d[at] * k) << 16) | (Math.round(d[at + 1] * k) << 8) | Math.round(d[at + 2] * k);
  return { x0, x1, h: s.h, d: s.d, color };
}

/**
 * The shape of piece `key`'s picture `c` facing `rot`: each pixel's ground
 * row (counted back from its feet, which are 0; going back is negative) and
 * its height. Null if it isn't built up.
 */
export function furnitureRelief(c: HTMLCanvasElement, key: string, rot: number): Relief | null {
  const base = SHAPES[key];
  if (!base) return null;
  const cached = made.get(c);
  if (cached) return cached;
  const [top, bot] = rows(c);
  // From behind, a seat's back faces you: it stands, a sliver of top going back.
  let s: Shape = (rot & 3) === 2 && base.seat ? { h: Math.max(4, bot - top - 3), d: 6 } : base;
  // Turned side on, a seat lies along its length: its near end stands, the rest (seat and back) lies going back.
  if ((rot & 1) === 1 && base.seat) s = { h: base.h, d: base.d };
  // Turned, a two-tile piece runs two tiles back.
  if (c.height > 32) s = { ...s, d: c.height - 14 };
  const { w, h: H } = { w: c.width, h: c.height };
  // By the edges between its rows (exact: where its front turns into its top is
  // a row's edge, not smeared between mesh points), the same all the way across.
  const edgeGy = new Float32Array(H + 1);
  const edgeZ = new Float32Array(H + 1);
  const front = bot - s.h;
  const lift = s.h;
  for (let y = 0; y <= H; y++) {
    let gy = 0;
    let z = 0;
    if (y >= front) {
      // Its front, standing at its front edge.
      z = Math.max(0, bot - y);
    } else if (s.seat) {
      const back = front - s.seat;
      const depth = s.d * 0.6;
      if (y >= back) {
        // The seat's cushion, going back.
        z = lift;
        gy = -((front - y) / Math.max(1, s.seat)) * depth;
      } else {
        // Its back, standing up behind the seat.
        z = lift + (back - y);
        gy = -depth;
      }
    } else if (y > top) {
      // Its top, lying flat going back (its outline row aside).
      z = lift;
      gy = -((front - y) / Math.max(1, front - top - 1)) * s.d;
    } else {
      // Its outline along the back: a lip a pixel high, not a dark band across the floor.
      z = lift + (top + 1 - y);
      gy = -s.d;
    }
    edgeGy[y] = gy;
    edgeZ[y] = z;
  }
  // (Per pixel too, for anything that asks: each row as its top edge.)
  const r: Relief = { w, h: H, gy: new Float32Array(w * H), z: new Float32Array(w * H), edgeGy, edgeZ };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < w; x++) {
      r.gy[y * w + x] = edgeGy[y];
      r.z[y * w + x] = edgeZ[y];
    }
  if (base.solid && !s.seat) r.side = sideOf(c, front, bot, s);
  made.set(c, r);
  return r;
}
