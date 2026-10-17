// The Commons Mall's shops (server: crates/api/src/mall.rs): what's on each
// display this week (stock rotates; some items are limited), the seasonal
// pop-up, and buying. Coins only.

import type { Applied, Economy } from "./economy";
import type { Auth } from "./net/api";
import type { ZoneMap } from "./world/map";

export interface Shelf {
  slot: number;
  item: number;
  key: string;
  price: number;
  /** How many go round each week, if limited. */
  limited: number | null;
  /** How many are left this week, if limited. */
  left: number | null;
  /** Not on show last week. */
  new: boolean;
}

export interface Dept {
  key: string;
  name: string;
  open: boolean;
  shelves: Shelf[];
  /** The pop-up: the season on now ("to" is MM-DD), and the next one. */
  event?: { name: string; to: string };
  next?: { name: string; from: string };
}

/** An idempotency key for one press (randomUUID needs a secure context). */
function pressKey(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class Shop {
  depts = new Map<string, Dept>();
  rotation = 0;
  /** When the shelves change next (unix seconds). */
  endsAt = 0;

  constructor(
    private auth: Auth,
    private eco: Economy,
  ) {}

  async load() {
    const r = await this.auth.get<{ rotation: number; ends_at: number; departments: Dept[] }>("/api/mall/stock");
    this.depts = new Map(r.departments.map((d) => [d.key, d]));
    this.rotation = r.rotation;
    this.endsAt = r.ends_at;
  }

  shelf(dept: string, slot: number): Shelf | null {
    return this.depts.get(dept)?.shelves.find((s) => s.slot === slot) ?? null;
  }

  /** Puts what's on each display onto the map's display objects, for drawing. */
  dress(map: ZoneMap) {
    for (const o of map.objects) {
      if ((o.kind !== "display" && o.kind !== "shelf" && o.kind !== "mannequin") || !o.label) continue;
      const [dept, slot] = o.label.split(":");
      const s = this.shelf(dept, Number(slot));
      o.item = s?.key;
      o.itemKind = s ? this.eco.items.get(s.item)?.kind : undefined;
      o.isNew = s?.new ?? false;
    }
  }

  /** What's new on show this week, by shop. */
  newThisWeek(): { dept: string; items: number[] }[] {
    return [...this.depts.values()]
      .map((d) => ({ dept: d.name, items: [...new Set(d.shelves.filter((s) => s.new).map((s) => s.item))] }))
      .filter((x) => x.items.length);
  }

  async buy(dept: string, slot: number) {
    try {
      this.eco.applyResult(await this.auth.send<Applied>("/api/mall/buy", { dept, slot, key: pressKey() }));
    } finally {
      // Limited counts (and, at the turn of the week, the shelves) change.
      await this.load().catch(() => {});
    }
  }
}
