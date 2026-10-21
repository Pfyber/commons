// Day/night lighting tied to the player's local time (spec §7.1). A
// full-screen multiply tint darkens the world; lamps and lit windows add warm
// light back in on top of it as it gets dark, and a colour grade keeps it all
// rich (most of all at golden hour). `?hour=21.5` overrides the clock for testing.

import { type Application, ColorMatrixFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
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
  { h: 16.5, tint: [255, 255, 255], dark: 0 },
  { h: 17.6, tint: [255, 238, 205], dark: 0 },
  { h: 18.5, tint: [255, 208, 160], dark: 0.2 },
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

interface Grade {
  h: number;
  /** Extra saturation (0 = as drawn). */
  sat: number;
  /** Extra contrast (0 = as drawn). */
  con: number;
}

// The colour grade over the day: always a touch richer than drawn, glowing
// most at golden hour (around sunrise and sunset), and kept colourful at
// night so the dark isn't just grey.
const GRADES: Grade[] = [
  { h: 0, sat: 0.2, con: 0.08 },
  { h: 5, sat: 0.2, con: 0.08 },
  { h: 6.8, sat: 0.3, con: 0.1 },
  { h: 8.5, sat: 0.15, con: 0.06 },
  { h: 16, sat: 0.15, con: 0.06 },
  { h: 18, sat: 0.32, con: 0.11 },
  { h: 19.5, sat: 0.26, con: 0.1 },
  { h: 21.5, sat: 0.2, con: 0.08 },
  { h: 24, sat: 0.2, con: 0.08 },
];

export function gradeAt(hour: number): { sat: number; con: number } {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (GRADES[i + 1].h < h) i++;
  const a = GRADES[i];
  const b = GRADES[i + 1];
  const f = (h - a.h) / (b.h - a.h || 1);
  return { sat: a.sat + (b.sat - a.sat) * f, con: a.con + (b.con - a.con) * f };
}

/** A street lamp's head: a small, hot yellow-white core. */
function bulbTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,230,170,1)");
  g.addColorStop(0.18, "rgba(255,214,120,0.85)");
  g.addColorStop(0.5, "rgba(255,170,60,0.25)");
  g.addColorStop(1, "rgba(255,150,40,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

/** The warm pool a lamp throws on the ground around its foot. */
function poolTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,196,100,0.6)");
  g.addColorStop(0.55, "rgba(255,160,60,0.22)");
  g.addColorStop(1, "rgba(255,140,40,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

function glowTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,206,110,0.8)");
  g.addColorStop(0.4, "rgba(255,170,70,0.3)");
  g.addColorStop(1, "rgba(255,160,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

/** A soft white glow, tinted per light (the arcade's neon). */
function whiteGlow(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.35, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

/** Each cabinet's screen colour (art: arcade_cabinet). */
const CABINET_NEON: Record<string, number> = {
  Pong: 0x3fe0ff,
  "Light Cycles": 0xff4fa3,
  "Connect Four": 0xffe14f,
  "Memory Match": 0xb07bff,
  "Basket Catch": 0x5fe08a,
  "Turbo Racer": 0xff9a4f,
  "Tank Duel": 0xc8d84f,
  "Dance Off": 0xff4fa3,
};

export class DayNight {
  private shade = new Graphics();
  /** Warm lights, over the night shade (so they stay yellow, not blued). */
  private lights = new Container();
  /** Each lamp's light, for a faint flicker. */
  private flicker: { s: Sprite; base: number; phase: number }[] = [];
  private grade = new ColorMatrixFilter();
  private graded = { sat: -1, con: -1 };
  /** The arcade: neon glows drawn over the dimmed room, pulsing gently. */
  private neon: Container | null = null;
  private override: number | null;
  private glow: Texture;
  /** 0 in daylight … 1 at night. */
  dark = 0;

  constructor(
    private app: Application,
    private scene: Scene,
    map: ZoneMap,
    /** Inside a building the lights are on: no night shade. */
    private indoors = false,
    /** A dim room lit by neon (the arcade). */
    neon = false,
  ) {
    const q = new URLSearchParams(location.search).get("hour");
    this.override = q !== null && !Number.isNaN(Number(q)) ? Number(q) : null;
    this.shade.blendMode = "multiply";
    app.stage.addChild(this.shade);
    this.lights.blendMode = "add";
    app.stage.addChild(this.lights);
    // The whole picture, richer and punchier (see `gradeAt`).
    app.stage.filters = [this.grade];
    app.stage.filterArea = app.screen;

    if (neon) this.addNeon(app, map);
    const tex = glowTexture();
    this.glow = tex;
    const bulb = bulbTexture();
    const pool = poolTexture();
    const lamp = map.decor_legend.indexOf("lamp");
    const lantern = map.decor_legend.indexOf("lantern");
    const add = (t: Texture, x: number, y: number, sx: number, sy: number, alpha: number) => {
      const s = new Sprite(t);
      s.anchor.set(0.5);
      s.scale.set(sx, sy);
      s.position.set(x, y);
      s.alpha = alpha;
      this.lights.addChild(s);
      this.flicker.push({ s, base: alpha, phase: (x * 0.37 + y * 0.11) % 6.28 });
    };
    map.decor.forEach((d, i) => {
      if (d !== lamp && d !== lantern) return;
      const x = (i % map.width) * TILE + TILE / 2;
      const foot = Math.floor(i / map.width) * TILE + TILE - 2;
      if (d === lamp) {
        // A street lamp: a small warm bulb up top, and its light spread wide
        // and soft over the ground around it (lighting the place up, rather
        // than one blown-out spot).
        add(tex, x, foot - 20, 4.2, 3.6, 0.16);
        add(pool, x, foot - 6, 5.2, 3.2, 0.62);
        add(bulb, x, foot - 38, 0.45, 0.45, 0.8);
      } else {
        // A garden lantern: smaller and more orange.
        add(pool, x, foot - 2, 2.2, 1.4, 0.7);
        add(bulb, x, foot - 32, 0.5, 0.5, 0.9);
      }
    });
    for (const o of map.objects) {
      if (!["town_hall", "clothes_shop", "bar", "arcade_hall", "fountain", "campfire", "lantern_stand"].includes(o.kind)) continue;
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.scale.set(o.kind === "town_hall" ? 4 : o.kind === "clothes_shop" || o.kind === "bar" || o.kind === "arcade_hall" ? 3 : o.kind === "campfire" ? 3.2 : 1.6);
      s.alpha = o.kind === "campfire" || o.kind === "lantern_stand" ? 0.8 : 0.28;
      s.position.set((o.x + o.w / 2) * TILE, (o.y + o.h / 2) * TILE);
      this.lights.addChild(s);
    }
  }

  /** Coloured glows over the walls' neon tubes and the machines. */
  private addNeon(app: Application, map: ZoneMap) {
    const neon = new Container();
    neon.blendMode = "add";
    app.stage.addChild(neon);
    this.neon = neon;
    const tex = whiteGlow();
    const add = (x: number, y: number, color: number, scale: number) => {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.tint = color;
      s.scale.set(scale);
      s.position.set(x, y);
      neon.addChild(s);
    };
    // Only the screens glow: a soft pool of their colour.
    for (const o of map.objects) {
      const cx = (o.x + o.w / 2) * TILE;
      if (o.kind === "arcade_cabinet") add(cx, o.y * TILE - 9, CABINET_NEON[o.label ?? ""] ?? 0x3fe0ff, 1.5);
      if (o.kind === "dance_machine") add(cx, o.y * TILE - 12, CABINET_NEON["Dance Off"], 2.2);
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
    this.app.stage.filters = [];
    this.app.stage.removeChild(this.lights);
    this.lights.destroy({ children: true });
    if (this.neon) {
      this.app.stage.removeChild(this.neon);
      this.neon.destroy({ children: true });
    }
    this.app.stage.removeChild(this.shade);
    this.shade.destroy();
  }

  hour(): number {
    if (this.override !== null) return this.override;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }

  /** Sets the colour grade (only when it has moved enough to notice). */
  private setGrade(sat: number, con: number) {
    if (Math.abs(sat - this.graded.sat) < 0.004 && Math.abs(con - this.graded.con) < 0.004) return;
    this.graded = { sat, con };
    this.grade.reset();
    this.grade.saturate(sat, true);
    this.grade.contrast(con, true);
  }

  update() {
    // The lights sit over the shade, so they ride along with the camera.
    this.lights.position.copyFrom(this.scene.world.position);
    this.lights.scale.copyFrom(this.scene.world.scale);
    if (this.neon) {
      this.setGrade(0.2, 0.08);
      // A dim violet room; the neon glows ride with the camera and breathe.
      const { width, height } = this.app.screen;
      this.shade.clear().rect(0, 0, width, height).fill(0xa49cc4);
      this.dark = 0;
      this.lights.visible = false;
      this.neon.position.copyFrom(this.scene.world.position);
      this.neon.scale.copyFrom(this.scene.world.scale);
      const t = performance.now() / 1000;
      // A slow, slight flicker, as screens do.
      this.neon.children.forEach((c, i) => (c.alpha = 0.5 + Math.sin(t * 0.8 + i * 1.7) * 0.06));
      return;
    }
    if (this.indoors) {
      this.setGrade(0.12, 0.05);
      this.dark = 0;
      this.shade.clear();
      this.lights.visible = false;
      return;
    }
    const hour = this.hour();
    const { tint, dark } = lightAt(hour);
    const { sat, con } = gradeAt(hour);
    this.setGrade(sat, con);
    this.dark = dark;
    const { width, height } = this.app.screen;
    this.shade.clear();
    if (tint !== 0xffffff) this.shade.rect(0, 0, width, height).fill(tint);
    this.lights.alpha = Math.min(1, dark * 1.15);
    this.lights.visible = dark > 0.05;
    if (this.lights.visible) {
      // A slow, faint flicker, each lamp in its own time.
      const t = performance.now() / 1000;
      for (const f of this.flicker) f.s.alpha = f.base * (0.94 + 0.06 * Math.sin(t * 2.3 + f.phase) * Math.sin(t * 0.7 + f.phase * 2));
    }
  }
}
