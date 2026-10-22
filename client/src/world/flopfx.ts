// A rare fish out of the water, flopping on the bank beside its angler:
// it leaps from the water to its spot, then bounces and flips about there
// with a "Tap it!" sign, three pips for the hits it needs, and a ring that
// runs down the seconds it has left. Each hit squashes it, knocks out
// stars and sends it flopping off to a tile nearby; not landed in time,
// it leaps back into the water with a splash.

import { Container, Graphics, Sprite, Text } from "pixi.js";
import { tier } from "../ui/rarity";
import { TILE } from "./art";
import { itemTexture } from "./items";
import type { TileXY } from "./motion";
import type { Scene } from "./scene";

const LEAP_MS = 500;
/** A hop to a new tile when hit. */
const HOP_MS = 320;
const BACK_MS = 550;
/** Its size on the bank (the sprite's 32 px at half: a 16 px fish, doubled). */
const SIZE = 1;

interface Flop {
  root: Container;
  fish: Sprite;
  ring: Graphics;
  sign: Text;
  pips: Graphics;
  stars: { g: Graphics; vx: number; vy: number; born: number }[];
  water: { x: number; y: number };
  spot: { x: number; y: number };
  start: number;
  until: number;
  /** How long it has each time (ms), for the ring. */
  window: number;
  /** Hopping from here, since then (when hit). */
  hopFrom: { x: number; y: number } | null;
  hits: number;
  /** Hits it takes to land. */
  need: number;
  hitAt: number;
  color: number;
  /** Set when it leaps back into the water. */
  backAt: number;
  mine: boolean;
}

export class FlopShows {
  private flops = new Map<number, Flop>();

  constructor(private scene: Scene) {}

  /** Angler `id`'s fish (`key`, `rarity`) leaps from `water` to flop at `spot` until `ms` from now. */
  start(id: number, water: TileXY, spot: TileXY, key: string, rarity: number, ms: number, mine: boolean, need = 3) {
    this.remove(id);
    const color = Number.parseInt(tier(rarity).color.slice(1), 16);
    const root = new Container();
    root.zIndex = 1e9;
    const ring = new Graphics();
    const fish = new Sprite(itemTexture(key, "fish"));
    fish.anchor.set(0.5);
    fish.texture.source.scaleMode = "nearest";
    const sign = new Text({
      text: mine ? "👊 Tap it!" : "",
      style: { fontFamily: "ui-rounded, system-ui, sans-serif", fontSize: 10, fontWeight: "bold", fill: 0xfff3c4, stroke: { color: 0x1a1020, width: 4 } },
    });
    sign.anchor.set(0.5, 1);
    sign.resolution = 3;
    const pips = new Graphics();
    root.addChild(ring, fish, pips, sign);
    this.scene.world.addChild(root);
    const now = performance.now();
    this.flops.set(id, {
      root,
      fish,
      ring,
      sign,
      pips,
      stars: [],
      water: { x: water.x * TILE + TILE / 2, y: water.y * TILE + TILE / 2 },
      spot: { x: spot.x * TILE + TILE / 2, y: spot.y * TILE + TILE - 6 },
      start: now,
      until: now + LEAP_MS + ms,
      window: ms,
      hopFrom: null,
      hits: 0,
      need,
      hitAt: 0,
      color,
      backAt: 0,
      mine,
    });
  }

  /** It was hit (`hits` so far) and flops off to `spot` (its time keeps running). */
  hit(id: number, hits: number, spot: TileXY) {
    const f = this.flops.get(id);
    if (!f) return;
    f.hits = hits;
    f.hitAt = performance.now();
    const to = { x: spot.x * TILE + TILE / 2, y: spot.y * TILE + TILE - 6 };
    if (to.x !== f.spot.x || to.y !== f.spot.y) {
      f.hopFrom = { ...f.spot };
      f.spot = to;
    }
    for (let i = 0; i < 6; i++) {
      const g = new Graphics().star(0, 0, 4, 3, 1.2).fill({ color: i % 2 ? 0xffe14f : 0xffffff });
      g.position.set(f.hopFrom?.x ?? f.spot.x, (f.hopFrom?.y ?? f.spot.y) - 6);
      f.root.addChild(g);
      const a = -Math.PI / 2 + (i / 5 - 0.5) * 2.4;
      f.stars.push({ g, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, born: f.hitAt });
    }
  }

  /** Whether angler `id` has a fish on the bank. */
  has(id: number): boolean {
    const f = this.flops.get(id);
    return !!f && !f.backAt;
  }

  /** Whether a point (world pixels) is on angler `id`'s flopping fish (generous, for fingers). */
  hits(id: number, x: number, y: number): boolean {
    const f = this.flops.get(id);
    if (!f || f.backAt) return false;
    return Math.hypot(x - f.spot.x, y - (f.spot.y - 6)) < 22;
  }

  /** Not hit in time: it leaps back into the water. */
  escape(id: number) {
    const f = this.flops.get(id);
    if (f && !f.backAt) f.backAt = performance.now();
  }

  /** Landed (the catch show takes over from here). */
  remove(id: number) {
    this.flops.get(id)?.root.destroy({ children: true });
    this.flops.delete(id);
  }

  update(now: number) {
    for (const [id, f] of this.flops) {
      const t = now - f.start;
      let x = f.spot.x;
      let y = f.spot.y;
      let rot = 0;
      let flip = 1;
      if (f.backAt) {
        // Back into the water in an arc, then gone.
        const b = (now - f.backAt) / BACK_MS;
        if (b >= 1) {
          this.remove(id);
          continue;
        }
        x = f.spot.x + (f.water.x - f.spot.x) * b;
        y = f.spot.y + (f.water.y - f.spot.y) * b - Math.sin(b * Math.PI) * 26;
        rot = b * Math.PI * 2;
      } else if (t < LEAP_MS) {
        // Out of the water and onto the bank.
        const b = t / LEAP_MS;
        x = f.water.x + (f.spot.x - f.water.x) * b;
        y = f.water.y + (f.spot.y - f.water.y) * b - Math.sin(b * Math.PI) * 30;
        rot = (1 - b) * Math.PI * 1.5;
      } else if (f.hopFrom && now - f.hitAt < HOP_MS) {
        // Smacked: a flailing leap over to its new tile.
        const b = (now - f.hitAt) / HOP_MS;
        x = f.hopFrom.x + (f.spot.x - f.hopFrom.x) * b;
        y = f.hopFrom.y + (f.spot.y - f.hopFrom.y) * b - Math.sin(b * Math.PI) * 16;
        rot = b * Math.PI * 2;
      } else {
        // Flopping: hops of whole pixels, flipping over now and then.
        const h = (t - LEAP_MS) / 1000;
        const hop = Math.abs(Math.sin(h * 7.5));
        y -= Math.round(hop * 5);
        flip = Math.sin(h * 3.1) > 0 ? 1 : -1;
        rot = Math.round(Math.sin(h * 7.5) * 2) * 0.2;
      }
      // Squashed flat for a moment when hit.
      const since = now - f.hitAt;
      const squash = f.hitAt && since < 160 ? 1 - since / 160 : 0;
      f.fish.position.set(x, y);
      f.fish.rotation = rot;
      f.fish.scale.set(SIZE * 0.5 * flip * (1 + squash * 0.4), SIZE * 0.5 * (1 - squash * 0.45));
      // The sign, the pips and the time left, while it flops.
      const flopping = !f.backAt && t >= LEAP_MS;
      f.ring.clear();
      f.pips.clear();
      f.sign.visible = flopping && f.mine;
      if (flopping) {
        const left = Math.max(0, Math.min(1, (f.until - now) / f.window));
        const urgent = left < 0.3 && Math.floor(now / 150) % 2 === 0;
        f.ring
          .arc(f.spot.x, f.spot.y - 6, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left)
          .stroke({ width: 2, color: urgent ? 0xff4f4f : f.color, alpha: 0.9 });
        for (let i = 0; i < f.need; i++) {
          const px = f.spot.x - (f.need - 1) * 4 + i * 8;
          const py = f.spot.y - 26;
          f.pips.rect(px - 3, py - 3, 6, 6).fill({ color: 0x1a1020 });
          f.pips.rect(px - 2, py - 2, 4, 4).fill({ color: i < f.hits ? 0xffe14f : 0x4a4058 });
        }
        f.sign.position.set(f.spot.x, f.spot.y - 31 - Math.round(Math.abs(Math.sin(now / 160)) * 2));
      }
      f.stars = f.stars.filter((p) => {
        const age = (now - p.born) / 1000;
        if (age > 0.6) {
          p.g.destroy();
          return false;
        }
        p.g.x += p.vx / 60;
        p.g.y += (p.vy + age * 200) / 60;
        p.g.alpha = 1 - age / 0.6;
        return true;
      });
    }
  }

  destroy() {
    for (const id of [...this.flops.keys()]) this.remove(id);
  }
}
