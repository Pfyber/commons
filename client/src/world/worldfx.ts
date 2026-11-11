// Advanced shaders (⚙️ settings): shadows, reflections and air, cast by
// what's actually standing in the world, made for the 3D view.
//
// Shadows: everything that stands (trees, houses, lamps, people, furniture)
// casts a soft shadow of its own shape from its feet: by day away from the
// sun (west in the morning, east at dusk, longer the lower it is); after dark, away from the street
// lamps near it, longer the further it stands from the light. Where it meets
// the ground, a darker patch (it stands on it, it doesn't float).
//
// Reflections: whatever stands at the water's edge hangs upside down in it
// from its feet (standing, as everything stands in 3D), as far as the water
// goes, rippling and darker with depth.
//
// Air: in 3D the far distance fades into the sky's colour for the hour.

import { AlphaFilter, BlurFilter, Container, FillGradient, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { TILE } from "./art";
import type { ZoneMap } from "./map";
import type { Scene } from "./scene";

interface Pair {
  shadow: Sprite;
  /** The shadow's soft outer edge, a little longer and fainter. */
  penumbra: Sprite;
  /** A street lamp's shadow, after dark. */
  lampShadow: Sprite;
  contact: Sprite;
  mirror: Sprite;
  seen: number;
  /** How far faded in (0–1): its shadows as it comes into view, its reflection as water comes near. */
  fade: number;
  mirrorFade: number;
}

/** A soft dark oval: where something meets the ground. */
function contactTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 32;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 16, 2, 32, 16, 30);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.6)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.setTransform(1, 0, 0, 0.5, 0, 8);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

type Key = [number, number, number];

/** Interpolates (hour → colour, amount) keys round the clock. */
function keyed(keys: Key[], hour: number): [number, number] {
  let i = 0;
  while (i < keys.length - 2 && hour >= keys[i + 1][0]) i++;
  const [h0, c0, a0] = keys[i];
  const [h1, c1, a1] = keys[i + 1];
  const t = Math.max(0, Math.min(1, (hour - h0) / (h1 - h0)));
  const mix = (s: number) => Math.round(((c0 >> s) & 255) * (1 - t) + ((c1 >> s) & 255) * t);
  return [(mix(16) << 16) | (mix(8) << 8) | mix(0), a0 + (a1 - a0) * t];
}

/** The air's colour at `hour`: what the far distance fades into, and how much. */
const HAZE: Key[] = [
  [0, 0x1b2448, 0.5],
  [5, 0x2a3060, 0.45],
  [6.5, 0xf5b98a, 0.5],
  [9, 0xfbe3c0, 0.35],
  [13, 0xd6ecff, 0.3],
  [17, 0xffd59a, 0.4],
  [19, 0xff9a6a, 0.55],
  [20.5, 0x3a3570, 0.5],
  [24, 0x1b2448, 0.5],
];

export class WorldFx {
  /** Whether it casts shadows (the advanced shaders) and reflects in water (water reflections). */
  shade = true;
  reflect = true;
  private shadows = new Container();
  private shadowAlpha = new AlphaFilter({ alpha: 0.32 });
  private shadowBlur = new BlurFilter({ strength: 2.2, quality: 3 });
  /** The 3D view's blur for the shadows, applied once they lie on the ground. */
  private laidBlur = new BlurFilter({ strength: 1.6, quality: 3 });
  /** Which way the shadows are set up (flat or 3D), to switch as the view does. */
  private shadowMode: boolean | null = null;
  private last = 0;
  private pairs = new Map<Sprite, Pair>();
  private frame = 0;
  private contactTex = contactTexture();
  /** The haze over the far distance (3D view), and what it was last drawn as. */
  private haze = new Graphics();
  private hazeKey = "";
  /** Street lamps and lanterns (tiles), by 8-tile cell, for the night's shadows. */
  private lamps = new Map<string, { x: number; y: number }[]>();
  /** The bottom part of a picture, as far as the water reaches (by texture and rows). */
  private crops = new Map<string, Texture>();

  constructor(
    private scene: Scene,
    private map: ZoneMap,
  ) {
    scene.onGround(this.shadows);
    scene.setLaidFilters(this.shadows, [this.laidBlur]);
    scene.overWorld(this.haze);
    const lamp = map.decor_legend.indexOf("lamp");
    const lantern = map.decor_legend.indexOf("lantern");
    map.decor.forEach((d, i) => {
      if (d !== lamp && d !== lantern) return;
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      const k = `${Math.floor(x / 8)},${Math.floor(y / 8)}`;
      const list = this.lamps.get(k) ?? [];
      list.push({ x, y });
      this.lamps.set(k, list);
    });
  }

  /** Indoors (a home): the lights that are on (world px, how bright now), to cast shadows from. */
  roomLights: (() => { x: number; y: number; power: number }[]) | null = null;
  private litNow: { x: number; y: number; power: number }[] = [];

  /** The nearest light that's on in the room within `reach` tiles of (x, y) (tiles), and how bright it is. */
  private nearestRoomLight(x: number, y: number, reach: number): { x: number; y: number; d: number; power: number } | null {
    let best: { x: number; y: number; d: number; power: number } | null = null;
    for (const l of this.litNow) {
      const lx = l.x / TILE;
      const ly = l.y / TILE + 0.5;
      const d = Math.hypot(lx - x, ly - y);
      if (d <= reach && d > 0.3 && (!best || d < best.d)) best = { x: lx, y: ly, d, power: l.power };
    }
    return best;
  }

  /** The nearest lamp within `reach` tiles of (x, y) (tiles), if any. */
  private nearestLamp(x: number, y: number, reach: number): { x: number; y: number; d: number } | null {
    let best: { x: number; y: number; d: number } | null = null;
    const cx = Math.floor(x / 8);
    const cy = Math.floor(y / 8);
    for (let j = cy - 1; j <= cy + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (const l of this.lamps.get(`${i},${j}`) ?? []) {
          const d = Math.hypot(l.x + 0.5 - x, l.y + 0.9 - y);
          if (d <= reach && d > 0.4 && (!best || d < best.d)) best = { x: l.x + 0.5, y: l.y + 0.9, d };
        }
      }
    }
    return best;
  }

  /** The far distance fading into the air (3D only): a gradient down from the top of the screen. */
  private drawHaze(hour: number, on: boolean) {
    this.haze.visible = on;
    if (!on) return;
    const { innerWidth: w, innerHeight: h } = window;
    const [color, alpha] = keyed(HAZE, hour);
    const key = `${w}x${h}:${color}:${alpha.toFixed(2)}`;
    if (key === this.hazeKey) return;
    this.hazeKey = key;
    const r = (color >> 16) & 255;
    const g = (color >> 8) & 255;
    const b = color & 255;
    const grad = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: "local" });
    grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
    grad.addColorStop(0.18, `rgba(${r},${g},${b},${alpha * 0.6})`);
    grad.addColorStop(0.45, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    this.haze.clear().rect(0, 0, w, h).fill(grad);
  }

  private water(x: number, y: number): boolean {
    const m = this.map;
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
    return m.ground_legend[m.ground[y * m.width + x]] === "water";
  }

  /** The part of `tex` from columns `x0`–`x1` and rows `y0`–`y1` (its own px, whole). */
  private crop(tex: Texture, x0: number, x1: number, y0: number, y1: number): Texture {
    const f = tex.frame;
    const a = Math.max(0, Math.min(f.width - 1, Math.floor(x0)));
    const b = Math.max(a + 1, Math.min(f.width, Math.ceil(x1)));
    const c = Math.max(0, Math.min(f.height - 1, Math.floor(y0)));
    const d = Math.max(c + 1, Math.min(f.height, Math.ceil(y1)));
    if (a === 0 && c === 0 && b === f.width && d === f.height) return tex;
    const key = `${tex.uid}:${a},${b},${c},${d}`;
    let t = this.crops.get(key);
    if (!t) {
      t = new Texture({ source: tex.source, frame: new Rectangle(f.x + a, f.y + c, b - a, d - c) });
      this.crops.set(key, t);
      // (Old crops are let go, never destroyed: something may be drawing them this very frame.)
      if (this.crops.size > 3000) this.crops.delete(this.crops.keys().next().value!);
    }
    return t;
  }


  /**
   * The open water in front of what stands at (x, foot) (world px): from
   * the water's edge (`gap` below its feet) how far down it goes (`depth`)
   * across all of `x0`–`x1`, the part of its width that's over water.
   * Null if there's none right in front of it.
   */
  private waterUnder(s: Sprite, x: number, foot: number): { x0: number; x1: number; gap: number; depth: number } | null {
    const ty = Math.floor((foot - 1) / TILE);
    const tx = Math.floor(x / TILE);
    if (!this.water(tx, ty + 1)) return null;
    // Its width, and the run of water across the first row in front of it.
    const w = s.texture.frame.width * Math.abs(s.scale.x);
    const left = s.scale.x >= 0 ? x - s.anchor.x * w : x - (1 - s.anchor.x) * w;
    let a = tx;
    let b = tx;
    while (a - 1 >= Math.floor(left / TILE) && this.water(a - 1, ty + 1)) a--;
    while (b + 1 <= Math.floor((left + w - 1) / TILE) && this.water(b + 1, ty + 1)) b++;
    // (The water's corners are rounded off, and a little shore shows at its ends.)
    const inset = 5;
    const x0 = Math.max(left, a * TILE + (this.water(a - 1, ty + 1) ? 0 : inset));
    const x1 = Math.min(left + w, (b + 1) * TILE - (this.water(b + 1, ty + 1) ? 0 : inset));
    if (x1 - x0 < 4) return null;
    // As deep as the water goes all the way across (up to six tiles).
    let rows = 6;
    for (let c = a; c <= b; c++) {
      let r = 0;
      while (r < rows && this.water(c, ty + 1 + r)) r++;
      rows = Math.min(rows, r);
    }
    const gap = (ty + 1) * TILE - foot + 2;
    const depth = rows * TILE - 2 - inset;
    return depth > 2 ? { x0, x1, gap, depth } : null;
  }

  /**
   * Lays `sh` (a shadow anchored at its feet, at (x, foot)) along the ground
   * vector (vx, vy) (px: where its tip falls, from its feet), `h` its height.
   */
  private cast(sh: Sprite, s: Sprite, x: number, foot: number, vx: number, vy: number, h: number) {
    // Up the screen is away from the camera: a shadow falling north stands
    // "up" from the feet; one falling south hangs down.
    const len = Math.max(2, Math.abs(vy));
    const up = vy <= 0 ? 1 : -1;
    sh.position.set(x, foot);
    sh.scale.set(s.scale.x, up * (len / Math.max(1, h)) * Math.sign(s.scale.y || 1));
    sh.skew.set(Math.max(-1.3, Math.min(1.3, -(vx / len) * up)), 0);
  }

  /**
   * Each frame: `hour` (0–24), `dark` (0 day to 1 night), `outdoors` (under
   * the sun, or under a roof's lights).
   */
  update(now: number, hour: number, dark: number, outdoors: boolean) {
    this.frame++;
    const in3d = this.scene.is3d;
    const dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    // Flat, the layer's blurred and faded as it's drawn; in 3D it's drawn
    // plain into the ground's texture, then faded and blurred there.
    if (this.shadowMode !== in3d) {
      this.shadowMode = in3d;
      this.shadows.filters = in3d ? [] : [this.shadowBlur, this.shadowAlpha];
    }
    this.shadows.visible = this.shade;
    this.drawHaze(hour, this.shade && in3d && outdoors);
    const t = now / 1000;
    // The sun across the sky: -1 rising in the east, 0 high at noon, 1 setting in the west.
    const sun = Math.max(-1, Math.min(1, (hour - 12.5) / 6));
    const low = Math.abs(sun);
    const day = outdoors ? 1 - dark : 0;
    const night = outdoors ? dark : 0;
    const strength = outdoors ? 0.34 * (1 - dark) + 0.14 * dark : 0.22;
    this.shadowAlpha.alpha = strength;
    this.shadows.alpha = in3d ? strength : 1;
    const shade = 0x0b0e22;
    // Indoors: the room's lights that are on this frame (flickering with them).
    this.litNow = !outdoors && this.roomLights ? this.roomLights() : [];
    for (const s of this.scene.standing()) {
      let p = this.pairs.get(s);
      if (!p) {
        const make = () => {
          const c = new Sprite();
          c.anchor.set(0.5, 1);
          this.shadows.addChild(c);
          return c;
        };
        const contact = new Sprite(this.contactTex);
        contact.anchor.set(0.5);
        this.shadows.addChild(contact);
        const mirror = new Sprite();
        this.scene.sorted.addChild(mirror);
        this.scene.skipFx(mirror);
        p = { contact, penumbra: make(), shadow: make(), lampShadow: make(), mirror, seen: 0, fade: 0, mirrorFade: 0 };
        this.pairs.set(s, p);
      }
      // (Back in view after a while away: it fades in again, as anything newly here does.)
      if (p.seen !== this.frame - 1) p.fade = 0;
      p.seen = this.frame;
      p.fade = Math.min(1, p.fade + dt / 450);
      const h = Math.abs(s.texture.height * s.scale.y);
      // Its feet: where it stands on the ground. (Something drawn up off the
      // ground, a lamp on a table, a picture on a wall, a swing's seat, a
      // thing on a shelf, casts no shadow of its own: what holds it does.)
      const bottom = s.position.y + (1 - s.anchor.y) * s.texture.height * s.scale.y;
      const foot = this.scene.groundOf(s);
      const grounded = Math.abs(foot - bottom) <= 8;
      const x = s.position.x;
      // (Tall things' shadows are kept in reach: a house's doesn't swallow the street.)
      const reach = Math.min(1, 64 / Math.max(1, h));
      for (const c of [p.shadow, p.penumbra, p.lampShadow]) {
        c.texture = s.texture;
        c.anchor.set(s.anchor.x, 1);
        c.tint = shade;
      }
      // The sun's shadow: away from it, longer the lower it is.
      // (Back along the ground in 3D, forward when flat; leaning away from the sun.)
      const length = outdoors ? (in3d ? 0.7 + 0.8 * low : 0.38 + 0.5 * low) : 0.25;
      const lean = outdoors ? (in3d ? -sun : sun) * (0.4 + 1.0 * low) : 0;
      const up = in3d ? 1 : -1;
      for (const [c, k] of [[p.shadow, 1], [p.penumbra, 1.15]] as const) {
        c.position.set(x, foot);
        c.scale.set(s.scale.x, up * s.scale.y * length * reach * k);
        c.skew.set(lean * reach * k, 0);
      }
      p.shadow.alpha = (outdoors ? 0.25 + 0.75 * day : 1) * p.fade;
      p.penumbra.alpha = 0.15 * day * p.fade;
      p.shadow.visible = p.penumbra.visible = grounded;
      p.shadow.visible = p.penumbra.visible = true;
      // After dark: away from the nearest street lamp, longer the further from it.
      // (Indoors: away from the nearest light that's on in the room, flickering as it does.)
      const indoor = this.litNow.length && grounded ? this.nearestRoomLight(x / TILE, foot / TILE, 6) : null;
      const lamp = indoor ?? (night > 0.15 && grounded ? this.nearestLamp(x / TILE, foot / TILE, 5.5) : null);
      p.lampShadow.visible = !!lamp;
      if (lamp) {
        const dx = x / TILE - lamp.x;
        const dy = foot / TILE - lamp.y;
        const d = Math.max(0.5, lamp.d);
        const len = h * reach * Math.min(1.8, 0.35 + d * 0.35);
        this.cast(p.lampShadow, s, x, foot, (dx / d) * len, (dy / d) * len, h);
        p.lampShadow.alpha = indoor
          ? Math.min(1, indoor.power * 1.25) * Math.max(0, 1 - d / 6) * 0.9 * p.fade
          : night * Math.max(0, 1 - d / 5.5) * 0.8 * p.fade;
      }
      // And where it meets the ground, the darkest: as wide as it, a sliver deep.
      const width = Math.min(110, s.texture.width * Math.abs(s.scale.x) * 0.8);
      p.contact.position.set(x, foot - 1);
      p.contact.scale.set(width / 64, Math.max(0.3, width / 64) * 0.55);
      p.contact.tint = shade;
      p.contact.alpha = 0.55 * p.fade;
      p.contact.visible = grounded;
      // The reflection: upside down from its feet, seen only where there's
      // water. It starts at the water's edge (not on the shore it stands
      // on), only as wide as the open water under it, and only as deep as
      // the water goes all the way across (so none spills onto the grass).
      const m = p.mirror;
      const fit = this.reflect && grounded ? this.waterUnder(s, x, foot) : null;
      // (Fading in as water comes into reach; gone almost at once as it goes,
      // so it never lingers on the grass behind whoever walked away.)
      p.mirrorFade = Math.max(0, Math.min(1, p.mirrorFade + (fit ? dt / 700 : -dt / 60)));
      if (!fit) {
        m.visible = false;
      } else {
        const sx = s.scale.x;
        const sy = Math.abs(s.scale.y) * 0.95;
        const w = s.texture.frame.width * Math.abs(sx);
        const left = sx >= 0 ? x - s.anchor.x * w : x - (1 - s.anchor.x) * w;
        // Which of its columns are over the water (flipped pictures count from the other side).
        const [a, b] = [fit.x0 - left, fit.x1 - left].map((v) => v / Math.abs(sx));
        const [cx0, cx1] = sx >= 0 ? [a, b] : [s.texture.frame.width - b, s.texture.frame.width - a];
        // Which of its rows: from (its height above its feet) the shore's width, down the water's depth.
        // (Its feet are its picture's bottom: only what stands on the ground is reflected.)
        const H = s.texture.frame.height;
        const rowFrom = H - (fit.gap + fit.depth) / sy;
        const rowTo = H - fit.gap / sy;
        if (rowTo - rowFrom < 1 || cx1 - cx0 < 1) {
          m.visible = false;
        } else {
          m.texture = this.crop(s.texture, cx0, cx1, rowFrom, rowTo);
          // (Its first column goes at the left edge, or flipped, at the right: either way it hangs from there.)
          m.anchor.set(0, 1);
          m.position.set(sx >= 0 ? fit.x0 : fit.x1, foot + fit.gap);
          m.scale.set(sx, -sy);
          m.skew.set(Math.sin(t * 2.2 + x * 0.05) * 0.02, 0);
          m.tint = night > 0.5 ? 0x4a6584 : 0x86aac6;
          m.alpha = (0.42 - 0.12 * night) * (0.94 + 0.06 * Math.sin(t * 3.1 + x * 0.11)) * p.mirrorFade;
          m.zIndex = s.zIndex - 0.5;
          // (In 3D it stands at the water's edge, where it hangs from, so it meets the water there.)
          this.scene.standOn(m, foot + fit.gap);
          m.visible = true;
        }
      }
    }
    // What's gone (out of view, picked up, walked away): its shadow and reflection go too.
    for (const [s, p] of this.pairs) {
      if (p.seen === this.frame) continue;
      if (s.destroyed || !s.parent) {
        for (const c of [p.shadow, p.penumbra, p.lampShadow, p.contact, p.mirror]) c.destroy();
        this.pairs.delete(s);
      } else {
        for (const c of [p.shadow, p.penumbra, p.lampShadow, p.contact, p.mirror]) c.visible = false;
      }
    }
  }

  destroy() {
    this.haze.destroy();
    for (const p of this.pairs.values()) p.mirror.destroy();
    this.shadows.destroy({ children: true });
    this.crops.clear();
    this.pairs.clear();
  }
}
