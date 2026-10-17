// Pets (ADR 0011, M5): how they look, and a pet on the map (at a walker's
// heels, in its yard, or in a pen at the Pets shop). A pet's `code` (from
// its item, and in `EntityInfo.pet`) is its species in the low byte and its
// coat above.

import { Container, Sprite, type Texture } from "pixi.js";
import { TILE, toTexture } from "./art";
import type { TileXY } from "./motion";

const O = "#3b3a2e";

interface Coat {
  fur: string;
  dark: string;
  /** Patches (spotted puppy, corgi's white). */
  patch?: string;
}

/** Coats by species, then by coat byte. */
const COATS: Record<number, Record<number, Coat>> = {
  1: { 1: { fur: "#e0b25c", dark: "#b88638" }, 2: { fur: "#f4efe4", dark: "#c9c0ad", patch: "#3b3a2e" }, 3: { fur: "#e08a3c", dark: "#b0652a", patch: "#fff6e6" } },
  2: { 1: { fur: "#e39b4a", dark: "#c07a32" }, 2: { fur: "#45434f", dark: "#2c2b33" } },
  3: { 1: { fur: "#efe6da", dark: "#c8b9a6" } },
  4: { 1: { fur: "#f6d64a", dark: "#d9b02a" } },
  5: { 1: { fur: "#9b7b5c", dark: "#6e543d", patch: "#e9d2b0" } },
};

export const SPECIES: Record<number, string> = { 1: "puppy", 2: "kitten", 3: "bunny", 4: "duckling", 5: "hedgehog" };

/** What a pet does: what its walker sees it say. */
export const PET_SOUNDS: Record<number, string[]> = {
  1: ["Woof!", "*wags*", "*sniff sniff*"],
  2: ["Mrrp.", "*purrs*", "Mew!"],
  3: ["*twitches nose*", "*hops*"],
  4: ["Peep!", "Quack!"],
  5: ["*snuffles*", "*huff*"],
};

function px(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/**
 * The pet facing right on a 24×18 canvas, feet on the bottom row. Frames: 0
 * standing, 1 mid-step, 2 sitting.
 */
export function petCanvas(code: number, frame: 0 | 1 | 2 = 0): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 24;
  c.height = 18;
  const ctx = c.getContext("2d")!;
  const species = code & 0xff;
  const coat = COATS[species]?.[(code >> 8) & 0xff] ?? COATS[species]?.[1] ?? COATS[1][1];
  const { fur, dark, patch } = coat;
  const step = frame === 1;
  const sit = frame === 2;
  const legs = (xs: number[], top: number) => {
    xs.forEach((x, i) => px(ctx, O, x, top - (step && i % 2 ? 1 : 0), 2, 18 - top + (step && i % 2 ? 1 : 0)));
  };
  switch (species) {
    case 2: {
      // Kitten: slim, tail up, pointed ears.
      if (!sit) legs([6, 9, 14, 17], 14);
      px(ctx, O, 4, sit ? 9 : 8, 15, sit ? 9 : 7);
      px(ctx, fur, 5, sit ? 10 : 9, 13, sit ? 7 : 5);
      px(ctx, dark, 8, sit ? 10 : 9, 2, 4);
      px(ctx, dark, 12, sit ? 10 : 9, 2, 4);
      px(ctx, O, 2, sit ? 9 : 2, 2, sit ? 8 : 8);
      px(ctx, O, 15, 3, 8, 7);
      px(ctx, fur, 16, 4, 6, 5);
      px(ctx, O, 15, 1, 2, 2);
      px(ctx, O, 20, 1, 2, 2);
      px(ctx, O, 20, 6, 1, 1);
      px(ctx, "#f2a7b0", 22, 7, 1, 1);
      break;
    }
    case 3: {
      // Bunny: round, long lop ears, a cotton tail.
      px(ctx, O, 3, 8, 15, 10);
      px(ctx, fur, 4, 9, 13, 8);
      px(ctx, "#ffffff", 2, 10, 3, 3);
      if (step) px(ctx, fur, 4, 16, 4, 2);
      px(ctx, O, 13, 4, 9, 9);
      px(ctx, fur, 14, 5, 7, 7);
      px(ctx, O, 12, 5, 3, 9);
      px(ctx, dark, 13, 6, 1, 7);
      px(ctx, O, 19, 7, 1, 1);
      px(ctx, "#f2a7b0", 21, 9, 1, 1);
      break;
    }
    case 4: {
      // Duckling: a round yellow ball with an orange bill.
      if (!sit) {
        px(ctx, "#e07a2a", 9, 16 - (step ? 1 : 0), 2, 2);
        px(ctx, "#e07a2a", 13, 16, 2, 2);
      }
      px(ctx, O, 5, 8, 13, sit ? 10 : 9);
      px(ctx, fur, 6, 9, 11, sit ? 8 : 7);
      px(ctx, dark, 7, 11, 5, 3);
      px(ctx, O, 12, 3, 8, 7);
      px(ctx, fur, 13, 4, 6, 5);
      px(ctx, O, 17, 5, 1, 1);
      px(ctx, "#e07a2a", 19, 6, 3, 2);
      break;
    }
    case 5: {
      // Hedgehog: a spiky dome and a pointed pale face.
      if (!sit) legs([7, 14], 15);
      px(ctx, O, 3, 7, 15, 9);
      px(ctx, dark, 4, 8, 13, 7);
      for (let x = 4; x < 17; x += 3) px(ctx, fur, x, 7 + ((x / 3) % 2), 1, 3);
      px(ctx, O, 16, 9, 6, 6);
      px(ctx, patch ?? fur, 16, 10, 5, 4);
      px(ctx, O, 18, 10, 1, 1);
      px(ctx, O, 21, 12, 2, 1);
      break;
    }
    default: {
      // Puppy: sturdy, floppy ears, a wagging tail.
      if (!sit) legs([5, 8, 14, 17], 14);
      px(ctx, O, 3, sit ? 9 : 7, 17, sit ? 9 : 8);
      px(ctx, fur, 4, sit ? 10 : 8, 15, sit ? 7 : 6);
      if (patch) {
        px(ctx, patch, 7, sit ? 11 : 9, 4, 3);
        if (species === 1 && (code >> 8) === 3) px(ctx, patch, 14, 11, 4, sit ? 5 : 3);
      }
      px(ctx, O, 1, step ? 4 : 5, 3, 4);
      px(ctx, O, 14, 2, 9, 8);
      px(ctx, fur, 15, 3, 7, 6);
      px(ctx, O, 14, 3, 3, 6);
      px(ctx, dark, 15, 4, 1, 4);
      px(ctx, O, 19, 4, 1, 1);
      px(ctx, O, 22, 6, 1, 2);
      if (patch && (code >> 8) === 2) px(ctx, patch, 16, 3, 2, 2);
      break;
    }
  }
  return c;
}

const textures = new Map<string, Texture>();

/** A pet frame as a texture (cached). */
export function petTexture(code: number, frame: 0 | 1 | 2 = 0): Texture {
  const key = `${code}:${frame}`;
  let t = textures.get(key);
  if (!t) {
    t = toTexture(petCanvas(code, frame));
    textures.set(key, t);
  }
  return t;
}

let bubbleTex: Texture | null = null;
/** A thought bubble with a ball in it: "a walk?" */
function bubbleTexture(): Texture {
  if (bubbleTex) return bubbleTex;
  const c = document.createElement("canvas");
  c.width = 14;
  c.height = 14;
  const ctx = c.getContext("2d")!;
  px(ctx, O, 2, 0, 10, 10);
  px(ctx, "#fff9ec", 3, 1, 8, 8);
  px(ctx, "#e8566b", 5, 3, 4, 4);
  px(ctx, "#ffffff", 6, 3, 1, 1);
  px(ctx, O, 3, 11, 2, 2);
  px(ctx, O, 1, 13, 1, 1);
  bubbleTex = toTexture(c);
  return bubbleTex;
}

let heartTex: Texture | null = null;
function heartTexture(): Texture {
  if (heartTex) return heartTex;
  const c = document.createElement("canvas");
  c.width = 7;
  c.height = 6;
  const ctx = c.getContext("2d")!;
  px(ctx, "#e8566b", 0, 1, 7, 2);
  px(ctx, "#e8566b", 1, 0, 2, 1);
  px(ctx, "#e8566b", 4, 0, 2, 1);
  px(ctx, "#e8566b", 1, 3, 5, 1);
  px(ctx, "#e8566b", 2, 4, 3, 1);
  px(ctx, "#e8566b", 3, 5, 1, 1);
  heartTex = toTexture(c);
  return heartTex;
}

/** How long hearts float up after a greeting or a pat. */
const HEART_MS = 1600;

/** One pet on the map: where it is, which way it faces, what it's doing. */
export class PetSprite {
  readonly view = new Container();
  private body: Sprite;
  private bubble: Sprite;
  private hearts: Sprite[] = [];
  private heartsUntil = 0;
  pos: TileXY;
  private facing = 1;
  /** Hoping for a walk (a thought bubble). */
  hopeful = false;

  constructor(
    readonly code: number,
    at: TileXY,
  ) {
    this.pos = { ...at };
    this.body = new Sprite(petTexture(code, 0));
    this.body.anchor.set(0.5, 1);
    this.bubble = new Sprite(bubbleTexture());
    this.bubble.anchor.set(0, 1);
    this.bubble.position.set(4, -18);
    this.bubble.visible = false;
    this.view.addChild(this.body, this.bubble);
    for (let i = 0; i < 3; i++) {
      const h = new Sprite(heartTexture());
      h.anchor.set(0.5, 1);
      h.visible = false;
      this.hearts.push(h);
      this.view.addChild(h);
    }
  }

  /** Little hearts float up (pets meeting, a pat). */
  greet(now: number) {
    this.heartsUntil = now + HEART_MS;
  }

  /** Draws the pet at `pos` this frame. */
  draw(now: number, moving: boolean, sitting = false) {
    const frame: 0 | 1 | 2 = moving ? ((Math.floor(now / 140) % 2) as 0 | 1) : sitting ? 2 : 0;
    this.body.texture = petTexture(this.code, frame);
    this.body.scale.x = this.facing;
    const hop = moving ? -Math.abs(Math.sin(now / 80)) * 1.5 : 0;
    this.body.y = hop;
    this.bubble.visible = this.hopeful && !moving && Math.floor(now / 1800) % 3 !== 2;
    const left = this.heartsUntil - now;
    this.hearts.forEach((h, i) => {
      const t = 1 - (left - i * 250) / (HEART_MS - 500);
      h.visible = left > 0 && t >= 0 && t <= 1;
      if (h.visible) h.position.set((i - 1) * 6, -16 - t * 14);
      h.alpha = 1 - Math.max(0, t);
    });
    this.view.position.set(Math.round(this.pos.x * TILE + TILE / 2), Math.round(this.pos.y * TILE + TILE - 5));
    this.view.zIndex = this.pos.y * TILE + TILE - 5;
  }

  face(dx: number) {
    if (Math.abs(dx) > 0.05) this.facing = dx > 0 ? 1 : -1;
  }

  /** Whether a tap at tile (x, y) (fractional) is on the pet. */
  hit(x: number, y: number): boolean {
    return Math.abs(x - (this.pos.x + 0.5)) < 0.7 && y > this.pos.y - 0.4 && y < this.pos.y + 1.1;
  }

  destroy() {
    this.view.destroy({ children: true });
  }
}

/** Tiles per second a pet can trot to catch up. */
const TROT = 8;

/**
 * A pet at someone's heels: it keeps about a tile behind them, trotting to
 * catch up, and sits when they stop.
 */
export class Follower {
  readonly pet: PetSprite;
  private last = 0;
  private still = 0;

  constructor(code: number, at: TileXY) {
    this.pet = new PetSprite(code, { x: at.x - 1, y: at.y });
  }

  /** Follows a walker at `walker` heading `facing` (±1). */
  update(walker: TileXY, facing: number, now: number) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const p = this.pet.pos;
    // A tile behind, a little to the side so it's never hidden behind them.
    const goal = { x: walker.x - facing * 0.9, y: walker.y + 0.25 };
    const dx = goal.x - p.x;
    const dy = goal.y - p.y;
    const d = Math.hypot(dx, dy);
    // Through a door or across the map: just appear beside them.
    if (d > 6) {
      this.pet.pos = goal;
    } else if (d > 0.12) {
      // Trots when it's fallen behind, ambles when it's close.
      const step = Math.min(d, (d > 1.2 ? TROT : 3) * dt);
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
      this.pet.face(dx);
    }
    const moving = d > 0.3;
    if (moving) this.still = now;
    else this.pet.face(walker.x - p.x);
    this.pet.draw(now, moving, now - this.still > 1500);
  }

  destroy() {
    this.pet.destroy();
  }
}
