// The rendered world: baked ground chunks, y-sorted props and avatars, and a
// camera that follows the player.

import { type Application, Container, Graphics, Sprite } from "pixi.js";
import { TILE, bakeChunk, decorTexture, hash, objectTexture } from "./art";
import { type ZoneMap, groundAt } from "./map";
import type { TileXY } from "./motion";

const CHUNK = 16;
/** Decor drawn flat on the ground. */
const FLAT = new Set(["blanket", "lilypad", "mushrooms"]);
/** Decor that sways in the wind. */
const SWAY = new Set(["tree", "pine", "apple_tree", "bush", "tallgrass", "reeds", "willow", "willow_curtain", "pine_secret"]);

/** Side-by-side bench tiles draw as one long bench (one seat per tile). */
function benchPiece(map: ZoneMap, x: number, y: number): string {
  const bench = (xx: number) => xx >= 0 && xx < map.width && map.decor_legend[map.decor[y * map.width + xx]] === "bench";
  const l = bench(x - 1);
  const r = bench(x + 1);
  return l && r ? "bench_mid" : l ? "bench_right" : r ? "bench_left" : "bench";
}

export class Scene {
  readonly world = new Container();
  /** Props and avatars, sorted by their foot position. */
  readonly sorted = new Container();
  private marker = new Graphics();
  private markerUntil = 0;
  scale = 2;
  private cam: TileXY = { x: 0, y: 0 };
  private swaying: { s: Sprite; x: number; y: number; phase: number }[] = [];
  /** 0 calm … 1 blustery; set by the weather. */
  wind = 0.3;

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
        const tex = decorTexture(kind === "bench" ? benchPiece(map, x, y) : kind, hash(x, y, 5));
        if (!tex) continue;
        const s = new Sprite(tex);
        s.anchor.set(0.5, 1);
        s.position.set(x * TILE + TILE / 2, y * TILE + TILE - 2);
        // Flat things lie under whoever stands on them.
        s.zIndex = FLAT.has(kind) ? y * TILE + 1 : y * TILE + TILE - 2;
        this.sorted.addChild(s);
        if (SWAY.has(kind)) this.swaying.push({ s, x, y, phase: hash(x, y, 13) % 628 });
      }
    }

    for (const o of map.objects) {
      if (o.kind === "grove_slot" || o.kind === "nook") continue; // drawn elsewhere, or invisible
      const { texture, overhang } = objectTexture(o);
      const s = new Sprite(texture);
      s.position.set(o.x * TILE, o.y * TILE - overhang);
      // The dance floor lies flat: people stand on it, not behind it.
      s.zIndex = o.kind === "dance_floor" ? o.y * TILE + 1 : (o.y + o.h) * TILE - 1;
      this.sorted.addChild(s);
    }

    this.resize();
  }

  /**
   * Zooms so roughly 22×13 tiles fit on screen, with each art pixel covering
   * a whole number of *device* pixels. With display scaling (125%, 150%) a
   * CSS-integer zoom would be fractional on the device and pixels would come
   * out unevenly sized.
   */
  resize() {
    const { width, height } = this.app.screen;
    const res = this.app.renderer.resolution;
    const want = Math.min(3, Math.min(width / (22 * TILE), height / (13 * TILE)));
    this.scale = Math.max(1, Math.round(want * res)) / res;
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

  /** Centres on `p`, but stops at the map edge; a map smaller than the screen is centred. */
  follow(p: TileXY) {
    const { width, height } = this.app.screen;
    const span = TILE * this.scale;
    const axis = (at: number, size: number, view: number) =>
      size <= view ? size / 2 : Math.min(Math.max(at + 0.5, view / 2), size - view / 2);
    const cx = axis(p.x, this.map.width, width / span);
    const cy = axis(p.y, this.map.height, height / span);
    this.cam = { x: cx - 0.5, y: cy - 0.5 };
    // Snap to the device pixel grid so every art pixel lands on whole pixels.
    const res = this.app.renderer.resolution;
    const snap = (v: number) => Math.round(v * res) / res;
    this.world.position.set(snap(width / 2 - cx * span), snap(height / 2 - cy * span));
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
    const now = performance.now();
    const left = this.markerUntil - now;
    this.marker.alpha = left > 0 ? Math.min(1, left / 300) : 0;
    // Wind: plants on screen lean gently, each a little out of step.
    const v = this.viewRect();
    const t = now / 1000;
    const amp = 0.015 + this.wind * 0.05;
    for (const p of this.swaying) {
      if (p.x < v.x0 - 2 || p.x > v.x1 + 2 || p.y < v.y0 - 2 || p.y > v.y1 + 3) continue;
      const gust = Math.sin(t * 0.7 + p.x * 0.15) * 0.5 + 0.5;
      p.s.skew.x = Math.sin(t * 1.6 + p.phase / 100) * amp * (0.4 + gust);
    }
  }
}
