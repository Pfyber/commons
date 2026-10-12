// Seats and game tables derived from the map: mirror of
// server/crates/sim/src/furniture.rs. Ids are tile indices (y * width + x).

import { type ZoneMap, walkable } from "./map";
import type { TileXY } from "./motion";

export interface Seat {
  id: number;
  tile: TileXY;
  table: { id: number; side: "white" | "black" } | null;
}

export interface Table {
  id: number;
  tile: TileXY;
  whiteSeat: number;
  blackSeat: number;
}

export class Furniture {
  readonly seats = new Map<number, Seat>();
  readonly tables = new Map<number, Table>();

  constructor(private map: ZoneMap) {
    const table = map.decor_legend.indexOf("chess_table");
    // Picnic blankets (lie back and watch the stars) and logs round the campfire.
    const seatKinds = new Set(["bench", "swing", "blanket", "log_seat"].map((k) => map.decor_legend.indexOf(k)).filter((i) => i >= 0));
    const w = map.width;
    map.decor.forEach((d, i) => {
      if (seatKinds.has(d)) this.seats.set(i, { id: i, tile: { x: i % w, y: Math.floor(i / w) }, table: null });
    });
    map.decor.forEach((d, i) => {
      if (d !== table || i % w === 0) return;
      const left = this.seats.get(i - 1);
      const right = this.seats.get(i + 1);
      if (!left || !right) return;
      left.table = { id: i, side: "white" };
      right.table = { id: i, side: "black" };
      this.tables.set(i, { id: i, tile: { x: i % w, y: Math.floor(i / w) }, whiteSeat: i - 1, blackSeat: i + 1 });
    });
  }

  idAt(t: TileXY): number {
    return t.y * this.map.width + t.x;
  }

  /** The walkable tile next to `t` closest to `from`, to stand on before sitting. */
  approach(t: TileXY, from: TileXY): TileXY | null {
    let best: TileXY | null = null;
    let bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const c = { x: t.x + dx, y: t.y + dy };
        if (!walkable(this.map, c.x, c.y)) continue;
        // Prefer tiles in front of (below) the seat, then the nearest.
        const d = Math.hypot(c.x - from.x, c.y - from.y) + (dy === 1 ? -0.5 : 0);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }
}
