// Homes in the city (server: crates/social/src/homes.rs): who lives in
// which house or apartment, and renting a free one. Lots look like "b0_3:5"
// (a house) or "apt:2" (a flat above the Market).

import type { Auth } from "./net/api";
import type { Tier } from "./rent";

export interface Resident {
  lot: string;
  owner: string;
  name: string;
}

export class Homes {
  /** Your lot, if you have a home. */
  mine: string | null = null;
  total = 0;
  apartments = 0;
  private byLot = new Map<string, Resident>();
  private listeners: (() => void)[] = [];
  /** The first house tier (set from the rent catalog). */
  cottage: Tier | null = null;

  constructor(private auth: Auth) {}

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  async load() {
    const r = await this.auth.get<{ mine: string | null; total: number; apartments: number; lots: Resident[] }>("/api/social/homes");
    this.mine = r.mine;
    this.total = r.total;
    this.apartments = r.apartments;
    this.byLot = new Map(r.lots.map((l) => [l.lot, l]));
    for (const fn of this.listeners) fn();
  }

  /** Who lives on `lot` (null: it's free). */
  resident(lot: string): Resident | null {
    return this.byLot.get(lot) ?? null;
  }

  /** Free houses (apartments not counted). */
  get free(): number {
    return this.total - [...this.byLot.keys()].filter((l) => !l.startsWith("apt:")).length;
  }

  async claim(lot: string) {
    await this.auth.send("/api/social/homes/claim", { lot });
    await this.load();
  }
}
