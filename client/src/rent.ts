// Renting (server: crates/social/src/rent.rs, stalls.rs): your home and
// stall leases, what each tier costs, and the market stalls.

import type { Auth } from "./net/api";

export interface Tier {
  tier: number;
  name: string;
  rent: number;
  furniture?: number;
  listings?: number;
}

export interface Lease {
  id: number;
  kind: "home" | "apartment" | "stall";
  plot: string;
  tier: number;
  tier_name: string;
  rent: number;
  furniture?: number | null;
  listings?: number | null;
  /** Unix seconds. */
  paid_until: number;
  grace_until: number | null;
  state: "active" | "grace";
}

export interface Goods {
  id: number;
  item: number;
  qty: number;
  price: number;
}

/** A house's yard stand (by its front door): whose, and what's on it. */
export interface Yard {
  lot: string;
  owner: string;
  name: string;
  mine: boolean;
  /** How many things it holds (the house's tier). */
  listings: number | null;
  goods: Goods[];
}

export interface Stall {
  stall: string;
  owner: string;
  name: string;
  mine: boolean;
  lease: Lease;
  goods: Goods[];
}

/** An idempotency key for one action (randomUUID needs a secure context). */
function key(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class Rent {
  home: Lease | null = null;
  stall: Lease | null = null;
  furnitureUsed = 0;
  kinds: Record<string, { name: string; tiers: Tier[] }> = {};
  stalls: Stall[] = [];
  /** Yard stands with something on them (and yours, even empty). */
  yards: Yard[] = [];
  private listeners: (() => void)[] = [];

  constructor(private auth: Auth) {}

  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  async load() {
    const r = await this.auth.get<{ home: Lease | null; stall: Lease | null; furniture_used: number; kinds: Rent["kinds"] }>("/api/social/rent");
    this.home = r.home;
    this.stall = r.stall;
    this.furnitureUsed = r.furniture_used;
    this.kinds = r.kinds;
    this.changed();
  }

  async loadStalls() {
    this.stalls = (await this.auth.get<{ stalls: Stall[] }>("/api/social/stalls")).stalls;
    this.changed();
  }

  tiers(kind: string): Tier[] {
    return this.kinds[kind]?.tiers ?? [];
  }

  async loadYards() {
    this.yards = (await this.auth.get<{ yards: Yard[] }>("/api/social/yards")).yards;
    this.changed();
  }

  /** `lot`'s yard stand, if it has anything on it (or it's yours). */
  yardAt(lot: string): Yard | null {
    return this.yards.find((y) => y.lot === lot) ?? null;
  }

  /** Who has `stall` (null: it's free). */
  stallAt(stall: string): Stall | null {
    return this.stalls.find((s) => s.stall === stall) ?? null;
  }

  private async post(path: string, body: unknown) {
    const r = await this.auth.send(path, body);
    await Promise.all([this.load(), this.loadStalls(), this.loadYards()]);
    return r;
  }

  changeTier(slot: "home" | "stall", tier: number) {
    return this.post("/api/social/rent/tier", { slot, tier });
  }

  pay(slot: "home" | "stall") {
    return this.post("/api/social/rent/pay", { slot });
  }

  end(slot: "home" | "stall") {
    return this.post("/api/social/rent/end", { slot });
  }

  claimStall(stall: string, tier = 1) {
    return this.post("/api/social/stalls/claim", { stall, tier });
  }

  /** Puts goods on your market stall, or (`at` "yard") your house's yard stand. */
  put(item: number, qty: number, price: number, at: "stall" | "yard" = "stall") {
    return this.post("/api/social/stalls/put", { item, qty, price, key: key(), at });
  }

  take(id: number) {
    return this.post("/api/social/stalls/take", { id });
  }

  buy(id: number, qty: number) {
    return this.post("/api/social/stalls/buy", { id, qty, key: key() });
  }
}

/** "Paid until Thu 23 Oct", or how long is left to pay. */
export function leaseStatus(l: Lease): string {
  const day = (s: number) => new Date(s * 1000).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  if (l.state === "grace" && l.grace_until) return `Rent is due: pay ${l.rent} coins by ${day(l.grace_until)}, or the lease ends (nothing inside is lost).`;
  return `${l.rent} coins a week · paid until ${day(l.paid_until)}`;
}
