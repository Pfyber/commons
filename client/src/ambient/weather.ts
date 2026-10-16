// Weather everyone shares: picked from the UTC clock in two-hour spells, so
// all players see the same sky without any messages. Cloud shadows drift
// across the ground, rain falls with ripples on the water, morning mist
// hangs low. `?weather=rain` (clear, cloudy, rain, mist) overrides it.

import { type Application, Container, Graphics } from "pixi.js";
import { TILE, hash } from "../world/art";
import { type ZoneMap, groundAt } from "../world/map";
import type { Scene } from "../world/scene";

export type WeatherKind = "clear" | "cloudy" | "rain" | "mist";

const SPELL_MS = 2 * 60 * 60 * 1000;

/** The weather at wall time `ms` for someone whose local hour is `hour`. */
export function weatherAt(ms: number, hour: number): { kind: WeatherKind; wind: number } {
  const spell = Math.floor(ms / SPELL_MS);
  const h = hash(spell, 7, 31) % 100;
  const wind = 0.15 + (hash(spell, 9, 31) % 70) / 100;
  let kind: WeatherKind = h < 45 ? "clear" : h < 75 ? "cloudy" : h < 90 ? "rain" : "mist";
  if (kind === "mist" && !(hour >= 4.5 && hour < 10)) kind = "cloudy";
  return { kind, wind };
}

interface Drop {
  x: number;
  y: number;
  v: number;
}
interface Ripple {
  x: number;
  y: number;
  born: number;
}

export class Weather {
  kind: WeatherKind = "clear";
  wind = 0.3;
  private override: WeatherKind | null;
  /** Cloud shadows, in world space. */
  private shadows = new Graphics();
  /** Rain streaks and mist, in screen space (above the night shade). */
  private sky = new Container();
  private rain = new Graphics();
  private mist = new Graphics();
  /** Ripples on water, in world space. */
  private ripples = new Graphics();
  private drops: Drop[] = [];
  private rings: Ripple[] = [];
  private nextRing = 0;

  constructor(
    private app: Application,
    private scene: Scene,
    private map: ZoneMap,
    /** Indoors: no rain, no mist, no cloud shadows. */
    private indoor = false,
  ) {
    const q = new URLSearchParams(location.search).get("weather");
    this.override = indoor ? "clear" : ((["clear", "cloudy", "rain", "mist"] as const).find((k) => k === q) ?? null);
    scene.world.addChild(this.ripples, this.shadows);
    this.sky.addChild(this.mist, this.rain);
    app.stage.addChild(this.sky);
  }

  destroy() {
    this.app.stage.removeChild(this.sky);
    this.sky.destroy({ children: true });
  }

  update(now: number, hour: number) {
    const w = weatherAt(Date.now(), hour);
    this.kind = this.override ?? w.kind;
    this.wind = this.kind === "rain" ? Math.max(0.5, w.wind) : w.wind;
    this.scene.wind = this.wind;
    this.drawShadows(now);
    this.drawRain(now);
    this.drawMist(now);
  }

  /** Big soft cloud shadows drifting with the wind. */
  private drawShadows(now: number) {
    const g = this.shadows.clear();
    const count = this.indoor ? 0 : this.kind === "clear" ? 2 : this.kind === "mist" ? 0 : 7;
    const mw = this.map.width * TILE;
    const mh = this.map.height * TILE;
    const drift = (now / 1000) * (8 + this.wind * 22);
    for (let i = 0; i < count; i++) {
      const bx = ((hash(i, 1, 41) % mw) + drift * (0.8 + (i % 3) * 0.15)) % (mw + 600) - 300;
      const by = (hash(i, 2, 41) % mh) + Math.sin(now / 9000 + i) * 20;
      const size = 140 + (hash(i, 3, 41) % 160);
      // Concentric rings: faint at the rim, a little denser in the middle, so
      // the shadow has a soft edge instead of a hard one.
      const step = this.kind === "rain" ? 0.03 : 0.018;
      for (const k of [1, 0.8, 0.6, 0.42]) {
        g.ellipse(bx, by, size * 1.3 * k, size * 0.6 * k).fill({ color: 0x1d2b3a, alpha: step });
      }
    }
  }

  private drawRain(now: number) {
    const g = this.rain.clear();
    const rg = this.ripples.clear();
    if (this.kind !== "rain") {
      this.drops.length = 0;
      this.rings.length = 0;
      return;
    }
    const { width, height } = this.app.screen;
    while (this.drops.length < 160) {
      this.drops.push({ x: Math.random() * (width + 200) - 100, y: Math.random() * height, v: 0.8 + Math.random() * 0.5 });
    }
    const slant = 0.25 + this.wind * 0.3;
    const dt = Math.min(50, this.app.ticker.deltaMS);
    for (const d of this.drops) {
      d.y += d.v * dt;
      d.x += d.v * dt * slant;
      if (d.y > height) {
        d.y = -10;
        d.x = Math.random() * (width + 200) - 200;
      }
      g.moveTo(d.x, d.y).lineTo(d.x - 4 * slant, d.y - 12);
    }
    g.stroke({ color: 0xcfe3f0, width: 1, alpha: 0.55 });

    // Ripples on water in view.
    const v = this.scene.viewRect();
    if (now > this.nextRing) {
      this.nextRing = now + 40;
      for (let k = 0; k < 3; k++) {
        const x = Math.floor(v.x0 + Math.random() * (v.x1 - v.x0));
        const y = Math.floor(v.y0 + Math.random() * (v.y1 - v.y0));
        if (groundAt(this.map, x, y) === "water") this.rings.push({ x: (x + Math.random()) * TILE, y: (y + Math.random()) * TILE, born: now });
      }
    }
    this.rings = this.rings.filter((r) => now - r.born < 700);
    for (const r of this.rings) {
      const t = (now - r.born) / 700;
      rg.ellipse(r.x, r.y, 2 + t * 7, 1 + t * 3.5).stroke({ color: 0xffffff, width: 1, alpha: 0.6 * (1 - t) });
    }
  }

  private drawMist(now: number) {
    const g = this.mist.clear();
    const { width, height } = this.app.screen;
    // Rain greys the day a little.
    if (this.kind === "rain") g.rect(0, 0, width, height).fill({ color: 0x8a96a3, alpha: 0.14 });
    if (this.kind !== "mist") return;
    g.rect(0, 0, width, height).fill({ color: 0xf2f4f2, alpha: 0.16 });
    for (let i = 0; i < 9; i++) {
      const x = ((hash(i, 4, 43) % 1000) / 1000) * width + Math.sin(now / 7000 + i) * 80;
      const y = ((hash(i, 5, 43) % 1000) / 1000) * height;
      for (const k of [1, 0.7, 0.45]) g.ellipse(x, y, 300 * k, 90 * k).fill({ color: 0xffffff, alpha: 0.04 });
    }
  }
}
