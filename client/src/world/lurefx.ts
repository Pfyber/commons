// A glimmer lure in the water: for five minutes a circle of water round it
// (a 5×5 circle of tiles) shimmers light blue, fish leap out of it now and
// then, bits of glimmer twinkle on the surface, and the minutes left are
// written in the middle. Lines cast into it bite rarer fish (the server
// decides; this is only the show).

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { TILE, toTexture } from "./art";
import { drawPixelText, pixelWidth } from "./pixelfont";
import { itemTexture } from "./items";
import { type ZoneMap, groundAt } from "./map";
import type { TileXY } from "./motion";
import type { Scene } from "./scene";

/** Tiles within √5 of the centre: the server's `LURE_R2`. */
const R2 = 5;
/** A fish leaps out about this often (ms), somewhere in the circle. */
const LEAP_EVERY = 1300;
const LEAP_MS = 750;
/** How high (px) a leap goes. */
const LEAP_HEIGHT = 16;
const GLIMMERS = 9;
/** The lured water, and the shimmer's colours sweeping over it (4-pixel blocks). */
const AQUA = 0x2ee6ff;
const SHEEN = [0xffffff, 0xa8fff4, 0xff9ff0, 0xc49bff, 0x8fe3ff];
const SHEEN_PX = 4;
/** The legendary lure's water: molten gold, its shimmer white-gold to amber. */
const GOLD = 0xffc23a;
const GOLD_SHEEN = [0xffffff, 0xfff3a8, 0xffe066, 0xffb020, 0xfff8e3];
/** The magnet lure's water: deep purple, its shimmer lilac to violet. */
const PURPLE = 0xa040ff;
const PURPLE_SHEEN = [0xffffff, 0xe8c8ff, 0xc49bff, 0x8f5bff, 0xff9ff0];
/** Which lure (`commons_protocol::lure`). */
export const LURE = { GLIMMER: 0, GOLD: 1, MAGNET: 2 };
/** Each lure's item, as thrown. */
const LURE_KEY = ["fish_lure", "gold_lure", "magnet_lure"];
/** A thrown lure's flight (ms), and how high it arcs (px). */
const TOSS_MS = 650;
const TOSS_HEIGHT = 34;
/** Where a lure would go, while you decide. */
const PREVIEW = 0xbff8ff;
/** Full strength out to this far from the middle (tiles), gone by this far. */
const FADE_IN = 1.3;
const FADE_OUT = 2.7;
/** Fish seen leaping (just for show). */
const LEAPERS = ["bluegill", "perch", "rainbow_trout", "pike", "bass", "moonfish", "golden_koi", "carp"];
/** The rarer metals seen tumbling up out of a magnet lure's water, instead. */
const METALS = ["pocket_watch", "brass_compass", "old_key", "brass_bell", "gold_idol"];

interface Leap {
  fish: Sprite;
  from: { x: number; y: number };
  to: { x: number; y: number };
  start: number;
  splashed: boolean;
}

interface Ring {
  g: Graphics;
  x: number;
  y: number;
  start: number;
}

interface Lure {
  /** Under the avatars: the shimmering tiles. Above: leaps, glimmer, the timer. */
  water: Graphics;
  top: Container;
  timer: Sprite;
  shown: string;
  glimmer: { g: Graphics; phase: number; tile: TileXY }[];
  tiles: TileXY[];
  /** All it may shimmer over (see `reach`). */
  area: TileXY[];
  centre: { x: number; y: number };
  ends: number;
  nextLeap: number;
  leaps: Leap[];
  rings: Ring[];
  /** Its glow after dark. */
  glow: Sprite | null;
  /** Which lure (`LURE`): blue water, gold, or the magnet lure's purple. */
  kind: number;
  /** When it shows (wall ms): as the thrown lure lands. */
  appearAt: number;
}

/** A lure in flight from the thrower's hand to the water. */
interface Toss {
  s: Sprite;
  from: { x: number; y: number };
  to: TileXY;
  start: number;
}

/** Where a lure would go: its circle, fading in while you choose, and out after. */
interface Preview {
  g: Graphics;
  tiles: TileXY[];
  /** All it may shimmer over (see `reach`). */
  area: TileXY[];
  centre: { x: number; y: number };
  at: TileXY;
  shownAt: number;
  /** When it began fading out (0: still showing). */
  goneAt: number;
}

const PREVIEW_FADE_MS = 250;

/** A 4-pixel block of lured water, and which lure draws it. */
interface Block {
  x: number;
  y: number;
  dx: number;
  dy: number;
  fade: number;
  l: Lure;
}

export class LureShows {
  private lures = new Map<string, Lure>();
  /**
   * Where the water really is, pixel by pixel (a rounded pond's edge and its
   * stones don't follow the tiles): true / false, or null where it can't say
   * (then it's the tiles).
   */
  wet: (x: number, y: number) => boolean | null = () => null;
  /**
   * A rounded pond's painted edge: the shimmer goes just above it (it paints
   * water over the old square shore, which would hide the shimmer there),
   * kept off its stones by `wet`.
   */
  over: () => Container | null = () => null;
  private tosses: Toss[] = [];
  private preview: Preview | null = null;

  constructor(
    private scene: Scene,
    private map: ZoneMap,
    /** A glow for the night (as the fountain's), round a lure. */
    private nightGlow: (x: number, y: number, color: number) => Sprite | null = () => null,
  ) {}

  /** A lure at `at`, until instance time `ends`. */
  show(at: TileXY, ends: number, kind = LURE.GLIMMER) {
    const key = `${at.x},${at.y}`;
    // (Thrown just now: it shows as it lands.)
    const toss = this.tosses.find((t) => t.to.x === at.x && t.to.y === at.y);
    const appearAt = toss ? toss.start + TOSS_MS : 0;
    this.remove(key);
    const tiles = this.circle(at);
    // Its glowing water: a see-through aqua wash over the pond.
    const water = new Graphics();
    // (Put on the ground once it has been painted: see `paintWater`.)
    const top = new Container();
    top.zIndex = 1e9;
    const timer = new Sprite();
    timer.anchor.set(0.5);
    timer.alpha = 0.55;
    const centre = { x: at.x * TILE + TILE / 2, y: at.y * TILE + TILE / 2 };
    timer.position.set(centre.x, centre.y);
    const glimmer = Array.from({ length: GLIMMERS }, (_, i) => {
      const g = new Graphics().star(0, 0, 4, 2.6, 0.9).fill({ color: kind === LURE.GOLD ? (i % 2 ? 0xfff3a8 : 0xffd23f) : kind === LURE.MAGNET ? (i % 2 ? 0xe8c8ff : 0xffffff) : i % 3 ? 0xffffff : 0xfff3a8 });
      top.addChild(g);
      return { g, phase: Math.random() * Math.PI * 2, tile: tiles[Math.floor(Math.random() * tiles.length)] ?? at };
    });
    top.addChild(timer);
    this.scene.world.addChild(top);
    this.scene.layer3d(top, false, true);
    const glow = this.nightGlow(centre.x, centre.y, kind === LURE.MAGNET ? 0xb060ff : 0x5ff0ff);
    this.lures.set(key, { water, top, timer, shown: "", glimmer, tiles, area: this.reach(at), centre, ends, nextLeap: 0, leaps: [], rings: [], glow, kind, appearAt });
  }

  /**
   * A lure thrown from `from` (world px: the thrower's hand) into the water
   * at `to`: it spins up and over in an arc and splashes in.
   */
  toss(from: { x: number; y: number }, to: TileXY, kind: number) {
    const s = new Sprite(itemTexture(LURE_KEY[kind] ?? LURE_KEY[0], "tool"));
    s.anchor.set(0.5);
    s.scale.set(0.75);
    s.zIndex = 1e9;
    this.scene.world.addChild(s);
    const start = performance.now();
    this.tosses.push({ s, from, to, start });
    const l = this.lures.get(`${to.x},${to.y}`);
    if (l) l.appearAt = start + TOSS_MS;
  }

  private flyTosses(wallNow: number) {
    this.tosses = this.tosses.filter((t) => {
      const k = (wallNow - t.start) / TOSS_MS;
      const tx = t.to.x * TILE + TILE / 2;
      const ty = t.to.y * TILE + TILE / 2;
      if (k >= 1) {
        t.s.destroy();
        // The splash: rings out from where it went in.
        const l = this.lures.get(`${t.to.x},${t.to.y}`);
        if (l) {
          this.ring(l, tx, ty, wallNow);
          this.ring(l, tx, ty, wallNow + 120);
        }
        return false;
      }
      // Up and over, a little faster at the end (it drops in).
      const e = k * k * 0.35 + k * 0.65;
      const dist = Math.hypot(tx - t.from.x, ty - t.from.y);
      const h = Math.min(TOSS_HEIGHT + dist * 0.15, 70);
      t.s.position.set(t.from.x + (tx - t.from.x) * e, t.from.y + (ty - t.from.y) * e - Math.sin(e * Math.PI) * h);
      t.s.rotation = k * Math.PI * 3;
      return true;
    });
  }

  /**
   * Every tile the shimmer can reach round `at` (out to `FADE_OUT`): wider
   * than the lure's circle, so its soft edge fades out on its own instead of
   * being cut off along tile edges. Which of it is water is decided block by
   * block (`waterAt`).
   */
  private reach(at: TileXY): TileXY[] {
    const r = Math.ceil(FADE_OUT);
    const tiles: TileXY[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) tiles.push({ x: at.x + dx, y: at.y + dy });
    return tiles;
  }

  /** Whether world pixel (x, y) is water the shimmer may cover (a rounded pond's own say, else the tile's). */
  private waterAt(x: number, y: number): boolean {
    return this.wet(x, y) ?? groundAt(this.map, Math.floor(x / TILE), Math.floor(y / TILE)) === "water";
  }

  /** The water tiles of a lure's circle round `at`. */
  private circle(at: TileXY): TileXY[] {
    const tiles: TileXY[] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = { x: at.x + dx, y: at.y + dy };
        if (dx * dx + dy * dy > R2) continue;
        const pond = this.wet(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2);
        if (pond ?? groundAt(this.map, t.x, t.y) === "water") tiles.push(t);
      }
    }
    return tiles;
  }

  /** Shows where a lure thrown at `at` would go (fading in). */
  previewAt(at: TileXY) {
    const p = this.preview;
    if (p && p.at.x === at.x && p.at.y === at.y && !p.goneAt) return;
    p?.g.destroy();
    const g = new Graphics();
    const edge = this.over();
    if (edge?.parent === this.scene.world) {
      this.scene.world.addChildAt(g, this.scene.world.getChildIndex(edge) + 1);
      this.scene.lieFlat(g);
    } else this.scene.onGround(g);
    const now = performance.now();
    this.preview = { g, tiles: this.circle(at), area: this.reach(at), centre: { x: at.x * TILE + TILE / 2, y: at.y * TILE + TILE / 2 }, at, shownAt: now, goneAt: 0 };
  }

  /** …and lets it fade away (chosen, or not). */
  endPreview() {
    if (this.preview && !this.preview.goneAt) this.preview.goneAt = performance.now();
  }

  get previewing(): boolean {
    return !!this.preview && !this.preview.goneAt;
  }

  private drawPreview(wallNow: number) {
    const p = this.preview;
    if (!p) return;
    const fadeIn = Math.min(1, (wallNow - p.shownAt) / PREVIEW_FADE_MS);
    const fadeOut = p.goneAt ? 1 - (wallNow - p.goneAt) / PREVIEW_FADE_MS : 1;
    const k = Math.min(fadeIn, fadeOut);
    if (k <= 0) {
      p.g.destroy();
      this.preview = null;
      return;
    }
    // The circle, soft-edged as the lure's own, pale and gently pulsing;
    // the tile it lands on a little brighter.
    const pulse = 0.75 + 0.25 * Math.sin(wallNow / 220);
    p.g.clear();
    for (const t of p.area) {
      for (let by = 0; by < TILE; by += SHEEN_PX) {
        for (let bx = 0; bx < TILE; bx += SHEEN_PX) {
          const x = t.x * TILE + bx;
          const y = t.y * TILE + by;
          if (!this.waterAt(x + SHEEN_PX / 2, y + SHEEN_PX / 2)) continue;
          const d = Math.hypot(x + SHEEN_PX / 2 - p.centre.x, y + SHEEN_PX / 2 - p.centre.y) / TILE;
          const fade = Math.min(1, Math.max(0, (FADE_OUT - d) / (FADE_OUT - FADE_IN)));
          if (fade <= 0) continue;
          const middle = t.x === p.at.x && t.y === p.at.y ? 0.25 : 0;
          p.g.rect(x, y, SHEEN_PX, SHEEN_PX).fill({ color: PREVIEW, alpha: (0.22 * fade + middle) * pulse * k });
        }
      }
    }
  }

  /** Whether tile `t` is in a lure's circle right now. */
  covers(t: TileXY, serverNow: number): boolean {
    for (const l of this.lures.values()) {
      if (l.ends > serverNow && l.tiles.some((w) => w.x === t.x && w.y === t.y)) return true;
    }
    return false;
  }

  update(serverNow: number, wallNow: number) {
    this.drawPreview(wallNow);
    this.flyTosses(wallNow);
    // Each bit of lured water is drawn once, by the lure whose middle it's
    // nearest (where circles overlap), so two side by side don't pile up
    // into one too bright.
    const blocks = new Map<string, Block>();
    for (const [key, l] of this.lures) {
      const left = l.ends - serverNow;
      if (left <= 0) {
        this.remove(key);
        continue;
      }
      // Not landed yet: nothing to see; then it spreads out from the splash.
      const shown = Math.min(1, Math.max(0, (wallNow - l.appearAt) / 500));
      l.top.visible = shown > 0;
      if (shown <= 0) continue;
      // Its circle of water, block by block, for the drawing below.
      for (const t of l.area) {
        for (let by = 0; by < TILE; by += SHEEN_PX) {
          for (let bx = 0; bx < TILE; bx += SHEEN_PX) {
            const x = t.x * TILE + bx;
            const y = t.y * TILE + by;
            // (Only real water: not over a rounded pond's edge or its stones.)
            if (!this.waterAt(x + SHEEN_PX / 2, y + SHEEN_PX / 2)) continue;
            const dx = x + SHEEN_PX / 2 - l.centre.x;
            const dy = y + SHEEN_PX / 2 - l.centre.y;
            // Round, and fading out softly towards its rim (no hard tile edges).
            const fade = Math.min(1, Math.max(0, (FADE_OUT * shown - Math.hypot(dx, dy) / TILE) / (FADE_OUT - FADE_IN)));
            if (fade <= 0) continue;
            const k = `${x},${y}`;
            const was = blocks.get(k);
            if (!was || was.fade < fade) blocks.set(k, { x, y, dx, dy, fade, l });
          }
        }
      }
      // Bits of glimmer: each twinkles in turn, then pops up somewhere else.
      for (const g of l.glimmer) {
        const s = Math.sin(wallNow / 260 + g.phase);
        if (s < -0.98) {
          g.tile = l.tiles[Math.floor(Math.random() * l.tiles.length)] ?? g.tile;
          g.phase = Math.random() * Math.PI * 2;
        }
        g.g.alpha = Math.max(0, s);
        g.g.scale.set(0.6 + 0.5 * Math.max(0, s));
        g.g.rotation = wallNow / 900 + g.phase;
        g.g.position.set(g.tile.x * TILE + 4 + ((g.phase * 37) % 8), g.tile.y * TILE + 4 + ((g.phase * 53) % 8));
      }
      // Now and then a fish leaps out, arcs over and drops back in.
      if (wallNow > l.nextLeap && l.tiles.length) {
        l.nextLeap = wallNow + LEAP_EVERY * (0.6 + Math.random() * 0.8);
        // From one tile to another a tile or two across, so it arcs over.
        const a = l.tiles[Math.floor(Math.random() * l.tiles.length)];
        const across = l.tiles.filter((t) => t.y === a.y && Math.abs(t.x - a.x) >= 1 && Math.abs(t.x - a.x) <= 2);
        const b = across[Math.floor(Math.random() * across.length)] ?? a;
        const metal = l.kind === LURE.MAGNET;
        const pool = metal ? METALS : LEAPERS;
        const fish = new Sprite(itemTexture(pool[Math.floor(Math.random() * pool.length)], metal ? "scrap" : "fish"));
        fish.anchor.set(0.5);
        fish.scale.set(0.5);
        l.top.addChildAt(fish, 0);
        const from = { x: a.x * TILE + TILE / 2, y: a.y * TILE + TILE / 2 };
        const to = { x: b.x * TILE + TILE / 2 + (b === a ? (Math.random() < 0.5 ? -8 : 8) : 0), y: b.y * TILE + TILE / 2 };
        l.leaps.push({ fish, from, to, start: wallNow, splashed: false });
        this.ring(l, from.x, from.y, wallNow);
      }
      l.leaps = l.leaps.filter((p) => {
        const t = (wallNow - p.start) / LEAP_MS;
        if (t >= 1) {
          if (!p.splashed) this.ring(l, p.to.x, p.to.y, wallNow);
          p.fish.destroy();
          return false;
        }
        const x = p.from.x + (p.to.x - p.from.x) * t;
        const y = p.from.y + (p.to.y - p.from.y) * t - Math.sin(t * Math.PI) * LEAP_HEIGHT;
        p.fish.position.set(x, y);
        // Facing the way it leaps, nose along its arc: up on the way out,
        // over the top, down into the water. (The drawings face left.)
        const vx = p.to.x - p.from.x;
        const vy = p.to.y - p.from.y - Math.cos(t * Math.PI) * Math.PI * LEAP_HEIGHT;
        const right = vx >= 0;
        const along = Math.atan2(vy, vx);
        p.fish.scale.x = right ? -0.5 : 0.5;
        p.fish.rotation = right ? along : along - Math.PI;
        // A little wriggle as it goes.
        p.fish.rotation += Math.sin(t * Math.PI * 6) * 0.12;
        return true;
      });
      // Splash rings spreading where they leave and land.
      l.rings = l.rings.filter((r) => {
        const t = (wallNow - r.start) / 500;
        if (t >= 1) {
          r.g.destroy();
          return false;
        }
        r.g.clear().ellipse(r.x, r.y + 2, 3 + t * 7, (3 + t * 7) * 0.45).stroke({ color: 0xffffff, width: 1, alpha: 1 - t });
        return true;
      });
      // Minutes and seconds left, in the middle.
      const secs = Math.ceil(left / 1000);
      const text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      if (text !== l.shown) {
        l.shown = text;
        l.timer.texture = timerTexture(text);
      }
    }
    this.paintWater(blocks, wallNow);
  }

  /**
   * The lured water: a saturated aqua, see-through and breathing; and over it
   * a shimmer (like Terraria's): bands of iridescent light, aqua to pink to
   * violet, sweeping across it in 4-pixel blocks, round each circle.
   */
  private paintWater(blocks: Map<string, Block>, wallNow: number) {
    for (const l of this.lures.values()) l.water.clear();
    const breathe = 0.5 + 0.5 * Math.sin(wallNow / 600);
    // Its glow in the dark breathes with the water.
    for (const l of this.lures.values()) if (l.glow) l.glow.alpha = 0.5 + 0.16 * breathe;
    const spin = wallNow / 1400;
    for (const b of blocks.values()) {
      const g = b.l.water;
      const kind = b.l.kind;
      g.rect(b.x, b.y, SHEEN_PX, SHEEN_PX).fill({ color: kind === LURE.GOLD ? GOLD : kind === LURE.MAGNET ? PURPLE : AQUA, alpha: (kind === LURE.GLIMMER ? 0.42 : 0.55) * b.fade + 0.1 * breathe * b.fade });
      const phase = (b.dx + b.dy) * 0.09 + Math.atan2(b.dy, b.dx) * 2 - spin * 4;
      const band = Math.sin(phase);
      if (band < 0.55) continue;
      const sheen = kind === LURE.GOLD ? GOLD_SHEEN : kind === LURE.MAGNET ? PURPLE_SHEEN : SHEEN;
      const hue = sheen[Math.floor(((phase / (Math.PI * 2)) % 1 + 1) % 1 * sheen.length)];
      g.rect(b.x, b.y, SHEEN_PX, SHEEN_PX).fill({ color: hue, alpha: (band - 0.55) * 1.1 * b.fade });
    }
    // A new lure goes onto the ground (just above it, under everything
    // standing on it) only now it has something drawn: added while still
    // blank, the renderer could pass it over and never show it.
    for (const l of this.lures.values()) {
      if (!l.water.parent && l.water.context.instructions.length) {
        const edge = this.over();
        const world = this.scene.world;
        if (edge?.parent === world) {
          world.addChildAt(l.water, world.getChildIndex(edge) + 1);
          this.scene.lieFlat(l.water);
        } else this.scene.onGround(l.water);
      }
    }
  }

  private ring(l: Lure, x: number, y: number, now: number) {
    const g = new Graphics();
    l.top.addChildAt(g, 0);
    l.rings.push({ g, x, y, start: now });
  }

  private remove(key: string) {
    const l = this.lures.get(key);
    if (!l) return;
    l.water.destroy();
    l.top.destroy({ children: true });
    l.glow?.destroy();
    this.lures.delete(key);
  }

  destroy() {
    this.preview?.g.destroy();
    this.preview = null;
    for (const key of [...this.lures.keys()]) this.remove(key);
  }
}

const timerCache = new Map<string, Texture>();

/** "4:40" in the game's pixel font: white with a dark outline, small. */
function timerTexture(text: string): Texture {
  const hit = timerCache.get(text);
  if (hit) return hit;
  const w = pixelWidth(text) + 2;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = 7;
  const ctx = c.getContext("2d")!;
  for (const [ox, oy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]]) drawPixelText(ctx, text, ox, oy, "#0d1f6e");
  drawPixelText(ctx, text, 1, 1, "#ffffff");
  const t = toTexture(c);
  timerCache.set(text, t);
  return t;
}
