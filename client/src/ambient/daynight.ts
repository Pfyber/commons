// Day/night lighting tied to the player's local time (spec §7.1). A
// full-screen multiply tint darkens the world; lamps and lit windows add warm
// light back in as it gets dark. `?hour=21.5` overrides the clock for testing.

import { type Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { TILE } from "../world/art";
import type { ZoneMap } from "../world/map";
import type { Scene } from "../world/scene";

interface Key {
  h: number;
  tint: [number, number, number];
  dark: number;
}

// Tint keyframes over the day (hour → multiply colour, darkness 0..1).
const KEYS: Key[] = [
  { h: 0, tint: [92, 104, 168], dark: 1 },
  { h: 5, tint: [92, 104, 168], dark: 1 },
  { h: 6.5, tint: [255, 196, 170], dark: 0.35 },
  { h: 8, tint: [255, 255, 255], dark: 0 },
  { h: 17, tint: [255, 255, 255], dark: 0 },
  { h: 18.5, tint: [255, 214, 170], dark: 0.2 },
  { h: 20, tint: [196, 150, 170], dark: 0.6 },
  { h: 21.5, tint: [92, 104, 168], dark: 1 },
  { h: 24, tint: [92, 104, 168], dark: 1 },
];

export function lightAt(hour: number): { tint: number; dark: number } {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (KEYS[i + 1].h < h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const f = (h - a.h) / (b.h - a.h || 1);
  const c = a.tint.map((v, k) => Math.round(v + (b.tint[k] - v) * f));
  return { tint: (c[0] << 16) | (c[1] << 8) | c[2], dark: a.dark + (b.dark - a.dark) * f };
}

function glowTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,226,150,0.9)");
  g.addColorStop(0.4, "rgba(255,200,120,0.35)");
  g.addColorStop(1, "rgba(255,200,120,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

export class DayNight {
  private shade = new Graphics();
  private lights = new Container();
  private override: number | null;
  private glow: Texture;
  /** 0 in daylight … 1 at night. */
  dark = 0;

  constructor(
    private app: Application,
    scene: Scene,
    map: ZoneMap,
  ) {
    const q = new URLSearchParams(location.search).get("hour");
    this.override = q !== null && !Number.isNaN(Number(q)) ? Number(q) : null;
    this.shade.blendMode = "multiply";
    app.stage.addChild(this.shade);
    this.lights.blendMode = "add";
    scene.world.addChild(this.lights);

    const tex = glowTexture();
    this.glow = tex;
    const lamps = new Set(["lamp", "lantern"].map((k) => map.decor_legend.indexOf(k)).filter((i) => i >= 0));
    map.decor.forEach((d, i) => {
      if (!lamps.has(d)) return;
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.scale.set(2.2);
      s.position.set((i % map.width) * TILE + TILE / 2, Math.floor(i / map.width) * TILE - 6);
      this.lights.addChild(s);
    });
    for (const o of map.objects) {
      if (!["town_hall", "fountain", "campfire", "lantern_stand"].includes(o.kind)) continue;
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.scale.set(o.kind === "town_hall" ? 4 : o.kind === "campfire" ? 3.2 : 1.6);
      s.alpha = 0.7;
      s.position.set((o.x + o.w / 2) * TILE, (o.y + o.h / 2) * TILE);
      this.lights.addChild(s);
    }
  }

  /** A warm light at world position (x, y) that shows after dark. */
  addLight(x: number, y: number, scale: number) {
    const s = new Sprite(this.glow);
    s.anchor.set(0.5);
    s.scale.set(scale);
    s.position.set(x, y);
    this.lights.addChild(s);
  }

  destroy() {
    this.app.stage.removeChild(this.shade);
    this.shade.destroy();
  }

  hour(): number {
    if (this.override !== null) return this.override;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  update() {
    const { tint, dark } = lightAt(this.hour());
    this.dark = dark;
    const { width, height } = this.app.screen;
    this.shade.clear();
    if (tint !== 0xffffff) this.shade.rect(0, 0, width, height).fill(tint);
    this.lights.alpha = Math.min(1, dark * 1.2);
    this.lights.visible = dark > 0.05;
  }
}
