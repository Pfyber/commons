// The sky over the park: shooting stars after dark, and sky lanterns rising
// with people's wishes. Both are drawn above the night shade so they glow.
// Shooting stars come from the wall clock, so everyone sees the same star at
// the same moment ("did you see that?!").

import { type Application, Container, Graphics } from "pixi.js";
import { TILE, hash } from "../world/art";
import type { Scene } from "../world/scene";

/** Shooting stars: one chance per slot. */
const STAR_SLOT_MS = 45_000;
const STAR_MS = 1100;
const LANTERN_MS = 24_000;

interface Lantern {
  x: number;
  y: number;
  t0: number;
  seed: number;
}

/** The star in the slot containing `now`, if one is falling. */
export function starAt(now: number): { k: number; p: number; x0: number; y0: number; dx: number; dy: number } | null {
  const k = Math.floor(now / STAR_SLOT_MS);
  const h = hash(k, 7, 91);
  if (h % 3 !== 0) return null; // one slot in three has a star: one every couple of minutes
  const start = k * STAR_SLOT_MS + (h % (STAR_SLOT_MS - STAR_MS - 1000));
  const p = (now - start) / STAR_MS;
  if (p < 0 || p > 1) return null;
  const left = (h >>> 3) % 2 === 0;
  return {
    k,
    p,
    x0: 0.15 + ((h >>> 5) % 70) / 100,
    y0: 0.05 + ((h >>> 12) % 25) / 100,
    dx: left ? -0.32 : 0.32,
    dy: 0.18 + ((h >>> 18) % 10) / 100,
  };
}

export class Sky {
  private stars = new Graphics();
  /** World-space things that glow above the night shade (lanterns, fire). */
  readonly glowLayer = new Container();
  private lanternGfx = new Graphics();
  private lanterns: Lantern[] = [];
  private lastStar = -1;

  constructor(
    private app: Application,
    private scene: Scene,
    /** Called once per shooting star. */
    private onStar: () => void,
  ) {
    this.glowLayer.addChild(this.lanternGfx);
    app.stage.addChild(this.glowLayer, this.stars);
  }

  /** A lantern rises from tile (x, y). */
  release(x: number, y: number, now: number) {
    this.lanterns.push({ x: x * TILE + TILE / 2, y: y * TILE, t0: now, seed: hash(x, y, now & 0xffff) });
  }

  update(now: number, dark: boolean) {
    // Shooting stars, in screen space.
    const g = this.stars.clear();
    const s = dark ? starAt(Date.now()) : null;
    if (s) {
      const { width, height } = this.app.screen;
      const head = { x: (s.x0 + s.dx * s.p) * width, y: (s.y0 + s.dy * s.p) * height };
      for (let i = 0; i < 14; i++) {
        const t = Math.max(0, s.p - i * 0.018);
        const x = (s.x0 + s.dx * t) * width;
        const y = (s.y0 + s.dy * t) * height;
        g.rect(Math.round(x), Math.round(y), 3, 2).fill({ color: 0xfff6d0, alpha: (1 - i / 14) * (1 - s.p * 0.6) });
      }
      g.rect(Math.round(head.x) - 1, Math.round(head.y) - 1, 4, 4).fill({ color: 0xffffff, alpha: 1 - s.p * 0.5 });
      if (s.k !== this.lastStar) {
        this.lastStar = s.k;
        this.onStar();
      }
    }

    // Lanterns, in world space (following the camera).
    this.glowLayer.position.copyFrom(this.scene.world.position);
    this.glowLayer.scale.copyFrom(this.scene.world.scale);
    this.lanterns = this.lanterns.filter((l) => now - l.t0 < LANTERN_MS);
    const lg = this.lanternGfx.clear();
    for (const l of this.lanterns) {
      const age = (now - l.t0) / LANTERN_MS;
      const rise = age * 420 + age * age * 160;
      const x = Math.round(l.x + Math.sin(now / 1400 + l.seed) * 10 + age * ((l.seed % 40) - 20));
      const y = Math.round(l.y - 20 - rise);
      const alpha = age > 0.8 ? (1 - age) / 0.2 : Math.min(1, age * 8);
      const flicker = 0.85 + Math.sin(now / 130 + l.seed) * 0.15;
      lg.circle(x, y, 16).fill({ color: 0xffb860, alpha: 0.18 * alpha * flicker });
      lg.circle(x, y, 9).fill({ color: 0xffd27a, alpha: 0.28 * alpha * flicker });
      lg.rect(x - 4, y - 6, 9, 11).fill({ color: 0x8a4a2a, alpha });
      lg.rect(x - 3, y - 5, 7, 9).fill({ color: 0xf6a14f, alpha });
      lg.rect(x - 1, y - 2, 3, 4).fill({ color: 0xfff1b8, alpha: alpha * flicker });
    }
  }

  destroy() {
    this.app.stage.removeChild(this.glowLayer, this.stars);
    this.glowLayer.destroy({ children: true });
    this.stars.destroy();
  }
}
