// What reached town goals change in the founders' park: lanterns around the
// fountain, wildflowers along the paths, fireworks over the pond at night.
// Purely visual and the same for everyone (the goals are town-wide).

import { type Container, Graphics, Sprite } from "pixi.js";
import { TILE, decorTexture, hash } from "./art";
import { type ZoneMap, groundAt } from "./map";
import type { Scene } from "./scene";

const BURST_EVERY_MS = 2600;
const BURST_LIFE_MS = 1400;
const COLORS = [0xffe08a, 0xf4a7b9, 0x9fd3ee, 0xc9a7f4, 0xf28c6b, 0xffffff];

interface Burst {
  x: number;
  y: number;
  born: number;
  color: number;
  seed: number;
}

export class Milestones {
  private added = new Set<string>();
  private sky = new Graphics();
  private bursts: Burst[] = [];
  private nextBurst = 0;
  private fireworks = false;
  private pond: { x: number; y: number } | null = null;

  constructor(
    private scene: Scene,
    private map: ZoneMap,
    private addLight: (x: number, y: number, scale: number) => void,
    private overlay: Container,
  ) {
    // Fireworks draw above the night shade (they're lights), following the
    // world's camera transform.
    overlay.addChild(this.sky);
    // The pond: the middle of the biggest patch of water west of the plaza.
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < Math.min(map.width, 44); x++) {
        if (groundAt(map, x, y) === "water") {
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    if (n) this.pond = { x: sx / n, y: sy / n };
  }

  /** Shows everything for the goals reached so far (idempotent). */
  apply(reached: string[]) {
    for (const key of reached) {
      if (this.added.has(key)) continue;
      this.added.add(key);
      if (key === "fountain_lights") this.lanterns();
      if (key === "flower_meadow") this.meadow();
      if (key === "fireworks") this.fireworks = true;
    }
  }

  private sprite(kind: string, x: number, y: number, variant = 0) {
    const tex = decorTexture(kind, variant);
    if (!tex) return;
    const s = new Sprite(tex);
    s.anchor.set(0.5, 1);
    s.position.set(x * TILE + TILE / 2, y * TILE + TILE - 2);
    s.zIndex = y * TILE + TILE - 2;
    this.scene.sorted.addChild(s);
  }

  private lanterns() {
    const f = this.map.objects.find((o) => o.kind === "fountain");
    if (!f) return;
    for (const [x, y] of [
      [f.x - 1, f.y - 1],
      [f.x + f.w, f.y - 1],
      [f.x - 1, f.y + f.h],
      [f.x + f.w, f.y + f.h],
    ]) {
      this.sprite("lantern", x, y);
      this.addLight(x * TILE + TILE / 2, y * TILE - 4, 1.4);
    }
  }

  private meadow() {
    const m = this.map;
    for (let y = 1; y < m.height - 1; y++) {
      for (let x = 1; x < m.width - 1; x++) {
        const g = groundAt(m, x, y);
        if (g !== "grass" && g !== "grass_dark") continue;
        if (m.decor_legend[m.decor[y * m.width + x]] !== "none") continue;
        const byPath = [groundAt(m, x, y - 1), groundAt(m, x, y + 1), groundAt(m, x - 1, y), groundAt(m, x + 1, y)].includes("path");
        const h = hash(x, y, 91);
        if (byPath && h % 3 === 0) this.sprite("wildflowers", x, y, h);
      }
    }
  }

  destroy() {
    this.overlay.removeChild(this.sky);
    this.sky.destroy();
  }

  /** Call every frame with the current darkness (0 day … 1 night). */
  update(now: number, dark: number) {
    this.sky.position.copyFrom(this.scene.world.position);
    this.sky.scale.copyFrom(this.scene.world.scale);
    this.sky.clear();
    if (!this.fireworks || !this.pond || dark < 0.5) {
      this.bursts.length = 0;
      return;
    }
    if (now > this.nextBurst) {
      const seed = Math.floor(now);
      this.bursts.push({
        x: (this.pond.x + ((seed % 13) - 6)) * TILE,
        y: (this.pond.y - 5 - (seed % 5)) * TILE,
        born: now,
        color: COLORS[seed % COLORS.length],
        seed,
      });
      this.nextBurst = now + BURST_EVERY_MS * (0.6 + (seed % 7) / 10);
    }
    this.bursts = this.bursts.filter((b) => now - b.born < BURST_LIFE_MS);
    for (const b of this.bursts) {
      const t = (now - b.born) / BURST_LIFE_MS;
      const r = 70 * Math.sqrt(t);
      const fall = 40 * t * t;
      const alpha = 1 - t;
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 + (b.seed % 10) / 10;
        const px = Math.round(b.x + Math.cos(a) * r);
        const py = Math.round(b.y + Math.sin(a) * r + fall);
        this.sky.rect(px, py, 3, 3).fill({ color: b.color, alpha });
      }
    }
  }
}
