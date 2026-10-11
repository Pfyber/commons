// Client view of the economy: the catalogue, the player's inventory and
// album. The server is authoritative; this mirrors it from API responses and
// the zone server's `Granted` messages.

import type { Auth } from "./net/api";

export interface Item {
  id: number;
  key: string;
  kind: "currency" | "fish" | "junk" | "seed" | "plant" | "furniture" | string;
  name: string;
  rarity: number;
  meta: { sell?: number; buy?: number; grows?: number; seed?: number; night?: boolean };
}

export interface AlbumEntry {
  item: number;
  total: number;
  first_at: number;
}

interface Applied {
  duplicate: boolean;
  totals: [number, number][];
  added: [number, number][];
  firsts: number[];
}

export const COIN = 1;

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
    for (const it of cat.items) this.items.set(it.id, it);
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

  private applyResult(r: Applied) {
    for (const [item, qty] of r.totals) this.inventory.set(item, qty);
    this.emit();
  }

  async sell(item: number, qty: number) {
    this.applyResult(await this.auth.send<Applied>("/api/market/sell", { item, qty, key: crypto.randomUUID() }));
  }

  async buy(item: number, qty: number) {
    this.applyResult(await this.auth.send<Applied>("/api/market/buy", { item, qty, key: crypto.randomUUID() }));
  }

  /** Today's small gift, if not yet collected. */
  async daily(): Promise<{ item: number; qty: number } | null> {
    const r = await this.auth.send<{ granted: { item: number; qty: number } | null }>("/api/daily", {});
    if (r.granted) await this.load();
    return r.granted;
  }
}
