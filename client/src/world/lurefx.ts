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
/** Where a lure would go, while you decide. */
const PREVIEW = 0xbff8ff;
/** Full strength out to this far from the middle (tiles), gone by this far. */
const FADE_IN = 1.3;
const FADE_OUT = 2.7;
/** Fish seen leaping (just for show). */
const LEAPERS = ["bluegill", "perch", "rainbow_trout", "pike", "bass", "moonfish", "golden_koi", "carp"];

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
  centre: { x: number; y: number };
  ends: number;
  nextLeap: number;
  leaps: Leap[];
  rings: Ring[];
}

/** Where a lure would go: its circle, fading in while you choose, and out after. */
interface Preview {
  g: Graphics;
  tiles: TileXY[];
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
  private preview: Preview | null = null;

  constructor(
    private scene: Scene,
    private map: ZoneMap,
  ) {}

  /** A lure at `at`, until instance time `ends`. */
  show(at: TileXY, ends: number) {
    const key = `${at.x},${at.y}`;
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
      const g = new Graphics().star(0, 0, 4, 2.6, 0.9).fill({ color: i % 3 ? 0xffffff : 0xfff3a8 });
      top.addChild(g);
      return { g, phase: Math.random() * Math.PI * 2, tile: tiles[Math.floor(Math.random() * tiles.length)] ?? at };
    });
    top.addChild(timer);
    this.scene.world.addChild(top);
    this.lures.set(key, { water, top, timer, shown: "", glimmer, tiles, centre, ends, nextLeap: 0, leaps: [], rings: [] });
  }

  /** The water tiles of a lure's circle round `at`. */
  private circle(at: TileXY): TileXY[] {
    const tiles: TileXY[] = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = { x: at.x + dx, y: at.y + dy };
        if (dx * dx + dy * dy <= R2 && groundAt(this.map, t.x, t.y) === "water") tiles.push(t);
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
    this.scene.onGround(g);
    const now = performance.now();
    this.preview = { g, tiles: this.circle(at), centre: { x: at.x * TILE + TILE / 2, y: at.y * TILE + TILE / 2 }, at, shownAt: now, goneAt: 0 };
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
    for (const t of p.tiles) {
      for (let by = 0; by < TILE; by += SHEEN_PX) {
        for (let bx = 0; bx < TILE; bx += SHEEN_PX) {
          const x = t.x * TILE + bx;
          const y = t.y * TILE + by;
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
      // Its circle of water, block by block, for the drawing below.
      for (const t of l.tiles) {
        for (let by = 0; by < TILE; by += SHEEN_PX) {
          for (let bx = 0; bx < TILE; bx += SHEEN_PX) {
            const x = t.x * TILE + bx;
            const y = t.y * TILE + by;
            const dx = x + SHEEN_PX / 2 - l.centre.x;
            const dy = y + SHEEN_PX / 2 - l.centre.y;
            // Round, and fading out softly towards its rim (no hard tile edges).
            const fade = Math.min(1, Math.max(0, (FADE_OUT - Math.hypot(dx, dy) / TILE) / (FADE_OUT - FADE_IN)));
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
        const fish = new Sprite(itemTexture(LEAPERS[Math.floor(Math.random() * LEAPERS.length)], "fish"));
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
    const spin = wallNow / 1400;
    for (const b of blocks.values()) {
      const g = b.l.water;
      g.rect(b.x, b.y, SHEEN_PX, SHEEN_PX).fill({ color: AQUA, alpha: (0.42 + 0.1 * breathe) * b.fade });
      const phase = (b.dx + b.dy) * 0.09 + Math.atan2(b.dy, b.dx) * 2 - spin * 4;
      const band = Math.sin(phase);
      if (band < 0.55) continue;
      const hue = SHEEN[Math.floor(((phase / (Math.PI * 2)) % 1 + 1) % 1 * SHEEN.length)];
      g.rect(b.x, b.y, SHEEN_PX, SHEEN_PX).fill({ color: hue, alpha: (band - 0.55) * 1.1 * b.fade });
    }
    // A new lure goes onto the ground (just above it, under everything
    // standing on it) only now it has something drawn: added while still
    // blank, the renderer could pass it over and never show it.
    for (const l of this.lures.values()) {
      if (!l.water.parent && l.water.context.instructions.length) this.scene.onGround(l.water);
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
