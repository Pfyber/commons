// Server-driven world props: garden plants, home furniture and fishing
// bobbers. Rendering only; Game decides what to show from server messages.

import { Container, Graphics, Sprite } from "pixi.js";
import type { Economy } from "../economy";
import type { PlotInfo } from "../ui/panels";
import { TILE } from "./art";
import { CAST_SWING_MS } from "./avatars";
import { type Alive, FLAT, PET_SPOTS, TANKS, Tank, alive } from "./housewares";
import { SURFACE_H, TOPS, WALLS } from "./cozyart";
import { groundAt } from "./map";
import { bobberTexture, furnitureTexture, magnetBobberTexture, plantTexture, wetSoilTexture } from "./items";
import { petTexture } from "./pets";
import type { ZoneMap } from "./map";
import type { TileXY } from "./motion";
import type { Scene } from "./scene";

const k = (x: number, y: number) => `${x},${y}`;

interface PlotSprites {
  plant: Sprite;
  wet: Sprite;
  info: PlotInfo;
}

/** A placed piece: its picture, and (for some) a live part, a tank's fish, a pet on it. */
interface Placed {
  sprite: Sprite;
  item: number;
  key: string;
  on: boolean;
  live: Alive | null;
  tank: Tank | null;
  pet: Sprite | null;
  zzz: Graphics | null;
  over: Container | null;
}

export class Props {
  readonly plots = new Map<string, PlotSprites>();
  readonly objects = new Map<string, Placed>();
  /** What stands on the tables (lifted onto their tops). */
  readonly tops = new Map<string, Placed>();
  /** Your pet (its code), curled up on its bed or tree at home (0: none, or not your home). */
  petCode = 0;
  private lastFx = 0;
  private bobbers = new Map<number, { sprite: Sprite; line: Graphics; tile: TileXY; castAt: number; biteAt: number }>();
  /** The map's original collision, to restore when furniture is picked up. */
  private baseCollision: number[];

  constructor(
    private scene: Scene,
    private map: ZoneMap,
    private eco: Economy,
  ) {
    this.baseCollision = map.collision.slice();
  }

  plotAt(x: number, y: number): PlotInfo | null {
    return this.plots.get(k(x, y))?.info ?? null;
  }

  setPlot(x: number, y: number, info: PlotInfo) {
    const key = k(x, y);
    let p = this.plots.get(key);
    if (!info.plant) {
      if (p) {
        p.plant.destroy();
        p.wet.destroy();
        this.plots.delete(key);
      }
      return;
    }
    if (!p) {
      const wet = new Sprite(wetSoilTexture());
      wet.position.set(x * TILE, y * TILE);
      const plant = new Sprite();
      plant.anchor.set(0.5, 1);
      plant.position.set(x * TILE + TILE / 2, y * TILE + TILE);
      plant.zIndex = y * TILE + TILE - 6;
      this.scene.onGround(wet);
      this.scene.sorted.addChild(plant);
      p = { plant, wet, info };
      this.plots.set(key, p);
    }
    p.info = info;
    const key2 = this.eco.items.get(info.plant)?.key ?? "tulip";
    p.plant.texture = plantTexture(key2, info.stage);
    p.wet.visible = info.watered;
  }

  objectAt(x: number, y: number): number | null {
    return this.objects.get(k(x, y))?.item ?? null;
  }

  setObject(x: number, y: number, item: number) {
    const key = k(x, y);
    const old = this.objects.get(key);
    old?.sprite.destroy();
    old?.over?.destroy({ children: true });
    this.objects.delete(key);
    const i = y * this.map.width + x;
    if (!item) {
      this.map.collision[i] = this.baseCollision[i];
      return;
    }
    this.objects.set(key, this.make(x, y, item, 0));
    this.dressPet(this.objects.get(key)!);
    // Furniture blocks walking, as on the server.
    this.map.collision[i] = 1;
  }

  /** What stands on the table at (x, y) (0: taken off): lifted onto its top. */
  setTop(x: number, y: number, item: number) {
    const key = k(x, y);
    const old = this.tops.get(key);
    old?.sprite.destroy();
    old?.over?.destroy({ children: true });
    this.tops.delete(key);
    if (!item) return;
    const under = this.objects.get(key)?.key ?? "";
    this.tops.set(key, this.make(x, y, item, SURFACE_H[under] ?? 12));
  }

  topAt(x: number, y: number): number | null {
    return this.tops.get(k(x, y))?.item ?? null;
  }

  /** How high a table's top is at (x, y) (0: no table there). */
  surfaceAt(x: number, y: number): number {
    return SURFACE_H[this.objects.get(k(x, y))?.key ?? ""] ?? 0;
  }

  /**
   * A piece's picture (and its live part over it): on the floor, lifted
   * `lift` px onto a table, or hung on a wall (drawn over it).
   */
  private make(x: number, y: number, item: number, lift: number): Placed {
    const itemKey = this.eco.items.get(item)?.key ?? "";
    const s = new Sprite(furnitureTexture(itemKey));
    s.anchor.set(0.5, 1);
    s.position.set(x * TILE + TILE / 2, y * TILE + TILE - lift);
    const flat = FLAT.has(itemKey);
    const wall = WALLS.has(itemKey) && this.baseCollision[y * this.map.width + x] !== 0;
    s.zIndex = flat ? y * TILE - 30 : wall ? y * TILE + TILE + 4 : y * TILE + TILE - 2 + (lift ? 1 : 0);
    this.scene.sorted.addChild(s);
    // Its live part (a lamp's glow, the fire, a tank's fish, a pet on its bed), over it.
    const live = alive(itemKey);
    const tank = TANKS[itemKey] ? new Tank(itemKey) : null;
    let over: Container | null = null;
    if (live || tank || PET_SPOTS.has(itemKey)) {
      over = new Container();
      over.position.set(x * TILE, y * TILE - lift);
      over.zIndex = s.zIndex + 0.5;
      if (tank) over.addChild(tank.view);
      if (live) over.addChild(live.view);
      this.scene.sorted.addChild(over);
    }
    return { sprite: s, item, key: itemKey, on: false, live, tank, pet: null, zzz: null, over };
  }

  // ---- placing: a see-through preview under the pointer ----

  private ghost: Sprite | null = null;

  /**
   * Where piece `key` would go at (x, y), as the server will have it: on a
   * wall (with the floor just below), onto a table's top, or on free floor;
   * and whether it may (`lift`: how high a table lifts it).
   */
  placeCheck(x: number, y: number, key: string): { ok: boolean; lift: number } {
    const w = this.map.width;
    if (x < 0 || y < 0 || x >= w || y >= this.map.height) return { ok: false, lift: 0 };
    const here = this.objects.has(k(x, y));
    if (WALLS.has(key)) {
      const below = (y + 1) * w + x;
      const ok = !here && this.baseCollision[y * w + x] !== 0 && y + 1 < this.map.height && this.map.collision[below] === 0 && groundAt(this.map, x, y + 1) === "floor";
      return { ok, lift: 0 };
    }
    const lift = this.surfaceAt(x, y);
    if (TOPS.has(key) && lift) return { ok: !this.tops.has(k(x, y)), lift };
    return { ok: !here && this.map.collision[y * w + x] === 0, lift: 0 };
  }

  /** The preview of `key` at (x, y): see-through, reddened where it can't go. */
  ghostAt(x: number, y: number, key: string) {
    if (!this.ghost) {
      this.ghost = new Sprite();
      this.ghost.anchor.set(0.5, 1);
      this.scene.sorted.addChild(this.ghost);
    }
    const { ok, lift } = this.placeCheck(x, y, key);
    const g = this.ghost;
    g.texture = furnitureTexture(key);
    g.position.set(x * TILE + TILE / 2, y * TILE + TILE - lift);
    g.alpha = ok ? 0.6 : 0.45;
    g.tint = ok ? 0xffffff : 0xff6a6a;
    g.zIndex = 1e8;
    g.visible = true;
  }

  hideGhost() {
    if (this.ghost) this.ghost.visible = false;
  }

  /** The piece you'd use at (x, y): what's on the table there, else what's there. */
  private usedAt(x: number, y: number): Placed | undefined {
    return this.tops.get(k(x, y)) ?? this.objects.get(k(x, y));
  }

  /** A piece turned on or off (ObjectOn). */
  setOn(x: number, y: number, on: boolean) {
    const o = this.usedAt(x, y);
    if (o) o.on = on;
  }

  isOn(x: number, y: number): boolean {
    return this.usedAt(x, y)?.on ?? false;
  }

  /** A tank's fish (TankFish), as item ids. */
  setTank(x: number, y: number, fish: number[]) {
    const o = this.usedAt(x, y);
    if (!o?.tank) return;
    this.tankFish.set(k(x, y), fish);
    o.tank.set(fish.map((f) => this.eco.items.get(f)?.key ?? "minnow"));
  }

  /** What's in the tank at (x, y) (item ids). */
  tankAt(x: number, y: number): number[] {
    return this.tankFish.get(k(x, y)) ?? [];
  }

  private tankFish = new Map<string, number[]>();

  /** Your pet, at home: curled up asleep on its bed / tree (zzz rising), or by its bowl. */
  setPet(code: number) {
    this.petCode = code;
    for (const o of this.objects.values()) this.dressPet(o);
  }

  private dressPet(o: Placed) {
    o.pet?.destroy();
    o.zzz?.destroy();
    o.pet = null;
    o.zzz = null;
    if (!o.over || !PET_SPOTS.has(o.key) || !this.petCode) return;
    // (One spot for it: the first bed or tree; the bowl only if there's neither.)
    const spots = [...this.objects.values()].filter((p) => PET_SPOTS.has(p.key));
    const pick = spots.find((p) => p.key !== "pet_bowl") ?? spots[0];
    if (pick !== o) return;
    const pet = new Sprite(petTexture(this.petCode, 0));
    pet.anchor.set(0.5, 1);
    const tree = o.key === "cat_tree";
    pet.position.set(tree ? 19 : 16, tree ? 6 : 26);
    pet.scale.set(tree ? 0.6 : 0.75);
    o.over.addChild(pet);
    o.pet = pet;
    const zzz = new Graphics();
    o.over.addChild(zzz);
    o.zzz = zzz;
  }

  /** The live pieces: glows and flames, fish swimming, the pet breathing. */
  private furnitureFx(now: number) {
    const dt = this.lastFx ? Math.min(50, now - this.lastFx) / 16.7 : 1;
    this.lastFx = now;
    for (const o of [...this.objects.values(), ...this.tops.values()]) {
      o.live?.update(now, o.on);
      o.tank?.update(now, dt);
      if (o.pet && o.zzz) {
        o.pet.scale.y = Math.abs(o.pet.scale.x) * (1 + Math.sin(now / 700) * 0.04);
        const t = (now / 2200) % 1;
        o.zzz.clear();
        const zx = o.pet.x + 6 + t * 6;
        const zy = o.pet.y - 18 - t * 12;
        o.zzz.moveTo(zx, zy).lineTo(zx + 3, zy).lineTo(zx, zy + 3).lineTo(zx + 3, zy + 3).stroke({ color: 0xffffff, width: 1, alpha: 1 - t });
      }
    }
  }

  /** A line cast at `tile` (its bobber floating there), or the salvage magnet (`magnet`) dangling in instead. */
  cast(avatarId: number, tile: TileXY, magnet = false) {
    this.reelIn(avatarId);
    const s = new Sprite(magnet ? magnetBobberTexture() : bobberTexture());
    s.anchor.set(0.5, 1);
    s.position.set(tile.x * TILE + TILE / 2, tile.y * TILE + TILE / 2 + 4);
    s.zIndex = tile.y * TILE + TILE / 2;
    // Lands when the rod's swing ends.
    s.visible = false;
    const line = new Graphics();
    this.scene.sorted.addChild(s, line);
    this.bobbers.set(avatarId, { sprite: s, line, tile, castAt: performance.now(), biteAt: 0 });
  }

  bite(avatarId: number) {
    const b = this.bobbers.get(avatarId);
    if (b) b.biteAt = performance.now();
  }

  reelIn(avatarId: number) {
    const b = this.bobbers.get(avatarId);
    b?.sprite.destroy();
    b?.line.destroy();
    this.bobbers.delete(avatarId);
  }

  /** `rodTip` gives where an angler's rod tip is this frame, for the line. */
  update(now: number, rodTip: (avatarId: number) => { x: number; y: number; z: number } | null) {
    this.furnitureFx(now);
    for (const [id, b] of this.bobbers) {
      const base = b.tile.y * TILE + TILE / 2 + 4;
      const biting = b.biteAt && now - b.biteAt < 2500;
      const dy = biting ? Math.abs(Math.sin(now / 60)) * 5 : Math.sin(now / 500) * 1;
      b.sprite.y = base + dy;
      b.sprite.visible = now - b.castAt >= CAST_SWING_MS;
      const g = b.line.clear();
      const tip = rodTip(id);
      if (!tip || !b.sprite.visible) continue;
      // From the rod tip to the top of the bobber, sagging unless a fish pulls it taut.
      const ex = b.sprite.x;
      const ey = b.sprite.y - 8;
      const sag = biting ? 1 : 7;
      g.moveTo(tip.x, tip.y)
        .quadraticCurveTo((tip.x + ex) / 2, Math.max(tip.y, ey) + sag, ex, ey)
        .stroke({ width: 1, color: 0xf2f2f2, alpha: 0.85 });
      b.line.zIndex = Math.max(tip.z, b.sprite.zIndex) + 0.2;
    }
  }
}
