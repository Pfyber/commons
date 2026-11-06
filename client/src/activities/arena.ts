// The gladiator arena in the park: Crown of the Colosseum (protocol
// ArenaState / ArenaEvent; the rules on the server in commons_sim::arena).
// Four gladiators (bots in the empty places), every one for themselves;
// last one standing takes the round's crown, three crowns and you're
// champion. It plays out on the map with everyone's own avatar, so anyone
// walking past sees it.
//
// Controls: WASD to move and the mouse to aim; click to slash (keep
// clicking: a three-hit combo), hold the button to charge a heavy blow and
// let go to lunge; hold the right button (or Shift) to block, and raise it
// just as a blow lands to parry; Space to roll; E to throw what you're
// holding; Q for the whirlwind once your rage is full. On a phone: a stick
// on the left; Attack (tap, or hold to charge), Block (hold), Roll, Throw
// and Whirlwind on the right; your aim locks onto whoever's closest.
//
// You move at once (the server checks); others glide a beat behind, between
// its ticks. When you're knocked flying the server carries you (here, the
// same knock plays out at once). Every blow: sparks, a number, a hit-stop and
// a shake; parries flash, walls thud, bombs boom, spikes shake then rise,
// the crowd throws gifts in, a disaster strikes (lava, meteors or lions: the
// spectators' choice), and late in a round the ring of fire closes.

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import * as arenafx from "../ambient/arenafx";
import * as sfx from "../ambient/sfx";
import type { EntityInfo, ServerMsg } from "../net/protocol.gen";
import { button, confirmButton, el, isTyping } from "../ui/panels";
import { type AvatarFrame, BOWL_RELEASE, dozeFrame, SWORD_GUARD, SWORD_RAISE, TILE, toTexture } from "../world/art";
import { Avatar } from "../world/avatars";
import { encodeLook } from "../world/look";
import type { MapObject } from "../world/map";
import { COURT_CAESAR, COURT_CANDLES, COURT_TORCH_DOWN, COURT_TORCH_OUT, COURT_OVERHANG, TORCH_HEIGHT, torchStand, GATE_FIRES, GATE_OVERHANG, PILLAR_FIRE_Y, PILLAR_OVERHANG, SIDE_GATE_DOOR, SIDE_GATE_FIRES, SIDE_GATE_OVERHANG } from "../world/arenaart";
import { drawPixelText, pixelWidth } from "../world/pixelfont";
import { levelLabel, levelPicker } from "./botlevel";
import { drawArms } from "./arenagear";
import { BetPanel } from "./arenabets";
import { NightGlows } from "./arenaglow";
import { Juice } from "./arenajuice";
import { ACT, ARROW, ARROW_RANGE, ARROW_SPEED, BIG_BOMB, BIG_BOMB_COST, BIG_BOMB_FULL_MS, BIG_BOMB_R, BLAST_R, BODY_H, BURST_MIN_COST, STAB, STAB_COST, CAST, GIANT_H, KIT, KIT_COST, KIT_HEAVY_COST, KIT_HEAVY_REACH, KIT_HP, KIT_LIGHT_ARC, KIT_LIGHT_REACH, KIT_LIGHT_TIME, KIT_LIGHT_WINDUP, KIT_LUNGE, KIT_LUNGE_MAX, KIT_SPEED, KIT_SPIN_REACH, KITS, KitPicker, LOB_MIN, LOB_RANGE, QUAKE_R, SHOOT, SPEAR_FULL_MS, TANK_LEAP, TANK_LEAP_MIN, TANK_STOMP_R, kitGallery, kitOf, picked, shoots } from "./arenakits";
import { ClassWheel } from "./arenawheel";
import { DisasterShow, KINDS, THIEF_ID } from "./arenadisaster";
import * as dfx from "../ambient/disasterfx";
import * as wheelfx from "../ambient/wheelsfx";
import { BOWL_OVERHANG, bowlMasts, bowlSeats } from "../world/amphitheatre";
import { spectatorTexture } from "../world/crowdart";
import { drawGoliath, GOLIATH_HEIGHT, type GoliathAct, type GoliathPose } from "../world/goliathart";
import type { Scene } from "../world/scene";

// ---- the rules (as commons_sim::arena) -------------------------------------------

const LOBBY = 0;
const COUNTDOWN = 1;
const FIGHTING = 2;
const ROUND_END = 3;
const OVER = 4;
const SLOTS = 4;
export const BOT_BASE = 0xffffff20;
const TO_WIN = 3;
/** How square an amphitheatre's sand is (as `arena::ROUNDNESS`: a superellipse's power). */
const ROUNDNESS = 3.3;
/**
 * The champion's parade, the last of a match (the server's OVER_MS and
 * PARADE_*): out of the ring by the south gate and down the red carpet, the
 * rest trailing behind, heads hung, all of them ending on the carpet.
 *
 * These must be the server's exactly, or the parade ends in a jump
 * (arena.test.ts checks).
 */
export const OVER_MS = 15_000;
export const PARADE_END = 11.9;
export const PARADE_GAP = 1.4;
export const PARADE_FIRST_GAP = 2.0;
/** Its beats (seconds in): gathered in the middle; the salute; walked out and down; there. */
const GATHER = 2.0;
const SALUTE = 3.4;
const ARRIVE = 12.8;
/** Hung heads: a slumped shuffle (a stride, slumped, the other stride, slumped). */
const SLUMP = dozeFrame(2);
const SHUFFLE: AvatarFrame[] = [0, SLUMP, 1, SLUMP];
const PETAL_COLORS = [0xfff0f4, 0xffffff, 0xffb3c8, 0xff8fb1, 0xffd23f, 0xfff0f4, 0xff5f7e, 0xffc8dc];
const SPEED = 4.2;
const BODY_R = 0.32;
const LIGHT: [number, number, number][] = [
  [110, 90, 200],
  [110, 90, 200],
  [170, 110, 320],
];
const HEAVY_MIN_MS = 220;
const HEAVY_FULL_MS = 1000;
/** How long class `k`'s lunge (or stomp) takes to fill. */
const fillMs = (k: number) => (k === KIT.SPEARMAN ? SPEAR_FULL_MS : HEAVY_FULL_MS);
const HEAVY: [number, number, number] = [70, 190, 360];
const HEAVY_ARC = 1.25;
/** The heavy blow's lunge: further the longer it's charged (as `arena::HEAVY_LUNGE*`). */
export const HEAVY_LUNGE = 1.3;
export const HEAVY_LUNGE_MAX = 4.0;
const HEAVY_COST = 28;
/** The Goliath's stomp's (as `arena::STOMP_COST`). */
const STOMP_COST = 30;
const ROLL_MS = 260;
const ROLL_DIST = 2.3;
const ROLL_COST = 24;
const ROLL_CD_MS = 450;
const THROW: [number, number] = [130, 220];
const SPEAR_SPEED = 15;
const SPEAR_RANGE = 11;
const BOMB_SPEED = 9;
const BOMB_RANGE = 6.5;
const BOMB_R = 1.9;
const KB_FRICTION = 5;
/** How long before a press counts as charging a heavy blow (ms). */
const HOLD_MS = 170;
/** How long a roll that can't go yet is kept for (as `arena::INPUT_BUFFER_MS`). */
const ROLL_BUFFER_MS = 400;
/** Wall time (ms), as the frame's own. */
const wallNow = () => performance.now();
const INPUT = { LIGHT: 1, HEAVY_START: 2, HEAVY_RELEASE: 3, BLOCK_ON: 4, BLOCK_OFF: 5, ROLL: 6, THROW: 7, SPECIAL: 8 };
const GIFT = { HEALTH: 1, SPEAR: 2, BOMB: 3, FURY: 4, SPEED: 5, REGEN: 6, SHIELD: 7 };
/** What gifts are doing for a fighter (as `arena::buff`). */
const BUFF = { SPEED: 1, REGEN: 2, SHIELD: 4, SHIELD2: 8, HEAL: 16, POISON: 32 };
/** The scorpion's dart (as `arena::missile::DART`), and the slowness of its poison (`POISON_SLOW`). */
const DART = 7;
export const POISON_SLOW = 0.9;
/** How much faster Hermes' boots make you (as `arena::SPEED_GIFT_X`). */
export const SPEED_GIFT_X = 1.5;
const EV = { THIEF_OUT: 43, THIEF_GRAB: 44, THIEF_STING: 45, HIT: 1, PARRY: 2, GUARD_BREAK: 3, WALL_SLAM: 4, DOWN: 5, SWING: 6, ROLL: 7, GIFT_INCOMING: 8, PICKUP: 10, THROW: 11, BOOM: 12, SPIKED: 14, ROUND_START: 15, FIGHT: 16, ROUND_WON: 17, CHAMPION: 18, SPECIAL: 19, FIRE: 20, STUCK: 21, RAGE_FULL: 22, STOMP: 23, GRAB: 24, HURL: 25, SHIELD: 26, BOUNCE: 27, DISASTER_PICKED: 28, DISASTER: 29, METEOR_WARN: 30, METEOR: 31, LION_OUT: 32, LION_CROUCH: 33, LION_LEAP: 34, LION_LAND: 35, LION_HIT: 36, LION_DOWN: 37, POISONED: 38, SCORPION_WIND: 39, SCORPION_STING: 40, DART_HIT: 41, ACID_BURN: 42 };
/** How much each thing stirs the crowd (they cheer more, the more stirred, and it fades). */
const HYPE: Record<number, number> = { 1: 0.12, 2: 0.3, 3: 0.3, 4: 0.35, 5: 0.65, 12: 0.3, 14: 0.3, 16: 0.5, 17: 1, 18: 1, 19: 0.4, 27: 0.5, 29: 1, 31: 0.2, 32: 0.3, 35: 0.2, 37: 0.6 };
/** The pennants on the amphitheatre's masts. */
const PENNANTS = [0xb8322c, 0xd9a83a, 0x6a2a8a, 0xf2ead8];
const FLAG = { DOWN: 1, FURY: 2, KNOCKED: 4, IFRAMES: 8, QUEUED: 16, WINDED: 32, GIANT: 64, DAZED: 128 };
/**
 * Goliath mode (as `arena::mode`, GIANT_*, SMASH, STOMP, GRAB_*: arena.test.ts
 * checks they agree): one giant against the rest, drawn as its own brute (goliathart).
 */
export const MODE = { CLASSIC: 0, GOLIATH: 1, TEAMS: 2 };
export const GIANT_HP = 600;
export const GIANT_SPEED = 0.95;
export const GIANT_R = 0.63;
export const SMASH: [number, number, number] = [210, 110, 280];
/** Out of stamina, its smash is slower: the wind-up and recovery this many times as long (as `arena::TIRED_SMASH`). */
export const TIRED_SMASH = 1.8;
/** Its smash's reach (tiles) and how far either side of its aim it sweeps (as `arena::SMASH_*`): any way it aims, up and down too. */
export const SMASH_REACH = 4.3;
/** What a slash and the Goliath's smash cost in stamina (as `arena::LIGHT_COST`, `SMASH_COST`). */
export const LIGHT_COST = 11;
export const SMASH_COST = 14;
export const SMASH_ARC = 0.9;
export const STOMP: [number, number, number] = [200, 520, 460];
export const GRAB_SPIN_MS = 3000;
/** How long the Goliath charges its stomp to leap its furthest (as `arena::GIANT_CHARGE_MS`). */
export const GIANT_CHARGE_MS = 1800;
/** Its stomp's leap (by the charge; never past the mouse), and the shockwave's reach (as `arena::STOMP_*`). */
export const STOMP_LEAP_MIN = 1.0;
export const STOMP_LEAP = 8.5;
export const STOMP_R = 2.3;
/** The hurl: as far as the mouse, no nearer than this, no further than a dash (as `arena::HURL_*`). */
export const HURL_MIN = 3.0;
export const HURL_DIST = 9.0;
/** The one the Goliath whirls, as drawn: held out at arm's length (tiles from its feet), up at its hands (px). */
const HOLD_R = 1.35;
const HOLD_LIFT = 56;
/** Its dash (Space), in place of a roll (as `arena::GIANT_DASH_*`). */
export const GIANT_DASH_MS = 380;
export const GIANT_DASH_DIST = 5.0;
export const GIANT_DASH_COST = 60;
/** A gladiator's health (as `arena::HP`). */
export const HP = 150;
const isGiant = (f: { flags: number }) => (f.flags & FLAG.GIANT) !== 0;
/** The fury: red, blinking hotter and cooler. */
const furyTint = (now: number) => (Math.floor(now / 130) % 2 ? 0xff4a4a : 0xffa0a0);
const GIFTS: Record<number, { icon: string; name: string }> = {
  [GIFT.HEALTH]: { icon: "🍗", name: "ROAST LEG +53" },
  [GIFT.SPEAR]: { icon: "🔱", name: "SPEAR" },
  [GIFT.BOMB]: { icon: "💣", name: "BOMB" },
  [GIFT.FURY]: { icon: "⛑️", name: "FURY!" },
  [GIFT.SPEED]: { icon: "🪽", name: "HERMES BOOTS!" },
  [GIFT.REGEN]: { icon: "🧪", name: "REGENERATION" },
  [GIFT.SHIELD]: { icon: "🛡️", name: "SHIELD!" },
};
/** Each place's colours: their ring, shield, bars and name. */
const COLORS = [0xffc83d, 0x3fa9ff, 0xff4f6a, 0x5fd07a];
const CSS = ["#ffc83d", "#3fa9ff", "#ff4f6a", "#5fd07a"];
/** Two against two: blue, and red. */
const TEAM_COLORS = [0x3fa9ff, 0xff4f6a];
const TEAM_CSS = ["#3fa9ff", "#ff4f6a"];
const BOT_NAMES = ["Maximus", "Brutalia", "Crixus", "Spartaka"];
/** The bots' looks: gladiators in red and gold, blue, crimson, green. */
const BOT_LOOKS = [0, 1, 2, 3].map((k) => encodeLook({ hue: [40, 210, 355, 120][k], skin: (k * 3 + 1) % 4, hair: (k * 5 + 3) % 8, hat: k % 2, hatHue: [40, 210, 0, 120][k], style: 0, accessory: 0, outfit: (k % 2) * 2 }));
/** Others are drawn this far behind the server's clock, to glide between its ticks. */
const RENDER_DELAY_MS = 150;
const MOVE_EVERY_MS = 50;
const STICK_R = 56;

type State = Extract<ServerMsg, { t: "ArenaState" }>;
type ArenaEv = Extract<ServerMsg, { t: "ArenaEvent" }>;
type F = State["fighters"][number];
export type ArenaSend =
  | { t: "ArenaJoin" }
  | { t: "ArenaLeave" }
  | { t: "ArenaStart"; bots: boolean }
  | { t: "ArenaBot"; slot: number; on: boolean }
  | { t: "ArenaLevel"; level: number }
  | { t: "ArenaMode"; mode: number; goliath: number }
  | { t: "ArenaBet"; pick: number }
  | { t: "ArenaSwitch"; slot: number }
  | { t: "ArenaKits"; on: boolean }
  | { t: "ArenaKit"; kit: number }
  | { t: "ArenaLobby" }
  | { t: "ArenaWheel"; on: boolean }
  | { t: "ArenaVote"; kind: number }
  | { t: "ArenaDisasters"; on: boolean }
  | { t: "ArenaMove"; x: number; y: number; aim: number; reach: number }
  | { t: "ArenaAct"; act: number; aim: number; reach: number };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The sand (as `arena::Ring`). */
class Ring {
  constructor(
    readonly w: number,
    readonly h: number,
    readonly pillars: Rect[],
    readonly spikes: Rect[],
    /** In an amphitheatre: the ellipse inside the rectangle. */
    readonly oval = false,
  ) {}

  free(x: number, y: number, r: number): boolean {
    if (x < r || y < r || x > this.w - r || y > this.h - r) return false;
    if (this.oval) {
      const cx = this.w / 2;
      const cy = this.h / 2;
      if ((Math.abs(x - cx) / (cx - r)) ** ROUNDNESS + (Math.abs(y - cy) / (cy - r)) ** ROUNDNESS > 1) return false;
    }
    return !this.pillars.some((p) => {
      const nx = Math.min(Math.max(x, p.x), p.x + p.w);
      const ny = Math.min(Math.max(y, p.y), p.y + p.h);
      return (x - nx) ** 2 + (y - ny) ** 2 < r * r;
    });
  }

  slide(x: number, y: number, dx: number, dy: number, r: number): [number, number, boolean] {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.12));
    const sx = dx / n;
    const sy = dy / n;
    let bumped = false;
    for (let i = 0; i < n; i++) {
      if (this.free(x + sx, y, r)) x += sx;
      else bumped = true;
      if (this.free(x, y + sy, r)) y += sy;
      else bumped = true;
    }
    return [x, y, bumped];
  }
}

/** Something thrown (as `arena::Missile`). */
interface Missile {
  by: number;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  left: number;
  range: number;
  born: number;
}

/** Slash `n` of a combo (wind-up, blow, recovery) at class `k`'s pace (as `Fighter::light`). */
const lightOf = (k: number, n: number): [number, number, number] => {
  if (shoots(k)) return STAB;
  const pace = (v: number) => Math.round(v * KIT_LIGHT_TIME[k] + 1e-9);
  const [w, a, r] = LIGHT[n];
  return [pace(Math.round(w * KIT_LIGHT_WINDUP[k] + 1e-9)), pace(a), pace(r)];
};

const turn = (a: number, b: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const toU16 = (a: number) => Math.round(((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * 65536) & 0xffff;
const fromU16 = (v: number) => (v / 65536) * Math.PI * 2;

// ---- sound -------------------------------------------------------------------

/** The arena's heard in full this near the sand (tiles), and not at all past `HEAR_TILES`. */
const HEAR_NEAR = 6;
const HEAR_TILES = 24;

const snd = {
  whoosh(vol: number) {
    sfx.burst(sfx.at(0), 0.18, 0.22 * vol, "bandpass", 500, 2200, 1.2);
  },
  thud(vol: number) {
    const t = sfx.at(0);
    sfx.tone(t, 0.18, 0.3 * vol, "sine", 120, 40);
    sfx.burst(t, 0.15, 0.3 * vol, "lowpass", 600, 150);
  },
  boom(vol: number) {
    const t = sfx.at(0);
    sfx.burst(t, 0.6, 0.6 * vol, "lowpass", 900, 60, 0.7);
    sfx.tone(t, 0.4, 0.35 * vol, "sine", 90, 30);
    sfx.burst(t + 0.02, 0.25, 0.2 * vol, "highpass", 2500);
  },
  spikes(vol: number) {
    // A hard steel snap up out of the floor, and a ring off it.
    const t = sfx.at(0);
    sfx.burst(t, 0.05, 0.24 * vol, "highpass", 3000);
    sfx.tone(t, 0.12, 0.07 * vol, "square", 1500, 520);
    sfx.burst(t + 0.2, 0.05, 0.1 * vol, "bandpass", 1800, 900);
  },
  /** A short blade, thrust: a thin, quick whip of air. */
  stab(vol: number) {
    sfx.burst(sfx.at(0), 0.07, 0.11 * vol, "bandpass", 2600, 5200, 1.6);
  },
  /** Out of breath: a soft, empty puff. */
  noWind() {
    sfx.burst(sfx.at(0), 0.14, 0.09, "lowpass", 700, 260);
  },
  pickup() {
    const t = sfx.at(0);
    for (const [k, hz] of [[0, 523], [1, 784], [2, 1047]]) sfx.tone(t + k * 0.06, 0.15, 0.1, "triangle", hz);
  },
  gong() {
    const t = sfx.at(0);
    sfx.tone(t, 1.4, 0.18, "sine", 110);
    sfx.tone(t, 1.1, 0.1, "sine", 263);
    sfx.tone(t, 0.8, 0.06, "sine", 431);
  },
  horn() {
    const t = sfx.at(0);
    sfx.tone(t, 0.5, 0.14, "sawtooth", 196, 220);
    sfx.tone(t + 0.1, 0.6, 0.1, "sawtooth", 294, 330);
  },
  beep() {
    sfx.tone(sfx.at(0), 0.12, 0.12, "square", 440);
  },
  whistle() {
    sfx.tone(sfx.at(0), 0.7, 0.06, "sine", 1800, 500);
  },
  /** The buccinae: a brassy call, two horns a fifth apart over a low one. */
  trumpets(vol = 1) {
    const t = sfx.at(0);
    const call: [number, number, number][] = [[0, 0.11, 392], [0.13, 0.11, 392], [0.26, 0.11, 392], [0.39, 0.42, 523], [0.86, 0.16, 466], [1.05, 0.16, 523], [1.24, 0.9, 659]];
    for (const [d, len, hz] of call) {
      sfx.tone(t + d, len, 0.08 * vol, "sawtooth", hz);
      sfx.tone(t + d, len, 0.045 * vol, "square", hz * 1.5);
      sfx.tone(t + d, len, 0.04 * vol, "sawtooth", hz / 2);
    }
  },
  /** The stands clapping: a patter of claps, many hands. */
  claps(vol = 1) {
    const t = sfx.at(0);
    for (let k = 0; k < 14; k++) sfx.burst(t + k * 0.07 + Math.random() * 0.05, 0.03, (0.05 + Math.random() * 0.05) * vol, "bandpass", 1400 + Math.random() * 1600, undefined, 1.5);
  },
  /** The portcullis winched up: a grinding rumble, a clank. */
  winch() {
    const t = sfx.at(0);
    sfx.burst(t, 0.9, 0.16, "lowpass", 300, 120, 2);
    sfx.tone(t + 0.85, 0.12, 0.12, "square", 140, 90);
  },
  fanfare(win: boolean) {
    const t = sfx.at(0);
    const notes = win ? [523, 659, 784, 1047, 1319] : [392, 349, 330, 262];
    notes.forEach((hz, k) => sfx.tone(t + k * 0.13, k === notes.length - 1 ? 0.7 : 0.16, 0.12, "square", hz));
    sfx.crowdRoar(win ? 1 : 0.5);
  },
};

// ---- pixel words and things -------------------------------------------------

const words = new Map<string, Texture>();
function word(text: string, color: string): Texture {
  const key = `${color}|${text}`;
  let t = words.get(key);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = pixelWidth(text) + 2;
    c.height = 7;
    const ctx = c.getContext("2d")!;
    for (const [ox, oy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]]) drawPixelText(ctx, text, ox, oy, "#1a1020");
    drawPixelText(ctx, text, 1, 1, color);
    t = toTexture(c);
    words.set(key, t);
  }
  return t;
}

/** The gifts as little pictures: a roast leg, a spear, a bomb, a helmet, winged boots, a purple potion, a round shield. */
const giftTex = new Map<number, Texture>();
export function giftTexture(kind: number): Texture {
  let t = giftTex.get(kind);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const ctx = c.getContext("2d")!;
    const px = (col: string, x: number, y: number, w = 1, h = 1) => {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
    };
    const O = "#2b2233";
    if (kind === GIFT.HEALTH) {
      px(O, 3, 3, 9, 8);
      px("#c8742f", 4, 4, 7, 6);
      px("#e3964a", 5, 4, 4, 2);
      px(O, 10, 9, 4, 4);
      px("#f4ecd8", 11, 10, 2, 2);
      px("#ffffff", 12, 10, 2, 1);
    } else if (kind === GIFT.SPEAR) {
      for (let k = 0; k < 11; k++) px("#8f6236", 2 + k, 13 - k, 2, 2);
      px(O, 11, 1, 4, 5);
      px("#c9d2dc", 12, 2, 2, 3);
      px("#ffffff", 12, 2, 1, 1);
    } else if (kind === GIFT.BOMB) {
      px(O, 3, 5, 10, 10);
      px("#2f2c38", 4, 6, 8, 8);
      px("#5a566a", 5, 7, 3, 2);
      px("#8f6236", 9, 2, 2, 4);
      px("#ffd23f", 10, 1, 2, 2);
      px("#ff6a3f", 11, 0, 1, 1);
    } else if (kind === GIFT.SPEED) {
      // A golden boot with a white wing at its heel.
      px(O, 7, 3, 6, 9);
      px(O, 7, 10, 9, 4);
      px("#e8b84a", 8, 4, 4, 7);
      px("#e8b84a", 8, 11, 7, 2);
      px("#fff1b0", 8, 4, 2, 3);
      px("#a8761e", 8, 12, 7, 1);
      px(O, 1, 3, 6, 2);
      px(O, 0, 5, 7, 2);
      px(O, 1, 7, 6, 2);
      px(O, 3, 9, 4, 1);
      px("#ffffff", 2, 4, 5, 1);
      px("#ffffff", 1, 5, 6, 1);
      px("#d8e8ff", 2, 6, 5, 1);
      px("#ffffff", 2, 7, 5, 1);
      px("#d8e8ff", 4, 8, 3, 1);
    } else if (kind === GIFT.REGEN) {
      // A round purple potion: a cork, a glass neck, a glowing brew.
      px(O, 6, 0, 4, 3);
      px("#b98a5a", 7, 1, 2, 1);
      px(O, 6, 3, 4, 3);
      px("#d8e8f0", 7, 3, 2, 3);
      px(O, 3, 6, 10, 9);
      px(O, 2, 7, 12, 7);
      px("#9a3fe0", 3, 7, 10, 7);
      px("#9a3fe0", 4, 6, 8, 9);
      px("#c77dff", 4, 8, 8, 2);
      px("#6a24c0", 4, 12, 8, 2);
      px("#ffffff", 4, 7, 2, 2);
      px("#e8c8ff", 9, 11, 2, 1);
    } else if (kind === GIFT.SHIELD) {
      // A round blue shield: a steel rim, a gold boss, a shine.
      px(O, 4, 1, 8, 14);
      px(O, 1, 4, 14, 8);
      px(O, 2, 2, 12, 12);
      px("#c9d2dc", 3, 2, 10, 12);
      px("#c9d2dc", 2, 3, 12, 10);
      px("#3f7fd0", 3, 3, 10, 10);
      px("#6fb4ff", 4, 3, 4, 3);
      px("#2a5aa0", 9, 10, 4, 3);
      px(O, 6, 6, 4, 4);
      px("#ffd23f", 7, 7, 2, 2);
      px("#ffffff", 4, 4, 2, 1);
    } else {
      px(O, 2, 3, 12, 10);
      px("#d9a915", 3, 4, 10, 7);
      px("#ffe07a", 4, 4, 5, 2);
      px(O, 5, 8, 6, 2);
      px("#b8323a", 6, 0, 4, 4);
      px("#ff4f6a", 7, 0, 2, 3);
    }
    t = toTexture(c);
    giftTex.set(kind, t);
  }
  return t;
}

function botInfo(id: number, at: { x: number; y: number }): EntityInfo {
  const k = (id - BOT_BASE) % SLOTS;
  return { id, name: `${BOT_NAMES[k]} 🤖`, look: BOT_LOOKS[k], style: 0, pet: 0, vehicle: 0, tool: 0, x: Math.round(at.x), y: Math.round(at.y), state: 0, speedX10: 0, t0: 0, sprintIn: 0, path: [], mood: 0, away: false, reading: 0, calling: false };
}

/** A brazier's fire on a pillar: where (world px), its glows. */
interface Fire {
  x: number;
  y: number;
  glow: Sprite;
  night: Sprite | null;
  phase: number;
  /** How big it burns: 1 a brazier, less a torch or a candle. */
  s: number;
  /** Its flames, drawn each frame (world px). */
  g: Graphics;
}

/** A tongue of flame, a spark or a wisp of smoke off a brazier (world px). */
interface Flame {
  fire: Fire;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  kind: 0 | 1 | 2;
  size: number;
}

/** A soft round glow, warm orange at its heart, fading to nothing. */
let fireGlowTex: Texture | null = null;
function fireGlow(): Texture {
  if (!fireGlowTex) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,200,120,0.9)");
    g.addColorStop(0.35, "rgba(255,120,50,0.45)");
    g.addColorStop(1, "rgba(220,50,20,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    fireGlowTex = toTexture(c);
    fireGlowTex.source.scaleMode = "linear";
  }
  return fireGlowTex;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  life: number;
  color: number;
  size: number;
}

interface Floater {
  sprite: Sprite;
  x: number;
  y: number;
  at: number;
  life: number;
  /** Its size, settled (those without pop in at the size they are). */
  size?: number;
}

/** A rose petal: fluttering down (z in tiles), or lying where it fell (landed, wall ms). */
interface Petal {
  x: number;
  y: number;
  z: number;
  vz: number;
  ph: number;
  sw: number;
  color: number;
  shape: number;
  landed: number;
}

/** Where one of them is in the parade, and how they carry themselves. */
interface Marching {
  x: number;
  y: number;
  face: 1 | -1;
  frame: AvatarFrame | null;
  walking: boolean;
  lean: number;
  lift: number;
  champ: boolean;
  /** The champion's sword thrust up. */
  raise: boolean;
}

interface Stick {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
}

/** A pose for the avatar this frame. */
interface Pose {
  frame: AvatarFrame | null;
  lean: number;
  lift: number;
  hurt: boolean;
}

export class ArenaShow {
  private ring: Ring;
  /** The sand's corner (map tiles), and the walled ring round it. */
  private ox: number;
  private oy: number;
  private arenaObj: MapObject;
  private state: State | null = null;
  private snaps: { t: number; ps: Map<number, { x: number; y: number; aim: number }> }[] = [];
  /** Us, run ahead of the server. */
  private me = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aim: 0,
    fix: -1,
    known: false,
    sentAt: 0,
    sent: { x: -1, y: -1, aim: -1, reach: -1 },
    rollUntil: 0,
    /** A roll asked for that couldn't go yet (server time). */
    rollWanted: 0,
    rollDir: 0,
    rollReady: 0,
    lungeFrom: 0,
    lungeUntil: 0,
    lungeDir: 0,
    lungeDist: 0,
    /** A heavy blow let go (server time), and how charged: its lunge waits on the server's word if we couldn't be sure. */
    releaseAt: 0,
    releaseCharge: -1,
    kvx: 0,
    kvy: 0,
    knockUntil: 0,
    pressAt: 0,
    charging: false,
    blocking: false,
    /** A slash pressed, not yet seen back from the server (drawn at once). */
    swingAt: 0,
  };
  private bots = new Map<number, Avatar>();
  private gear = new Map<number, Graphics>();
  /** The Goliath's dash: its afterimages, where it's been a moment, when it last dashed. */
  private ghosts = new Map<number, Graphics[]>();
  private giantPath = new Map<number, { x: number; y: number; t: number }[]>();
  private dashSeen = new Map<number, number>();
  private posed = new Set<number>();
  private missiles: Missile[] = [];
  private stuck: { x: number; y: number; aim: number; until: number; arrow?: boolean }[] = [];
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private rings: { x: number; y: number; color: number; at: number; r: number }[] = [];
  /** Hit-stop: these fighters held still till then. */
  private stopUntil = 0;
  private stopIds = new Set<number>();
  private spikeUpAt: number[] = [];
  private lastSpikes: number[] = [];
  private spikeDownAt: number[] = [];
  private fx = new Graphics();
  private fires: Fire[] = [];
  /** Caesar's head (world px) and the tile in front of his dais. */
  private caesarAt: { x: number; y: number; tx: number; ty: number } | null = null;
  private prompt = new Sprite(word("CLICK CAESAR TO FIGHT!", "#ffe14f"));
  private promptArrow = new Graphics();
  private nextHail = 0;
  /** The amphitheatre's crowd (if the map has one): a spectator for each of their seats, and how stirred they are. */
  private crowd: { x: number; y: number; ground: number; th: number; look: number; seed: number; face: 1 | -1; sprite: Sprite | null }[] = [];
  /** The masts round the rim (world px, their feet), and their pennants, flying. */
  private masts: [number, number][] = [];
  private pennants = new Graphics();
  private nextCrowd = 0;
  private hype = 0;
  /** The amphitheatre, and watching from its stands: the 🔭 button, and where the camera's gliding. */
  private bowlObj: MapObject | undefined;
  private watching = false;
  private watchCam = { x: 0, y: 0 };
  /** Whom we're watching: 0 the middle of the sand, else a fighter. */
  private watchWho = 0;
  private watchBar = el("div", "ar-watchbar");
  private watchBtn!: HTMLButtonElement;
  private watchPick = el("div", "ar-watchpick");
  private watchName = el("span", "ar-watchname");
  private watchKey = "";
  /** The gladiators' gates (world px, the art's top-left): how open their doors are (0 shut, 1 open). */
  private gates: { x: number; y: number; w: number; east: boolean; g: Graphics }[] = [];
  private gatesOpen = 0;
  private flames: Flame[] = [];
  /** Whether any fire was drawn last frame (they're skipped off screen). */
  private firesShown = true;
  /** The torches' stands by Caesar's dais. */
  private torchStands: Sprite[] = [];
  private floor = new Graphics();
  private spikesG = new Graphics();
  private top = new Container();
  private giftSprites = new Map<string, Sprite>();
  private lastFrame = performance.now();
  // Input.
  private keys = new Set<string>();
  private mouse: { sx: number; sy: number } | null = null;
  private touchMode = false;
  /** Goliaths swinging a tired smash (out of stamina: slower) right now. */
  private tiredSmash = new Set<number>();
  private stick: Stick | null = null;
  private stickEl = el("div", "pb-stick move");
  // Feel.
  private shake = 0;
  private camLead = { x: 0, y: 0 };
  private lastCount = -1;
  // The HUD.
  private hud = el("div", "ar-hud");
  private crownsEl = el("div", "ar-crowns");
  private center = el("div", "pb-center ar-center");
  private feed = el("div", "pb-feed ar-feed");
  private selfEl = el("div", "ar-self");
  private windToldAt = 0;
  private hint = el("div", "ar-hint");
  private touchPad = el("div", "ar-touch");
  private btns: Record<string, HTMLButtonElement> = {};
  private vignette = el("div", "pb-vignette");
  private lobby = el("div", "ar-lobby");
  /** With classes on: the pick at each round's start. */
  private kitPicker = new KitPicker((k) => this.send({ t: "ArenaKit", kit: k }));
  private classWheel = new ClassWheel();
  /** The round's disaster (its vote, its wheel, its meteors and lions). */
  private disaster: DisasterShow;
  /** The lava, and when it was last drawn. */
  private lavaG = new Graphics();
  private lavaAt = 0;
  private results = el("div", "pb-results");
  private lobbyOpen = false;
  private yieldBtn!: HTMLButtonElement;
  private lobbyKey = "";
  private shownResults = false;
  /** The champion's parade: when OVER began (server ms), where each started, the losers in line, what's been cued. */
  private parade: { start: number; from: Map<number, { x: number; y: number; face: 1 | -1 }>; order: number[]; cues: Set<string>; acc: number; nextClap: number } | null = null;
  private petals: Petal[] = [];
  private petalsG = new Graphics();
  /** Those lying out on the carpet (over it: it is a flat object of its own). */
  private petalsOutG = new Graphics();
  private carpetY = Infinity;
  /** What's shining after dark, this frame. */
  private glows: NightGlows;
  /** All the sand and sparks. */
  private juice: Juice;
  private bets: BetPanel;
  /** How far each fighter's gone since their last footfall, and where they were. */
  private strides = new Map<number, { x: number; y: number; d: number; at: number; full: boolean }>();

  constructor(
    private scene: Scene,
    /** The map: its objects (the ring, pillars, spikes, Caesar's dais), and its tiles (the stands' seats). */
    map: { objects: MapObject[]; width?: number; decor?: number[]; decor_legend?: string[] },
    private labels: HTMLElement,
    private canvas: HTMLCanvasElement,
    private selfId: () => number,
    private avatarOf: (id: number) => Avatar | undefined,
    private nameOf: (id: number) => string,
    private serverNow: () => number,
    private send: (m: ArenaSend) => void,
    /** A warm light that shows after dark (the night's lights), at world (x, y). */
    nightGlow: (x: number, y: number) => Sprite | null = () => null,
    /** Everyone about (the crowd makes room for whoever's sat in the stands). */
    private people: () => Iterable<{ pos: { x: number; y: number }; state: number }> = () => [],
  ) {
    const a = map.objects.find((o) => o.kind === "arena")!;
    this.arenaObj = a;
    this.ox = a.x + 1;
    this.oy = a.y + 1;
    const rect = (o: MapObject): Rect => ({ x: o.x - this.ox, y: o.y - this.oy, w: o.w, h: o.h });
    this.ring = new Ring(
      a.w - 2,
      a.h - 2,
      // (A pillar's a tile thick, in the middle of its place, as `arena::Ring::from_map`.)
      map.objects.filter((o) => o.kind === "arena_pillar").map(rect).map((r) => (r.w > 1 ? { ...r, x: r.x + (r.w - 1) / 2, w: 1 } : r)),
      map.objects.filter((o) => o.kind === "arena_spikes").map(rect),
      map.objects.some((o) => o.kind === "arena_bowl"),
    );
    this.glows = new NightGlows(nightGlow);
    this.juice = new Juice((x) => this.wx(x), (y) => this.wy(y), TILE, this.scene.sorted);
    this.bets = new BetPanel({
      bet: (pick) => this.send({ t: "ArenaBet", pick }),
      name: (slot) => {
        const id = this.state?.slots[slot] ?? 0;
        return id ? this.who(id) : "";
      },
      css: (slot) => this.cssOf(slot),
    });
    this.disaster = new DisasterShow({
      wx: (x) => this.wx(x),
      wy: (y) => this.wy(y),
      tile: TILE,
      sorted: this.scene.sorted,
      canVote: () => {
        const p = this.mine();
        return (!p || (p.flags & FLAG.DOWN) !== 0) && (this.watching || this.capturing || this.hearing() > 0.5);
      },
      inSight: () => this.watching || this.capturing || this.hearing() > 0,
      lavaClose: (lava) => {
        const p = this.mine();
        if (!p || p.flags & FLAG.DOWN) return false;
        const e = this.ring.oval ? ROUNDNESS : 2;
        const [cx, cy] = [this.ring.w / 2, this.ring.h / 2];
        const out = (Math.abs(this.me.x / cx - 1) ** e + Math.abs(this.me.y / cy - 1) ** e) ** (1 / e);
        return out > lava - 0.09;
      },
      mid: { x: this.ring.w / 2, y: this.ring.h / 2 },
      floorZ: this.oy * TILE + 2,
      vote: (kind) => this.send({ t: "ArenaVote", kind }),
      near: (x, y) => this.near(x, y),
      dust: (x, y, n) => this.dust(x, y, n),
      shake: (k) => {
        if (this.capturing || this.watching) this.shake = Math.max(this.shake, k);
      },
      ring: (x, y, color, r) => this.ringFx(x, y, color, r),
      glow: (x, y) => nightGlow(x, y),
      giftTex: (kind) => giftTexture(kind),
      tilted: () => this.scene.tilted,
      layOnGround: (s) => this.scene.layOnGround(s),
      light: (x, y, tint, sx, sy, alpha) => this.glows.add(x, y, tint, sx, sy, alpha),
    });
    // On the sand: the fire's glow and the spikes over the floor, under the fighters; effects over all.
    this.floor.zIndex = this.oy * TILE + 2;
    this.lavaG.zIndex = this.floor.zIndex - 0.5;
    this.scene.lieFlat(this.lavaG);
    this.scene.sorted.addChild(this.lavaG);
    this.scene.sorted.addChild(this.floor);
    this.top.zIndex = 1e9;
    this.top.addChild(this.fx);
    // (Bombs, arrows, meteors: they have to line up with the sand under them, however far off.)
    this.scene.lieFlat(this.fx, true);
    this.scene.world.addChild(this.top);
    this.scene.layer3d(this.top, false, true);
    // The braziers on the pillars: their fire (live), their glow by day and their light by night.
    for (const o of map.objects.filter((q) => q.kind === "arena_pillar")) {
      const x = o.x * TILE + (o.w * TILE) / 2;
      const y = o.y * TILE - PILLAR_OVERHANG + PILLAR_FIRE_Y;
      const glow = new Sprite(fireGlow());
      glow.anchor.set(0.5);
      glow.blendMode = "add";
      glow.position.set(x, y - 6);
      this.top.addChildAt(glow, 0);
      // (Small pillars, small fires.)
      const night = nightGlow(x, y + 6);
      night?.scale.set(0.6);
      this.addFire(x, y, glow, night, 0.55, (o.y + o.h) * TILE);
    }
    // The grand entrance's braziers.
    const gateObj = map.objects.find((q) => q.kind === "arena_gate");
    if (gateObj) {
      for (const [fx, fy] of GATE_FIRES) {
        const x = gateObj.x * TILE + fx;
        const y = gateObj.y * TILE - GATE_OVERHANG + fy;
        const glow = new Sprite(fireGlow());
        glow.anchor.set(0.5);
        glow.blendMode = "add";
        glow.position.set(x, y - 6);
        this.top.addChildAt(glow, 0);
        this.addFire(x, y, glow, nightGlow(x, y + 10), 1, (gateObj.y + gateObj.h) * TILE);
      }
    }
    // The amphitheatre: its crowd, a spectator to each of the stands' seats
    // as they're painted (bar the cushioned ones, for people), drawn as they
    // come in; the pennants on its masts.
    this.bowlObj = map.objects.find((q) => q.kind === "arena_bowl");
    const bowl = this.bowlObj;
    if (bowl) {
      const bx = bowl.x * TILE;
      const by = bowl.y * TILE;
      const h = (n: number, k: number) => {
        const v = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453;
        return v - Math.floor(v);
      };
      bowlSeats(bowl.w, bowl.h).forEach((s, i) => {
        if (s.open) return;
        this.crowd.push({ x: bx + s.x, y: by + s.y, ground: by + s.ground, th: s.th, look: Math.floor(h(i, 1) * 64), seed: h(i, 2), face: h(i, 3) < 0.5 ? 1 : -1, sprite: null });
      });
      this.masts = bowlMasts(bowl.w, bowl.h).map(([x, y]) => [bx + x, by - BOWL_OVERHANG + y]);
      this.pennants.zIndex = by + 2;
      this.scene.sorted.addChild(this.pennants);
      this.scene.lieFlat(this.pennants);
    }
    // The gladiators' gates: their torches, their iron doors.
    for (const sg of map.objects.filter((q) => q.kind === "arena_gate_w" || q.kind === "arena_gate_e")) {
      const east = sg.kind === "arena_gate_e";
      const doors = new Graphics();
      doors.zIndex = (sg.y + sg.h) * TILE + 1;
      this.scene.sorted.addChild(doors);
      this.scene.lieFlat(doors);
      this.gates.push({ x: sg.x * TILE, y: sg.y * TILE - SIDE_GATE_OVERHANG, w: sg.w * TILE, east, g: doors });
      for (const [fx, fy] of SIDE_GATE_FIRES) {
        const x = sg.x * TILE + (east ? sg.w * TILE - fx : fx);
        const y = sg.y * TILE - SIDE_GATE_OVERHANG + fy - 4;
        const glow = new Sprite(fireGlow());
        glow.anchor.set(0.5);
        glow.blendMode = "add";
        glow.position.set(x, y - 6);
        this.top.addChildAt(glow, 0);
        // (These gates lie flat in 3D, so the fire stands right where it burns.)
        this.addFire(x, y, glow, nightGlow(x, y + 10), 1, y, (sg.y + sg.h) * TILE + 2);
      }
    }
    // Caesar, on his dais: where his head is (for the prompt over him, and his words).
    const court = map.objects.find((q) => q.kind === "arena_court");
    if (court) {
      this.caesarAt = { x: court.x * TILE + COURT_CAESAR[0], y: court.y * TILE - COURT_OVERHANG + COURT_CAESAR[1], tx: court.x + court.w / 2, ty: court.y + court.h };
      this.prompt.anchor.set(0.5, 1);
      this.prompt.scale.set(1.4);
      this.top.addChild(this.prompt, this.promptArrow);
      this.scene.standOn(this.prompt, (court.y + court.h) * TILE);
      this.scene.standOn(this.promptArrow, (court.y + court.h) * TILE);
      // A torch on its stand either side of the dais's foot, and the
      // candles either side of Caesar: their fires live, small.
      const flame = (x: number, y: number, s: number, at: number) => {
        const glow = new Sprite(fireGlow());
        glow.anchor.set(0.5);
        glow.blendMode = "add";
        glow.position.set(x, y - 6 * s);
        this.top.addChildAt(glow, 0);
        const night = nightGlow(x, y + 10 * s);
        night?.scale.set(s);
        this.addFire(x, y, glow, night, s, at);
      };
      const foot = (court.y + court.h) * TILE + COURT_TORCH_DOWN;
      for (const x of [court.x * TILE - COURT_TORCH_OUT, (court.x + court.w) * TILE + COURT_TORCH_OUT]) {
        const stand = new Sprite(toTexture(torchStand()));
        stand.anchor.set(0.5, 1);
        stand.position.set(x, foot + 4);
        stand.zIndex = foot;
        this.scene.sorted.addChild(stand);
        this.torchStands.push(stand);
        flame(x, foot - TORCH_HEIGHT + 2, 0.5, foot);
      }
      for (const [cx, up] of COURT_CANDLES) flame(court.x * TILE + cx, (court.y + court.h) * TILE - up, 0.2, (court.y + court.h) * TILE);
    }
    // Petals lying on the sand and the carpet: over the floor, under the people.
    this.petalsG.zIndex = this.oy * TILE + 3;
    const carpet = map.objects.find((q) => q.kind === "arena_carpet");
    this.carpetY = carpet ? carpet.y - this.oy - 0.5 : Infinity;
    this.petalsOutG.zIndex = carpet ? carpet.y * TILE + 2 : this.petalsG.zIndex;
    this.scene.sorted.addChild(this.petalsG, this.petalsOutG);
    // In the 3D view these lie on the sand in perspective (they're drawn in world coordinates).
    for (const g of [this.floor, this.petalsG, this.petalsOutG]) this.scene.lieFlat(g);
    this.buildHud();
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onBlur);
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("contextmenu", this.onContext);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
  }

  // ---- who's who ---------------------------------------------------------------

  /** Whether we're fighting on the sand now (our input goes to the fight). */
  get capturing(): boolean {
    const s = this.state;
    return !!s && (s.status === COUNTDOWN || s.status === FIGHTING || s.status === ROUND_END || s.status === OVER) && s.fighters.some((f) => f.id === this.selfId());
  }

  /** Ids on the sand (they don't walk about). */
  get players(): number[] {
    const s = this.state;
    return s && s.status !== LOBBY ? s.fighters.map((f) => f.id) : [];
  }

  private mine(): F | undefined {
    return this.state?.fighters.find((f) => f.id === this.selfId());
  }

  /** Their colour: their own, or in two against two, their team's. */
  private colorOf(slot: number): number {
    return this.state?.mode === MODE.TEAMS ? TEAM_COLORS[slot < 2 ? 0 : 1] : COLORS[slot];
  }

  private cssOf(slot: number): string {
    return this.state?.mode === MODE.TEAMS ? TEAM_CSS[slot < 2 ? 0 : 1] : CSS[slot];
  }

  private slotOf(id: number): number {
    return Math.max(0, this.state?.slots.indexOf(id) ?? 0);
  }

  private who(id: number): string {
    if (id === this.selfId()) return "You";
    if (id >= BOT_BASE && id < BOT_BASE + SLOTS) return BOT_NAMES[(id - BOT_BASE) % SLOTS];
    return this.nameOf(id);
  }

  private wx(x: number) {
    return (this.ox + x) * TILE;
  }
  private wy(y: number) {
    return (this.oy + y) * TILE;
  }

  /** Avatar tile coordinates (fractional) for arena point (x, y): its feet on the point. */
  private toTile(x: number, y: number) {
    return { x: this.ox + x - 0.5, y: this.oy + y - 1 + 4 / TILE };
  }

  private aimPoint(): { x: number; y: number } | null {
    if (!this.mouse) return null;
    const w = this.scene.screenToWorld(this.mouse.sx, this.mouse.sy);
    return { x: w.x / TILE - this.ox, y: w.y / TILE - this.oy };
  }

  /** Where the camera looks: a little toward the aim, shaking on big blows. */
  camera(pos: { x: number; y: number }): { x: number; y: number } {
    // Watching from the stands: gliding over to the fight.
    if (this.watching) {
      const f = this.watchFocus();
      this.watchCam.x += (f.x - this.watchCam.x) * 0.08;
      this.watchCam.y += (f.y - this.watchCam.y) * 0.08;
      if (this.shake <= 0) return this.watchCam;
      const w = performance.now();
      return { x: this.watchCam.x + (Math.sin(w / 29) + Math.sin(w / 17.3)) * 0.2 * this.shake, y: this.watchCam.y + (Math.sin(w / 23) + Math.sin(w / 13.7)) * 0.2 * this.shake };
    }
    if (!this.capturing) return pos;
    // In the parade: just ahead of us, the way we're walking.
    if (this.state?.status === OVER) return { x: pos.x, y: pos.y + 1 };
    const t = performance.now();
    const sx = this.shake > 0 ? (Math.sin(t / 29) + Math.sin(t / 17.3)) * 0.27 * this.shake : 0;
    const sy = this.shake > 0 ? (Math.sin(t / 23) + Math.sin(t / 13.7)) * 0.27 * this.shake : 0;
    return { x: pos.x + this.camLead.x + sx, y: pos.y + this.camLead.y + sy };
  }

  // ---- input -------------------------------------------------------------------

  private act(what: number, aim = this.me.aim) {
    this.send({ t: "ArenaAct", act: what, aim: toU16(aim), reach: Math.round(Math.min(600, this.mouseReach() ?? 0) * 100) });
  }

  /** How far off the mouse is from us (tiles; null on touch, or not yet moved): the Goliath leaps no further. */
  private mouseReach(): number | null {
    const p = this.touchMode ? null : this.aimPoint();
    return p ? Math.max(0.01, Math.hypot(p.x - this.me.x, p.y - this.me.y)) : null;
  }

  private onWatchKey = (e: KeyboardEvent) => {
    if (!this.watching || isTyping(e)) return;
    const dir = e.code === "ArrowLeft" || e.code === "KeyA" ? -1 : e.code === "ArrowRight" || e.code === "KeyD" ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.cycleWatch(dir);
  };

  /** The mouse's buttons held down (`PointerEvent.buttons`). */
  private buttons = 0;

  private onKey = (e: KeyboardEvent) => {
    if (!this.capturing || isTyping(e)) return;
    const code = e.code;
    const move = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code);
    if (!move && !["Space", "ShiftLeft", "ShiftRight", "KeyE", "KeyQ", "KeyF", "KeyJ", "KeyK", "KeyL"].includes(code)) return;
    e.preventDefault();
    e.stopPropagation();
    if (move) this.keys.add(code);
    if (e.repeat) return;
    if (code === "Space") this.roll();
    else if (code.startsWith("Shift") || code === "KeyL") this.block(true);
    else if (code === "KeyE") this.throwIt();
    else if (code === "KeyQ" || code === "KeyF") this.special();
    else if (code === "KeyJ") this.press();
    else if (code === "KeyK") this.press();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const had = this.keys.delete(e.code);
    if (!this.capturing) return;
    if (e.code.startsWith("Shift") || e.code === "KeyL") this.block(false);
    if (e.code === "KeyJ" || e.code === "KeyK") this.release();
    if (had) e.stopPropagation();
  };

  private onBlur = () => {
    this.keys.clear();
    this.stick = null;
    this.buttons = 0;
    if (this.me.blocking) this.block(false);
    if (this.me.pressAt) this.release();
  };

  private onContext = (e: Event) => {
    if (this.capturing) e.preventDefault();
  };

  private onDown = (e: PointerEvent) => {
    if (!this.capturing) return;
    if (e.pointerType === "touch") {
      e.preventDefault();
      this.setTouchMode(true);
      if (e.clientX < window.innerWidth / 2 && !this.stick) this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      return;
    }
    this.setTouchMode(false);
    this.mouse = { sx: e.clientX, sy: e.clientY };
    this.mouseButtons(e);
  };

  /**
   * The mouse's buttons, as they are now. (A browser only says `pointerdown`
   * for the first button of a chord and `pointerup` for the last: attacking
   * with block held, or letting go of one of two, comes as a mere move. So
   * it's `buttons` that's followed, not the events.)
   */
  private mouseButtons(e: PointerEvent) {
    const now = e.buttons & 3;
    const was = this.buttons;
    this.buttons = now;
    if (now & 1 && !(was & 1)) this.press();
    if (was & 1 && !(now & 1)) this.release();
    if (now & 2 && !(was & 2)) this.block(true);
    if (was & 2 && !(now & 2)) this.block(false);
  }

  private onMove = (e: PointerEvent) => {
    if (this.stick && this.stick.id === e.pointerId) {
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
      return;
    }
    if (e.pointerType !== "touch") {
      this.mouse = { sx: e.clientX, sy: e.clientY };
      if (this.buttons && this.capturing) this.mouseButtons(e);
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.stick && this.stick.id === e.pointerId) {
      this.stick = null;
      return;
    }
    if (e.pointerType === "touch") return;
    if (this.capturing) this.mouseButtons(e);
    else this.buttons = 0;
  };

  private setTouchMode(on: boolean) {
    if (on === this.touchMode) return;
    this.touchMode = on;
    document.body.classList.toggle("pb-touch-mode", on);
    if (!on) this.stick = null;
  }

  /** The attack button down: a slash on release, or held, a heavy blow charging. */
  private press() {
    if (this.me.pressAt) return;
    // Holding a spear or a bomb: the attack throws it.
    if (this.mine()?.holding) {
      this.throwIt();
      return;
    }
    // The Goliath whirling someone round: a click hurls them, there and then
    // (at the mouse), whenever in the whirl.
    const p = this.mine();
    if (p && isGiant(p) && p.act === ACT.GRAB) {
      this.act(INPUT.LIGHT);
      return;
    }
    this.me.pressAt = this.serverNow();
    this.me.charging = false;
  }

  private release() {
    const now = this.serverNow();
    if (!this.me.pressAt) return;
    const p = this.mine();
    if (this.me.charging) {
      this.act(INPUT.HEAVY_RELEASE);
      // The lunge (the Goliath's stomp: the server leaps it). Timed from when
      // the server has us charging, so we lunge exactly when it'll take it as
      // a heavy blow: at once if it's sure to, else when it says so (a lunge
      // it didn't agree to is what pulled us back).
      const s = this.state;
      const sure = !!p && !!s && p.act === ACT.CHARGE;
      const held = sure ? now - (s!.now - p!.actMs) : now - this.me.pressAt - HOLD_MS;
      this.me.releaseAt = now;
      this.me.releaseCharge = -1;
      if (p && !isGiant(p) && !shoots(kitOf(p)) && kitOf(p) !== KIT.TANK && held >= HEAVY_MIN_MS && p.stamina >= HEAVY_COST * 0.5 && !(p.flags & FLAG.WINDED)) {
        const charge = Math.min(1, (held - HEAVY_MIN_MS) / (fillMs(kitOf(p)) - HEAVY_MIN_MS));
        if (sure) this.lunge(now, charge);
        else this.me.releaseCharge = charge;
      }
    } else if (now - this.me.pressAt < HOLD_MS) {
      // (Held, with no wind for the charge: nothing at all, not a slash.)
      this.act(INPUT.LIGHT);
      // Shown at once only when the server's sure to take it (free, with the
      // wind for it); else it's kept for when we're free, and shows then (a
      // swing drawn and then dropped looked like it had been cut off).
      const giant = !!p && isGiant(p);
      const free = !!p && (p.act === ACT.NONE || p.act === ACT.BLOCK) && !(p.flags & (FLAG.KNOCKED | FLAG.DOWN));
      if (free && p!.stamina >= (giant ? SMASH_COST : shoots(kitOf(p!)) ? STAB_COST : LIGHT_COST) * 0.5) this.me.swingAt = now;
    }
    this.me.pressAt = 0;
    this.me.charging = false;
  }

  /** Whether we've the wind for our charged attack (as `Fighter::can_charge`, and a hair over: stamina reaches us rounded). */
  private canCharge(p: F): boolean {
    const k = kitOf(p);
    const cost = isGiant(p) ? STOMP_COST : KIT_COST[k] * (k === KIT.ARCHER ? BURST_MIN_COST : k === KIT.BOMBER ? BIG_BOMB_COST[0] : HEAVY_COST * KIT_HEAVY_COST[k]);
    return !(p.flags & FLAG.WINDED) && p.stamina >= cost * 0.5 + 1;
  }

  /** Our heavy blow's lunge, from `now` (server time), the further the more it was charged. */
  private lunge(now: number, charge: number) {
    this.me.lungeFrom = now + HEAVY[0];
    this.me.lungeUntil = now + HEAVY[0] + HEAVY[1];
    this.me.lungeDir = this.me.aim;
    const k = this.myKit();
    this.me.lungeDist = KIT_LUNGE[k] + (KIT_LUNGE_MAX[k] - KIT_LUNGE[k]) * charge;
    this.me.releaseCharge = -1;
  }

  /** Our class (the knight's, with classes off or as the Goliath). */
  private myKit(): number {
    const p = this.mine();
    return p && !isGiant(p) ? kitOf(p) : KIT.KNIGHT;
  }

  /** A fighter's health in full: their class's (with classes on), the Goliath's. */
  private maxHp(f: F): number {
    if (isGiant(f)) return GIANT_HP;
    return this.state?.kits ? KIT_HP[kitOf(f)] : HP;
  }

  private block(on: boolean) {
    if (on === this.me.blocking) return;
    this.me.blocking = on;
    this.act(on ? INPUT.BLOCK_ON : INPUT.BLOCK_OFF);
  }

  private roll() {
    const p = this.mine();
    if (!p || p.flags & FLAG.DOWN || this.state?.status !== FIGHTING) return;
    this.me.rollWanted = this.serverNow();
    this.tryRoll();
  }

  /** Whether a roll (the Goliath: a dash) would go right now: as `Fighter::can_roll`, and the wind for it. */
  private rollBlocked(p: F, now: number): "busy" | "wind" | null {
    const giant = isGiant(p);
    if (p.flags & FLAG.WINDED || p.stamina < (giant ? GIANT_DASH_COST : ROLL_COST * 0.5 * KIT_COST[kitOf(p)])) return "wind";
    if (now < this.me.rollReady || p.flags & (FLAG.KNOCKED | FLAG.DOWN)) return "busy";
    if (p.act === ACT.NONE || p.act === ACT.BLOCK || p.act === ACT.CHARGE) return giant && p.act === ACT.CHARGE ? "busy" : null;
    const s = this.state!;
    const since = p.actMs + Math.max(0, now - s.now);
    if (p.act >= ACT.LIGHT1 && p.act <= ACT.LIGHT3) {
      const [w, a] = lightOf(giant ? KIT.KNIGHT : kitOf(p), p.act - ACT.LIGHT1);
      return !giant && since >= w + a ? null : "busy";
    }
    return "busy";
  }

  /** A roll that's been asked for: now, if it can; else it's kept a moment (as the server keeps it). */
  private tryRoll() {
    const want = this.me.rollWanted;
    if (!want) return;
    const p = this.mine();
    const now = this.serverNow();
    if (!p || p.flags & FLAG.DOWN || this.state?.status !== FIGHTING) {
      this.me.rollWanted = 0;
      return;
    }
    const blocked = this.rollBlocked(p, now);
    if (blocked) {
      if (now > want + ROLL_BUFFER_MS) {
        this.me.rollWanted = 0;
        if (blocked === "wind") this.outOfWind();
      }
      return;
    }
    this.me.rollWanted = 0;
    const giant = isGiant(p);
    // (A charge, cut short.)
    this.me.pressAt = 0;
    this.me.charging = false;
    const d = this.moveDir();
    const dir = d.x || d.y ? Math.atan2(d.y, d.x) : this.me.aim + Math.PI;
    this.me.rollDir = dir;
    const ms = giant ? GIANT_DASH_MS : ROLL_MS;
    this.me.rollUntil = now + ms;
    this.me.rollReady = now + ms + ROLL_CD_MS;
    this.act(INPUT.ROLL, dir);
    snd.whoosh(giant ? 1 : 0.8);
    this.dust(this.me.x, this.me.y, giant ? 14 : 6);
    if (giant) this.shake = Math.max(this.shake, 0.12);
  }

  /** Wanted something there's no stamina for: says so, rather than nothing happening. */
  private outOfWind() {
    const now = wallNow();
    if (now < this.windToldAt + 500) return;
    this.windToldAt = now;
    snd.noWind();
    this.selfEl.classList.remove("nowind");
    void this.selfEl.offsetWidth;
    this.selfEl.classList.add("nowind");
  }

  private throwIt() {
    if (this.mine()?.holding) this.act(INPUT.THROW);
  }

  private special() {
    const p = this.mine();
    // (Busy rolling or reeling: the server keeps it for the moment we're free.)
    if (!p || p.rage < 100 || p.flags & FLAG.DOWN) return;
    this.act(INPUT.SPECIAL);
    this.me.pressAt = 0;
    this.me.charging = false;
  }

  /** Where the keys (or the stick) want us to go (the stick is analog), or zero. */
  private moveDir(): { x: number; y: number } {
    const st = this.stick;
    if (st) {
      const dx = (st.x - st.x0) / STICK_R;
      const dy = (st.y - st.y0) / STICK_R;
      const m = Math.min(1, Math.hypot(dx, dy));
      if (m >= 0.14) {
        const d = Math.hypot(dx, dy);
        const k = Math.max(0.45, m);
        return { x: (dx / d) * k, y: (dy / d) * k };
      }
    }
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    if (k.has("KeyW") || k.has("ArrowUp")) y -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) y += 1;
    const d = Math.hypot(x, y);
    return d > 0 ? { x: x / d, y: y / d } : { x: 0, y: 0 };
  }

  /** By touch: aim at whoever's nearest and standing (in reach of a throw), else the way we're going. */
  private autoAim(d: { x: number; y: number }): number {
    const s = this.state;
    const p = this.mine();
    if (s && p) {
      const at = this.serverNow() - RENDER_DELAY_MS;
      let best: { a: number; d: number } | null = null;
      for (const q of s.fighters) {
        if (q.id === p.id || q.flags & FLAG.DOWN) continue;
        const pos = this.glide(q.id, at);
        const dist = Math.hypot(pos.x - this.me.x, pos.y - this.me.y);
        const reach = p.holding ? 9 : 4.5;
        if (dist < reach && (!best || dist < best.d)) best = { a: Math.atan2(pos.y - this.me.y, pos.x - this.me.x), d: dist };
      }
      if (best) return best.a;
    }
    return d.x || d.y ? Math.atan2(d.y, d.x) : this.me.aim;
  }

  // ---- the lobby (at the sign by the gate) -------------------------------------------------

  /** The sign by the gate: the four places, join, fight. */
  openSign() {
    // (The bots' own match, if one's on, makes way.)
    if (this.state?.exhibition) this.send({ t: "ArenaLobby" });
    this.lobbyOpen = true;
    this.lobbyKey = "";
    this.renderLobby();
  }

  private renderLobby() {
    const s = this.state;
    const me = this.selfId();
    const show = this.lobbyOpen && !this.capturing && (!s || s.status !== OVER);
    this.lobby.hidden = !show;
    if (!show) return;
    const mine = s ? s.slots.indexOf(me) : -1;
    const key = s ? `${s.status}|${s.slots.join(",")}|${s.crowns.join(",")}|${mine}|${s.level}|${s.mode}|${s.goliath}|${s.kits}|${s.wheel}|${s.disasters}|${s.exhibition}` : "none";
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    this.lobby.replaceChildren();
    const head = el("div", "ar-lobby-head");
    const close = button("✕", () => {
      this.lobbyOpen = false;
      this.lobby.hidden = true;
    }, "subtle ar-close");
    head.append(el("strong", "", "🏛️ Caesar's Games"), close);
    const running = !!s && s.status !== LOBBY && !s.exhibition;
    const sub = el(
      "p",
      "ar-lobby-sub",
      running
        ? `"The games are on! Round ${s!.round}. Watch from the walls${mine < 0 ? ", or take a bot's place" : ""}."`
        : mine >= 0
          ? `"Choose who fights, gladiator: take out bots for a duel, or fill the sand for a brawl. Last one standing takes the crown; three crowns and you're my champion."`
          : `"Ave! Who will fight today? Take a place, and the sand is yours."`,
    );
    const places = el("div", "ar-places");
    const canEdit = !running && mine >= 0;
    for (let k = 0; k < SLOTS; k++) {
      const id = s?.slots[k] ?? 0;
      const bot = id >= BOT_BASE && id < BOT_BASE + SLOTS;
      const name = id === 0 ? "· empty ·" : bot ? `🤖 ${BOT_NAMES[k]} (bot)` : id === me ? `${this.nameOf(id)} (you)` : this.nameOf(id);
      const row = el("div", `ar-place${id === 0 ? " open" : ""}${id === me ? " me" : ""}${bot ? " bot" : ""}`);
      row.style.setProperty("--c", this.cssOf(k));
      row.append(el("span", "ar-dot"), el("span", "ar-place-name", name), el("span", "ar-place-crowns", running ? "♛".repeat(s!.crowns[k]) : ""));
      // Goliath mode: whose place is the Goliath's (and, in the lobby, a button to make it so).
      // Two against two: whose side, and a way to cross over.
      if (s && s.mode === MODE.TEAMS) {
        row.append(el("span", "ar-goliath-tag", k < 2 ? "🔵 BLUE" : "🔴 RED"));
        if (!running && mine >= 0 && k !== mine && (id === 0 || id >= BOT_BASE)) row.append(button("⇄", () => this.send({ t: "ArenaSwitch", slot: k }), "ar-bot-btn"));
      }
      if (s && s.mode === MODE.GOLIATH) {
        if (s.goliath === k) row.append(el("span", "ar-goliath-tag", "👹 GOLIATH"));
        else if (canEdit && id !== 0) row.append(button("👹", () => this.send({ t: "ArenaMode", mode: MODE.GOLIATH, goliath: k }), "subtle ar-bot-btn"));
      }
      // In the lobby, a bot can be taken out, or put in an empty place.
      if (canEdit && bot) row.append(button("✕ Remove", () => this.send({ t: "ArenaBot", slot: k, on: false }), "subtle ar-bot-btn"));
      if (canEdit && id === 0) row.append(button("🤖 + Add bot", () => this.send({ t: "ArenaBot", slot: k, on: true }), "subtle ar-bot-btn"));
      places.append(row);
    }
    // The match this makes.
    const fighters = s ? s.slots.filter((x) => x !== 0).length : 0;
    const people = s ? s.slots.filter((x) => x !== 0 && !(x >= BOT_BASE && x < BOT_BASE + SLOTS)).length : 0;
    const goliathMode = !!s && s.mode === MODE.GOLIATH;
    const giantHere = goliathMode && !!s && s.slots[s.goliath] !== 0;
    const mode = goliathMode
      ? !giantHere
        ? "👹 Put someone (or a bot) in the Goliath's place"
        : fighters <= 1
          ? "👹 Add gladiators (or bots) to face the Goliath"
          : `👹 The Goliath vs ${fighters - 1} gladiator${fighters - 1 === 1 ? "" : "s"}`
      : fighters <= 1
        ? "Add a bot (or wait for someone) to fight"
        : fighters === 2
          ? "⚔️ A duel: one on one"
          : fighters === 3
            ? "⚔️ A three-way fight"
            : "⚔️ A four-gladiator brawl";
    const bots = fighters - people;
    const modeEl = el("p", "ar-mode", running ? (bots > 0 ? `Bots: ${levelLabel(s!.level)}` : "") : `${mode}${fighters >= 2 ? ` · ${people} ${people === 1 ? "person" : "people"}, ${bots} ${bots === 1 ? "bot" : "bots"}` : ""}`);
    // How good the bots are: those with a place pick, in the lobby.
    const level = !running && s ? levelPicker(s.level, canEdit ? (l) => this.send({ t: "ArenaLevel", level: l }) : null, true) : null;
    const actions = el("div", "ar-lobby-actions");
    if (!running && mine >= 0) {
      const go = button("⚔️ FIGHT!", () => this.send({ t: "ArenaStart", bots: false }), "primary");
      go.disabled = fighters < 2 || (goliathMode && !giantHere) || (!!s && s.mode === MODE.TEAMS && (!(s.slots[0] || s.slots[1]) || !(s.slots[2] || s.slots[3])));
      actions.append(go);
      actions.append(button("Step out", () => this.send({ t: "ArenaLeave" }), "subtle"));
    } else if (!running) {
      actions.append(button("🛡 Take a place in the games", () => this.send({ t: "ArenaJoin" }), "primary"));
    } else if (mine < 0 && s!.slots.some((x) => x >= BOT_BASE && x < BOT_BASE + SLOTS)) {
      actions.append(button("⚔️ Jump in (take a bot's place)", () => this.send({ t: "ArenaJoin" }), "primary"));
    }
    const how = el(
      "p",
      "hint ar-how",
      this.touchMode || matchMedia("(pointer: coarse)").matches
        ? "Stick to move · ⚔ tap to slash, hold to charge (holding a spear or bomb: throws it) · 🛡 hold to block (just in time: parry!) · 💨 roll · 🌪 whirlwind"
        : "WASD move · mouse aim · click slash (keep clicking: combo) · hold click: heavy lunge · holding a spear or bomb, click throws it · right click/Shift block (just in time: PARRY; takes the worst of arrows and bombs, for stamina) · Space roll · Q whirlwind",
    );
    // The kind of match: everyone for themselves, or the Goliath against the rest.
    const kinds = el("div", "ar-kinds");
    if (!running && s) {
      for (const [m, label, tip] of [
        [MODE.CLASSIC, "⚔️ Free-for-all", "everyone for themselves"],
        [MODE.GOLIATH, "👹 Goliath", "one giant against the rest"],
        [MODE.TEAMS, "🤝 2v2", "two against two: friends can't hurt each other"],
      ] as [number, string, string][]) {
        const b = button(label, () => this.send({ t: "ArenaMode", mode: m, goliath: m === MODE.GOLIATH && s.slots[s.goliath] === 0 ? Math.max(0, s.slots.findIndex((x) => x !== 0)) : s.goliath }), `ar-kind${s.mode === m ? " on" : ""}`);
        b.title = tip;
        b.disabled = !canEdit;
        kinds.append(b);
      }
    }
    const goliathHow = goliathMode
      ? el("p", "hint ar-how", "👹 The Goliath: twice the size, far tougher, slower; can't roll. Click: a crushing SMASH. Hold & let go: a leaping STOMP that shakes all near it. Rage full (Q): GRAB the gladiator nearest your aim and whirl them into the others; click any time to HURL them at the mouse (or they're hurled when the whirl ends). Gladiators: one side, no harming each other; bring the giant down together.")
      : null;
    // Classes: off (all knights) or on (each picks one before every round), and a look at them.
    const kitsRow = el("div", "ar-kits-row");
    if (s) {
      const on = button(s.kits ? "🎭 Classes: ON" : "🎭 Classes: OFF", () => this.send({ t: "ArenaKits", on: !s.kits }), `ar-kind${s.kits ? " on" : ""}`);
      on.title = s.kits ? "Each gladiator picks a class before every round" : "Everyone fights as a knight";
      on.disabled = !canEdit;
      kitsRow.append(on);
      if (s.kits) {
        const wheel = button(s.wheel ? "🎡 Class Wheel: ON" : "🎡 Class Wheel: OFF", () => this.send({ t: "ArenaWheel", on: !s.wheel }), `ar-kind${s.wheel ? " on" : ""}`);
        wheel.title = s.wheel ? "A wheel spins before every round and picks everyone a new class" : "Everyone picks their own class";
        wheel.disabled = !canEdit;
        kitsRow.append(wheel);
      }
      kitsRow.append(button("👁 Preview classes", () => kitGallery(), "subtle"));
    }
    const disasterRow = el("div", "ar-kits-row");
    if (s) {
      const on = button(s.disasters ? "🌋 Disaster Wheel: ON" : "🌋 Disaster Wheel: OFF", () => this.send({ t: "ArenaDisasters", on: !s.disasters }), `ar-kind${s.disasters ? " on" : ""}`);
      on.title = s.disasters ? "A stone wheel turns mid-round and sets lava, meteors or lions on everyone" : "No disasters: only the fire closes in";
      on.disabled = !canEdit;
      disasterRow.append(on);
    }
    this.lobby.append(head, sub, kinds, places, modeEl, ...(level ? [level] : []), kitsRow, disasterRow, actions, how, ...(goliathHow ? [goliathHow] : []));
  }

  // ---- from the server -------------------------------------------------------------

  onState(s: State) {
    const before = this.state;
    if (before && before.status !== s.status) this.snaps = [];
    if (s.status === COUNTDOWN && before?.status !== COUNTDOWN) this.beginRound();
    if (s.status === OVER && before?.status !== OVER) this.shownResults = false;
    // The parade: from wherever they stood at the end, the losers in line (most crowns first).
    if (s.status === OVER && s.winner && !this.parade) {
      const from = new Map<number, { x: number; y: number; face: 1 | -1 }>();
      for (const f of s.fighters) {
        const at = f.id === this.selfId() && this.me.known ? this.me : { x: f.x / 100, y: f.y / 100 };
        from.set(f.id, { x: at.x, y: at.y, face: Math.cos(fromU16(f.aim)) >= 0 ? 1 : -1 });
      }
      const slot = (id: number) => Math.max(0, s.slots.indexOf(id));
      const order = s.fighters
        .map((f) => f.id)
        .filter((id) => id !== s.winner)
        .sort((a, b) => s.crowns[slot(b)] - s.crowns[slot(a)] || slot(a) - slot(b));
      this.parade = { start: s.now + s.phaseMs - OVER_MS, from, order, cues: new Set(), acc: 0, nextClap: 0 };
    }
    if (s.status !== OVER) this.parade = null;
    if (s.status === LOBBY && before && before.status !== LOBBY) this.clear();
    const ps = new Map<number, { x: number; y: number; aim: number }>();
    for (const f of s.fighters) ps.set(f.id, { x: f.x / 100, y: f.y / 100, aim: fromU16(f.aim) });
    this.snaps.push({ t: s.now, ps });
    if (this.snaps.length > 10) this.snaps.shift();
    this.state = s;
    // Ourselves: the server's word when it moved us (a new round, a refused
    // step), while we're knocked about or down; else we run ahead.
    const p = this.mine();
    if (p) {
      const sx = p.x / 100;
      const sy = p.y / 100;
      const now = this.serverNow();
      const far = Math.hypot(sx - this.me.x, sy - this.me.y);
      // (Mid-lunge or roll, and a moment after, we're well ahead of where the
      // server last heard we were: that's not a reason to pull us back.)
      const dashing = now < Math.max(this.me.lungeUntil, this.me.rollUntil) + 400;
      const slack = dashing ? 2.5 + Math.max(this.me.lungeDist, ROLL_DIST, GIANT_DASH_DIST) : 2.5;
      if (!this.me.known || p.fix !== this.me.fix || s.status !== FIGHTING || p.flags & FLAG.DOWN || far > slack || p.act === ACT.STOMP || p.act === ACT.HELD) {
        this.me.x = sx;
        this.me.y = sy;
        this.me.vx = this.me.vy = 0;
        this.me.fix = p.fix;
        this.me.known = true;
      } else if ((p.flags & FLAG.KNOCKED || now < this.me.knockUntil + 300) && far > 0.3) {
        // Knocked about: drift onto where the server has us.
        this.me.x += (sx - this.me.x) * 0.35;
        this.me.y += (sy - this.me.y) * 0.35;
      }
      if (p.act !== ACT.CHARGE && this.me.charging && !this.me.pressAt) this.me.charging = false;
      if (s.status !== FIGHTING) {
        this.me.pressAt = 0;
        this.me.charging = false;
      }
    } else {
      this.me.known = false;
      this.keys.clear();
    }
    document.body.classList.toggle("pb-playing", this.capturing);
    // (In a fight, the town's bottom bar goes: chat, emotes, and the rest.)
    document.body.classList.toggle("ar-playing", this.capturing);
    if (this.capturing && !this.touchMode && matchMedia("(pointer: coarse)").matches) this.setTouchMode(true);
    if (this.capturing) this.lobbyOpen = false;
    this.renderLobby();
  }

  /** An event from the ring: shown, and heard as loud as we're near it. */
  onEvent(e: ArenaEv) {
    sfx.withScale(this.hearing(), () => this.handleEvent(e));
  }

  private handleEvent(e: ArenaEv) {
    const me = this.selfId();
    const x = e.x / 100;
    const y = e.y / 100;
    const nearMe = this.near(x, y);
    const now = performance.now();
    this.hype = Math.min(1, this.hype + (HYPE[e.kind] ?? 0) * (e.kind === EV.HIT && (e.m & 2) !== 0 ? 2 : 1));
    switch (e.kind) {
      case EV.DISASTER_PICKED: {
        const k = KINDS[e.n];
        if (!k) break;
        // (Off the wheel, or by the crowd's vote.)
        wheelfx.landed(e.n - 1);
        this.disaster.wheelLanded(e.n, performance.now());
        this.announce(`${k.icon} ${k.name}!`, k.color, 1.1, "the wheel has spoken");
        break;
      }
      case EV.DISASTER: {
        const k = KINDS[e.n];
        if (!k) break;
        dfx.horn();
        this.announce(`${k.icon} ${k.name}!`, k.color, 1.6, k.hint);
        this.caesarSays(k.caesar, 2800);
        this.shake = Math.max(this.shake, 0.3);
        this.disaster.struck(e.n, performance.now());
        break;
      }
      case EV.METEOR_WARN:
        this.disaster.meteorMarked(x, y, e.m / 100, e.n, wallNow());
        break;
      case EV.METEOR:
        this.disaster.meteorLanded(x, y, 1.5, wallNow());
        this.explode(x, y, 1.5);
        this.sparks(x, y - 0.3, 0xffb03a, 26);
        this.dust(x, y, 8);
        // (Dozens come down: only the near ones rock the camera.)
        if (this.capturing) {
          const d = Math.hypot(this.me.x - x, this.me.y - y);
          if (d < 5) this.shake = Math.max(this.shake, 0.12 + 0.28 * (1 - d / 5));
        }
        break;
      case EV.LION_OUT:
        this.ringFx(x, y, 0xffd23f, 1.4);
        this.dust(x, y, 10);
        dfx.roar(Math.max(0.55, nearMe), e.b * 240);
        break;
      case EV.LION_CROUCH:
        dfx.growl(nearMe);
        if (e.a === me) this.float("!", "#ff4f1a", this.me.x, this.me.y - 1.9, 2.2);
        break;
      case EV.LION_LEAP:
        dfx.pounce(nearMe);
        this.dust(x, y, 5);
        break;
      case EV.LION_LAND:
        dfx.claws(nearMe);
        this.dust(x, y, 7);
        this.ringFx(x, y, 0xe8d3a3, 0.9);
        break;
      case EV.LION_HIT:
        this.disaster.hurt(e.b, wallNow());
        // (The little ones don't feel it: they're done for.)
        if (e.b >= THIEF_ID) break;
        this.sparks(x, y - 0.5, this.disaster.beastUp ? 0xffd88a : 0xff5a3a, 10);
        this.float(`-${e.n}`, "#ffb03a", x, y - 1.4, 1);
        sfx.swordHit(nearMe * 0.7);
        if (this.disaster.beastUp) dfx.scorpionHit(nearMe);
        else dfx.yelp(nearMe);
        break;
      case EV.LION_DOWN:
        if (e.b >= THIEF_ID) {
          dfx.thiefSquish(nearMe);
          this.sparks(x, y - 0.3, 0xc2622c, 10);
          this.dust(x, y, 4);
          this.float(e.a === me ? "GOTCHA!" : "SQUISH", "#ffd88a", x, y - 1.2, 0.9);
          break;
        }
        if (this.disaster.beastUp) {
          dfx.scorpionDown(nearMe);
          this.sparks(x, y - 0.5, 0x8cff4e, 44);
          this.dust(x, y, 18);
          this.ringFx(x, y, 0xc86eff, 2.6);
          this.float(e.a === me ? "SCORPION SLAIN!" : "SLAIN", "#c86eff", x, y - 3, 1.8);
          this.shake = Math.max(this.shake, 0.3);
          break;
        }
        dfx.lionDown(nearMe);
        this.sparks(x, y - 0.5, 0xffd23f, 26);
        this.dust(x, y, 8);
        this.float(e.a === me ? "LION SLAIN!" : "SLAIN", "#ffd23f", x, y - 1.8, e.a === me ? 1.6 : 1.1);
        break;
      case EV.THIEF_OUT:
        dfx.thiefPeek(nearMe);
        break;
      case EV.THIEF_GRAB:
        dfx.thiefHook(nearMe);
        this.sparks(x, y - 0.3, 0xffd88a, 5);
        this.dust(x, y, 3);
        this.float("STOLEN!", "#ffb03a", x, y - 1.2, 0.85);
        break;
      case EV.THIEF_STING:
        dfx.thiefSting(nearMe);
        this.disaster.thiefStung(e.a, wallNow());
        this.ringFx(x, y, 0x8cff4e, 0.7);
        this.float("STUNG!", "#8cff4e", x, y - 1.5, 1);
        if (e.b === me) this.buzz(50);
        break;
      case EV.POISONED:
        this.sparks(x, y - 0.8, 0x8cff4e, 12);
        this.float("POISONED", "#8cff4e", x, y - 1.9, 1);
        if (e.b === me) dfx.poisoned();
        break;
      case EV.SCORPION_WIND:
        dfx.scorpionHiss(nearMe);
        if (e.n === 1) dfx.dartSpit(nearMe * 0.6);
        if (e.n === 2) {
          // It's coming: a lurch, a spray of sand.
          this.dust(x, y, 10);
          this.ringFx(x, y, 0xc86eff, 1.3);
          this.shake = Math.max(this.shake, 0.14);
        }
        if (e.b === me && this.capturing) this.float(e.n === 2 ? "!!" : "!", "#c86eff", this.me.x, this.me.y - 1.9, 2.2);
        break;
      case EV.SCORPION_STING:
        dfx.scorpionSting(nearMe);
        this.dust(x, y, 7);
        this.ringFx(x, y, 0xc86eff, 1);
        if (this.capturing && Math.hypot(this.me.x - x, this.me.y - y) < 4) this.shake = Math.max(this.shake, 0.22);
        break;
      case EV.DART_HIT:
        this.dropMissile(e.a, DART);
        if (e.n) {
          this.sparks(x, y - 0.8, 0x9fd3ee, 10);
          this.float("BLOCKED", "#9fd3ee", x, y - 1.8, 1.1);
          sfx.swordClang(nearMe * 0.7);
        } else this.sparks(x, y - 0.8, 0x8cff4e, 12);
        break;
      case EV.ACID_BURN:
        this.sparks(x, y - 0.6, 0xb6ff5a, 6);
        this.float(`-${e.n}`, "#b6ff5a", x, y - 1.4, 0.9);
        dfx.sizzle(nearMe);
        if (e.b === me) {
          this.vignette.classList.remove("hit");
          void this.vignette.offsetWidth;
          this.vignette.classList.add("hit");
        }
        break;
      case EV.BOUNCE: {
        // A tank's shield sends a bomb back: a ringing clang, and off it goes.
        this.dropMissile(e.a, e.n);
        this.ringFx(x, y, 0x9fd3ee, 1.2);
        this.sparks(x, y - 0.4, 0xffe14f, 22);
        this.float("BOUNCED!", "#ffe14f", x, y - 1.6, 1.5);
        sfx.swordClang(nearMe);
        if (e.b === me || e.a === me) this.shake = Math.max(this.shake, 0.2);
        if (e.a === me) this.announce("💣 IT'S COMING BACK!", "#ff8a4a", 0.9, "roll out of its way");
        break;
      }
      case EV.SHIELD: {
        // It bursts: a blast of shards, rings racing out, and no harm done.
        const big = !!this.state?.fighters.find((q) => q.id === e.b && isGiant(q));
        const at = y - (big ? 2.4 : 1.2);
        this.sparks(x, at, 0x9fe8ff, big ? 46 : 30);
        this.sparks(x, at, 0xffffff, 12);
        this.ringFx(x, y, 0xffffff, big ? 2.6 : 1.5);
        this.ringFx(x, y, 0x7fd8ff, big ? 3.6 : 2.2);
        this.float(e.n ? "SHIELD HOLDS!" : "SHIELD!", "#9fe8ff", x, at - 1.2, 1.5);
        arenafx.shieldBurst(nearMe);
        if (e.b === me) this.buzz([20, 30, 40]);
        break;
      }
      case EV.SWING:
        if (e.n === ACT.SMASH) {
          if (e.m & 1) this.tiredSmash.add(e.a);
          else this.tiredSmash.delete(e.a);
        }
        // (The tank's hammer whooshes as it comes round, after the wind-up.)
        const who = this.state?.fighters.find((q) => q.id === e.a);
        if (who && !isGiant(who) && kitOf(who) === KIT.TANK && e.n >= ACT.LIGHT1 && e.n <= ACT.LIGHT3) window.setTimeout(() => sfx.swordSwing(0, nearMe * 0.8), lightOf(KIT.TANK, e.n - ACT.LIGHT1)[0]);
        else if (who && !isGiant(who) && shoots(kitOf(who)) && e.n >= ACT.LIGHT1 && e.n <= ACT.LIGHT3) snd.stab(nearMe);
        else sfx.swordSwing(e.n === ACT.HEAVY ? 0 : 1, nearMe * (e.n === ACT.HEAVY ? 1 : 0.5));
        // Our heavy blow, taken: lunge now if we were waiting on its word
        // (the windup's already gone by on the server, so straight in).
        if (e.a === me && e.n === ACT.HEAVY && this.me.releaseCharge >= 0) {
          const t = this.serverNow();
          this.lunge(t - HEAVY[0], this.me.releaseCharge);
          this.me.lungeFrom = t;
          this.me.lungeUntil = t + HEAVY[1];
        }
        break;
      case EV.HIT: {
        // Bundled off the wheel as it moves: no harm, only the shove.
        if (e.m & 4096) {
          this.dust(x, y, 4);
          if (e.b === me) {
            const [vx, vy] = [(e.vx - 32768) / 100, (e.vy - 32768) / 100];
            this.me.kvx = vx;
            this.me.kvy = vy;
            this.me.knockUntil = this.serverNow() + Math.hypot(vx, vy) * 45;
            this.me.rollUntil = this.me.lungeUntil = 0;
          }
          break;
        }
        // The Goliath whirling someone round: nothing touches it.
        if (e.m & 256) {
          this.sparks(x, y - 1.6, 0xffd23f, 10);
          this.float("IMMUNE!", "#ffd23f", x, y - 3.4, 1.3);
          sfx.swordClang(nearMe * 0.8);
          break;
        }
        // A slash glancing off the Goliath as it attacks: the one who struck reels.
        if (e.m & 128) {
          this.sparks(x, y - 1.2, 0x9fd3ee, 12);
          this.ringFx(x, y, 0x9fd3ee, 1.1);
          this.float("DEFLECTED!", "#9fd3ee", x, y - 3.2, 1.3);
          sfx.swordClang(nearMe);
          this.hitStop([e.a], 90);
          if (e.a === me) {
            this.shake = Math.max(this.shake, 0.2);
            this.buzz([20, 30, 20]);
            this.me.pressAt = 0;
            this.me.charging = false;
          }
          break;
        }
        const blocked = (e.m & 1) !== 0;
        const heavy = (e.m & 2) !== 0;
        const big = heavy || (e.m & 4) !== 0 || (e.m & 32) !== 0;
        // A lion or a meteor: knocked out of it, the button held or not.
        if (!e.a && e.b === me && !blocked) {
          this.me.pressAt = 0;
          this.me.charging = false;
          this.me.swingAt = 0;
        }
        const stab = (e.m & 8192) !== 0;
        const by = this.state?.fighters.find((f) => f.id === e.a);
        // Which way the blow came, and went.
        const from = by ? Math.atan2(by.y / 100 - y, by.x / 100 - x) : Math.atan2(e.vy - 32768, e.vx - 32768) + Math.PI;
        if (blocked) this.juice.guard(x, y, from, heavy || big);
        else this.juice.hit(x, y, from + Math.PI, big, big ? 0xffc06a : 0xfff1c8);
        this.float(blocked ? `${e.n}` : `-${e.n}`, blocked ? "#9fd3ee" : big ? "#ff8a4a" : "#ffffff", x, y - 1.3, big ? 1.5 : stab ? 0.8 : 1);
        if (blocked) arenafx.guard(nearMe * (stab ? 0.5 : 1));
        else if (stab) sfx.swordHit(nearMe * 0.35);
        else {
          sfx.swordHit(nearMe * (big ? 1 : 0.65));
          arenafx.bodyHit(nearMe * (big ? 1 : 0.6));
        }
        if (big) {
          this.hitStop([e.a, e.b], heavy ? 110 : 80);
          if (e.a === me || e.b === me) this.shake = Math.max(this.shake, heavy ? 0.28 : 0.18);
        }
        if (e.a === me) this.buzz(big ? 30 : 12);
        // The Goliath's stomp broken off as it wound up.
        if (e.m & 64) {
          this.ringFx(x, y, 0xfff1a8, 1.8);
          this.float("BROKEN!", "#ffe14f", x, y - 2.6, 1.4);
          sfx.swordClang(nearMe * 0.8);
          this.hitStop([e.a, e.b], 90);
          if (e.b === me) {
            this.me.pressAt = 0;
            this.me.charging = false;
          }
        }
        if (e.b === me) {
          const vx = (e.vx - 32768) / 100;
          const vy = (e.vy - 32768) / 100;
          const kb = Math.hypot(vx, vy);
          if (kb > 0.3) {
            this.me.kvx = vx;
            this.me.kvy = vy;
            this.me.knockUntil = this.serverNow() + kb * 45;
            this.me.rollUntil = this.me.lungeUntil = 0;
          }
          if (!blocked) {
            this.vignette.classList.remove("hit");
            void this.vignette.offsetWidth;
            this.vignette.classList.add("hit");
            this.shake = Math.max(this.shake, 0.12);
            this.buzz(50);
          }
        }
        break;
      }
      case EV.PARRY: {
        const heavy = e.n === 1;
        this.juice.parry(x, y, heavy);
        this.float(heavy ? "HEAVY PARRIED!" : "PARRY!", "#ffe14f", x, y - 1.6, heavy ? 1.8 : 2);
        sfx.swordParry(nearMe * 0.6);
        arenafx.parry(nearMe);
        if (heavy) sfx.crowdRoar(0.6);
        this.hitStop([e.a, e.b], heavy ? 220 : 160);
        if (e.a === me || e.b === me) this.shake = Math.max(this.shake, heavy ? 0.32 : 0.22);
        if (e.a === me) {
          this.announce(heavy ? "HEAVY PARRIED! THEY'RE OPEN" : "PARRY!", "#ffe14f", 1.3, heavy ? "strike back now!" : "");
          this.buzz([20, 30, 40]);
        } else if (e.b === me) {
          this.announce(heavy ? "YOUR HEAVY WAS PARRIED!" : "PARRIED!", "#ff9a3f", 1.1, heavy ? "reeling, and out of breath" : "");
          this.buzz(80);
        }
        break;
      }
      case EV.GUARD_BREAK:
        this.float("GUARD BREAK!", "#ff9a3f", x, y - 1.8, 1.4);
        arenafx.guardBreak(nearMe);
        this.juice.guardBreak(x, y);
        this.hitStop([e.a, e.b], 90);
        if (e.b === me) this.shake = Math.max(this.shake, 0.26);
        break;
      case EV.WALL_SLAM:
        this.float("WALL SLAM!", "#ff6a6a", x, y - 1.6, 1.6);
        this.juice.wallSlam(x, y, Math.atan2(y - this.ring.h / 2, x - this.ring.w / 2));
        arenafx.wallSlam(nearMe);
        this.hitStop([e.a, e.b], 150);
        if (e.a === me || e.b === me) this.shake = Math.max(this.shake, 0.42);
        else this.shake = Math.max(this.shake, 0.16 * nearMe);
        sfx.crowdRoar(0.35);
        break;
      case EV.DOWN:
        this.juice.ko(x, y, this.colorOf(this.slotOf(e.b)));
        arenafx.ko(nearMe);
        this.hitStop([e.b], 130);
        this.shake = Math.max(this.shake, 0.2 * nearMe);
        this.float("DOWN!", "#ff4f6a", x, y - 1.8, 1.8);
        this.addFeed(e.a, e.b);
        sfx.crowdRoar(0.7);
        if (e.b === me) this.announce("YOU'RE DOWN", "#ff4f6a", 1.3, "watch the rest of the round from the sand");
        else if (e.a === me) this.announce(`${this.who(e.b).toUpperCase()} IS DOWN!`, "#ffe14f", 1.2);
        break;
      case EV.ROLL:
        if (e.n === 1) {
          // The Goliath dashing off: a burst of wind and sand where it leapt from.
          this.ringFx(x, y, 0x9fe8ff, 1.5);
          this.ringFx(x, y, 0xffffff, 0.9);
          if (e.a !== me) {
            snd.whoosh(nearMe);
            this.dust(x, y, 14);
          }
        } else if (e.a !== me) {
          snd.whoosh(nearMe * 0.6);
          this.dust(x, y, 5);
        }
        break;
      case EV.GIFT_INCOMING:
        snd.whistle();
        this.float(`${GIFTS[e.n]?.icon ?? "🎁"} incoming!`, "#ffe14f", x, y - 1.2, 1);
        break;
      case EV.PICKUP: {
        const g = GIFTS[e.n];
        // Each with a colour and a sound of its own.
        const hue = e.n === GIFT.SPEED ? 0xfff1b0 : e.n === GIFT.REGEN ? 0xc77dff : e.n === GIFT.SHIELD ? 0x7fd8ff : e.n === GIFT.FURY ? 0xff4f4f : 0xffe14f;
        this.ringFx(x, y, hue, 1);
        this.float(g?.name ?? "GIFT", `#${hue.toString(16).padStart(6, "0")}`, x, y - 1.4, 1.2);
        const giant = !!this.state?.fighters.find((q) => q.id === e.a && isGiant(q));
        if (e.n === GIFT.SPEED) {
          this.sparks(x, y, hue, 14);
          arenafx.boots(nearMe);
        } else if (e.n === GIFT.REGEN) {
          this.sparks(x, y, hue, 14);
          arenafx.potion(nearMe);
        } else if (e.n === GIFT.SHIELD) {
          this.ringFx(x, y, 0xffffff, 1.4);
          arenafx.shieldUp(nearMe);
        } else if (e.n === GIFT.FURY) {
          this.sparks(x, y, hue, 18);
          arenafx.fury(nearMe);
        } else snd.pickup();
        if (e.a === me) {
          if (e.n === GIFT.SPEAR || e.n === GIFT.BOMB) this.announce(`${g.icon} ${g.name}`, "#ffe14f", 1, this.touchMode ? "tap ⚔️ to throw it" : e.n === GIFT.BOMB && giant ? "one great big bomb: attack (click) to throw it" : "attack (click) to throw it where you aim");
          else if (e.n === GIFT.FURY) this.announce("⛑️ FURY!", "#ff4f4f", 1.2, giant ? "hits half again as hard, for a long while" : "hits half again as hard, for a while");
          else if (e.n === GIFT.SPEED) this.announce("🪽 HERMES BOOTS!", "#fff1b0", 1.2, giant ? "half as fast again, for a long while" : "half as fast again, for a while");
          else if (e.n === GIFT.REGEN) this.announce("🧪 REGENERATION", "#c77dff", 1.2, giant ? "a great deal of health, coming back slowly" : "health coming back slowly, for 15 seconds");
          else if (e.n === GIFT.SHIELD) this.announce("🛡️ SHIELD!", "#7fd8ff", 1.2, giant ? "it'll take the next two blows" : "it'll take the next blow");
        }
        break;
      }
      case EV.THROW: {
        const aim = fromU16(e.m);
        const bomb = e.n === GIFT.BOMB || e.n === BIG_BOMB;
        const arrow = e.n === ARROW;
        // (How fast, as the server has it: the archer's triple shot flies faster.)
        const toldSpeed = (e.vy - 32768) / 100;
        const speed = toldSpeed > 0.1 ? toldSpeed : bomb ? BOMB_SPEED : arrow ? ARROW_SPEED : SPEAR_SPEED;
        // (As far as it'll go, as the server has it: a bomb lobbed to the mouse.)
        const told = (e.vx - 32768) / 100;
        const range = told > 0.1 ? told : bomb ? BOMB_RANGE : arrow ? ARROW_RANGE : SPEAR_RANGE;
        this.missiles.push({ by: e.a, kind: e.n, x: x + Math.cos(aim) * 0.5, y: y + Math.sin(aim) * 0.5, vx: Math.cos(aim) * speed, vy: Math.sin(aim) * speed, left: range, range, born: now });
        if (arrow) sfx.swordSwing(1, nearMe * 0.35);
        else snd.whoosh(nearMe);
        break;
      }
      case EV.BOOM:
        {
          // (Theirs nearest where it went off: the bomber's may have several up.)
          let best = -1;
          let bd = Infinity;
          this.missiles.forEach((m, i) => {
            const d = Math.hypot(m.x - x, m.y - y);
            if (m.by === e.a && (m.kind === GIFT.BOMB || m.kind === BIG_BOMB) && d < bd) [best, bd] = [i, d];
          });
          if (best >= 0) this.missiles.splice(best, 1);
        }
        this.explode(x, y, e.n ? e.n / 100 : BOMB_R);
        this.juice.blast(x, y, e.n ? e.n / 100 : BOMB_R);
        snd.boom(Math.max(0.5, nearMe));
        if (this.capturing && Math.hypot(this.me.x - x, this.me.y - y) < 5) this.shake = Math.max(this.shake, 0.4);
        break;
      case EV.STUCK:
        this.dropMissile(e.a, e.n || GIFT.SPEAR);
        this.stuck.push({ x, y, aim: fromU16(e.m), until: now + (e.n === ARROW ? 1500 : 2500), arrow: e.n === ARROW || e.n === DART });
        snd.thud(nearMe * 0.5);
        break;
      case EV.SPIKED:
        this.float("OUCH!", "#ff6a6a", x, y - 1.4, 1);
        this.sparks(x, y - 0.2, 0xd8dce8, 10);
        if (e.b === me) this.buzz(40);
        break;
      case EV.ROUND_START:
        snd.gong();
        if (this.state?.exhibition) this.announce(`🤖 EXHIBITION · ROUND ${e.n}`, "#ffe14f", 1.8, "the bots fight while nobody's playing: open the sign by the gate to play");
        else this.announce(`ROUND ${e.n}`, "#ffe14f", 1.8);
        break;
      case EV.FIGHT:
        snd.horn();
        sfx.crowdRoar(0.8);
        this.announce("FIGHT!", "#ff6a3f", 2.2);
        break;
      case EV.ROUND_WON: {
        sfx.crowdRoar(1);
        // Goliath mode: a side takes the round.
        const st = this.state;
        if (st && st.mode === MODE.GOLIATH && e.a !== 0) {
          const giant = st.fighters.some((f) => f.id === e.a && isGiant(f));
          const mine = st.fighters.find((f) => f.id === me);
          const ours = !!mine && isGiant(mine) === giant;
          if (giant) this.announce(ours ? "👹 YOU CRUSH THEM ALL! ♛" : "👹 THE GOLIATH TAKES THE ROUND", "#ff4f1a", 1.4);
          else this.announce(ours ? "THE GIANT FALLS! ♛" : "⚔️ THE GLADIATORS TAKE THE ROUND", "#ffd23f", 1.4, `${this.who(e.a)} led the charge`);
          break;
        }
        if (st && st.mode === MODE.TEAMS && e.a !== 0) {
          const k = this.slotOf(e.a) < 2 ? 0 : 1;
          const mySlot = st.slots.indexOf(me);
          const ours = mySlot >= 0 && (mySlot < 2 ? 0 : 1) === k;
          this.announce(ours ? "YOUR TEAM TAKES THE ROUND! ♛" : `${k ? "RED" : "BLUE"} TEAM TAKES THE ROUND ♛`, TEAM_CSS[k], 1.4, `${this.who(e.a)} led the way`);
          break;
        }
        if (e.a === 0) this.announce("NOBODY LEFT STANDING", "#c9c2b0", 1.2);
        else this.announce(e.a === me ? "YOU TAKE THE ROUND! ♛" : `${this.who(e.a).toUpperCase()} TAKES THE ROUND ♛`, this.cssOf(this.slotOf(e.a)), 1.4);
        break;
      }
      case EV.CHAMPION:
        break;
      case EV.SPECIAL: {
        // The ultimate, by class (`n`: the archer's, the bomber's, the tank's; 0 the whirlwind).
        const k = e.n;
        if (k === KIT.ARCHER) {
          this.float("ARROW STORM!", "#7dd06a", x, y - 1.8, 1.6);
          this.ringFx(x, y, 0x7dd06a, 1.2);
        } else if (k === KIT.BOMBER) {
          this.float("IT'S GONNA BLOW!", "#ff6a3f", x, y - 1.8, 1.5);
          this.ringFx(x, y, 0xff6a3f, BLAST_R);
          sfx.swordSwing(0, nearMe * 0.4);
        } else if (k === KIT.TANK) {
          this.float("EARTHQUAKE!", "#c8b08a", x, y - 1.8, 1.6);
          this.ringFx(x, y, 0xc8b08a, QUAKE_R);
        } else {
          const f = this.state?.fighters.find((q) => q.id === e.a);
          this.float("WHIRLWIND!", "#c77dff", x, y - 1.8, 1.6);
          this.ringFx(x, y, 0xc77dff, KIT_SPIN_REACH[f ? kitOf(f) : 0]);
        }
        snd.whoosh(nearMe);
        if (e.a === me) this.shake = Math.max(this.shake, 0.15);
        break;
      }
      case EV.FIRE:
        this.announce("🔥 THE RING OF FIRE CLOSES IN", "#ff6a3f", 1.1, "get to the middle!");
        sfx.crowdRoar(0.6);
        break;
      case EV.RAGE_FULL: {
        const giant = this.state?.fighters.some((f) => f.id === e.a && isGiant(f));
        if (e.a === me) {
          if (giant) this.announce("👹 RAGE FULL", "#ff4f1a", 1.2, this.touchMode ? "tap 🤚 to grab a gladiator" : "press Q to GRAB the gladiator nearest your aim");
          else this.announce("😡 RAGE FULL", "#c77dff", 1.1, this.touchMode ? "tap 🌪 to whirl" : "press Q to unleash the whirlwind");
        } else this.float(giant ? "THE GOLIATH RAGES!" : "RAGE!", giant ? "#ff4f1a" : "#c77dff", x, y - (giant ? 3.2 : 1.6), giant ? 1.4 : 1);
        break;
      }
      // The Goliath's: the stomp's shockwave, the grab, the hurl.
      case EV.STOMP: {
        const r = e.n / 100;
        // (The Goliath's stomp, or a tank's earthquake.)
        const tank = this.state?.fighters.some((f) => f.id === e.a && !isGiant(f));
        this.juice.stomp(x, y, r, !tank);
        arenafx.quake(Math.max(0.6, nearMe) * (tank ? 0.7 : 1));
        snd.boom(Math.max(0.4, nearMe) * 0.5);
        sfx.crowdRoar(0.7);
        this.shake = Math.max(this.shake, (tank ? 0.2 : 0.3) + 0.5 * nearMe);
        this.float(tank ? "QUAKE!" : "STOMP!", "#ffd23f", x, y - (tank ? 2.2 : 3.4), tank ? 1.5 : 1.8);
        break;
      }
      case EV.GRAB:
        snd.thud(nearMe);
        sfx.crowdRoar(0.9);
        this.float("GRABBED!", "#ff4f1a", x, y - 3.6, 1.8);
        if (e.b === me) this.announce("THE GOLIATH HAS YOU!", "#ff4f1a", 1.4, "hold on…");
        else if (e.a === me) this.announce("👹 GOT ONE!", "#ffd23f", 1.3, this.touchMode ? "aim, and tap ⚔️ to hurl them" : "aim, and click to hurl them");
        this.buzz(e.b === me ? [40, 40, 80] : 30);
        break;
      case EV.HURL:
        this.flung.set(e.b, { until: performance.now() + 1100, dir: Math.atan2(e.vy - 32768, e.vx - 32768) });
        snd.whoosh(1);
        sfx.crowdRoar(1);
        this.float("HURLED!", "#ffd23f", x, y - 1.8, 1.7);
        this.dust(x, y, 14);
        if (e.b === me) this.shake = Math.max(this.shake, 0.5);
        break;
    }
  }

  private near(x: number, y: number): number {
    if (!this.capturing) return 0.6;
    return Math.max(0.2, 1 - Math.hypot(x - this.me.x, y - this.me.y) / 18);
  }

  /**
   * How well the arena's heard from where we are: all of it fighting in it
   * (or right by it, up in the stands), fading out further off, and
   * nothing at all past `HEAR_TILES` from the sand.
   */
  private hearing(): number {
    if (this.capturing) return 1;
    const self = this.avatarOf(this.selfId());
    if (!self) return 0;
    const a = this.arenaObj;
    // From the nearest edge of the ring (the stands round it count as by it).
    const dx = Math.max(a.x - self.pos.x, 0, self.pos.x - (a.x + a.w));
    const dy = Math.max(a.y - self.pos.y, 0, self.pos.y - (a.y + a.h));
    const d = Math.hypot(dx, dy);
    return d <= HEAR_NEAR ? 1 : Math.max(0, 1 - (d - HEAR_NEAR) / (HEAR_TILES - HEAR_NEAR));
  }

  private buzz(pattern: number | number[]) {
    if (this.touchMode) navigator.vibrate?.(pattern);
  }

  /** Our bet's down. */
  onBetPlaced(pick: number, pays: number) {
    this.bets.placed(this.state, pick, pays);
    sfx.cash(0.5, 1);
  }

  /** How our bet went. */
  onBetSettled(coins: number, refund: boolean) {
    this.bets.settled();
    if (refund) this.announce("🪙 BET RETURNED", "#c9c2b0", 1, "the round came to nothing");
    else if (coins > 0) {
      this.announce(`🪙 +${coins} COINS!`, "#ffd23f", 1.6, "your bet came in");
      sfx.cash(1, coins);
      const f = this.watching ? this.watchFocus() : null;
      const [x, y] = f ? [f.x - this.ox, f.y - this.oy] : [this.ring.w / 2, this.ring.h / 2];
      this.juice.coins(x, y, 40);
    } else this.announce("🪙 YOUR BET'S LOST", "#c9c2b0", 1);
  }

  private hitStop(ids: number[], ms: number) {
    this.stopUntil = performance.now() + ms;
    this.stopIds = new Set(ids);
  }

  private dropMissile(by: number, kind: number) {
    const i = this.missiles.findIndex((m) => m.by === by && m.kind === kind);
    if (i >= 0) this.missiles.splice(i, 1);
  }

  // ---- each frame ---------------------------------------------------------------

  update(serverNow: number, wallNow: number) {
    // (Its sounds, the parade's fanfare and the spikes among them, heard as near as we are.)
    sfx.withScale(this.hearing(), () => this.updateNow(serverNow, wallNow));
  }

  private updateNow(serverNow: number, wallNow: number) {
    const dt = Math.min(0.05, (wallNow - this.lastFrame) / 1000);
    this.lastFrame = wallNow;
    this.fx.clear();
    this.drawFires(wallNow, dt);
    this.drawCaesar(wallNow);
    this.drawGates(dt);
    this.hype *= Math.exp(-dt * 0.6);
    this.drawCrowd(wallNow);
    this.updateWatch();
    const s = this.state;
    const live = !!s && s.status !== LOBBY;
    const me = this.selfId();
    const p = this.mine();
    this.disaster.update(s, s?.round ?? -1, serverNow, wallNow, dt);
    // Spectators' bets: anyone by the ring who isn't in the fight.
    const fighting = !!s && s.slots.includes(this.selfId());
    this.bets.update(s, !fighting && (this.watching || this.hearing() > 0.5));
    // The lobby card closes when we walk away from the ring.
    if (this.lobbyOpen && !this.capturing) {
      const self = this.avatarOf(me);
      const a = this.arenaObj;
      if (self && Math.hypot(self.pos.x - (a.x + a.w / 2), self.pos.y - (a.y + a.h / 2)) > 22) {
        this.lobbyOpen = false;
        this.lobby.hidden = true;
      }
    }
    if (p && s && this.me.known) this.moveSelf(p, s, serverNow, wallNow, dt);
    this.shake = Math.max(0, this.shake - dt * 0.9);
    // Bots come and go with the match.
    const botIds = new Set(live && s ? s.fighters.filter((f) => f.id >= BOT_BASE && f.id < BOT_BASE + SLOTS).map((f) => f.id) : []);
    for (const [id, a] of this.bots) {
      if (!botIds.has(id)) {
        a.destroy();
        this.bots.delete(id);
      }
    }
    for (const id of botIds) {
      if (!this.bots.has(id)) {
        const f = s!.fighters.find((q) => q.id === id)!;
        const a = new Avatar(botInfo(id, this.toTile(f.x / 100, f.y / 100)), this.scene, this.labels, false, Date.now());
        a.markNpc();
        this.bots.set(id, a);
      }
    }
    // The fighters: placed, posed, armed.
    const at = serverNow - RENDER_DELAY_MS;
    const seen = new Set<number>();
    const stopped = wallNow < this.stopUntil;
    if (live && s) {
      for (const f of s.fighters) {
        const avatar = this.bots.get(f.id) ?? this.avatarOf(f.id);
        if (!avatar) continue;
        seen.add(f.id);
        // The parade: everyone walked by it, the champion out in front.
        const m = this.marching(s, f, serverNow);
        if (m) {
          const t = this.toTile(m.x, m.y);
          avatar.setArena({ x: t.x, y: t.y, facing: m.face, frame: m.frame, walking: m.walking, hurt: false, lean: m.lean, lift: m.lift, hide: isGiant(f), height: isGiant(f) ? GOLIATH_HEIGHT + 24 : undefined, tint: f.flags & FLAG.FURY ? furyTint(performance.now()) : undefined });
          avatar.setFade(1);
          this.posed.add(f.id);
          this.held.set(f.id, { x: m.x, y: m.y, aim: m.face > 0 ? 0 : Math.PI });
          if (f.id === me) {
            this.me.x = m.x;
            this.me.y = m.y;
          }
          this.paradeGear(f, m, avatar, wallNow);
          continue;
        }
        // (Ourselves: run ahead in the fight; but mid-stomp or held, as the server has us, gliding.)
        const self = f.id === me && this.me.known && s.status === FIGHTING && f.act !== ACT.STOMP && f.act !== ACT.HELD;
        let pos = self ? { x: this.me.x, y: this.me.y, aim: this.me.aim } : this.glide(f.id, at);
        // Held: gripped in the Goliath's hands at arm's length (wherever the
        // whirl has them round it), not out at the end of the swing.
        if (f.act === ACT.HELD) {
          const g = s.fighters.find((q) => isGiant(q) && q.act === ACT.GRAB);
          if (g) {
            const gp = g.id === me && this.me.known ? { x: this.me.x, y: this.me.y } : this.glide(g.id, at);
            const a = Math.atan2(pos.y - gp.y, pos.x - gp.x);
            this.holdAngle.set(g.id, a);
            pos = { x: gp.x + Math.cos(a) * HOLD_R, y: gp.y + Math.sin(a) * HOLD_R * 0.55, aim: a };
          }
        }
        // Hit-stop: frozen a beat on a big blow.
        const prevPose = this.held.get(f.id);
        // (Not ourselves mid-lunge: we'd freeze, then jump on to where we really are.)
        const lunging = self && serverNow < this.me.lungeUntil + 60;
        if (stopped && this.stopIds.has(f.id) && prevPose && !lunging) pos = prevPose;
        this.held.set(f.id, pos);
        const prev = self ? null : this.glide(f.id, at - 80);
        const moving = self ? Math.hypot(this.me.vx, this.me.vy) > 0.6 : !!prev && Math.hypot(pos.x - prev.x, pos.y - prev.y) > 0.04;
        const since = serverNow - (s.now - f.actMs) - (self ? 0 : RENDER_DELAY_MS * 0.5);
        const pose = this.pose(f, since, serverNow, self);
        const t = this.toTile(pos.x, pos.y);
        const whirl = f.act === ACT.SPIN;
        const holding = f.act === ACT.GRAB ? this.holdAngle.get(f.id) : undefined;
        const face: 1 | -1 = whirl
          ? Math.floor(serverNow / 90) % 2
            ? 1
            : -1
          : f.act === ACT.HELD || holding !== undefined
            ? Math.cos(holding ?? pos.aim) >= 0
              ? 1
              : -1
            : Math.cos(pos.aim) >= 0
              ? 1
              : -1;
        avatar.setArena({ x: t.x, y: t.y, facing: face, frame: pose.frame, walking: moving && pose.frame === null && !(f.flags & FLAG.DOWN), hurt: pose.hurt, lean: pose.lean, lift: pose.lift, hide: isGiant(f), height: isGiant(f) ? GOLIATH_HEIGHT + 24 : undefined, tint: f.flags & FLAG.FURY ? furyTint(performance.now()) : undefined });
        avatar.setFade(f.flags & FLAG.DOWN ? 0.7 : 1);
        this.posed.add(f.id);
        this.drawGear(f, pos, since, serverNow, avatar, pose, moving);
      }
    }
    for (const id of [...this.posed]) {
      if (!seen.has(id)) {
        this.posed.delete(id);
        const a = this.avatarOf(id);
        if (a) {
          a.setArena(null);
          a.setFade(1);
        }
        this.gear.get(id)?.destroy();
        this.gear.delete(id);
        for (const gh of this.ghosts.get(id) ?? []) gh.destroy();
        this.ghosts.delete(id);
        this.giantPath.delete(id);
        this.held.delete(id);
      }
    }
    for (const a of this.bots.values()) a.update(serverNow, wallNow);
    if (live && s) {
      for (const f of s.fighters) {
        if (f.act === ACT.SPIN && wallNow - (this.whirled.get(f.id) ?? 0) > 150) {
          this.whirled.set(f.id, wallNow);
          const pos = f.id === me ? this.me : this.glide(f.id, at);
          snd.whoosh(this.near(pos.x, pos.y) * 0.7);
          this.dust(pos.x, pos.y, 3);
        }
      }
      const pw = p ? (p.flags & FLAG.WINDED) !== 0 : false;
      if (pw && !this.wasWinded) {
        this.float("WINDED!", "#9fd3ee", this.me.x, this.me.y - 1.6, 1.3);
        sfx.dizzy(0.4);
      }
      this.wasWinded = pw;
    }
    this.flyMissiles(dt);
    this.drawArena(s, serverNow, wallNow);
    this.drawFx(wallNow, dt, s, serverNow);
    this.drawParade(s, serverNow, wallNow, dt);
    this.updateHud(serverNow);
    this.updatePicker(serverNow);
  }

  private held = new Map<number, { x: number; y: number; aim: number }>();
  /** The Goliath whirling someone: which way they are from it now (radians), by the Goliath's id. */
  private holdAngle = new Map<number, number>();
  /** Those hurled, flying (till when, which way): drawn flat out, sideways, head first. */
  private flung = new Map<number, { until: number; dir: number }>();
  private whirled = new Map<number, number>();
  private wasWinded = false;

  /** Us: knocked flying, rolling, lunging, or walking (slower blocking, charging or swinging). */
  private moveSelf(p: F, s: State, serverNow: number, wallNow: number, dt: number) {
    // (The Goliath's bigger, to bump into things.)
    const body = isGiant(p) ? GIANT_R : BODY_R;
    const d = this.moveDir();
    // Aim: the mouse, or by touch whoever's nearest.
    if (this.touchMode) this.me.aim = this.autoAim(d);
    else {
      const aimAt = this.aimPoint();
      if (aimAt) this.me.aim = Math.atan2(aimAt.y - this.me.y, aimAt.x - this.me.x);
    }
    this.tryRoll();
    // A press held long enough: charging a heavy blow (once there's the wind for it).
    if (this.me.pressAt && !this.me.charging && serverNow - this.me.pressAt >= HOLD_MS && s.status === FIGHTING) {
      if (this.canCharge(p)) {
        this.me.charging = true;
        this.act(INPUT.HEAVY_START);
      } else if (p.flags & FLAG.WINDED || (p.act === ACT.NONE && serverNow - this.me.pressAt >= HOLD_MS + 120)) this.outOfWind();
    }
    // Waiting on a blow to finish, and it left us too tired: no charge after all.
    if (this.me.charging && (p.act === ACT.NONE || p.act === ACT.BLOCK) && !this.canCharge(p)) this.me.charging = false;
    const down = (p.flags & FLAG.DOWN) !== 0;
    if (s.status === FIGHTING && !down) {
      let moved = false;
      if (serverNow < this.me.knockUntil || Math.hypot(this.me.kvx, this.me.kvy) > 0.3) {
        // Knocked flying: the same knock as the server's.
        const [nx, ny, bumped] = this.ring.slide(this.me.x, this.me.y, this.me.kvx * dt, this.me.kvy * dt, body);
        this.me.x = nx;
        this.me.y = ny;
        const decay = Math.exp(-KB_FRICTION * dt);
        this.me.kvx = bumped ? 0 : this.me.kvx * decay;
        this.me.kvy = bumped ? 0 : this.me.kvy * decay;
        if (Math.hypot(this.me.kvx, this.me.kvy) < 0.3) this.me.kvx = this.me.kvy = 0;
        this.me.vx = this.me.vy = 0;
        moved = true;
      } else if (serverNow < this.me.rollUntil) {
        const step = isGiant(p) ? (GIANT_DASH_DIST / (GIANT_DASH_MS / 1000)) * dt : (ROLL_DIST / (ROLL_MS / 1000)) * dt;
        [this.me.x, this.me.y] = this.ring.slide(this.me.x, this.me.y, Math.cos(this.me.rollDir) * step, Math.sin(this.me.rollDir) * step, body);
        this.me.vx = Math.cos(this.me.rollDir) * 4;
        this.me.vy = Math.sin(this.me.rollDir) * 4;
        moved = true;
      } else if (serverNow < this.me.lungeUntil && s.now > this.me.releaseAt + 60 && p.act !== ACT.HEAVY && p.act !== ACT.CHARGE) {
        // The server turned the blow down (out of breath, too soon): no lunge.
        this.me.lungeUntil = 0;
      } else if (serverNow >= this.me.lungeFrom && serverNow < this.me.lungeUntil && p.act !== ACT.STUN) {
        const step = (this.me.lungeDist / (HEAVY[1] / 1000)) * dt;
        [this.me.x, this.me.y] = this.ring.slide(this.me.x, this.me.y, Math.cos(this.me.lungeDir) * step, Math.sin(this.me.lungeDir) * step, body);
        moved = true;
      }
      if (!moved) {
        const slow = this.speedFor(p, serverNow);
        const k = Math.min(1, dt * (d.x || d.y ? 16 : 20));
        this.me.vx += (d.x * SPEED * slow - this.me.vx) * k;
        this.me.vy += (d.y * SPEED * slow - this.me.vy) * k;
        const [nx, ny] = this.ring.slide(this.me.x, this.me.y, this.me.vx * dt, this.me.vy * dt, body);
        if (Math.abs(nx - this.me.x) < Math.abs(this.me.vx * dt) * 0.5) this.me.vx = 0;
        if (Math.abs(ny - this.me.y) < Math.abs(this.me.vy * dt) * 0.5) this.me.vy = 0;
        this.me.x = nx;
        this.me.y = ny;
      }
      if (wallNow - this.me.sentAt >= MOVE_EVERY_MS) {
        const x = Math.round(this.me.x * 100);
        const y = Math.round(this.me.y * 100);
        const aim = toU16(this.me.aim);
        // (And how far off the mouse is: where the Goliath leaps, or hurls whoever it holds.)
        const reach = Math.round(Math.min(600, this.mouseReach() ?? 0) * 100);
        if (x !== this.me.sent.x || y !== this.me.sent.y || Math.abs(aim - this.me.sent.aim) > 300 || Math.abs(reach - this.me.sent.reach) > 30) {
          this.send({ t: "ArenaMove", x, y, aim, reach });
          this.me.sent = { x, y, aim, reach };
          this.me.sentAt = wallNow;
        }
      }
    } else {
      this.me.vx = this.me.vy = 0;
    }
    const lead = this.touchMode ? { x: d.x * 1.2, y: d.y * 0.8 } : { x: Math.cos(this.me.aim) * 1.4, y: Math.sin(this.me.aim) * 0.9 };
    this.camLead.x += (lead.x - this.camLead.x) * Math.min(1, dt * 3);
    this.camLead.y += (lead.y - this.camLead.y) * Math.min(1, dt * 3);
  }

  /** How fast we can walk now (a fraction of full speed). */
  private speedFor(p: F, now: number): number {
    // The Goliath: slower; standing to smash, leaping, whirling someone round.
    if (p.act === ACT.STOMP || p.act === ACT.HELD) return 0;
    if (p.act === ACT.SMASH) return 0.25 * GIANT_SPEED;
    if (p.act === ACT.GRAB) return 0.35 * GIANT_SPEED;
    return (isGiant(p) ? GIANT_SPEED : KIT_SPEED[kitOf(p)]) * this.baseSpeed(p, now) * (p.buffs & BUFF.SPEED ? SPEED_GIFT_X : 1) * (p.buffs & BUFF.POISON ? POISON_SLOW : 1);
  }

  private baseSpeed(p: F, now: number): number {
    if (this.me.charging || p.act === ACT.CHARGE) return 0.55;
    if (this.me.blocking || p.act === ACT.BLOCK) return 0.45;
    switch (p.act) {
      case ACT.STUN:
        return 0;
      case ACT.LIGHT1:
      case ACT.LIGHT2:
      case ACT.LIGHT3:
        return 0.35;
      case ACT.HEAVY:
        return 0.2;
      case ACT.THROW:
        return 0.4;
      case ACT.SPIN:
        return 0.8;
      case ACT.SHOOT:
        return 0.5;
      case ACT.CAST:
        return 0.25;
    }
    return now - this.me.swingAt < 250 ? 0.4 : 1;
  }

  /** Where fighter `id` was at server time `t`, between the two ticks either side (a little past the last). */
  private glide(id: number, t: number): { x: number; y: number; aim: number } {
    const snaps = this.snaps;
    if (!snaps.length) {
      const f = this.state?.fighters.find((q) => q.id === id);
      return f ? { x: f.x / 100, y: f.y / 100, aim: fromU16(f.aim) } : { x: 0, y: 0, aim: 0 };
    }
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i].t <= t && snaps[i + 1].t >= t) {
        a = snaps[i];
        b = snaps[i + 1];
        break;
      }
    }
    const pa = a.ps.get(id);
    const pb = b.ps.get(id) ?? pa;
    if (!pa || !pb) return pb ?? pa ?? { x: 0, y: 0, aim: 0 };
    if (b === snaps[snaps.length - 1] && t > b.t && snaps.length >= 2) {
      const prev = snaps[snaps.length - 2];
      const pp = prev.ps.get(id);
      if (pp && b.t > prev.t && Math.hypot(pb.x - pp.x, pb.y - pp.y) < 2.5) {
        const ahead = Math.min(t - b.t, 100) / (b.t - prev.t);
        const [x, y] = this.ring.slide(pb.x, pb.y, (pb.x - pp.x) * ahead, (pb.y - pp.y) * ahead, BODY_R);
        return { x, y, aim: pb.aim };
      }
      return pb;
    }
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) > 3) return t >= b.t ? pb : pa;
    const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    return { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f, aim: pa.aim + turn(pa.aim, pb.aim) * f };
  }

  /** A fighter's pose: their avatar frame (null: standing or walking), lean (radians round the feet) and lift (px). */
  /**
   * How far into a smash `since` is, on the usual smash's clock: a tired one
   * (out of stamina) winds up and recovers slower, so it's drawn slower to
   * match, the club coming down when the server's blow does.
   */
  private smashSince(f: F, since: number): number {
    if (!this.tiredSmash.has(f.id)) return since;
    const [w, a] = SMASH;
    const tw = w * TIRED_SMASH;
    if (since < tw) return since / TIRED_SMASH;
    if (since < tw + a) return w + (since - tw);
    return w + a + (since - tw - a) / TIRED_SMASH;
  }

  private pose(f: F, since: number, now: number, self: boolean): Pose {
    // Hurled, flying: flat out sideways, head first, till they land or crash.
    const fl = this.flung.get(f.id);
    if (fl && f.act !== ACT.HELD) {
      if (performance.now() < fl.until && !(f.flags & (FLAG.DAZED | FLAG.DOWN)) && (f.flags & FLAG.KNOCKED || f.act === ACT.STUN)) {
        return { frame: null, lean: (Math.cos(fl.dir) >= 0 ? 1 : -1) * (Math.PI / 2), lift: 14, hurt: true };
      }
      this.flung.delete(f.id);
    }
    if (f.flags & FLAG.DOWN) return { frame: 2, lean: 0, lift: 0, hurt: false };
    const face = Math.cos(fromU16(f.aim)) >= 0 ? 1 : -1;
    // Our own slash shows the moment it's pressed.
    const kit = isGiant(f) ? KIT.KNIGHT : kitOf(f);
    if (self && f.act === ACT.NONE && now - this.me.swingAt < lightOf(kit, 0)[0]) return { frame: SWORD_RAISE, lean: -face * 0.06, lift: 0, hurt: false };
    if (self && this.me.charging && f.act !== ACT.CHARGE) return { frame: SWORD_RAISE, lean: -face * 0.1, lift: 0, hurt: false };
    switch (f.act) {
      case ACT.LIGHT1:
      case ACT.LIGHT2:
      case ACT.LIGHT3: {
        const [w] = lightOf(kit, f.act - ACT.LIGHT1);
        return since < w ? { frame: SWORD_RAISE, lean: -face * 0.06, lift: 0, hurt: false } : { frame: BOWL_RELEASE, lean: face * (f.act === ACT.LIGHT3 ? 0.18 : 0.1), lift: 0, hurt: false };
      }
      case ACT.CHARGE: {
        const k = Math.min(1, since / fillMs(kit));
        const shiver = k >= 1 ? Math.sin(now / 30) * 0.03 : 0;
        return { frame: SWORD_RAISE, lean: -face * 0.2 * k + shiver, lift: 0, hurt: false };
      }
      case ACT.HEAVY:
        return since < HEAVY[0] ? { frame: SWORD_RAISE, lean: -face * 0.2, lift: 0, hurt: false } : { frame: BOWL_RELEASE, lean: face * 0.26, lift: Math.max(0, Math.sin(Math.min(1, (since - HEAVY[0]) / HEAVY[1]) * Math.PI) * 5), hurt: false };
      case ACT.BLOCK:
        return { frame: SWORD_GUARD, lean: -face * 0.05, lift: 0, hurt: false };
      case ACT.ROLL: {
        const k = Math.min(1, since / ROLL_MS);
        return { frame: null, lean: face * k * Math.PI * 2, lift: Math.sin(k * Math.PI) * 6, hurt: false };
      }
      case ACT.STUN:
        // Dazed by a stomp: a slow, wide reel.
        if (f.flags & FLAG.DAZED) return { frame: null, lean: Math.sin(now / 130) * 0.24, lift: 0, hurt: false };
        return { frame: null, lean: Math.sin(now / 55) * 0.1, lift: 0, hurt: true };
      case ACT.THROW:
        return since < THROW[0] ? { frame: SWORD_RAISE, lean: -face * 0.15, lift: 0, hurt: false } : { frame: BOWL_RELEASE, lean: face * 0.2, lift: 0, hurt: false };
      case ACT.SPIN:
        return { frame: BOWL_RELEASE, lean: 0, lift: 2, hurt: false };
      // The bow loosed, a bomb lobbed.
      case ACT.SHOOT:
        return since < SHOOT[0] ? { frame: SWORD_RAISE, lean: -face * 0.12, lift: 0, hurt: false } : { frame: BOWL_RELEASE, lean: face * (kit === KIT.BOMBER ? 0.22 : 0.06), lift: 0, hurt: false };
      // The ultimates: the archer, bow up; the bomber, crouched over the fuse; the tank, up, then the stamp.
      case ACT.CAST: {
        if (kit === KIT.TANK) return since < CAST[0] ? { frame: SWORD_RAISE, lean: -face * 0.15, lift: Math.sin((since / CAST[0]) * Math.PI * 0.5) * 8, hurt: false } : { frame: BOWL_RELEASE, lean: 0, lift: 0, hurt: false };
        if (kit === KIT.BOMBER) return { frame: SWORD_GUARD, lean: Math.sin(now / 40) * 0.05, lift: -2, hurt: false };
        return { frame: SWORD_RAISE, lean: 0, lift: since < CAST[0] ? 3 : 0, hurt: false };
      }
      // The Goliath: the club up, then down; the crouch, the leap, the landing; the whirl.
      case ACT.SMASH:
        since = this.smashSince(f, since);
        return since < SMASH[0] ? { frame: SWORD_RAISE, lean: -face * (0.08 + 0.1 * (since / SMASH[0])), lift: 0, hurt: false } : { frame: BOWL_RELEASE, lean: face * 0.22, lift: 0, hurt: false };
      case ACT.STOMP: {
        if (since < STOMP[0]) return { frame: SWORD_RAISE, lean: 0, lift: -2, hurt: false };
        const k = (since - STOMP[0]) / STOMP[1];
        if (k < 1) return { frame: SWORD_RAISE, lean: face * 0.08, lift: Math.sin(k * Math.PI) * (kit === KIT.TANK ? 26 : 64), hurt: false };
        return { frame: BOWL_RELEASE, lean: 0, lift: 0, hurt: false };
      }
      case ACT.GRAB:
        return { frame: SWORD_GUARD, lean: Math.sin(now / 70) * 0.08, lift: 0, hurt: false };
      case ACT.HELD: {
        // In the Goliath's grip by the legs, swung round flat out sideways
        // (head outward), arms flailing.
        const out = Math.cos(this.holdAngle.values().next().value ?? 0) >= 0 ? 1 : -1;
        return { frame: null, lean: out * (Math.PI / 2) + Math.sin(now / 45) * 0.12, lift: HOLD_LIFT, hurt: true };
      }
    }
    if (f.flags & FLAG.KNOCKED) return { frame: null, lean: 0, lift: 0, hurt: true };
    return { frame: null, lean: 0, lift: 0, hurt: false };
  }

  /** The small things that make them feel there: feet in the sand, a dash's afterimage, a skid, a charge. */
  private liveliness(f: F, pos: { x: number; y: number }, avatar: Avatar, color: number, since: number, now: number) {
    const giant = isGiant(f);
    let st = this.strides.get(f.id);
    if (!st) this.strides.set(f.id, (st = { x: pos.x, y: pos.y, d: 0, at: 0, full: false }));
    const [dx, dy] = [pos.x - st.x, pos.y - st.y];
    const moved = Math.hypot(dx, dy);
    [st.x, st.y] = [pos.x, pos.y];
    if (moved > 1) return;
    // (A stride's length, a Goliath's a good deal longer.)
    st.d += moved;
    if (st.d > (giant ? 1.7 : 1.15) && f.act !== ACT.ROLL) {
      st.d = 0;
      this.juice.step(pos.x, pos.y, giant);
      if (giant) {
        const near = this.near(pos.x, pos.y);
        arenafx.giantStep(near);
        this.shake = Math.max(this.shake, 0.07 * near);
      }
    }
    if (f.act === ACT.ROLL && now - st.at > 38) {
      st.at = now;
      const sp = avatar.sprite;
      this.juice.ghost(sp.texture, sp.x, sp.y, sp.scale.x, sp.scale.y, sp.anchor.x, sp.anchor.y, color, sp.zIndex - 0.1);
      this.juice.step(pos.x, pos.y, false);
    }
    if (f.flags & FLAG.KNOCKED && moved > 0.012 && now - st.at > 45) {
      st.at = now;
      this.juice.skid(pos.x, pos.y, Math.atan2(dy, dx));
    }
    // A charge gathering, with a ring and a glint for us when it's full.
    if (f.act === ACT.CHARGE) {
      const k = Math.min(1, since / fillMs(giant ? KIT.KNIGHT : kitOf(f)));
      if (Math.random() < 0.3 + 0.5 * k) this.juice.charge(pos.x, pos.y, k, color);
      if (k >= 1 && !st.full) {
        st.full = true;
        this.ringFx(pos.x, pos.y, 0xffe14f, 1);
        if (f.id === this.selfId()) arenafx.chargeFull();
      }
    } else st.full = false;
  }

  /** Sword and shield (in their colour), the ring under them, the slash's arc, and their bars. */
  private drawGear(f: F, pos: { x: number; y: number; aim: number }, since: number, now: number, avatar: Avatar, pose: Pose, moving = false) {
    let g = this.gear.get(f.id);
    if (!g) {
      g = new Graphics();
      this.scene.sorted.addChild(g);
      this.gear.set(f.id, g);
    }
    g.clear();
    const slot = this.slotOf(f.id);
    const color = this.colorOf(slot);
    const fx = this.wx(pos.x);
    const feet = this.wy(pos.y) - 4;
    const down = (f.flags & FLAG.DOWN) !== 0;
    g.position.set(0, 0);
    g.zIndex = avatar.sprite.zIndex + 0.4;
    if (!down) this.liveliness(f, pos, avatar, color, since, now);
    // After dark, each stands in a pool of light of their own colour, on the
    // sand around their feet (over them, it'd wash them out); the Goliath in a great red one.
    if (!down) {
      if (isGiant(f)) this.glows.add(fx, feet - 8, 0xff4a2a, 3.6, 2.2, 0.55);
      else this.glows.add(fx, feet, color, 2, 1.3, 0.6);
    }
    if (isGiant(f)) {
      this.giantGear(g, f, fx, feet, since, now, pose, color, moving);
      // (Its smash swept out on the sand, the way it aims: up and down too.)
      if (!down) this.arc(f, pos, since, now, color);
      return;
    }
    const face = Math.cos(pos.aim) >= 0 ? 1 : -1;
    // The ring under them.
    g.ellipse(fx, feet + 2, 12, 5).stroke({ width: f.id === this.selfId() ? 2 : 1.5, color, alpha: down ? 0.3 : 0.85 });
    if (down) return;
    // Charging: a glow building under them.
    if (f.act === ACT.CHARGE || (f.id === this.selfId() && this.me.charging)) {
      const k = Math.min(1, since / fillMs(kitOf(f)));
      g.ellipse(fx, feet + 2, 10 + k * 8, 4 + k * 3).fill({ color: 0xff9a3f, alpha: 0.18 + 0.3 * k });
      if (k >= 1 && Math.floor(now / 120) % 2) g.ellipse(fx, feet + 2, 20, 8).stroke({ width: 1, color: 0xffe14f, alpha: 0.9 });
      if (f.id === this.selfId() && this.me.charging) this.lungeMarker(now);
    }
    const ox = fx;
    const oy = feet - pose.lift;
    const line = (x1: number, y1: number, x2: number, y2: number, col: number, w = 2) => {
      const n = Math.max(1, Math.abs(x2 - x1), Math.abs(y2 - y1));
      for (let k = 0; k <= n; k++) g!.rect(Math.round(x1 + ((x2 - x1) * k) / n), Math.round(y1 + ((y2 - y1) * k) / n), w, w).fill({ color: col });
    };
    const blocking = f.act === ACT.BLOCK || (f.id === this.selfId() && this.me.blocking && f.act === ACT.NONE);
    const swinging = [ACT.LIGHT1, ACT.LIGHT2, ACT.LIGHT3, ACT.HEAVY, ACT.THROW].includes(f.act);
    const kit = kitOf(f);
    const charging = f.act === ACT.CHARGE || (f.id === this.selfId() && this.me.charging);
    const chargeK = Math.min(1, (f.act === ACT.CHARGE ? since : now - this.me.pressAt - HOLD_MS) / fillMs(kit));
    // When the swing's blow lands (its wind-up done).
    const windup = f.act === ACT.HEAVY ? HEAVY[0] : f.act === ACT.THROW ? THROW[0] : swinging ? lightOf(kit, f.act - ACT.LIGHT1)[0] : 0;
    drawArms(g, ox, oy, { kit, act: f.act, since, now, face, aim: pos.aim, color, blocking, swinging, charging, chargeK, windup });

    // What they're holding, over their shoulder.
    if (f.holding === 2) line(ox - face * 10, oy - 6, ox + face * 6, oy - 40, 0x8f6236, 2);
    if (f.holding === 3) g.circle(ox - face * 10, oy - 18, 4).fill({ color: 0x2f2c38 }).stroke({ width: 1, color: 0x1a1020 });
    // Dazed: stars wheeling round their head (the far side of the wheel dimmer, smaller).
    if (f.flags & FLAG.DAZED) {
      const hx = ox + Math.sin(now / 130) * 0.24 * 26;
      for (let k = 0; k < 3; k++) {
        const a = now / 170 + (k / 3) * Math.PI * 2;
        const sx = Math.round(hx + Math.cos(a) * 15);
        const sy = Math.round(oy - 27 + Math.sin(a) * 5);
        const near = Math.sin(a) > 0;
        const c = near ? 0xffe14f : 0xd9a83a;
        g.rect(sx - 2, sy - 5, 4, 10).fill({ color: 0x2b2233 });
        g.rect(sx - 5, sy - 2, 10, 4).fill({ color: 0x2b2233 });
        g.rect(sx - 1, sy - 4, 2, 8).fill({ color: c });
        g.rect(sx - 4, sy - 1, 8, 2).fill({ color: c });
        g.rect(sx - 2, sy - 2, 4, 4).fill({ color: c });
        if (near) g.rect(sx - 1, sy - 1, 2, 2).fill({ color: 0xfffbe0 });
      }
    }
    if (!down) this.buffFx(g, f, fx, feet, 38, 17, now, moving);
    // Bars over the head: health in their colour, rage under it.
    const bx = Math.round(fx) - 15;
    const by = Math.round(oy) - 52;
    g.rect(bx - 1, by - 1, 32, 6).fill({ color: 0x1a1020 });
    g.rect(bx, by, 30, 4).fill({ color: 0x3a3046 });
    const full = this.maxHp(f);
    g.rect(bx, by, Math.round((30 * Math.max(0, f.hp)) / full), 4).fill({ color: f.hp < full * 0.3 ? 0xff4f6a : color });
    g.rect(bx, by + 5, 30, 1).fill({ color: 0x1a1020 });
    g.rect(bx, by + 5, Math.round((30 * f.rage) / 100), 1).fill({ color: f.rage >= 100 ? (Math.floor(now / 150) % 2 ? 0xffe14f : 0xc77dff) : 0xc77dff });
    if (f.flags & FLAG.FURY) g.rect(bx - 3, by - 3, 36, 10).stroke({ width: 1, color: 0xff9a3f, alpha: 0.7 + 0.3 * Math.sin(now / 80) });
    // The swing's arc, swept out on the sand (in the effects layer).
    this.arc(f, pos, since, now, color);
  }

  /**
   * The Goliath itself (its own brute, drawn by goliathart, in place of an
   * avatar), posed by what it's doing: its club hanging low in its fist (the
   * head dragged as it walks), hauled up and brought crashing down, raised
   * overhead for the leap, slung on its back while it whirls someone. A
   * great ring under it, its shadow, its bars over its head (its health out
   * of its own, far more).
   */
  private giantGear(g: Graphics, f: F, fx: number, feet: number, since: number, now: number, pose: Pose, color: number, moving: boolean) {
    const down = (f.flags & FLAG.DOWN) !== 0;
    // (Whirling someone, it turns with them, round and round.)
    const hold = f.act === ACT.GRAB ? this.holdAngle.get(f.id) : undefined;
    if (f.act !== ACT.GRAB) this.holdAngle.delete(f.id);
    const face: 1 | -1 = hold !== undefined ? (Math.cos(hold) >= 0 ? 1 : -1) : Math.cos(fromU16(f.aim)) >= 0 ? 1 : -1;
    // A great dark ring under it, and its shadow (a shrinking one, mid-leap).
    const shadow = pose.lift > 4 ? 1 - Math.min(0.5, pose.lift / 92) : 1;
    g.ellipse(fx, feet + 2, 32 * shadow, 12 * shadow).fill({ color: 0x000000, alpha: 0.3 });
    g.ellipse(fx, feet + 2, 32, 12).stroke({ width: 3, color, alpha: down ? 0.3 : 0.9 });
    let act: GoliathAct = moving ? "walk" : "idle";
    let k = 0;
    const self = f.id === this.selfId();
    if (down) act = "down";
    else
      switch (f.act) {
        case ACT.SMASH: {
          const ss = this.smashSince(f, since);
          if (ss < SMASH[0]) [act, k] = ["windup", ss / SMASH[0]];
          else [act, k] = ["smash", (ss - SMASH[0]) / (SMASH[1] + SMASH[2])];
          break;
        }
        case ACT.CHARGE:
          [act, k] = ["charge", since / GIANT_CHARGE_MS];
          break;
        case ACT.STOMP:
          if (since < STOMP[0]) act = "crouch";
          else if (since < STOMP[0] + STOMP[1]) act = "air";
          else [act, k] = ["land", (since - STOMP[0] - STOMP[1]) / STOMP[2]];
          break;
        case ACT.GRAB:
          act = "grab";
          break;
        case ACT.BLOCK:
          act = "block";
          break;
        case ACT.STUN:
          act = "stun";
          break;
        case ACT.ROLL:
          act = "dash";
          break;
        default:
          if (f.flags & FLAG.KNOCKED) act = "stun";
          // Our own smash shows the moment it's pressed.
          else if (self && f.act === ACT.NONE && now - this.me.swingAt < SMASH[0]) [act, k] = ["windup", (now - this.me.swingAt) / SMASH[0]];
          else if (self && this.me.charging) [act, k] = ["charge", 0];
          else if (self && now < this.me.rollUntil) act = "dash";
      }
    const oy = feet - pose.lift;
    // Winding up our stomp: where it'll land, and how wide its shockwave.
    if (self && act === "charge") this.stompMarker(now);
    // Whirling someone: where they'll be hurled (as far as the mouse, a dash at most).
    if (self && f.act === ACT.GRAB) {
      // (The mouse's spot, a dash off at most: steady, however they swing.)
      {
        const far = Math.max(HURL_MIN, Math.min(HURL_DIST, this.mouseReach() ?? HURL_DIST));
        const lx = this.wx(this.me.x + Math.cos(this.me.aim) * far);
        const ly = this.wy(this.me.y + Math.sin(this.me.aim) * far);
        const p = 0.5 + 0.5 * Math.sin(now / 90);
        this.fx.ellipse(lx, ly, 20, 9).stroke({ width: 2, color: 0xff4f1a, alpha: 0.5 + 0.4 * p });
        this.fx.rect(Math.round(lx) - 7, Math.round(ly) - 1, 14, 2).fill({ color: 0xff4f1a, alpha: 0.9 });
        this.fx.rect(Math.round(lx) - 1, Math.round(ly) - 5, 2, 10).fill({ color: 0xff4f1a, alpha: 0.9 });
      }
    }
    // (Dashing, it faces the way it's going.)
    const dashFace: 1 | -1 = self && act === "dash" ? (Math.cos(this.me.rollDir) >= 0 ? 1 : -1) : face;
    const look: GoliathPose = { face: dashFace, act, k, step: (now / 1000) * (act === "dash" ? 22 : 8), now, rage: f.rage >= 100 || f.act === ACT.GRAB, hurt: pose.hurt };
    // Its hands out to the one it holds (at arm's length, up at its hands).
    if (hold !== undefined) look.hold = { dx: Math.cos(hold) * HOLD_R * TILE, dy: Math.sin(hold) * HOLD_R * 0.55 * TILE - HOLD_LIFT };
    this.dashFx(f.id, g, fx, oy, feet, now, act === "dash", look);
    // Whirling someone round: the trail they leave (the half behind it, first).
    const whirl = f.act === ACT.GRAB && since < GRAB_SPIN_MS ? this.whirlTrail(fx, feet, since) : null;
    // Whirling, it can't be hurt: a golden aura about it, motes rising round it.
    const aura = f.act === ACT.GRAB ? (front: boolean) => {
      const p = 0.5 + 0.5 * Math.sin(now / 110);
      if (!front) {
        g.ellipse(fx, oy - 53, 44, 67).fill({ color: 0xffd23f, alpha: 0.1 + 0.06 * p });
        g.ellipse(fx, oy - 53, 44 + p * 3, 67 + p * 3).stroke({ width: 2, color: 0xffd23f, alpha: 0.35 + 0.3 * p });
      }
      for (let i = 0; i < 8; i++) {
        const a = now / 260 + (i / 8) * Math.PI * 2;
        if (Math.sin(a) > 0 !== front) continue;
        const rise = ((now / 14 + i * 23) % 80) / 80;
        g.rect(Math.round(fx + Math.cos(a) * 34), Math.round(oy - 10 - rise * 90 + Math.sin(a) * 6), 3, 3).fill({ color: i % 2 ? 0xfff1a8 : 0xffd23f, alpha: 0.9 * (1 - rise) });
      }
    } : null;
    aura?.(false);
    whirl?.(g, true);
    drawGoliath(g, fx, oy, look);
    whirl?.(g, false);
    aura?.(true);
    // (The fury: the whole giant blinking red.)
    g.tint = f.flags & FLAG.FURY && !down ? furyTint(now) : 0xffffff;
    if (down) return;
    this.buffFx(g, f, fx, feet, GOLIATH_HEIGHT + 8, 53, now, moving);
    // Dust kicked up where the club comes down.
    // (Where it lands: the way it aimed.)
    if (act === "smash" && since < SMASH[0] + 180) {
      const ax = Math.cos(fromU16(f.aim)) * 50;
      const ay = Math.sin(fromU16(f.aim)) * 50 * 0.7;
      for (let i = 0; i < 4; i++) g.rect(Math.round(fx + ax - 16 + i * 9), Math.round(feet + ay - 3 - (i % 2) * 2), 6, 3).fill({ color: 0xe8d3a3, alpha: 0.8 });
    }
    // Its bars, high over its head: health (out of its own), rage under it.
    const bx = Math.round(fx) - 30;
    const by = Math.round(oy) - GOLIATH_HEIGHT - 12;
    const hp = Math.max(0, f.hp) / GIANT_HP;
    g.rect(bx - 1, by - 1, 62, 8).fill({ color: 0x1a1020 });
    g.rect(bx, by, 60, 6).fill({ color: 0x3a3046 });
    g.rect(bx, by, Math.round(60 * hp), 6).fill({ color: hp < 0.3 ? 0xff4f6a : color });
    g.rect(bx, by + 7, 60, 2).fill({ color: 0x1a1020 });
    g.rect(bx, by + 7, Math.round((60 * f.rage) / 100), 2).fill({ color: f.rage >= 100 ? (Math.floor(now / 150) % 2 ? 0xffd23f : 0xff4f1a) : 0xff4f1a });
  }

  /**
   * Our heavy blow, charging: a dotted line of the lunge out to where it'll
   * carry us (further the longer it's held), and there, the sweep of the
   * blow (its reach, its arc), pulsing gold once it's full.
   */
  private lungeMarker(now: number) {
    if (!this.me.pressAt) return;
    const held = now - this.me.pressAt - HOLD_MS;
    const kit = this.myKit();
    const c = Math.max(0, Math.min(1, (held - HEAVY_MIN_MS) / (fillMs(kit) - HEAVY_MIN_MS)));
    if (kit === KIT.ARCHER) return this.bowMarker(c, now);
    if (kit === KIT.BOMBER) return this.lobMarker(Math.max(0, Math.min(1, (held - HEAVY_MIN_MS) / (BIG_BOMB_FULL_MS - HEAVY_MIN_MS))), now);
    if (kit === KIT.TANK) return this.stompMarker(now, { chargeMs: HEAVY_FULL_MS, min: TANK_LEAP_MIN, max: TANK_LEAP, r: TANK_STOMP_R });
    const lunge = KIT_LUNGE[kit] + (KIT_LUNGE_MAX[kit] - KIT_LUNGE[kit]) * c;
    const a = this.me.aim;
    const lx = this.me.x + Math.cos(a) * lunge;
    const ly = this.me.y + Math.sin(a) * lunge;
    const g = this.fx;
    const [x0, y0] = [this.wx(this.me.x), this.wy(this.me.y)];
    const [x1, y1] = [this.wx(lx), this.wy(ly)];
    const full = c >= 1;
    const pulse = full ? 0.5 + 0.5 * Math.sin(now / 90) : 0;
    const col = full ? 0xffd23f : 0xff9a3f;
    // The lunge, dotted.
    const n = Math.max(2, Math.round(lunge * 4));
    for (let i = 1; i < n; i++) {
      const k = i / n;
      g.rect(Math.round(x0 + (x1 - x0) * k) - 1, Math.round(y0 + (y1 - y0) * k) - 1, 3, 3).fill({ color: col, alpha: 0.75 });
    }
    // Where it carries us: a mark, and the sweep of the blow ahead of it.
    g.ellipse(x1, y1, 9, 4).stroke({ width: 2, color: col, alpha: 0.7 + 0.3 * pulse });
    const r = KIT_HEAVY_REACH[kit] * TILE * 0.85;
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const b = a - HEAVY_ARC + ((HEAVY_ARC * 2) * i) / steps;
      g.rect(Math.round(x1 + Math.cos(b) * r) - 1, Math.round(y1 + Math.sin(b) * r * 0.75) - 1, 3, 3).fill({ color: col, alpha: 0.35 + 0.35 * pulse });
    }
  }

  /**
   * The bow drawn for the triple shot: the arrows' line out along the aim,
   * on till the first wall (they fly till they hit something), brighter
   * the further it's drawn; gold when it's full.
   */
  private bowMarker(c: number, now: number) {
    const g = this.fx;
    const a = this.me.aim;
    const full = c >= 1;
    const col = full ? 0xffd23f : 0x9fe07a;
    const len = Math.hypot(this.ring.w, this.ring.h);
    // (Stopped short by a wall or a pillar, as the arrow would be.)
    let reach = len;
    for (let d = 0.5; d < len; d += 0.25) {
      if (!this.ring.free(this.me.x + Math.cos(a) * d, this.me.y + Math.sin(a) * d, 0.05)) {
        reach = d;
        break;
      }
    }
    const n = Math.round(reach * 3);
    for (let i = 2; i <= n; i++) {
      const d = (i / n) * reach;
      const x = this.wx(this.me.x + Math.cos(a) * d);
      const y = this.wy(this.me.y + Math.sin(a) * d) - 14;
      if (i % 2 === 0 || full) g.rect(Math.round(x) - 1, Math.round(y) - 1, 2, 2).fill({ color: col, alpha: (0.35 + 0.5 * c) * (1 - (i / n) * 0.6) });
    }
    const ex = this.wx(this.me.x + Math.cos(a) * reach);
    const ey = this.wy(this.me.y + Math.sin(a) * reach) - 14;
    const p = full ? 0.5 + 0.5 * Math.sin(now / 80) : 0;
    g.circle(ex, ey, 4 + 2 * p).stroke({ width: 1.5, color: col, alpha: 0.8 });
  }

  /**
   * A big bomb about to be lobbed: its arc out to where it'll land (the
   * mouse), and there, the blast's reach (growing with the charge).
   */
  private lobMarker(c: number, now: number) {
    const g = this.fx;
    const a = this.me.aim;
    const dist = Math.max(LOB_MIN, Math.min(LOB_RANGE, this.mouseReach() ?? LOB_RANGE * 0.7));
    const full = c >= 1;
    const col = full ? 0xffd23f : 0xff9a3f;
    const [x0, y0] = [this.wx(this.me.x), this.wy(this.me.y)];
    const [x1, y1] = [this.wx(this.me.x + Math.cos(a) * dist), this.wy(this.me.y + Math.sin(a) * dist)];
    const n = Math.max(3, Math.round(dist * 3));
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const lift = Math.sin(k * Math.PI) * (12 + dist * 5);
      g.rect(Math.round(x0 + (x1 - x0) * k) - 1, Math.round(y0 + (y1 - y0) * k - lift) - 1, 3, 3).fill({ color: col, alpha: 0.7 });
    }
    const p = 0.5 + 0.5 * Math.sin(now / 90);
    const r = (BIG_BOMB_R[0] + (BIG_BOMB_R[1] - BIG_BOMB_R[0]) * c) * TILE * 0.85;
    g.ellipse(x1, y1, r, r * 0.7).stroke({ width: 2, color: 0xff4f1a, alpha: 0.45 + 0.35 * p });
    g.ellipse(x1, y1, r, r * 0.7).fill({ color: 0xff4f1a, alpha: 0.08 + 0.06 * p });
  }

  /**
   * Our stomp, wound up: a dotted arc of the leap out to where it'll land
   * (as far as the charge carries it, never past the mouse), and there, a
   * ring the size of the shockwave (growing with the charge, pulsing when
   * it's full), a cross at its heart.
   */
  private stompMarker(now: number, o = { chargeMs: GIANT_CHARGE_MS, min: STOMP_LEAP_MIN, max: STOMP_LEAP, r: STOMP_R }) {
    if (!this.me.pressAt) return;
    const held = now - this.me.pressAt - HOLD_MS;
    const c = Math.max(0, Math.min(1, (held - HEAVY_MIN_MS) / (o.chargeMs - HEAVY_MIN_MS)));
    let leap = o.min + (o.max - o.min) * c;
    const cap = this.mouseReach();
    if (cap !== null) leap = Math.min(leap, cap);
    const a = this.me.aim;
    const lx = this.me.x + Math.cos(a) * leap;
    const ly = this.me.y + Math.sin(a) * leap;
    const g = this.fx;
    const [x0, y0] = [this.wx(this.me.x), this.wy(this.me.y)];
    const [x1, y1] = [this.wx(lx), this.wy(ly)];
    const full = c >= 1;
    const pulse = full ? 0.5 + 0.5 * Math.sin(now / 90) : 0;
    const col = full ? 0xffd23f : 0xff8a2a;
    // The leap's arc, dotted.
    const n = Math.max(2, Math.round(leap * 3));
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const x = x0 + (x1 - x0) * k;
      const y = y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * 26 * (0.4 + leap / o.max) * (o.max / STOMP_LEAP);
      g.rect(Math.round(x) - 1, Math.round(y) - 1, 3, 3).fill({ color: col, alpha: 0.7 });
    }
    // The shockwave's reach where it lands.
    const r = o.r * (1 + c * 0.3) * TILE;
    g.ellipse(x1, y1, r, r * 0.5).fill({ color: col, alpha: 0.1 + 0.08 * pulse });
    g.ellipse(x1, y1, r, r * 0.5).stroke({ width: 2, color: col, alpha: 0.55 + 0.35 * pulse });
    g.ellipse(x1, y1, r * (0.35 + 0.65 * c), r * 0.5 * (0.35 + 0.65 * c)).stroke({ width: 1, color: 0xffffff, alpha: 0.4 });
    g.rect(Math.round(x1) - 6, Math.round(y1) - 1, 12, 2).fill({ color: col, alpha: 0.9 });
    g.rect(Math.round(x1) - 1, Math.round(y1) - 4, 2, 8).fill({ color: col, alpha: 0.9 });
  }

  /**
   * The Goliath's dash: afterimages of it strung out behind (where it was a
   * moment ago, a cold blue, fading), wind-streaks streaming back off it,
   * dust kicked up at its heels. (Its path's kept a moment, for the
   * afterimages; they fade out a beat after it stops.)
   */
  private dashFx(id: number, g: Graphics, fx: number, oy: number, feet: number, now: number, dashing: boolean, look: GoliathPose) {
    const path = this.giantPath.get(id) ?? [];
    this.giantPath.set(id, path);
    path.push({ x: fx, y: oy, t: now });
    while (path.length && path[0].t < now - 400) path.shift();
    if (dashing) this.dashSeen.set(id, now);
    const fade = Math.max(0, 1 - (now - (this.dashSeen.get(id) ?? -1e9)) / 160);
    let ghosts = this.ghosts.get(id);
    if (!ghosts) {
      ghosts = [];
      for (let i = 0; i < 4; i++) {
        const gh = new Graphics();
        gh.tint = 0xc4ecff;
        this.scene.sorted.addChild(gh);
        ghosts.push(gh);
      }
      this.ghosts.set(id, ghosts);
    }
    // Where it was `ago` ms back.
    const at = (ago: number) => {
      const t = now - ago;
      for (let i = path.length - 1; i >= 0; i--) if (path[i].t <= t) return path[i];
      return path[0];
    };
    ghosts.forEach((gh, i) => {
      gh.clear();
      gh.zIndex = g.zIndex - 0.05 - i * 0.01;
      if (fade <= 0) return;
      const p = at((i + 1) * 40);
      if (Math.hypot(p.x - fx, p.y - oy) < 6) return;
      gh.alpha = (0.5 - i * 0.11) * fade;
      drawGoliath(gh, p.x, p.y, { ...look, rage: false, hurt: false });
    });
    if (!dashing) return;
    // Which way it's going (on screen), from where it was a moment ago.
    const back = at(90);
    let dx = fx - back.x;
    let dy = oy - back.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) {
      dx = look.face;
      dy = 0;
    } else {
      dx /= len;
      dy /= len;
    }
    // Wind-streaks streaming back off it, at all heights up its body.
    const streak = (x1: number, y1: number, x2: number, y2: number, w: number, color: number, alpha: number) => {
      const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / 2));
      for (let s = 0; s <= n; s++) g.rect(Math.round(x1 + ((x2 - x1) * s) / n), Math.round(y1 + ((y2 - y1) * s) / n), w, w).fill({ color, alpha: alpha * (1 - s / n) });
    };
    for (let j = 0; j < 8; j++) {
      const h = 10 + ((j * 37 + Math.floor(now / 45) * 11) % 76);
      const side = ((j * 29) % 50) - 25;
      const start = 24 + ((j * 17 + Math.floor(now / 30) * 7) % 30);
      const sx = fx - dx * start - dy * side * 0.5;
      const sy = oy - h - dy * start + dx * side * 0.2;
      const l = 22 + ((j * 13) % 24);
      streak(sx, sy, sx - dx * l, sy - dy * l, j % 3 === 0 ? 3 : 2, j % 2 ? 0xffffff : 0xbfe9ff, 0.85);
    }
    // Dust at its heels.
    for (let i = 0; i < 6; i++) {
      const d = 16 + i * 8 + ((Math.floor(now / 50) + i) % 3) * 3;
      g.rect(Math.round(fx - dx * d + ((i % 2) * 2 - 1) * 6), Math.round(feet - 3 - dy * d - (i % 3) * 2), 8 - i, 5 - (i >> 1)).fill({ color: 0xe8d3a3, alpha: 0.8 - i * 0.12 });
    }
  }

  /**
   * The whirl's trail: the one the Goliath's swinging round leaves a blazing
   * ribbon behind them (orange fringed with red, a hot yellow core),
   * longer the faster and longer it's whirled, wind-streaks round its rim,
   * and a swirl of sand on the ground beneath. Returns a drawer for the
   * half of it behind the Goliath (`behind`) or in front.
   */
  private whirlTrail(fx: number, feet: number, since: number): ((g: Graphics, behind: boolean) => void) | null {
    const held = this.state?.fighters.find((v) => v.act === ACT.HELD);
    const hp = held && this.held.get(held.id);
    if (!hp) return null;
    const vx = this.wx(hp.x);
    const vy = this.wy(hp.y) - 4;
    const r = Math.hypot(vx - fx, vy - feet);
    if (r < 8) return null;
    const a = Math.atan2(vy - feet, vx - fx);
    const k = Math.min(1, since / GRAB_SPIN_MS);
    const length = 1.4 + 1.4 * k;
    const lift = 54;
    return (g, behind) => {
      const steps = 46;
      for (let i = steps; i >= 0; i--) {
        const s = (i / steps) * length;
        const b = a - s;
        if (Math.sin(b) < 0 !== behind) continue;
        const px = fx + Math.cos(b) * r;
        const py = feet + Math.sin(b) * r;
        const left = 1 - s / length;
        // The sand swirl, on the ground under it.
        if (i % 3 === 0) g.rect(Math.round(px - 2), Math.round(py - 1), 4, 2).fill({ color: 0xe8d3a3, alpha: 0.55 * left });
        // The ribbon, up where they're held.
        const w = Math.max(2, Math.round(4 + 12 * left));
        g.rect(Math.round(px - w / 2), Math.round(py - lift - w / 2), w, w).fill({ color: 0xc8321c, alpha: 0.35 * left });
        const w2 = Math.max(2, Math.round(w * 0.65));
        g.rect(Math.round(px - w2 / 2), Math.round(py - lift - w2 / 2), w2, w2).fill({ color: 0xff8a2a, alpha: 0.6 * left });
        const w3 = Math.max(1, Math.round(w * 0.3));
        g.rect(Math.round(px - w3 / 2), Math.round(py - lift - w3 / 2), w3, w3).fill({ color: 0xfff1a8, alpha: 0.85 * left });
        // Wind-streaks round its rim, inside and out.
        if (i % 2 === 0 && s < length * 0.7)
          for (const rr of [0.78, 1.2]) {
            const qx = fx + Math.cos(b - 0.15) * r * rr;
            const qy = feet + Math.sin(b - 0.15) * r * rr - lift * 0.8;
            g.rect(Math.round(qx), Math.round(qy), 2, 2).fill({ color: 0xffffff, alpha: 0.5 * left });
          }
      }
    };
  }

  /** A slash's crescent, a lunge's great sweep, the whirlwind's circle. */
  private arc(f: F, pos: { x: number; y: number; aim: number }, since: number, now: number, color: number) {
    const g = this.fx;
    const cx = this.wx(pos.x);
    const cy = this.wy(pos.y) - 14;
    const sweep = (reach: number, arc: number, k: number, col: number, width: number, alpha: number) => {
      const r = reach * TILE * 0.85;
      const from = pos.aim - arc;
      const to = pos.aim - arc + arc * 2 * k;
      const n = Math.max(4, Math.round(arc * 2 * k * 10));
      for (let i = 0; i <= n; i++) {
        const a = from + ((to - from) * i) / n;
        const fade = (i / n) * alpha;
        g.rect(Math.round(cx + Math.cos(a) * r) - width / 2, Math.round(cy + Math.sin(a) * r * 0.7) - width / 2, width, width).fill({ color: col, alpha: fade });
      }
    };
    switch (f.act) {
      case ACT.LIGHT1:
      case ACT.LIGHT2:
      case ACT.LIGHT3: {
        const k = isGiant(f) ? KIT.KNIGHT : kitOf(f);
        const [w, a] = lightOf(k, f.act - ACT.LIGHT1);
        if (shoots(k)) {
          const u = (since - w) / (a + 40);
          if (u >= 0 && u < 1) {
            const [ca, sa] = [Math.cos(pos.aim), Math.sin(pos.aim) * 0.7];
            const [r0, r1] = [12, KIT_LIGHT_REACH[k] * TILE * (0.7 + 0.3 * Math.min(1, u * 2.5))];
            const off = f.act === ACT.LIGHT2 ? 3 : -3;
            g.moveTo(cx + ca * r0 - sa * off, cy + sa * r0 + ca * off).lineTo(cx + ca * r1, cy + sa * r1).stroke({ width: 2, color: 0xffffff, alpha: 0.85 * (1 - u) });
            g.rect(Math.round(cx + ca * r1) - 1, Math.round(cy + sa * r1) - 1, 3, 3).fill({ color: 0xfff6d8, alpha: 1 - u });
          }
        } else if (since >= w && since < w + a + 80) sweep(KIT_LIGHT_REACH[k], KIT_LIGHT_ARC[k], Math.min(1, (since - w) / a), f.act === ACT.LIGHT3 ? 0xffe14f : 0xffffff, k === KIT.TANK ? 6 : f.act === ACT.LIGHT3 ? 4 : 3, 0.85);
        break;
      }
      case ACT.HEAVY:
        if (since >= HEAVY[0] && since < HEAVY[0] + HEAVY[1] + 100) {
          sweep(KIT_HEAVY_REACH[kitOf(f)], HEAVY_ARC, Math.min(1, (since - HEAVY[0]) / HEAVY[1]), 0xff9a3f, 5, 0.95);
          if (Math.random() < 0.6) this.dust(pos.x, pos.y, 1);
        }
        break;
      case ACT.SMASH: {
        // The Goliath's club: a faint warning arc the way it's aiming as it
        // hauls it up, then the great sweep there (any way: up and down too),
        // dust thrown up along it.
        since = this.smashSince(f, since);
        if (since < SMASH[0]) {
          const k = since / SMASH[0];
          const r = SMASH_REACH * TILE * 0.85;
          const n = 22;
          for (let i = 0; i <= n; i++) {
            const a = pos.aim - SMASH_ARC + (SMASH_ARC * 2 * i) / n;
            g.rect(Math.round(cx + Math.cos(a) * r) - 1, Math.round(cy + 14 + Math.sin(a) * r * 0.7) - 1, 3, 3).fill({ color: 0xff6a4a, alpha: 0.18 + 0.35 * k });
          }
        } else if (since < SMASH[0] + SMASH[1] + 150) {
          const k = Math.min(1, (since - SMASH[0]) / SMASH[1]);
          for (const [reach, col, w] of [[SMASH_REACH, 0xe8d3a3, 7], [SMASH_REACH * 0.7, 0xfff1c8, 5]] as const) {
            const r = reach * TILE * 0.85;
            const to = pos.aim - SMASH_ARC + SMASH_ARC * 2 * k;
            const n = Math.max(4, Math.round(SMASH_ARC * 2 * k * 12));
            for (let i = 0; i <= n; i++) {
              const a = pos.aim - SMASH_ARC + ((to - (pos.aim - SMASH_ARC)) * i) / n;
              g.rect(Math.round(cx + Math.cos(a) * r) - w / 2, Math.round(cy + 14 + Math.sin(a) * r * 0.7) - w / 2, w, w).fill({ color: col, alpha: 0.9 * (i / n) });
            }
          }
          if (since < SMASH[0] + 60) {
            const d = SMASH_REACH * 0.75;
            this.dust(pos.x + Math.cos(pos.aim) * d, pos.y + Math.sin(pos.aim) * d, 4);
          }
        }
        break;
      }
      case ACT.SPIN: {
        const r = KIT_SPIN_REACH[kitOf(f)] * TILE * 0.85;
        for (let i = 0; i < 24; i++) {
          const a = now / 70 + (i / 24) * Math.PI * 2;
          g.rect(Math.round(cx + Math.cos(a) * r) - 2, Math.round(cy + Math.sin(a) * r * 0.7) - 2, 4, 4).fill({ color: i % 3 ? 0xc77dff : 0xffffff, alpha: 0.4 + 0.5 * ((i / 24 + now / 500) % 1) });
        }
        break;
      }
    }
    void color;
  }

  // ---- the arena: gates, fire, spikes, gifts, missiles ---------------------------------

  private drawArena(s: State | null, serverNow: number, wallNow: number) {
    const g = this.floor.clear();
    const sg = this.spikesG.clear();
    void sg;
    const running = !!s && s.status !== LOBBY;
    // The gates shut while a match is on: portcullises at both.
    const a = this.arenaObj;
    if (running || this.ring.oval) {
      const gx = (a.x + a.w / 2 - 1) * TILE;
      // The parade: the south gate winched up for the champion.
      const pt = this.parade && s?.status === OVER ? (serverNow - this.parade.start) / 1000 : -1;
      const up = pt < 0 ? 0 : Math.min(1, Math.max(0, (pt - (SALUTE - 0.9)) / 0.8));
      for (const gy of this.ring.oval ? [(a.y + a.h - 1) * TILE] : [a.y * TILE, (a.y + a.h - 1) * TILE]) {
        const south = gy !== a.y * TILE;
        const lift = south ? Math.round(up * (TILE + 4)) : 0;
        if (south && up >= 1) continue;
        g.rect(gx, gy, TILE * 2, TILE - lift).fill({ color: 0x1a1020, alpha: 0.35 * (1 - up) });
        for (let k = 3; k < TILE * 2; k += 8) g.rect(gx + k, gy - 6 - lift, 3, TILE + 6).fill({ color: 0x3a3a44 });
        for (let k = 4; k < TILE; k += 10) g.rect(gx, gy + k - lift, TILE * 2, 2).fill({ color: 0x4a4a56 });
      }
    }
    if (!s || s.status === LOBBY) {
      for (const sp of this.giftSprites.values()) sp.visible = false;
      return;
    }
    // The fire: outside the closing ring, the sand burns.
    const fire = s.fire / 1000;
    if (fire < 1.14) {
      const cx = this.ring.w / 2;
      const cy = this.ring.h / 2;
      for (let y = 0; y < this.ring.h; y += 0.25) {
        const dy = (y + 0.125 - cy) / cy;
        // (In an amphitheatre the ring's a rounded square, like its walls.)
        const p = this.ring.oval ? ROUNDNESS : 2;
        const inside = fire ** p - Math.abs(dy) ** p;
        const half = inside > 0 ? inside ** (1 / p) * cx : 0;
        const x0 = cx - half;
        const x1 = cx + half;
        // (In an oval, the sand's own edge on this row.)
        const edge = this.ring.oval ? Math.max(0, 1 - Math.abs(dy) ** ROUNDNESS) ** (1 / ROUNDNESS) * cx : cx;
        const l = cx - edge;
        const r = cx + edge;
        if (x0 > l) g.rect(this.wx(l), this.wy(y), (x0 - l) * TILE, TILE / 4).fill({ color: 0xff4f1a, alpha: 0.22 });
        if (x1 < r) g.rect(this.wx(x1), this.wy(y), (r - x1) * TILE, TILE / 4).fill({ color: 0xff4f1a, alpha: 0.22 });
      }
      // Flames along the edge.
      for (let i = 0; i < 90; i++) {
        const t = (i / 90) * Math.PI * 2;
        // (Round a rounded square, in an amphitheatre.)
        const e = this.ring.oval ? 2 / ROUNDNESS : 1;
        const x = cx + Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** e * cx * fire;
        const y = cy + Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** e * cy * fire;
        if (x < 0 || y < 0 || x > this.ring.w || y > this.ring.h) continue;
        const flick = Math.sin(wallNow / 70 + i * 1.7) * 0.5 + 0.5;
        const h = 6 + flick * 8;
        g.rect(Math.round(this.wx(x)) - 2, Math.round(this.wy(y) - h), 4, h).fill({ color: flick > 0.5 ? 0xffd23f : 0xff6a1a, alpha: 0.85 });
        g.rect(Math.round(this.wx(x)) - 1, Math.round(this.wy(y) - h - 3), 2, 3).fill({ color: 0xfff4c4, alpha: flick });
      }
    }
    // (The lava's a lot of little blocks: redrawn a dozen times a second, no more.)
    if (s.lava < 1140 && wallNow - this.lavaAt > 80) {
      this.lavaAt = wallNow;
      this.drawLava(this.lavaG.clear(), s.lava / 1000, wallNow);
    } else if (s.lava >= 1140 && this.lavaAt) {
      this.lavaAt = 0;
      this.lavaG.clear();
    }
    this.disaster.drawFloor(g, wallNow);
    this.juice.drawFloor(g, performance.now());
    // The spikes: a rattle (red, the tips showing), then up with a snap, and straight back down.
    this.ring.spikes.forEach((sp, k) => {
      const phase = s.spikes[k] ?? 0;
      const [x0, y0, w, h] = [this.wx(sp.x), this.wy(sp.y), sp.w * TILE, sp.h * TILE];
      if (phase === 2 && this.lastSpikes[k] !== 2) {
        this.spikeUpAt[k] = wallNow;
        // (Heard only right by them: they come up all match long.)
        const near = this.capturing ? 1 - Math.hypot(sp.x + 1 - this.me.x, sp.y + 1 - this.me.y) / 5 : 0;
        if (near > 0) snd.spikes(near);
        this.dust(sp.x + sp.w / 2, sp.y + sp.h / 2, 5);
      }
      if (phase !== 2 && this.lastSpikes[k] === 2) this.spikeDownAt[k] = wallNow;
      this.lastSpikes[k] = phase;
      if (phase === 1) {
        const pulse = 0.25 + 0.25 * Math.sin(wallNow / 45);
        const jx = Math.round(Math.sin(wallNow / 19));
        g.rect(x0 + 3 + jx, y0 + 3, w - 6, h - 6).fill({ color: 0xff2a2a, alpha: pulse });
      }
      // How far up: a snap past full height and a settle; then down, quicker still.
      let up = 0;
      if (phase === 2) {
        const t = (wallNow - (this.spikeUpAt[k] ?? 0)) / 70;
        up = t < 1 ? t * 1.25 : 1 + 0.25 * Math.max(0, 1 - (t - 1) / 1.5);
      } else {
        const t = (wallNow - (this.spikeDownAt[k] ?? 0)) / 90;
        if (t < 1) up = 1 - t * t;
      }
      const tips = phase === 1 ? 2.5 * (0.6 + 0.4 * Math.sin(wallNow / 30)) : up * 11;
      if (tips > 0.5) {
        for (let yy = 9; yy < h - 6; yy += 9) {
          for (let xx = 9 + ((yy / 9) % 2) * 4; xx < w - 6; xx += 9) g.poly([x0 + xx - 3, y0 + yy + 1, x0 + xx + 3, y0 + yy + 1, x0 + xx, y0 + yy + 1 - tips]);
        }
        g.fill({ color: 0xc8ccd8 });
        for (let yy = 9; yy < h - 6; yy += 9) {
          for (let xx = 9 + ((yy / 9) % 2) * 4; xx < w - 6; xx += 9) g.rect(x0 + xx - 1, y0 + yy + 1 - tips, 1, tips * 0.75);
        }
        g.fill({ color: 0xffffff, alpha: 0.85 });
        // The dark slits they came out of, and a flash on their way up.
        if (phase === 2 && wallNow - (this.spikeUpAt[k] ?? 0) < 120) g.rect(x0 + 2, y0 + 2, w - 4, h - 4).stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
      }
    });
    // Gifts: falling (a shadow growing under them), then lying there bobbing.
    const keep = new Set<string>();
    for (const gf of s.gifts) {
      const key = `${gf.kind}:${gf.x}:${gf.y}`;
      keep.add(key);
      let sp = this.giftSprites.get(key);
      if (!sp) {
        sp = new Sprite(giftTexture(gf.kind));
        sp.anchor.set(0.5, 1);
        this.scene.sorted.addChild(sp);
        this.giftSprites.set(key, sp);
      }
      const x = gf.x / 100;
      const y = gf.y / 100;
      const left = Math.max(0, gf.landsMs - (serverNow - s.now));
      const fall = left / 900;
      g.ellipse(this.wx(x), this.wy(y), 6 + (1 - fall) * 5, 2 + (1 - fall) * 2).fill({ color: 0x000000, alpha: 0.25 });
      if (left <= 0) g.ellipse(this.wx(x), this.wy(y), 12 + Math.sin(wallNow / 200) * 2, 5).stroke({ width: 1, color: 0xffe14f, alpha: 0.6 });
      sp.visible = true;
      sp.scale.set(1.5);
      sp.rotation = left > 0 ? (wallNow / 90) % (Math.PI * 2) : 0;
      sp.position.set(Math.round(this.wx(x)) + this.disaster.giftTrembles(x, y, wallNow), Math.round(this.wy(y) - fall * 160 - (left <= 0 ? 3 + Math.sin(wallNow / 250) * 2 : 0)));
      sp.zIndex = this.wy(y);
    }
    for (const [key, sp] of this.giftSprites) {
      if (!keep.has(key)) {
        sp.destroy();
        this.giftSprites.delete(key);
      }
    }
  }

  private flyMissiles(dt: number) {
    const s = this.state;
    if (!s || s.status !== FIGHTING) {
      this.missiles = [];
      return;
    }
    const at = this.serverNow() - RENDER_DELAY_MS;
    this.missiles = this.missiles.filter((m) => {
      const speed = Math.hypot(m.vx, m.vy);
      let todo = speed * dt;
      while (todo > 1e-9) {
        if (m.left <= 0) return false;
        const step = Math.min(todo, 0.15, m.left);
        todo -= step;
        m.left -= step;
        const nx = m.x + (m.vx / speed) * step;
        const ny = m.y + (m.vy / speed) * step;
        const bomb = m.kind === GIFT.BOMB || m.kind === BIG_BOMB;
        if (!this.ring.free(nx, ny, 0.05)) return bomb;
        m.x = nx;
        m.y = ny;
        // On someone (the server says what it did): gone from here.
        const hit = s.fighters.some((f) => f.id !== m.by && !(f.flags & (FLAG.DOWN | FLAG.IFRAMES)) && (() => {
          const p = f.id === this.selfId() ? this.me : this.glide(f.id, at);
          // (Anywhere on them, feet to head.)
          const top = p.y - (isGiant(f) ? GIANT_H : BODY_H);
          return Math.hypot(p.x - nx, Math.min(p.y, Math.max(top, ny)) - ny) < (isGiant(f) ? GIANT_R : BODY_R) + 0.2;
        })());
        if (hit) return bomb;
      }
      return true;
    });
  }

  // ---- the champion's parade ----------------------------------------------------------

  /**
   * Where fighter f is in the parade now (arena tiles), and how they carry
   * themselves: all gathered in the middle, the champion in front, the rest
   * in a line behind; the champion's salute; then all out through the south
   * gate and down the carpet, slowly, the champion proud (turning to the
   * crowd, the sword thrust up), the rest shuffling, heads hung; at its foot
   * the champion leaps for joy. Null when there's no parade.
   */
  private marching(s: State, f: F, serverNow: number): Marching | null {
    const pr = this.parade;
    if (!pr || s.status !== OVER || !s.winner) return null;
    const t = (serverNow - pr.start) / 1000;
    const champ = f.id === s.winner;
    const k = Math.max(0, pr.order.indexOf(f.id));
    const off = champ ? 0 : PARADE_FIRST_GAP + PARADE_GAP * k;
    // Where it ends: just where the server will stand them after (the
    // tile its spot is in, as an avatar stands on a tile), so they stay put
    // when the parade's over. (The walk keeps to that tile's column.)
    const x0 = this.ring.w / 2 + (champ ? 0 : k % 2 === 0 ? -0.55 : 0.55);
    const x = Math.floor(x0) + 0.5;
    const fy = this.ring.h / 2 - off;
    const ey = Math.floor(this.ring.h + PARADE_END - off) + 1 - 4 / TILE;
    const from = pr.from.get(f.id) ?? { x, y: fy, face: 1 as const };
    let face = from.face;
    let at = { x, y: fy };
    let walking = false;
    if (t < GATHER) {
      const e = smooth(Math.max(0, t) / GATHER);
      at = { x: from.x + (x - from.x) * e, y: from.y + (fy - from.y) * e };
      walking = Math.hypot(x - from.x, fy - from.y) > 0.3 && t < GATHER - 0.1;
      if (Math.abs(x - from.x) > 0.3) face = x > from.x ? 1 : -1;
    } else if (t < ARRIVE) {
      const e = Math.max(0, (t - SALUTE) / (ARRIVE - SALUTE));
      at = { x, y: fy + (ey - fy) * e };
      walking = t >= SALUTE;
    } else at = { x, y: ey };
    if (champ) {
      // The salute, the walk (turning to one side of the crowd, then the other), the leap.
      if (t >= GATHER && t < SALUTE) return { ...at, face, frame: SWORD_RAISE, walking: false, lean: -face * 0.05, lift: Math.round(Math.max(0, Math.sin((t - GATHER) * Math.PI * 2.4)) * 5), champ, raise: true };
      if (t >= ARRIVE) return { ...at, face: Math.floor((t - ARRIVE) / 0.7) % 2 ? -1 : 1, frame: SWORD_RAISE, walking: false, lean: 0, lift: Math.round(Math.abs(Math.sin((t - ARRIVE) * Math.PI * 1.45)) * 8), champ, raise: true };
      if (walking && t >= SALUTE) face = Math.floor((t - SALUTE) / 1.8) % 2 ? -1 : 1;
      const pump = walking && t >= SALUTE && (t - SALUTE) % 2.4 < 0.8;
      return { ...at, face, frame: null, walking, lean: -face * 0.04, lift: 0, champ, raise: pump };
    }
    // The rest: heads hung, a slumped shuffle.
    const frame = walking && t >= SALUTE ? SHUFFLE[Math.floor(serverNow / 260) % SHUFFLE.length] : walking ? null : SLUMP;
    return { ...at, face, frame, walking: walking && frame === null, lean: face * 0.05, lift: 0, champ, raise: false };
  }

  /** Their gear in the parade: the champion's sword up high (or at the shoulder), the rest dragging theirs. */
  private paradeGear(f: F, m: Marching, avatar: Avatar, now: number) {
    let g = this.gear.get(f.id);
    if (!g) {
      g = new Graphics();
      this.scene.sorted.addChild(g);
      this.gear.set(f.id, g);
    }
    g.clear();
    g.zIndex = avatar.sprite.zIndex + 0.4;
    const color = this.colorOf(this.slotOf(f.id));
    const fx = this.wx(m.x);
    const feet = this.wy(m.y) - 4;
    const ox = fx;
    const oy = feet - m.lift;
    const face = m.face;
    if (isGiant(f)) {
      // The Goliath walks it too: its club raised high if it's won, dragged if not.
      g.ellipse(fx, feet + 2, 32, 12).stroke({ width: 2, color: m.champ ? 0xffd23f : color, alpha: m.champ ? 0.55 + 0.3 * Math.sin(now / 160) : 0.35 });
      const act: GoliathAct = m.champ && m.raise ? "air" : m.walking ? "walk" : "idle";
      drawGoliath(g, fx, oy, { face, act, k: 1, step: (now / 1000) * 8, now, rage: m.champ, hurt: false });
      return;
    }
    const line = (x1: number, y1: number, x2: number, y2: number, col: number, w = 2) => {
      const n = Math.max(1, Math.abs(x2 - x1), Math.abs(y2 - y1));
      for (let k = 0; k <= n; k++) g!.rect(Math.round(x1 + ((x2 - x1) * k) / n), Math.round(y1 + ((y2 - y1) * k) / n), w, w).fill({ color: col });
    };
    const blade = (hx: number, hy: number, tx: number, ty: number, glow = false) => {
      if (glow) line(ox + hx - 1, oy + hy - 1, ox + tx - 1, oy + ty - 1, 0xffe14f, 5);
      line(ox + hx, oy + hy, ox + tx, oy + ty, 0x1a1020, 4);
      line(ox + hx + 1, oy + hy + 1, ox + tx + 1, oy + ty + 1, 0xd8dce8, 2);
      g!.rect(ox + hx - 1, oy + hy - 1, 4, 4).fill({ color: 0xc99a2a });
    };
    if (m.champ) {
      // A ring of gold under the champion.
      g.ellipse(fx, feet + 2, 14, 6).stroke({ width: 2, color: 0xffd23f, alpha: 0.55 + 0.3 * Math.sin(now / 160) });
      const sh = { x: -face * 11, y: -22 };
      g.rect(ox + sh.x - 6, oy + sh.y - 1, 12, 13).fill({ color: 0x1a1020 });
      g.rect(ox + sh.x - 5, oy + sh.y, 10, 11).fill({ color });
      g.rect(ox + sh.x - 1, oy + sh.y + 3, 2, 4).fill({ color: 0xfff6d8 });
      if (m.raise) blade(face * 9, -24, face * 17, -56, true);
      else blade(face * 7, -13, face * 15, -23);
    } else {
      // The shield hanging low, the sword's point dragging in the sand behind.
      g.ellipse(fx, feet + 2, 12, 5).stroke({ width: 1, color, alpha: 0.35 });
      const sh = { x: -face * 9, y: -13 };
      g.rect(ox + sh.x - 6, oy + sh.y - 1, 12, 13).fill({ color: 0x1a1020 });
      g.rect(ox + sh.x - 5, oy + sh.y, 10, 11).fill({ color });
      blade(face * 6, -11, -face * 12, 1);
    }
  }

  /**
   * The parade's show: its cues (trumpets, the crowd, Caesar's words, what's
   * announced), rose petals showered on the champion (they lie where they
   * fall, a path of them down the carpet), a crown over the champion, a
   * little rain cloud over each of the rest, confetti at its end.
   */
  private drawParade(s: State | null, serverNow: number, wallNow: number, dt: number) {
    const pr = this.parade;
    const g = this.fx;
    if (pr && s && s.status === OVER && s.winner) {
      const t = (serverNow - pr.start) / 1000;
      const me = this.selfId();
      const champ = s.winner;
      const name = this.who(champ).toUpperCase();
      const color = this.cssOf(this.slotOf(champ));
      const inIt = s.fighters.some((f) => f.id === me);
      const near = inIt ? 1 : this.near(this.ring.w / 2, this.ring.h);
      const cue = (key: string, at: number, fn: () => void) => {
        if (t >= at && !pr.cues.has(key)) {
          pr.cues.add(key);
          // (Joined late: only what's still to come.)
          if (t < at + 1.5) fn();
        }
      };
      const c = this.held.get(champ);
      cue("crowned", 0.1, () => {
        snd.trumpets(near);
        sfx.crowdRoar(near);
        if (champ === me) this.announce("👑 YOU ARE CHAMPION!", "#ffd23f", 2, "the crowd is yours: take your victory walk");
        else this.announce(`👑 ${name} IS CHAMPION!`, color, 1.7, inIt ? "you lost: follow the champion out, head hung…" : "of the arena! hail the champion!");
      });
      cue("hail", GATHER, () => {
        this.caesarSays("HAIL, CHAMPION!", 3000);
        sfx.crowdRoar(near * 0.9);
        snd.claps(near);
      });
      cue("winch", SALUTE - 0.9, () => snd.winch());
      cue("walk", SALUTE, () => {
        snd.trumpets(near * 0.8);
        sfx.crowdRoar(near * 0.8);
      });
      cue("love", 7.2, () => this.caesarSays("THE PEOPLE LOVE YOU!", 2800));
      cue("glory", 10.2, () => this.caesarSays(`ALL HAIL ${name}!`, 2800));
      cue("arrive", ARRIVE, () => {
        snd.trumpets(near);
        sfx.crowdRoar(near);
        snd.claps(near);
        this.announce(champ === me ? "👑 GLORY IS YOURS!" : `👑 ALL HAIL ${name}!`, color, 1.8, "champion of the arena");
        if (c) {
          this.confetti(c.x, c.y);
          this.float("CHAMPION!", "#ffd23f", c.x, c.y - 2.4, 1.6);
        }
      });
      // The stands, clapping and roaring all the way.
      if (t > GATHER && t < OVER_MS / 1000 && wallNow >= pr.nextClap) {
        pr.nextClap = wallNow + 900 + Math.random() * 900;
        snd.claps(near * 0.6);
        if (Math.random() < 0.4) sfx.crowdRoar(near * (0.3 + Math.random() * 0.3));
      }
      if (c) {
        // Petals showered down on the champion, more ahead of them: a path to walk.
        const rate = t < GATHER ? 0 : t < SALUTE ? 70 : t < ARRIVE ? 45 : 60;
        pr.acc += rate * dt;
        while (pr.acc >= 1) {
          pr.acc -= 1;
          const ahead = t >= SALUTE && t < ARRIVE;
          this.petals.push({
            x: c.x + (Math.random() - 0.5) * (ahead ? 3 : 4.5),
            y: c.y + (ahead ? Math.random() * 3.5 - 0.5 : (Math.random() - 0.5) * 3),
            z: 1.8 + Math.random() * 2.2,
            vz: -(1.1 + Math.random() * 0.8),
            ph: Math.random() * 7,
            sw: 0.4 + Math.random() * 0.8,
            color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)],
            shape: Math.floor(Math.random() * 3),
            landed: 0,
          });
        }
        // The crown over the champion, twinkling.
        const m = this.marching(s, s.fighters.find((f) => f.id === champ)!, serverNow);
        const cx = Math.round(this.wx(c.x));
        const cy = Math.round(this.wy(c.y) - 4 - (m?.lift ?? 0) - 46 + Math.sin(wallNow / 300) * 1.5);
        g.rect(cx - 7, cy - 6, 15, 10).fill({ color: 0x1a1020, alpha: 0.75 });
        g.rect(cx - 6, cy, 13, 3).fill({ color: 0xffd23f });
        g.rect(cx - 6, cy - 4, 3, 4).fill({ color: 0xffd23f });
        g.rect(cx - 1, cy - 5, 3, 5).fill({ color: 0xffd23f });
        g.rect(cx + 4, cy - 4, 3, 4).fill({ color: 0xffd23f });
        g.rect(cx - 6, cy + 2, 13, 1).fill({ color: 0xc99a2a });
        g.rect(cx, cy + 1, 1, 1).fill({ color: 0xe8344a });
        g.rect(cx - 4, cy + 1, 1, 1).fill({ color: 0x4fa8ff });
        g.rect(cx + 4, cy + 1, 1, 1).fill({ color: 0x4fa8ff });
        for (let i = 0; i < 4; i++) {
          const a = wallNow / 500 + i * 1.57;
          const tw = (Math.sin(wallNow / 120 + i * 2) + 1) / 2;
          if (tw > 0.5) g.rect(Math.round(cx + Math.cos(a) * 12), Math.round(cy - 1 + Math.sin(a) * 5), 2, 2).fill({ color: 0xfff6d8, alpha: tw });
        }
      }
      // A rain cloud over each of the rest.
      for (const id of pr.order) {
        const h = this.held.get(id);
        if (!h) continue;
        const x = Math.round(this.wx(h.x));
        const y = Math.round(this.wy(h.y) - 62 + Math.sin(wallNow / 500 + id) * 1.5);
        for (const [dx, dy, r] of [[-6, 1, 5], [0, -2, 6], [6, 1, 5], [0, 2, 5]]) g.circle(x + dx, y + dy, r).fill({ color: 0x6f7486, alpha: 0.92 });
        for (const [dx, dy, r] of [[-5, 0, 3], [1, -3, 4]]) g.circle(x + dx, y + dy, r).fill({ color: 0x8d92a4, alpha: 0.9 });
        for (let i = 0; i < 4; i++) {
          const k = ((wallNow / 520 + i * 0.27 + id * 0.13) % 1 + 1) % 1;
          g.rect(x - 7 + i * 4 + (i % 2), Math.round(y + 6 + k * 16), 1, 3).fill({ color: 0x7fb6ff, alpha: 1 - k });
        }
      }
    }
    // The petals: fluttering down, then lying a good while (fading at last).
    this.petalsG.clear();
    this.petalsOutG.clear();
    const FADE_AT = 24_000;
    this.petals = this.petals.filter((p) => !p.landed || wallNow - p.landed < FADE_AT + 3000);
    if (this.petals.length > 900) this.petals.splice(0, this.petals.length - 900);
    for (const p of this.petals) {
      if (!p.landed) {
        p.z += p.vz * dt;
        p.x += Math.sin(wallNow / 320 + p.ph) * p.sw * dt;
        if (p.z <= 0) {
          p.z = 0;
          p.landed = wallNow;
        } else {
          // Turning as it falls: broad, then edge on.
          const w = Math.abs(Math.sin(wallNow / 140 + p.ph)) > 0.5 ? 3 : 1;
          g.rect(Math.round(this.wx(p.x)) - (w >> 1), Math.round(this.wy(p.y) - p.z * TILE), w, 2).fill({ color: p.color });
          continue;
        }
      }
      const age = wallNow - p.landed;
      const alpha = age < FADE_AT ? 0.95 : Math.max(0, 0.95 * (1 - (age - FADE_AT) / 3000));
      const x = Math.round(this.wx(p.x));
      const y = Math.round(this.wy(p.y));
      const pg = p.y >= this.carpetY ? this.petalsOutG : this.petalsG;
      if (p.shape === 0) pg.rect(x, y, 3, 2).fill({ color: p.color, alpha });
      else if (p.shape === 1) pg.rect(x - 1, y, 4, 2).fill({ color: p.color, alpha }).rect(x, y - 1, 2, 1).fill({ color: p.color, alpha });
      else pg.rect(x, y, 2, 2).fill({ color: p.color, alpha }).rect(x + 1, y + 2, 2, 1).fill({ color: p.color, alpha: alpha * 0.8 });
    }
  }

  /** A burst of confetti: gold, white and the town's colours, high up and drifting down. */
  private confetti(x: number, y: number) {
    const now = performance.now();
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 1 + Math.random() * 4;
      this.particles.push({ x, y, z: 1.2, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, vz: 4 + Math.random() * 5, born: now, life: 1400 + Math.random() * 1200, color: [0xffd23f, 0xfff6d8, 0xff6a3f, 0x4fa8ff, 0x7ad35a, 0xe8344a][i % 6], size: 2 });
    }
  }

  /** Caesar speaks: his words over his dais. */
  private caesarSays(text: string, life: number) {
    const c = this.caesarAt;
    if (!c) return;
    const s = new Sprite(word(text, "#ffe14f"));
    s.anchor.set(0.5, 1);
    s.scale.set(1.3);
    this.top.addChild(s);
    this.scene.standOn(s, c.ty * TILE);
    this.floaters.push({ sprite: s, x: c.x, y: c.y - 24, at: performance.now(), life });
  }

  // ---- watching from the stands --------------------------------------------------

  /** Whether we're sat in the amphitheatre's stands (not fighting): we can watch. */
  private seated(): boolean {
    const me = this.avatarOf(this.selfId());
    const b = this.bowlObj;
    return !!me && !!b && !this.capturing && me.state === 1 && me.pos.x >= b.x && me.pos.x < b.x + b.w && me.pos.y >= b.y && me.pos.y < b.y + b.h;
  }

  /** 🔭 on or off: the camera to the fight, or back to us. */
  private toggleWatch() {
    if (!this.seated()) return;
    this.watching = !this.watching;
    const me = this.avatarOf(this.selfId());
    if (this.watching && me) this.watchCam = { x: me.pos.x, y: me.pos.y };
    if (!this.watching) this.stopWatching();
    sfx.tone(sfx.at(0), 0.08, 0.06, "triangle", this.watching ? 880 : 660);
  }

  /** Back to our seat: whom we watched forgotten, the zoom back on a crisp step. */
  private stopWatching() {
    this.watching = false;
    this.watchWho = 0;
    this.scene.zoomSnap();
  }

  /** Who can be watched, in turn: the middle of the sand, then each fighter (by place). */
  private watchable(): number[] {
    const s = this.state;
    const ids = s && s.status !== LOBBY ? s.slots.filter((id) => id && s.fighters.some((f) => f.id === id)) : [];
    return [0, ...ids];
  }

  /** The next (or the one before) to watch. */
  private cycleWatch(dir: 1 | -1) {
    if (!this.watching) return;
    const list = this.watchable();
    const i = Math.max(0, list.indexOf(this.watchWho));
    this.watchWho = list[(i + dir + list.length) % list.length];
    sfx.tone(sfx.at(0), 0.05, 0.05, "triangle", 990);
  }

  /** Watching: the wheel zooms finely (see game.ts). */
  get watchingNow(): boolean {
    return this.watching;
  }

  /**
   * Where the watching camera looks: between the middle of the sand and
   * the fighters still standing (so it follows the fight, and never
   * strays off the sand); the middle when there's no fight.
   */
  private watchFocus(): { x: number; y: number } {
    const a = this.arenaObj;
    const mid = { x: a.x + a.w / 2 - 0.5, y: a.y + a.h / 2 - 0.5 };
    const s = this.state;
    if (!s || s.status === LOBBY) return mid;
    // Watching one of them: right on them.
    const who = this.watchWho ? s.fighters.find((f) => f.id === this.watchWho) : undefined;
    if (who) {
      const p = this.held.get(who.id) ?? { x: who.x / 100, y: who.y / 100 };
      return this.toTile(p.x, p.y);
    }
    const up = s.fighters.filter((f) => !(f.flags & FLAG.DOWN));
    if (!up.length) return mid;
    let x = 0;
    let y = 0;
    for (const f of up) {
      const p = this.held.get(f.id) ?? { x: f.x / 100, y: f.y / 100 };
      const t = this.toTile(p.x, p.y);
      x += t.x;
      y += t.y;
    }
    return { x: mid.x * 0.35 + (x / up.length) * 0.65, y: mid.y * 0.35 + (y / up.length) * 0.65 };
  }

  /** The 🔭 button, shown while we're sat in the stands. */
  private updateWatch() {
    const seated = this.seated();
    if (!seated && this.watching) this.stopWatching();
    this.watchBar.hidden = !seated;
    const label = this.watching ? "🔭 Back to my seat" : "🔭 Watch the fight";
    if (this.watchBtn.textContent !== label) this.watchBtn.textContent = label;
    this.watchBtn.classList.toggle("on", this.watching);
    // Whom: ◀ the middle, or a fighter (in their colour) ▶.
    this.watchPick.hidden = !this.watching;
    if (!this.watchable().includes(this.watchWho)) this.watchWho = 0;
    const who = this.watchWho;
    const key = `${who}|${this.watching}`;
    if (key !== this.watchKey) {
      this.watchKey = key;
      this.watchName.textContent = who ? this.who(who) : "The middle";
      this.watchName.style.color = who ? this.cssOf(this.slotOf(who)) : "";
    }
  }

  // ---- the crowd ------------------------------------------------------------------

  /**
   * The amphitheatre's crowd, a few times a second: fuller when there's a
   * fight; on their feet, arms up, when it's stirring (a big hit, someone
   * down, a round won: it fades), a wave going round between rounds (and
   * now and then when it's quiet), the odd one fidgeting; the pennants on
   * the masts flying. Only drawn when you're near.
   */
  private drawCrowd(wallNow: number) {
    if (!this.crowd.length) return;
    const self = this.avatarOf(this.selfId());
    const a = this.arenaObj;
    const near = !!self && Math.hypot(self.pos.x - (a.x + a.w / 2), self.pos.y - (a.y + a.h / 2)) < 48;
    this.pennants.visible = near;
    if (!near) {
      for (const p of this.crowd) if (p.sprite) p.sprite.visible = false;
      return;
    }
    if (wallNow < this.nextCrowd) return;
    this.nextCrowd = wallNow + 90;
    const s = this.state;
    const running = !!s && s.status !== LOBBY;
    const signedUp = !!s && s.slots.some((id) => id !== 0);
    const fill = running ? 0.92 : signedUp ? 0.6 : 0.38;
    const t = wallNow / 1000;
    const wave = (!!s && (s.status === COUNTDOWN || s.status === ROUND_END)) || (!running && t % 45 < 9);
    const hype = s?.status === OVER ? 1 : this.hype;
    // (Where someone has sat down in the stands, the crowd makes room; anyone
    // just walking by goes in front of or behind them, as they pass.)
    const near2: { x: number; y: number }[] = [];
    const b = this.bowlObj;
    for (const p of this.people()) {
      if (p.state !== 1) continue;
      if (b && p.pos.x >= b.x && p.pos.x < b.x + b.w && p.pos.y >= b.y && p.pos.y < b.y + b.h) near2.push({ x: p.pos.x * TILE + TILE / 2, y: p.pos.y * TILE + TILE - 6 });
    }
    const beatOf = (i: number, n: number) => {
      const v = Math.sin(i * 91.17 + n * 13.73) * 43758.5453;
      return v - Math.floor(v);
    };
    this.crowd.forEach((p, i) => {
      const here = p.seed < fill && !near2.some((q) => Math.abs(q.x - p.x) < 22 && Math.abs(q.y - p.ground) < 26);
      if (!here) {
        if (p.sprite) p.sprite.visible = false;
        return;
      }
      let frame: AvatarFrame = 2;
      let lift = 0;
      // The wave goes round the stands.
      if (wave && Math.cos(p.th - t * 2.2) > 0.86) {
        frame = SWORD_RAISE;
        lift = 3;
      }
      const beat = Math.floor(t * 4 + p.seed * 7);
      if (frame === 2 && beatOf(i, beat) < hype * 0.85) {
        frame = SWORD_RAISE;
        lift = beat % 2 ? 3 : 0;
      }
      if (frame === 2 && beatOf(i, Math.floor(t * 1.3)) < 0.03) lift = 1;
      let sp = p.sprite;
      if (!sp) {
        sp = new Sprite();
        sp.anchor.set(0.5, 1);
        this.scene.sorted.addChild(sp);
        // (The stands are drawn flat: in 3D they sit where they're drawn.)
        this.scene.standOn(sp, p.y + 4);
        p.sprite = sp;
      }
      sp.visible = true;
      sp.texture = spectatorTexture(p.look, frame === 2 ? 0 : 1);
      sp.scale.x = frame === 2 ? p.face : beat % 2 ? 1 : -1;
      sp.position.set(p.x, p.y + 4 - lift);
      sp.zIndex = p.ground + 4;
    });
    // The pennants on the masts.
    const g = this.pennants.clear();
    this.masts.forEach(([mx, my], i) => {
      const w = Math.round(Math.sin(t * 5 + i * 1.7) * 1.5);
      const top = my - 20;
      const color = PENNANTS[i % PENNANTS.length];
      g.rect(mx + 2, top, 8 + w, 2).fill({ color });
      g.rect(mx + 2, top + 2, 6 + w, 2).fill({ color });
      g.rect(mx + 2, top + 4, 3 + Math.max(0, w), 1).fill({ color });
    });
  }

  // ---- the gladiators' gates --------------------------------------------------------

  /**
   * The gates' great iron doors: shut, but for each round's countdown, when
   * they open (each leaf drawing back into the frame, north and south)
   * for the gladiators to march out, and shut behind them as the fight
   * begins. Riveted plates in iron bands, studs, a ring to pull each by.
   */
  private drawGates(dt: number) {
    if (!this.gates.length) return;
    const s = this.state;
    // (Open for the gladiators' march, and for anything let out at them.)
    const want = (s && s.status === COUNTDOWN) || this.disaster.gatesOpen ? 1 : 0;
    const before = this.gatesOpen;
    this.gatesOpen = want > before ? Math.min(1, before + dt * 2.2) : Math.max(0, before - dt * 1.6);
    const o = this.gatesOpen;
    const D = SIDE_GATE_DOOR;
    for (const gate of this.gates) {
      const g = gate.g.clear();
      const X = (x: number) => (gate.east ? gate.x + gate.w - x : gate.x + x);
      const rect = (x0: number, y0: number, x1: number, y1: number, color: number) => {
        const a = X(x0);
        const b = X(x1);
        g.rect(Math.min(a, b), gate.y + y0, Math.abs(b - a), y1 - y0).fill({ color });
      };
      const mid = (D.y0 + D.y1) / 2;
      // Each leaf: from its edge of the frame to where it's drawn back to.
      for (const [from, to] of [
        [D.y0, mid - (mid - D.y0) * o],
        [mid + (D.y1 - mid) * o, D.y1],
      ]) {
        if (to - from < 1) continue;
        rect(D.x0, from, D.x1, to, 0x2b2233);
        rect(D.x0 + 1, from + 1, D.x1 - 1, to - 1, 0x3d3d4a);
        // Iron bands across it, studs along them.
        for (let x = D.x0 + 5; x < D.x1 - 2; x += 9) {
          rect(x, from + 1, x + 2, to - 1, 0x5a5a6a);
          for (let y = from + 4; y < to - 2; y += 7) rect(x, y, x + 2, y + 2, 0x9a9aa8);
        }
        // The plates' edge, lit; a dark line along the meeting edge.
        rect(D.x0 + 1, from + 1, D.x1 - 1, from + 2, 0x6a6a7a);
      }
      // The rings to pull them by, while shut.
      if (o < 0.15) {
        for (const ry of [mid - 6, mid + 3]) {
          rect(D.x1 - 12, ry, D.x1 - 6, ry + 1, 0xc99a2a);
          rect(D.x1 - 12, ry + 3, D.x1 - 6, ry + 4, 0xc99a2a);
          rect(D.x1 - 12, ry, D.x1 - 11, ry + 4, 0xc99a2a);
          rect(D.x1 - 7, ry, D.x1 - 6, ry + 4, 0xc99a2a);
        }
        rect(D.x0 + 1, mid - 0.5, D.x1 - 1, mid + 0.5, 0x1a1420);
      }
    }
  }

  // ---- Caesar ---------------------------------------------------------------------

  /**
   * Over Caesar while nobody's fighting (or you're not): a golden call to
   * click him, bobbing, an arrow pointing down at him; and now and then he
   * hails whoever's near.
   */
  private drawCaesar(wallNow: number) {
    const c = this.caesarAt;
    if (!c) return;
    const self = this.avatarOf(this.selfId());
    const d = self ? Math.hypot(self.pos.x - c.tx, self.pos.y - c.ty) : 99;
    const show = !this.capturing && d < 16 && !this.lobbyOpen;
    this.prompt.visible = show;
    const g = this.promptArrow.clear();
    if (show) {
      const bob = Math.round(Math.sin(wallNow / 260) * 3);
      this.prompt.position.set(Math.round(c.x), Math.round(c.y - 26 + bob));
      this.prompt.alpha = d < 12 ? 1 : 1 - (d - 12) / 4;
      const ay = c.y - 22 + bob;
      g.poly([c.x - 5, ay, c.x + 5, ay, c.x, ay + 6]).fill({ color: 0xffe14f, alpha: this.prompt.alpha });
      g.poly([c.x - 5, ay, c.x + 5, ay, c.x, ay + 6]).stroke({ width: 1, color: 0x3a2410, alpha: this.prompt.alpha });
    }
    if (d < 12 && wallNow >= this.nextHail && !this.capturing) {
      this.nextHail = wallNow + 7000 + Math.random() * 6000;
      const lines = ["AVE, CITIZEN!", "WHO WILL FIGHT TODAY?", "GLORY AWAITS, GLADIATOR!", "THE CROWD IS HUNGRY!", "STEP UP, IF YOU DARE!", "BRING ME A CHAMPION!"];
      const s = new Sprite(word(lines[Math.floor(Math.random() * lines.length)], "#fff6d8"));
      s.anchor.set(0.5, 1);
      this.top.addChild(s);
      this.scene.standOn(s, c.ty * TILE);
      this.floaters.push({ sprite: s, x: c.x + 18, y: c.y - 40, at: wallNow, life: 2600 });
    }
  }

  // ---- the braziers ---------------------------------------------------------------

  /** A fire at (x, y) on something whose foot's at `foot` (world px), drawn over what's sorted at `z`. */
  private addFire(x: number, y: number, glow: Sprite, night: Sprite | null, s: number, foot: number, z = foot) {
    const g = new Graphics();
    g.zIndex = z;
    this.scene.sorted.addChild(g);
    for (const c of [g, glow, night]) if (c) this.scene.standOn(c, foot);
    this.fires.push({ x, y, glow, night, phase: Math.random() * 10, s, g });
  }

  /**
   * Each brazier's fire, alive: a flickering core of nested flame shapes,
   * tongues of flame licking up off it (white-hot, yellow, orange, red, then
   * smoke), sparks drifting high, and its warm light breathing with it.
   */
  private drawFires(wallNow: number, dt: number) {
    if (!this.fires.length) return;
    // (Only the fires on screen, or nearly: off it they'd be thousands of
    // little shapes a second for nobody.)
    const v = this.scene.viewRect();
    const seen = (f: Fire) => f.x / TILE > v.x0 - 3 && f.x / TILE < v.x1 + 3 && f.y / TILE > v.y0 - 3 && f.y / TILE < v.y1 + 4;
    const anySeen = this.fires.some(seen);
    if (!anySeen && !this.flames.length) {
      if (this.firesShown) {
        for (const f of this.fires) {
          f.g.clear();
          f.glow.visible = false;
        }
        this.firesShown = false;
      }
      return;
    }
    this.firesShown = true;
    const t = wallNow / 1000;
    for (const f of this.fires) {
      const g = f.g.clear();
      f.glow.visible = seen(f);
      if (!f.glow.visible) {
        if (f.night) f.night.alpha = 0.7;
        continue;
      }
      // New tongues, sparks and smoke.
      const s = f.s;
      const rate = dt * 130 * s;
      const n = Math.random() < rate % 1 ? Math.ceil(rate) : Math.floor(rate);
      for (let i = 0; i < n; i++) {
        this.flames.push({ fire: f, x: f.x + (Math.random() - 0.5) * 20 * s, y: f.y + 2 * s, vx: (Math.random() - 0.5) * 8 * s, vy: -(30 + Math.random() * 30) * Math.sqrt(s), born: wallNow, life: (320 + Math.random() * 320) * Math.sqrt(s), kind: 0, size: s < 0.4 ? 1 : s < 0.8 ? (Math.random() < 0.5 ? 2 : 3) : Math.random() < 0.5 ? 4 : 3 });
      }
      if (Math.random() < dt * 5 * s) this.flames.push({ fire: f, x: f.x + (Math.random() - 0.5) * 10 * s, y: f.y - 6 * s, vx: (Math.random() - 0.5) * 18 * s, vy: -(40 + Math.random() * 40) * s, born: wallNow, life: 700 + Math.random() * 600, kind: 1, size: 1 });
      if (Math.random() < dt * 4 * s) this.flames.push({ fire: f, x: f.x + (Math.random() - 0.5) * 6 * s, y: f.y - 18 * s, vx: (Math.random() - 0.5) * 4, vy: -(10 + Math.random() * 8), born: wallNow, life: 1200 + Math.random() * 600, kind: 2, size: s < 0.4 ? 1 : 3 });
      // The core: nested flame shapes (red outside, white at the heart), swaying.
      const layers: [number, number, number][] = [
        [12, 29, 0xd8341a],
        [10, 24, 0xff6a1a],
        [8, 18, 0xff9a3f],
        [5, 12, 0xffd23f],
        [3, 7, 0xfff4c4],
      ];
      for (const [r0, h0, color] of layers) {
        const r = Math.max(0.6, r0 * s);
        const h = Math.max(2, h0 * s);
        const hh = h * (0.9 + 0.12 * Math.sin(t * 11 + f.phase + r) + 0.06 * Math.sin(t * 23 + r * 3));
        for (let yy = 0; yy < hh; yy++) {
          const k = yy / hh;
          const half = r * Math.pow(1 - k, 0.75) * (1 + 0.14 * Math.sin(t * 17 + yy * 0.7 + f.phase));
          const sway = Math.sin(t * 6 + yy * 0.35 + f.phase) * k * 3 * s;
          if (half < 0.5) continue;
          g.rect(Math.round(f.x - half + sway), Math.round(f.y - yy), Math.max(1, Math.round(half * 2)), 1).fill({ color });
        }
      }
      // The glow breathing; brighter as the flames leap.
      const flick = 0.85 + 0.1 * Math.sin(t * 9 + f.phase) + 0.05 * Math.sin(t * 21 + f.phase * 2) + (Math.random() - 0.5) * 0.06;
      f.glow.scale.set(2.3 * flick * s, 2.1 * flick * s);
      f.glow.alpha = 0.42 * flick;
      if (f.night) f.night.alpha = 0.7 * flick;
    }
    // The tongues, sparks and smoke, rising and fading.
    this.flames = this.flames.filter((p) => wallNow - p.born < p.life);
    for (const p of this.flames) {
      const g = p.fire.g;
      const a = (wallNow - p.born) / p.life;
      p.x += (p.vx + Math.sin(t * 8 + p.born) * (p.kind === 1 ? 14 : 6)) * dt;
      p.y += p.vy * dt;
      if (p.kind === 0) {
        const color = a < 0.18 ? 0xfff4c4 : a < 0.4 ? 0xffd23f : a < 0.65 ? 0xff9a3f : a < 0.85 ? 0xff4f1a : 0x8a2a10;
        const s = Math.max(1, Math.round(p.size * (1 - a * 0.7)));
        g.rect(Math.round(p.x), Math.round(p.y), s, s).fill({ color, alpha: a > 0.85 ? (1 - a) / 0.15 : 1 });
      } else if (p.kind === 1) {
        g.rect(Math.round(p.x), Math.round(p.y), 1, 1).fill({ color: a < 0.5 ? 0xffe8a0 : 0xff9a3f, alpha: 1 - a });
      } else {
        g.rect(Math.round(p.x) - 1, Math.round(p.y) - 1, p.size, p.size).fill({ color: 0x4a4040, alpha: 0.22 * (1 - a) });
      }
    }
  }

  // ---- effects ---------------------------------------------------------------------

  /**
   * What the gifts are doing for fighter `f` (feet at `x`, `feet`, `tall` px
   * high and `wide` round): the fury's red heat, the boots' wings and
   * streaks, the potion's ring, healing's green crosses, the shield's bubble.
   */
  private buffFx(g: Graphics, f: F, x: number, feet: number, tall: number, wide: number, now: number, moving: boolean) {
    const mid = feet - tall * 0.5;
    if (f.flags & FLAG.FURY) {
      const p = 0.5 + 0.5 * Math.sin(now / 90);
      g.ellipse(x, mid, wide * 0.95, tall * 0.62).fill({ color: 0xff2020, alpha: 0.1 + 0.12 * p });
      for (let i = 0; i < 6; i++) {
        const rise = ((now / 10 + i * 31) % 60) / 60;
        const sx = Math.round(x + Math.sin(i * 2.4 + now / 240) * wide * 0.8);
        g.rect(sx, Math.round(feet - rise * tall * 1.05), 2, 3).fill({ color: i % 2 ? 0xff4f2a : 0xffb03a, alpha: 0.9 * (1 - rise) });
      }
    }
    if (f.buffs & BUFF.SPEED) {
      // Little white wings beating at the heels; streaks of light behind.
      const flap = Math.floor(now / 70) % 2;
      for (const side of [-1, 1]) {
        const wx = Math.round(x + side * (wide * 0.42));
        const wy = Math.round(feet - 5);
        g.rect(wx + (side > 0 ? 0 : -5), wy - flap * 2, 5, 2).fill({ color: 0xffffff });
        g.rect(wx + (side > 0 ? 1 : -4), wy + 2 - flap * 2, 4, 1).fill({ color: 0xd8e8ff });
        g.rect(wx + (side > 0 ? 0 : -2), wy + 2, 2, 2).fill({ color: 0xffd23f });
      }
      if (moving) {
        const dir = Math.cos(fromU16(f.aim)) >= 0 ? -1 : 1;
        for (let i = 0; i < 4; i++) {
          const len = 10 + ((now / 16 + i * 17) % 18);
          const ly = Math.round(feet - 6 - i * (tall / 5));
          g.rect(Math.round(x + dir * (wide * 0.5 + 2)) + (dir < 0 ? -len : 0), ly, len, 1).fill({ color: 0xfff1b0, alpha: 0.55 - i * 0.08 });
        }
      }
    }
    if (f.buffs & BUFF.REGEN) {
      // The potion at work: a violet ring at the feet.
      const p = 0.5 + 0.5 * Math.sin(now / 240);
      g.ellipse(x, feet, wide * 0.85, wide * 0.3).stroke({ width: 1, color: 0xc77dff, alpha: 0.5 + 0.3 * p });
    }
    if (f.buffs & BUFF.POISON) {
      // The poison at work: sick green bubbles rising off them.
      for (let i = 0; i < 6; i++) {
        const rise = ((now / 30 + i * 41) % 60) / 60;
        const sx = Math.round(x + (((i * 17) % 34) / 17 - 1) * wide * 0.8 + Math.sin(now / 170 + i) * 2);
        const sy = Math.round(feet - tall * (0.1 + rise * 0.9));
        const col = i % 2 ? 0x8cff4e : 0x4ed02a;
        g.circle(sx, sy, 1.4 + (i % 3)).fill({ color: col, alpha: 0.85 * (1 - rise) });
      }
      g.ellipse(x, feet, wide * 0.8, wide * 0.28).stroke({ width: 1, color: 0x8cff4e, alpha: 0.5 + 0.3 * Math.sin(now / 150) });
    }
    if (f.buffs & (BUFF.REGEN | BUFF.HEAL)) {
      // Wounds closing (resting, the potion, a good meal): little green crosses drifting up.
      for (let i = 0; i < 5; i++) {
        const rise = ((now / 22 + i * 37) % 70) / 70;
        const sx = Math.round(x + (((i * 13) % 52) / 26 - 1) * wide * 0.75 + Math.sin(now / 300 + i) * 3);
        const sy = Math.round(feet - tall * (0.2 + rise * 0.75));
        const a = 0.85 * (1 - rise);
        g.rect(sx - 1, sy - 3, 2, 6).fill({ color: 0x7cf08a, alpha: a });
        g.rect(sx - 3, sy - 1, 6, 2).fill({ color: 0x7cf08a, alpha: a });
      }
    }
    if (f.buffs & BUFF.SHIELD) {
      // The bubble: faint glass, a bright edge, a shine sliding round it.
      const p = 0.5 + 0.5 * Math.sin(now / 200);
      const rx = wide * 1.05 + p;
      const ry = tall * 0.62 + p;
      g.ellipse(x, mid, rx, ry).fill({ color: 0x7fd8ff, alpha: 0.13 + 0.05 * p });
      g.ellipse(x, mid, rx, ry).stroke({ width: 2, color: 0xbff0ff, alpha: 0.75 });
      if (f.buffs & BUFF.SHIELD2) g.ellipse(x, mid, rx + 5, ry + 5).stroke({ width: 1, color: 0xffffff, alpha: 0.5 + 0.3 * p });
      g.ellipse(x - rx * 0.36, mid - ry * 0.5, rx * 0.22, ry * 0.12).fill({ color: 0xffffff, alpha: 0.55 });
      const a = now / 500;
      for (let i = 0; i < 3; i++) {
        const b = a + (i / 3) * Math.PI * 2;
        g.rect(Math.round(x + Math.cos(b) * rx) - 1, Math.round(mid + Math.sin(b) * ry) - 1, 3, 3).fill({ color: 0xffffff, alpha: 0.85 });
      }
    }
  }

  private sparks(x: number, y: number, color: number, n: number) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 4;
      this.particles.push({ x, y, z: 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: 1 + Math.random() * 3, born: now, life: 220 + Math.random() * 260, color: i % 3 === 0 ? 0xffffff : color, size: Math.random() < 0.3 ? 3 : 2 });
    }
  }

  private dust(x: number, y: number, n: number) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.6 + Math.random() * 1.6;
      this.particles.push({ x, y, z: 0.05, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, vz: 0.4 + Math.random() * 0.8, born: now, life: 400 + Math.random() * 400, color: Math.random() < 0.5 ? 0xe8d3a3 : 0xc9b282, size: 3 });
    }
  }

  private explode(x: number, y: number, r = BOMB_R) {
    const now = performance.now();
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 6;
      this.particles.push({ x, y, z: 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: 1 + Math.random() * 4, born: now, life: 300 + Math.random() * 500, color: [0xffd23f, 0xff9a3f, 0xff4f1a, 0x5a5050][i % 4], size: i % 5 === 0 ? 4 : 3 });
    }
    this.ringFx(x, y, 0xff9a3f, r);
    this.dust(x, y, 20);
  }

  private ringFx(x: number, y: number, color: number, r: number) {
    this.rings.push({ x, y, color, at: performance.now(), r });
  }

  private float(text: string, color: string, x: number, y: number, scale: number) {
    const sprite = new Sprite(word(text, color));
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(scale);
    this.top.addChild(sprite);
    this.floaters.push({ sprite, x: this.wx(x), y: this.wy(y), at: performance.now(), life: 1100, size: scale });
  }

  /**
   * The lava: where the fire would burn, molten rock (a dark crust breaking
   * up over rivers of orange and gold, all of it creeping), its edge alive,
   * glowing and heaving as it comes.
   */
  private drawLava(g: Graphics, lava: number, wallNow: number) {
    const cx = this.ring.w / 2;
    const cy = this.ring.h / 2;
    const p = this.ring.oval ? ROUNDNESS : 2;
    const STEP = 1 / 3;
    const t = wallNow / 1000;
    for (let y = 0; y < this.ring.h; y += STEP) {
      const dy = (y + STEP / 2 - cy) / cy;
      const edge = this.ring.oval ? Math.max(0, 1 - Math.abs(dy) ** ROUNDNESS) ** (1 / ROUNDNESS) * cx : cx;
      // (The front of it heaves, row to row.)
      const swell = lava + Math.sin(y * 1.3 + t * 1.7) * 0.012 + Math.sin(y * 3.1 - t * 2.3) * 0.006;
      const inside = swell ** p - Math.abs(dy) ** p;
      const half = inside > 0 ? inside ** (1 / p) * cx : 0;
      for (const [from, to] of [[cx - edge, cx - half], [cx + half, cx + edge]]) {
        if (to <= from) continue;
        g.rect(this.wx(from), this.wy(y), (to - from) * TILE, STEP * TILE + 1).fill({ color: 0xa82208 });
        for (let x = Math.ceil(from / STEP) * STEP; x < to; x += STEP) {
          // The flow: slow waves crossing, breaking the crust into plates
          // with bright rivers between them, all of it creeping.
          const n = Math.sin(x * 0.8 + y * 0.6 - t * 0.5) + Math.sin(x * 0.45 - y * 0.9 + t * 0.35) + Math.sin(x * 1.7 + Math.sin(y * 1.3 + t * 0.3) * 1.4) * 0.5;
          const river = Math.abs(n);
          const col = river < 0.08 ? 0xfff0a8 : river < 0.2 ? 0xffc23a : river < 0.42 ? 0xff7a14 : n > 1.25 ? 0x34120a : n < -1 ? 0x651606 : 0;
          if (!col) continue;
          const [x0, y0] = [Math.round(this.wx(x)), Math.round(this.wy(y))];
          const [x1, y1] = [Math.round(this.wx(Math.min(to, x + STEP))), Math.round(this.wy(y + STEP))];
          g.rect(x0, y0, x1 - x0, y1 - y0).fill({ color: col });
        }
        // The glowing lip of it, against the sand.
        const lip = to === cx - half ? to : from;
        const dir = to === cx - half ? -1 : 1;
        if (half > 0) {
          g.rect(this.wx(lip) + (dir < 0 ? -4 : 0), this.wy(y), 4, STEP * TILE + 1).fill({ color: 0xfff0a8 });
          g.rect(this.wx(lip) + (dir < 0 ? 0 : -6), this.wy(y), 6, STEP * TILE + 1).fill({ color: 0xff5a1a, alpha: 0.5 });
        }
      }
    }
    // Bubbles swelling and bursting all over it.
    for (let i = 0; i < 26; i++) {
      const life = ((t * 0.7 + i * 0.37) % 1);
      const seed = Math.floor(t * 0.7 + i * 0.37) * 7 + i * 13;
      const x = ((seed * 7.13) % 1000) / 1000 * this.ring.w;
      const y = ((seed * 3.77) % 1000) / 1000 * this.ring.h;
      // (Only out on the lava itself.)
      const out = (Math.abs(x / cx - 1) ** p + Math.abs(y / cy - 1) ** p) ** (1 / p);
      if (out <= lava + 0.03 || out >= 1) continue;
      const r = life * 5;
      g.circle(this.wx(x), this.wy(y), r).fill({ color: 0xffd23f, alpha: 1 - life * 0.5 });
      if (life > 0.8) g.circle(this.wx(x), this.wy(y), r + 3).stroke({ width: 1, color: 0xfff4c4, alpha: (1 - life) * 5 });
    }
  }

  private drawFx(wallNow: number, dt: number, s: State | null, serverNow: number) {
    void serverNow;
    const g = this.fx;
    this.disaster.drawSky(g, wallNow);
    // Missiles: a spear flying level, a bomb arcing with its fuse fizzing.
    for (const m of this.missiles) {
      const x = this.wx(m.x);
      const y = this.wy(m.y);
      g.ellipse(x, y, 4, 1.5).fill({ color: 0x000000, alpha: 0.25 });
      if (m.kind === DART) {
        // The scorpion's dart: a dark barb, dripping green.
        const a = Math.atan2(m.vy, m.vx);
        for (let k = 0; k < 13; k += 1) {
          const col = k < 3 ? 0x8cff4e : k < 9 ? 0x2a1812 : 0x5ec032;
          g.rect(Math.round(x - Math.cos(a) * k), Math.round(y - 16 - Math.sin(a) * k * 0.7), k < 5 ? 3 : 2, k < 5 ? 3 : 2).fill({ color: col });
        }
        this.glows.add(x, y - 16, 0x8cff4e, 0.75, 0.6, 0.7);
        for (let k = 1; k < 5; k++) g.rect(Math.round(x - Math.cos(a) * (10 + k * 7)), Math.round(y - 15 - Math.sin(a) * (10 + k * 7) * 0.7 + k), 2, 2).fill({ color: 0x8cff4e, alpha: 0.7 - k * 0.12 });
      } else if (m.kind === GIFT.BOMB || m.kind === BIG_BOMB) {
        // (The big bomb: bigger, banded red, a longer fuse.)
        const big = m.kind === BIG_BOMB;
        const k = 1 - m.left / m.range;
        const h = 14 + Math.sin(k * Math.PI) * (big ? 32 : 26);
        const r = big ? 8 : 5;
        // Its fuse lighting it up, and a pool of that on the sand under it.
        const fizz = 0.8 + 0.2 * Math.sin(wallNow / 35);
        this.glows.add(x, y - h, 0xff8a2a, big ? 1.3 : 0.9, big ? 1.3 : 0.9, 0.8 * fizz);
        this.glows.add(x, y, 0xff6a1a, big ? 0.9 : 0.6, big ? 0.45 : 0.3, 0.3 * fizz);
        g.circle(x, y - h, r).fill({ color: 0x2f2c38 }).stroke({ width: 1, color: 0x1a1020 });
        if (big) g.rect(x - r + 1, y - h - 1, r * 2 - 2, 2).fill({ color: 0xc8402a });
        g.rect(x + r - 3, y - h - r - 2, 2, big ? 4 : 3).fill({ color: Math.floor(wallNow / 60) % 2 ? 0xffd23f : 0xff6a3f });
      } else if (m.kind === ARROW) {
        // A slim arrow: a steel tip, the shaft, the fletching (red and white).
        const a = Math.atan2(m.vy, m.vx);
        const L = 12;
        for (let k = 0; k < L; k += 1) {
          const col = k < 2 ? 0xd8dce8 : k > 8 ? (k % 2 ? 0xffffff : 0xd94a4a) : 0xb08a52;
          g.rect(Math.round(x - Math.cos(a) * k), Math.round(y - 14 - Math.sin(a) * k * 0.7), k < 2 || k > 8 ? 2 : 1, k < 2 || k > 8 ? 2 : 1).fill({ color: col });
        }
        this.glows.add(x - Math.cos(a) * 6, y - 14, 0xffe2a0, 0.7, 0.5, 0.7);
        // (A faint streak behind.)
        g.rect(Math.round(x - Math.cos(a) * 18), Math.round(y - 14 - Math.sin(a) * 18 * 0.7), 1, 1).fill({ color: 0xffffff, alpha: 0.5 });
      } else {
        const a = Math.atan2(m.vy, m.vx);
        const L = 20;
        this.glows.add(x - Math.cos(a) * 10, y - 14, 0xffe2a0, 0.8, 0.55, 0.6);
        for (let k = 0; k < L; k += 1) g.rect(Math.round(x - Math.cos(a) * k), Math.round(y - 14 - Math.sin(a) * k * 0.7), 2, 2).fill({ color: k < 4 ? 0xd8dce8 : 0x8f6236 });
      }
    }
    this.glows.flush();
    // Spears stuck in the walls a while.
    this.stuck = this.stuck.filter((st) => wallNow < st.until);
    for (const st of this.stuck) {
      if (st.arrow) {
        for (let k = 0; k < 10; k++) g.rect(Math.round(this.wx(st.x) - Math.cos(st.aim) * k), Math.round(this.wy(st.y) - 14 - Math.sin(st.aim) * k * 0.7), 1, 1).fill({ color: k > 7 ? 0xd94a4a : 0xb08a52 });
        continue;
      }
      for (let k = 0; k < 16; k++) g.rect(Math.round(this.wx(st.x) - Math.cos(st.aim) * k), Math.round(this.wy(st.y) - 14 - Math.sin(st.aim) * k * 0.7), 2, 2).fill({ color: k < 3 ? 0xd8dce8 : 0x8f6236 });
    }
    // Particles.
    const now = performance.now();
    this.particles = this.particles.filter((p) => now - p.born < p.life);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= 9 * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz = 0;
        p.vx *= 0.7;
        p.vy *= 0.7;
      }
      g.rect(Math.round(this.wx(p.x)), Math.round(this.wy(p.y) - p.z * TILE), p.size, p.size).fill({ color: p.color, alpha: Math.max(0, 1 - (now - p.born) / p.life) });
    }
    // Rings.
    this.rings = this.rings.filter((r) => now - r.at < 480);
    for (const r of this.rings) {
      const t = (now - r.at) / 480;
      const e = 0.3 + 0.8 * (1 - (1 - t) ** 3);
      g.ellipse(this.wx(r.x), this.wy(r.y) - 10, r.r * TILE * e, r.r * TILE * 0.6 * e).stroke({ width: Math.max(1, 3.5 * (1 - t)), color: r.color, alpha: (1 - t) ** 1.3 });
    }
    this.juice.drawAir(g, now, dt);
    // Words floating up.
    this.floaters = this.floaters.filter((f) => {
      const t = (wallNow - f.at) / f.life;
      if (t >= 1) {
        f.sprite.destroy();
        return false;
      }
      // A pop as it lands, then up and away, slowing.
      f.sprite.position.set(Math.round(f.x), Math.round(f.y - (1 - (1 - t) ** 2.4) * 34));
      if (f.size) f.sprite.scale.set(f.size * (t < 0.1 ? 1.45 - (t / 0.1) * 0.45 : 1));
      f.sprite.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      return true;
    });
    void s;
  }

  // ---- the HUD -------------------------------------------------------------------

  private buildHud() {
    this.yieldBtn = confirmButton("ar-yield", "🏳 Leave", "Tap again to leave", () => this.send({ t: "ArenaLeave" }));
    this.yieldBtn.classList.add("ar-yield");
    this.watchBtn = button("🔭 Watch the fight", () => this.toggleWatch(), "ar-watch");
    const prev = button("◀", () => this.cycleWatch(-1), "ar-watch-step");
    const next = button("▶", () => this.cycleWatch(1), "ar-watch-step");
    prev.title = "Watch the one before (← or A)";
    next.title = "Watch the next (→ or D)";
    this.watchPick.append(prev, this.watchName, next, el("small", "ar-watch-hint", "scroll to zoom"));
    this.watchBar.append(this.watchPick, this.watchBtn);
    this.watchBar.hidden = true;
    // ← → (or A D): whom we're watching.
    window.addEventListener("keydown", this.onWatchKey, true);
    this.hud.append(this.crownsEl, this.center, this.feed, this.selfEl, this.hint, this.touchPad, this.stickEl, this.yieldBtn);
    this.stickEl.append(el("div", "pb-stick-knob"));
    this.stickEl.hidden = true;
    const pressBtn = (key: string, label: string, down: () => void, up?: () => void) => {
      const b = el("button", `ar-btn ${key}`, label);
      b.type = "button";
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.setTouchMode(true);
        b.setPointerCapture(e.pointerId);
        b.classList.add("held");
        down();
      });
      const lift = (e: PointerEvent) => {
        if (!b.classList.contains("held")) return;
        e.preventDefault();
        b.classList.remove("held");
        up?.();
      };
      b.addEventListener("pointerup", lift);
      b.addEventListener("pointercancel", lift);
      this.btns[key] = b;
      return b;
    };
    this.touchPad.append(
      pressBtn("attack", "⚔️", () => this.press(), () => this.release()),
      pressBtn("block", "🛡️", () => this.block(true), () => this.block(false)),
      pressBtn("roll", "💨", () => this.roll()),
      pressBtn("throw", "🎯", () => this.throwIt()),
      pressBtn("special", "🌪️", () => this.special()),
    );
    this.hud.hidden = true;
    this.lobby.hidden = true;
    this.results.hidden = true;
    this.vignette.hidden = true;
    document.body.append(this.vignette, this.hud, this.lobby, this.results, this.watchBar);
  }

  private announce(text: string, color: string, scale = 1, sub = "") {
    const a = el("div", "pb-announce");
    a.style.setProperty("--c", color);
    a.style.setProperty("--s", String(scale));
    a.append(el("div", "pb-announce-main", text));
    if (sub) a.append(el("div", "pb-announce-sub", sub));
    this.center.append(a);
    while (this.center.children.length > 3) this.center.firstElementChild?.remove();
    window.setTimeout(() => a.remove(), 2200);
  }

  private addFeed(a: number, b: number) {
    const row = el("div", "pb-feed-row");
    const name = (id: number) => {
      const s = el("span", "", id ? this.who(id) : "The arena");
      s.style.color = id ? this.cssOf(this.slotOf(id)) : "#ff9a3f";
      if (id === this.selfId()) s.classList.add("me");
      return s;
    };
    row.append(name(a), el("span", "pb-feed-icon", " ⚔️ "), name(b));
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    window.setTimeout(() => row.classList.add("old"), 5000);
    window.setTimeout(() => row.remove(), 6000);
  }

  private beginRound() {
    this.missiles = [];
    this.stuck = [];
    this.lastCount = -1;
    this.me.known = false;
    this.me.knockUntil = 0;
    this.me.kvx = this.me.kvy = 0;
    this.me.rollUntil = this.me.lungeUntil = 0;
    this.results.hidden = true;
  }

  private clear() {
    this.missiles = [];
    this.results.hidden = true;
    for (const sp of this.giftSprites.values()) sp.destroy();
    this.giftSprites.clear();
  }

  /** With classes on, the pick at a round's start: shown to those on the sand. */
  private updatePicker(serverNow: number) {
    const s = this.state;
    const p = this.mine();
    const on = !!s && s.kits && s.status === COUNTDOWN && s.chooseMs > 0 && !!p;
    const left = on ? s!.chooseMs - (serverNow - s!.now) : 0;
    if (!on || left <= 0) {
      this.kitPicker.update(0, null, false, []);
      this.classWheel.update(0, -1, []);
      return;
    }
    // The wheel picks: it spins for us (the Goliath has no class to spin for).
    if (s!.wheel) {
      this.kitPicker.update(0, null, false, []);
      const rest = s!.fighters.filter((f) => !isGiant(f) && f.id !== p!.id).map((f) => ({ name: this.who(f.id), color: this.cssOf(this.slotOf(f.id)), kit: kitOf(f) }));
      this.classWheel.update(left, isGiant(p!) ? -1 : kitOf(p!), rest);
      return;
    }
    const others = s!.fighters
      .filter((f) => !isGiant(f))
      .map((f) => ({ name: this.who(f.id), color: this.cssOf(this.slotOf(f.id)), picked: picked(f), kit: kitOf(f) }));
    this.kitPicker.update(left, picked(p!) ? kitOf(p!) : -1, isGiant(p!), others);
  }

  private updateHud(serverNow: number) {
    const s = this.state;
    const playing = this.capturing;
    // Watching from nearby (or fighting): the crowns bar.
    const self = this.avatarOf(this.selfId());
    const a = this.arenaObj;
    const close = !!self && Math.hypot(self.pos.x - (a.x + a.w / 2), self.pos.y - (a.y + a.h / 2)) < 20;
    const watching = !!s && s.status !== LOBBY && (playing || close);
    this.hud.hidden = !watching;
    this.vignette.hidden = !playing;
    this.stickEl.hidden = !this.stick || !playing;
    if (this.stick && playing) {
      this.stickEl.style.transform = `translate(${this.stick.x0}px, ${this.stick.y0}px)`;
      const dx = this.stick.x - this.stick.x0;
      const dy = this.stick.y - this.stick.y0;
      const d = Math.hypot(dx, dy);
      const k = d > STICK_R ? STICK_R / d : 1;
      (this.stickEl.firstElementChild as HTMLElement).style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
    if (!s || !watching) {
      this.fx.clear();
      return;
    }
    // The crowns: each place, its colour, its crowns, its health.
    const chips = s.slots
      .map((id, k) => {
        if (!id) return "";
        const f = s.fighters.find((q) => q.id === id);
        const crowns = Array.from({ length: TO_WIN }, (_, i) => `<i class="${i < s.crowns[k] ? "on" : ""}">♛</i>`).join("");
        const hp = f ? (Math.max(0, f.hp) / this.maxHp(f)) * 100 : 0;
        return `<div class="ar-chip${f && f.flags & FLAG.DOWN ? " down" : ""}${id === this.selfId() ? " me" : ""}" style="--c:${this.cssOf(k)}"><b>${f && isGiant(f) ? "👹 " : ""}${escape(this.who(id))}</b><span class="ar-cr">${crowns}</span><span class="ar-hp"><i style="width:${hp}%"></i></span></div>`;
      })
      .join("");
    const fire = s.fire / 1000;
    const left = Math.max(0, s.phaseMs - (serverNow - s.now));
    const vs = s.mode === MODE.GOLIATH ? "👹 GOLIATH · " : "";
    const head = s.status === COUNTDOWN ? `${vs}ROUND ${s.round}` : s.status === FIGHTING ? (fire < 1.14 ? "🔥 FIRE!" : `${vs}ROUND ${s.round}`) : s.status === OVER ? "CHAMPION" : "ROUND OVER";
    const html = `<div class="ar-round">${head}</div><div class="ar-chips">${chips}</div>`;
    if (this.crownsEl.dataset.v !== html) {
      this.crownsEl.dataset.v = html;
      this.crownsEl.innerHTML = html;
    }
    // The countdown to the fight.
    if (s.status === COUNTDOWN) {
      const n = Math.ceil(left / 1000);
      if (n !== this.lastCount && n > 0 && n <= 3) {
        this.lastCount = n;
        snd.beep();
        this.announce(String(n), "#ffffff", 2.2);
      }
    }
    // Our own bars, what we hold, the buttons that make sense now.
    const p = this.mine();
    // (In the parade: nothing to fight with.)
    const over = s.status === OVER;
    this.selfEl.hidden = !p || over;
    this.yieldBtn.hidden = !p;
    this.hint.hidden = !p || this.touchMode || over;
    this.touchPad.hidden = !p || !this.touchMode || over;
    if (p) {
      const rage = p.rage >= 100;
      const hold = p.holding ? GIFTS[p.holding] : null;
      const giant = isGiant(p);
      const kit = giant ? KIT.KNIGHT : kitOf(p);
      // (Its ultimate's name, by class.)
      const ult = kit === KIT.ARCHER ? "ARROW STORM" : kit === KIT.BOMBER ? "BIG BANG" : kit === KIT.TANK ? "EARTHQUAKE" : "WHIRLWIND";
      const ultIcon = kit === KIT.ARCHER ? "🏹" : kit === KIT.BOMBER ? "💥" : kit === KIT.TANK ? "🌋" : "🌪";
      const html2 = `<div class="ar-bar hp"><i style="width:${(Math.max(0, p.hp) / this.maxHp(p)) * 100}%"></i><span>${Math.ceil(p.hp)}</span></div><div class="ar-bar st${p.flags & FLAG.WINDED ? " winded" : p.stamina < 25 ? " low" : ""}"><i style="width:${p.stamina}%"></i>${p.flags & FLAG.WINDED ? "<span>WINDED</span>" : ""}</div><div class="ar-bar rage${rage ? " full" : ""}"><i style="width:${p.rage}%"></i><span>${rage ? (giant ? (this.touchMode ? "🤚 GRAB" : "Q · GRAB") : this.touchMode ? `${ultIcon} READY` : `Q · ${ult}`) : "RAGE"}</span></div>${hold ? `<div class="ar-hold">${hold.icon}<small>${this.touchMode ? "⚔️ throws" : "click throws"}</small></div>` : ""}${p.flags & FLAG.FURY ? `<div class="ar-fury">⛑️ FURY</div>` : ""}`;
      if (this.selfEl.dataset.v !== html2) {
        this.selfEl.dataset.v = html2;
        this.selfEl.innerHTML = html2;
      }
      this.hint.textContent = giant
        ? "👹 click: SMASH · hold & let go: STOMP · right-click/Shift: block (knocks bombs back) · Space: DASH (60% stamina) · Q (rage): GRAB, whirl and hurl"
        : p.holding
          ? `click: THROW it · right-click/Shift: block · Space roll · Q ${ult.toLowerCase()}`
          : kit === KIT.ARCHER
            ? `🏹 click: STAB · hold & let go: THE BOW (longer: up to three arrows) · Shift: block · Space roll · Q ${ult.toLowerCase()}`
            : kit === KIT.BOMBER
              ? `💣 click: STAB · hold & let go: BOMB (to your aim; longer: bigger) · Shift: block · Space roll · Q ${ult.toLowerCase()}`
              : `${this.state?.kits ? `${KITS[kit].icon} ` : ""}click ${kit === KIT.SPEARMAN ? "thrust" : kit === KIT.TANK ? "hammer" : "slash"} · hold: ${kit === KIT.TANK ? "STOMP (leap to your aim)" : "heavy"} · right-click/Shift: block (time it: PARRY) · Space roll · Q ${ult.toLowerCase()}`;
      this.btns.special.textContent = giant ? "🤚" : ultIcon;
      this.btns.roll.hidden = false;
      this.btns.roll.classList.toggle("off", giant && p.stamina < GIANT_DASH_COST);
      // (The attack button throws what you hold: it shows what it'll do.)
      this.btns.throw.hidden = true;
      this.btns.attack.textContent = p.holding ? (GIFTS[p.holding]?.icon ?? "⚔️") : "⚔️";
      this.btns.special.hidden = !rage;
      this.btns.attack.classList.toggle("charging", this.me.charging);
    }
    // Over: the champion.
    if (s.status === OVER && !this.shownResults) {
      this.shownResults = true;
      this.showResults(s);
    }
  }

  private showResults(s: State) {
    const me = this.selfId();
    const champ = s.winner;
    if (!champ) snd.fanfare(false);
    const card = el("div", "pb-results-card ar-results");
    const h = el("h2", "", champ === me ? "👑 CHAMPION!" : champ ? `👑 ${this.who(champ).toUpperCase()}` : "NO CHAMPION");
    if (champ) h.style.color = this.cssOf(this.slotOf(champ));
    card.append(h, el("div", "pb-results-score", champ && champ !== me ? "is the champion of the arena" : "Crown of the Colosseum"));
    const table = el("div", "pb-results-table");
    const rows = s.slots.map((id, k) => ({ id, k })).filter((r) => r.id).sort((a, b) => s.crowns[b.k] - s.crowns[a.k]);
    for (const r of rows) {
      const row = el("div", `pb-results-row${r.id === me ? " me" : ""}`);
      const n = el("span", "", this.who(r.id));
      n.style.color = this.cssOf(r.k);
      row.append(n, el("span", "", "♛".repeat(s.crowns[r.k]) || "—"), el("span", "", ""));
      table.append(row);
    }
    card.append(table);
    this.results.replaceChildren(card);
    // With a champion, a banner (the parade's to be watched); else the card.
    this.results.classList.toggle("ar-results-low", !!champ);
    this.results.hidden = false;
    window.setTimeout(() => (this.results.hidden = true), champ ? 11_000 : 8500);
  }

  destroy() {
    this.kitPicker.destroy();
    this.classWheel.destroy();
    this.disaster.destroy();
    this.glows.destroy();
    this.juice.destroy();
    this.bets.destroy();
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("contextmenu", this.onContext);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    for (const id of this.posed) {
      const a = this.avatarOf(id);
      a?.setArena(null);
      a?.setFade(1);
    }
    for (const a of this.bots.values()) a.destroy();
    for (const g of this.gear.values()) g.destroy();
    for (const gs of this.ghosts.values()) for (const gh of gs) gh.destroy();
    this.ghosts.clear();
    for (const sp of this.giftSprites.values()) sp.destroy();
    this.floor.destroy();
    this.lavaG.destroy();
    this.spikesG.destroy();
    for (const t of this.torchStands) t.destroy({ texture: true, textureSource: true });
    for (const p of this.crowd) p.sprite?.destroy();
    for (const gate of this.gates) gate.g.destroy();
    this.pennants.destroy();
    this.petalsG.destroy();
    this.petalsOutG.destroy();
    for (const f of this.fires) {
      f.g.destroy();
      f.night?.destroy();
    }
    this.top.destroy({ children: true });
    for (const e of [this.hud, this.lobby, this.results, this.vignette, this.watchBar]) e.remove();
    window.removeEventListener("keydown", this.onWatchKey, true);
    document.body.classList.remove("pb-playing", "pb-touch-mode", "ar-playing");
  }
}

function smooth(k: number): number {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
