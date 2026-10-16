// The Commons Mall's shops (server: crates/api/src/mall.rs): what's on each
// display, and buying it. Coins only.

import type { Applied, Economy } from "./economy";
import type { Auth } from "./net/api";
import type { ZoneMap } from "./world/map";

export interface Shelf {
  slot: number;
  item: number;
  key: string;
  price: number;
}

export interface Dept {
  key: string;
  name: string;
  open: boolean;
  shelves: Shelf[];
}

/** An idempotency key for one press (randomUUID needs a secure context). */
function pressKey(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class Shop {
  depts = new Map<string, Dept>();

  constructor(
    private auth: Auth,
    private eco: Economy,
  ) {}

  async load() {
    const r = await this.auth.get<{ departments: Dept[] }>("/api/mall/stock");
    this.depts = new Map(r.departments.map((d) => [d.key, d]));
  }

  shelf(dept: string, slot: number): Shelf | null {
    return this.depts.get(dept)?.shelves.find((s) => s.slot === slot) ?? null;
  }

  /** Puts what's on each display onto the map's display objects, for drawing. */
  dress(map: ZoneMap) {
    for (const o of map.objects) {
      if ((o.kind !== "display" && o.kind !== "shelf") || !o.label) continue;
      const [dept, slot] = o.label.split(":");
      const s = this.shelf(dept, Number(slot));
      o.item = s?.key;
      o.itemKind = s ? this.eco.items.get(s.item)?.kind : undefined;
    }
  }

  async buy(dept: string, slot: number) {
    this.eco.applyResult(await this.auth.send<Applied>("/api/mall/buy", { dept, slot, key: pressKey() }));
  }
}
