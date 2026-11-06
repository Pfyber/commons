// The rendered world: ground chunks baked as they come into view, y-sorted
// props and avatars, and a camera that follows the player.
//
// The ⚙️ 3D view (2.5D) tilts that camera: the ground lies back in true
// perspective and everything standing on it (trees, houses, people) stands
// up facing you, smaller with distance. It's applied just before each frame
// is drawn and undone just after, so the rest of the game only ever sees the
// flat world and goes through `screenToWorld` / `tileToScreen` for the screen.

import { type Application, Container, Graphics, Matrix, PerspectiveMesh, RenderTexture, Sprite, Texture, UPDATE_PRIORITY } from "pixi.js";
import { onSettings } from "../settings";
import { TILE, bakeChunk, decorTexture, hash, newTagTexture, objectTexture } from "./art";
import { itemTexture } from "./items";
import { type MapObject, type ZoneMap, groundAt } from "./map";
import type { TileXY } from "./motion";

/** 2.5D: the camera's angle above the ground (90° would be straight down). */
const TILT = (58 * Math.PI) / 180;
const SIN = Math.sin(TILT);
const COS = Math.cos(TILT);
/** How far back the camera stands, in screen heights (nearer: stronger perspective). */
const DIST = 1.1;
/** Where you stand on screen: a little below the middle, so more lies ahead. */
const FOCUS_DOWN = 0.12;
/** Closer than this share of the camera distance, things are passed over (behind the lens). */
const NEAR = 0.25;
/** The furthest the view reaches north, in tiles. */
const FAR = 60;
/** Lying flat on the ground (a blanket, the dance floor) rather than standing up. */
const lying = new WeakSet<Container>();
/** Flat things bigger than this (tiles, either way) are laid in true perspective, as the ground is. */
const LAY_TILES = 1.5;

/** Something flat drawn in true perspective in 3D: its own texture, or one it's drawn into each frame. */
interface Laid {
  mesh: PerspectiveMesh;
  texture: Texture;
  rt: RenderTexture | null;
}

/** A transform the 3D view changed for this frame, to put back. */
interface Saved {
  c: Container;
  x: number;
  y: number;
  sx: number;
  sy: number;
  visible: boolean;
}

const CHUNK = 16;
/** Indoors: how far (tiles) the north wall's art stands above the top row, and the HUD's height (screen px). */
const WALL_ABOVE = 1.5;
const HUD_PX = 72;
/** Decor drawn flat on the ground. */
/** Objects that lie flat (people stand on them): the dance floor, the paintball field's markings, pads and bases. */
const FLAT_OBJECTS = new Set(["dance_floor", "concert_stage", "pb_field", "pb_pad", "pb_spawn", "arena_spikes", "arena_carpet", "arena_bowl"]);
const FLAT = new Set(["blanket", "lilypad", "mushrooms", "wildflowers", "daisies", "clover", "pebbles", "bones"]);
/** Decor that sways in the wind. */
const SWAY = new Set(["tree", "pine", "apple_tree", "bush", "tallgrass", "reeds", "willow", "willow_curtain", "pine_secret", "fern", "palm", "dry_shrub"]);

/** Side-by-side bench tiles draw as one long bench (one seat per tile). */
function benchPiece(map: ZoneMap, x: number, y: number): string {
  const bench = (xx: number) => xx >= 0 && xx < map.width && map.decor_legend[map.decor[y * map.width + xx]] === "bench";
  const l = bench(x - 1);
  const r = bench(x + 1);
  return l && r ? "bench_mid" : l ? "bench_right" : r ? "bench_left" : "bench";
}

/** Upright bench tiles, one above another, draw as one long bench too. */
function benchVPiece(map: ZoneMap, x: number, y: number): string {
  const bench = (yy: number) => yy >= 0 && yy < map.height && map.decor_legend[map.decor[yy * map.width + x]] === "bench_v";
  const t = bench(y - 1);
  const b = bench(y + 1);
  return t && b ? "bench_v_mid" : t ? "bench_v_bot" : b ? "bench_v_top" : "bench_v";
}

/** How far the wheel zooms, in steps either side of the default. */
const ZOOM_IN = 3;
/**
 * Below one device pixel per art pixel, the steps further out: ¾ and ½ (a
 * wide view of the city; past 1 the art can't stay pixel-perfect).
 */
const FINE_OUT = [0.75, 0.5];
/** An admin's: on out to three times as far (⅙ of a device pixel per art pixel). */
const ADMIN_OUT = [0.75, 0.5, 0.375, 0.25, 0.2, 1 / 6];
let wide = false;
const fineOut = () => (wide ? ADMIN_OUT : FINE_OUT);

/** Admins zoom out three times as far as everyone else. */
export function setWideZoom(on: boolean) {
  wide = on;
}
const ZOOM_KEY = "commons.zoom";

function loadZoom(): number {
  try {
    // (In quarter steps: the wheel zooms finely.)
    return Math.round((Number(localStorage.getItem(ZOOM_KEY)) || 0) * 4) / 4;
  } catch {
    return 0;
  }
}

/** Chunks kept loaded around the view, and how many to bake per frame. */
const MARGIN = 1;
const BAKE_PER_FRAME = 2;
/** Objects' art kept out of range, for walking back (the rest is drawn again). */
const KEEP_ART = 80;

interface Chunk {
  ground: Sprite;
  /** The same ground in perspective (3D view only, made when first needed). */
  mesh: PerspectiveMesh | null;
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
  /** Its art, kept a while after it goes out of range (drawing it again as you walk back is what made the walk hitch). */
  art: { texture: Texture; overhang: number; left: number } | null;
  /** When it last went out of range (its art goes first, when too much is kept). */
  hiddenAt: number;
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
  /** The baked ground chunks (bottom of the world). */
  readonly ground = new Container();
  /** Props and avatars, sorted by their foot position. */
  readonly sorted = new Container();
  private marker = new Graphics();
  private markerUntil = 0;
  scale = 2;
  /**
   * Zoom, in steps from the default (each a whole device pixel per art
   * pixel, so the art is crisp when it settles): where it's showing now,
   * gliding toward where it's headed; remembered between visits.
   */
  private zoom = loadZoom();
  private zoomTo = this.zoom;
  private locked: { w: number; h: number } | null = null;
  private zoomAt = performance.now();
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
  /** No zooming far out (the labyrinth). */
  closeView = false;
  /** The 3D view (⚙️ settings): on, and what it changed this frame. */
  private view3d = false;
  private ground3d = new Container();
  /** Who the 3D camera looks at (tile), not held back at the map's edge. */
  private focus: TileXY = { x: 0, y: 0 };
  /** Other layers drawn in world space (lamp light, fireflies): `whole` ones are tilted as one piece. */
  private layers3d: { c: Container; whole: boolean }[] = [];
  private saved: Saved[] = [];
  private worldAt = { x: 0, y: 0, s: 1 };
  /** Where each thing was last drawn in 3D (for tapping an avatar). */
  private drawn3d = new WeakMap<Container, { x: number; y: number; sx: number; sy: number }>();
  /** Haze toward the horizon, outdoors in 3D. */
  private haze: Sprite | null = null;
  /** Flat things laid in perspective (3D), and the layers drawn in world coordinates that lie flat. */
  private laid = new Map<Container, Laid>();
  private flatLayers = new Set<Container>();
  private offSettings: () => void;

  constructor(
    private app: Application,
    readonly map: ZoneMap,
  ) {
    this.sorted.sortableChildren = true;
    this.ground3d.visible = false;
    this.world.addChild(this.ground, this.ground3d, this.marker, this.sorted);
    app.stage.addChild(this.world);
    // Tilt just before the frame is drawn (LOW), level again just after.
    app.ticker.add(this.tilt, this, UPDATE_PRIORITY.LOW + 1);
    app.ticker.add(this.level, this, UPDATE_PRIORITY.LOW - 1);
    this.offSettings = onSettings((s) => this.set3d(s.view3d));
    this.cols = Math.ceil(map.width / CHUNK);
    this.rows = Math.ceil(map.height / CHUNK);
    this.placed = map.objects
      // Drawn elsewhere, or invisible.
      .filter((o) => o.kind !== "grove_slot" && o.kind !== "nook" && o.kind !== "spot" && o.kind !== "forage" && o.kind !== "arena" && o.kind !== "yard_stand" && o.kind !== "boat_lake" && (!o.kind.startsWith("lab_") || o.kind === "lab_exit" || o.kind === "lab_heart"))
      .map((o) => ({ o, x0: o.x - 1, y0: o.y - 4, x1: o.x + o.w, y1: o.y + o.h, sprite: null, art: null, hiddenAt: 0, extras: [] }));
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
        this.show(p);
      } else if (!near && p.sprite) {
        this.hide(p);
      }
    }
  }

  /** Draws a placed object (and what's on show on it). */
  private show(p: (typeof this.placed)[number]) {
    p.art ??= objectTexture(p.o);
    const { texture, overhang, left } = p.art;
    const s = new Sprite(texture);
    s.position.set(p.o.x * TILE - left, p.o.y * TILE - overhang);
    // The dance floor lies flat: people stand on it, not behind it.
    s.zIndex = FLAT_OBJECTS.has(p.o.kind) ? p.o.y * TILE + 1 : (p.o.y + p.o.h) * TILE - 1;
    if (FLAT_OBJECTS.has(p.o.kind)) lying.add(s);
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
  }

  private hide(p: (typeof this.placed)[number]) {
    // (Its art's kept for when we come back, up to a point: the longest
    // gone go first.)
    p.sprite?.destroy();
    p.sprite = null;
    p.hiddenAt = performance.now();
    for (const e of p.extras) e.destroy();
    p.extras = [];
    const kept = this.placed.filter((q) => q.art && !q.sprite);
    if (kept.length > KEEP_ART) {
      kept.sort((a, b) => a.hiddenAt - b.hiddenAt);
      for (const q of kept.slice(0, kept.length - KEEP_ART)) this.dropArt(q);
    }
  }

  private dropArt(p: (typeof this.placed)[number]) {
    p.art?.texture.destroy(true);
    p.art = null;
  }

  /** Draws `o` again (it changed: a house done up, a new postbox). */
  redraw(o: MapObject) {
    const p = this.placed.find((q) => q.o === o);
    if (!p) return;
    const shown = !!p.sprite;
    this.hide(p);
    this.dropArt(p);
    if (shown) this.show(p);
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
    const chunk: Chunk = { ground, mesh: null, props: [], sway: [] };
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const kind = map.decor_legend[map.decor[y * map.width + x]];
        if (kind === "none") continue;
        const tex = decorTexture(kind === "bench" ? benchPiece(map, x, y) : kind === "bench_v" ? benchVPiece(map, x, y) : kind, hash(x, y, 5));
        if (!tex) continue;
        const s = new Sprite(tex);
        s.anchor.set(0.5, 1);
        s.position.set(x * TILE + TILE / 2, y * TILE + TILE - 2);
        // Flat things lie under whoever stands on them.
        s.zIndex = FLAT.has(kind) ? y * TILE + 1 : y * TILE + TILE - 2;
        if (FLAT.has(kind)) lying.add(s);
        this.sorted.addChild(s);
        chunk.props.push(s);
        if (SWAY.has(kind)) chunk.sway.push({ s, x, y, phase: hash(x, y, 13) % 628 });
      }
    }
    this.chunks.set(cy * this.cols + cx, chunk);
  }

  private unload(key: number, c: Chunk) {
    // Ground textures are baked per chunk; decor textures are shared and cached.
    c.mesh?.destroy();
    c.ground.destroy({ texture: true, textureSource: true });
    for (const s of c.props) s.destroy();
    this.chunks.delete(key);
  }

  /** Frees the baked chunk and object textures, then everything else. */
  destroy() {
    this.offSettings();
    this.app.ticker.remove(this.tilt, this);
    this.app.ticker.remove(this.level, this);
    this.haze?.destroy({ texture: true, textureSource: true });
    for (const l of this.laid.values()) l.rt?.destroy(true);
    this.laid.clear();
    for (const [key, c] of this.chunks) this.unload(key, c);
    for (const p of this.placed) {
      p.sprite?.destroy();
      this.dropArt(p);
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
    const res = this.app.renderer.resolution;
    const [lo, hi] = this.zoomRange();
    const step = this.locked ? this.lockedStep(this.locked) : this.stepAt(Math.max(lo, Math.min(hi, this.zoom)));
    // Settled on a whole step, the art is pixel-perfect; between steps (gliding, pinching) it's smooth.
    this.scale = step / res;
    this.world.scale.set(this.scale);
    this.follow(this.cam);
  }

  /** The default zoom, in device pixels per art pixel. */
  private baseStep(): number {
    const { width, height } = this.app.screen;
    const res = this.app.renderer.resolution;
    const want = Math.min(3, Math.min(width / (22 * TILE), height / (13 * TILE)));
    return Math.max(1, Math.round(want * res));
  }

  /** How far the zoom may go, in steps from the default (down to the finest step out). */
  private zoomRange(): [number, number] {
    // (A maze isn't for seeing from above: only a step out from the usual view.)
    if (this.closeView) return [-1, ZOOM_IN];
    return [1 - this.baseStep() - fineOut().length, ZOOM_IN];
  }

  /**
   * Device pixels per art pixel at zoom `z` (steps from the default): whole
   * steps down to 1, then the fine steps below it (in between, smoothly).
   */
  private stepAt(z: number): number {
    const s = this.baseStep() + z;
    if (s >= 1) return s;
    const f = 1 - s; // 0 at 1, 1 at the first fine step…
    const i = Math.min(fineOut().length - 1, Math.floor(f));
    const from = i === 0 ? 1 : fineOut()[i - 1];
    const to = fineOut()[Math.min(i, fineOut().length - 1)];
    return from + (to - from) * Math.min(1, f - i);
  }

  /** Glides a step in (+1) or out (−1). Returns whether it will change. */
  zoomBy(dir: number): boolean {
    if (this.locked) return false;
    const [lo, hi] = this.zoomRange();
    const next = Math.max(lo, Math.min(hi, Math.round(this.zoomTo) + Math.sign(dir)));
    if (next === this.zoomTo) return false;
    this.zoomTo = next;
    this.saveZoom();
    return true;
  }

  /**
   * A fine step in (+1) or out (−1): a quarter step, for a precise view
   * (between the crisp ones). (Watching the arena, it may go a little
   * closer still; `save`: kept for next time.)
   */
  zoomFine(dir: number, closer = true, save = false): boolean {
    if (this.locked) return false;
    const [lo, hi] = this.zoomRange();
    const next = Math.max(lo, Math.min(hi + (closer ? 2 : 0), this.zoomTo + Math.sign(dir) * 0.25));
    if (next === this.zoomTo) return false;
    this.zoomTo = next;
    if (save) this.saveZoom();
    return true;
  }

  /**
   * Fixes the view at `w` × `h` tiles, whatever the screen, as big as fits
   * (a quarter step at a time, and no zooming till it's let go): paintball,
   * where seeing further is winning. Null lets it go.
   */
  lockView(box: { w: number; h: number } | null) {
    const same = box?.w === this.locked?.w && box?.h === this.locked?.h;
    // (Asked every frame: the screen may have changed under it.)
    if (same && (!box || Math.abs(this.lockedStep(box) - this.scale * this.app.renderer.resolution) < 1e-3)) return;
    this.locked = box;
    this.resize();
  }

  /** The locked view's size on screen (CSS px). */
  get lockedPx(): { w: number; h: number } | null {
    return this.locked ? { w: this.locked.w * TILE * this.scale, h: this.locked.h * TILE * this.scale } : null;
  }

  private lockedStep(box: { w: number; h: number }): number {
    const { width, height } = this.app.screen;
    const fit = Math.min(width / (box.w * TILE), height / (box.h * TILE)) * this.app.renderer.resolution;
    // (Below one device pixel to the art pixel, as fine as it needs: small phones.)
    return fit >= 1 ? Math.floor(fit * 4) / 4 : Math.max(0.125, Math.floor(fit * 16) / 16);
  }

  /** Back within the usual range (after watching the arena close up). */
  zoomSnap() {
    const [lo, hi] = this.zoomRange();
    this.zoomTo = Math.max(lo, Math.min(hi, this.zoomTo));
  }

  /** The zoom now (for a pinch to start from). */
  get zoomLevel(): number {
    return this.zoom;
  }

  /** A pinch: zoom straight to `from` scaled by `ratio` (how far the fingers spread). */
  pinch(from: number, ratio: number) {
    const [lo, hi] = this.zoomRange();
    const base = this.baseStep();
    this.zoom = this.zoomTo = Math.max(lo, Math.min(hi, (base + from) * ratio - base));
    this.resize();
  }

  /** The pinch let go: settle on the nearest quarter step. */
  pinchEnd() {
    this.zoomTo = Math.round(this.zoom * 4) / 4;
    this.saveZoom();
  }

  private saveZoom() {
    try {
      localStorage.setItem(ZOOM_KEY, String(this.zoomTo));
    } catch {
      // storage unavailable
    }
  }

  /**
   * Viewport size in tiles, sent to the server for interest management: as
   * far out as the zoom goes, so zooming out never shows an empty edge.
   */
  viewTiles(): { w: number; h: number } {
    const { width, height } = this.app.screen;
    const widest = fineOut()[fineOut().length - 1] / this.app.renderer.resolution;
    // The 3D view sees further, ahead and to the sides of the far distance.
    const [mw, mh] = this.view3d ? [1.6, 2] : [1, 1];
    // (A byte each way on the wire.)
    return { w: Math.min(255, Math.ceil((width * mw) / (TILE * widest)) + 1), h: Math.min(255, Math.ceil((height * mh) / (TILE * widest)) + 1) };
  }

  /** Visible area in tiles at the zoom now (inclusive bounds, may exceed the map). */
  viewRect(): { x0: number; y0: number; x1: number; y1: number } {
    const { width, height } = this.app.screen;
    if (this.view3d) {
      // What the tilted camera sees: a wedge, wide in the distance.
      const pts = [this.unproject(0, 0), this.unproject(width, 0), this.unproject(0, height), this.unproject(width, height)];
      const xs = pts.map((p) => p.x / TILE);
      const ys = pts.map((p) => p.y / TILE);
      return { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1 };
    }
    const v = { w: Math.ceil(width / (TILE * this.scale)) + 1, h: Math.ceil(height / (TILE * this.scale)) + 1 };
    return {
      x0: this.cam.x - v.w / 2,
      y0: this.cam.y - v.h / 2,
      x1: this.cam.x + v.w / 2,
      y1: this.cam.y + v.h / 2,
    };
  }

  /**
   * Centres on `p`, but stops at the map edge; a map smaller than the screen
   * is centred. Indoors, the north wall stands up above the room's top row
   * (and the HUD sits across the top of the screen), so the camera may look
   * that far above the map too: the wall shows whole, clear of the HUD.
   */
  follow(p: TileXY) {
    // The 3D camera keeps you in view right up to the edge (the map just ends, out there).
    this.focus = { x: Math.max(0, Math.min(this.map.width - 1, p.x)), y: Math.max(0, Math.min(this.map.height - 1, p.y)) };
    const { width, height } = this.app.screen;
    const span = TILE * this.scale;
    const axis = (at: number, size: number, view: number, before = 0) =>
      size + before <= view ? (size - before) / 2 : Math.min(Math.max(at + 0.5, view / 2 - before), size - view / 2);
    const above = this.map.streets ? 0 : WALL_ABOVE + HUD_PX / span;
    const cx = axis(p.x, this.map.width, width / span);
    const cy = axis(p.y, this.map.height, height / span, above);
    this.cam = { x: cx - 0.5, y: cy - 0.5 };
    // Snap to the device pixel grid so every art pixel lands on whole pixels.
    const res = this.app.renderer.resolution;
    const snap = (v: number) => Math.round(v * res) / res;
    this.world.position.set(snap(width / 2 - cx * span), snap(height / 2 - cy * span));
  }

  /** The world point (art pixels) on the ground under a screen point. */
  screenToWorld(sx: number, sy: number): TileXY {
    if (this.view3d) return this.unproject(sx, sy);
    return { x: (sx - this.world.position.x) / this.scale, y: (sy - this.world.position.y) / this.scale };
  }

  screenToTile(sx: number, sy: number): TileXY {
    const w = this.screenToWorld(sx, sy);
    return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
  }

  /**
   * Puts `c` flat on the ground: just above it, under everything standing
   * on it. (The world sorts by depth, so a fixed index can end up under
   * the ground: always go by where the ground actually is.)
   */
  onGround(c: Container) {
    this.world.addChildAt(c, this.world.getChildIndex(this.ground3d) + 1);
  }

  /** Screen position of a world point given in tile units (tile centre = +0.5), on the ground. */
  tileToScreen(x: number, y: number): TileXY {
    if (this.view3d) {
      const p = this.project(x * TILE, y * TILE);
      if (p) return { x: p.x, y: p.y };
    }
    return {
      x: this.world.position.x + x * TILE * this.scale,
      y: this.world.position.y + y * TILE * this.scale,
    };
  }

  /** Where `c` is on screen (the 3D view draws it somewhere other than its flat place). */
  screenBounds(c: Container): { minX: number; minY: number; maxX: number; maxY: number } {
    const d = this.view3d ? this.drawn3d.get(c) : undefined;
    if (!d) return c.getBounds();
    const b = c.getLocalBounds();
    const [x0, x1] = [d.x + b.minX * d.sx, d.x + b.maxX * d.sx];
    const [y0, y1] = [d.y + b.minY * d.sy, d.y + b.maxY * d.sy];
    return { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minY: Math.min(y0, y1), maxY: Math.max(y0, y1) };
  }

  /**
   * A layer drawn in world space outside the scene (lamp light, fireflies)
   * that copies the world's position and scale: in 3D it's tilted too, each
   * child laid on the ground where it is, or (`whole`) all of it as one.
   */
  layer3d(c: Container, whole: boolean) {
    this.layers3d.push({ c, whole });
  }

  /**
   * `c` (in `sorted`, drawn in world coordinates: the arena's burning sand,
   * petals on the ground) lies flat: in 3D it's drawn into a texture each
   * frame and laid on the ground in perspective, like the ground itself.
   */
  lieFlat(c: Container) {
    this.flatLayers.add(c);
  }

  // ---- the 3D view ----

  private set3d(on: boolean) {
    this.view3d = on;
    if (!on) {
      this.ground3d.visible = false;
      if (this.haze) this.haze.visible = false;
    }
  }

  /** The camera, for this frame: screen centre, distance (art pixels), zoom, and who it looks at. */
  private camera() {
    const { width, height } = this.app.screen;
    const z = this.scale;
    return {
      ox: width / 2,
      oy: height / 2 + FOCUS_DOWN * height,
      z,
      d: (DIST * height) / z,
      fx: (this.focus.x + 0.5) * TILE,
      fy: (this.focus.y + 0.5) * TILE,
    };
  }

  /** A ground point (art pixels) on screen, and how big things there are drawn; null behind the lens. */
  private project(wx: number, wy: number, cam = this.camera()): { x: number; y: number; s: number } | null {
    const dy = wy - cam.fy;
    const den = cam.d - dy * COS;
    if (den < cam.d * NEAR) return null;
    const s = (cam.d / den) * cam.z;
    return { x: cam.ox + (wx - cam.fx) * s, y: cam.oy + dy * SIN * s, s };
  }

  /** The ground point (art pixels) under a screen point (past the horizon: as far as the view reaches). */
  private unproject(sx: number, sy: number): TileXY {
    const cam = this.camera();
    const u = (sx - cam.ox) / cam.z;
    const v = (sy - cam.oy) / cam.z;
    const den = cam.d * SIN + v * COS;
    const far = -FAR * TILE;
    const dy = den <= cam.d * SIN * 0.05 ? far : Math.max(far, (v * cam.d) / den);
    const s = cam.d / (cam.d - dy * COS);
    return { x: cam.fx + u / s, y: cam.fy + dy };
  }

  private save(c: Container) {
    this.saved.push({ c, x: c.position.x, y: c.position.y, sx: c.scale.x, sy: c.scale.y, visible: c.visible });
  }

  /**
   * Draws `c` where the tilted camera sees it, its foot at ground depth
   * `footY`: standing up facing you, or lying flat (foreshortened).
   */
  private place(c: Container, footY: number, flat: boolean, cam: ReturnType<Scene["camera"]>) {
    const p = this.project(c.position.x, footY, cam);
    this.save(c);
    if (!p) {
      c.visible = false;
      return;
    }
    const sy = flat ? p.s * SIN : p.s;
    c.position.set(p.x, p.y + (c.position.y - footY) * sy);
    c.scale.set(c.scale.x * p.s, c.scale.y * sy);
    this.drawn3d.set(c, { x: c.position.x, y: c.position.y, sx: c.scale.x, sy: c.scale.y });
  }

  /** `c` (hidden this frame) drawn instead as a mesh with `texture`, its corners at world rectangle (x0, y0)–(x1, y1). */
  private lay(c: Container, texture: Texture, rt: RenderTexture | null, x0: number, y0: number, x1: number, y1: number, cam: ReturnType<Scene["camera"]>) {
    let l = this.laid.get(c);
    if (l && l.texture !== texture) {
      l.mesh.destroy();
      if (l.rt && l.rt !== rt) l.rt.destroy(true);
      l = undefined;
    }
    if (!l) {
      // (Big things need more vertices for the perspective to bend smoothly.)
      const n = Math.abs(x1 - x0) > 4 * TILE || Math.abs(y1 - y0) > 4 * TILE ? 8 : 3;
      l = { mesh: new PerspectiveMesh({ texture, verticesX: n, verticesY: n }), texture, rt };
      this.laid.set(c, l);
      this.sorted.addChild(l.mesh);
    }
    const a = this.project(x0, y0, cam);
    const b = this.project(x1, y0, cam);
    const r = this.project(x1, y1, cam);
    const d = this.project(x0, y1, cam);
    const m = l.mesh;
    m.zIndex = c.zIndex;
    m.alpha = c.alpha;
    m.blendMode = c.blendMode;
    if (c instanceof Sprite) m.tint = c.tint;
    m.visible = c.visible && !!(a && b && r && d);
    if (a && b && r && d) m.setCorners(a.x, a.y, b.x, b.y, r.x, r.y, d.x, d.y);
    this.save(c);
    c.visible = false;
  }

  /** A flat sprite laid on the ground in perspective. */
  private laySprite(s: Sprite, cam: ReturnType<Scene["camera"]>) {
    const w = s.texture.width * s.scale.x;
    const h = s.texture.height * s.scale.y;
    const x0 = s.position.x - s.anchor.x * w;
    const y0 = s.position.y - s.anchor.y * h;
    this.lay(s, s.texture, null, x0, y0, x0 + w, y0 + h, cam);
  }

  /** A flat layer drawn in world coordinates: drawn into a texture, then laid on the ground. */
  private layLayer(c: Container, cam: ReturnType<Scene["camera"]>) {
    const b = c.getLocalBounds();
    if (!c.visible || b.maxX <= b.minX || b.maxY <= b.minY) {
      const l = this.laid.get(c);
      if (l) l.mesh.visible = false;
      return;
    }
    // (Sized up in steps, so a layer that grows a little doesn't need a new texture every frame.)
    const step = 128;
    const w = Math.min(4096, Math.ceil((b.maxX - b.minX + 1) / step) * step);
    const h = Math.min(4096, Math.ceil((b.maxY - b.minY + 1) / step) * step);
    const x0 = Math.floor(b.minX);
    const y0 = Math.floor(b.minY);
    let rt = this.laid.get(c)?.rt ?? null;
    if (!rt || rt.width < w || rt.height < h) {
      rt = RenderTexture.create({ width: w, height: h, scaleMode: "nearest" });
    }
    // Drawn on its own (taken out of the scene for a moment), shifted to the texture's corner.
    const parent = c.parent!;
    const at = parent.getChildIndex(c);
    parent.removeChildAt(at);
    this.app.renderer.render({ container: c, target: rt, clear: true, transform: new Matrix(1, 0, 0, 1, -x0, -y0) });
    parent.addChildAt(c, at);
    this.lay(c, rt, rt, x0, y0, x0 + rt.width, y0 + rt.height, cam);
  }

  /** Meshes for things that went away go too. */
  private pruneLaid() {
    for (const [c, l] of this.laid) {
      if (c.destroyed || !c.parent) {
        l.mesh.destroy();
        l.rt?.destroy(true);
        this.laid.delete(c);
      }
    }
  }

  /** Tilts a layer drawn in world coordinates all at once (exact at your feet, close enough around). */
  private placeWhole(c: Container, cam: ReturnType<Scene["camera"]>) {
    this.save(c);
    c.position.set(cam.ox + (c.position.x - cam.fx) * cam.z, cam.oy + (c.position.y - cam.fy) * cam.z * SIN);
    c.scale.set(c.scale.x * cam.z, c.scale.y * cam.z * SIN);
  }

  /** Just before the frame is drawn: everything where the tilted camera sees it. */
  private tilt() {
    if (!this.view3d || !this.world.visible) return;
    const cam = this.camera();
    const w = this.world;
    this.worldAt = { x: w.position.x, y: w.position.y, s: w.scale.x };
    w.position.set(0, 0);
    w.scale.set(1);

    // The ground, chunk by chunk, in true perspective.
    this.ground.visible = false;
    this.ground3d.visible = true;
    for (const c of this.chunks.values()) {
      const g = c.ground;
      const x0 = g.position.x;
      const y0 = g.position.y;
      const x1 = x0 + g.texture.width;
      const y1 = y0 + g.texture.height;
      const a = this.project(x0, y0, cam);
      const b = this.project(x1, y0, cam);
      const r = this.project(x1, y1, cam);
      const l = this.project(x0, y1, cam);
      if (!c.mesh) {
        c.mesh = new PerspectiveMesh({ texture: g.texture, verticesX: 8, verticesY: 8 });
        this.ground3d.addChild(c.mesh);
      }
      c.mesh.visible = !!(a && b && r && l);
      if (a && b && r && l) c.mesh.setCorners(a.x, a.y, b.x, b.y, r.x, r.y, l.x, l.y);
    }

    // Standing things stand up; flat things lie down. (Sorted by foot, so
    // the nearest are drawn last.) Something drawn straight in world
    // coordinates, with no foot to go by, tilts as one piece.
    // Big flat things (a carpet, the dance floor, burning sand) are laid in
    // true perspective, as the ground is, so they stay put on it.
    this.pruneLaid();
    for (const c of [...this.sorted.children]) {
      if (c instanceof PerspectiveMesh) continue;
      if (this.flatLayers.has(c)) this.layLayer(c, cam);
      else if (lying.has(c) && c instanceof Sprite && (Math.abs(c.width) > LAY_TILES * TILE || Math.abs(c.height) > LAY_TILES * TILE)) this.laySprite(c, cam);
      else if (c.zIndex === 0 && c.position.x === 0 && c.position.y === 0) this.placeWhole(c, cam);
      else if (lying.has(c)) this.place(c, c.position.y, true, cam);
      else this.place(c, c.zIndex, false, cam);
    }
    for (const c of w.children) {
      if (c === this.ground || c === this.ground3d || c === this.sorted) continue;
      if (c.position.x === 0 && c.position.y === 0) this.placeWhole(c, cam);
      else this.place(c, c.position.y, true, cam);
    }
    this.layers3d = this.layers3d.filter((l) => !l.c.destroyed);
    for (const { c, whole } of this.layers3d) {
      if (!c.visible) continue;
      this.save(c);
      c.position.set(0, 0);
      c.scale.set(1);
      if (whole) this.placeWhole(c, cam);
      else for (const k of c.children) this.place(k, k.position.y, true, cam);
    }

    // Outdoors, the far distance fades into haze.
    if (this.map.streets) {
      this.haze ??= this.makeHaze();
      const { width, height } = this.app.screen;
      this.haze.visible = true;
      this.haze.width = width;
      this.haze.height = height * 0.42;
    }
  }

  /** Just after the frame is drawn: everything back where the game left it. */
  private level() {
    if (!this.saved.length && this.ground.visible) return;
    for (let i = this.saved.length - 1; i >= 0; i--) {
      const s = this.saved[i];
      if (s.c.destroyed) continue;
      s.c.position.set(s.x, s.y);
      s.c.scale.set(s.sx, s.sy);
      s.c.visible = s.visible;
    }
    this.saved.length = 0;
    for (const l of this.laid.values()) l.mesh.visible = false;
    this.world.position.set(this.worldAt.x, this.worldAt.y);
    this.world.scale.set(this.worldAt.s);
    this.ground.visible = true;
  }

  /** A soft sky-coloured fade from the top of the screen, just over the world. */
  private makeHaze(): Sprite {
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 128;
    const g = cv.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "rgba(206, 226, 240, 0.92)");
    grad.addColorStop(0.35, "rgba(206, 226, 240, 0.45)");
    grad.addColorStop(1, "rgba(206, 226, 240, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1, 128);
    const s = new Sprite(Texture.from(cv));
    s.texture.source.scaleMode = "linear";
    s.visible = false;
    this.app.stage.addChildAt(s, this.app.stage.getChildIndex(this.world) + 1);
    return s;
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
    // The zoom glides to where it's headed.
    const dt = Math.min(0.1, (now - this.zoomAt) / 1000);
    this.zoomAt = now;
    if (this.zoom !== this.zoomTo) {
      const next = this.zoom + (this.zoomTo - this.zoom) * (1 - Math.exp(-dt / 0.085));
      this.zoom = Math.abs(this.zoomTo - next) < 0.01 ? this.zoomTo : next;
      this.resize();
    }
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
