// Day/night lighting tied to the real sun over Ljubljana (see sun.ts): dark
// when it's dark outside in Slovenia, early in winter and late in summer. A
// full-screen multiply tint darkens the world; lamps and lit windows add warm
// light back in on top of it as it gets dark, and a colour grade keeps it all
// rich (most of all at golden hour). `?hour=21.5` overrides the clock for testing.

import { type Application, ColorMatrixFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
import { settings } from "../settings";
import { TILE, buildingLanterns } from "../world/art";
import type { ZoneMap } from "../world/map";
import type { Scene } from "../world/scene";
import { lightHour } from "./sun";

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
  { h: 0, sat: 0.34, con: 0.1 },
  { h: 5, sat: 0.34, con: 0.1 },
  { h: 6.8, sat: 0.44, con: 0.12 },
  { h: 8.5, sat: 0.28, con: 0.08 },
  { h: 16, sat: 0.28, con: 0.08 },
  { h: 18, sat: 0.46, con: 0.13 },
  { h: 19.5, sat: 0.4, con: 0.12 },
  { h: 21.5, sat: 0.34, con: 0.1 },
  { h: 24, sat: 0.34, con: 0.1 },
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
let soft: Texture | null = null;
let softer: Texture | null = null;

/**
 * A light with no edge to it: a long, bell-shaped fall to nothing, large
 * enough not to step when scaled up, and speckled by a fraction of a shade so
 * that its faintest reaches don't show as rings on a dark floor.
 */
function softGlow(): Texture {
  if (softer) return softer;
  const n = 256;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      if (r < 1) img.data[i + 3] = Math.floor(0.8 * 255 * Math.exp(-r * r * 4.2) * (1 - r * r) ** 2 + Math.random());
    }
  }
  ctx.putImageData(img, 0, 0);
  softer = Texture.from(c);
  softer.source.scaleMode = "linear";
  return softer;
}

function whiteGlow(): Texture {
  if (soft) return soft;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0.85)");
  g.addColorStop(0.35, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  soft = Texture.from(c);
  return soft;
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

type LightKind = "fire" | "screen" | "neon" | "lamp";

/** How a piece's light lives: a fire, a screen, neon, or a steady lamp. */
function lightKind(key: string): LightKind {
  if (/fireplace|candle|pumpkin|founders_lantern|hearth/.test(key)) return "fire";
  if (/tv|arcade|laptop|aquarium|popcorn/.test(key)) return "screen";
  if (/neon|lava|disco|uv_light|xmas|fairy/.test(key)) return "neon";
  return "lamp";
}

export class DayNight {
  private shade = new Graphics();
  /** Warm lights, over the night shade (so they stay yellow, not blued). */
  private lights = new Container();

  /** The night's lights (shown after dark, adding light): for things that glow, drawn in world coordinates. */
  get lightLayer(): Container {
    return this.lights;
  }
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
    /** Inside a building (the mall, the bar, the arcade) the lights are on: no night shade. */
    private indoors = false,
    /** A dim room lit by neon (the arcade). */
    neon = false,
    /** Always this hour (the labyrinth: dusk, whatever the time up top). */
    hour: number | null = null,
  ) {
    const q = new URLSearchParams(location.search).get("hour");
    this.override = indoors ? 12 : hour ?? (q !== null && !Number.isNaN(Number(q)) ? Number(q) : null);
    this.shade.blendMode = "multiply";
    app.stage.addChild(this.shade);
    this.lights.blendMode = "add";
    app.stage.addChild(this.lights);
    scene.layer3d(this.lights, false);
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
    const add = (t: Texture, x: number, y: number, sx: number, sy: number, alpha: number, foot?: number) => {
      const s = new Sprite(t);
      s.anchor.set(0.5);
      s.scale.set(sx, sy);
      s.position.set(x, y);
      s.alpha = alpha;
      this.lights.addChild(s);
      // (Up on a lamp or a wall, it stands there in 3D; what's lit on the ground lies on it.)
      if (foot !== undefined) scene.standOn(s, foot);
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
        add(tex, x, foot - 20, 4.2, 3.6, 0.16, foot);
        add(pool, x, foot - 6, 5.2, 3.2, 0.62);
        add(bulb, x, foot - 38, 0.45, 0.45, 0.8, foot);
      } else {
        // A garden lantern: smaller and more orange.
        add(pool, x, foot - 2, 2.2, 1.4, 0.7);
        add(bulb, x, foot - 32, 0.5, 0.5, 0.9, foot);
      }
    });
    for (const o of map.objects) {
      if (o.kind === "fountain") {
        // The fountain's water glows aqua in the dark.
        const f = new Sprite(whiteGlow());
        f.anchor.set(0.5);
        f.tint = 0x5ff0ff;
        f.scale.set(o.w * 0.75, o.h * 0.55);
        f.alpha = 0.6;
        f.position.set((o.x + o.w / 2) * TILE, (o.y + o.h / 2) * TILE);
        this.lights.addChild(f);
        continue;
      }
      // The lanterns either side of a building's door: a warm little glow each.
      for (const p of buildingLanterns(o)) {
        const wall = (o.y + o.h) * TILE;
        add(tex, p.x, p.y, 0.95, 0.95, 0.5, wall);
        add(bulb, p.x, p.y, 0.3, 0.3, 0.9, wall);
        add(pool, p.x, wall + 6, 1.6, 0.8, 0.35);
      }
      // Things that are themselves alight: a campfire, the lantern stand. (Not
      // the middle of a building: a glow there sat on its wall like a lamp
      // nobody could see; buildings light up by their door lanterns.)
      if (!["campfire", "lantern_stand"].includes(o.kind)) continue;
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.scale.set(o.kind === "campfire" ? 3.2 : 1.6);
      s.alpha = 0.8;
      s.position.set((o.x + o.w / 2) * TILE, (o.y + o.h / 2) * TILE);
      this.lights.addChild(s);
    }
  }

  /** Coloured glows over the walls' neon tubes and the machines. */
  private addNeon(app: Application, map: ZoneMap) {
    const neon = new Container();
    neon.blendMode = "add";
    app.stage.addChild(neon);
    this.scene.layer3d(neon, false);
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

  /**
   * A coloured glow at world position (x, y), shown after dark like the
   * fountain's, for something that comes and goes (a lure): destroy the
   * sprite to put it out.
   */
  addGlow(x: number, y: number, sx: number, sy: number, tint: number, alpha: number): Sprite {
    const s = new Sprite(softGlow());
    s.anchor.set(0.5);
    s.tint = tint;
    // (Its size in the old 64 px glow's terms.)
    s.scale.set(sx / 4, sy / 4);
    s.alpha = alpha;
    s.position.set(x, y);
    this.lights.addChild(s);
    return s;
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

  /** Always day (the settings can keep night from falling). */
  alwaysDay = false;
  /** The colour grade over the whole picture (off on the fast setting). */
  setGraded(on: boolean) {
    const now = this.app.stage.filters;
    const has = Array.isArray(now) && now.length > 0;
    if (has !== on) this.app.stage.filters = on ? [this.grade] : [];
  }

  /** Under the open sky (not indoors, not a home's rooms): for the shadows. */
  get outdoors(): boolean {
    return !this.room && !this.indoors;
  }

  /** The local clock's hour (`?hour=` too): what the weather goes by, as the server's bugs do. */
  clockHour(): number {
    if (this.override !== null) return this.override;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }

  hour(): number {
    if (this.override !== null) return this.override;
    if (this.alwaysDay) return 13;
    // (The lighting's own clock, set by how high the sun really is: see `lightHour`.)
    return lightHour(Date.now());
  }

  /** Sets the colour grade (only when it has moved enough to notice). */
  private setGrade(sat: number, con: number) {
    // (The advanced shaders: the warm, deep look of a shader pack.)
    if (settings.shaders) {
      sat += 0.22;
      con += 0.07;
    }
    // (Vibrant colours: richer still.)
    if (settings.vibrant) {
      sat += 0.45;
      con += 0.08;
    }
    if (Math.abs(sat - this.graded.sat) < 0.004 && Math.abs(con - this.graded.con) < 0.004) return;
    this.graded = { sat, con };
    this.grade.reset();
    this.grade.saturate(sat, true);
    this.grade.contrast(con, true);
  }

  /** A home: its own light, with sun through its windows. */
  private room = false;
  /** How many lights are on in the room. */
  roomLit = 0;
  private sunbeams: Sprite[] = [];

  enterRoom(windows: { x: number; y: number }[]) {
    this.room = true;
    for (const w of windows) {
      const s = this.roomGlow(w.x, w.y, 0xfff0c8, 2.4, 3.2);
      this.sunbeams.push(s);
    }
  }

  /**
   * A soft pool of `color` light at (x, y) (world px), `sx` × `sy` big;
   * `key`, the piece giving it (with the advanced shaders it lives as its
   * source does: a fire flickers, a screen shimmers, neon breathes).
   */
  roomGlow(x: number, y: number, color: number, sx: number, sy = sx, key = ""): Sprite {
    const s = new Sprite(whiteGlow());
    s.anchor.set(0.5);
    s.tint = color;
    s.scale.set(sx, sy);
    s.alpha = 0.6;
    s.position.set(x, y);
    this.lights.addChild(s);
    this.living.push({ s, kind: lightKind(key), sx, sy, phase: Math.random() * 10 });
    return s;
  }

  /** The room's lights, and how each lives (the advanced shaders). */
  private living: { s: Sprite; kind: LightKind; sx: number; sy: number; phase: number }[] = [];

  /**
   * The advanced shaders, in a home: each light alive as its source is (a
   * fire's quick flicker and breath, a screen's shimmer, neon's slow pulse,
   * a lamp steady), brighter against a deeper room. Off: as they were set.
   */
  private liveLights(on: boolean) {
    this.living = this.living.filter((l) => !l.s.destroyed);
    const t = performance.now() / 1000;
    for (const l of this.living) {
      if (!on) {
        l.s.alpha = 0.6;
        l.s.scale.set(l.sx, l.sy);
        continue;
      }
      const p = l.phase;
      let a = 0.72;
      let k = 1;
      if (l.kind === "fire") {
        const n = 0.55 * Math.sin(t * 9.3 + p) + 0.3 * Math.sin(t * 17.1 + p * 2) + 0.15 * Math.sin(t * 31.7 + p * 3);
        a = 0.74 + 0.16 * n;
        k = 1 + 0.05 * n;
      } else if (l.kind === "screen") {
        a = 0.6 + 0.12 * Math.sin(t * 6.1 + p) * Math.sin(t * 1.3 + p) + (Math.sin(t * 2.7 + p) > 0.92 ? 0.12 : 0);
      } else if (l.kind === "neon") {
        a = 0.66 + 0.1 * Math.sin(t * 1.4 + p);
        k = 1 + 0.03 * Math.sin(t * 1.4 + p);
      } else a = 0.74 + 0.02 * Math.sin(t * 0.8 + p);
      l.s.alpha = a;
      l.s.scale.set(l.sx * k, l.sy * k);
    }
  }

  /**
   * Only the lights in (or spilling into) view are drawn: the city has a few
   * thousand (every lamp, lantern and lit doorway), and each one the
   * renderer walks costs a frame time whether or not it's on screen. Each
   * sprite's checked where it is now (so moving ones, a glowing board, are
   * right), by `renderable` (`visible` is its owner's: a found wisp hides).
   */
  private cullLights() {
    const v = this.scene.viewRect();
    // (A margin: a lamp's pool spreads well past its post.)
    const m = 2 * TILE;
    const x0 = v.x0 * TILE - m;
    const y0 = v.y0 * TILE - m;
    const x1 = v.x1 * TILE + m;
    const y1 = v.y1 * TILE + m;
    for (const c of this.lights.children) {
      if (!(c instanceof Sprite)) continue;
      const rx = (c.texture.width * Math.abs(c.scale.x)) / 2;
      const ry = (c.texture.height * Math.abs(c.scale.y)) / 2;
      const want = c.x + rx > x0 && c.x - rx < x1 && c.y + ry > y0 && c.y - ry < y1;
      // (Only when it changes: setting it marks the scene to be gathered up again.)
      if (c.renderable !== want) c.renderable = want;
    }
  }

  update() {
    // The lights sit over the shade, so they ride along with the camera.
    this.lights.position.copyFrom(this.scene.world.position);
    this.lights.scale.copyFrom(this.scene.world.scale);
    if (this.neon) {
      this.setGrade(0.32, 0.1);
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
    if (this.room) {
      // A home: daylight through the windows by day, dim by night; every
      // light that's on brightens the room, and casts its own pool.
      const { dark } = lightAt(this.hour());
      this.setGrade(0.24, 0.07);
      this.dark = 0;
      // (The advanced shaders: a deeper room, so its lights really light it, and live.)
      const deep = settings.shaders;
      this.liveLights(deep);
      const level = deep ? Math.min(0.97, 0.84 - dark * 0.52 + this.roomLit * 0.05) : Math.min(1, 0.9 - dark * 0.48 + this.roomLit * 0.07);
      const ch = (v: number) => Math.round(Math.min(1, v) * 255);
      const { width, height } = this.app.screen;
      this.shade.clear().rect(0, 0, width, height).fill((ch(level) << 16) | (ch(level * 0.96) << 8) | ch(level * 0.9));
      this.lights.alpha = 1;
      this.lights.visible = true;
      for (const s of this.sunbeams) s.alpha = (1 - dark) * 0.28;
      return;
    }
    if (this.indoors) {
      this.setGrade(0.24, 0.07);
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
      this.cullLights();
      // A slow, faint flicker, each lamp in its own time (the ones in view: nobody sees the rest).
      const t = performance.now() / 1000;
      for (const f of this.flicker) if (f.s.renderable) f.s.alpha = f.base * (0.94 + 0.06 * Math.sin(t * 2.3 + f.phase) * Math.sin(t * 0.7 + f.phase * 2));
    }
  }
}
