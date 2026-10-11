// The rendered world: baked ground chunks, y-sorted props and avatars, and a
// camera that follows the player.

import { type Application, Container, Graphics, Sprite } from "pixi.js";
import { TILE, bakeChunk, decorTexture, hash, objectTexture } from "./art";
import { type ZoneMap, groundAt } from "./map";
import type { TileXY } from "./motion";

const CHUNK = 16;

export class Scene {
  readonly world = new Container();
  /** Props and avatars, sorted by their foot position. */
  readonly sorted = new Container();
  private marker = new Graphics();
  private markerUntil = 0;
  scale = 2;
  private cam: TileXY = { x: 0, y: 0 };

  constructor(
    private app: Application,
    readonly map: ZoneMap,
  ) {
    this.sorted.sortableChildren = true;
    const ground = new Container();
    this.world.addChild(ground, this.marker, this.sorted);
    app.stage.addChild(this.world);

    const at = (x: number, y: number) => groundAt(map, x, y);
    for (let cy = 0; cy < map.height; cy += CHUNK) {
      for (let cx = 0; cx < map.width; cx += CHUNK) {
        const s = new Sprite(bakeChunk(cx, cy, Math.min(CHUNK, map.width - cx), Math.min(CHUNK, map.height - cy), at));
        s.position.set(cx * TILE, cy * TILE);
        ground.addChild(s);
      }
    }

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const kind = map.decor_legend[map.decor[y * map.width + x]];
        if (kind === "none") continue;
        const tex = decorTexture(kind, hash(x, y, 5));
        if (!tex) continue;
        const s = new Sprite(tex);
        s.anchor.set(0.5, 1);
        s.position.set(x * TILE + TILE / 2, y * TILE + TILE - 2);
        s.zIndex = y * TILE + TILE - 2;
        this.sorted.addChild(s);
      }
    }

    for (const o of map.objects) {
      const { texture, overhang } = objectTexture(o);
      const s = new Sprite(texture);
      s.position.set(o.x * TILE, o.y * TILE - overhang);
      s.zIndex = (o.y + o.h) * TILE - 1;
      this.sorted.addChild(s);
    }

    this.resize();
  }

  /** Picks an integer zoom so roughly 22×13 tiles fit on screen. */
  resize() {
    const { width, height } = this.app.screen;
    this.scale = Math.max(1, Math.min(3, Math.round(Math.min(width / (22 * TILE), height / (13 * TILE)))));
    this.world.scale.set(this.scale);
    this.follow(this.cam);
  }

  /** Viewport size in tiles, sent to the server for interest management. */
  viewTiles(): { w: number; h: number } {
    const { width, height } = this.app.screen;
    return { w: Math.ceil(width / (TILE * this.scale)) + 1, h: Math.ceil(height / (TILE * this.scale)) + 1 };
  }

  /** Visible area in tiles (inclusive bounds, may exceed the map). */
  viewRect(): { x0: number; y0: number; x1: number; y1: number } {
    const v = this.viewTiles();
    return {
      x0: this.cam.x - v.w / 2,
      y0: this.cam.y - v.h / 2,
      x1: this.cam.x + v.w / 2,
      y1: this.cam.y + v.h / 2,
    };
  }

  follow(p: TileXY) {
    this.cam = p;
    const { width, height } = this.app.screen;
    this.world.position.set(
      Math.round(width / 2 - (p.x * TILE + TILE / 2) * this.scale),
      Math.round(height / 2 - (p.y * TILE + TILE / 2) * this.scale),
    );
  }

  screenToTile(sx: number, sy: number): TileXY {
    return {
      x: Math.floor((sx - this.world.position.x) / this.scale / TILE),
      y: Math.floor((sy - this.world.position.y) / this.scale / TILE),
    };
  }

  /** Screen position of a world point given in tile units (tile centre = +0.5). */
  tileToScreen(x: number, y: number): TileXY {
    return {
      x: this.world.position.x + x * TILE * this.scale,
      y: this.world.position.y + y * TILE * this.scale,
    };
  }

  showTarget(t: TileXY) {
    this.marker.clear();
    this.marker
      .ellipse(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2 + 4, 9, 5)
      .stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
    this.marker.alpha = 1;
    this.markerUntil = performance.now() + 900;
  }

  update() {
    const left = this.markerUntil - performance.now();
    this.marker.alpha = left > 0 ? Math.min(1, left / 300) : 0;
  }
}
