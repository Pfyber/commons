// The arena's amphitheatre, painted: one great rounded bowl round the sand,
// seen from the south and a little above, built of blocks half a tile
// across (the town's pixel style, its curves stepping block by block),
// every block outlined. Its tiles (mapgen) say where you can walk and sit;
// this is how it looks.
//
// Out from the sand's edge, ring by ring (a tile each, as the tiles have
// it): the podium wall (painted panels, a marble cap); a row of seats; the
// walkway; a second row of seats; the great outer wall. Every surface
// stands at its height, so the north stands show their steps face on with
// the outer wall's inner face rising behind them (arches, statues,
// banners), and below the south rim its outer face: an attic storey over
// two of arches. Stair aisles climb the stands; on the north side, over
// the sand, the emperor's box under a purple canopy; masts round the rim
// for the awnings. The ways in (the grand arch south, its own object in
// arenaart.ts; a little arch either side) are paved through.
//
// The crowd in the seats is live (activities/arena.ts): `bowlSeats` says
// where each seat is, from the same measurements.

const T = 32;
/** The blocks it's built of (px): half a tile. */
const Q = 16;
/** The middle of the block a coordinate's in. */
const block = (v: number) => Math.floor(v / Q) * Q + Q / 2;
/** From the bowl's edge to the sand's (tiles): outer wall, seats, walkway, seats, podium. */
export const BOWL_RIM = 5;
/** How far the art stands above the bowl's footprint (px): the north rim, raised. */
export const BOWL_OVERHANG = 84;
/**
 * How round the bowl is: a superellipse's power (2 an ellipse; the higher,
 * the squarer). As `commons_sim::arena::ROUNDNESS`.
 */
export const BOWL_ROUNDNESS = 3.3;

// Out from the sand (px of ground): what's where, and how high it stands.
// (Kept low where people walk and sit, so they sit on what's drawn.)
const PODIUM = 32;
const ROWS: { u0: number; u1: number; z: number }[] = [
  { u0: 32, u1: 64, z: 10 },
  { u0: 96, u1: 128, z: 13 },
];
const WALK = [64, 96] as const;
const WALL = [128, 160] as const;
const Z_PODIUM = 14;
const Z_WALK = 6;
const Z_WALL = 76;
/**
 * The south half stands lower: its outer wall a single low storey and its
 * steps shallower, so whoever walks the walkway there (between the wall and
 * the sand, nearer the camera) is seen on it, not lost behind the wall.
 */
const Z_WALL_S = 28;
const southern = (dy: number) => dy > 0;
const wallZ = (dy: number) => (southern(dy) ? Z_WALL_S : Z_WALL);
const rowZ = (row: number, dy: number) => (southern(dy) ? Math.round(ROWS[row].z / 2) : ROWS[row].z);
const Z_BOX = 18;
/** The ways in: the south one's half width (px), and the side arches'. */
const PASS = 32;
const SIDE = 30;
/** The emperor's box: its half width (px). */
const BOX = 64;

const enum M {
  NONE,
  PODIUM,
  ROW,
  WALK,
  WALL,
  BOX,
  PATH,
  AISLE,
}

/** The bowl's measurements (px, from its footprint's top-left). */
export interface BowlGeom {
  W: number;
  H: number;
  CX: number;
  CY: number;
  /** The sand's half width and half height. */
  a: number;
  b: number;
}

export function bowlGeom(wTiles: number, hTiles: number): BowlGeom {
  const W = wTiles * T;
  const H = hTiles * T;
  return { W, H, CX: W / 2, CY: H / 2, a: (wTiles / 2 - BOWL_RIM) * T, b: (hTiles / 2 - BOWL_RIM) * T };
}

/** How far out from the sand's edge (dx, dy) from the middle is (px; below 0, on the sand). */
export function bowlU(g: BowlGeom, dx: number, dy: number): number {
  const n = BOWL_ROUNDNESS;
  const f = (u: number) => (Math.abs(dx) / (g.a + u)) ** n + (Math.abs(dy) / (g.b + u)) ** n;
  if (f(0) <= 1) return -1;
  let lo = 0;
  let hi = 600;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 1) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** A point on the bowl's ring u out, at angle th (0 east, π/2 south): ground px from the middle. */
function ringPoint(g: BowlGeom, th: number, u: number): [number, number] {
  const e = 2 / BOWL_ROUNDNESS;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return [Math.sign(c) * Math.abs(c) ** e * (g.a + u), Math.sign(s) * Math.abs(s) ** e * (g.b + u)];
}

/** The angle round at (dx, dy) (as `ringPoint` takes it). */
function angleAt(g: BowlGeom, dx: number, dy: number, u: number): number {
  const e = BOWL_ROUNDNESS / 2;
  const x = dx / (g.a + u);
  const y = dy / (g.b + u);
  return Math.atan2(Math.sign(y) * Math.abs(y) ** e, Math.sign(x) * Math.abs(x) ** e);
}

/** The stair aisles up the stands (angles, degrees from east, south positive). */
const AISLES = [22, 58, 122, 158, 202, 238, 302, 338].map((d) => (d * Math.PI) / 180);

function inAisle(g: BowlGeom, th: number, u: number): boolean {
  const r = (g.a + g.b) / 2 + u;
  return AISLES.some((a) => {
    let d = Math.abs(th - a) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d * r < 9;
  });
}

interface Surface {
  m: M;
  z: number;
  u: number;
  row: number;
  th: number;
}

/**
 * The walkway's tiles, exactly as mapgen lays them (city.rs, `arena`): each
 * tile's ring by its middle, and wherever the walkway would only meet itself
 * corner to corner, the tile between nearest it joins it. The walkway's
 * painted on just these, so it's drawn right where people can walk.
 */
const walkCache = new Map<string, Set<number>>();
function walkTiles(g: BowlGeom): Set<number> {
  const key = `${g.W}x${g.H}`;
  const hit = walkCache.get(key);
  if (hit) return hit;
  const w = g.W / T;
  const h = g.H / T;
  const ring: number[] = [];
  const us: number[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = bowlU(g, (i + 0.5) * T - g.CX, (j + 0.5) * T - g.CY);
      const ut = u < 0 ? -1 : u / T;
      us.push(ut);
      ring.push(ut < 0 ? -1 : Math.floor(ut));
    }
  }
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w; i++) {
      for (const di of [-1, 1]) {
        const i2 = i + di;
        if (i2 < 0 || i2 >= w) continue;
        const p = j * w + i;
        const q = (j + 1) * w + i2;
        const sa = j * w + i2;
        const sb = (j + 1) * w + i;
        if (ring[p] === 2 && ring[q] === 2 && ring[sa] !== 2 && ring[sb] !== 2) {
          const near = (k: number) => Math.abs(us[k] - 2.5);
          ring[near(sa) <= near(sb) ? sa : sb] = 2;
        }
      }
    }
  }
  const out = new Set<number>();
  ring.forEach((r, k) => r === 2 && out.add(k));
  walkCache.set(key, out);
  return out;
}

/** What stands at ground point (dx, dy) from the middle, how high, and how far out. */
function surface(g: BowlGeom, dx: number, dy: number): Surface {
  const u = bowlU(g, dx, dy);
  if (u < 0 || u >= WALL[1]) return { m: M.NONE, z: 0, u, row: -1, th: 0 };
  const th = angleAt(g, dx, dy, u);
  // The ways in: from the south to the gate, and through each side wall to the walkway.
  if (dy > 0 && Math.abs(dx) < PASS) return { m: M.PATH, z: 0, u, row: -1, th };
  if (Math.abs(dy) < SIDE && u >= ROWS[1].u0) return { m: M.PATH, z: 0, u, row: -1, th };
  if (u >= WALL[0]) return { m: M.WALL, z: wallZ(dy), u, row: -1, th };
  if (u < PODIUM) return { m: M.PODIUM, z: southern(dy) ? Z_PODIUM - 4 : Z_PODIUM, u, row: -1, th };
  // The walkway: on its tiles (where people walk), and nowhere else.
  const ti = Math.floor((dx + g.CX) / T);
  const tj = Math.floor((dy + g.CY) / T);
  if (walkTiles(g).has(tj * (g.W / T) + ti)) return { m: M.WALK, z: southern(dy) ? Z_WALK / 2 : Z_WALK, u, row: -1, th };
  // The emperor's box, north, over the sand.
  if (dy < 0 && Math.abs(dx) < BOX && u < WALK[0]) return { m: M.BOX, z: Z_BOX, u, row: -1, th };
  const row = u < (WALK[0] + WALK[1]) / 2 ? 0 : 1;
  const z = rowZ(row, dy);
  if (inAisle(g, th, u)) return { m: M.AISLE, z, u, row, th };
  return { m: M.ROW, z, u, row, th };
}

// ---- colours ---------------------------------------------------------------------

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = {
  outline: hex("#2b2233"),
  marble: hex("#ece2cc"),
  marbleHi: hex("#fff6e2"),
  marbleLo: hex("#cfc0a0"),
  trav: hex("#d8c59e"),
  travHi: hex("#ead9b4"),
  travLo: hex("#b9a37a"),
  riser: hex("#a8916a"),
  riserLo: hex("#8c7654"),
  // The walkway and the ways in: the ground, darker than the stone that stands on it.
  walk: hex("#9c8560"),
  walkLo: hex("#6e5c40"),
  walkHi: hex("#b09a72"),
  wall: hex("#d3ba89"),
  wallHi: hex("#e6d2a6"),
  wallLo: hex("#b0956a"),
  wallDk: hex("#8e7450"),
  hole: hex("#3a2a1c"),
  holeDk: hex("#251a12"),
  statue: hex("#e8e2d4"),
  red: hex("#8f2b26"),
  redHi: hex("#b8322c"),
  ochre: hex("#a8743a"),
  ochreDk: hex("#7a4f22"),
  gold: hex("#d9a83a"),
  goldDk: hex("#a87a22"),
  purple: hex("#6a2a8a"),
  purpleDk: hex("#4a1c62"),
  path: hex("#94805c"),
  pathLo: hex("#6a583e"),
  leaf: hex("#5f8f4e"),
  bronze: hex("#c99a2a"),
  bronzeHi: hex("#e8c25a"),
};

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shade(c: RGB, k: number): RGB {
  return [Math.max(0, Math.min(255, c[0] + k)), Math.max(0, Math.min(255, c[1] + k)), Math.max(0, Math.min(255, c[2] + k))];
}

// ---- the tops of things ------------------------------------------------------------

/**
 * The top of a block (X, gy the pixel, as ground; the block's own
 * surface): each a flat stone, bevelled (lit along its top edge, shaded
 * along its bottom), shaded a little block to block. `shadow`: what stands
 * higher beside a piece of ground (north of it, west of it) shades its edge.
 */
function topColor(s: Surface, X: number, gy: number, dx: number, shadow: { n: boolean; w: boolean; e: boolean }): RGB {
  const c = topColorLit(s, X, gy, dx);
  const lx = ((X % Q) + Q) % Q;
  const ly = ((gy % Q) + Q) % Q;
  if ((shadow.n && ly < 6) || (shadow.w && lx < 4) || (shadow.e && lx >= Q - 3)) return shade(c, shadow.n && ly < 3 ? -46 : -30);
  return c;
}

function topColorLit(s: Surface, X: number, gy: number, dx: number): RGB {
  const lx = ((X % Q) + Q) % Q;
  const ly = ((gy % Q) + Q) % Q;
  const bi = Math.floor(X / Q);
  const bj = Math.floor(gy / Q);
  const n = Math.floor(hash(bi, bj) * 11) - 5;
  const bevel = (c: RGB, hi: RGB, lo: RGB): RGB => (ly < 2 ? hi : ly >= Q - 2 ? lo : shade(c, n));
  switch (s.m) {
    case M.PODIUM: {
      // The marble cap, a bronze post on every other block.
      if (s.u < Q && bi % 2 === 0 && lx >= 6 && lx < 10 && ly >= 5 && ly < 10) return lx === 6 || ly === 5 ? C.bronzeHi : C.bronze;
      return bevel(C.marble, C.marbleHi, C.marbleLo);
    }
    case M.ROW: {
      // A seat: a block of marble (the front row) or travertine; where
      // seats divide, a line.
      const front = s.row === 0;
      if (lx === Q - 1) return front ? C.marbleLo : C.travLo;
      return bevel(front ? C.marble : C.trav, front ? C.marbleHi : C.travHi, front ? C.marbleLo : C.travLo);
    }
    case M.AISLE:
      // Stairs: two steps to a block.
      return ly % 8 < 2 ? C.travHi : ly % 8 === 7 ? C.travLo : shade(C.trav, n + 6);
    case M.WALK:
      // Paving slabs, a block each, checked light and dark, worn in the joints.
      if (lx === 0 || ly === 0) return C.walkLo;
      return bevel((bi + bj) % 2 ? C.walk : shade(C.walk, -10), C.walkHi, shade(C.walkLo, 12));
    case M.WALL:
      // Capstones, alternately shaded.
      return bevel((bi + bj) % 2 ? C.wall : C.wallHi, C.wallHi, C.wallDk);
    case M.BOX: {
      // The canopy: purple and gold stripes, a gold fringe toward the sand.
      if (s.u < PODIUM + Q) return ly >= Q - 4 ? ((X >> 1) % 2 ? C.gold : C.goldDk) : shade(lx < 8 ? C.purple : C.purpleDk, n);
      return shade(Math.floor((dx + 1000) / 8) % 2 ? C.purple : C.purpleDk, n);
    }
    case M.PATH:
      if (lx === 0 || ly === 0) return C.pathLo;
      return bevel((bi + bj) % 2 ? C.path : shade(C.path, -8), shade(C.path, 16), shade(C.pathLo, 12));
  }
  return C.outline;
}

// ---- the faces (what's seen of a drop, from the south) --------------------------------

/**
 * The outer wall's face (k px down it, h tall), at column X: an attic
 * storey (pilasters, little windows) over two storeys of arches (statues
 * in every other upper one, a red banner now and then), cornices between.
 */
function facade(g: BowlGeom, X: number, k: number, h: number): RGB {
  const dx = X - g.CX;
  if (h < 44) {
    // The low south wall: a cap, then one storey of little arches between
    // pilasters, a torch on every fourth pier.
    if (k < 3) return k === 0 ? C.wallHi : C.wall;
    if (k === 3) return C.wallDk;
    if (k >= h - 2) return k === h - 1 ? C.outline : C.wallLo;
    const P = 24;
    const m = ((Math.round(dx) % P) + P) % P;
    const bay = Math.floor((dx + 10000) / P);
    if (m < 4) {
      if (bay % 4 === 0 && k >= 5 && k < 9) return k < 7 ? hex("#ffb84f") : hex("#6e4b30");
      return m === 0 ? C.wallLo : m === 3 ? C.wallDk : C.wallHi;
    }
    const ax = m - 13;
    const r = 7;
    const top = 7;
    if (Math.abs(ax) < r) {
      const y0 = top + r - Math.sqrt(Math.max(0, r * r - ax * ax));
      if (k >= y0 && k < h - 2) return k - y0 < 2 || Math.abs(ax) > r - 2 ? C.holeDk : C.hole;
      if (k >= y0 - 2 && k < y0) return C.wallHi;
    }
    return (k + (bay % 2) * 3) % 6 === 0 ? C.wallLo : C.wall;
  }
  const A = Math.round(h * 0.22);
  const mid = Math.round(h * 0.6);
  if (k < 3) return k === 0 ? C.wallHi : C.wall;
  if (k === 3) return C.wallDk;
  if (k >= h - 3) return k === h - 1 ? C.outline : C.wallLo;
  for (const c of [A, mid]) {
    if (k === c || k === c + 1) return C.wallHi;
    if (k === c + 2) return C.wallDk;
  }
  const P = 40;
  const m = ((Math.round(dx) % P) + P) % P;
  const bay = Math.floor((dx + 10000) / P);
  if (m < 5) return m === 0 ? C.wallLo : m === 4 ? C.wallDk : C.wallHi;
  // The attic: a little square window in each bay.
  if (k < A) {
    if (m >= 18 && m < 26 && k >= 7 && k < A - 3) return k === 7 ? C.holeDk : C.hole;
    return (k + bay) % 6 === 0 ? C.wallLo : C.wall;
  }
  const upper = k < mid;
  const top = upper ? A + 6 : mid + 6;
  const bottom = upper ? mid - 1 : h - 3;
  const ax = m - 22;
  const r = 11;
  if (Math.abs(ax) < r) {
    const y0 = top + r - Math.sqrt(Math.max(0, r * r - ax * ax));
    if (k >= y0 && k < bottom) {
      if (upper && bay % 2 === 0) {
        // A statue: a pale figure on a little plinth.
        const sk = k - y0;
        if (Math.abs(ax) < 3 && sk > 3 && sk < bottom - y0 - 3) return Math.abs(ax) === 2 ? C.wallLo : C.statue;
        if (Math.abs(ax) < 2 && sk >= 1 && sk <= 3) return C.statue;
        if (Math.abs(ax) < 5 && k >= bottom - 3) return C.wallHi;
      }
      if (!upper && bay % 5 === 2 && Math.abs(ax) < 6 && k < bottom - 4) {
        // A red banner hung in the arch, a gold eagle on it.
        if (Math.abs(ax) < 2 && k > y0 + 3 && k < y0 + 7) return C.gold;
        return Math.abs(ax) === 5 ? C.red : C.redHi;
      }
      return k - y0 < 2 || Math.abs(ax) > r - 2 ? C.holeDk : C.hole;
    }
    if (k >= y0 - 2 && k < y0) return C.wallHi;
  }
  if ((k + (bay % 2) * 3) % 7 === 0) return C.wallLo;
  return C.wall;
}

/** A step's riser (a seat's front, or the walkway's edge). */
function riser(k: number, aisle: boolean): RGB {
  if (k === 0) return C.travHi;
  if (aisle) return k % 3 === 0 ? C.travLo : C.trav;
  return k % 5 === 4 ? C.riserLo : C.riser;
}

/** The podium wall round the sand: ochre panels in gold frames, a bronze shield or a laurel now and then. */
function podiumFace(X: number, k: number, h: number): RGB {
  if (k === 0) return C.marbleHi;
  if (k === 1) return C.marbleLo;
  if (k >= h - 2) return k === h - 1 ? C.outline : C.ochreDk;
  const m = ((X % 48) + 48) % 48;
  const bay = Math.floor(X / 48);
  if (m < 2) return C.gold;
  if (m === 3 || m === 46 || k === 2 || k === h - 3) return C.goldDk;
  if (bay % 3 === 1 && Math.abs(m - 24) < 4 && k > 3 && k < h - 3) return Math.abs(m - 24) < 2 ? C.bronzeHi : C.bronze;
  if (bay % 3 === 2 && Math.abs(m - 24) < 7 && k > 4 && k < h - 4 && (Math.abs(m - 24) > 4 || k > h - 7)) return C.leaf;
  return C.ochre;
}

/** The emperor's box's front: marble columns, purple hangings, a gold eagle. */
function boxFace(g: BowlGeom, X: number, k: number, h: number): RGB {
  const dx = X - g.CX;
  if (k < 2) return C.gold;
  if (k >= h - 1) return C.outline;
  const m = (((Math.round(dx) + 7) % 14) + 14) % 14;
  if (m < 3) return m === 1 ? C.marbleHi : C.marble;
  if (Math.abs(dx) < 7 && k >= 3 && k < 12) {
    const wing = k < 7 ? Math.abs(dx) < 7 - (7 - k) : Math.abs(dx) < 3;
    if (wing) return k === 3 ? C.goldDk : C.gold;
  }
  if (k >= h - 4) return (X >> 1) % 2 ? C.gold : C.goldDk;
  return k % 2 ? C.purple : C.purpleDk;
}

// ---- the whole bowl --------------------------------------------------------------

const cache = new Map<string, { c: HTMLCanvasElement; overhang: number }>();

/** The amphitheatre's art for a footprint `w`×`h` tiles (the sand left clear). */
export function bowlArt(wTiles: number, hTiles: number): { c: HTMLCanvasElement; overhang: number } {
  const key = `${wTiles}x${hTiles}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const g = bowlGeom(wTiles, hTiles);
  const OV = BOWL_OVERHANG;
  const c = document.createElement("canvas");
  c.width = g.W;
  c.height = g.H + OV;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  const put = (x: number, y: number, col: RGB) => {
    if (y < 0 || y >= c.height) return;
    const i = (y * c.width + x) * 4;
    d[i] = col[0];
    d[i + 1] = col[1];
    d[i + 2] = col[2];
    d[i + 3] = 255;
  };
  // Column by column, north to south: each ground point drawn where its
  // height puts it (nearer ones over farther); where the ground drops away
  // (seen from the south), the face of what's higher fills the gap.
  // (What each pixel shows, for the outlines after: 0 nothing, else what.)
  const what = new Uint8Array(c.width * c.height);
  const mark = (x: number, y: number, id: number) => {
    if (y >= 0 && y < c.height) what[y * c.width + x] = id;
  };
  for (let X = 0; X < g.W; X++) {
    const dx = block(X) - g.CX;
    let prevY = -1e9;
    let prev: Surface | null = null;
    for (let gy = 0; gy < g.H + 2; gy++) {
      const dy = block(gy) - g.CY;
      const s = surface(g, dx, dy);
      const sy = Math.round(gy - s.z) + OV;
      if (prev && prev.m !== M.NONE && sy > prevY + 1) {
        const h = sy - prevY - 1;
        for (let k = 0; k < h; k++) {
          let col: RGB;
          if (prev.m === M.WALL) col = facade(g, X, k, h);
          else if (prev.m === M.PODIUM) col = podiumFace(X, k, h);
          else if (prev.m === M.BOX) col = boxFace(g, X, k, h);
          else col = riser(k, prev.m === M.AISLE || s.m === M.AISLE);
          put(X, prevY + 1 + k, col);
          mark(X, prevY + 1 + k, 16 + prev.m);
        }
      }
      if (s.m !== M.NONE) {
        // The ground (the walkway, the ways in): shaded where something higher stands beside it.
        const ground = s.m === M.WALK || s.m === M.PATH;
        const higher = (ddx: number, ddy: number) => surface(g, block(X + ddx) - g.CX, block(gy + ddy) - g.CY).z > s.z;
        const shadow = ground ? { n: higher(0, -Q), w: higher(-Q, 0), e: higher(Q, 0) } : { n: false, w: false, e: false };
        put(X, sy, topColor(s, X, gy, dx, shadow));
        mark(X, sy, s.m + (s.row > 0 ? 8 : 0));
      }
      prevY = sy;
      prev = s;
    }
  }
  // Outlined, as everything in the town is: dark round the bowl's edges
  // (against the sand and the desert), a seam where one thing meets another.
  const W = c.width;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < W; x++) {
      const id = what[y * W + x];
      if (!id) continue;
      const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= W || yy >= c.height ? 0 : what[yy * W + xx]);
      const i = (y * W + x) * 4;
      if (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)) {
        d[i] = C.outline[0];
        d[i + 1] = C.outline[1];
        d[i + 2] = C.outline[2];
      } else if (at(x + 1, y) !== id || at(x, y + 1) !== id) {
        d[i] = Math.max(0, d[i] - 34);
        d[i + 1] = Math.max(0, d[i + 1] - 34);
        d[i + 2] = Math.max(0, d[i + 2] - 30);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  // Red cushions on the public seats (the south stands): anyone's to watch from.
  for (const s of bowlSeats(wTiles, hTiles)) {
    if (!s.open) continue;
    const x = s.x - 7;
    const y = s.y + OV - 7;
    ctx.fillStyle = "#2b2233";
    ctx.fillRect(x - 1, y - 1, 16, 9);
    ctx.fillStyle = "#6d1f1b";
    ctx.fillRect(x, y + 1, 14, 6);
    ctx.fillStyle = "#b8322c";
    ctx.fillRect(x, y, 14, 5);
    ctx.fillStyle = "#d9544a";
    ctx.fillRect(x + 1, y, 12, 1);
    ctx.fillStyle = "#d9a83a";
    ctx.fillRect(x, y + 6, 2, 1);
    ctx.fillRect(x + 12, y + 6, 2, 1);
  }
  // The masts round the rim, for the awnings (their pennants fly live).
  for (const [mx, my] of bowlMasts(wTiles, hTiles)) {
    ctx.fillStyle = "#2b2233";
    ctx.fillRect(mx - 1, my - 20, 3, 21);
    ctx.fillStyle = "#8f6236";
    ctx.fillRect(mx, my - 19, 1, 19);
  }
  const out = { c, overhang: OV };
  cache.set(key, out);
  return out;
}

/** The masts on the rim (px, from the art's top-left: the foot of each). */
export function bowlMasts(wTiles: number, hTiles: number): [number, number][] {
  const g = bowlGeom(wTiles, hTiles);
  const out: [number, number][] = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2 + Math.PI / n;
    const [dx, dy] = ringPoint(g, th, 144);
    // Not over the ways in.
    if ((dy > 0 && Math.abs(dx) < PASS + 40) || Math.abs(dy) < SIDE + 16) continue;
    out.push([block(g.CX + dx), block(g.CY + dy) - wallZ(dy) + BOWL_OVERHANG]);
  }
  return out;
}

/** A seat in the stands: where they sit (px, footprint-relative), where its ground is (for drawing order), the angle round. */
export interface Seat {
  x: number;
  y: number;
  ground: number;
  th: number;
  /** Anyone's to sit in (the cushioned south seats): the crowd leaves these. */
  open: boolean;
}

/**
 * Every seat in the stands, one to a block along the middle of each row
 * (none in the aisles, the ways in or the emperor's box), no two closer
 * than a person's width.
 */
export function bowlSeats(wTiles: number, hTiles: number): Seat[] {
  const g = bowlGeom(wTiles, hTiles);
  const out: Seat[] = [];
  ROWS.forEach((r, row) => {
    const cands: { x: number; ground: number; th: number }[] = [];
    for (let gy = Q / 2; gy < g.H; gy += Q) {
      for (let x = Q / 2; x < g.W; x += Q) {
        const s = surface(g, x - g.CX, gy - g.CY);
        if (s.m !== M.ROW || s.row !== row || s.u < r.u0 + 6 || s.u >= r.u1 - 6) continue;
        // (Not by the gladiators' gates, either side halfway down.)
        if (row === 0 && Math.abs(gy - g.CY) < 2 * T) continue;
        cands.push({ x, ground: gy, th: s.th });
      }
    }
    cands.sort((p, q) => p.th - q.th);
    const kept: typeof cands = [];
    for (const c of cands) {
      if (kept.some((k) => Math.abs(k.x - c.x) < 22 && Math.abs(k.ground - c.ground) < 12)) continue;
      kept.push(c);
    }
    for (const c of kept) out.push({ x: c.x, y: c.ground - rowZ(row, c.ground - g.CY), ground: c.ground, th: c.th, open: c.ground - g.CY > g.b * 0.45 });
  });
  return out;
}
