// Pets (server: crates/api/src/pets.rs): every pet in the city, where it
// lives and whether it's had its walk today, and taking yours out or home.

import type { Auth } from "./net/api";

export interface Pet {
  owner: string;
  owner_name: string;
  name: string;
  /** Its catalogue item (species and coat). */
  item: number;
  /** The house it lives at (null: its owner has no house just now). */
  plot: string | null;
  /** Out on a walk. */
  out: boolean;
  walked_today: boolean;
  walks: number;
}

export class Pets {
  all: Pet[] = [];
  /** How long a walk has to be to count. */
  walkSecs = 180;
  /** When the current walk started (ms, this browser), if yours is out.
   * A walk found already out (after a reload) is taken as starting then. */
  outSince = 0;
  private listeners = new Set<() => void>();

  constructor(private auth: Auth) {}

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private changed() {
    for (const f of this.listeners) f();
  }

  get mine(): Pet | null {
    const me = this.auth.player?.id;
    return this.all.find((p) => p.owner === me) ?? null;
  }

  /** A walker's pet, by their name. */
  ofName(name: string): Pet | null {
    return this.all.find((p) => p.owner_name === name) ?? null;
  }

  async load() {
    const r = await this.auth.get<{ pets: Pet[]; walk_secs: number }>("/api/pets");
    this.all = r.pets;
    this.walkSecs = r.walk_secs;
    const mine = this.mine;
    if (mine?.out && !this.outSince) this.outSince = Date.now();
    if (!mine?.out) this.outSince = 0;
    this.changed();
  }

  /** Takes your pet out (or home). Home: whether that counted as today's walk. */
  async walk(out: boolean): Promise<boolean> {
    const r = await this.auth.send<{ pet: Pet; walked: boolean }>("/api/me/pet/walk", { out });
    this.all = [...this.all.filter((p) => p.owner !== r.pet.owner), r.pet];
    this.outSince = out ? this.outSince || Date.now() : 0;
    this.changed();
    return r.walked;
  }
}
