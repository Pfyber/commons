// The skatepark: get on a board and skate, as many at once as like. Free
// skate (just ride, every combo counts), a 60-second run (score all you can
// before the horn, THPS style), or a line (one combo, as long as you can
// keep it going: manuals between landings). The rules are skatesim.ts; here
// they're played: your keys (or a stick and buttons on a phone), your
// avatar on its board in the park, the sounds, the score on screen, and
// everyone else skating there too, as the server passes their moves on.
//
// Keys: arrows / WASD ride (the board turns your way and you push off; pull
// back to stop), Space: hold to crouch, let go to ollie (longer, higher);
// pressed again in the air, a trick (off a ramp a full flip head over heels, else a kickflip).
// In the air J flips (which flip by the way you're holding: none a kickflip,
// ← heelflip, → varial, ↑ hardflip, ↓ shove-it; J again quick for a
// double), K grabs (held: worth more the longer), Q / E spin. Come down on a
// rail or a ledge, moving along it, and you grind it (← → to balance; Space
// to pop off). L on the ground: a manual (balance it with ← →), which keeps
// a combo going over a landing. Land straight, or bail. Esc gets off.

import { type Container, Graphics } from "pixi.js";
import * as sfx from "../ambient/skatesfx";
import type { ServerMsg } from "../net/protocol.gen";
import { Panel, button, el, isTyping } from "../ui/panels";
import { TILE, legColor, skateCrouch, type AvatarFrame } from "../world/art";
import { type Avatar, PUSH_POSES, drawPushLeg, pushPose } from "../world/avatars";
import type { ZoneMap } from "../world/map";
import type { Scene } from "../world/scene";
import { NO_INPUT, PUSH_S, Park, Skater, TRICK, type Input, type SkateEvent, wrap } from "./skatesim";
import type { Economy } from "../economy";
import { DECKS, STOCK, loadKit, needs, packKit, ride, saveKit, streetRide, unpackKit, type Kit } from "./skatekit";
import { GRINDS } from "./skatesim";
import { Quests, type Metric } from "./skatequests";
import { BotRider } from "./skatebot";
import { questList } from "../ui/skateshop";

export type SkateSend =
  | { t: "SkateOn"; on: boolean; kit: number }
  | { t: "SkateMove"; x: number; y: number; z: number; dir: number; pose: number; trick: number; spin: number; sent: number; kit: number }
  | { t: "SkateScore"; kind: number; points: number; label: string }
  | { t: "SkateQuest"; day: number; slot: number }
  | { t: "SkateDuel"; join: boolean; bot: boolean; grinds: boolean }
  | { t: "SkateDuelScore"; points: number; done: boolean };

/** `SkateMove.pose` / `SkateScore.kind` (commons_protocol::skate). */
const POSE = { ROLL: 0, CROUCH: 1, AIR: 2, GRIND: 3, MANUAL: 4, BAIL: 5 };
const SCORE = { COMBO: 0, BAIL: 1, RUN: 2 };
/** As `skate::duel`: `SkateDuelState.phase` and `SkateDuelEnd.result`. */
const DUEL = { WAITING: 1, STARTING: 2, LOST: 0, WON: 1, DRAW: 2, WALKOVER: 3 };
/** The bot's id, for what's shown over its head (as the dance floor's, its own). */
const BOT_ID = 0xfffffff6;

/** Text for HTML. */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** A manual: how far the board's nose is tipped up (px). */
const MANUAL_TILT = 7;
/** The surf trucks' code (`skatekit.ts`): they lean into their carves. */
const SURF_TRUCKS = 5;
/** How often your moves go out (ms), and how soon after the last a change of pose (a pop, a landing) goes out at once. */
const SEND_MS = 50;
const QUICK_MS = 20;
/** A skater not heard from for this long has gone (ms): long enough to ride out a bad patch of network. */
const GONE_MS = 8000;
/** Others are drawn a beat behind their latest move, more the more the network's jittering (ms). */
const DELAY_MIN = 70;
const DELAY_MAX = 450;
/** Past their latest move (the network's stalled), they're carried on the way they were going this long (ms), then held. */
const COAST_MS = 300;
/** Drawn this far (px) from where they should be, they're moved there at once rather than glided. */
const TELEPORT_PX = 160;
/** Back within this long (ms) of the connection dropping, you're put back on your board where you were. */
const RESUME_MS = 20000;
const RUN_S = 60;
const COUNT_S = 3;
/** The run's last seconds, ticked off (s). */
const HURRY_S = 10;
/** Time's up with a trick still in the air: how long it's given to land (ms). */
const LATE_MS = 3000;
const STEP_S = 1 / 120;
const STICK_R = 56;
/** How far above the feet a skater's middle is (they turn round it, head over heels). */
const MIDDLE = 15;
/** How far the board lifts you: deck on wheels (as the avatars'). */
const BOARD_RISE = 4;
/** Pushing, as others are told it: in `trick` (rolling, there's no trick), from here up, the stroke's phase in 15ths. */
const PUSH_CODE = 32;

/** Combos worth sending to the board (and telling everyone about). */
const TELL_PTS = 400;

/** Arriving where you clicked: how hard the board brakes to stop there (px/s²). */
const SETTLE_BRAKE = 420;

/** `street`: out of the park on your everyday board (no score, no clock: just riding). */
type GameMode = "free" | "run" | "line" | "street";

/** How a skater's drawn: where (feet, world px), how high, which way, doing what. */
interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pose: number;
  trick: number;
  spin: number;
  /** Your own: how far into its flip (0–1), the push's phase, the balance; others' are guessed. */
  flipT?: number;
  /** Head over heels: how far round (0–1). */
  bodyT?: number;
  push?: number;
  balance?: number;
  crouch?: number;
  bailT?: number;
  /** Your own: powersliding round. */
  slide?: boolean;
}

/**
 * Someone else on a board: their moves, by when they sent them (their own
 * clock, `SkateMove.sent`, unwrapped), played back a little behind so the
 * network's lumps and gaps don't show; how late their moves have been
 * reaching us (to pick that delay); and where they're drawn now (glided
 * toward where they should be).
 */
interface Other {
  snaps: { st: number; p: Pose }[];
  heard: number;
  /** Their board, as they've built it (`SkateOn.kit`). */
  kit: number;
  rig: Rig;
  /** Their clock: the last `t` as sent (it wraps), and unwrapped. */
  raw: number;
  st: number;
  /** How late their recent moves reached us (our clock less theirs: a base, plus jitter). */
  lags: number[];
  shown: Pose | null;
  drawnAt: number;
}

/** What's carried over a dropped connection: your board as it was, to be put back on. */
let carried: { x: number; y: number; z: number; heading: number; speed: number; mode: "free" | "run" | "line"; at: number } | null = null;

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// ---- drawing a skater ----------------------------------------------------------

const O = 0x3b3a2e;
/** The wheels, by size (small, standard, big as `Kit.wheels` 1, 0, 2): how wide and tall. */
const WHEEL_SIZE: [number, number][] = [
  [4, 3],
  [3, 2],
  [5, 4],
];
/** How long a trail lasts behind you (ms). */
const TRAIL_MS = 550;

/** A skater's board (as they've built it), its shadow, its glow, its trail and its sparks; the avatar on top is the avatar's own, posed. */
class Rig {
  private g = new Graphics();
  /** What glows and trails, drawn adding light. */
  private glowG = new Graphics();
  private trailG = new Graphics();
  private facing: 1 | -1 = 1;
  private sparks: { x: number; y: number; vx: number; vy: number; life: number; dust?: boolean }[] = [];
  private lastSparks = 0;
  private bailFrom: { x: number; y: number } | null = null;
  private kit: Kit = { ...STOCK };
  /** The trail: where the board's been, and its bits (sparks, flames, stars). */
  private path: { x: number; y: number; t: number }[] = [];
  private bits: { x: number; y: number; vx: number; vy: number; life: number; max: number; c: number }[] = [];
  /** Surf trucks: how hard they're carving (rad/s, smoothed) and how fast they're going (px/s), from how they've moved; the streaks off them when they're flying. */
  private carve = 0;
  /** Where the deck was drawn this frame (the glow deck lights just that up), if it was. */
  private deckAt: { x: number; y: number; w: number; h: number } | null = null;
  /** The deck's own pixels as drawn this frame (its flat, its kicked-up nose and tail, a manual's steps): what the glow deck lights. */
  private deckShape: { x: number; y: number; w: number; h: number }[] = [];
  private going = 0;
  private was: { heading: number; x: number; y: number; at: number } | null = null;
  private streaks: { x: number; y: number; len: number; life: number }[] = [];

  /** The same glow and trail again on the night's lights (`lit`), so after dark they really glow. */
  private litGlow: Graphics | null = null;
  private litTrail: Graphics | null = null;

  constructor(scene: Scene, kit: Kit, lit: Container | null = null) {
    this.trailG.blendMode = "add";
    this.glowG.blendMode = "add";
    scene.sorted.addChild(this.trailG, this.g, this.glowG);
    if (lit) {
      this.litGlow = new Graphics();
      this.litTrail = new Graphics();
      lit.addChild(this.litTrail, this.litGlow);
    }
    this.setKit(kit);
  }

  setKit(kit: Kit) {
    this.kit = { ...kit };
  }

  private get color(): number {
    return (DECKS[this.kit.deck] ?? DECKS[0]).color;
  }

  /** The grip tape on top of the deck: black, or (the glow deck) lit up in its glow, day and night. */
  private get grip(): number {
    return DECKS[this.kit.deck]?.glow ?? 0x161616;
  }

  draw(avatar: Avatar, p: Pose, ground: number, wallNow: number) {
    const g = this.g.clear();
    this.deckAt = null;
    this.deckShape = [];
    const x = Math.round(p.x);
    const gy = Math.round(p.y - ground);
    const air = p.z - ground;
    // Which way they face: by the way they're headed (keeping the last when it's straight up or down the screen).
    const c = Math.cos(p.heading);
    if (Math.abs(c) > 0.3) this.facing = c >= 0 ? 1 : -1;
    // A spin turns them round: the sprite flips as it passes side-on.
    const spinC = Math.cos(p.spin);
    const facing: 1 | -1 = (spinC >= 0 ? this.facing : -this.facing) as 1 | -1;
    const squash = Math.max(0.2, Math.abs(spinC));
    // How they're carving and how fast (for surf trucks' lean, and the streaks).
    const w = this.was;
    const dtR = w ? Math.min(0.1, (wallNow - w.at) / 1000) : 0;
    if (w && dtR > 0) {
      const ease = 1 - Math.exp(-dtR * 12);
      const turning = Math.max(-8, Math.min(8, wrap(p.heading - w.heading) / dtR));
      this.carve += (turning - this.carve) * ease;
      this.going += (Math.hypot(p.x - w.x, p.y - w.y) / dtR - this.going) * ease;
    }
    this.was = { heading: p.heading, x: p.x, y: p.y, at: wallNow };
    const surfing = this.kit.trucks === SURF_TRUCKS && p.pose === POSE.ROLL;
    // The shadow on whatever's under them, smaller and fainter the higher they are.
    const sw = Math.max(6, 20 - air * 0.12);
    g.ellipse(x, gy, sw / 2, Math.max(1.5, 3 - air * 0.02)).fill({ color: 0x000000, alpha: Math.max(0.1, 0.3 - air * 0.002) });

    let frame: AvatarFrame = 4;
    let lean = 0;
    let lift = p.z + BOARD_RISE;
    let boardDy = 0;
    let boardFlip = 0;
    let boardTurn = 1;
    let push: (typeof PUSH_POSES)[number] | null = null;
    const flipping = p.trick > 0 && p.trick < TRICK.GRAB;
    const grabbing = p.trick === TRICK.GRAB;
    if (p.pose === POSE.CROUCH) {
      frame = skateCrouch((p.crouch ?? 0) > 0.25 ? 3 : 2);
    } else if (p.pose === POSE.ROLL && p.slide) {
      // Powersliding round: low, leaning back against it, dust kicking up off the wheels.
      frame = skateCrouch(2);
      lean = -0.3 * facing;
      if (Math.random() < 0.7) {
        const back = Math.random() < 0.5 ? -1 : 1;
        this.sparks.push({ x: x + back * 8, y: gy - 1, vx: (Math.random() - 0.5) * 60, vy: -15 - Math.random() * 25, life: 0.3, dust: true });
      }
    } else if (surfing && Math.abs(this.carve) > 0.4 && !(p.push && p.push > 0)) {
      // Surf trucks: leaning right over into each carve, one way then the
      // other as you pump, down low through the hardest of it.
      lean = Math.max(-0.52, Math.min(0.52, this.carve * 0.1)) * facing;
      frame = skateCrouch(Math.abs(this.carve) > 3 ? 2 : 1);
    } else if (p.pose === POSE.ROLL && p.push !== undefined && p.push > 0) {
      // Pushing: down on the front knee, the back foot reaching out behind to kick along the ground.
      push = pushPose(p.push * 1000);
      if (push) frame = push.frame;
    } else if (p.pose === POSE.AIR) {
      frame = grabbing ? skateCrouch(3) : flipping ? skateCrouch(1) : 4;
      if (flipping) {
        // The feet tuck up off the board as it turns under them.
        lift += 4;
        boardDy = 3;
        const kind = p.trick % TRICK.DOUBLE || 1;
        const t = p.flipT ?? (wallNow / 330) % 1;
        const turns = p.trick >= TRICK.DOUBLE ? 2 : 1;
        if (kind === 5) boardTurn = Math.cos(t * Math.PI * 2 * turns);
        else {
          boardFlip = t * turns;
          if (kind === 3) boardTurn = Math.cos(t * Math.PI * 2);
        }
      }
      if (grabbing) boardDy = -5;
    } else if (p.pose === POSE.MANUAL) {
      // Back on the tail, nose up: leaning back over the back wheels, wobbling with the balance.
      lean = -0.3 * facing + (p.balance ?? 0) * 0.12;
      lift += 2;
    } else if (p.pose === POSE.GRIND) {
      lean = (p.balance ?? 0) * 0.2;
    } else if (p.pose === POSE.BAIL) {
      // Down on the ground, the board skittering off.
      const t = 1.3 - (p.bailT ?? 0.6);
      frame = 2;
      lean = facing * Math.min(1, t * 5) * 1.45;
      lift = ground + 2;
      this.bailFrom ??= { x, y: gy };
    }
    if (p.pose !== POSE.BAIL) this.bailFrom = null;
    // Head over heels: the skater turns right round their middle (the sprite
    // turns round its feet, so the feet are moved to keep the middle still),
    // tucked, the board held to their feet.
    const body = p.pose === POSE.AIR && (p.trick === TRICK.BACKFLIP || p.trick === TRICK.FRONTFLIP);
    let turn = 0;
    let shiftX = 0;
    if (body) {
      const t = p.bodyT ?? (wallNow / 550) % 1;
      // (Backwards, a skater facing right goes round anticlockwise.)
      const way = (p.trick === TRICK.BACKFLIP ? -1 : 1) * facing;
      turn = way * t * Math.PI * 2;
      frame = skateCrouch(3);
      lean = turn;
      shiftX = -MIDDLE * Math.sin(turn);
      lift += MIDDLE - MIDDLE * Math.cos(turn);
    }
    avatar.setArena({ x: (p.x + shiftX - TILE / 2) / TILE, y: (p.y - TILE + 4) / TILE, facing, frame, walking: false, hurt: false, lean, lift, noRide: true });
    // The board.
    const by = Math.round(p.y - p.z) + boardDy;
    if (body) {
      this.turnedBoard(g, p.x, by - BOARD_RISE - MIDDLE, turn);
      this.g.zIndex = avatar.sprite.zIndex + 0.1;
      return;
    }
    if (p.pose === POSE.BAIL && this.bailFrom) {
      const t = 1.3 - (p.bailT ?? 0.6);
      const bx = Math.round(this.bailFrom.x + facing * Math.min(1, t * 1.5) * 26);
      // Upside down, wheels up.
      g.rect(bx - 11, gy - 3, 22, 2).fill(this.color);
      g.rect(bx - 8, gy - 6, 4, 3).fill(0xf1e9d2);
      g.rect(bx + 4, gy - 6, 4, 3).fill(0xf1e9d2);
    } else this.board(g, x, by, facing, squash * boardTurn, boardFlip, p.pose === POSE.MANUAL ? MANUAL_TILT : 0);
    if (push) drawPushLeg(g, x, by, facing, push, legColor(avatar.info.style));
    // Grinding: sparks off the trucks.
    if (p.pose === POSE.GRIND && wallNow - this.lastSparks > 30) {
      this.lastSparks = wallNow;
      for (let i = 0; i < 2; i++) this.sparks.push({ x: x - facing * (6 + Math.random() * 6), y: by - 1, vx: -facing * (30 + Math.random() * 70), vy: -40 - Math.random() * 60, life: 0.25 + Math.random() * 0.2 });
    }
    // Flying along (past where pushing gets you: pumped, or off a ramp): streaks of speed behind.
    if (p.pose === POSE.ROLL && this.going > 300 && Math.random() < (this.going - 300) / 140) {
      const back = -Math.cos(p.heading);
      this.streaks.push({ x: x + back * (8 + Math.random() * 6), y: by - 6 - Math.random() * 30, len: (6 + Math.random() * 10) * back, life: 1 });
    }
    for (const s of this.streaks) {
      s.life -= 1 / 60 / 0.28;
      s.x += s.len * 0.08;
      if (s.life > 0) g.rect(Math.round(Math.min(s.x, s.x + s.len)), Math.round(s.y), Math.max(1, Math.round(Math.abs(s.len))), 1).fill({ color: 0xffffff, alpha: 0.55 * s.life });
    }
    this.streaks = this.streaks.filter((s) => s.life > 0);
    for (const s of this.sparks) {
      s.life -= 1 / 60;
      s.x += s.vx / 60;
      s.y += s.vy / 60;
      s.vy += 400 / 60;
      if (s.life <= 0) continue;
      if (s.dust) g.rect(Math.round(s.x), Math.round(s.y), 2, 2).fill({ color: 0xd8d2c4, alpha: Math.min(1, s.life * 3) * 0.8 });
      else g.rect(Math.round(s.x), Math.round(s.y), 1, 1).fill(s.life > 0.2 ? 0xfff3a0 : 0xff9a3a);
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    this.g.zIndex = avatar.sprite.zIndex - 0.1;
    this.glowAndTrail(x, by, gy, p.pose === POSE.BAIL, wallNow, avatar.sprite.zIndex);
  }

  /**
   * The glow-in-the-dark deck's light (on the board, and a pool on the
   * ground under it), and the trail behind: where the board's been these
   * last moments, drawn in its skin.
   */
  private glowAndTrail(x: number, by: number, gy: number, down: boolean, now: number, z: number) {
    this.glowG.zIndex = z + 0.05;
    this.trailG.zIndex = z - 0.2;
    const trail = this.kit.trail;
    // Where the board's been (a point each time it's moved a little), and the bits it throws off.
    const last = this.path[this.path.length - 1];
    if (trail && !down && (!last || Math.hypot(x - last.x, by - 4 - last.y) > 1.5)) this.path.push({ x, y: by - 4, t: now });
    this.path = this.path.filter((q) => now - q.t < TRAIL_MS);
    const moving = !!last && now - last.t < 120;
    if ((trail === 1 || trail === 4) && moving && !down) {
      const fire = trail === 4;
      for (let k = 0; k < (fire ? 3 : 2); k++) {
        this.bits.push({
          x: x + (Math.random() - 0.5) * 8,
          y: by - 3 + (Math.random() - 0.5) * 2,
          vx: (Math.random() - 0.5) * 30,
          vy: fire ? -20 - Math.random() * 30 : -30 - Math.random() * 50,
          life: 1,
          max: fire ? 0.45 : 0.35,
          c: fire ? [0xffe14d, 0xffa53d, 0xff5a2a][k % 3] : [0xfff3a0, 0xffd23f][k % 2],
        });
      }
    }
    for (const b of this.bits) {
      b.life -= 1 / 60 / b.max;
      b.x += b.vx / 60;
      b.y += b.vy / 60;
      if (trail !== 4) b.vy += 250 / 60;
    }
    this.bits = this.bits.filter((b) => b.life > 0);
    if (this.bits.length > 120) this.bits.splice(0, this.bits.length - 120);
    // Drawn in the world (seen by day), and again on the night's lights (glowing after dark).
    this.paint(this.glowG.clear(), this.trailG.clear(), x, by, gy, down, now, false);
    if (this.litGlow && this.litTrail) this.paint(this.litGlow.clear(), this.litTrail.clear(), x, by, gy, down, now, true);
  }

  private paint(gl: Graphics, t: Graphics, x: number, by: number, gy: number, down: boolean, now: number, night: boolean) {
    const glow = DECKS[this.kit.deck]?.glow;
    const d = this.deckAt;
    // The glow deck: the whole deck lit up bright (day and night), and a
    // small halo round it, a glow on the ground under it: just a little
    // on its surroundings, more after dark, when it's really shining.
    if (glow && !down && d) {
      const pulse = 0.9 + 0.1 * Math.sin(now / 400);
      const k = (night ? 1 : 0.5) * pulse;
      const shape = this.deckShape.length ? this.deckShape : [d];
      // A mild soft edge round the deck's own shape (a pixel or two out, faint)…
      for (const r of shape) gl.roundRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 2).fill({ color: glow, alpha: 0.05 * k });
      for (const r of shape) gl.roundRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, 1).fill({ color: glow, alpha: 0.09 * k });
      // …the deck itself lit, every pixel of it (its kicked-up ends too)…
      for (const r of shape) gl.rect(r.x, r.y, r.w, r.h).fill({ color: glow, alpha: night ? 0.75 : 0.4 });
      // …and the faintest light on the ground under it.
      gl.ellipse(x, gy, 10, 2.5).fill({ color: glow, alpha: 0.05 * k });
    }
    void by;
    const trail = this.kit.trail;
    if (!trail) return;
    const seg = (i: number, width: number, color: number, alpha: number, dy = 0) => {
      const a = this.path[i - 1];
      const b = this.path[i];
      t.moveTo(a.x, a.y + dy).lineTo(b.x, b.y + dy).stroke({ width, color, alpha, cap: "round" });
    };
    const age = (i: number) => 1 - (now - this.path[i].t) / TRAIL_MS;
    if (trail === 2) {
      // Neon: a wide soft cyan line, a hot pink core.
      for (let i = 1; i < this.path.length; i++) {
        seg(i, 6, 0x3fd8e8, 0.25 * age(i));
        seg(i, 3, 0x3fd8e8, 0.6 * age(i));
        seg(i, 1, 0xff8fd8, 0.9 * age(i));
      }
    } else if (trail === 3) {
      // Rainbow: six bands.
      const bands = [0xff4d4d, 0xffa53d, 0xffe14d, 0x5fe06a, 0x4da6ff, 0xa66bff];
      for (let i = 1; i < this.path.length; i++) bands.forEach((c, k) => seg(i, 1.6, c, 0.85 * age(i), (k - 2.5) * 1.5));
    } else if (trail === 5) {
      // Galaxy: a deep purple ribbon, blue at its heart, stars twinkling in it.
      for (let i = 1; i < this.path.length; i++) {
        seg(i, 7, 0x5a2a9a, 0.35 * age(i));
        seg(i, 3, 0x4d6bff, 0.5 * age(i));
      }
      this.path.forEach((q, i) => {
        if ((i * 7 + Math.floor(now / 90)) % 5 === 0) t.rect(Math.round(q.x + ((i * 13) % 7) - 3), Math.round(q.y + ((i * 5) % 5) - 2), 1, 1).fill({ color: 0xffffff, alpha: age(i) });
      });
    } else if (trail === 4) for (let i = 1; i < this.path.length; i++) seg(i, 3, 0xff6a2a, 0.45 * age(i));
    for (const b of this.bits) {
      const s = trail === 4 ? Math.max(1, Math.round(3 * b.life)) : 1;
      t.rect(Math.round(b.x), Math.round(b.y), s, s).fill({ color: b.life < 0.4 && trail === 4 ? 0xff3a1a : b.c, alpha: Math.min(1, b.life * 1.5) });
    }
  }

  /** The board turned `turn` round the skater's middle at (cx, cy), under their feet. */
  private turnedBoard(g: Graphics, cx: number, cy: number, turn: number) {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const at = (x: number, y: number) => [cx + x * c - y * s, cy + x * s + y * c];
    const rect = (x0: number, y0: number, x1: number, y1: number, color: number) =>
      g.poly([...at(x0, y0), ...at(x1, y0), ...at(x1, y1), ...at(x0, y1)]).fill(color);
    // (In the skater's own frame: their middle at 0, their feet MIDDLE below it, the deck just under.)
    const d = MIDDLE + BOARD_RISE;
    rect(-7, d - 1, -3, d + 2, 0xf1e9d2);
    rect(3, d - 1, 7, d + 2, 0xf1e9d2);
    rect(-11, d - 3, 11, d - 1, this.grip);
    rect(-11, d - 1, 11, d, this.color);
  }

  /** The board, `y` its wheels' bottom: `turn` squashes it as it turns side-on, `flip` (turns) rolls it over. */
  /** The board side on at (x, y) (`tilt`: its nose raised so many px, a manual: back wheels down, front up). */
  private board(g: Graphics, x: number, y: number, facing: number, turn: number, flip: number, tilt = 0) {
    if (tilt && !flip) return this.tiltedBoard(g, x, y, facing, Math.max(2, Math.round(11 * Math.abs(turn))), tilt);
    const half = Math.max(2, Math.round(11 * Math.abs(turn)));
    const roll = flip ? Math.cos(flip * Math.PI * 2) : 1;
    if (flip && Math.abs(roll) < 0.35) {
      // Edge on, mid-flip: a thin sliver.
      g.rect(x - half, y - 7, half * 2, 1).fill(O);
      g.rect(x - half, y - 6, half * 2, 1).fill(this.color);
      this.deckAt = { x: x - half, y: y - 7, w: half * 2, h: 2 };
      this.deckShape = [{ x: x - half, y: y - 6, w: half * 2, h: 1 }];
      return;
    }
    const upside = roll < 0;
    // Wheels (on top, when it's over).
    const [ww, wh] = WHEEL_SIZE[this.kit.wheels] ?? WHEEL_SIZE[0];
    const wy = upside ? y - 6 - wh : y - wh - 1;
    for (const wx of [x - Math.round(half * 0.73), x + Math.round(half * 0.36)]) {
      g.rect(wx, wy, ww, wh).fill(O);
      g.rect(wx + 1, wy + 1, ww - 2, wh - 1).fill(0xf1e9d2);
    }
    // The deck: grip tape on top, the graphic underneath, kicked up at both ends.
    const top = upside ? this.color : this.grip;
    g.rect(x - half, y - 6, half * 2, 2).fill(top);
    this.deckAt = { x: x - half - (half > 4 ? 1 : 0), y: y - 7, w: half * 2 + (half > 4 ? 2 : 0), h: 4 };
    // (Its shape: the flat of it, and its nose and tail kicked up a pixel.)
    this.deckShape = [{ x: x - half, y: y - 6, w: half * 2, h: upside ? 2 : 3 }];
    if (half > 4) this.deckShape.push({ x: x - half - 1, y: y - 7, w: 2, h: 2 }, { x: x + half - 1, y: y - 7, w: 2, h: 2 });
    if (!upside) g.rect(x - half + 1, y - 6, half * 2 - 2, 1).fill(DECKS[this.kit.deck]?.glow ? 0xf2fff9 : 0x2c2c2c);
    if (half > 4) {
      g.rect(x - half - 1, y - 7, 2, 2).fill(top);
      g.rect(x + half - 1, y - 7, 2, 2).fill(top);
    }
    // A sliver of the graphic along the edge (the board's colour).
    if (!upside) {
      g.rect(x - half, y - 4, half * 2, 1).fill(this.color);
      // (The gold deck shines: a glint running along it.)
      // (Only along the deck: off its ends, between sweeps, nothing.)
      if (DECKS[this.kit.deck]?.shine) {
        const at = Math.floor((performance.now() / 40) % (half * 2 + 12)) - 6;
        if (at >= 0 && at <= half * 2 - 2) g.rect(x - half + at, y - 4, 2, 1).fill(0xfff8d8);
      }
    }
    void facing;
  }

  /**
   * A manual: the board tipped back on its tail, its nose `tilt` px up, the
   * deck stepping up from tail to nose (`facing`: which end's the nose),
   * the back wheels on the ground and the front ones in the air with it.
   */
  private tiltedBoard(g: Graphics, x: number, y: number, facing: number, half: number, tilt: number) {
    // How high the deck is at column i (from -half to half): nothing at the tail, `tilt` at the nose.
    const up = (i: number) => Math.round((tilt * (facing * i + half)) / (2 * half));
    const [ww, wh] = WHEEL_SIZE[this.kit.wheels] ?? WHEEL_SIZE[0];
    const wheelAt = [x - Math.round(half * 0.73), x + Math.round(half * 0.36)];
    for (const wx of wheelAt) {
      const lift = up(wx + ww / 2 - x);
      g.rect(wx, y - wh - 1 - lift, ww, wh).fill(O);
      g.rect(wx + 1, y - wh - lift, ww - 2, wh - 1).fill(0xf1e9d2);
    }
    this.deckShape = [];
    for (let i = -half; i < half; i++) {
      const dy = up(i);
      this.deckShape.push({ x: x + i, y: y - 6 - dy, w: 1, h: 3 });
      g.rect(x + i, y - 7 - dy, 1, 1).fill(O);
      g.rect(x + i, y - 6 - dy, 1, 2).fill(this.grip);
      g.rect(x + i, y - 4 - dy, 1, 1).fill(this.color);
    }
    // The tail, scraping the ground behind.
    const tail = x - facing * half;
    g.rect(Math.min(tail, tail - facing), y - 3, 2, 1).fill(O);
    this.deckAt = { x: x - half, y: y - 7 - tilt, w: half * 2, h: 4 + tilt };
  }

  destroy() {
    this.g.destroy();
    this.glowG.destroy();
    this.trailG.destroy();
    this.litGlow?.destroy();
    this.litTrail?.destroy();
  }
}

// ---- the board by the gate: modes and today's best -------------------------------

class SkateBoardPanel extends Panel {
  runs: { name: string; points: number }[] = [];
  /** The 1v1 picked: grinds only, or every trick. */
  private grinds = false;
  combos: { name: string; points: number }[] = [];

  constructor(
    private start: (mode: GameMode) => void,
    private mine: () => { run: number; combo: number },
    private skating: () => boolean,
    private stop: () => void,
    /** Into a 1v1: with whoever else is looking for one, or the bot; `grinds`: only grinds count. */
    private duel: (bot: boolean, grinds: boolean) => void,
    /** Dusty's daily quests, and claiming one's coins. */
    private quests: Quests,
    private claim: (day: number, slot: number) => void,
  ) {
    super("🛹 Skatepark", "skate-board");
  }

  render() {
    this.body.replaceChildren();
    const modes = el("div", "skate-modes");
    const mode = (icon: string, name: string, what: string, m: GameMode) => {
      const b = button("", () => (this.hide(), this.start(m)), `skate-mode m-${m}`);
      b.append(el("span", "skate-mode-icon", icon), el("strong", "", name), el("span", "hint", what));
      modes.append(b);
    };
    mode("🛹", "Free skate", "Just ride. Every combo you land counts.", "free");
    mode("⏱️", "60-second run", "Score all you can before the horn.", "run");
    mode("🔗", "Line", "One combo, as long as you can keep it going.", "line");
    this.body.append(modes);
    // A 1v1: a 60-second run each, side by side; the higher score wins.
    const duel = el("div", "skate-duel-row");
    // Which sort: every trick counts, or only grinds.
    const kinds = el("div", "skate-duel-kinds");
    for (const [g, label] of [[false, "🛹 All tricks"], [true, "🛤️ Grinds only"]] as [boolean, string][]) {
      kinds.append(button(label, () => ((this.grinds = g), this.render()), g === this.grinds ? "on" : ""));
    }
    duel.append(
      el("span", "skate-duel-title", "⚔️ 1v1: 60 seconds, the higher score wins"),
      kinds,
      button("Find someone", () => (this.hide(), this.duel(false, this.grinds)), "primary"),
      button("🤖 Take on the bot", () => (this.hide(), this.duel(true, this.grinds))),
    );
    if (this.grinds) duel.append(el("span", "hint skate-duel-hint", "Only grinds count: 100 a grind, and 100 a second you hold it."));
    this.body.append(duel);
    // Dusty's quests for today, how far you've got.
    const quests = el("div", "skate-board-quests");
    quests.append(el("h3", "", "🎯 Dusty's daily quests"), questList(this.quests, this.claim));
    this.body.append(quests);
    if (this.skating()) this.body.append(button("Get off the board", () => (this.hide(), this.stop()), "small"));
    const me = this.mine();
    const list = (title: string, rows: { name: string; points: number }[], best: number) => {
      const box = el("div", "skate-list");
      box.append(el("h3", "", title));
      if (!rows.length) box.append(el("p", "empty", "Nobody yet today. Be the first!"));
      rows.forEach((r, i) => {
        const row = el("div", "skate-row");
        row.append(el("span", "skate-rank", `${i + 1}`), el("span", "skate-name", r.name), el("span", "skate-pts", fmt(r.points)));
        box.append(row);
      });
      if (best) box.append(el("p", "hint", `Your best ever: ${fmt(best)}`));
      return box;
    };
    const lists = el("div", "skate-lists");
    lists.append(list("⏱️ Today's best runs", this.runs, me.run), list("🔗 Today's best combos", this.combos, me.combo));
    this.body.append(lists);
    const keys = el("details", "skate-keys");
    keys.append(el("summary", "", "How to skate"));
    for (const [k, what] of [
      ["Arrows / WASD", "Ride: turn your way and push off. Press back the way you came: a powerslide round."],
      ["Space", "Hold to crouch, let go to ollie (the longer, the higher)."],
      ["Space (on a ramp)", "Going up a ramp: pop out off it, forward (with a direction held, that way: ramp to ramp, or right over one)."],
      ["Out of a quarter", "Up out of a quarter pipe, hold the way out over its lip: you fly on out of it instead of back in."],
      ["Drop in", "Ride into a ramp from behind its tall end: over the coping and down."],
      ["Space (in the air)", "A trick! Off a ramp, a full flip head over heels (Backflip, ↑ Frontflip, ← Rodeo, → Misty): get round before you land! Anywhere else, a kickflip."],
      ["J", "In the air: flip. Which by the arrow held: none Kickflip, ← Heelflip, → Varial, ↑ Hardflip, ↓ Shove-it. J again quick: a double."],
      ["K", "In the air: grab (hold it for more). Let go before you land!"],
      ["Q / E", "Spin. Land straight (or backwards) or you bail."],
      ["Rails, ledges", "Come down on them moving along them: a grind. ← → to balance, Space to pop off."],
      ["L", "Manual: balance with ← →. Land into one to keep your combo going."],
      ["Trucks", "Which tricks you can do: stock trucks ollie, grab, 50-50 and manual. Flips, every grind and the big flips need better trucks from Dusty's van."],
      ["Surf trucks", "Pump! Steer side to side across the way you're going (← → ← → going up, ↑ ↓ ↑ ↓ going sideways), in a steady rhythm: each carve shoves you on, far faster than pushing."],
      ["Esc", "Get off your board."],
    ]) {
      const row = el("div", "skate-key");
      row.append(el("kbd", "", k), el("span", "", what));
      keys.append(row);
    }
    this.body.append(keys);
  }
}

// ---- the show ------------------------------------------------------------------

export class SkatePark {
  readonly park: Park;
  private me: Skater | null = null;
  private myRig: Rig | null = null;
  private mode: GameMode = "free";
  /**
   * The 60-second run, by the clock on the wall (not frames: a slow frame or
   * a hidden tab doesn't stretch it): when it goes and ends, the second last
   * ticked, and what's been scored in it. `late`: time's up, a trick still
   * in the air (let land, a few seconds at most).
   */
  private run = { phase: "" as "" | "count" | "go" | "late" | "over", goAt: 0, endAt: 0, ticked: 0, score: 0, combos: 0, tricks: 0, best: 0, bestLabel: "" };
  private lineDone = false;
  /** Your board, as you've built it (skatekit.ts). */
  private kit: Kit = { ...STOCK };
  private lockedAt = 0;
  private others = new Map<number, Other>();
  private acc = 0;
  private last = 0;
  /** The Skate Trainer's coach, watching what you do (a lesson being tried). */
  watch: ((e: SkateEvent | { t: "run" } | { t: "line" } | { t: "frame" }, me: Skater) => void) | null = null;
  /** Riding out of the park this frame: where, which way (stepped off after the frame's steps). */
  private leaving: { tx: number; ty: number; dx: number; dy: number } | null = null;
  /** Where your board was before the last step (drawn between it and where it is). */
  private stepFrom: { x: number; y: number; z: number } | null = null;
  private sentAt = 0;
  private lastSent = "";
  /** The pose and trick last sent (a change goes out at once). */
  private lastPose = -1;
  private travelled = 0;
  private wasGrinding: "" | "rail" | "ledge" = "";
  /** Held keys, and presses waiting for the next step. */
  private keys = new Set<string>();
  private flipPressed = false;
  private manualPressed = false;
  private stick: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  private held = { pop: false, grab: false, spinL: false, spinR: false };
  readonly boardPanel: SkateBoardPanel;

  // The HUD.
  private hud = el("div", "skate-hud");
  private scoreEl = el("div", "skate-score");
  private comboEl = el("div", "skate-combo");
  private popEl = el("div", "skate-pops");
  private balanceEl = el("div", "skate-balance");
  private specialEl = el("div", "skate-special");
  private feedEl = el("div", "skate-feed");
  private bigEl = el("div", "skate-big");
  /**
   * Your 1v1, if you're in one (or looking for one): who against (0 the bot),
   * their name and score as it comes in; `waiting` for an opponent, then
   * the run itself (`this.run`), then `over` waiting on the result.
   */
  private duel: { phase: "waiting" | "on" | "over"; opp: number; name: string; theirs: number; grinds: boolean } | null = null;
  /** A grinds-only 1v1: the points from grinding not yet whole (they come 100 a second held). */
  private grindAcc = 0;
  /** The bot you're up against, skating beside you (a 1v1 with it): its rider, how it's drawn, its avatar. */
  private bot: { rider: BotRider; rig: Rig; avatar: Avatar; acc: number; last: number } | null = null;
  private duelEl = el("div", "skate-duel");
  /** Dusty's daily quests: what you've done toward them. */
  readonly quests = new Quests((q) => {
    sfx.special();
    this.toast(`🎯 Quest done: ${q.text}! Dusty's got ${q.coins} 🪙 for you at his van.`, 5000);
  });
  /** For the quests: in the air (since when, how high), on a manual or a grind (how long), today's distance and speed not yet told, combos landed since the last bail. */
  private qAir: { at: number; top: number } | null = null;
  private qHeld = { manual: 0, grind: 0, grab: 0 };
  private qDist = 0;
  private qSpeed = 0;
  private qAt = 0;
  private qStreak = 0;
  /** The run's card at the end: the total, how it went, what next. */
  private resultsEl = el("div", "skate-results");
  private tallyTimer = 0;
  /** Surf trucks: how in rhythm your pumping is. */
  private flowEl = el("div", "skate-flow");
  private touchEl = el("div", "skate-touch");
  private stickEl = el("div", "pb-stick move");
  private enterBtn: HTMLButtonElement;
  private offBtn: HTMLButtonElement;
  private floats: { el: HTMLElement; id: number; until: number; y: number }[] = [];

  constructor(
    private scene: Scene,
    map: ZoneMap,
    private labels: HTMLElement,
    private canvas: HTMLCanvasElement,
    private selfId: () => number,
    private avatarOf: (id: number) => Avatar | undefined,
    private nameOf: (id: number) => string,
    private send: (m: SkateSend) => void,
    private toast: (text: string, ms?: number) => void,
    private eco: Economy,
    /** The night's lights (DayNight), for glows and trails that shine after dark. */
    private lit: Container | null = null,
    /** An avatar for the bot (at x, y in tiles), and done with it. */
    private makeBot: ((x: number, y: number) => Avatar) | null = null,
    /**
     * Riding out of the park at tile (tx, ty), heading (dx, dy): whether you
     * can walk on there (out of a gate, say). If so, you step off your board
     * and walk on that way; no invisible wall.
     */
    private leave: ((tx: number, ty: number, dx: number, dy: number) => boolean) | null = null,
  ) {
    // The whole city's a place to skate (the park's concrete, and the streets round it).
    const city = Park.city(map);
    this.cityWide = !!city;
    this.park = (city ?? Park.fromMap(map))!;
    this.parkRect = map.objects.find((o) => o.kind === "sk_park") ?? null;
    this.boardPanel = new SkateBoardPanel(
      (m) => this.start(m),
      () => this.bests(),
      () => !!this.me,
      () => this.stop(),
      (bot, grinds) => this.findDuel(bot, grinds),
      this.quests,
      (day, slot) => this.send({ t: "SkateQuest", day, slot }),
    );
    // The HUD: the score up top, the combo building below the middle, the balance, popups.
    const top = el("div", "skate-top");
    top.append(this.scoreEl, this.specialEl, this.flowEl);
    this.flowEl.append(el("span", "skate-flow-name", "🌊 Pump"), el("span", "skate-flow-bar"));
    this.flowEl.hidden = true;
    this.balanceEl.append(el("div", "skate-needle"));
    this.offBtn = button("Get off ✕", () => this.getOff(), "skate-off");
    this.hud.append(top, this.comboEl, this.balanceEl, this.popEl, this.bigEl, this.feedEl, this.touchEl, this.stickEl, this.resultsEl, this.duelEl);
    // (Get off: on its own, over any panel that's open there, so it always works; shown with the HUD.)
    this.offBtn.hidden = true;
    document.body.append(this.offBtn);
    this.duelEl.hidden = true;
    this.resultsEl.hidden = true;
    this.stickEl.append(el("div", "pb-stick-knob"));
    this.stickEl.hidden = true;
    this.hud.hidden = this.offBtn.hidden = true;
    document.body.append(this.hud);
    this.enterBtn = button("🛹 Skate!", () => this.boardPanel.show(), "skate-enter");
    this.enterBtn.hidden = true;
    document.body.append(this.enterBtn);
    this.buildTouch();
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onBlur);
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("contextmenu", this.onMenu);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
  }

  /** On a board: the keys and the screen are the board's. */
  get capturing(): boolean {
    return !!this.me;
  }

  /** Whether `id` is skating (their avatar's the park's to draw). */
  skating(id: number): boolean {
    return id === this.selfId() ? !!this.me : this.others.has(id);
  }

  /** Whether the whole city's skated (its streets too), not just the park. */
  private cityWide = false;
  /** The skatepark itself (its tiles), within the city that's skated. */
  private parkRect: { x: number; y: number; w: number; h: number } | null;

  /** Whether the tile (tx, ty) is in the park (where you can get on a board). */
  inPark(tx: number, ty: number): boolean {
    const x = Math.floor(tx + 0.5);
    const y = Math.floor(ty + 0.5);
    const r = this.parkRect;
    return !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h && this.park.concreteTile(x, y);
  }

  /** Off the board altogether (your everyday board put away too, walking): see `getOff`. */
  onStreetOff: (() => void) | null = null;

  /** "Get off" (the button, Esc): off the board and off your everyday board too, walking, wherever you are (the park as well). */
  getOff() {
    this.stop();
    this.onStreetOff?.();
  }

  /** Out on the streets on your everyday board (not the park's skating). */
  get street(): boolean {
    return !!this.me && this.mode === "street";
  }

  /** When you last got off a board (ms): the server's word on where you stand, just after, isn't needed. */
  stoppedAt = -Infinity;

  /**
   * Onto your everyday board's physics, out on the streets, from where you
   * are, heading `heading` at `speed` px/s (carrying on from the ride you
   * were on), the keys held now held on it.
   */
  startStreet(heading: number, speed: number, keys: Iterable<string>) {
    const self = this.avatarOf(this.selfId());
    if (!self || this.me) return;
    const at = self.pos;
    const fx = at.x * TILE + TILE / 2;
    const fy = at.y * TILE + TILE - 4;
    if (!this.park.concrete(fx, fy)) return;
    this.me = new Skater(this.park, fx, fy);
    this.kit = loadKit(this.eco);
    this.me.street = true;
    this.me.kit = streetRide(this.kit);
    this.me.heading = heading;
    this.me.speed = speed;
    this.myRig = new Rig(this.scene, this.kit, this.lit);
    this.send({ t: "SkateOn", on: true, kit: packKit(this.kit) });
    document.body.classList.add("skate-playing", "skate-street");
    this.hud.hidden = this.offBtn.hidden = false;
    this.mode = "street";
    this.run = { phase: "", goAt: 0, endAt: 0, ticked: 0, score: 0, combos: 0, tricks: 0, best: 0, bestLabel: "" };
    for (const k of keys) this.keys.add(k);
    this.last = 0;
  }

  /** Rolled into the park (its skating, its score) or out onto the streets (just riding), carrying on as you were. */
  private crossed(intoPark: boolean) {
    const me = this.me;
    if (!me) return;
    me.street = !intoPark;
    me.kit = intoPark ? ride(this.kit) : streetRide(this.kit);
    me.combo.clear();
    this.mode = intoPark ? "free" : "street";
    document.body.classList.toggle("skate-street", !intoPark);
    if (intoPark) this.bigText("🛹 Skatepark", "info", 1000);
  }

  // ---- getting on and off ----

  start(mode: GameMode, duelAt = 0) {
    const self = this.avatarOf(this.selfId());
    if (!self) return;
    // (Something else picked, mid-1v1 or looking for one: out of it.)
    if (!duelAt && this.duel) this.leaveDuel();
    const at = self.pos;
    if (!this.me) {
      if (!this.inPark(at.x, at.y)) {
        this.toast("🛹 Walk into the skatepark first, then hop on a board.", 3500);
        return;
      }
      const fx = at.x * TILE + TILE / 2;
      const fy = at.y * TILE + TILE - 4;
      this.me = new Skater(this.park, fx, fy);
      this.kit = loadKit(this.eco);
      this.me.kit = ride(this.kit);
      this.myRig = new Rig(this.scene, this.kit, this.lit);
      this.send({ t: "SkateOn", on: true, kit: packKit(this.kit) });
      document.body.classList.add("skate-playing");
      this.hud.hidden = this.offBtn.hidden = false;
    }
    const me = this.me;
    // (From the streets into one of the park's modes: the park's board again.)
    if (me.street) {
      me.street = false;
      me.kit = ride(this.kit);
      document.body.classList.remove("skate-street");
    }
    me.combo.clear();
    me.link = 0;
    this.mode = mode;
    this.lineDone = false;
    this.run = { phase: "", goAt: 0, endAt: 0, ticked: 0, score: 0, combos: 0, tricks: 0, best: 0, bestLabel: "" };
    this.hideResults();
    me.banked = 0;
    me.bestCombo = 0;
    if (mode === "run") {
      this.run.phase = "count";
      this.run.goAt = duelAt || performance.now() + COUNT_S * 1000;
      this.run.ticked = Math.ceil((this.run.goAt - performance.now()) / 1000) + 1;
      me.speed = 0;
    }
    if (mode === "line") this.bigText("🔗 Your line starts with your first trick. Keep it going!", "info", 2600);
    if (mode === "free") this.bigText("🛹 Free skate", "info", 1200);
    this.last = 0;
  }

  /** Your board, rebuilt at Dusty's van: kept, and (on it now) ridden and shown at once. */
  setKit(kit: Kit) {
    this.kit = { ...kit };
    saveKit(this.kit);
    if (!this.me) return;
    this.me.kit = ride(this.kit);
    this.myRig?.setKit(this.kit);
    this.send({ t: "SkateOn", on: true, kit: packKit(this.kit) });
  }

  /** Your board as it's built now (for the shop's window). */
  get board(): Kit {
    return this.me ? { ...this.kit } : loadKit(this.eco);
  }

  stop() {
    if (!this.me) return;
    if (this.duel) this.leaveDuel();
    this.dropBot();
    this.me = null;
    this.hideResults();
    this.myRig?.destroy();
    this.myRig = null;
    this.avatarOf(this.selfId())?.setArena(null);
    this.send({ t: "SkateOn", on: false, kit: 0 });
    sfx.quiet();
    document.body.classList.remove("skate-playing", "skate-street");
    this.stoppedAt = performance.now();
    // Handed back to walking (or riding) on the tile you're on, drawn on from where your board was: no jump.
    const self = this.avatarOf(this.selfId());
    if (self) self.snapSoft({ x: Math.floor(self.pos.x + 0.5), y: Math.floor(self.pos.y + 0.875) });
    this.hud.hidden = this.offBtn.hidden = true;
    this.keys.clear();
    this.held = { pop: false, grab: false, spinL: false, spinR: false };
    this.stick = null;
    this.aim = null;
    this.aimHeld = false;
    this.rightPop = false;
    this.settling = false;
  }

  // ---- what the server says ----

  onMsg(m: ServerMsg) {
    switch (m.t) {
      case "Skating":
        if (m.id === this.selfId()) return;
        if (!m.on) this.forget(m.id);
        break;
      case "Skater": {
        if (m.id === this.selfId()) return;
        const avatar = this.avatarOf(m.id);
        if (!avatar) return;
        let o = this.others.get(m.id);
        if (!o) {
          o = { snaps: [], heard: 0, kit: m.kit, rig: new Rig(this.scene, unpackKit(m.kit), this.lit), raw: m.sent, st: m.sent, lags: [], shown: null, drawnAt: 0 };
          this.others.set(m.id, o);
        } else {
          // Their clock wraps every 65 s: unwrapped by how far it's moved on. (Moved back: an old move, late; dropped.)
          const d = (m.sent - o.raw) & 0xffff;
          if (d > 0x8000) break;
          o.raw = m.sent;
          o.st += d;
        }
        // (They've changed their board.)
        if (o.kit !== m.kit) {
          o.kit = m.kit;
          o.rig.setKit(unpackKit(m.kit));
        }
        const now = performance.now();
        o.heard = now;
        o.lags.push(now - o.st);
        if (o.lags.length > 40) o.lags.shift();
        o.snaps.push({
          st: o.st,
          p: { x: m.x * 0.32, y: m.y * 0.32, z: m.z, heading: (m.dir / 65536) * Math.PI * 2, pose: m.pose, trick: m.trick, spin: (m.spin / 65536) * Math.PI * 2 },
        });
        if (o.snaps.length > 40) o.snaps.shift();
        break;
      }
      case "SkateEvent":
        this.onEvent(m.id, m.kind, m.points, m.label);
        break;
      case "SkateQuestPaid":
        this.quests.claimed(m.day, m.slot);
        if (!m.already) this.toast(`🎯 Quest reward: +${m.coins} 🪙`, 3500);
        this.questsChanged();
        if (this.boardPanel.open) this.boardPanel.show();
        break;
      case "SkateDuelState":
        this.onDuelState(m.phase, m.opp, m.name, m.startIn, m.grinds);
        break;
      case "SkateDuelScore":
        if (this.duel) {
          // The bot's combos, over its head as it lands them.
          if (this.duel.opp === 0 && this.bot && m.points > this.duel.theirs) this.float(BOT_ID, `+${fmt(m.points - this.duel.theirs)}`, "combo");
          this.duel.theirs = m.points;
        }
        break;
      case "SkateDuelEnd":
        this.onDuelEnd(m.mine, m.theirs, m.result);
        break;
      case "SkateBoard":
        this.boardPanel.runs = m.runs;
        this.boardPanel.combos = m.combos;
        if (this.boardPanel.open) this.boardPanel.show();
        break;
    }
  }

  /** Someone else's combo landed (or bail, or run): over their head, and (a big one) in the feed. */
  private onEvent(id: number, kind: number, points: number, label: string) {
    const avatar = this.avatarOf(id);
    const name = this.nameOf(id);
    if (kind === SCORE.BAIL) {
      if (avatar) this.float(id, "💥 Bail!", "bail");
      return;
    }
    if (avatar) this.float(id, `+${fmt(points)}`, kind === SCORE.RUN ? "run" : "combo");
    if (kind === SCORE.RUN) this.feed(`⏱️ ${name} finished a run: ${fmt(points)}`);
    else if (points >= 2000) this.feed(`🔥 ${name}: ${label} — ${fmt(points)}`);
  }

  /** Off the board (they've stepped off, or gone). */
  forget(id: number) {
    const o = this.others.get(id);
    if (!o) return;
    o.rig.destroy();
    this.others.delete(id);
    this.avatarOf(id)?.setArena(null);
  }

  /** On your board again where you were when the connection dropped (if you're back near there, soon enough). */
  private resume(self: Avatar, wallNow: number) {
    const c = carried!;
    carried = null;
    const near = Math.hypot(self.pos.x * TILE + TILE / 2 - c.x, self.pos.y * TILE + TILE - 4 - c.y) < 3 * TILE;
    if (wallNow - c.at > RESUME_MS || !near || !this.park.concrete(c.x, c.y)) return;
    // (Not a run's countdown again: a run carries on as free skating.)
    this.start(c.mode === "run" ? "free" : c.mode);
    const me = this.me;
    if (!me) return;
    me.x = c.x;
    me.y = c.y;
    me.z = this.park.height(c.x, c.y);
    me.heading = c.heading;
    me.speed = c.speed;
  }

  // ---- every frame ----

  update(wallNow: number) {
    const self = this.avatarOf(this.selfId());
    // The "Skate!" button while you're in the park on foot.
    const inPark = !!self && !this.me && this.inPark(self.pos.x, self.pos.y);
    if (this.enterBtn.hidden === inPark) this.enterBtn.hidden = !inPark;
    // Back after the connection dropped, where you were: back on your board, carrying on.
    if (carried && self && !this.me) this.resume(self, wallNow);
    if (this.me && self) this.play(wallNow, self);
    this.drawOthers(wallNow);
    this.driveBot(wallNow);
    this.placeFloats(wallNow);
  }

  private play(wallNow: number, self: Avatar) {
    const me = this.me!;
    // (Up to a quarter second a frame, stepped through: a slow frame or two doesn't slow the board down.)
    const dt = this.last ? Math.min(0.25, (wallNow - this.last) / 1000) : 0;
    this.last = wallNow;
    // The run's clock.
    if (this.mode === "run") this.runClock(wallNow, me);
    const frozen = this.mode === "run" && (this.run.phase === "count" || this.run.phase === "over");
    this.acc += dt;
    const inp = frozen ? NO_INPUT : this.input();
    // (Arrived where you clicked: easing to a stop, not rolling on past it.)
    if (inp.x || inp.y || inp.pop) this.settling = false;
    else if (this.settling && me.mode === "ground") {
      me.speed = Math.max(0, me.speed - SETTLE_BRAKE * dt);
      if (me.speed === 0) this.settling = false;
    }
    let first = true;
    const before = { x: me.x, y: me.y };
    const startedAt = { x: me.x, y: me.y, heading: me.heading };
    while (this.acc >= STEP_S) {
      this.acc -= STEP_S;
      this.stepFrom = { x: me.x, y: me.y, z: me.z };
      // (A press counts once.)
      const step = first ? inp : { ...inp, flip: false, manual: false };
      first = false;
      for (const e of me.step(STEP_S, step)) this.onSkate(e);
    }
    if (!first) {
      this.flipPressed = false;
      this.manualPressed = false;
    }
    // Out of the park, where there's somewhere to walk: off the board (not mid-run or mid-1v1), walking on.
    const out = this.leaving;
    this.leaving = null;
    // (The whole city's skated now, park and streets as one: no stepping off at the park's edge.)
    if (out && this.leave && !this.cityWide && !this.duel && this.mode !== "run" && this.leave(out.tx, out.ty, out.dx, out.dy)) return;
    // Through a gate, in or out: the park's skating, or just riding the streets, rolling on.
    // (Mid-run, mid-line, mid-1v1: the gate's as good as a wall.)
    const inside = this.inPark((me.x - TILE / 2) / TILE, (me.y - TILE + 4) / TILE);
    if (this.mode === "street" && inside) this.crossed(true);
    else if (!inside && this.mode !== "street") {
      if (this.mode === "free" && !this.duel) this.crossed(false);
      else {
        me.x = startedAt.x;
        me.y = startedAt.y;
        me.heading = startedAt.heading + Math.PI;
        me.speed *= 0.35;
      }
    }
    const moved = Math.hypot(me.x - before.x, me.y - before.y);
    this.travelled += moved;
    this.watch?.({ t: "frame" }, me);
    // A grinds-only 1v1: 100 a second while you're on a rail or a ledge (told each whole hundred).
    if (this.duel?.grinds && this.duelGoing && me.mode === "grind") {
      this.grindAcc += 100 * dt;
      if (this.grindAcc >= 25) {
        const add = Math.floor(this.grindAcc);
        this.grindAcc -= add;
        const was = Math.floor(this.run.score / 100);
        this.run.score += add;
        if (Math.floor(this.run.score / 100) > was) this.send({ t: "SkateDuelScore", points: this.run.score, done: false });
      }
    }
    this.trackQuests(me, moved, wallNow);
    // Sounds of the wheels and grinds.
    const grinding = me.mode === "grind" && me.grind ? me.grind.line.kind : "";
    if (grinding !== this.wasGrinding) this.wasGrinding = grinding;
    sfx.rolling(me.mode === "ground" || me.mode === "manual" ? me.speed : 0, grinding || (me.mode === "ground" && me.slideDir ? "ledge" : ""), this.travelled);
    // Drawn: between the last two steps, as far as the time since the last
    // has gone (so it glides at any refresh rate, not jumps a step some frames
    // and none others).
    const pose = this.myPose(me);
    const f = this.acc / STEP_S;
    const from = this.stepFrom;
    if (from && Math.hypot(me.x - from.x, me.y - from.y) < 40) {
      pose.x = from.x + (me.x - from.x) * f;
      pose.y = from.y + (me.y - from.y) * f;
      pose.z = from.z + (me.z - from.z) * f;
    }
    this.myRig?.draw(self, pose, this.park.height(pose.x, pose.y), wallNow);
    // Told: a few dozen times a second, and at once (near enough) when you pop, land, start a trick.
    const changed = pose.pose * 256 + pose.trick !== this.lastPose;
    if (wallNow - this.sentAt >= SEND_MS || (changed && wallNow - this.sentAt >= QUICK_MS)) this.sendMove(wallNow, pose);
    this.drawHud(me);
  }

  private myPose(me: Skater): Pose {
    const pose =
      me.mode === "bail"
        ? POSE.BAIL
        : me.mode === "air"
          ? POSE.AIR
          : me.mode === "grind"
            ? POSE.GRIND
            : me.mode === "manual"
              ? POSE.MANUAL
              : me.crouch > 0
                ? POSE.CROUCH
                : POSE.ROLL;
    return {
      x: me.x,
      y: me.y,
      z: me.z,
      heading: me.heading,
      pose,
      trick: me.trickCode,
      spin: me.mode === "air" ? me.air.spin : 0,
      flipT: me.flip ? (me.flip.t / me.flip.dur) % 1 : undefined,
      bodyT: me.body ? Math.min(1, me.body.t / me.body.dur) : undefined,
      push: me.pushing ? me.push : 0,
      balance: me.balance,
      crouch: me.crouch,
      bailT: me.bailT,
      slide: me.mode === "ground" && me.slideDir !== 0,
    };
  }

  private sendMove(wallNow: number, p: Pose) {
    const x = Math.max(0, Math.min(65535, Math.round((p.x / TILE) * 100)));
    const y = Math.max(0, Math.min(65535, Math.round((p.y / TILE) * 100)));
    const z = Math.max(0, Math.min(255, Math.round(p.z)));
    const turn = (a: number) => ((Math.round((a / (Math.PI * 2)) * 65536) % 65536) + 65536) % 65536;
    const trick = p.pose === POSE.ROLL && p.push ? PUSH_CODE + Math.min(15, Math.floor((p.push / PUSH_S) * 15)) : p.trick;
    const m = { t: "SkateMove" as const, x, y, z, dir: turn(p.heading), pose: p.pose, trick, spin: turn(p.spin), kit: packKit(this.kit) };
    const key = `${x},${y},${z},${m.dir},${m.pose},${m.trick},${m.spin}`;
    // (Standing still, now and then: the server knows you're still there.)
    if (key === this.lastSent && wallNow - this.sentAt < 1000) return;
    this.lastSent = key;
    this.lastPose = p.pose * 256 + p.trick;
    this.sentAt = wallNow;
    // When it was sent, by this page's clock (ms, wrapping): others play it back by that.
    this.send({ ...m, sent: Math.round(wallNow) & 0xffff });
  }

  /**
   * Others, drawn smooth whatever the network's doing: each played back by
   * when they sent their moves, a little behind (by how much their moves
   * have been jittering lately); past their latest (a stall), carried on the
   * way they were going a moment, then held; and drawn gliding toward where
   * they should be (or moved there at once, if they're far off).
   */
  private drawOthers(wallNow: number) {
    for (const [id, o] of this.others) {
      const avatar = this.avatarOf(id);
      if (!avatar || wallNow - o.heard > GONE_MS) {
        this.forget(id);
        continue;
      }
      const target = this.playback(o, wallNow);
      if (!target) continue;
      const dt = o.drawnAt ? Math.min(0.1, (wallNow - o.drawnAt) / 1000) : 0;
      o.drawnAt = wallNow;
      const s = o.shown;
      if (!s || Math.hypot(target.x - s.x, target.y - s.y) > TELEPORT_PX) o.shown = target;
      else {
        // (Quick enough to keep up; slow enough to hide a hop.)
        const k = 1 - Math.exp(-dt * 22);
        o.shown = { ...target, x: s.x + (target.x - s.x) * k, y: s.y + (target.y - s.y) * k, z: s.z + (target.z - s.z) * Math.min(1, k * 1.6) };
      }
      const p = o.shown;
      o.rig.draw(avatar, p, this.park.height(p.x, p.y), wallNow);
    }
  }

  /** Where `o` should be drawn now: between the two moves either side of a moment ago (by their clock), or carried on past their last. */
  private playback(o: Other, wallNow: number): Pose | null {
    const s = o.snaps;
    if (!s.length) return null;
    // How late their moves reach us: the quickest of late (a base), and how much more than that most are.
    const sorted = [...o.lags].sort((a, b) => a - b);
    const base = sorted[0];
    const jitter = sorted[Math.floor(sorted.length * 0.9)] - base;
    const delay = Math.max(DELAY_MIN, Math.min(DELAY_MAX, jitter + 40));
    // The moment drawn, by their clock.
    const at = wallNow - base - delay;
    // (Moves long gone by: not needed.)
    while (s.length > 2 && s[1].st < at - 1000) s.shift();
    let i = s.findIndex((q) => q.st > at);
    let p: Pose;
    if (i === 0) p = { ...s[0].p };
    else if (i > 0) {
      const a = s[i - 1];
      const b = s[i];
      const f = (at - a.st) / Math.max(1, b.st - a.st);
      p = {
        x: a.p.x + (b.p.x - a.p.x) * f,
        y: a.p.y + (b.p.y - a.p.y) * f,
        z: a.p.z + (b.p.z - a.p.z) * f,
        heading: lerpAngle(a.p.heading, b.p.heading, f),
        pose: f < 0.5 ? a.p.pose : b.p.pose,
        trick: f < 0.5 ? a.p.trick : b.p.trick,
        spin: lerpAngle(a.p.spin, b.p.spin, f),
      };
    } else {
      // Past their latest move: carried on the way they were going, a little while.
      i = s.length;
      const last = s[i - 1];
      const prev = s[i - 2];
      p = { ...last.p };
      if (prev && last.st > prev.st) {
        const ahead = Math.min(COAST_MS, at - last.st);
        const k = ahead / (last.st - prev.st);
        p.x += (last.p.x - prev.p.x) * k;
        p.y += (last.p.y - prev.p.y) * k;
        p.z = Math.max(this.park.height(p.x, p.y), last.p.z + (last.p.z - prev.p.z) * k);
      }
    }
    p.bailT = p.pose === POSE.BAIL ? 0.3 : undefined;
    // Pushing off (its stroke's phase sent in place of a trick).
    if (p.pose === POSE.ROLL && p.trick >= PUSH_CODE) {
      p.push = ((p.trick - PUSH_CODE) / 15) * PUSH_S;
      p.trick = 0;
    }
    return p;
  }

  // ---- what happened on your board ----

  private onSkate(e: SkateEvent) {
    const me = this.me!;
    this.watch?.(e, me);
    switch (e.t) {
      case "push":
        sfx.push();
        break;
      case "edge": {
        // Riding out of the park (your way, not bounced into it): off your board, walking on.
        const tx = Math.floor(e.x / TILE);
        const ty = Math.floor(e.y / TILE);
        // (The way you were going as you reached it, not after the bounce off it turned you round.)
        if (!this.leaving && this.leave) this.leaving = { tx, ty, dx: e.dx, dy: e.dy };
        break;
      }
      case "pump":
        sfx.pump(e.power);
        break;
      case "pop":
        sfx.pop(e.power);
        break;
      case "flip":
        sfx.flip(e.kind);
        break;
      case "land":
        sfx.land(e.hard);
        break;
      case "wall":
        sfx.wall(e.speed);
        break;
      case "grind":
        if (e.on) sfx.grindOn(e.kind);
        break;
      case "trick":
        this.questTrick(e.name, e.pts);
        // A grinds-only 1v1: a grind's worth counted at once (and its seconds held, as they go).
        if (this.duel?.grinds && this.duelGoing && Object.values(GRINDS).some((g) => e.name.startsWith(g))) {
          this.run.score += Math.round(e.pts);
          this.send({ t: "SkateDuelScore", points: this.run.score, done: false });
        }
        sfx.counted(me.combo.count);
        this.pop(`${e.name}`, me.combo.count);
        if (this.mode === "line" && this.lineDone) this.lineDone = false;
        break;
      case "special":
        sfx.special();
        this.bigText("✨ SPECIAL! Tricks worth 1.5×", "special", 1800);
        break;
      case "locked": {
        // (Now and then: not every time you try.)
        const now = performance.now();
        if (now - this.lockedAt > 4000) {
          this.lockedAt = now;
          const what = { flip: "That flip", double: "A double", grab: "That grab", grind: "That grind", body: "A full flip" }[e.what];
          this.toast(`🔒 ${what} needs ${needs(e.what)}. Dusty's van has them.`, 3500);
        }
        break;
      }
      case "sketchy":
        this.bigText("Sketchy!", "warn", 800);
        break;
      case "bail":
        sfx.bail();
        this.qStreak = 0;
        if (e.lost > 0) sfx.lost();
        this.bigText(`💥 BAIL! ${e.why}${e.lost ? `  (lost ${fmt(e.lost)})` : ""}`, "bail", 1800);
        this.send({ t: "SkateScore", kind: SCORE.BAIL, points: e.lost, label: e.why });
        if (this.mode === "line" && e.lost > 0) this.lineOver(0, "");
        break;
      case "bank": {
        sfx.banked(e.pts, e.count);
        this.qStreak++;
        this.quest("comboPts", e.pts);
        this.quest("comboTricks", e.count);
        this.quest("banked", e.pts);
        this.quest("cleanStreak", this.qStreak);
        this.bigText(`+${fmt(e.pts)}`, e.pts >= 5000 ? "huge" : e.pts >= 1500 ? "big" : "ok", 1600, e.label);
        if (this.mode === "run" && (this.run.phase === "go" || this.run.phase === "late")) {
          const r = this.run;
          if (!this.duel?.grinds) r.score += e.pts;
          r.combos++;
          r.tricks += e.count;
          if (e.pts > r.best) {
            r.best = e.pts;
            r.bestLabel = e.label;
          }
          if (this.duel?.phase === "on") this.send({ t: "SkateDuelScore", points: r.score, done: false });
        }
        if (e.pts >= TELL_PTS) this.send({ t: "SkateScore", kind: SCORE.COMBO, points: e.pts, label: e.label });
        this.saveBest("combo", e.pts);
        if (this.mode === "line") this.lineOver(e.pts, e.label);
        break;
      }
    }
  }

  private lineOver(pts: number, label: string) {
    this.lineDone = true;
    this.quest("lineScore", pts);
    if (this.me) this.watch?.({ t: "line" }, this.me);
    const best = this.bests().combo;
    window.setTimeout(() => {
      if (!this.me || this.mode !== "line") return;
      this.bigText(pts ? `🔗 Line: ${fmt(pts)}${pts >= best ? "  🏆 Your best!" : ""}` : "🔗 Line lost. Go again!", pts ? "big" : "bail", 2600, label);
    }, 900);
  }

  private runClock(wallNow: number, me: Skater) {
    const r = this.run;
    if (r.phase === "count") {
      // 3, 2, 1, GO!
      const n = Math.ceil((r.goAt - wallNow) / 1000);
      if (n !== r.ticked) {
        r.ticked = n;
        sfx.countdown(Math.max(0, n));
        this.bigText(n > 0 ? `${n}` : "GO!", "count", 700);
      }
      if (wallNow >= r.goAt) {
        r.phase = "go";
        r.endAt = r.goAt + RUN_S * 1000;
        r.ticked = RUN_S;
      }
    } else if (r.phase === "go" || r.phase === "late") {
      const left = (r.endAt - wallNow) / 1000;
      const n = Math.max(0, Math.ceil(left));
      // The last ten seconds, ticked off.
      if (n !== r.ticked && n > 0 && n <= HURRY_S) sfx.hurry(n);
      r.ticked = n;
      if (left > 0) return;
      // Time! A trick still going is let land (a few seconds at most).
      if (me.mode === "ground" || me.mode === "bail" || wallNow - r.endAt > LATE_MS) this.endRun(me);
      else r.phase = "late";
    }
  }

  /** The horn: what's still to bank banked, the score kept and told, and the card. */
  private endRun(me: Skater) {
    const r = this.run;
    const ev: SkateEvent[] = [];
    me.finish(ev);
    for (const e of ev) this.onSkate(e);
    r.phase = "over";
    // (Stood still till you pick what next: nothing more counts.)
    me.speed = 0;
    sfx.horn();
    const best = this.bests().run;
    this.saveBest("run", r.score);
    if (r.score > 0) this.send({ t: "SkateScore", kind: SCORE.RUN, points: r.score, label: "" });
    this.quest("runScore", r.score);
    this.quest("runs", 1);
    this.watch?.({ t: "run" }, me);
    if (this.duel?.phase === "on") {
      this.send({ t: "SkateDuelScore", points: r.score, done: true });
      this.duel.phase = "over";
      this.duelBanner(`⚔️ Your score's in: ${fmt(r.score)}. Waiting on ${this.duel.name}…`);
      return;
    }
    this.showResults(best);
  }

  /** The card: the total counting up, whether it's your best, the combos, the tricks, the best combo; go again, or ride on. */
  private showResults(before: number) {
    const r = this.run;
    const total = el("div", "skate-results-total", "0");
    const record = r.score > 0 && r.score > before;
    const stat = (label: string, value: string, sub = "") => {
      const d = el("div", "skate-results-stat");
      d.append(el("b", "", value), el("span", "", label));
      if (sub) d.append(el("small", "", sub));
      return d;
    };
    const stats = el("div", "skate-results-stats");
    stats.append(stat("combos", fmt(r.combos)), stat("tricks", fmt(r.tricks)), stat("best combo", fmt(r.best), r.bestLabel));
    const badge = record
      ? el("div", "skate-results-badge best", before > 0 ? `🏆 New personal best! (was ${fmt(before)})` : "🏆 Your first run on the board!")
      : el("div", "skate-results-badge", r.score > 0 ? `Your best: ${fmt(before)}` : "Land some tricks before the horn!");
    const btns = el("div", "skate-results-btns");
    btns.append(button("🔁 Run again", () => this.start("run"), "primary"), button("🛹 Free skate", () => this.start("free")), button("🏆 Scoreboard", () => this.boardPanel.show()));
    this.resultsEl.replaceChildren(
      el("div", "skate-results-title", "⏱️ TIME!"),
      el("div", "skate-results-label", "Total score"),
      total,
      badge,
      stats,
      btns,
      el("div", "skate-results-hint", "Enter: run again · Esc: free skate"),
    );
    this.resultsEl.classList.toggle("record", record);
    this.resultsEl.hidden = false;
    // The total, counted up.
    const t0 = performance.now();
    const dur = Math.min(1600, 500 + r.score / 20);
    let ticks = 0;
    window.clearInterval(this.tallyTimer);
    this.tallyTimer = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      total.textContent = fmt(Math.round(r.score * (1 - Math.pow(1 - k, 3))));
      if (k < 1 && r.score > 0 && ticks++ % 2 === 0) sfx.tally();
      if (k >= 1) {
        window.clearInterval(this.tallyTimer);
        total.classList.add("done");
        if (record) sfx.special();
      }
    }, 40);
  }

  // ---- Dusty's quests ----

  private quest(metric: Metric, value: number) {
    this.quests.record(metric, value);
  }

  /** The quests (and the shop's tab of them) to be shown afresh. */
  questsChanged: () => void = () => {};

  /** A trick counted: drop-ins, gaps, spins and grinds, for the quests. */
  private questTrick(name: string, pts: number) {
    this.quest("tricks", 1);
    if (name === "Drop In") this.quest("dropIns", 1);
    if (name === "Kicker Gap" || name === "Funbox Gap" || name === "Stair Set") this.quest("gaps", 1);
    const spin = /^(\d+) /.exec(name);
    if (spin) this.quest("spin", Number(spin[1]));
    if (Object.values(GRINDS).some((g) => name.startsWith(g))) this.quest("grindPts", pts);
  }

  /** Every frame: air (how high, how long), manuals, grinds and grabs held, how far and fast. */
  private trackQuests(me: Skater, moved: number, wallNow: number) {
    if (me.mode === "air") {
      if (!this.qAir) this.qAir = { at: wallNow, top: 0 };
      this.qAir.top = Math.max(this.qAir.top, me.z);
    } else if (this.qAir) {
      // Down: on four wheels (or a rail), not on your face.
      if (me.mode !== "bail") {
        this.quest("airHeight", this.qAir.top);
        this.quest("airTime", (wallNow - this.qAir.at) / 1000);
      }
      this.qAir = null;
    }
    const held = (k: "manual" | "grind" | "grab", now: number, metric: Metric) => {
      if (now > 0) this.qHeld[k] = Math.max(this.qHeld[k], now);
      else if (this.qHeld[k] > 0) {
        if (me.mode !== "bail") this.quest(metric, this.qHeld[k]);
        this.qHeld[k] = 0;
      }
    };
    held("manual", me.mode === "manual" ? me.manualT : 0, "manualTime");
    held("grind", me.mode === "grind" && me.grind ? me.grind.t : 0, "grindTime");
    held("grab", me.grab ? me.grab.t : 0, "grabTime");
    // (Distance and speed told now and then, not every frame.)
    this.qDist += moved;
    if (me.mode === "ground") this.qSpeed = Math.max(this.qSpeed, me.speed);
    if (wallNow - this.qAt > 1000) {
      this.qAt = wallNow;
      this.quest("distance", this.qDist);
      this.quest("topSpeed", this.qSpeed);
      this.qDist = 0;
      this.qSpeed = 0;
    }
  }

  // ---- 1v1 ----

  /** Looking for a 1v1 (on a board first, if you're not); `grinds`: only grinds count. */
  private findDuel(bot: boolean, grinds = false) {
    if (!this.me) this.start("free");
    if (!this.me) return;
    this.send({ t: "SkateDuel", join: true, bot, grinds });
  }

  private leaveDuel() {
    this.send({ t: "SkateDuel", join: false, bot: false, grinds: false });
    this.duel = null;
    this.duelEl.hidden = true;
    this.dropBot();
  }

  /** The bot, onto a board beside you. */
  private spawnBot() {
    this.dropBot();
    const me = this.me;
    if (!me || !this.makeBot) return;
    // Beside you if there's room, else just behind.
    const side = [[0, 40], [0, -40], [40, 0], [-40, 0]].find(([dx, dy]) => this.park.concrete(me.x + dx, me.y + dy) && this.park.height(me.x + dx, me.y + dy) === me.z) ?? [0, 0];
    const x = me.x + side[0];
    const y = me.y + side[1];
    const p = this.park as unknown as { tx0: number; ty0: number; tw: number; th: number };
    const spots: { x: number; y: number }[] = [];
    for (let ty = p.ty0; ty < p.ty0 + p.th; ty++) for (let tx = p.tx0; tx < p.tx0 + p.tw; tx++) if (this.park.concreteTile(tx, ty) && this.park.height(tx * TILE + 16, ty * TILE + 16) === 0) spots.push({ x: tx, y: ty });
    const rider = new BotRider(this.park, x, y, spots, () => this.me && { x: this.me.x, y: this.me.y });
    rider.s.heading = me.heading;
    rider.grinds = !!this.duel?.grinds;
    const avatar = this.makeBot((x - TILE / 2) / TILE, (y - TILE + 4) / TILE);
    this.bot = { rider, rig: new Rig(this.scene, { deck: 6, wheels: 2, bearings: 4, trucks: 4, trail: 2 }, this.lit), avatar, acc: 0, last: 0 };
  }

  private dropBot() {
    const b = this.bot;
    if (!b) return;
    this.bot = null;
    b.rig.destroy();
    b.avatar.destroy();
  }

  /** A 1v1's minute going (it counts). */
  private get duelGoing(): boolean {
    return this.duel?.phase === "on" && this.mode === "run" && (this.run.phase === "go" || this.run.phase === "late");
  }

  /** Every frame: the bot skates (from GO till the horn, then coasts), drawn on its board. */
  private driveBot(wallNow: number) {
    const b = this.bot;
    if (!b) return;
    const dt = b.last ? Math.min(0.25, (wallNow - b.last) / 1000) : 0;
    b.last = wallNow;
    b.acc += dt;
    const go = this.mode === "run" && (this.run.phase === "go" || this.run.phase === "late") && !!this.duel;
    while (b.acc >= STEP_S) {
      b.acc -= STEP_S;
      b.rider.step(STEP_S, go);
    }
    const s = b.rider.s;
    b.rig.draw(b.avatar, this.myPose(s), this.park.height(s.x, s.y), wallNow);
    b.avatar.update(wallNow, wallNow);
  }

  private onDuelState(phase: number, opp: number, name: string, startIn: number, grinds: boolean) {
    if (phase === DUEL.WAITING) {
      this.duel = { phase: "waiting", opp: 0, name: "", theirs: 0, grinds };
      this.duelBanner(`⚔️ Looking for someone to take you on${grinds ? " (grinds only)" : ""}…`, true);
      return;
    }
    if (phase !== DUEL.STARTING || !this.me) return;
    this.duel = { phase: "on", opp, name, theirs: 0, grinds };
    this.grindAcc = 0;
    this.duelEl.hidden = true;
    if (opp === 0) this.spawnBot();
    sfx.special();
    this.start("run", performance.now() + startIn);
    this.bigText(`⚔️ 1v1 vs ${name}!`, "big", 1400, grinds ? "🛤️ Grinds only: only grinds count, and the longer the better" : "60 seconds: the higher score wins");
  }

  private onDuelEnd(mine: number, theirs: number, result: number) {
    const d = this.duel;
    const name = d?.name ?? "them";
    this.duel = null;
    this.duelEl.hidden = true;
    // (The bot rolls to a stop, and is gone in a moment.)
    const bot = this.bot;
    if (bot) window.setTimeout(() => this.bot === bot && this.dropBot(), 3000);
    if (!this.me) return;
    const won = result === DUEL.WON || result === DUEL.WALKOVER;
    if (result === DUEL.WON) this.quest("duelWins", 1);
    const title = result === DUEL.WALKOVER ? "🏆 They left: you win!" : result === DUEL.WON ? "🏆 YOU WIN!" : result === DUEL.DRAW ? "🤝 A DRAW!" : "😤 YOU LOST";
    const card = this.resultsEl;
    const row = (who: string, pts: number, lead: boolean) => {
      const r = el("div", `skate-duel-line${lead ? " lead" : ""}`);
      r.append(el("span", "", who), el("b", "", fmt(pts)));
      return r;
    };
    const btns = el("div", "skate-results-btns");
    btns.append(
      button("⚔️ Again", () => (this.hideResults(), this.findDuel(d?.opp === 0, !!d?.grinds)), "primary"),
      button("🛹 Free skate", () => this.start("free")),
      button("🏆 Scoreboard", () => this.boardPanel.show()),
    );
    card.replaceChildren(el("div", "skate-results-title", title), ...(d?.grinds ? [el("div", "skate-results-label", "🛤️ Grinds only")] : []), row("You", mine, mine >= theirs), row(name, theirs, theirs > mine), btns, el("div", "skate-results-hint", "Enter: again · Esc: free skate"));
    card.classList.toggle("record", won);
    card.hidden = false;
    this.duelAgain = d ? { bot: d.opp === 0, grinds: d.grinds } : null;
    if (won) sfx.special();
    else sfx.lost();
  }

  /** The 1v1 card's Enter: the same again (the bot, or someone). */
  private duelAgain: { bot: boolean; grinds: boolean } | null = null;

  /** A line about your 1v1 up top (`cancel`: with a way out of waiting). */
  private duelBanner(text: string, cancel = false) {
    this.duelEl.replaceChildren(el("span", "", text));
    if (cancel) {
      this.duelEl.append(
        button("🤖 Take on the bot", () => {
          const grinds = !!this.duel?.grinds;
          this.leaveDuel();
          this.findDuel(true, grinds);
        }, "small"),
        button("Cancel", () => this.leaveDuel(), "small"),
      );
    }
    this.duelEl.hidden = false;
  }

  private hideResults() {
    this.duelAgain = null;
    window.clearInterval(this.tallyTimer);
    this.resultsEl.hidden = true;
  }

  /** The card up: Enter goes again, Esc rides on. */
  private get resultsUp(): boolean {
    return !this.resultsEl.hidden;
  }

  // ---- the HUD ----

  private drawHud(me: Skater) {
    const r = this.run;
    const head =
      this.mode === "run"
        ? `<span class="skate-mode-name">⏱️ ${r.phase === "count" ? "Get ready…" : r.phase === "over" ? "Time!" : r.phase === "late" ? "Land it!" : `${Math.max(0, r.ticked)}s`}</span><b>${fmt(r.score)}</b>`
        : this.mode === "line"
          ? `<span class="skate-mode-name">🔗 Line</span><b>${fmt(me.combo.total)}</b>`
          : `<span class="skate-mode-name">🛹 Free skate</span><b>${fmt(me.banked)}</b><span class="skate-best">best combo ${fmt(me.bestCombo)}</span>`;
    const d = this.duel;
    const vs = d && d.phase !== "waiting" && this.mode === "run" ? `${d.grinds ? '<span class="skate-grinds">🛤️ Grinds only</span>' : ""}<span class="skate-vs">vs ${esc(d.name)} <b>${fmt(d.theirs)}</b></span>` : "";
    if (this.scoreEl.innerHTML !== head + vs) this.scoreEl.innerHTML = head + vs;
    // (The last ten seconds: the clock goes red.)
    this.scoreEl.classList.toggle("hurry", this.mode === "run" && (r.phase === "late" || (r.phase === "go" && r.ticked <= HURRY_S)));
    // Surf trucks: the pump's rhythm.
    const surf = me.kit.pump > 0;
    if (this.flowEl.hidden === surf) this.flowEl.hidden = !surf;
    if (surf) {
      this.flowEl.style.setProperty("--fill", `${Math.round(me.pumpFlow * 100)}%`);
      this.flowEl.classList.toggle("full", me.pumpFlow > 0.85);
    }
    this.specialEl.style.setProperty("--fill", `${Math.round(me.special * 100)}%`);
    this.specialEl.classList.toggle("full", me.special >= 1);
    // The combo building: its tricks, its points × how many.
    const c = me.combo;
    if (c.count) {
      const names = c.tricks.slice(-4).map((t) => t.name);
      const text = `${c.count > 4 ? "… + " : ""}${names.join(" + ")}`;
      const pts = `${fmt(c.base)} × ${c.count}`;
      if (this.comboEl.dataset.k !== text + pts) {
        this.comboEl.dataset.k = text + pts;
        this.comboEl.replaceChildren(el("div", "skate-combo-names", text), el("div", "skate-combo-pts", pts));
      }
      this.comboEl.hidden = false;
    } else this.comboEl.hidden = true;
    // The balance (grinding or on a manual).
    const balancing = me.mode === "grind" || me.mode === "manual";
    this.balanceEl.hidden = !balancing;
    if (balancing) {
      (this.balanceEl.firstElementChild as HTMLElement).style.left = `${50 + Math.max(-1, Math.min(1, me.balance)) * 48}%`;
      this.balanceEl.classList.toggle("tipping", Math.abs(me.balance) > 0.65);
    }
    // The stick under your thumb.
    this.stickEl.hidden = !this.stick;
    if (this.stick) {
      this.stickEl.style.transform = `translate(${this.stick.x0}px, ${this.stick.y0}px)`;
      const dx = this.stick.x - this.stick.x0;
      const dy = this.stick.y - this.stick.y0;
      const d = Math.hypot(dx, dy);
      const k = d > STICK_R ? STICK_R / d : 1;
      (this.stickEl.firstElementChild as HTMLElement).style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
  }

  /** A trick's name popping up as it's counted. */
  private pop(text: string, n: number) {
    const p = el("div", "skate-pop", text);
    p.style.setProperty("--n", String(Math.min(10, n)));
    this.popEl.append(p);
    while (this.popEl.children.length > 4) this.popEl.firstElementChild?.remove();
    window.setTimeout(() => p.remove(), 1100);
  }

  /** Big text in the middle: a banked combo, a bail, the countdown. */
  private bigText(text: string, kind: string, ms: number, sub = "") {
    this.bigEl.replaceChildren(el("div", `skate-big-main ${kind}`, text));
    if (sub) this.bigEl.append(el("div", "skate-big-sub", sub));
    this.bigEl.classList.remove("show");
    void this.bigEl.offsetWidth;
    this.bigEl.classList.add("show");
    const mine = this.bigEl.firstElementChild;
    window.setTimeout(() => {
      if (this.bigEl.firstElementChild === mine) this.bigEl.classList.remove("show");
    }, ms);
  }

  private feed(text: string) {
    const line = el("div", "skate-feed-line", text);
    this.feedEl.append(line);
    while (this.feedEl.children.length > 4) this.feedEl.firstElementChild?.remove();
    window.setTimeout(() => line.remove(), 6000);
  }

  /** Over someone's head for a moment (their points, a bail). */
  private float(id: number, text: string, kind: string) {
    const f = el("div", `skate-float ${kind}`, text);
    this.labels.append(f);
    this.floats.push({ el: f, id, until: performance.now() + 1600, y: 0 });
  }

  /** Who `id` is: anyone here, or the bot. */
  private who(id: number): Avatar | undefined {
    return id === BOT_ID ? this.bot?.avatar : this.avatarOf(id);
  }

  private placeFloats(wallNow: number) {
    this.floats = this.floats.filter((f) => {
      const a = this.who(f.id);
      if (!a || wallNow > f.until) {
        f.el.remove();
        return false;
      }
      const left = (f.until - wallNow) / 1600;
      const s = this.scene.tileToScreen(a.shown.x + 0.5, a.shown.y - 1.2 - (1 - left) * 0.8);
      f.el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, -100%)`;
      f.el.style.opacity = String(Math.min(1, left * 2));
      return true;
    });
  }

  private bests(): { run: number; combo: number } {
    try {
      return JSON.parse(localStorage.getItem("commons.skate") ?? "") ?? { run: 0, combo: 0 };
    } catch {
      return { run: 0, combo: 0 };
    }
  }

  private saveBest(kind: "run" | "combo", pts: number) {
    const b = this.bests();
    if (pts <= (b[kind] ?? 0)) return;
    b[kind] = pts;
    try {
      localStorage.setItem("commons.skate", JSON.stringify(b));
    } catch {
      /* (A private window: no bests kept.) */
    }
  }

  // ---- input ----

  private input(): Input {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has("ArrowLeft") || k.has("KeyA")) x -= 1;
    if (k.has("ArrowRight") || k.has("KeyD")) x += 1;
    if (k.has("ArrowUp") || k.has("KeyW")) y -= 1;
    if (k.has("ArrowDown") || k.has("KeyS")) y += 1;
    // The mouse: toward where you clicked (no arrow keys held: they take over), easing off as you get there.
    const me = this.me;
    if ((x || y) && !this.aimHeld) this.aim = null;
    if (!x && !y && this.aim && me) {
      const dx = this.aim.x - me.x;
      const dy = this.aim.y - me.y;
      const d = Math.hypot(dx, dy);
      // (Braking in time to stop on it: from as far out as it takes at this speed.)
      const stopIn = (me.speed * me.speed) / (2 * SETTLE_BRAKE);
      if (d < Math.max(14, stopIn) && !this.aimHeld) {
        this.aim = null;
        this.settling = true;
      }
      else if (d >= 6) {
        const m = Math.min(1, d / 48);
        x = (dx / d) * m;
        y = (dy / d) * m;
      }
    }
    if (this.stick) {
      const dx = this.stick.x - this.stick.x0;
      const dy = this.stick.y - this.stick.y0;
      const d = Math.hypot(dx, dy);
      if (d > 8) {
        const m = Math.min(1, d / STICK_R);
        x = (dx / d) * m;
        y = (dy / d) * m;
      }
    }
    const d = Math.hypot(x, y);
    if (d > 1) {
      x /= d;
      y /= d;
    }
    const spin = (k.has("KeyQ") || this.held.spinL ? -1 : 0) + (k.has("KeyE") || this.held.spinR ? 1 : 0);
    return {
      x,
      y,
      pop: k.has("Space") || this.held.pop || this.rightPop,
      flip: this.flipPressed,
      manual: this.manualPressed,
      grab: k.has("KeyK") || this.held.grab,
      spin,
    };
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.me || isTyping(e)) return;
    const code = e.code;
    // The run's card up: Enter goes again, Esc rides on.
    if (this.resultsUp && (code === "Enter" || code === "NumpadEnter" || code === "Escape")) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) {
        const again = this.duelAgain;
        if (code !== "Escape" && again !== null) {
          this.hideResults();
          this.findDuel(again.bot, again.grinds);
        } else this.start(code === "Escape" ? "free" : "run");
      }
      return;
    }
    const used = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyJ", "KeyK", "KeyL", "KeyQ", "KeyE", "Escape"];
    if (!used.includes(code)) return;
    e.preventDefault();
    e.stopPropagation();
    if (code === "Escape") {
      if (!e.repeat) this.getOff();
      return;
    }
    this.keys.add(code);
    if (e.repeat) return;
    if (code === "KeyJ") this.flipPressed = true;
    if (code === "KeyL") this.manualPressed = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    // (Let go: the game hears it too, so a key held as you got on isn't left
    // held down after, riding you off on its own when you get off.)
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.stick = null;
    this.held = { pop: false, grab: false, spinL: false, spinR: false };
  };

  /**
   * The mouse: where a left click sent you (world px), steered toward and
   * pushed for till you're there; held down, it follows the pointer. The
   * right button's the pop (held: crouched; let go: an ollie; in the air: a flip).
   */
  private aim: { x: number; y: number } | null = null;
  private aimHeld = false;
  /** Out on the streets, where the left button went down: a click's the game's (ridden to, or tapped on); dragged, it steers. */
  private press: { x: number; y: number } | null = null;
  /** Got where you clicked: braking gently to a stop there (till you ride on). */
  private settling = false;
  private rightPop = false;

  /** How fast your board's going (px/s; 0 off it). */
  get speed(): number {
    return this.me?.speed ?? 0;
  }

  /** Whether you're steering your board yourself now (a direction key, the mouse held down, the stick). */
  get steering(): boolean {
    if (this.aimHeld || this.stick) return true;
    for (const k of this.keys) if (/^(Arrow(Up|Down|Left|Right)|Key[WASD])$/.test(k)) return true;
    return false;
  }

  /** Whether you're on your way somewhere you clicked (not there yet). */
  get aiming(): boolean {
    return !!this.aim;
  }

  /** Ride to (x, y) (world px): pushing and steering there, easing to a stop (a tap, out on the streets). */
  steerTo(x: number, y: number) {
    this.aim = { x, y };
    this.settling = false;
  }

  private aimAt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const w = this.scene.screenToWorld(e.clientX - r.left, e.clientY - r.top);
    this.aim = { x: w.x, y: w.y };
  }

  private onDown = (e: PointerEvent) => {
    if (this.me && e.pointerType === "mouse") {
      if (e.button === 0 && this.street) this.press = { x: e.clientX, y: e.clientY };
      else if (e.button === 0) {
        this.aimAt(e);
        this.aimHeld = true;
      } else if (e.button === 2) {
        e.preventDefault();
        this.rightPop = true;
      }
      return;
    }
    if (!this.me || e.pointerType !== "touch") return;
    e.preventDefault();
    document.body.classList.add("skate-touch-mode");
    if (e.clientX < window.innerWidth / 2 && !this.stick) this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  };

  private onMove = (e: PointerEvent) => {
    if (this.me && this.press && e.pointerType === "mouse" && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 10) {
      this.press = null;
      this.aimHeld = true;
    }
    if (this.me && this.aimHeld && e.pointerType === "mouse") this.aimAt(e);
    if (!this.stick || this.stick.id !== e.pointerId) return;
    this.stick.x = e.clientX;
    this.stick.y = e.clientY;
    const dx = this.stick.x - this.stick.x0;
    const dy = this.stick.y - this.stick.y0;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R * 1.35) {
      const k = (d - STICK_R * 1.35) / d;
      this.stick.x0 += dx * k;
      this.stick.y0 += dy * k;
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerType === "mouse") {
      if (e.button === 0) {
        this.aimHeld = false;
        this.press = null;
      }
      if (e.button === 2) this.rightPop = false;
    }
    if (this.stick && this.stick.id === e.pointerId) this.stick = null;
  };

  /** (No menu on a right click while you're on a board: it's your pop.) */
  private onMenu = (e: Event) => {
    if (this.me) e.preventDefault();
  };

  /** On a phone: Ollie (hold to crouch), Flip, Grab (hold), Manual, and the two spins. */
  private buildTouch() {
    const hold = (label: string, cls: string, key: keyof typeof this.held) => {
      const b = button(label, () => {}, `skate-btn ${cls}`);
      const on = (v: boolean) => (ev: PointerEvent) => {
        ev.preventDefault();
        this.held[key] = v;
        b.classList.toggle("down", v);
      };
      b.addEventListener("pointerdown", on(true));
      b.addEventListener("pointerup", on(false));
      b.addEventListener("pointercancel", on(false));
      b.addEventListener("pointerleave", on(false));
      return b;
    };
    const tap = (label: string, cls: string, run: () => void) => {
      const b = button(label, () => {}, `skate-btn ${cls}`);
      b.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        run();
      });
      return b;
    };
    const row1 = el("div", "skate-touch-row");
    row1.append(hold("↺", "spin", "spinL"), hold("↻", "spin", "spinR"));
    const row2 = el("div", "skate-touch-row");
    row2.append(
      tap("Flip", "flip", () => (this.flipPressed = true)),
      hold("Grab", "grab", "grab"),
    );
    const row3 = el("div", "skate-touch-row");
    row3.append(
      tap("Manual", "manual", () => (this.manualPressed = true)),
      hold("Ollie", "ollie", "pop"),
    );
    this.touchEl.append(row1, row2, row3);
  }

  destroy() {
    // (Gone with the connection, perhaps: what you were doing, to be carried on.)
    const me = this.me;
    if (me && me.mode !== "bail" && this.mode !== "street") carried = { x: me.x, y: me.y, z: me.z, heading: me.heading, speed: me.speed, mode: this.mode, at: performance.now() };
    this.stop();
    for (const id of [...this.others.keys()]) this.forget(id);
    for (const f of this.floats) f.el.remove();
    this.hud.remove();
    this.offBtn.remove();
    this.enterBtn.remove();
    this.boardPanel.hide();
    this.boardPanel.el.remove();
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("contextmenu", this.onMenu);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
  }
}

