// The skatepark's shop: Dusty, a long-haired skater in a beanie, selling
// skates out of the hatch of a truck parked by the fence. He stands in the
// hatch (between the shop behind him and the truck in front: see
// world/skateshopart.ts), shifts from one end of the counter to the other
// now and then, and says hello (and a tip) when you come to buy.

import type { EntityInfo } from "../net/protocol.gen";
import { Avatar } from "../world/avatars";
import { encodeLook } from "../world/look";
import type { MapObject, ZoneMap } from "../world/map";
import type { Scene } from "../world/scene";

const TILE = 32;

/** NPC ids for the sellers (one a truck), clear of the others'. */
const SELLER_BASE = 0xfffffe10;
/** How long he stays at one end of the counter (ms). */
const LEG_MS = 7000;

export const SELLER = {
  name: "Dusty 🛹",
  // Long hair under a beanie, a hoodie, headphones round his neck.
  look: encodeLook({ hue: 28, skin: 1, hair: 3, hat: 1, hatHue: 210, style: 1, accessory: 6, outfit: 4 }),
  hellos: [
    "Yo! Let's build you a board, dude.",
    "Ayy, welcome to the shop!",
    "Fresh decks, fresh wheels, fresh bearings. Take a look.",
    "Rad combo earlier, I saw that.",
  ],
  tips: [
    "Hold Space longer, ollie higher. Like, way higher.",
    "Off a ramp, hit Space in the air and you go right round. Just make it round before you land!",
    "Land into a manual (L) and your combo keeps going.",
    "Come down on a rail moving along it and you're grinding. Steer to keep your balance.",
    "Space and a direction going up a ramp: you launch that way. Ramp to ramp, man.",
    "Want kickflips? You need flip trucks, dude.",
    "Bigger wheels, bigger top speed. Small ones get you going quicker.",
    "That glow deck though. Wait till it's dark.",
  ],
};

interface Seller {
  truck: MapObject;
  avatar: Avatar;
  /** The two ends of the counter he wanders between. */
  ends: { x: number; y: number }[];
}

export class SkateShop {
  private sellers: Seller[] = [];
  private leg = -1;
  private said = 0;

  constructor(map: ZoneMap, scene: Scene, labels: HTMLElement) {
    map.objects
      .filter((o) => o.kind === "sk_shop")
      .forEach((truck, i) => {
        // In the hatch: the truck's middle, its front row (just behind the counter).
        const at = { x: truck.x + 3, y: truck.y };
        const info: EntityInfo = { id: SELLER_BASE + i, name: SELLER.name, look: SELLER.look, x: at.x, y: at.y, state: 0, speedX10: 0, t0: 0, sprintIn: 0, path: [], mood: 0, away: false, reading: 0, calling: false, style: 0, pet: 0, vehicle: 0, tool: 0 };
        const avatar = new Avatar(info, scene, labels, false, Date.now());
        avatar.markNpc();
        // (In 3D he stands where the van does, in its hatch, not a row behind it.)
        scene.standOn(avatar.sprite, (truck.y + truck.h) * TILE - 1);
        this.sellers.push({ truck, avatar, ends: [at, { x: truck.x + 2, y: truck.y }] });
      });
  }

  update(now: number, wallNow: number) {
    const leg = Math.floor(now / LEG_MS);
    if (leg !== this.leg) {
      this.leg = leg;
      for (const s of this.sellers) {
        const to = s.ends[leg % s.ends.length];
        const from = s.avatar.destination;
        if (Math.round(from.x) === to.x && Math.round(from.y) === to.y) continue;
        s.avatar.setMotion({ path: [{ x: Math.round(from.x), y: Math.round(from.y) }, to], t0: now, speedX10: 8 }, now);
      }
    }
    for (const s of this.sellers) s.avatar.update(now, wallNow);
  }

  /** The seller at `truck`, saying hello (and, every other time, a tip). */
  greet(truck: MapObject) {
    const s = this.sellers.find((x) => x.truck.x === truck.x && x.truck.y === truck.y);
    if (!s) return;
    this.said++;
    const lines = this.said % 2 ? SELLER.hellos : SELLER.tips;
    s.avatar.say(lines[Math.floor(Math.random() * lines.length)]);
  }

  /** Whether `id` is one of the sellers. */
  isSeller(id: number): boolean {
    return id >= SELLER_BASE && id < SELLER_BASE + this.sellers.length;
  }

  destroy() {
    for (const s of this.sellers) s.avatar.destroy();
    this.sellers = [];
  }
}
