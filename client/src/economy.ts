// Client view of the economy: the catalogue, the player's inventory and
// album. The server is authoritative; this mirrors it from API responses and
// the zone server's `Granted` messages.

import type { Auth } from "./net/api";
import { COSMETIC_CODES, ITEM_META } from "./world/items";

export interface Item {
  id: number;
  key: string;
  kind: "currency" | "fish" | "junk" | "seed" | "plant" | "furniture" | string;
  name: string;
  rarity: number;
  meta: {
    sell?: number;
    buy?: number;
    grows?: number;
    seed?: number;
    night?: boolean;
    code?: number;
    account_bound?: boolean;
    /** Tools: which hand (`rod`, `can`). Home exterior: which part of the house. */
    tool?: string;
    slot?: string;
    /** The fisherman's prices, and how often a fish bites. */
    weight?: number;
    coins?: number;
  };
}

export interface AlbumEntry {
  item: number;
  total: number;
  first_at: number;
}

export interface Applied {
  duplicate: boolean;
  totals: [number, number][];
  added: [number, number][];
  firsts: number[];
}

export const COIN = 1;
/** The arcade's tickets (protocol `arcade::TICKET`). */
export const TICKET = 900;

export class Economy {
  readonly items = new Map<number, Item>();
  readonly inventory = new Map<number, number>();
  album = new Map<number, AlbumEntry>();
  private listeners = new Set<() => void>();

  constructor(private auth: Auth) {}

  async load() {
    const [cat, inv] = await Promise.all([
      this.auth.get<{ items: Item[] }>("/api/catalog"),
      this.auth.get<{ items: { item: number; qty: number }[] }>("/api/inventory"),
    ]);
    for (const it of cat.items) {
      this.items.set(it.id, it);
      if (it.meta.code) COSMETIC_CODES.set(it.key, it.meta.code);
      ITEM_META.set(it.key, it.meta);
    }
    this.inventory.clear();
    for (const s of inv.items) this.inventory.set(s.item, s.qty);
    this.emit();
  }

  async loadAlbum() {
    const r = await this.auth.get<{ entries: AlbumEntry[] }>("/api/album");
    this.album = new Map(r.entries.map((e) => [e.item, e]));
    this.emit();
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit() {
    for (const f of this.listeners) f();
  }

  qty(item: number): number {
    return this.inventory.get(item) ?? 0;
  }

  get coins(): number {
    return this.qty(COIN);
  }

  name(item: number): string {
    return this.items.get(item)?.name ?? "something";
  }

  ofKind(...kinds: string[]): Item[] {
    return [...this.items.values()].filter((i) => kinds.includes(i.kind));
  }

  /** From a zone `Granted` message. */
  setTotal(item: number, total: number, first: boolean) {
    this.inventory.set(item, total);
    if (first && !this.album.has(item)) this.album.set(item, { item, total: 1, first_at: Date.now() / 1000 });
    this.emit();
  }

  /** Takes new totals from any economy response. */
  applyResult(r: Pick<Applied, "totals">) {
    for (const [item, qty] of r.totals) this.inventory.set(item, qty);
    this.emit();
  }

  async sell(item: number, qty: number) {
    this.applyResult(await this.auth.send<Applied>("/api/market/sell", { item, qty, key: crypto.randomUUID() }));
  }

  async buy(item: number, qty: number) {
    this.applyResult(await this.auth.send<Applied>("/api/market/buy", { item, qty, key: crypto.randomUUID() }));
  }

  /** The arcade's prize shelf: each prize's item and price in tickets (`once`: kept for good, won once). */
  async prizes(): Promise<{ item: number; tickets: number; once: boolean }[]> {
    return (await this.auth.get<{ prizes: { item: number; tickets: number; once: boolean }[] }>("/api/arcade/prizes")).prizes;
  }

  /** The arcade's prize counter: tickets for a prize. */
  async redeem(item: number) {
    this.applyResult((await this.auth.send<{ applied: Applied }>("/api/arcade/redeem", { item, key: crypto.randomUUID() })).applied);
  }

  /** Today's small gift, if not yet collected. */
  async daily(): Promise<{ item: number; qty: number } | null> {
    const r = await this.auth.send<{ granted: { item: number; qty: number } | null }>("/api/daily", {});
    if (r.granted) await this.load();
    return r.granted;
  }
}
