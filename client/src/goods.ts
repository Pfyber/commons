// The last mall shops' goods (server: crates/api/src/goods.rs): the rod and
// watering can you use, the instruments and toys you own, and how houses
// look outside.

import type { Economy, Item } from "./economy";
import type { Auth } from "./net/api";

/** A house done up outside: slot → the item's code. */
export type HouseLooks = Partial<Record<"facade" | "fence" | "yard" | "postbox", number>>;

export const EXTERIOR_SLOTS: { slot: keyof HouseLooks; name: string }[] = [
  { slot: "facade", name: "Paint" },
  { slot: "fence", name: "Fence" },
  { slot: "yard", name: "In the yard" },
  { slot: "postbox", name: "Postbox" },
];

export class Goods {
  /** House plot → how it looks. */
  houses = new Map<string, HouseLooks>();
  private listeners = new Set<() => void>();

  constructor(
    private auth: Auth,
    private eco: Economy,
  ) {}

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private changed() {
    for (const f of this.listeners) f();
  }

  /** Owned items of `kind`. */
  owned(kind: string): Item[] {
    return this.eco.ofKind(kind).filter((i) => this.eco.qty(i.id) > 0);
  }

  /** Jam instruments you own (their codes). */
  instruments(): Set<number> {
    return new Set(this.owned("instrument").map((i) => i.meta.code ?? 0));
  }

  /** Puts a tool in use (or, with `off`, back to the plain one). Returns the new tool byte. */
  async useTool(it: Item, off = false): Promise<number> {
    const r = await this.auth.send<{ tool: number }>("/api/me/tool", { hand: it.meta.tool, item: off ? 0 : it.id });
    return r.tool;
  }

  async loadHouses() {
    const r = await this.auth.get<{ houses: { plot: string; looks: HouseLooks }[] }>("/api/exteriors");
    this.houses = new Map(r.houses.map((h) => [h.plot, h.looks]));
    this.changed();
  }

  /** Does your house up (`item` 0: back to plain); `plot` is your house. */
  async setExterior(plot: string, slot: string, item: number) {
    const r = await this.auth.send<{ house: { plot: string; looks: HouseLooks } | null }>("/api/me/exterior", { slot, item });
    if (r.house) this.houses.set(r.house.plot, r.house.looks);
    else this.houses.delete(plot);
    this.changed();
  }
}
