// How houses look outside (ADR 0011, M7): paint and a postbox change the
// house's own drawing; a fence runs along the front of the garden (with a
// gap for the path to the door) and something stands in the yard.

import { Sprite } from "pixi.js";
import type { Goods, HouseLooks } from "../goods";
import { TILE } from "./art";
import { fenceTexture, yardTexture } from "./goods";
import { type ZoneMap, type MapObject, spot } from "./map";
import type { Scene } from "./scene";

export class HouseFronts {
  private sprites = new Map<string, Sprite[]>();
  private shown = new Map<string, string>();
  private off: () => void;

  constructor(
    private scene: Scene,
    private map: ZoneMap,
    private goods: Goods,
  ) {
    this.off = goods.onChange(() => this.apply());
    this.apply();
  }

  private apply() {
    for (const house of this.map.objects) {
      if (house.kind !== "house" || !house.label) continue;
      const looks = this.goods.houses.get(house.label) ?? {};
      const key = JSON.stringify(looks);
      if ((this.shown.get(house.label) ?? "{}") === key) continue;
      this.shown.set(house.label, key);
      this.dress(house, looks);
    }
  }

  private dress(house: MapObject, looks: HouseLooks) {
    const plot = house.label!;
    if ((house.style ?? 0) !== (looks.facade ?? 0)) {
      house.style = looks.facade ?? 0;
      this.scene.redraw(house);
    }
    const box = this.map.objects.find((o) => o.kind === "postbox" && o.label === plot);
    if (box && (box.style ?? 0) !== (looks.postbox ?? 0)) {
      box.style = looks.postbox ?? 0;
      this.scene.redraw(box);
    }
    for (const s of this.sprites.get(plot) ?? []) s.destroy();
    const made: Sprite[] = [];
    const door = spot(this.map, `door:${plot}`);
    // The fence: along the front garden's edge by the pavement, open at the
    // path to the door.
    if (looks.fence && door) {
      const y = house.y + house.h + 1;
      const runs: [number, number][] = [
        [house.x, door.x - 1],
        [door.x + 2, house.x + house.w],
      ];
      for (const [x0, x1] of runs) {
        if (x1 <= x0) continue;
        const s = new Sprite(fenceTexture(looks.fence, x1 - x0));
        s.position.set(x0 * TILE, y * TILE + TILE - 14);
        s.zIndex = y * TILE + TILE - 2;
        made.push(s);
      }
    }
    if (looks.yard) {
      const s = new Sprite(yardTexture(looks.yard));
      s.anchor.set(0.5, 1);
      const x = house.x + 1;
      const y = house.y + house.h;
      s.position.set(x * TILE + TILE / 2, y * TILE + TILE - 2);
      s.zIndex = y * TILE + TILE - 2;
      made.push(s);
    }
    for (const s of made) this.scene.sorted.addChild(s);
    this.sprites.set(plot, made);
  }

  destroy() {
    this.off();
    for (const list of this.sprites.values()) for (const s of list) s.destroy();
    this.sprites.clear();
  }
}
