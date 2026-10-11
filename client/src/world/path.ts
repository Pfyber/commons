// Deterministic 8-directional A*: a mirror of server/crates/sim/src/path.rs,
// used to predict the local player's walk before the server confirms it.
// Same costs, neighbour order and tie-breaking as the Rust version.

import { type ZoneMap, walkable } from "./map";
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

export function findPath(map: ZoneMap, from: TileXY, to: TileXY, maxExpansions = 8000): TileXY[] | null {
  if (!walkable(map, from.x, from.y) || !walkable(map, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [{ ...from }];
  const w = map.width;
  const n = w * map.height;
  const g = new Uint32Array(n).fill(0xffffffff);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new Heap();
  let seq = 0;
  const start = from.y * w + from.x;
  const goal = to.y * w + to.x;
  g[start] = 0;
  const h0 = octile(from.x, from.y, to.x, to.y);
  open.push([h0, h0, seq, start]);
  let expansions = 0;

  while (open.size > 0) {
    const cur = open.pop()![3];
    if (closed[cur]) continue;
    if (cur === goal) {
      const out: TileXY[] = [];
      for (let i = cur; i !== -1; i = parent[i]) out.push({ x: i % w, y: Math.floor(i / w) });
      return out.reverse();
    }
    closed[cur] = 1;
    if (++expansions > maxExpansions) return null;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(map, nx, ny)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && (!walkable(map, cx + dx, cy) || !walkable(map, cx, cy + dy))) continue;
      const ni = ny * w + nx;
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
