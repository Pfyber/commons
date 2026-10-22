// The Caretaker (spec §11): the park's gardener, who welcomes newcomers and
// gives the first three tasks. Like Biscuit, where the Caretaker is comes from
// the wall clock alone, so everyone sees them in the same place. During a
// gathering they wait at its spot.

import type { EntityInfo } from "../net/protocol.gen";
import { CARETAKER_LOOK } from "../world/art";
import { Avatar } from "../world/avatars";
import { type ZoneMap, spot, walkable } from "../world/map";
import { type TileXY, posAt } from "../world/motion";
import { compress, route } from "../world/path";
import type { Scene } from "../world/scene";
import { happeningNow } from "../welcome";

export const CARETAKER_ID = 0xfffffff1;
const LEG_MS = 70_000;
const SPEED_X10 = 12;

/** Rounds, between the Market and the Park (map spots). */
const ROUNDS = ["fountain", "grove", "chess", "oak", "well"];

export class Caretaker {
  readonly avatar: Avatar;
  private spots: TileXY[];
  private legKey = "";

  constructor(
    private map: ZoneMap,
    scene: Scene,
    labels: HTMLElement,
  ) {
    this.spots = ROUNDS.map((k) => spot(map, k))
      .map((s) => s && nearest(map, s))
      .filter((s): s is TileXY => !!s);
    const at = this.spots[0] ?? { x: 0, y: 0 };
    const info: EntityInfo = { id: CARETAKER_ID, name: "Caretaker 🌿", look: CARETAKER_LOOK, style: 0, pet: 0, vehicle: 0, tool: 0, x: at.x, y: at.y, state: 0, speedX10: 0, t0: 0, sprintIn: 0, path: [], mood: 0, away: false };
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
      const at = gathering && spot(this.map, gathering.spot);
      const to = (at && nearest(this.map, at)) ?? this.spotFor(leg);
      const path = route(this.map, from, to, 20000);
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
