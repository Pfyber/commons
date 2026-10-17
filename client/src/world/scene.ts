// The rendered world: ground chunks baked as they come into view, y-sorted
// props and avatars, and a camera that follows the player.

import { type Application, Container, Graphics, Sprite } from "pixi.js";
import { TILE, bakeChunk, decorTexture, hash, newTagTexture, objectTexture } from "./art";
import { itemTexture } from "./items";
import { type MapObject, type ZoneMap, groundAt } from "./map";
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

/** Chunks kept loaded around the view, and how many to bake per frame. */
const MARGIN = 1;
const BAKE_PER_FRAME = 4;

interface Chunk {
  ground: Sprite;
  props: Sprite[];
  sway: { s: Sprite; x: number; y: number; phase: number }[];
}

interface Placed {
  o: MapObject;
  /** Tile bounds including the art above the footprint. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  sprite: Sprite | null;
  /** A mall display's item (and its "new" tag), drawn on the stand. */
  extras: Sprite[];
}

/** Inclusive chunk rectangle. */
interface Range {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Scene {
  readonly world = new Container();
  /** Props and avatars, sorted by their foot position. */
  readonly sorted = new Container();
  private ground = new Container();
  private marker = new Graphics();
  private markerUntil = 0;
  scale = 2;
  private cam: TileXY = { x: 0, y: 0 };
  /**
   * The map streams in by chunks around the camera (ADR 0010): ground, decor
   * and objects exist only near the view, so a city costs what a park does.
   */
  private chunks = new Map<number, Chunk>();
  private placed: Placed[];
  private cols: number;
  private rows: number;
  private loaded: Range | null = null;
  /** 0 calm … 1 blustery; set by the weather. */
  wind = 0.3;

  constructor(
    private app: Application,
    readonly map: ZoneMap,
  ) {
    this.sorted.sortableChildren = true;
    this.world.addChild(this.ground, this.marker, this.sorted);
    app.stage.addChild(this.world);
    this.cols = Math.ceil(map.width / CHUNK);
    this.rows = Math.ceil(map.height / CHUNK);
    this.placed = map.objects
      // Drawn elsewhere, or invisible.
      .filter((o) => o.kind !== "grove_slot" && o.kind !== "nook" && o.kind !== "spot")
      .map((o) => ({ o, x0: o.x - 1, y0: o.y - 4, x1: o.x + o.w, y1: o.y + o.h, sprite: null, extras: [] }));
    this.resize();
  }

  /** Bakes chunks that came into range (a few per frame) and drops far ones. */
  private stream() {
    const v = this.viewRect();
    const clampX = (c: number) => Math.max(0, Math.min(this.cols - 1, c));
    const clampY = (c: number) => Math.max(0, Math.min(this.rows - 1, c));
    const want: Range = {
      x0: clampX(Math.floor(v.x0 / CHUNK) - MARGIN),
      y0: clampY(Math.floor(v.y0 / CHUNK) - MARGIN),
      x1: clampX(Math.floor(v.x1 / CHUNK) + MARGIN),
      y1: clampY(Math.floor(v.y1 / CHUNK) + MARGIN),
    };
    const l = this.loaded;
    if (l && l.x0 === want.x0 && l.y0 === want.y0 && l.x1 === want.x1 && l.y1 === want.y1) return;
    // Keep one extra ring before dropping, so walking along an edge doesn't churn.
    for (const [key, c] of this.chunks) {
      const cx = key % this.cols;
      const cy = Math.floor(key / this.cols);
      if (cx < want.x0 - 1 || cx > want.x1 + 1 || cy < want.y0 - 1 || cy > want.y1 + 1) this.unload(key, c);
    }
    // Nearest first; everything at once only for the very first view.
    const missing: [number, number, number][] = [];
    const mx = (v.x0 + v.x1) / 2 / CHUNK;
    const my = (v.y0 + v.y1) / 2 / CHUNK;
    for (let cy = want.y0; cy <= want.y1; cy++) {
      for (let cx = want.x0; cx <= want.x1; cx++) {
        if (!this.chunks.has(cy * this.cols + cx)) missing.push([Math.hypot(cx + 0.5 - mx, cy + 0.5 - my), cx, cy]);
      }
    }
    missing.sort((a, b) => a[0] - b[0]);
    const budget = this.chunks.size === 0 ? missing.length : BAKE_PER_FRAME;
    for (const [, cx, cy] of missing.slice(0, budget)) this.load(cx, cy);
    if (missing.length <= budget) this.loaded = want;

    // Objects: shown while they overlap the kept area.
    const tx0 = (want.x0 - 1) * CHUNK;
    const ty0 = (want.y0 - 1) * CHUNK;
    const tx1 = (want.x1 + 2) * CHUNK;
    const ty1 = (want.y1 + 2) * CHUNK;
    for (const p of this.placed) {
      const near = p.x1 >= tx0 && p.x0 < tx1 && p.y1 >= ty0 && p.y0 < ty1;
      if (near && !p.sprite) {
        const { texture, overhang, left } = objectTexture(p.o);
        const s = new Sprite(texture);
        s.position.set(p.o.x * TILE - left, p.o.y * TILE - overhang);
        s.zIndex = (p.o.y + p.o.h) * TILE - 1;
        this.sorted.addChild(s);
        p.sprite = s;
        if (p.o.item) {
          // Furniture stands on the floor; small goods sit on the shelf.
          const it = new Sprite(itemTexture(p.o.item, p.o.itemKind ?? ""));
          it.anchor.set(0.5, 1);
          const onShelf = p.o.kind === "shelf";
          it.scale.set(onShelf && p.o.itemKind === "furniture" ? 0.75 : 1);
          it.position.set(p.o.x * TILE + TILE / 2, p.o.y * TILE + (onShelf ? 2 : TILE - 2));
          // A pet waits in the middle of its pen.
          if (p.o.kind === "pet_pen") it.position.set((p.o.x + p.o.w / 2) * TILE, (p.o.y + p.o.h) * TILE - 14);
          it.zIndex = s.zIndex + 0.5;
          this.sorted.addChild(it);
          p.extras.push(it);
          if (p.o.isNew) {
            const tag = new Sprite(newTagTexture());
            tag.anchor.set(0.5, 1);
            tag.position.set(p.o.x * TILE + TILE / 2 + 8, it.position.y - it.height + 4);
            tag.zIndex = s.zIndex + 0.6;
            this.sorted.addChild(tag);
            p.extras.push(tag);
          }
        }
      } else if (!near && p.sprite) {
        p.sprite.destroy({ texture: true, textureSource: true });
        p.sprite = null;
        for (const e of p.extras) e.destroy();
        p.extras = [];
      }
    }
  }

  private load(cx: number, cy: number) {
    const map = this.map;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const w = Math.min(CHUNK, map.width - x0);
    const h = Math.min(CHUNK, map.height - y0);
    const ground = new Sprite(bakeChunk(x0, y0, w, h, (x, y) => groundAt(map, x, y)));
    ground.position.set(x0 * TILE, y0 * TILE);
    this.ground.addChild(ground);
    const chunk: Chunk = { ground, props: [], sway: [] };
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
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
        chunk.props.push(s);
        if (SWAY.has(kind)) chunk.sway.push({ s, x, y, phase: hash(x, y, 13) % 628 });
      }
    }
    this.chunks.set(cy * this.cols + cx, chunk);
  }

  private unload(key: number, c: Chunk) {
    // Ground textures are baked per chunk; decor textures are shared and cached.
    c.ground.destroy({ texture: true, textureSource: true });
    for (const s of c.props) s.destroy();
    this.chunks.delete(key);
  }

  /** Frees the baked chunk and object textures, then everything else. */
  destroy() {
    for (const [key, c] of this.chunks) this.unload(key, c);
    for (const p of this.placed) {
      p.sprite?.destroy({ texture: true, textureSource: true });
      for (const e of p.extras) e.destroy();
    }
    this.world.destroy({ children: true });
  }

  /** Chunks currently baked (for tests and the debug overlay). */
  get chunkCount(): number {
    return this.chunks.size;
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
    this.stream();
    // Wind: plants on screen lean gently, each a little out of step.
    const v = this.viewRect();
    const t = now / 1000;
    const amp = 0.015 + this.wind * 0.05;
    for (const c of this.chunks.values()) {
      for (const p of c.sway) {
        if (p.x < v.x0 - 2 || p.x > v.x1 + 2 || p.y < v.y0 - 2 || p.y > v.y1 + 3) continue;
        const gust = Math.sin(t * 0.7 + p.x * 0.15) * 0.5 + 0.5;
        p.s.skew.x = Math.sin(t * 1.6 + p.phase / 100) * amp * (0.4 + gust);
      }
    }
  }
}
