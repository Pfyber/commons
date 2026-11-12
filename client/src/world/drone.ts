// Drone deliveries, in the city: each flies from the Market to its
// owner's front door over its flight time, then leaves a parcel on the step.
// Yours you pick up (and are told of when it lands); everyone else's you see
// flying over and waiting on their steps.

import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { HomeLife, Parcel } from "../homelife";
import { TILE } from "./art";
import type { TileXY } from "./motion";
import type { Scene } from "./scene";

const POLL_MS = 15_000;
/** How high it flies (px). */
const FLY_Z = 64;

function parcelTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 20;
  const g = c.getContext("2d")!;
  const p = (color: string, x: number, y: number, w: number, h: number) => ((g.fillStyle = color), g.fillRect(x, y, w, h));
  p("rgba(0,0,0,0.25)", 2, 17, 16, 3);
  p("#5a3d28", 2, 5, 16, 13);
  p("#c79a68", 3, 6, 14, 11);
  p("#e8cf9f", 8, 6, 4, 11);
  p("#a97545", 3, 6, 14, 1);
  const t = Texture.from(c);
  t.source.scaleMode = "nearest";
  return t;
}

interface Flying {
  parcel: Parcel;
  view: Container;
  rotors: Graphics;
  box: Sprite;
  shadow: Graphics;
  landed: boolean;
  tile: TileXY;
  /** Yours (to pick up), not someone else's. */
  mine: boolean;
}

export class Drones {
  private flying = new Map<string, Flying>();
  /** Server time minus ours (seconds). */
  private skew = 0;
  private nextPoll = 0;
  private tex = parcelTexture();
  private off: () => void;

  /** Your own parcel just landed (a notification pops up); unset, a toast says so. */
  onLanded: (() => void) | null = null;

  constructor(
    private scene: Scene,
    private life: HomeLife,
    /** Where drones set out from, and your door (null: no home to fly to). */
    private from: TileXY,
    private door: () => TileXY | null,
    private toast: (text: string) => void,
    /** The front door of a home, by its plot (someone else's drone's going there). */
    private doorOf: (plot: string) => TileXY | null = () => null,
  ) {
    const was = life.onOrder;
    life.onOrder = () => void this.poll();
    this.off = () => (life.onOrder = was);
  }

  private async poll() {
    const door = this.door();
    const [mine, others] = await Promise.all([door ? this.life.parcels().catch(() => null) : null, this.life.flights().catch(() => null)]);
    if (!mine && !others) return;
    const now = mine?.now ?? others!.now;
    this.skew = now - Date.now() / 1000;
    // Every parcel, and the door it's for.
    const all: { p: Parcel; door: TileXY; mine: boolean }[] = [];
    if (mine && door) for (const p of mine.parcels) all.push({ p, door, mine: true });
    for (const f of others?.flights ?? []) {
      const d = this.doorOf(f.plot);
      if (d) all.push({ p: { id: f.id, item: 0, qty: 0, ordered: f.ordered, ready: f.ready }, door: d, mine: false });
    }
    for (const [id, f] of this.flying) {
      if (all.some((a) => a.p.id === id)) continue;
      this.remove(id, f);
    }
    // On each step, side by side.
    const onStep = new Map<string, number>();
    for (const { p, door: d, mine: own } of all) {
      const at = `${d.x},${d.y}`;
      const i = onStep.get(at) ?? 0;
      onStep.set(at, i + 1);
      if (this.flying.has(p.id)) continue;
      const view = new Container();
      const shadow = new Graphics().ellipse(0, 0, 10, 4).fill({ color: 0, alpha: 0.25 });
      const rotors = new Graphics();
      const box = new Sprite(this.tex);
      box.anchor.set(0.5, 1);
      view.addChild(box, rotors);
      this.scene.sorted.addChild(shadow, view);
      const tile = { x: d.x + (i % 2 ? (i + 1) / 2 : -i / 2), y: d.y + 1 };
      // (Already down when first seen: no fuss about it landing.)
      const landed = !own && Date.now() / 1000 + this.skew >= p.ready;
      this.flying.set(p.id, { parcel: p, view, rotors, box, shadow, landed, tile, mine: own });
    }
  }

  private remove(id: string, f: Flying) {
    f.view.destroy({ children: true });
    f.shadow.destroy();
    this.flying.delete(id);
  }

  update(now: number) {
    if (now >= this.nextPoll) {
      this.nextPoll = now + POLL_MS;
      void this.poll();
    }
    const t = Date.now() / 1000 + this.skew;
    for (const f of this.flying.values()) {
      const span = Math.max(1, f.parcel.ready - f.parcel.ordered);
      const a = Math.max(0, Math.min(1, (t - f.parcel.ordered) / span));
      const ease = a * a * (3 - 2 * a);
      const gx = this.from.x + (f.tile.x - this.from.x) * ease;
      const gy = this.from.y + (f.tile.y - this.from.y) * ease;
      const x = gx * TILE + TILE / 2;
      const y = gy * TILE + TILE - 4;
      if (a >= 1) {
        if (!f.landed) {
          f.landed = true;
          if (f.mine) (this.onLanded ? this.onLanded() : this.toast(`📦 Your parcel's on the doorstep!`));
        }
        f.view.position.set(x, y);
        f.view.zIndex = y;
        f.rotors.clear();
        f.shadow.visible = false;
        f.box.y = 0;
        continue;
      }
      // Up over the rooftops, and down again at the end.
      const z = FLY_Z * Math.min(1, Math.min(a, 1 - a) * 12);
      f.view.position.set(x, y);
      f.view.zIndex = y + 200;
      f.box.y = -z + 14;
      f.shadow.position.set(x, y);
      f.shadow.zIndex = y - 40;
      const spin = Math.sin(now / 25) * 7 + 8;
      f.rotors
        .clear()
        .rect(-11, -z, 22, 2)
        .fill(0x2b2233)
        .rect(-3, -z - 3, 6, 5)
        .fill(0x4f86d8)
        .rect(-11 - spin / 2, -z - 3, spin, 1)
        .fill(0xdfe7f2)
        .rect(11 - spin / 2, -z - 3, spin, 1)
        .fill(0xdfe7f2);
    }
  }

  /** A tap at `t`: the parcel there, if it's landed. */
  at(t: TileXY): Parcel | null {
    for (const f of this.flying.values()) if (f.mine && f.landed && f.tile.x === t.x && f.tile.y === t.y) return f.parcel;
    return null;
  }

  async claim(p: Parcel) {
    await this.life.claim(p.id);
    const f = this.flying.get(p.id);
    if (f) this.remove(p.id, f);
  }

  destroy() {
    this.off();
    for (const [id, f] of this.flying) this.remove(id, f);
  }
}
