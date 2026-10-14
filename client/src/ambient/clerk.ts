// The clothes shop's clerk: potters about behind the counter, says hello as
// you come in, and helps you try things on. Like the Caretaker, where they
// stand comes from the wall clock alone, so everyone sees the same.

import type { EntityInfo } from "../net/protocol.gen";
import { Avatar } from "../world/avatars";
import { encodeLook } from "../world/look";
import { type MapObject, type ZoneMap, walkable } from "../world/map";
import type { TileXY } from "../world/motion";
import { compress, findPath } from "../world/path";
import type { Scene } from "../world/scene";

export const CLERK_ID = 0xfffffff2;
const LEG_MS = 9000;
const SPEED_X10 = 10;
/** A waistcoat, glasses and a ponytail. */
const CLERK_LOOK = encodeLook({ hue: 150, skin: 2, hair: 1, hat: 0, hatHue: 0, style: 3, accessory: 1, outfit: 7 });

const HELLOS = ["Welcome in! Try on anything you like.", "Hello! Looking is free, have fun.", "Come in, come in! New things on the racks."];
const TIPS = [
  "Tap a rack to try things on. Only you see it until you buy.",
  "The changing room's in the corner, for clothes you already have.",
  "That would suit you!",
  "Outfits at the back, hats in the middle, accessories by the door.",
];

export class Clerk {
  readonly avatar: Avatar;
  private spots: TileXY[];
  private leg = -1;
  private tip = 0;

  constructor(
    private map: ZoneMap,
    counter: MapObject,
    scene: Scene,
    labels: HTMLElement,
  ) {
    // The row behind the counter.
    this.spots = [];
    for (let x = counter.x + 1; x < counter.x + counter.w - 1; x++) {
      if (walkable(map, x, counter.y - 1)) this.spots.push({ x, y: counter.y - 1 });
    }
    const at = this.spots[0] ?? { x: counter.x, y: counter.y - 1 };
    const info: EntityInfo = { id: CLERK_ID, name: "Clerk 🧵", look: CLERK_LOOK, x: at.x, y: at.y, state: 0, speedX10: 0, t0: 0, path: [], mood: 0 };
    this.avatar = new Avatar(info, scene, labels, false, Date.now());
    this.avatar.markNpc();
  }

  update(now: number, wallNow: number) {
    const leg = Math.floor(now / LEG_MS);
    if (leg !== this.leg && this.spots.length > 1) {
      const first = this.leg === -1;
      this.leg = leg;
      const to = this.spots[(leg * 7) % this.spots.length];
      const d = this.avatar.destination;
      const path = findPath(this.map, { x: Math.round(d.x), y: Math.round(d.y) }, to, 500);
      if (first || !path || path.length < 2) this.avatar.snap(to);
      else this.avatar.setMotion({ path: compress(path), t0: now, speedX10: SPEED_X10 }, now);
    }
    this.avatar.update(now, wallNow);
  }

  /** Whether a tap at tile coordinates (fractional) hits the clerk. */
  hit(tx: number, ty: number): boolean {
    const p = this.avatar.pos;
    return Math.abs(tx - (p.x + 0.5)) < 0.7 && ty > p.y - 0.4 && ty < p.y + 1.1;
  }

  hello() {
    this.avatar.say(HELLOS[Math.floor(Math.random() * HELLOS.length)]);
  }

  /** Something helpful, a different one each time. */
  chat() {
    this.avatar.say(TIPS[this.tip++ % TIPS.length]);
  }

  destroy() {
    this.avatar.destroy();
  }
}
