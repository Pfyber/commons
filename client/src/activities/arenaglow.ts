// What shines after dark in the arena: bombs and arrows in flight, the lions'
// eyes, the acid's sick light, meteors coming down. There can be dozens at a
// time, changing every frame, so they share a pool of the night's light
// sprites (which only show after dark): asked for each frame, and whatever
// wasn't asked for goes out.

import type { Sprite } from "pixi.js";

/** More than this at once and the rest go without: it's only light. */
const MAX = 96;
/** Dimmer than asked, and further: a gentler light, with more room to fall away. */
const DIM = 0.72;
const SPREAD = 1.3;

/** Richer: each channel pushed away from the middle of the three. */
function vivid(c: number): number {
  const [r, g, b] = [c >> 16, (c >> 8) & 255, c & 255];
  const mid = (r + g + b) / 3;
  const push = (v: number) => Math.max(0, Math.min(255, Math.round(mid + (v - mid) * 1.35)));
  return (push(r) << 16) | (push(g) << 8) | push(b);
}

export class NightGlows {
  private pool: Sprite[] = [];
  private used = 0;

  /** `make`: a new light, at world (x, y) (null: this place has no night). */
  constructor(private make: (x: number, y: number) => Sprite | null) {}

  /** A light at world (x, y) this frame, `sx`, `sy` its size (1: 64 px across). */
  add(x: number, y: number, tint: number, sx: number, sy: number, alpha: number) {
    if (this.used >= MAX) return;
    const s = this.pool[this.used] ?? this.make(x, y);
    if (!s) return;
    this.pool[this.used++] = s;
    s.visible = true;
    s.position.set(x, y);
    s.tint = vivid(tint);
    s.scale.set((sx * SPREAD) / 4, (sy * SPREAD) / 4);
    s.alpha = alpha * DIM;
  }

  /** The frame's done: those not asked for go out. */
  flush() {
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
    this.used = 0;
  }

  destroy() {
    for (const s of this.pool) s.destroy();
    this.pool = [];
    this.used = 0;
  }
}
