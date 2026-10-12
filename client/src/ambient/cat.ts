// Biscuit, the park cat. Wanders between favourite spots and naps there.
// Everyone sees Biscuit in the same place with no messages at all: where the
// cat is comes from the wall clock alone. Time is cut into legs; each leg
// walks from the previous spot to the next (chosen by a hash of the leg
// number) along the same pathfinding everyone runs, then naps until the
// leg ends.

import { Container, Graphics } from "pixi.js";
import { TILE, hash } from "../world/art";
import { type ZoneMap, walkable } from "../world/map";
import { type Motion, type TileXY, headingAt, posAt } from "../world/motion";
import { compress, findPath } from "../world/path";

const LEG_MS = 80_000;
/** Cats amble: 1.6 tiles per second. */
const SPEED_X10 = 16;

/** Biscuit's favourite places (adjusted to the nearest walkable tile). */
const FAVOURITES: TileXY[] = [
  { x: 45, y: 53 }, // by the plaza benches
  { x: 13, y: 65 }, // under the Old Oak
  { x: 40, y: 56 }, // by the wishing well
  { x: 27, y: 22 }, // the garden gate
  { x: 55, y: 66 }, // the bandstand steps
  { x: 46, y: 88 }, // the picnic lawn
  { x: 68, y: 67 }, // the town hall steps
  { x: 37, y: 65 }, // the pier
  { x: 52, y: 44 }, // the sunny side of the plaza
];

export class Cat {
  readonly sprite = new Container();
  private body = new Graphics();
  private zzz = new Graphics();
  private spots: TileXY[];
  private legKey = -1;
  private motion: Motion | null = null;
  private legStart = 0;
  pos: TileXY = { x: 0, y: 0 };
  napping = false;
  private facing = 1;
  hearts = 0;

  constructor(private map: ZoneMap) {
    this.spots = FAVOURITES.map((s) => nearest(map, s)).filter((s): s is TileXY => s !== null);
    this.sprite.addChild(this.body, this.zzz);
  }

  get active() {
    return this.spots.length >= 2;
  }

  private spotFor(leg: number): TileXY {
    return this.spots[hash(leg, 3, 57) % this.spots.length];
  }

  update(nowMs: number) {
    if (!this.active) return;
    const leg = Math.floor(nowMs / LEG_MS);
    if (leg !== this.legKey) {
      this.legKey = leg;
      this.legStart = leg * LEG_MS;
      let from = this.spotFor(leg - 1);
      let to = this.spotFor(leg);
      if (from.x === to.x && from.y === to.y) to = this.spots[(this.spots.indexOf(to) + 1) % this.spots.length];
      const path = findPath(this.map, from, to, 20000);
      this.motion = path && path.length > 1 ? { path: compress(path), t0: this.legStart, speedX10: SPEED_X10 } : null;
      if (!this.motion) this.pos = from = to;
    }
    let moving = false;
    if (this.motion) {
      this.pos = posAt(this.motion, nowMs);
      const h = headingAt(this.motion, nowMs);
      moving = h !== null;
      if (h && Math.abs(h.x) > 0.1) this.facing = h.x > 0 ? 1 : -1;
    }
    this.napping = !moving;
    this.draw(nowMs, moving);
    this.sprite.position.set(Math.round(this.pos.x * TILE + TILE / 2), Math.round(this.pos.y * TILE + TILE - 6));
    this.sprite.zIndex = this.pos.y * TILE + TILE - 5;
  }

  private draw(now: number, moving: boolean) {
    const g = this.body.clear();
    const O = 0x3b3a2e;
    const fur = 0xe39b4a;
    const stripe = 0xc07a32;
    const f = this.facing;
    if (moving) {
      const step = Math.floor(now / 160) % 2;
      // Body, tail up, head forward; legs alternate.
      g.rect(-8, -9, 16, 7).fill(O);
      g.rect(-7, -8, 14, 5).fill(fur);
      g.rect(-3, -8, 2, 5).fill(stripe);
      g.rect(2, -8, 2, 5).fill(stripe);
      g.rect(f * 6 - 3, -13, 7, 7).fill(O);
      g.rect(f * 6 - 2, -12, 5, 5).fill(fur);
      g.rect(f * 6 - 2, -14, 2, 2).fill(O);
      g.rect(f * 6 + 1, -14, 2, 2).fill(O);
      g.rect(-f * 9 - 1, -15, 2, 8).fill(O);
      for (const [lx, up] of [
        [-6, step],
        [-2, 1 - step],
        [2, step],
        [5, 1 - step],
      ]) {
        g.rect(lx, -3 - up, 2, 3 + up).fill(O);
      }
    } else {
      // Curled up asleep.
      g.ellipse(0, -4, 9, 5).fill(O);
      g.ellipse(0, -4, 8, 4).fill(fur);
      g.rect(-4, -7, 2, 4).fill(stripe);
      g.rect(1, -7, 2, 4).fill(stripe);
      g.rect(f * 5 - 3, -8, 6, 5).fill(fur);
      g.rect(f * 5 - 3, -9, 2, 2).fill(O);
      g.rect(f * 5 + 1, -9, 2, 2).fill(O);
    }
    // Zzz while napping; hearts after a pet.
    const z = this.zzz.clear();
    if (!moving) {
      const k = (now / 900) % 3;
      z.rect(8 + k * 2, -16 - k * 5, 4, 1).fill({ color: 0xffffff, alpha: 1 - k / 3 });
      z.rect(11 + k * 2, -15 - k * 5, 1, 1).fill({ color: 0xffffff, alpha: 1 - k / 3 });
      z.rect(8 + k * 2, -14 - k * 5, 4, 1).fill({ color: 0xffffff, alpha: 1 - k / 3 });
    }
    if (now < this.hearts) {
      const t = 1 - (this.hearts - now) / 1500;
      for (const dx of [-6, 3]) {
        const hx = dx;
        const hy = -20 - t * 14;
        z.rect(hx, hy, 2, 2).fill({ color: 0xe8566b, alpha: 1 - t });
        z.rect(hx + 3, hy, 2, 2).fill({ color: 0xe8566b, alpha: 1 - t });
        z.rect(hx, hy + 2, 5, 2).fill({ color: 0xe8566b, alpha: 1 - t });
        z.rect(hx + 1, hy + 4, 3, 1).fill({ color: 0xe8566b, alpha: 1 - t });
      }
    }
  }

  /** Whether screen-space tap (in tile units) hits the cat. */
  hit(tx: number, ty: number): boolean {
    return Math.abs(tx - (this.pos.x + 0.5)) < 0.8 && Math.abs(ty - (this.pos.y + 0.7)) < 0.8;
  }
}

function nearest(map: ZoneMap, t: TileXY): TileXY | null {
  for (let r = 0; r < 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (walkable(map, t.x + dx, t.y + dy)) return { x: t.x + dx, y: t.y + dy };
      }
    }
  }
  return null;
}
