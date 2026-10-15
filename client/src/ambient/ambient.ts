// Client-only ambient life (spec §4.2, §7.1): never synced, purely local.
// Ducks paddle on the pond, butterflies hover over flowerbeds, birds cross
// the sky now and then, and leaves drift down from trees near the camera.

import { Container, Sprite } from "pixi.js";
import { TILE, birdTexture, butterflyTexture, duckTexture, leafTexture } from "../world/art";
import { type ZoneMap, groundAt } from "../world/map";
import type { Scene } from "../world/scene";

interface Duck {
  sprite: Sprite;
  x: number;
  y: number;
  tx: number;
  ty: number;
  restUntil: number;
}

interface Butterfly {
  sprite: Sprite;
  ax: number;
  ay: number;
  phase: number;
  hue: number;
}

interface Bird {
  sprite: Sprite;
  shadow: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Leaf {
  sprite: Sprite;
  x: number;
  y: number;
  vy: number;
  sway: number;
  born: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

export class Ambient {
  private sky = new Container();
  private ducks: Duck[] = [];
  private flies: Butterfly[] = [];
  private birds: Bird[] = [];
  private leaves: Leaf[] = [];
  private pond: { x: number; y: number }[] = [];
  private trees: { x: number; y: number }[] = [];
  private nextFlock = performance.now() + rand(4000, 12000);
  private nextLeaf = 0;

  constructor(
    private scene: Scene,
    private map: ZoneMap,
  ) {
    scene.world.addChild(this.sky);
    const flowers: { x: number; y: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const g = groundAt(map, x, y);
        // Open water, away from the shore.
        if (g === "water" && this.isWater(x - 1, y) && this.isWater(x + 1, y)) this.pond.push({ x, y });
        if (g === "flowers") flowers.push({ x, y });
        const d = map.decor_legend[map.decor[y * map.width + x]];
        if (d === "tree") this.trees.push({ x, y });
      }
    }
    for (let i = 0; i < 5 && this.pond.length; i++) {
      const p = pick(this.pond);
      const sprite = new Sprite(duckTexture(0));
      sprite.anchor.set(0.5, 0.8);
      scene.sorted.addChild(sprite);
      this.ducks.push({ sprite, x: p.x + 0.5, y: p.y + 0.5, tx: p.x + 0.5, ty: p.y + 0.5, restUntil: 0 });
    }
    for (let i = 0; i < 8 && flowers.length; i++) {
      const f = pick(flowers);
      const hue = pick([20, 50, 200, 280, 330]);
      const sprite = new Sprite(butterflyTexture(hue, 0));
      sprite.anchor.set(0.5);
      scene.sorted.addChild(sprite);
      this.flies.push({ sprite, ax: f.x + 0.5, ay: f.y + 0.5, phase: rand(0, 100), hue });
    }
  }

  private isWater(x: number, y: number) {
    return groundAt(this.map, x, y) === "water";
  }

  update(dtMs: number, now: number) {
    const dt = dtMs / 1000;
    const view = this.scene.viewRect();

    for (const d of this.ducks) {
      const dx = d.tx - d.x;
      const dy = d.ty - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.05) {
        if (now > d.restUntil) {
          // Pick a nearby pond tile reachable in a straight line over water.
          const t = pick(this.pond);
          const steps = Math.ceil(Math.hypot(t.x + 0.5 - d.x, t.y + 0.5 - d.y) * 2);
          let ok = steps < 14;
          for (let i = 1; ok && i <= steps; i++) {
            const f = i / steps;
            ok = this.isWater(Math.floor(d.x + (t.x + 0.5 - d.x) * f), Math.floor(d.y + (t.y + 0.5 - d.y) * f));
          }
          if (ok) {
            d.tx = t.x + 0.5;
            d.ty = t.y + 0.5;
          }
          d.restUntil = now + rand(1500, 6000);
        }
      } else {
        const step = Math.min(dist, 0.6 * dt);
        d.x += (dx / dist) * step;
        d.y += (dy / dist) * step;
        if (Math.abs(dx) > 0.05) d.sprite.scale.x = dx > 0 ? 1 : -1;
      }
      d.sprite.texture = duckTexture(Math.floor(now / 600 + d.tx) % 2 ? 1 : 0);
      d.sprite.position.set(d.x * TILE, d.y * TILE + Math.sin(now / 400 + d.ty) * 0.8);
      d.sprite.zIndex = d.y * TILE;
    }

    for (const b of this.flies) {
      const t = now / 1000 + b.phase;
      const x = b.ax + Math.sin(t * 0.7) * 1.2 + Math.sin(t * 2.3) * 0.3;
      const y = b.ay + Math.cos(t * 0.5) * 0.8 - 0.6;
      b.sprite.texture = butterflyTexture(b.hue, Math.floor(t * 8) % 2 ? 1 : 0);
      b.sprite.position.set(x * TILE, y * TILE);
      b.sprite.zIndex = (y + 1.5) * TILE;
    }

    if (now > this.nextFlock) {
      this.nextFlock = now + rand(15000, 40000);
      const fromLeft = Math.random() < 0.5;
      const y0 = rand(view.y0, view.y1);
      const vx = (fromLeft ? 1 : -1) * rand(5, 7);
      const vy = rand(-1, 1);
      for (let i = 0; i < 2 + Math.floor(rand(0, 4)); i++) {
        const sprite = new Sprite(birdTexture(0));
        sprite.anchor.set(0.5);
        sprite.scale.x = fromLeft ? 1 : -1;
        const shadow = new Sprite(birdTexture(0));
        shadow.anchor.set(0.5);
        shadow.tint = 0x000000;
        shadow.alpha = 0.15;
        this.sky.addChild(shadow, sprite);
        this.birds.push({
          sprite,
          shadow,
          x: (fromLeft ? view.x0 - 2 : view.x1 + 2) - Math.sign(vx) * i * 0.8,
          y: y0 + rand(-1, 1),
          vx,
          vy,
        });
      }
    }
    this.birds = this.birds.filter((b) => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const flap = Math.floor(now / 120 + b.y * 10) % 2 ? 1 : 0;
      b.sprite.texture = birdTexture(flap);
      b.shadow.texture = birdTexture(flap);
      b.sprite.position.set(b.x * TILE, b.y * TILE);
      b.shadow.position.set(b.x * TILE + 10, b.y * TILE + 46);
      const gone = b.x < view.x0 - 6 || b.x > view.x1 + 6;
      if (gone) {
        b.sprite.destroy();
        b.shadow.destroy();
      }
      return !gone;
    });

    if (now > this.nextLeaf && this.leaves.length < 30) {
      this.nextLeaf = now + rand(200, 600);
      const near = this.trees.filter((t) => t.x >= view.x0 && t.x <= view.x1 && t.y >= view.y0 && t.y <= view.y1);
      if (near.length) {
        const t = pick(near);
        const sprite = new Sprite(leafTexture(Math.floor(rand(0, 3))));
        this.sky.addChild(sprite);
        this.leaves.push({ sprite, x: t.x + rand(0.1, 0.9), y: t.y - rand(0.6, 1.0), vy: rand(0.3, 0.6), sway: rand(0, 6), born: now });
      }
    }
    this.leaves = this.leaves.filter((l) => {
      const age = (now - l.born) / 1000;
      l.y += l.vy * dt;
      l.sprite.position.set((l.x + Math.sin(age * 2 + l.sway) * 0.25) * TILE, l.y * TILE);
      l.sprite.alpha = Math.max(0, 1 - Math.max(0, age - 2) / 1.5);
      const done = age > 3.5;
      if (done) l.sprite.destroy();
      return !done;
    });
  }
}
