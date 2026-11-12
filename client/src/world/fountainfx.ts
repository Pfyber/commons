// The Market fountain, alive: water falling from both bowls in streams,
// splashing where it lands, the jet on top bobbing and throwing droplets,
// ripples spreading out over the basin from the pedestal, sparkles on the
// water, and a soft aqua glow breathing over it all. Drawn over the still
// fountain (art.ts, "fountain"), in the same pixels.

import { Container, Sprite, Texture } from "pixi.js";
import { TILE } from "./art";
import type { MapObject } from "./map";
import { type Scene, fountainFoot } from "./scene";

/** The still drawing's sky above the fountain (its overhang), in pixels. */
const TOP = 40;

/** A soft aqua glow, fading to nothing at its edge. */
function glowTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(120,245,255,0.75)");
  g.addColorStop(0.5, "rgba(60,215,240,0.32)");
  g.addColorStop(1, "rgba(40,200,235,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

/** Colours as the canvas takes them (made once each). */
const HEX = new Map<number, string>();

/** Room round the drawing for the water's pixels (the jet, splashes), each side. */
const PAD = 8;

export class FountainFx {
  private root = new Container();
  /**
   * The water's pixels, painted each frame on a small canvas and shown as one
   * picture (the same pixels as before; a canvas fills a few hundred little
   * rectangles in no time, where vector shapes had to be rebuilt each frame).
   */
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private tex: Texture;
  private water: Sprite;
  /** The fountain's box in world pixels (with its overhang): to skip it out of view. */
  private box: { x0: number; y0: number; x1: number; y1: number };
  private glow: Sprite;
  private bowlGlow: Sprite;
  /** Where the still drawing's top-left is, in world pixels. */
  private x0: number;
  private y0: number;
  // The drawing's geometry (as art.ts lays it out).
  private cx: number;
  private cy: number;
  private ix: number;
  private iy: number;

  constructor(
    private scene: Scene,
    obj: MapObject,
  ) {
    const w = obj.w * TILE;
    const h = obj.h * TILE;
    this.x0 = obj.x * TILE;
    this.y0 = obj.y * TILE - TOP;
    this.cx = w / 2;
    this.cy = TOP + h / 2 - 4;
    const rx = w / 2 - 4;
    const ry = Math.round(rx * 0.72);
    this.ix = rx - 9;
    this.iy = ry - 7;
    const tex = glowTexture();
    this.glow = new Sprite(tex);
    this.glow.anchor.set(0.5);
    this.glow.blendMode = "add";
    this.glow.position.set(this.x0 + this.cx, this.y0 + this.cy + 3);
    this.bowlGlow = new Sprite(tex);
    this.bowlGlow.anchor.set(0.5);
    this.bowlGlow.blendMode = "add";
    this.bowlGlow.position.set(this.x0 + this.cx, this.y0 + this.cy - 22);
    this.bowlGlow.scale.set(0.8, 0.3);
    this.canvas.width = w + PAD * 2;
    this.canvas.height = TOP + h + PAD * 2;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    this.tex = Texture.from(this.canvas);
    this.tex.source.scaleMode = "nearest";
    this.water = new Sprite(this.tex);
    this.water.position.set(this.x0 - PAD, this.y0 - PAD);
    this.box = { x0: this.x0 - PAD, y0: this.y0 - PAD, x1: this.x0 + w + PAD, y1: this.y0 + TOP + h + PAD };
    this.root.addChild(this.glow, this.water, this.bowlGlow);
    // Just over the fountain itself, under anyone standing in front of it.
    this.root.zIndex = (obj.y + obj.h) * TILE - 0.5;
    // (Its water is drawn in world pixels; it's held at the pedestal's foot,
    // so in 3D it stands there with the pedestal, falling into the basin.)
    const footX = this.x0 + this.cx;
    const footY = fountainFoot(obj);
    this.root.pivot.set(footX, footY);
    this.root.position.set(footX, footY);
    scene.standOn(this.root, footY);
    scene.sorted.addChild(this.root);
  }

  /** Where the glow's light falls (for the night's lights), in world pixels. */
  get centre(): { x: number; y: number } {
    return { x: this.x0 + this.cx, y: this.y0 + this.cy };
  }

  update(now: number) {
    // Out of view: nothing to animate (it picks up where the clock is when it's back).
    const v = this.scene.viewRect();
    const b = this.box;
    const seen = b.x1 > v.x0 * TILE && b.x0 < v.x1 * TILE && b.y1 > v.y0 * TILE && b.y0 < v.y1 * TILE;
    if (this.root.visible !== seen) this.root.visible = seen;
    if (!seen) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const { cx, cy, ix, iy } = this;
    // (The colour and alpha only set when they change: each set is parsed.)
    let lastColor = -1;
    let lastAlpha = -1;
    const dot = (x: number, y: number, color: number, alpha = 1, w = 1, h = 1) => {
      if (alpha <= 0) return;
      const al = Math.min(1, alpha);
      if (al !== lastAlpha) ctx.globalAlpha = lastAlpha = al;
      if (color !== lastColor) {
        lastColor = color;
        ctx.fillStyle = HEX.get(color) ?? HEX.set(color, `#${color.toString(16).padStart(6, "0")}`).get(color)!;
      }
      ctx.fillRect(Math.round(x) + PAD, Math.round(y) + PAD, w, h);
    };

    // The glow over the water, breathing slowly.
    const breathe = 0.5 + 0.5 * Math.sin(now / 1100);
    this.glow.scale.set((ix * 2.3) / 64, (iy * 2.3) / 64);
    this.glow.alpha = 0.48 + 0.16 * breathe;
    this.bowlGlow.alpha = 0.32 + 0.12 * breathe;

    // Ripples spreading out from the pedestal over the basin, fading as they go.
    for (let i = 0; i < 3; i++) {
      const t = ((now / 2600 + i / 3) % 1 + 1) % 1;
      const ax = 14 + t * (ix - 20);
      const ay = ax * (iy / ix);
      const alpha = 0.75 * (1 - t);
      const steps = Math.round(ax * 2.2);
      for (let k = 0; k < steps; k++) {
        if (k % 4 === 3) continue; // dashed, like the still ripples were
        const a = (k / steps) * Math.PI * 2;
        dot(cx + Math.cos(a) * ax, cy + 6 + Math.sin(a) * ay, 0x9fd3ee, alpha, 2, 1);
      }
    }

    // Water falling from the wide bowl on both sides, and from the small one.
    const low = cy - 22;
    const high = cy - 44;
    const stream = (x: number, from: number, to: number, speed: number, a: number, b: number) => {
      for (let y = from; y < to; y++) {
        const phase = (((y - now / speed) % 5) + 5) % 5;
        if (phase >= 4) continue;
        dot(x, y, phase < 2 ? a : b);
      }
    };
    for (const side of [-1, 1]) {
      const x = cx + side * 19 - (side < 0 ? 1 : 0);
      stream(x, low + 4, cy + 6, 45, 0xcfeaf6, 0x8fcbe8);
      stream(x + side, low + 6, cy + 5, 52, 0xa8d9f0, 0x8fcbe8);
      stream(cx + side * 10 - (side < 0 ? 1 : 0), high + 3, low, 55, 0xcfeaf6, 0xa8d9f0);
      // Splashes where it lands: droplets hopping up and falling back.
      for (let j = 0; j < 5; j++) {
        const t = ((now / 420 + j * 0.37 + (side > 0 ? 0.5 : 0)) % 1 + 1) % 1;
        const dx = (j - 2) * 2.2 * (side > 0 ? 1 : -1);
        dot(x + dx * t * 1.6, cy + 6 - Math.sin(t * Math.PI) * (3 + (j % 3)), 0xe6f6fb, 1 - t * 0.6);
      }
    }

    // The jet on top: bobbing up and down, droplets flying off its tip.
    const jet = 8 + Math.round(2 * Math.sin(now / 260) + Math.sin(now / 97));
    const tip = high - 10 - jet;
    for (let y = tip; y < high - 10; y++) dot(cx - 1, y, (y + Math.floor(now / 80)) % 2 ? 0xcfeaf6 : 0xffffff, 1, 2, 1);
    for (const side of [-1, 1]) {
      const t = ((now / 500 + (side > 0 ? 0.5 : 0)) % 1 + 1) % 1;
      dot(cx - 1 + side * (2 + t * 6), tip - Math.sin(t * Math.PI) * 4 + t * 6, 0xcfeaf6, 1 - t * 0.5);
    }

    // Sparkles twinkling on the water.
    for (let k = 0; k < 6; k++) {
      const t = ((now / 1700 + k * 0.29) % 1 + 1) % 1;
      if (t > 0.3) continue;
      const a = k * 2.4 + Math.floor(now / 1700 + k * 0.29) * 1.3;
      const r = 0.35 + ((k * 37) % 50) / 100;
      const sx = cx + Math.cos(a) * (ix - 6) * r;
      const sy = cy + 6 + Math.sin(a) * (iy - 6) * r;
      const s = Math.sin((t / 0.3) * Math.PI);
      dot(sx, sy, 0xffffff, s);
      if (s > 0.6) {
        dot(sx - 1, sy, 0xffffff, s * 0.6);
        dot(sx + 1, sy, 0xffffff, s * 0.6);
        dot(sx, sy - 1, 0xffffff, s * 0.6);
        dot(sx, sy + 1, 0xffffff, s * 0.6);
      }
    }
    ctx.globalAlpha = 1;
    this.tex.source.update();
  }

  destroy() {
    this.root.destroy({ children: true });
    this.tex.destroy(true);
  }
}
