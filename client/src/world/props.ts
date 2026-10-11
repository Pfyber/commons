// Server-driven world props: garden plants, home furniture and fishing
// bobbers. Rendering only; Game decides what to show from server messages.

import { Sprite } from "pixi.js";
import type { Economy } from "../economy";
import type { PlotInfo } from "../ui/panels";
import { TILE } from "./art";
import { bobberTexture, furnitureTexture, plantTexture, wetSoilTexture } from "./items";
import type { ZoneMap } from "./map";
import type { TileXY } from "./motion";
import type { Scene } from "./scene";

const k = (x: number, y: number) => `${x},${y}`;

interface PlotSprites {
  plant: Sprite;
  wet: Sprite;
  info: PlotInfo;
}

export class Props {
  readonly plots = new Map<string, PlotSprites>();
  readonly objects = new Map<string, { sprite: Sprite; item: number }>();
  private bobbers = new Map<number, { sprite: Sprite; tile: TileXY; biteAt: number }>();
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
      wet.zIndex = -1;
      const plant = new Sprite();
      plant.anchor.set(0.5, 1);
      plant.position.set(x * TILE + TILE / 2, y * TILE + TILE);
      plant.zIndex = y * TILE + TILE - 6;
      this.scene.world.addChildAt(wet, 1);
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
    this.objects.delete(key);
    const i = y * this.map.width + x;
    if (!item) {
      this.map.collision[i] = this.baseCollision[i];
      return;
    }
    const s = new Sprite(furnitureTexture(this.eco.items.get(item)?.key ?? ""));
    s.anchor.set(0.5, 1);
    s.position.set(x * TILE + TILE / 2, y * TILE + TILE);
    const flat = this.eco.items.get(item)?.key === "round_rug";
    s.zIndex = flat ? y * TILE - 30 : y * TILE + TILE - 2;
    this.scene.sorted.addChild(s);
    this.objects.set(key, { sprite: s, item });
    // Furniture blocks walking, as on the server.
    this.map.collision[i] = 1;
  }

  cast(avatarId: number, tile: TileXY) {
    this.reelIn(avatarId);
    const s = new Sprite(bobberTexture());
    s.anchor.set(0.5, 1);
    s.position.set(tile.x * TILE + TILE / 2, tile.y * TILE + TILE / 2 + 4);
    s.zIndex = tile.y * TILE + TILE / 2;
    this.scene.sorted.addChild(s);
    this.bobbers.set(avatarId, { sprite: s, tile, biteAt: 0 });
  }

  bite(avatarId: number) {
    const b = this.bobbers.get(avatarId);
    if (b) b.biteAt = performance.now();
  }

  reelIn(avatarId: number) {
    this.bobbers.get(avatarId)?.sprite.destroy();
    this.bobbers.delete(avatarId);
  }

  update(now: number) {
    for (const b of this.bobbers.values()) {
      const base = b.tile.y * TILE + TILE / 2 + 4;
      const biting = b.biteAt && now - b.biteAt < 2500;
      const dy = biting ? Math.abs(Math.sin(now / 60)) * 5 : Math.sin(now / 500) * 1;
      b.sprite.y = base + dy;
    }
  }
}
