// The Caretaker (spec §11): the park's gardener, who welcomes newcomers and
// gives the first three tasks. Like Biscuit, where the Caretaker is comes from
// the wall clock alone, so everyone sees them in the same place. During a
// gathering they wait at its spot.

import type { EntityInfo } from "../net/protocol.gen";
import { CARETAKER_LOOK } from "../world/art";
import { Avatar } from "../world/avatars";
import { type ZoneMap, walkable } from "../world/map";
import { type TileXY, posAt } from "../world/motion";
import { compress, findPath } from "../world/path";
import type { Scene } from "../world/scene";
import { happeningNow } from "../welcome";

export const CARETAKER_ID = 0xfffffff1;
const LEG_MS = 70_000;
const SPEED_X10 = 12;

/** Rounds: the garden, the plaza, the grove, the story board, the well. */
const ROUNDS: TileXY[] = [
  { x: 28, y: 23 }, // the garden gate
  { x: 46, y: 53 }, // by the fountain
  { x: 71, y: 41 }, // the Founders' Stone
  { x: 45, y: 57 }, // the Story of the Town
  { x: 40, y: 56 }, // the wishing well
  { x: 51, y: 45 }, // the plaza's north side
];

export class Caretaker {
  readonly avatar: Avatar;
  private spots: TileXY[];
  private legKey = "";

  constructor(
    private map: ZoneMap,
    scene: Scene,
    labels: HTMLElement,
  ) {
    this.spots = ROUNDS.map((s) => nearest(map, s)).filter((s): s is TileXY => s !== null);
    const at = this.spots[0] ?? { x: 0, y: 0 };
    const info: EntityInfo = { id: CARETAKER_ID, name: "Caretaker 🌿", look: CARETAKER_LOOK, x: at.x, y: at.y, state: 0, speedX10: 0, t0: 0, path: [], mood: 0 };
    this.avatar = new Avatar(info, scene, labels, false, Date.now());
    this.avatar.markNpc();
  }

  get active() {
    return this.spots.length >= 2;
  }

  get pos(): TileXY {
    return this.avatar.pos;
  }

  private spotFor(leg: number): TileXY {
    const n = this.spots.length;
    return this.spots[((leg % n) + n) % n];
  }

  update(now: number, wallNow: number) {
    if (!this.active) return;
    const gathering = happeningNow(now);
    const leg = Math.floor(now / LEG_MS);
    const key = gathering ? `g:${gathering.key}` : `l:${leg}`;
    if (key !== this.legKey) {
      const first = this.legKey === "";
      const offRound = this.legKey.startsWith("g:") || !!gathering;
      this.legKey = key;
      const d = this.avatar.destination;
      const from = first ? this.spotFor(leg - 1) : { x: Math.round(d.x), y: Math.round(d.y) };
      const to = gathering ? (nearest(this.map, gathering.at) ?? this.spotFor(leg)) : this.spotFor(leg);
      const path = findPath(this.map, from, to, 20000);
      if (path && path.length > 1) {
        // Rounds keep the clock's schedule, so everyone agrees; trips to and
        // from a gathering start when they're noticed.
        const motion = { path: compress(path), t0: offRound ? now : leg * LEG_MS, speedX10: SPEED_X10 };
        if (first) this.avatar.snap(posAt(motion, now));
        this.avatar.setMotion(motion, now);
      } else {
        this.avatar.snap(to);
      }
    }
    this.avatar.update(now, wallNow);
  }

  /** Whether a tap at tile coordinates (fractional) hits the Caretaker. */
  hit(tx: number, ty: number): boolean {
    const p = this.avatar.pos;
    return Math.abs(tx - (p.x + 0.5)) < 0.7 && ty > p.y - 0.4 && ty < p.y + 1.1;
  }

  say(text: string) {
    this.avatar.say(text);
  }

  destroy() {
    this.avatar.destroy();
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
