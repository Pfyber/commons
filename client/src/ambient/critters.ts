// Small lives in the park, client-only: fireflies drifting over the meadow
// and water after dark, and fish jumping in the pond by day.

import { type Application, Graphics } from "pixi.js";
import { TILE } from "../world/art";
import { type ZoneMap, groundAt } from "../world/map";
import type { Scene } from "../world/scene";

interface Fly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}
interface Jump {
  x: number;
  y: number;
  born: number;
  dir: number;
}

const FLIES = 36;
const JUMP_MS = 700;

export class Critters {
  /** Fireflies glow above the night shade, following the world transform. */
  private glow = new Graphics();
  /** Fish and their rings, among the world's sprites. */
  private water = new Graphics();
  private flies: Fly[] = [];
  private jumps: Jump[] = [];
  private nextJump = 0;

  constructor(
    private app: Application,
    private scene: Scene,
    private map: ZoneMap,
  ) {
    app.stage.addChild(this.glow);
    this.water.zIndex = 1;
    scene.sorted.addChild(this.water);
  }

  destroy() {
    this.app.stage.removeChild(this.glow);
    this.glow.destroy();
  }

  /** Fireflies like meadows, water edges and the wood. */
  private likes(x: number, y: number): boolean {
    const g = groundAt(this.map, Math.floor(x), Math.floor(y));
    return g === "flowers" || g === "sand" || g === "grass_dark" || g === "water";
  }

  update(now: number, dark: number) {
    const dt = Math.min(50, this.app.ticker.deltaMS) / 1000;
    const v = this.scene.viewRect();
    this.glow.position.copyFrom(this.scene.world.position);
    this.glow.scale.copyFrom(this.scene.world.scale);
    const g = this.glow.clear();

    if (dark > 0.4) {
      // Keep a swarm in view: respawn any that drift off-screen.
      while (this.flies.length < FLIES) this.flies.push(this.spawnFly(v));
      for (const f of this.flies) {
        f.vx += (Math.random() - 0.5) * 0.8 * dt;
        f.vy += (Math.random() - 0.5) * 0.8 * dt;
        f.vx *= 0.98;
        f.vy *= 0.98;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (f.x < v.x0 - 1 || f.x > v.x1 + 1 || f.y < v.y0 - 1 || f.y > v.y1 + 1) Object.assign(f, this.spawnFly(v));
        const pulse = 0.5 + 0.5 * Math.sin(now / 400 + f.phase);
        const a = pulse * Math.min(1, (dark - 0.4) * 2.5);
        const px = Math.round(f.x * TILE);
        const py = Math.round(f.y * TILE);
        g.circle(px, py, 4).fill({ color: 0xd8ff7a, alpha: a * 0.18 });
        g.rect(px - 1, py - 1, 2, 2).fill({ color: 0xf4ffb0, alpha: a });
      }
    } else {
      this.flies.length = 0;
    }

    // Fish jumping in the pond by day.
    const w = this.water.clear();
    if (dark < 0.5 && now > this.nextJump) {
      this.nextJump = now + 2500 + Math.random() * 5000;
      for (let k = 0; k < 8; k++) {
        const x = Math.floor(v.x0 + Math.random() * (v.x1 - v.x0));
        const y = Math.floor(v.y0 + Math.random() * (v.y1 - v.y0));
        const deep = [0, 1, -1].every((d) => groundAt(this.map, x + d, y) === "water" && groundAt(this.map, x, y + d) === "water");
        if (deep) {
          this.jumps.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, born: now, dir: Math.random() < 0.5 ? -1 : 1 });
          break;
        }
      }
    }
    this.jumps = this.jumps.filter((j) => now - j.born < JUMP_MS + 600);
    for (const j of this.jumps) {
      const t = (now - j.born) / JUMP_MS;
      if (t < 1) {
        const fx = Math.round(j.x + j.dir * (t * 14 - 7));
        const fy = Math.round(j.y - Math.sin(t * Math.PI) * 14);
        w.rect(fx - 3, fy - 1, 6, 3).fill(0xe8a04a);
        w.rect(fx + (j.dir > 0 ? -4 : 3), fy - 2, 2, 5).fill(0xd08a3a);
      }
      // Rings where it left and where it landed.
      for (const [rx, start] of [
        [j.x - j.dir * 7, 0],
        [j.x + j.dir * 7, JUMP_MS],
      ]) {
        const rt = (now - j.born - start) / 600;
        if (rt < 0 || rt > 1) continue;
        w.ellipse(rx, j.y + 2, 3 + rt * 9, 1.5 + rt * 4).stroke({ color: 0xffffff, width: 1, alpha: 0.7 * (1 - rt) });
      }
    }
  }

  private spawnFly(v: { x0: number; y0: number; x1: number; y1: number }): Fly {
    for (let k = 0; k < 12; k++) {
      const x = v.x0 + Math.random() * (v.x1 - v.x0);
      const y = v.y0 + Math.random() * (v.y1 - v.y0);
      if (this.likes(x, y) || k === 11) return { x, y, vx: 0, vy: 0, phase: Math.random() * 6.28 };
    }
    return { x: v.x0, y: v.y0, vx: 0, vy: 0, phase: 0 };
  }
}
