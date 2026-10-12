// The Founders' Grove (spec §11): a seedling with a name for every founder,
// growing over real months (seedling → sapling → young tree → grown). Slot
// `i` is the map's i-th `grove_slot` object; the server hands them out from
// the stone outwards. Empty slots show a little ring of soil, waiting.

import { Container, Graphics } from "pixi.js";
import type { Founder } from "../welcome";
import { TILE, hash } from "./art";
import type { TileXY } from "./motion";
import type { ZoneMap } from "./map";

const O = 0x3b3a2e;

/** A few kinds of tree, picked by founder number: [leaf, light, trunk, blossom]. */
const SPECIES: [number, number, number, number | null][] = [
  [0x5d8a4e, 0x8fca6b, 0x7a5532, null], // linden
  [0x6f9a54, 0xa8d27f, 0xd9d4c5, null], // birch
  [0x7fa65a, 0xb5d68a, 0x6e4b30, 0xf4a7b9], // cherry
  [0xc9733a, 0xe8a052, 0x6e4b30, null], // maple
  [0x4f7f5a, 0x7fb08a, 0x5a4030, 0xffffff], // rowan in flower
];

export class Grove {
  readonly slots: TileXY[];
  private sprites: Graphics[] = [];
  private bySlot = new Map<number, Founder>();

  constructor(map: ZoneMap, sorted: Container) {
    this.slots = map.objects.filter((o) => o.kind === "grove_slot").map((o) => ({ x: o.x, y: o.y }));
    for (const s of this.slots) {
      const g = new Graphics();
      g.position.set(s.x * TILE + TILE / 2, s.y * TILE + TILE - 4);
      g.zIndex = s.y * TILE + TILE - 4;
      sorted.addChild(g);
      this.sprites.push(g);
    }
    this.redraw();
  }

  get active() {
    return this.slots.length > 0;
  }

  setFounders(founders: Founder[]) {
    this.bySlot = new Map(founders.map((f) => [f.slot, f]));
    this.redraw();
  }

  /** The founder whose tree is at `t`, if any. */
  at(t: TileXY): { founder: Founder | null; slot: number } | null {
    const i = this.slots.findIndex((s) => s.x === t.x && (s.y === t.y || s.y === t.y + 1));
    if (i < 0) return null;
    return { founder: this.bySlot.get(i) ?? null, slot: i };
  }

  private redraw() {
    this.sprites.forEach((g, i) => {
      g.clear();
      const f = this.bySlot.get(i);
      if (!f) {
        // Waiting: a little ring of soil.
        g.ellipse(0, 0, 7, 3).fill({ color: 0x7a5532, alpha: 0.35 });
        g.ellipse(0, 0, 4, 1.5).fill({ color: 0x5a3e24, alpha: 0.3 });
        return;
      }
      drawTree(g, f.stage, SPECIES[hash(f.no, 5, 77) % SPECIES.length]);
    });
  }
}

/** Draws a founder's tree at stage 0–3, feet at (0, 0). */
function drawTree(g: Graphics, stage: number, [leaf, light, trunk, blossom]: (typeof SPECIES)[number]) {
  g.ellipse(0, 0, 6 + stage * 4, 2 + stage).fill({ color: 0x000000, alpha: 0.18 });
  if (stage <= 0) {
    // Seedling with a little name stake.
    g.rect(-1, -7, 2, 7).fill(0x4c7a3e);
    g.rect(-5, -9, 4, 3).fill(light);
    g.rect(1, -10, 4, 3).fill(light);
    g.rect(6, -9, 2, 9).fill(O);
    g.rect(4, -12, 6, 4).fill(O);
    g.rect(5, -11, 4, 2).fill(0xf4f1d8);
    return;
  }
  const h = [0, 14, 22, 30][Math.min(3, stage)];
  const tw = [0, 2, 3, 4][Math.min(3, stage)];
  const r = [0, 6, 10, 14][Math.min(3, stage)];
  g.rect(-tw / 2 - 1, -h, tw + 2, h).fill(O);
  g.rect(-tw / 2, -h, tw, h).fill(trunk);
  if (trunk === 0xd9d4c5) for (let y = -h + 4; y < -2; y += 5) g.rect(-tw / 2, y, tw, 1).fill(O);
  const cy = -h - r + 4;
  g.circle(0, cy, r + 1).fill(O);
  g.circle(0, cy, r).fill(leaf);
  if (stage >= 2) {
    g.circle(-r * 0.7, cy + r * 0.3, r * 0.7 + 1).fill(O);
    g.circle(r * 0.7, cy + r * 0.3, r * 0.7 + 1).fill(O);
    g.circle(-r * 0.7, cy + r * 0.3, r * 0.7).fill(leaf);
    g.circle(r * 0.7, cy + r * 0.3, r * 0.7).fill(leaf);
    g.circle(0, cy, r).fill(leaf);
  }
  g.circle(-r * 0.3, cy - r * 0.35, r * 0.45).fill(light);
  if (blossom !== null && stage >= 2) {
    for (let k = 0; k < 4 + stage * 2; k++) {
      const a = k * 2.4;
      const d = (k % 3) * r * 0.3 + r * 0.2;
      g.rect(Math.round(Math.cos(a) * d) - 1, Math.round(cy + Math.sin(a) * d * 0.8) - 1, 2, 2).fill(blossom);
    }
  }
}
