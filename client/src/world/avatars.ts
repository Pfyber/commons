// Avatars: a sprite in the y-sorted layer plus DOM labels (name, chat bubble,
// emote) positioned in screen space so text stays crisp at any zoom.

import { Graphics, Sprite } from "pixi.js";
import type { EntityInfo } from "../net/protocol.gen";
import { type AvatarFrame, BOWL_BACK, BOWL_HOLD, BOWL_PICKUP, BOWL_RELEASE, PUSH_CROUCH, SPRINT_FRAMES, dozeFrame, SKIN_COLORS, TILE, avatarTexture } from "./art";
import { decodeLook } from "./look";
import { type Motion, type TileXY, headingAt, posAt, sprintingAt } from "./motion";
import type { Scene } from "./scene";
import { moodIcon } from "../activities/together";
import { Follower, type PetSprite } from "./pets";
import { BOAT_CAPTAIN, BOAT_PASSENGER, RIDE_POSE, vehicleTexture } from "./vehicles";
import { heldCanTexture } from "./goods";

export const EMOTES: Record<number, { icon: string; label: string }> = {
  1: { icon: "👋", label: "Wave" },
  2: { icon: "😄", label: "Laugh" },
  3: { icon: "👏", label: "Clap" },
  4: { icon: "💃", label: "Dance" },
  5: { icon: "💤", label: "Sleep" },
  6: { icon: "🎉", label: "Cheer" },
  7: { icon: "❤️", label: "Heart" },
  8: { icon: "🤖", label: "Robot" },
  // Playing with toys from the mall.
  9: { icon: "🫧", label: "Blow bubbles" },
  10: { icon: "🪁", label: "Fly a kite" },
  11: { icon: "🪀", label: "Yo-yo" },
  12: { icon: "🌀", label: "Pinwheel" },
};
/** The emotes everyone has (the rest are toys). */
export const FREE_EMOTES = 8;

/** `emote::ROBOT`: a stiff, poppy dance that lasts a little longer than the others. */
const ROBOT = 8;
const ROBOT_MS = 4200;
/**
 * The robot, beat by beat: a pose (art ROBOT_ARMS) and whether the knees pop
 * the body down a pixel. Every fourth beat it turns to face the other way.
 */
const ROBOT_BEATS: { frame: AvatarFrame; pop: boolean }[] = [
  { frame: 7, pop: false },
  { frame: 8, pop: true },
  { frame: 9, pop: false },
  { frame: 8, pop: true },
  { frame: 10, pop: false },
  { frame: 10, pop: true },
  { frame: 11, pop: false },
  { frame: 12, pop: true },
  { frame: 11, pop: false },
  { frame: 12, pop: true },
  { frame: 8, pop: false },
  { frame: 10, pop: true },
];
const ROBOT_BEAT_MS = 220;

const BUBBLE_MS = 6000;
const EMOTE_MS = 2200;
/** How long a position correction (new path starting off our drawn spot) takes to blend out. */
const BLEND_MS = 220;

/** Protocol `state::FISHING`. */
const FISHING = 2;
/** The skateboard's vehicle code (`commons_sim::vehicles`): pushed along, not ridden like the rest. */
const SKATEBOARD = 5;
/** Rods by `tool` code: the plain one, cherrywood, carbon, golden. */
const ROD_COLORS = [0x7a5230, 0xa0473f, 0x2f3440, 0xf2c94c];
/** In a rowboat: where each passenger seat is (px from the captain), and
 * the boat's middle (it's drawn round that, bow toward where they face). */
const SEAT_X = [11, 33, -33];
const BOAT_MID = 11;

/** On wheels: a puff of dust this often, each lasting this long. */
const PUFF_EVERY_MS = 70;
const PUFF_MS = 420;
const REDUCED_MOTION = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** How far the board lifts you: a 2-pixel deck on 4-pixel wheels. */
const BOARD_RISE = 4;
/** Pixels rolled per quarter turn of a wheel (about a quarter of its rim). */
const WHEEL_STEP = 3;
/** The wheel's hub pixel, a quarter turn at a time (clockwise). */
const HUB: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
/**
 * A push, pose by pose like the walk cycle: the sprite frame (its knee bent
 * 1–3 pixels, see art PUSH_CROUCH), how far the back leg leans back (pixels
 * per row) and how long the pose is held. A quick plant just behind the
 * front foot, the push, a hold at full stretch, a quick lift, and the foot
 * coming back to the board.
 */
/** What they're playing, for their pose: at a cabinet, the pool table, a bowling lane (waiting, or up with the ball). */
export type PlayKind = "arcade" | "pool" | "bowl" | "bowl-up";
/** A bowling throw: each pose until this many ms in. The ball leaves the hand at `BOWL_RELEASE_MS`. */
const BOWL_THROW: [number, AvatarFrame][] = [
  [300, BOWL_PICKUP],
  [600, BOWL_HOLD],
  [850, BOWL_BACK],
  [1300, BOWL_RELEASE],
];
export const BOWL_RELEASE_MS = 850;
/** Sprinting: each step of the run cycle (a frame); up a pixel on the strides. */
const SPRINT_STRIDE_MS = 115;
/** A hug and a high five: how long, and how close (px) the two come. */
const HUG_MS = 1900;
const FIVE_MS = 900;
const HUG_GAP = 10;
const FIVE_GAP = 18;
/** Asleep on their feet: every so often they sag lower (s). */
const NOD_S = 9;
/** One slow breath, in and out (s). */
const BREATH_S = 3.4;

const PUSH_POSES: { frame: AvatarFrame; lean: number; ms: number }[] = [
  { frame: 5, lean: 0.3, ms: 80 },
  { frame: 3, lean: 0.5, ms: 110 },
  { frame: 3, lean: 1, ms: 150 },
  { frame: 6, lean: 0.7, ms: 90 },
  { frame: 5, lean: 0.2, ms: 90 },
];
const PUSH_MS = PUSH_POSES.reduce((n, p) => n + p.ms, 0);
/** Gliding with both feet on the board between pushes. */
const GLIDE_MS = 750;

/** The push pose after `ms` of rolling, or null while gliding. */
function pushPose(ms: number): (typeof PUSH_POSES)[number] | null {
  let t = ms % (PUSH_MS + GLIDE_MS);
  for (const p of PUSH_POSES) {
    if (t < p.ms) return p;
    t -= p.ms;
  }
  return null;
}
/** The rod swings out over this long when casting; the bobber lands at the end. */
export const CAST_SWING_MS = 450;
/** How long a bite tugs the rod tip down. */
const BITE_TUG_MS = 2500;
/** The flick up when reeling in, before the rod is put away. */
const REEL_FLICK_MS = 380;
/** Rock paper scissors: three pumps of the fist before the hands are shown. */
export const PUMP_MS = 1200;
/** A fist, knuckles forward (mirrored when facing left). */
const FIST = [".ooo.", "ossso", "ossso", ".ooo."];
const ROD_LEN = 18;
/** Library book covers, as the bindings on the shelves. */
const BOOK_COVERS = [0x7a2e2e, 0x2f5a3c, 0x2c3e66, 0x6b4a2b, 0x8c6d2e, 0x5c2a3e, 0x2f5f5f, 0x8a3f22];
const DEG = Math.PI / 180;

export class Avatar {
  readonly sprite: Sprite;
  private label: HTMLDivElement;
  private stack: HTMLDivElement;
  /** Hugging or high-fiving someone: where they are (each frame), and since when. */
  private act: { kind: "hug" | "five"; partner: () => TileXY | null; start: number } | null = null;
  /** Away from the keyboard, and since when (they doze off); in a game, and where. */
  private away = false;
  private dozeAt = 0;
  private playing: { x: number; y: number; kind: PlayKind } | null = null;
  /**
   * Fighting in the arena: where they stand (tiles; the fight moves them, not
   * walking), which way they face, their pose (null: standing or walking),
   * whether they're stepping, and whether they've just been hit (a red flash).
   */
  private arena: { x: number; y: number; facing: 1 | -1; frame: AvatarFrame | null; walking: boolean; hurt: boolean; lean?: number; lift?: number } | null = null;
  /** Bowling: when they began to throw (pick up, swing back, let go), 0 if not. */
  private bowlAt = 0;
  private snore: HTMLDivElement | null = null;
  private npc = false;
  private nameEl: HTMLSpanElement;
  private bubble: HTMLDivElement | null = null;
  private bubbleUntil = 0;
  private emoteEl: HTMLDivElement | null = null;
  private emoteUntil = 0;
  /** When the current emote started (the robot keeps to its beat from here). */
  private emoteAt = 0;
  private emoteId = 0;
  private motion: Motion | null = null;
  private tile: TileXY;
  private blend = { x: 0, y: 0, until: 0 };
  pos: TileXY;
  private facing = 1;
  showName = true;
  private nameW = 0;
  /** Posture (protocol `state::*`): 0 idle, 1 sitting. */
  state = 0;
  /** Where we stood before sitting down; standing up returns here. */
  standTile: TileXY | null = null;
  /** The pet out on a walk with us, at our heels. */
  private follower: Follower | null = null;
  /** What we're riding, drawn under us. */
  private wheels: Sprite | null = null;
  /** The rod in our hands while fishing, the can while watering. */
  private held: Sprite | null = null;
  private canUntil = 0;
  private rod = new Graphics();
  private board = new Graphics();
  /** On wheels: dust kicked up behind, and streaks for the speed. */
  private trail = new Graphics();
  private puffs: { x: number; y: number; at: number; dir: number }[] = [];
  private lastPuff = 0;
  /** Rock paper scissors: a fist pumping in front of you, from `pumpAt`. */
  private hand = new Graphics();
  /** The library book open in our hands (its Gutenberg number; 0: none). */
  reading = 0;
  private book = new Graphics();
  /** On a phone call: the phone held to the ear. */
  calling = false;
  private phone = new Graphics();
  private pumpAt = -Infinity;
  /** A beer at the bar: wobbly until then (wall clock). */
  private woozyUntil = 0;
  /** Skateboard: when this ride began, the wheels' turn, and where they were last frame. */
  private rolling = false;
  private rollStart = 0;
  private wheelSpin = 0;
  /** Whether this avatar is rolling along on a board right now. */
  get riding() {
    return this.rolling;
  }
  private wheelAt: { x: number; y: number } | null = null;
  private fishing: { castAt: number; biteAt: number } | null = null;
  private reelAt = -Infinity;
  /** A fish out on the bank, still on our line, until then: the rod stays up, tugging. */
  private hookedUntil = 0;
  /** World position and depth of the rod's tip once the line is out, for drawing the line. */
  rodTip: { x: number; y: number; z: number } | null = null;

  constructor(
    public info: EntityInfo,
    private scene: Scene,
    labels: HTMLElement,
    readonly isSelf: boolean,
    now: number,
  ) {
    this.sprite = new Sprite(avatarTexture(info.look, 0, info.style));
    this.sprite.anchor.set(0.5, 1);
    this.tile = { x: info.x, y: info.y };
    this.pos = { ...this.tile };
    this.label = document.createElement("div");
    this.label.className = isSelf ? "label self" : "label";
    this.stack = document.createElement("div");
    this.stack.className = "stack";
    this.nameEl = document.createElement("span");
    this.nameEl.className = "name";
    this.nameEl.textContent = info.name;
    this.stack.appendChild(this.nameEl);
    this.label.appendChild(this.stack);
    labels.appendChild(this.label);
    scene.sorted.addChild(this.trail, this.sprite, this.rod, this.board, this.hand, this.book, this.phone);
    this.apply(info, now);
  }

  /** Shows the avatar's mood (`mood::*`) as a sign before its name. */
  setMood(mood: number) {
    let sign = this.nameEl.querySelector<HTMLSpanElement>(".mood");
    const icon = moodIcon(mood);
    if (!icon) {
      sign?.remove();
      this.nameW = 0;
      return;
    }
    if (!sign) {
      sign = document.createElement("span");
      sign.className = "mood";
      this.nameEl.prepend(sign);
      this.nameW = 0;
    }
    sign.textContent = icon;
  }

  /** Styles the name tag as a non-player character's. */
  markNpc() {
    this.label.classList.add("npc");
    this.npc = true;
  }

  /** Away from the keyboard (AwayChanged): they doze off on their feet. */
  setAway(away: boolean) {
    if (away && !this.away) this.dozeAt = performance.now();
    this.away = away;
  }

  /**
   * In a game at a machine or table at (x, y) (tiles): they face it and look
   * busy: pressing buttons at a cabinet, cue in hand at the pool table.
   */
  setPlaying(at: { x: number; y: number; kind: PlayKind } | null) {
    this.playing = at;
  }

  /** On a phone call (CallingShown): the phone at their ear, and 📞 by the name. */
  setCalling(on: boolean) {
    this.calling = on;
    let mark = this.nameEl.querySelector<HTMLSpanElement>(".calling");
    if (!on) {
      mark?.remove();
      this.nameW = 0;
      return;
    }
    if (!mark) {
      mark = document.createElement("span");
      mark.className = "calling";
      mark.textContent = "📞";
      this.nameEl.appendChild(mark);
      this.nameW = 0;
    }
  }

  /** On the Concert Hall's stage (ADR 0015): 🎤 by the name. */
  setPerforming(on: boolean) {
    let mark = this.nameEl.querySelector<HTMLSpanElement>(".performing");
    if (!on) {
      if (mark) {
        mark.remove();
        this.nameW = 0;
      }
      return;
    }
    if (!mark) {
      mark = document.createElement("span");
      mark.className = "performing";
      mark.textContent = "🎤";
      this.nameEl.appendChild(mark);
      this.nameW = 0;
    }
  }

  /** A library book open in their hands (ReadingShown; 0: closed), and 📖 by the name. */
  setReading(book: number) {
    this.reading = book;
    let mark = this.nameEl.querySelector<HTMLSpanElement>(".reading");
    if (!book) {
      mark?.remove();
      this.nameW = 0;
      return;
    }
    if (!mark) {
      mark = document.createElement("span");
      mark.className = "reading";
      mark.textContent = "📖";
      this.nameEl.appendChild(mark);
      this.nameW = 0;
    }
  }

  /** In the arena's fight (or out of it, with null). */
  setArena(a: { x: number; y: number; facing: 1 | -1; frame: AvatarFrame | null; walking: boolean; hurt: boolean; lean?: number; lift?: number } | null) {
    this.arena = a;
    if (a) {
      this.motion = null;
      this.pos = { x: a.x, y: a.y };
    } else this.sprite.tint = 0xffffff;
  }

  /** Bowls a ball: crouches for it, swings it back and lets it go down the lane. */
  bowl(wallNow: number) {
    this.bowlAt = wallNow;
  }

  /** Shows a founder's leaf by the name (title: "Founder #n"). */
  setFounder(no: number | null) {
    let leaf = this.nameEl.querySelector<HTMLSpanElement>(".founder");
    if (no === null) {
      leaf?.remove();
      this.nameW = 0;
      return;
    }
    if (!leaf) {
      leaf = document.createElement("span");
      leaf.className = "founder";
      leaf.textContent = "🌱";
      this.nameEl.appendChild(leaf);
      this.nameW = 0;
    }
    leaf.title = `Founder #${no}`;
  }

  /** Shows the crest of the club they show (ADR 0014) by the name. */
  setClub(badge: { club: string; crest: string; color: string } | null) {
    let mark = this.nameEl.querySelector<HTMLSpanElement>(".club-badge");
    if (!badge) {
      if (mark) {
        mark.remove();
        this.nameW = 0;
      }
      return;
    }
    if (!mark) {
      mark = document.createElement("span");
      mark.className = "club-badge";
      this.nameEl.appendChild(mark);
      this.nameW = 0;
    }
    mark.textContent = badge.crest;
    mark.style.background = badge.color;
    mark.title = badge.club;
  }

  /** Updates from a Spawn/CellEnter snapshot. */
  apply(info: EntityInfo, now: number) {
    this.info = info;
    this.state = info.state;
    this.setMood(info.mood);
    this.setAway(info.away);
    this.setReading(info.reading);
    this.setCalling(info.calling);
    if (info.path.length > 0) this.setMotion({ path: info.path, t0: info.t0, speedX10: info.speedX10, sprintIn: info.sprintIn }, now);
    else this.snap({ x: info.x, y: info.y });
  }

  /** StateChange from the server: sit down on / stand up from `at`. */
  setState(state: number, at: TileXY) {
    if (state === 1 && this.state !== 1) this.standTile = this.destination;
    if (state !== 1) this.standTile = null;
    if (state !== FISHING) this.fishing = null;
    this.state = state;
    this.snap(at);
  }

  /** FishEvent CAST: face the water and swing the rod out. */
  castLine(target: TileXY, now: number) {
    const dx = target.x - this.destination.x;
    if (dx !== 0) this.facing = dx > 0 ? 1 : -1;
    this.fishing = { castAt: now, biteAt: 0 };
    this.reelAt = -Infinity;
  }

  /** FishEvent BITE: the rod tip tugs. */
  bite(now: number) {
    if (this.fishing) this.fishing.biteAt = now;
  }

  /** A fish still on the line for `ms` from now (0: off it). */
  hook(ms: number) {
    this.hookedUntil = ms ? performance.now() + ms : 0;
  }

  /** Caught or got away: flick the rod up, then put it away. */
  reelIn(now: number) {
    if (this.fishing || this.state === FISHING) this.reelAt = now;
    this.fishing = null;
  }

  setMotion(m: Motion, now: number) {
    // Where we are drawn right now: on the old walk at this very moment (not
    // where the last frame put us, a frame behind), plus any blend still easing out.
    const old = this.motion;
    const at = old ? posAt(old, now) : this.pos;
    const left = Math.max(0, (this.blend.until - performance.now()) / BLEND_MS);
    const before = { x: at.x + this.blend.x * left, y: at.y + this.blend.y * left };
    this.motion = m;
    const target = posAt(m, now);
    this.blend = { x: before.x - target.x, y: before.y - target.y, until: performance.now() + BLEND_MS };
  }

  snap(t: TileXY) {
    this.motion = null;
    this.tile = t;
    this.pos = { ...t };
    this.blend.until = 0;
  }

  get currentMotion(): Motion | null {
    return this.motion;
  }

  get moving(): boolean {
    return this.motion !== null;
  }

  /** Where the avatar will stand when its current walk ends. */
  get destination(): TileXY {
    return this.motion ? this.motion.path[this.motion.path.length - 1] : this.tile;
  }

  say(text: string) {
    if (!this.bubble) {
      this.bubble = document.createElement("div");
      this.bubble.className = "bubble";
      this.stack.appendChild(this.bubble);
    }
    this.bubble.textContent = text;
    this.bubble.classList.remove("fade");
    this.bubbleUntil = performance.now() + BUBBLE_MS + text.length * 40;
  }

  emote(id: number) {
    const e = EMOTES[id];
    if (!e) return;
    this.flash(e.icon);
    this.emoteId = id;
    if (id === ROBOT) {
      this.emoteAt = performance.now();
      this.emoteUntil = this.emoteAt + ROBOT_MS;
    }
  }

  /** Dances for `ms` more (the Dance Off machine keeps its dancers going). */
  keepDancing(ms: number) {
    this.emoteId = 4;
    this.emoteUntil = Math.max(this.emoteUntil, performance.now() + ms);
  }

  /** Pops `icon` above the head for a moment (emotes, jam notes). */
  flash(icon: string) {
    if (!this.emoteEl) {
      this.emoteEl = document.createElement("div");
      this.emoteEl.className = "emote";
      this.stack.appendChild(this.emoteEl);
    }
    this.emoteEl.textContent = icon;
    this.emoteEl.classList.remove("pop");
    void this.emoteEl.offsetWidth; // restart the animation
    this.emoteEl.classList.add("pop");
    this.emoteId = 0;
    this.emoteUntil = performance.now() + EMOTE_MS;
  }

  update(serverNow: number, wallNow: number) {
    let heading: TileXY | null = null;
    if (this.motion) {
      this.pos = posAt(this.motion, serverNow);
      heading = headingAt(this.motion, serverNow);
      if (!heading && serverNow > this.motion.t0) {
        const end = this.destination;
        this.snap({ x: end.x, y: end.y });
      }
    }
    let { x, y } = this.pos;
    if (wallNow < this.blend.until) {
      const f = (this.blend.until - wallNow) / BLEND_MS;
      x += this.blend.x * f;
      y += this.blend.y * f;
    }
    if (heading && Math.abs(heading.x) > 0.1) this.facing = heading.x > 0 ? 1 : -1;
    const fighting = this.arena;
    if (fighting) {
      x = fighting.x;
      y = fighting.y;
      this.pos = { x, y };
      this.facing = fighting.facing;
      this.sprite.tint = fighting.hurt ? 0xff8080 : 0xffffff;
    }

    const walking = heading !== null || !!fighting?.walking;
    const sitting = this.state === 1 && !walking;
    // On wheels (outdoors): a skateboard is pushed along; skates still
    // stride; on a bike you sit, on a scooter you stand.
    const vehicle = sitting ? 0 : this.info.vehicle;
    const skating = vehicle === SKATEBOARD;
    const ride = vehicle && !skating ? RIDE_POSE[vehicle] : undefined;
    const dancing = this.emoteId === 4 && wallNow < this.emoteUntil;
    const beat = this.emoteId === ROBOT && wallNow < this.emoteUntil && !walking && !sitting && !skating ? Math.floor((wallNow - this.emoteAt) / ROBOT_BEAT_MS) : -1;
    const robot = beat >= 0 ? ROBOT_BEATS[beat % ROBOT_BEATS.length] : null;
    // On a skateboard: push off with the back foot, then glide.
    if (skating && walking && !this.rolling) this.rollStart = wallNow;
    this.rolling = skating && walking;
    const push = this.rolling ? pushPose(wallNow - this.rollStart) : null;
    const stepping = (walking && !skating && (!ride || ride.pose === "walk")) || dancing;
    // Walking on and on outdoors breaks into a sprint: quick long strides.
    const sprinting = walking && !vehicle && !!this.motion && sprintingAt(this.motion, serverNow);
    // Hugging or high-fiving: lean in toward them (whole pixels), arms busy.
    let leanX = 0;
    let leanY = 0;
    let actFrame: AvatarFrame | null = null;
    if (this.act) {
      const t = wallNow - this.act.start;
      const dur = this.act.kind === "hug" ? HUG_MS : FIVE_MS;
      const p = t < dur && !walking && !sitting ? this.act.partner() : null;
      if (!p) this.act = null;
      else {
        const dx = (p.x - x) * TILE;
        const dy = (p.y - y) * TILE;
        const d = Math.hypot(dx, dy);
        if (Math.abs(dx) > 1) this.facing = dx > 0 ? 1 : -1;
        if (this.act.kind === "hug") {
          // In over 0.2 s, hold (with a slow sway together), out over 0.25 s.
          const ease = Math.min(1, t / 200) * Math.min(1, (dur - t) / 250);
          const move = d > 0 ? (Math.max(0, d - HUG_GAP) / 2) * ease : 0;
          leanX = Math.round((dx / (d || 1)) * move + (ease >= 1 ? Math.round(Math.sin(t / 220)) : 0));
          leanY = Math.round((dy / (d || 1)) * move);
          actFrame = 8;
        } else {
          // Wind up, then lean in and slap at the top.
          const swing = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 150) / 600)));
          const move = d > 0 ? (Math.max(0, d - FIVE_GAP) / 2) * swing : 0;
          leanX = Math.round((dx / (d || 1)) * move);
          leanY = Math.round((dy / (d || 1)) * move);
          actFrame = t < 300 ? 9 : t < 700 ? 10 : 0;
        }
      }
    }
    // Away from the keyboard: nodding off on their feet (never mid-game, or doing something).
    const busy = walking || this.state !== 0 || dancing || robot || this.fishing || actFrame !== null;
    const dozing = !this.npc && this.away && !this.playing && !busy;
    // In a game: facing the machine or table, hands busy.
    const playing = this.playing && !busy ? this.playing : null;
    if (playing && Math.abs(playing.x - x) > 0.3) this.facing = playing.x > x ? 1 : -1;
    this.showSnore(dozing);
    // Bowling a ball: down for it, up with it, back, and away.
    const bt = this.bowlAt ? wallNow - this.bowlAt : -1;
    if (bt > BOWL_THROW[BOWL_THROW.length - 1][0]) this.bowlAt = 0;
    const bowlFrame = bt >= 0 && !walking ? (BOWL_THROW.find(([until]) => bt < until)?.[1] ?? null) : null;
    const frame: AvatarFrame = fighting?.frame != null
      ? fighting.frame
      : actFrame !== null
      ? actFrame
      : dozing
        ? dozeFrame(this.slump(wallNow))
        : sitting
        ? 2
        : skating
          ? (push?.frame ?? 4)
          : ride?.pose === "sit"
            ? 2
            : ride?.pose === "stand"
              ? 0
          : robot
            ? robot.frame
            : sprinting
              ? SPRINT_FRAMES[Math.floor(wallNow / SPRINT_STRIDE_MS) % SPRINT_FRAMES.length]
              : stepping
              ? ((Math.floor(wallNow / (ride ? 220 : 160)) % 2) as 0 | 1)
              : bowlFrame !== null
                ? bowlFrame
              : playing
                ? playing.kind === "bowl-up"
                  ? BOWL_HOLD
                  : playing.kind === "bowl"
                    ? 0
                  : playing.kind === "pool"
                  ? 8
                  : Math.floor(wallNow / 140) % 3 === 0
                    ? 12
                    : 11
                : 0;
    this.sprite.texture = avatarTexture(this.info.look, frame, this.info.style);
    const bob = skating
      ? -BOARD_RISE
      : ride
        ? -ride.lift
        : sprinting
        ? -(Math.floor(wallNow / SPRINT_STRIDE_MS) % 2 === 0 ? 1 : 0)
        : walking
        ? Math.abs(Math.sin(wallNow / 90)) * -1.5
        : dancing && !sitting
          ? Math.sin(wallNow / 70) * 2
          : robot?.pop
            ? 1
            : 0;
    // Afloat: passengers sit along the boat; everyone aboard bobs on the water.
    const afloat = vehicle >= BOAT_CAPTAIN;
    const seat = vehicle >= BOAT_PASSENGER ? vehicle - BOAT_PASSENGER : -1;
    if (seat >= 0) leanX += SEAT_X[seat] ?? 0;
    const wave = afloat ? Math.round(Math.sin(wallNow / 450)) : 0;
    const feetX = x * TILE + TILE / 2 + leanX;
    // Seated avatars sit on the bench's slats, drawn just in front of it.
    const feetY = y * TILE + TILE - (sitting ? 6 : 4) + leanY;
    // Woozy: a slow sway, a stagger from side to side while walking, a tilt.
    const woozy = wallNow < this.woozyUntil && !sitting;
    const sway = woozy ? Math.sin(wallNow / 420) * 2.5 + (walking ? Math.sin(wallNow / 140) * 3 : 0) : 0;
    // In the arena a leap tips them (round their feet) and lifts them off the sand.
    this.sprite.rotation = fighting?.lean ? fighting.lean : woozy ? Math.sin(wallNow / 560) * 0.1 : 0;
    // Asleep on their feet, in whole pixels only (no tilting or stretching):
    // a slow breath sinks them a pixel and back; every few seconds they sag
    // a pixel lower still, then jerk awake a pixel up for a blink, and settle.
    this.sprite.position.set(Math.round(feetX + sway), Math.round(feetY + bob + wave - (fighting?.lift ?? 0)));
    // The robot turns on the beat: every four beats it faces the other way.
    this.sprite.scale.x = robot && Math.floor(beat / 4) % 2 === 1 ? -this.facing : this.facing;
    this.sprite.zIndex = sitting ? y * TILE + TILE : feetY + 0.5;
    this.drawBoard(skating, feetX, feetY, push);
    this.drawRod(feetX, feetY + bob, walking, wallNow);
    this.drawFist(feetX, Math.round(feetY + bob), wallNow);
    this.drawBook(feetX, Math.round(feetY + bob));
    this.drawPhone(feetX, Math.round(feetY + bob));
    this.updateWheels(ride && seat < 0 ? vehicle : 0, feetX, feetY + wave, walking, wallNow);
    this.drawTrail(walking && !!vehicle && seat < 0, feetX, feetY, wallNow, afloat);
    this.updateCan(feetX, feetY, wallNow);
    this.updatePet({ x, y }, wallNow);

    // DOM label above the head.
    // Afloat, names spread along the boat (the front seat's a little higher, clear of the captain's).
    const s = this.scene.tileToScreen(x + 0.5 + (seat >= 0 ? (SEAT_X[seat] ?? 0) / TILE : 0), y + 1 - 4 / TILE - 34 / TILE - (seat === 0 ? 12 / TILE : 0));
    this.label.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`;
    this.nameEl.hidden = !this.showName;
    if (this.bubble && wallNow > this.bubbleUntil) {
      if (!this.bubble.classList.contains("fade")) this.bubble.classList.add("fade");
      if (wallNow > this.bubbleUntil + 400) {
        this.bubble.remove();
        this.bubble = null;
      }
    }
    if (this.emoteEl && wallNow > this.emoteUntil) {
      this.emoteEl.remove();
      this.emoteEl = null;
      this.emoteId = 0;
    }
  }

  /**
   * The skateboard under your feet, in whole pixels like the sprites: a black
   * deck on cream wheels whose mark ticks round as you roll, and, mid-push,
   * the back leg reaching for the ground behind the board.
   */
  private drawBoard(on: boolean, feetX: number, feetY: number, push: (typeof PUSH_POSES)[number] | null) {
    const g = this.board.clear();
    if (!on) {
      this.wheelAt = null;
      return;
    }
    // Turn the wheels by how far we've rolled since the last frame.
    if (this.wheelAt) this.wheelSpin += Math.hypot(feetX - this.wheelAt.x, feetY - this.wheelAt.y);
    this.wheelAt = { x: feetX, y: feetY };
    const x = Math.round(feetX);
    const y = Math.round(feetY); // the ground under the wheels
    const s = this.facing;
    const O = 0x3b3a2e;
    g.rect(x - 11, y, 22, 1).fill({ color: 0x000000, alpha: 0.18 });
    // Round 4×4 wheels (the corners off), with a hub pixel turning a
    // quarter at a time as they roll, the way you're going.
    const q = Math.floor(this.wheelSpin / WHEEL_STEP) % 4;
    const [hx, hy] = HUB[s > 0 ? q : (4 - q) % 4];
    for (const wx of [x - 8, x + 4]) {
      g.rect(wx + 1, y - 4, 2, 1).fill(O);
      g.rect(wx, y - 3, 4, 2).fill(O);
      g.rect(wx + 1, y - 3, 2, 2).fill(0xf1e9d2);
      g.rect(wx + 1 + hx, y - 3 + hy, 1, 1).fill(0x9c8f73);
      g.rect(wx + 1, y - 1, 2, 1).fill(O);
    }
    // The deck: 2 pixels of black, kicked up a pixel at each end.
    g.rect(x - 11, y - 6, 22, 2).fill(0x141414);
    g.rect(x - 10, y - 6, 20, 1).fill(0x2a2a2a);
    g.rect(x - 12, y - 7, 2, 2).fill(0x141414);
    g.rect(x + 10, y - 7, 2, 2).fill(0x141414);
    if (push) {
      // The back leg, pixel for pixel the sprite's own (7 rows: outline,
      // trousers, a shoe row), each row stepped back by its lean. It starts
      // at the hip, which sinks with the standing knee's bend.
      const c = PUSH_CROUCH[push.frame];
      const hipY = y - BOARD_RISE - 9 + c;
      const left = s > 0 ? x - 4 : x;
      for (let k = 0; k < 7; k++) {
        const lx = left - s * Math.round(k * push.lean);
        g.rect(lx, hipY + k, 4, 1).fill(O);
        if (k < 6) g.rect(lx + 1, hipY + k, 2, 1).fill(0x4a4a5a);
      }
    }
    this.board.zIndex = this.sprite.zIndex - 0.1;
  }

  /** A beer: woozy for `ms` (0: sober again). */
  setWoozy(ms: number) {
    this.woozyUntil = ms ? performance.now() + ms : 0;
  }

  get woozy(): boolean {
    return performance.now() < this.woozyUntil;
  }

  /** Turns to face tile column `x` (standing still; walking turns you anyway). */
  /**
   * A hug or a high five with someone (whose spot `partner` gives each frame):
   * the two turn to each other and step in close; a hug wraps its arms round
   * and squeezes, swaying, then lets go; a high five winds up and slaps.
   */
  together(kind: "hug" | "five", partner: () => TileXY | null) {
    this.act = { kind, partner, start: performance.now() };
  }

  faceToward(x: number) {
    if (Math.abs(x - this.pos.x) > 0.1) this.facing = x > this.pos.x ? 1 : -1;
  }

  /** "Rock, paper, scissors…": pumps a fist three times from now. */
  pumpFist(now: number) {
    this.pumpAt = now;
  }

  /**
   * The open book held up in both hands at chest height: its cover's colour
   * (from the book), cream pages, a line or two of print.
   */
  private drawBook(feetX: number, spriteBottom: number) {
    const g = this.book.clear();
    if (!this.reading || this.state === FISHING || this.playing) return;
    const cover = BOOK_COVERS[this.reading % BOOK_COVERS.length];
    const x = Math.round(feetX) - 6;
    const y = spriteBottom - 17;
    g.rect(x, y, 12, 8).fill(0x3b3a2e);
    g.rect(x + 1, y + 1, 10, 6).fill(cover);
    g.rect(x + 1, y, 4, 6).fill(0xfbf5e6);
    g.rect(x + 7, y, 4, 6).fill(0xfbf5e6);
    g.rect(x + 2, y + 2, 2, 1).fill(0xb8ab8e);
    g.rect(x + 8, y + 2, 2, 1).fill(0xb8ab8e);
    g.rect(x + 2, y + 4, 2, 1).fill(0xb8ab8e);
    g.rect(x + 8, y + 4, 2, 1).fill(0xb8ab8e);
    g.rect(x + 5, y, 2, 7).fill(0x3b3a2e);
    this.book.zIndex = this.sprite.zIndex + 0.15;
  }

  /** The phone held up to the ear on the side we face, while on a call. */
  private drawPhone(feetX: number, spriteBottom: number) {
    const g = this.phone.clear();
    if (!this.calling) return;
    const x = Math.round(feetX) + (this.facing > 0 ? 4 : -7);
    const y = spriteBottom - 30;
    g.rect(x, y, 3, 7).fill(0x3b3a2e);
    g.rect(x + 1, y + 1, 1, 4).fill(0x8fd0e8);
    this.phone.zIndex = this.sprite.zIndex + 0.16;
  }

  /** The pumping fist, in whole pixels at the end of the front arm. */
  private drawFist(feetX: number, spriteBottom: number, now: number) {
    const g = this.hand.clear();
    const t = now - this.pumpAt;
    if (t < 0 || t >= PUMP_MS) return;
    const s = this.facing;
    const x = Math.round(feetX);
    // Up on the beats, down in between: three pumps, ending down.
    const up = Math.floor(t / (PUMP_MS / 6)) % 2 === 0 ? 3 : 0;
    const left = s > 0 ? x + 7 : x - 12;
    const top = spriteBottom - 14 - up;
    const skin = Number.parseInt((SKIN_COLORS[decodeLook(this.info.look).skin] ?? "#e9c4a0").slice(1), 16);
    FIST.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const c = row[s > 0 ? dx : row.length - 1 - dx];
        if (c !== ".") g.rect(left + dx, top + dy, 1, 1).fill(c === "o" ? 0x3b3a2e : skin);
      }
    });
    this.hand.zIndex = this.sprite.zIndex + 0.2;
  }

  /** The rod in the front hand while fishing (its colour: the rod in use, from the mall's Tools shop): cast swing, gentle sway, bite tug, reel flick. */
  private drawRod(feetX: number, feetY: number, walking: boolean, now: number) {
    const g = this.rod.clear();
    this.rodTip = null;
    const reeling = now - this.reelAt < REEL_FLICK_MS;
    const hooked = now < this.hookedUntil;
    if (!reeling && !hooked && (this.state !== FISHING || walking)) return;
    // Angle above the horizontal, pointing the way we face.
    let a: number;
    const f = this.fishing;
    const swing = f ? Math.min(1, (now - f.castAt) / CAST_SWING_MS) : 1;
    if (hooked && !reeling) a = 52 + Math.sin(now / 70) * 5; // held up, the fish tugging at it
    else if (reeling) a = 35 + 60 * Math.sin(((now - this.reelAt) / REEL_FLICK_MS) * (Math.PI / 2));
    else if (swing < 1) a = 120 - 85 * (1 - (1 - swing) ** 3); // from over the shoulder to out front
    else if (f && f.biteAt && now - f.biteAt < BITE_TUG_MS) a = 22 + Math.sin(now / 45) * 6;
    else a = 35 + Math.sin(now / 800) * 2;

    const s = this.facing;
    const cos = Math.cos(a * DEG) * s;
    const sin = Math.sin(a * DEG);
    const hx = feetX + 7 * s; // the front hand on the 24×34 avatar
    const hy = feetY - 12;
    const tx = hx + cos * ROD_LEN;
    const ty = hy - sin * ROD_LEN;
    const bx = hx - cos * 3; // butt of the handle, behind the hand
    const by = hy + sin * 3;
    g.moveTo(bx, by).lineTo(tx, ty).stroke({ width: 1.5, color: ROD_COLORS[(this.info.tool ?? 0) & 0xf] ?? ROD_COLORS[0] });
    g.moveTo(bx, by).lineTo(hx + cos * 3, hy - sin * 3).stroke({ width: 2.5, color: 0x3b2a1e });
    g.rect(Math.round(hx) - 1, Math.round(hy), 2, 2).fill(0x9aa0a6); // the reel
    this.rod.zIndex = this.sprite.zIndex + 0.1;
    if ((hooked || !reeling) && swing >= 1) this.rodTip = { x: tx, y: ty, z: this.rod.zIndex };
  }

  /** Screen box of the name tag (measured once), for decluttering overlapping names. */
  nameBox(): { x0: number; x1: number; y: number } {
    if (!this.nameW && !this.nameEl.hidden) this.nameW = this.nameEl.offsetWidth;
    const w = this.nameW || this.info.name.length * 7;
    const s = this.scene.tileToScreen(this.pos.x + 0.5, this.pos.y);
    return { x0: s.x - w / 2, x1: s.x + w / 2, y: s.y };
  }

  private updateWheels(code: number, feetX: number, feetY: number, moving: boolean, now: number) {
    if (!code) {
      if (this.wheels) this.wheels.visible = false;
      return;
    }
    if (!this.wheels) {
      this.wheels = new Sprite(vehicleTexture(code));
      this.wheels.anchor.set(0.5, 1);
      this.scene.sorted.addChild(this.wheels);
    }
    const w = this.wheels;
    w.visible = true;
    if (code === BOAT_CAPTAIN) {
      // The rowboat round everyone aboard, the oars dipping as they row.
      w.texture = vehicleTexture(code, moving ? ((Math.floor(now / 300) % 2) as 0 | 1) : 0);
      w.position.set(Math.round(feetX + BOAT_MID), Math.round(feetY + 8));
      w.scale.x = this.facing;
      w.zIndex = feetY + 0.6;
      return;
    }
    w.texture = vehicleTexture(code, moving ? ((Math.floor(now / 50) % 2) as 0 | 1) : 0);
    w.position.set(Math.round(feetX), Math.round(feetY + 3));
    w.scale.x = this.facing;
    // In front of the rider's legs.
    w.zIndex = feetY + 0.6;
  }

  /**
   * Riding fast: little puffs of dust left behind the wheels, fading and
   * spreading, and a couple of streaks just behind the rider while moving.
   */
  private drawTrail(moving: boolean, feetX: number, feetY: number, now: number, water = false) {
    const g = this.trail.clear();
    if (moving && now - this.lastPuff > PUFF_EVERY_MS && !REDUCED_MOTION) {
      this.lastPuff = now;
      // A boat leaves its wake behind the stern; wheels kick up dust behind them.
      const back = water ? BOAT_MID - this.facing * 46 : -this.facing * 9;
      this.puffs.push({ x: feetX + back, y: feetY + (water ? 6 : 2), at: now, dir: -this.facing });
    }
    this.puffs = this.puffs.filter((p) => now - p.at < (water ? PUFF_MS * 2 : PUFF_MS));
    if (!this.puffs.length && !moving) return;
    for (const p of this.puffs) {
      const t = (now - p.at) / (water ? PUFF_MS * 2 : PUFF_MS);
      if (water) {
        // Ripples spreading on the water.
        g.ellipse(Math.round(p.x + p.dir * t * 4), Math.round(p.y), 3 + t * 9, 1 + t * 2).stroke({ color: 0xeaf6ff, alpha: 0.8 * (1 - t), width: 1 });
        continue;
      }
      const r = 2 + t * 4;
      g.circle(Math.round(p.x + p.dir * t * 6), Math.round(p.y - t * 4), r).fill({ color: 0xb8ab8c, alpha: 0.7 * (1 - t) });
    }
    if (moving && !water && !REDUCED_MOTION) {
      // Streaks behind, at chest and knee height, flickering a little.
      const back = -this.facing;
      const flick = Math.floor(now / 60) % 2;
      for (const [dy, len] of [[-22, 10 + flick * 3], [-12, 7 + (1 - flick) * 3]]) {
        const x0 = Math.round(feetX + back * 9);
        g.rect(back > 0 ? x0 : x0 - len, Math.round(feetY + dy), len, 1).fill({ color: 0xffffff, alpha: 0.6 });
      }
    }
    this.trail.zIndex = feetY - 0.5;
  }

  /** Watering a plant: the can shows for a moment. */
  showCan(now: number) {
    this.canUntil = now + 1400;
  }

  /** The watering can, while watering (the rod is drawn by `drawRod`). */
  private updateCan(feetX: number, feetY: number, now: number) {
    if (now >= this.canUntil) {
      if (this.held) this.held.visible = false;
      return;
    }
    const tex = heldCanTexture((this.info.tool ?? 0) >> 4);
    if (!this.held) {
      this.held = new Sprite(tex);
      this.held.anchor.set(0, 1);
      this.scene.sorted.addChild(this.held);
    }
    const h = this.held;
    h.texture = tex;
    h.visible = true;
    h.scale.x = this.facing;
    h.position.set(Math.round(feetX + this.facing * 3), Math.round(feetY - 8));
    h.zIndex = feetY + 0.7;
  }

  /** The pet with us (if any), keeping up. */
  get pet(): PetSprite | null {
    return this.follower?.pet ?? null;
  }

  private updatePet(at: TileXY, now: number) {
    const code = this.info.pet;
    if (this.follower && this.follower.pet.code !== code) {
      this.follower.destroy();
      this.follower = null;
    }
    if (!code) return;
    if (!this.follower) {
      this.follower = new Follower(code, at);
      this.scene.sorted.addChild(this.follower.pet.view);
    }
    this.follower.update(at, this.facing, now);

  }

  /**
   * How far a sleeper's upper body has slumped (0–2 pixels; the legs stay
   * put): slow, eased breaths in and out, and every so often a long, slow
   * sag that eases back up, never a snap.
   */
  private slump(wallNow: number): number {
    const z = (wallNow - this.dozeAt) / 1000;
    const breath = (1 - Math.cos((z / BREATH_S) * Math.PI * 2)) / 2;
    const n = (z % NOD_S) / NOD_S;
    // Sag over the first two thirds, ease back up over the last third.
    const sag = n < 0.66 ? (1 - Math.cos((n / 0.66) * Math.PI)) / 2 : (1 + Math.cos(((n - 0.66) / 0.34) * Math.PI)) / 2;
    return Math.round(breath * 0.9 + sag * 1.1);
  }

  /** "z Z Z" floating up over a sleeper's head. */
  private showSnore(on: boolean) {
    if (on && !this.snore) {
      this.snore = document.createElement("div");
      this.snore.className = "snore";
      for (const z of ["z", "Z", "Z"]) {
        const s = document.createElement("span");
        s.textContent = z;
        this.snore.appendChild(s);
      }
      this.stack.appendChild(this.snore);
    } else if (!on && this.snore) {
      this.snore.remove();
      this.snore = null;
    }
  }

  destroy() {
    this.follower?.destroy();
    this.wheels?.destroy();
    this.held?.destroy();
    this.sprite.destroy();
    this.rod.destroy();
    this.board.destroy();
    this.trail.destroy();
    this.hand.destroy();
    this.book.destroy();
    this.phone.destroy();
    this.label.remove();
  }
}
