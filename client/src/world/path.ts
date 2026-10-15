// Deterministic 8-directional A*: a mirror of server/crates/sim/src/path.rs,
// used to predict the local player's walk before the server confirms it.
// Same costs, neighbour order and tie-breaking as the Rust version.

import { type StreetGrid, type ZoneMap, walkable } from "./map";
import type { TileXY } from "./motion";

const STRAIGHT = 10;
const DIAGONAL = 14;
const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return STRAIGHT * Math.max(dx, dy) + (DIAGONAL - STRAIGHT) * Math.min(dx, dy);
}

/** Binary min-heap of [f, h, seq, node] tuples, compared lexicographically. */
class Heap {
  private a: [number, number, number, number][] = [];
  get size() {
    return this.a.length;
  }
  private less(i: number, j: number) {
    const x = this.a[i];
    const y = this.a[j];
    for (let k = 0; k < 4; k++) if (x[k] !== y[k]) return x[k] < y[k];
    return false;
  }
  private swap(i: number, j: number) {
    [this.a[i], this.a[j]] = [this.a[j], this.a[i]];
  }
  push(v: [number, number, number, number]) {
    this.a.push(v);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number, number, number] | undefined {
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length > 0 && last) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.a.length && this.less(l, m)) m = l;
        if (r < this.a.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/** Maps up to this many tiles are searched whole; bigger ones within a window (as sim::path). */
const WHOLE_MAP_TILES = 128 * 128;
const WINDOW_MARGIN = 24;
/** On a city map, walks longer than this (Chebyshev, in tiles) follow the streets. */
export const LONG_WALK = 40;

export function findPath(map: ZoneMap, from: TileXY, to: TileXY, maxExpansions = 12000): TileXY[] | null {
  if (!walkable(map, from.x, from.y) || !walkable(map, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [{ ...from }];
  let wx = 0;
  let wy = 0;
  let w = map.width;
  let wh = map.height;
  if (map.width * map.height > WHOLE_MAP_TILES) {
    wx = Math.max(0, Math.min(from.x, to.x) - WINDOW_MARGIN);
    wy = Math.max(0, Math.min(from.y, to.y) - WINDOW_MARGIN);
    w = Math.min(map.width - 1, Math.max(from.x, to.x) + WINDOW_MARGIN) - wx + 1;
    wh = Math.min(map.height - 1, Math.max(from.y, to.y) + WINDOW_MARGIN) - wy + 1;
  }
  const openAt = (x: number, y: number) => x >= wx && y >= wy && x < wx + w && y < wy + wh && walkable(map, x, y);
  const n = w * wh;
  const g = new Uint32Array(n).fill(0xffffffff);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new Heap();
  let seq = 0;
  const start = (from.y - wy) * w + (from.x - wx);
  const goal = (to.y - wy) * w + (to.x - wx);
  g[start] = 0;
  const h0 = octile(from.x, from.y, to.x, to.y);
  open.push([h0, h0, seq, start]);
  let expansions = 0;

  while (open.size > 0) {
    const cur = open.pop()![3];
    if (closed[cur]) continue;
    if (cur === goal) {
      const out: TileXY[] = [];
      for (let i = cur; i !== -1; i = parent[i]) out.push({ x: wx + (i % w), y: wy + Math.floor(i / w) });
      return out.reverse();
    }
    closed[cur] = 1;
    if (++expansions > maxExpansions) return null;
    const cx = wx + (cur % w);
    const cy = wy + Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!openAt(nx, ny)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && (!openAt(cx + dx, cy) || !openAt(cx, cy + dy))) continue;
      const ni = (ny - wy) * w + (nx - wx);
      if (closed[ni]) continue;
      const ng = g[cur] + (diagonal ? DIAGONAL : STRAIGHT);
      if (ng < g[ni]) {
        g[ni] = ng;
        parent[ni] = cur;
        const h = octile(nx, ny, to.x, to.y);
        open.push([ng + h, h, ++seq, ni]);
      }
    }
  }
  return null;
}

/**
 * The path a walk takes (mirror of sim::path::route): on a city map a long
 * walk goes via street crossings and centre lines; otherwise plain A*.
 */
export function route(map: ZoneMap, from: TileXY, to: TileXY, maxExpansions = 12000): TileXY[] | null {
  const cheb = Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
  if (map.streets && cheb > LONG_WALK) {
    const p = streetRoute(map, map.streets, from, to, maxExpansions);
    if (p) return p;
  }
  return findPath(map, from, to, maxExpansions);
}

const pitchOf = (s: StreetGrid) => s.block_tiles + s.street_tiles;
const lane = (s: StreetGrid, k: number) => k * pitchOf(s) + Math.floor(s.street_tiles / 2);
function lanesAround(s: StreetGrid, v: number): [number, number] {
  const k = Math.min(s.blocks, Math.floor(Math.max(0, v - Math.floor(s.street_tiles / 2)) / pitchOf(s)));
  return [k, Math.min(k + 1, s.blocks)];
}

function crossings(s: StreetGrid, p: TileXY): TileXY[] {
  const out: TileXY[] = [];
  for (const ky of lanesAround(s, p.y)) {
    for (const kx of lanesAround(s, p.x)) {
      const c = { x: lane(s, kx), y: lane(s, ky) };
      if (!out.some((o) => o.x === c.x && o.y === c.y)) out.push(c);
    }
  }
  return out;
}

function streetRoute(map: ZoneMap, s: StreetGrid, from: TileXY, to: TileXY, maxExpansions: number): TileXY[] | null {
  const manhattan = (a: TileXY, b: TileXY) => STRAIGHT * (Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
  let best: [number, TileXY, TileXY] | null = null;
  for (const e of crossings(s, from)) {
    for (const x of crossings(s, to)) {
      const cost = octile(from.x, from.y, e.x, e.y) + manhattan(e, x) + octile(x.x, x.y, to.x, to.y);
      if (!best || cost < best[0]) best = [cost, e, x];
    }
  }
  if (!best) return null;
  const [, e, x] = best;
  const out = findPath(map, from, e, maxExpansions);
  if (!out) return null;
  const cur = { ...e };
  while (cur.x !== x.x || cur.y !== x.y) {
    if (cur.x !== x.x) cur.x += Math.sign(x.x - cur.x);
    else cur.y += Math.sign(x.y - cur.y);
    if (!walkable(map, cur.x, cur.y)) return null;
    out.push({ ...cur });
  }
  const tail = findPath(map, x, to, maxExpansions);
  if (!tail) return null;
  return out.concat(tail.slice(1));
}

/** Keeps endpoints and direction changes only (mirror of sim::compress). */
export function compress(path: TileXY[]): TileXY[] {
  if (path.length <= 2) return path.slice();
  const dir = (a: TileXY, b: TileXY) => `${Math.sign(b.x - a.x)},${Math.sign(b.y - a.y)}`;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    if (dir(path[i - 1], path[i]) !== dir(path[i], path[i + 1])) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}
