// Server-driven world props: garden plants, home furniture and fishing
// bobbers. Rendering only; Game decides what to show from server messages.

import { Container, Graphics, Sprite } from "pixi.js";
import type { Economy } from "../economy";
import type { PlotInfo } from "../ui/panels";
import { TILE } from "./art";
import { CAST_SWING_MS } from "./avatars";
import { type Alive, FLAT, HUNGRY_SECS, LIGHTS, PET_SPOTS, TANKS, WALK_OVER, TURNS_FLAT, Tank, alive } from "./housewares";
import { SURFACE_H, TOPS, WALLS } from "./cozyart";
import { groundAt } from "./map";
import { pondTexture } from "./roomskin";
import { bobberTexture, furnitureTexture, itemTexture, magnetBobberTexture, plantTexture, wetSoilTexture } from "./items";
import { petTexture } from "./pets";
import type { ZoneMap } from "./map";
import type { TileXY } from "./motion";
import type { Scene } from "./scene";

const k = (x: number, y: number) => `${x},${y}`;

const POND = "round_pond";
/** A garden pond's tiles, from its top left. */
const pondTiles = (x: number, y: number): [number, number][] => [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];

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
  /** A display shelf's things, and the light it's giving. */
  shelf: Container | null;
  glow: Sprite | null;
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
  /** How lights reach the room (the day and night's light layer). */
  lightUp: { add: (x: number, y: number, color: number, scale: number) => Sprite; lit: (n: number) => void } | null = null;
  /** Outdoors: where a piece may go (your own front yard). */
  yardRule: ((x: number, y: number) => boolean) | null = null;
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
      plant.zIndex = y * TILE + TILE - 1;
      this.scene.onGround(wet);
      this.scene.sorted.addChild(plant);
      p = { plant, wet, info };
      this.plots.set(key, p);
    }
    p.info = info;
    const key2 = this.eco.items.get(info.plant)?.key ?? "tulip";
    p.plant.texture = plantTexture(key2, info.stage);
    p.wet.visible = info.watered;
    this.seatPlant(x, y);
  }

  /** What grows in a planter stands in its soil, not on the floor. */
  private seatPlant(x: number, y: number) {
    const p = this.plots.get(k(x, y));
    if (!p) return;
    const potted = this.objects.get(k(x, y))?.key === "planter_pot";
    p.plant.y = y * TILE + TILE - (potted ? 16 : 0);
    if (potted) p.wet.visible = false;
  }

  /** The garden pond's water at (x, y), as its top left tile. */
  pondAt(x: number, y: number): TileXY | null {
    const at = this.pondWater.get(k(x, y));
    if (!at) return null;
    const [ax, ay] = at.split(",").map(Number);
    return { x: ax, y: ay };
  }

  private pondWater = new Map<string, string>();
  /** What the ground was under each pond's tiles. */
  private pondWas = new Map<number, number>();

  objectAt(x: number, y: number): number | null {
    return this.objects.get(k(x, y))?.item ?? null;
  }

  setObject(x: number, y: number, item: number, rot = 0) {
    const key = k(x, y);
    const old = this.objects.get(key);
    this.clear(old);
    this.objects.delete(key);
    if (old?.key === POND) {
      for (const [px, py] of pondTiles(x, y)) {
        const at = py * this.map.width + px;
        this.map.collision[at] = this.baseCollision[at];
        this.map.ground[at] = this.pondWas.get(at) ?? this.map.ground[at];
        this.pondWater.delete(k(px, py));
      }
      this.scene.repaintAt(x, y, x + 1, y + 1);
    }
    const i = y * this.map.width + x;
    if (!item) {
      this.map.collision[i] = this.baseCollision[i];
      return;
    }
    this.objects.set(key, this.make(x, y, item, 0, rot));
    if (this.objects.get(key)!.key === POND) {
      // Plain water, like any pond: it's baked into the ground, corners rounded off.
      for (const [px, py] of pondTiles(x, y)) {
        const at = py * this.map.width + px;
        this.map.collision[at] = 1;
        if (!this.pondWater.has(k(px, py))) this.pondWas.set(at, this.map.ground[at]);
        this.map.ground[at] = this.map.ground_legend.indexOf("water");
        this.pondWater.set(k(px, py), key);
      }
      this.scene.repaintAt(x, y, x + 1, y + 1);
      return;
    }
    this.dressPet(this.objects.get(key)!);
    this.seatPlant(x, y);
    this.shine(x, y, this.objects.get(key)!);
    // Furniture blocks walking, as on the server (rugs are walked over).
    this.map.collision[i] = WALK_OVER.has(this.objects.get(key)!.key) ? this.baseCollision[i] : 1;
  }

  /** What stands on the table at (x, y) (0: taken off): lifted onto its top. */
  setTop(x: number, y: number, item: number, rot = 0) {
    const key = k(x, y);
    this.clear(this.tops.get(key));
    this.tops.delete(key);
    if (!item) return;
    const under = this.objects.get(key)?.key ?? "";
    this.tops.set(key, this.make(x, y, item, SURFACE_H[under] ?? 12, rot));
  }

  private clear(o: Placed | undefined) {
    if (!o) return;
    o.sprite.destroy();
    o.over?.destroy({ children: true });
    if (o.glow) {
      o.glow.destroy();
      o.glow = null;
      this.countLit();
    }
  }

  /**
   * Turns a sprite: mirrored (2), or side on (1 and 3): what lies flat
   * rotates, what stands is drawn foreshortened, as it would look on a side
   * wall or facing along the room.
   */
  private turn(s: Sprite, key: string, rot: number, wallSide: boolean) {
    s.rotation = 0;
    s.skew.set(0, 0);
    s.scale.set(1);
    if (rot === 2) s.scale.x = -1;
    if (rot !== 1 && rot !== 3) return;
    const dir = rot === 1 ? 1 : -1;
    if (!wallSide && (FLAT.has(key) || TURNS_FLAT.test(key))) {
      s.anchor.set(0.5);
      s.y -= TILE / 2;
      s.rotation = (dir * Math.PI) / 2;
    } else {
      s.scale.x = 0.62 * dir;
      s.skew.y = 0.38 * dir;
    }
  }

  /** A light's pool on the room, while it's on. */
  private shine(x: number, y: number, o: Placed) {
    const light = LIGHTS[o.key];
    const on = o.on || o.key === "uv_light";
    if (!this.lightUp || !light || !!o.glow === on) return;
    if (on) o.glow = this.lightUp.add(x * TILE + TILE / 2, y * TILE + TILE / 2, light[0], light[1]);
    else {
      o.glow?.destroy();
      o.glow = null;
    }
    this.countLit();
  }

  private countLit() {
    this.lightUp?.lit([...this.objects.values(), ...this.tops.values()].filter((o) => o.glow).length);
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
  private make(x: number, y: number, item: number, lift: number, rot = 0): Placed {
    const itemKey = this.eco.items.get(item)?.key ?? "";
    const isPond = itemKey === POND;
    const s = new Sprite(furnitureTexture(itemKey));
    s.anchor.set(0.5, 1);
    s.position.set(x * TILE + TILE / 2, y * TILE + TILE - lift);
    if (isPond) {
      // (It's in the ground itself: nothing stands there.)
      s.visible = false;
      this.scene.sorted.addChild(s);
      return { sprite: s, item, key: itemKey, on: false, live: null, tank: null, shelf: null, glow: null, pet: null, zzz: null, over: null };
    }
    const flat = FLAT.has(itemKey);
    const wall = WALLS.has(itemKey) && this.baseCollision[y * this.map.width + x] !== 0;
    const side = wall && (rot === 1 || rot === 3);
    this.turn(s, itemKey, rot, side);
    // Side on, it hangs on the face of the wall, towards the room.
    if (side) s.position.set(x * TILE + (rot === 1 ? TILE + 3 : -3), y * TILE + TILE - 6);
    if (flat) this.scene.layOnGround(s);
    s.zIndex = flat ? y * TILE - 30 : wall ? y * TILE + TILE + 4 : y * TILE + TILE - 2 + (lift ? 1 : 0);
    this.scene.sorted.addChild(s);
    // Its live part (a lamp's glow, the fire, a tank's fish, a pet on its bed), over it.
    const live = alive(itemKey);
    const isShelf = itemKey === "display_shelf";
    const tank = TANKS[itemKey] && !isShelf ? new Tank(itemKey) : null;
    const shelf = isShelf ? new Container() : null;
    let over: Container | null = null;
    if (live || tank || shelf || PET_SPOTS.has(itemKey)) {
      over = new Container();
      over.position.set(x * TILE, y * TILE - lift);
      over.zIndex = s.zIndex + 0.5;
      if (tank) over.addChild(tank.view);
      if (shelf) over.addChild(shelf);
      if (live) over.addChild(live.view);
      this.scene.sorted.addChild(over);
    }
    return { sprite: s, item, key: itemKey, on: false, live, tank, shelf, glow: null, pet: null, zzz: null, over };
  }

  // ---- placing: a see-through preview under the pointer ----

  private ghost: Sprite | null = null;

  /**
   * Where piece `key` would go at (x, y), as the server will have it: on a
   * wall (with the floor just below), onto a table's top, or on free floor;
   * and whether it may (`lift`: how high a table lifts it).
   */
  placeCheck(x: number, y: number, key: string, rot = 0): { ok: boolean; lift: number } {
    const w = this.map.width;
    if (x < 0 || y < 0 || x >= w || y >= this.map.height) return { ok: false, lift: 0 };
    if (key === POND) {
      const free = ([px, py]: [number, number]) => !!this.yardRule?.(px, py) && px < w && py < this.map.height && !this.objects.has(k(px, py)) && this.map.collision[py * w + px] === 0;
      return { ok: pondTiles(x, y).every(free), lift: 0 };
    }
    // (A lawn chair goes down anywhere out in the city.)
    if (this.yardRule && !this.yardRule(x, y) && key !== "lawn_chair") return { ok: false, lift: 0 };
    const here = this.objects.has(k(x, y));
    if (WALLS.has(key)) {
      const [fx, fy] = rot === 1 ? [x + 1, y] : rot === 3 ? [x - 1, y] : [x, y + 1];
      const front = fy * w + fx;
      const ok = !here && this.baseCollision[y * w + x] !== 0 && fy < this.map.height && fx >= 0 && fx < w && this.map.collision[front] === 0 && groundAt(this.map, fx, fy) === "floor";
      // (A UV light stands on the floor as well as hanging.)
      if (ok || key !== "uv_light") return { ok, lift: 0 };
    }
    const lift = this.surfaceAt(x, y);
    if (TOPS.has(key) && lift) return { ok: !this.tops.has(k(x, y)), lift };
    return { ok: !here && this.map.collision[y * w + x] === 0, lift: 0 };
  }

  /** The preview of `key` at (x, y): see-through, reddened where it can't go. */
  ghostAt(x: number, y: number, key: string, rot = 0) {
    if (!this.ghost) {
      this.ghost = new Sprite();
      this.ghost.anchor.set(0.5, 1);
      this.scene.sorted.addChild(this.ghost);
    }
    const { ok, lift } = this.placeCheck(x, y, key, rot);
    const g = this.ghost;
    g.texture = key === POND ? pondTexture() : furnitureTexture(key);
    g.anchor.set(0.5, 1);
    g.position.set(x * TILE + TILE / 2, y * TILE + TILE - lift);
    if (key === POND) {
      g.rotation = 0;
      g.skew.set(0, 0);
      g.scale.set(1);
      g.anchor.set(0, 0);
      g.position.set(x * TILE, y * TILE);
      g.alpha = ok ? 0.6 : 0.45;
      g.tint = ok ? 0xffffff : 0xff6a6a;
      g.zIndex = 1e8;
      this.scene.standOn(g, y * TILE + TILE - 2);
      g.visible = true;
      return;
    }
    const side = WALLS.has(key) && (rot === 1 || rot === 3) && this.baseCollision[y * this.map.width + x] !== 0;
    this.turn(g, key, rot, side);
    if (side) g.position.set(x * TILE + (rot === 1 ? TILE + 3 : -3), y * TILE + TILE - 6);
    g.alpha = ok ? 0.6 : 0.45;
    g.tint = ok ? 0xffffff : 0xff6a6a;
    g.zIndex = 1e8;
    this.scene.standOn(g, y * TILE + TILE - 2);
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
    if (!o) return;
    o.on = on;
    this.shine(x, y, o);
  }

  isOn(x: number, y: number): boolean {
    return this.usedAt(x, y)?.on ?? false;
  }

  /** A tank's fish (TankFish), as item ids. */
  setTank(x: number, y: number, fish: number[]) {
    const o = this.usedAt(x, y);
    if (!o) return;
    this.tankFish.set(k(x, y), fish);
    if (o.shelf) {
      // Two rows of three, standing on the shelves.
      o.shelf.removeChildren().forEach((c) => c.destroy());
      fish.forEach((f, i) => {
        const it = this.eco.items.get(f);
        if (!it) return;
        const s = new Sprite(itemTexture(it.key, it.kind));
        s.anchor.set(0.5, 1);
        s.scale.set(0.3);
        s.position.set(10 + (i % 3) * 6, i < 3 ? 15 : 28);
        o.shelf!.addChild(s);
      });
    }
    o.tank?.set(fish.map((f) => this.eco.items.get(f)?.key ?? "minnow"));
  }

  /** When a tank's fish last ate (TankFed, unix seconds). */
  setFed(x: number, y: number, fed: number) {
    this.tankFed.set(k(x, y), fed);
    const o = this.usedAt(x, y);
    if (o?.tank) o.tank.sluggish = this.hungry(x, y);
  }

  /** Whether the tank's fish have gone three days and more without food. */
  hungry(x: number, y: number): boolean {
    const fed = this.tankFed.get(k(x, y));
    return fed !== undefined && Date.now() / 1000 - fed >= HUNGRY_SECS;
  }

  private tankFed = new Map<string, number>();

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
    this.scene.drawnAsIs(line);
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
      const from = this.scene.drawnAt(tip.x, tip.y, tip.z);
      const to = this.scene.drawnAt(b.sprite.x, b.sprite.y - 8, b.sprite.zIndex);
      const sag = (biting ? 1 : 7) * to.s;
      g.moveTo(from.x, from.y)
        .quadraticCurveTo((from.x + to.x) / 2, Math.max(from.y, to.y) + sag, to.x, to.y)
        .stroke({ width: to.s, color: 0xf2f2f2, alpha: 0.85 });
      b.line.zIndex = Math.max(tip.z, b.sprite.zIndex) + 0.2;
    }
  }
}
