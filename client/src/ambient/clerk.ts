// Shopkeepers behind a counter: the clothes shop's clerk and the bar's
// bartender. They potter about behind it, say hello as you come in, and
// chat when tapped. Like the Caretaker, where they stand comes from the wall
// clock alone, so everyone sees the same.

import type { EntityInfo } from "../net/protocol.gen";
import { Avatar } from "../world/avatars";
import { encodeLook } from "../world/look";
import { type MapObject, type ZoneMap, walkable } from "../world/map";
import type { TileXY } from "../world/motion";
import { compress, findPath } from "../world/path";
import type { Scene } from "../world/scene";

export const CLERK_ID = 0xfffffff2;
export const BARTENDER_ID = 0xfffffff4;
export const ATTENDANT_ID = 0xfffffff6;
export const FISHERMAN_ID = 0xfffffff7;
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

/** Who stands behind a counter, and what they say. */
export interface Keeper {
  id: number;
  name: string;
  look: number;
  hellos: string[];
  tips: string[];
}

export const CLERK: Keeper = { id: CLERK_ID, name: "Clerk 🧵", look: CLERK_LOOK, hellos: HELLOS, tips: TIPS };

/** A flannel shirt, a beard-ish short cut and a cap. */
export const BARTENDER: Keeper = {
  id: BARTENDER_ID,
  name: "Bartender 🍺",
  look: encodeLook({ hue: 10, skin: 1, hair: 3, hat: 2, hatHue: 30, style: 0, accessory: 0, outfit: 5 }),
  hellos: ["Welcome to the Mossy Mug! Pull up a stool.", "Evening! Fire's warm, beer's cold.", "Come on in. The pool shark's been waiting for a challenger."],
  tips: [
    "A beer's $5. Fair warning: it goes straight to your head.",
    "Water's free, and it'll set you straight.",
    "Fancy a game? The pool shark doesn't go easy.",
    "Best seat's by the fire, if you ask me.",
  ],
};

/** Neon hoodie, headphones and spiky hair. */
export const ATTENDANT: Keeper = {
  id: ATTENDANT_ID,
  name: "Attendant 🎟️",
  look: encodeLook({ hue: 208, skin: 3, hair: 6, hat: 0, hatHue: 220, style: 5, accessory: 6, outfit: 4 }),
  hellos: ["Welcome to the arcade! Grab a cabinet.", "Insert coin! …just kidding, it's free.", "High scores get tickets. Tickets get prizes."],
  tips: [
    "Win against a person for 10 tickets, the bot for 5. Even a loss gets you 2.",
    "Trade tickets here for clothes. Wear them at any changing room.",
    "The Connect Four bot thinks a few moves ahead. Just saying.",
    "Pong: hit the ball off the edge of your paddle to angle it.",
  ],
};

/** An oilskin coat, a bucket hat and a grey beard-ish cut: the pier's fisherman. */
export const FISHERMAN: Keeper = {
  id: FISHERMAN_ID,
  name: "Fisherman 🎣",
  look: encodeLook({ hue: 48, skin: 1, hair: 3, hat: 2, hatHue: 45, style: 0, accessory: 0, outfit: 5 }),
  hellos: ["Ahoy! Caught anything? I'll buy it.", "Fish are biting today, I can feel it.", "Bring me something rare and I'll make it worth your while."],
  tips: [
    "Minnows are a coin. A dragonfish? Ten, if you ever land one.",
    "The rarer the fish, the harder it fights. Watch that needle!",
    "Catfish and moonfish only come out after dark.",
    "Legendary ones thrash about. Wait for the needle to swing back through.",
    "I've seen a mythical dragonfish once. Pink as a sunset.",
  ],
};

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
    private who: Keeper = CLERK,
  ) {
    // The row behind the counter.
    this.spots = [];
    for (let x = counter.x + 1; x < counter.x + counter.w - 1; x++) {
      if (walkable(map, x, counter.y - 1)) this.spots.push({ x, y: counter.y - 1 });
    }
    const at = this.spots[0] ?? { x: counter.x, y: counter.y - 1 };
    const info: EntityInfo = { id: who.id, name: who.name, look: who.look, x: at.x, y: at.y, state: 0, speedX10: 0, t0: 0, path: [], mood: 0, away: false };
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
    this.avatar.say(this.who.hellos[Math.floor(Math.random() * this.who.hellos.length)]);
  }

  say(text: string) {
    this.avatar.say(text);
  }

  /** Something helpful, a different one each time. */
  chat() {
    this.avatar.say(this.who.tips[this.tip++ % this.who.tips.length]);
  }

  destroy() {
    this.avatar.destroy();
  }
}
