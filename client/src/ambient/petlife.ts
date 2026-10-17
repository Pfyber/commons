// Pets about the city (ADR 0011, M5). Pets at home wait in their yard by
// the front door (hoping for a walk, if they haven't had one today); pets
// out on a walk trot at their walker's heels (drawn by the walker's avatar).
// Pets that meet sniff hello, hearts all round. Bringing yours back to your
// door after a proper walk takes it home: that's its walk for the day.

import type { Economy } from "../economy";
import type { Pet, Pets } from "../pets";
import type { Avatar } from "../world/avatars";
import { type ZoneMap, nearestWalkable, spot } from "../world/map";
import type { TileXY } from "../world/motion";
import { PET_SOUNDS, PetSprite } from "../world/pets";
import type { Scene } from "../world/scene";

export interface PetHost {
  self(): Avatar | undefined;
  avatars(): Iterable<Avatar>;
  toast(text: string, ms?: number): void;
  /** Asks the zone to show the pet with us (or not) to everyone. */
  refreshLook(): void;
}

/** Pets this close sniff hello. */
const MEET_TILES = 1.8;
/** And not again for a while. */
const MEET_AGAIN_MS = 60_000;

/** The pet's code (species and coat) from its item. */
export function petCode(eco: Economy, item: number): number {
  return eco.items.get(item)?.meta.code ?? 0;
}

/** "Biscuit, Zoe's golden puppy". */
export function petTitle(eco: Economy, p: Pet, mine: boolean): string {
  const kind = (eco.items.get(p.item)?.name ?? "pet").toLowerCase();
  return mine ? `${p.name}, your ${kind}` : `${p.name}, ${p.owner_name}'s ${kind}`;
}

export class PetLife {
  /** Pets at home in their yards, by owner. */
  private yard = new Map<string, { pet: Pet; sprite: PetSprite }>();
  private met = new Map<string, number>();
  private checkAt = 0;
  private ending = false;
  private off: () => void;

  constructor(
    private scene: Scene,
    private map: ZoneMap,
    private pets: Pets,
    private eco: Economy,
    private host: PetHost,
    /** Only the city has yards. */
    private yards: boolean,
  ) {
    this.off = pets.onChange(() => this.sync());
    this.sync();
  }

  /** Where a house's pet waits: by the front door. */
  private yardSpot(plot: string): TileXY | null {
    const door = spot(this.map, `door:${plot}`);
    return door && nearestWalkable(this.map, door.x - 2, door.y, 1);
  }

  private sync() {
    const want = new Map<string, Pet>();
    if (this.yards) for (const p of this.pets.all) if (p.plot && !p.out) want.set(p.owner, p);
    for (const [owner, y] of this.yard) {
      const p = want.get(owner);
      if (!p || p.plot !== y.pet.plot || p.item !== y.pet.item) {
        y.sprite.destroy();
        this.yard.delete(owner);
      }
    }
    for (const [owner, p] of want) {
      const at = p.plot ? this.yardSpot(p.plot) : null;
      if (!at) continue;
      let y = this.yard.get(owner);
      if (!y) {
        y = { pet: p, sprite: new PetSprite(petCode(this.eco, p.item), at) };
        this.scene.sorted.addChild(y.sprite.view);
        this.yard.set(owner, y);
      }
      y.pet = p;
      y.sprite.hopeful = !p.walked_today;
    }
  }

  /** The pet at home in a yard at tile (x, y) (fractional), if any. */
  yardPetAt(x: number, y: number): Pet | null {
    for (const { pet, sprite } of this.yard.values()) if (sprite.hit(x, y)) return pet;
    return null;
  }

  /** A walker whose pet is at tile (x, y) (fractional). */
  walkerAt(x: number, y: number): Avatar | null {
    for (const a of this.host.avatars()) if (a.pet?.hit(x, y)) return a;
    return null;
  }

  /** Hearts over a yard pet (a pat). */
  patYard(owner: string) {
    this.yard.get(owner)?.sprite.greet(performance.now());
  }

  /** Takes your pet out for a walk. */
  async takeOut(): Promise<void> {
    const p = this.pets.mine;
    if (!p) return;
    await this.pets.walk(true);
    this.host.refreshLook();
    const sound = PET_SOUNDS[petCode(this.eco, p.item) & 0xff]?.[0] ?? "";
    this.host.toast(`🐾 ${sound} ${p.name} is out for a walk with you. Show them the city, then bring them back to your door.`, 6000);
  }

  /** Brings your pet home (from anywhere): today's walk if it was long enough. */
  async bringHome(): Promise<void> {
    const p = this.pets.mine;
    if (!p?.out || this.ending) return;
    this.ending = true;
    try {
      const had = p.walked_today;
      const walked = await this.pets.walk(false);
      this.host.refreshLook();
      const now = this.pets.mine;
      const n = now?.walks ?? 1;
      if (walked) this.host.toast(`🐾 What a walk! ${p.name} is happy and tired. (${n === 1 ? "Your first walk together!" : `${n} walks together`})`, 5000);
      else if (had) this.host.toast(`🐾 ${p.name} had a lovely time and is home again.`, 4000);
      else this.host.toast(`🐾 ${p.name} is home. A longer walk counts as today's walk.`, 4500);
    } finally {
      this.ending = false;
    }
  }

  update(now: number) {
    for (const { sprite } of this.yard.values()) sprite.draw(now, false, true);
    if (now < this.checkAt) return;
    this.checkAt = now + 400;
    this.meetings(now);
    // Home at your own door after a proper walk.
    const self = this.host.self();
    const mine = this.pets.mine;
    if (this.yards && self && mine?.out && mine.plot && !self.moving && this.pets.outSince) {
      const door = spot(this.map, `door:${mine.plot}`);
      const long = Date.now() - this.pets.outSince >= this.pets.walkSecs * 1000;
      if (door && long && Math.max(Math.abs(self.pos.x - door.x), Math.abs(self.pos.y - door.y)) <= 2) void this.bringHome();
    }
  }

  /** Pets near each other say hello. */
  private meetings(now: number) {
    const self = this.host.self();
    const out: { id: string; sprite: PetSprite; pet: Pet | null; mine: boolean; walker: string }[] = [];
    for (const a of this.host.avatars()) {
      if (a.pet) out.push({ id: `w:${a.info.name}`, sprite: a.pet, pet: this.pets.ofName(a.info.name), mine: a === self, walker: a.info.name });
    }
    for (const [owner, y] of this.yard) out.push({ id: `y:${owner}`, sprite: y.sprite, pet: y.pet, mine: false, walker: "" });
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (a.id.startsWith("y:") && b.id.startsWith("y:")) continue;
        if (Math.hypot(a.sprite.pos.x - b.sprite.pos.x, a.sprite.pos.y - b.sprite.pos.y) > MEET_TILES) continue;
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if ((this.met.get(key) ?? 0) > now) continue;
        this.met.set(key, now + MEET_AGAIN_MS);
        a.sprite.greet(now);
        b.sprite.greet(now);
        const [me, them] = a.mine ? [a, b] : b.mine ? [b, a] : [null, null];
        if (me && them) {
          const mine = me.pet?.name ?? "Your pet";
          const other = them.pet?.name ?? "another pet";
          const whose = them.walker ? ` Say hi to ${them.walker}?` : them.pet ? ` (${them.pet.owner_name}'s, at home in the yard.)` : "";
          this.host.toast(`🐾 ${mine} and ${other} sniff hello.${whose}`, 4500);
        }
      }
    }
  }

  destroy() {
    this.off();
    for (const { sprite } of this.yard.values()) sprite.destroy();
    this.yard.clear();
  }
}
