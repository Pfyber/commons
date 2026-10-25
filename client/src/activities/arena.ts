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
// the crowd throws gifts in, and late in a round the ring of fire closes.

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import * as sfx from "../ambient/sfx";
import type { EntityInfo, ServerMsg } from "../net/protocol.gen";
import { button, confirmButton, el, isTyping } from "../ui/panels";
import { type AvatarFrame, BOWL_RELEASE, dozeFrame, SWORD_GUARD, SWORD_RAISE, TILE, toTexture } from "../world/art";
import { Avatar } from "../world/avatars";
import { encodeLook } from "../world/look";
import type { MapObject } from "../world/map";
import { COURT_CAESAR, COURT_OVERHANG, GATE_FIRES, GATE_OVERHANG, PILLAR_FIRE_Y, PILLAR_OVERHANG } from "../world/arenaart";
import { drawPixelText, pixelWidth } from "../world/pixelfont";
import { levelLabel, levelPicker } from "./botlevel";
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
/**
 * The champion's parade, the last of a match (the server's OVER_MS and
 * PARADE_*): out of the ring by the south gate and down the red carpet, the
 * rest trailing behind, heads hung.
 */
const OVER_MS = 15_000;
const PARADE_END = 9.0;
const PARADE_GAP = 1.6;
const PARADE_FIRST_GAP = 2.2;
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
const LIGHT_ARC = 1.0;
const LIGHT_REACH = 1.35;
const HEAVY_MIN_MS = 220;
const HEAVY_FULL_MS = 1000;
const HEAVY: [number, number, number] = [70, 190, 360];
const HEAVY_ARC = 1.25;
const HEAVY_REACH = 1.55;
const HEAVY_LUNGE = 1.7;
const HEAVY_COST = 28;
const ROLL_MS = 260;
const ROLL_DIST = 2.3;
const ROLL_COST = 24;
const ROLL_CD_MS = 450;
const SPIN_REACH = 1.75;
const THROW: [number, number] = [130, 220];
const SPEAR_SPEED = 15;
const SPEAR_RANGE = 11;
const BOMB_SPEED = 9;
const BOMB_RANGE = 6.5;
const BOMB_R = 1.9;
const KB_FRICTION = 5;
/** How long before a press counts as charging a heavy blow (ms). */
const HOLD_MS = 170;
const ACT = { NONE: 0, LIGHT1: 1, LIGHT2: 2, LIGHT3: 3, CHARGE: 4, HEAVY: 5, BLOCK: 6, ROLL: 7, STUN: 8, THROW: 9, SPIN: 10, DOWN: 11 };
const INPUT = { LIGHT: 1, HEAVY_START: 2, HEAVY_RELEASE: 3, BLOCK_ON: 4, BLOCK_OFF: 5, ROLL: 6, THROW: 7, SPECIAL: 8 };
const GIFT = { HEALTH: 1, SPEAR: 2, BOMB: 3, FURY: 4 };
const EV = { HIT: 1, PARRY: 2, GUARD_BREAK: 3, WALL_SLAM: 4, DOWN: 5, SWING: 6, ROLL: 7, GIFT_INCOMING: 8, PICKUP: 10, THROW: 11, BOOM: 12, SPIKED: 14, ROUND_START: 15, FIGHT: 16, ROUND_WON: 17, CHAMPION: 18, SPECIAL: 19, FIRE: 20, STUCK: 21, RAGE_FULL: 22 };
const FLAG = { DOWN: 1, FURY: 2, KNOCKED: 4, IFRAMES: 8, QUEUED: 16, WINDED: 32 };
const GIFTS: Record<number, { icon: string; name: string }> = {
  [GIFT.HEALTH]: { icon: "🍗", name: "ROAST LEG +35" },
  [GIFT.SPEAR]: { icon: "🔱", name: "SPEAR" },
  [GIFT.BOMB]: { icon: "💣", name: "BOMB" },
  [GIFT.FURY]: { icon: "⛑️", name: "FURY!" },
};
/** Each place's colours: their ring, shield, bars and name. */
const COLORS = [0xffc83d, 0x3fa9ff, 0xff4f6a, 0x5fd07a];
const CSS = ["#ffc83d", "#3fa9ff", "#ff4f6a", "#5fd07a"];
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
  | { t: "ArenaMove"; x: number; y: number; aim: number }
  | { t: "ArenaAct"; act: number; aim: number };

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
  ) {}

  free(x: number, y: number, r: number): boolean {
    if (x < r || y < r || x > this.w - r || y > this.h - r) return false;
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

const turn = (a: number, b: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const toU16 = (a: number) => Math.round(((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * 65536) & 0xffff;
const fromU16 = (v: number) => (v / 65536) * Math.PI * 2;

// ---- sound -------------------------------------------------------------------

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
    const t = sfx.at(0);
    sfx.burst(t, 0.06, 0.18 * vol, "highpass", 3000);
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

/** The gifts as little pictures: a roast leg, a spear, a bomb, a helmet. */
const giftTex = new Map<number, Texture>();
function giftTexture(kind: number): Texture {
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
}

/** A tongue of flame, a spark or a wisp of smoke off a brazier (world px). */
interface Flame {
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
    sent: { x: -1, y: -1, aim: -1 },
    rollUntil: 0,
    rollDir: 0,
    rollReady: 0,
    lungeFrom: 0,
    lungeUntil: 0,
    lungeDir: 0,
    lungeDist: 0,
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
  private posed = new Set<number>();
  private missiles: Missile[] = [];
  private stuck: { x: number; y: number; aim: number; until: number }[] = [];
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private rings: { x: number; y: number; color: number; at: number; r: number }[] = [];
  /** Hit-stop: these fighters held still till then. */
  private stopUntil = 0;
  private stopIds = new Set<number>();
  private spikeUpAt: number[] = [];
  private lastSpikes: number[] = [];
  private fx = new Graphics();
  private fires: Fire[] = [];
  /** Caesar's head (world px) and the tile in front of his dais. */
  private caesarAt: { x: number; y: number; tx: number; ty: number } | null = null;
  private prompt = new Sprite(word("CLICK CAESAR TO FIGHT!", "#ffe14f"));
  private promptArrow = new Graphics();
  private nextHail = 0;
  private flames: Flame[] = [];
  private flamesG = new Graphics();
  private floor = new Graphics();
  private spikesG = new Graphics();
  private top = new Container();
  private giftSprites = new Map<string, Sprite>();
  private lastFrame = performance.now();
  // Input.
  private keys = new Set<string>();
  private mouse: { sx: number; sy: number } | null = null;
  private touchMode = false;
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
  private hint = el("div", "ar-hint");
  private touchPad = el("div", "ar-touch");
  private btns: Record<string, HTMLButtonElement> = {};
  private vignette = el("div", "pb-vignette");
  private lobby = el("div", "ar-lobby");
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

  constructor(
    private scene: Scene,
    map: { objects: MapObject[] },
    private labels: HTMLElement,
    private canvas: HTMLCanvasElement,
    private selfId: () => number,
    private avatarOf: (id: number) => Avatar | undefined,
    private nameOf: (id: number) => string,
    private serverNow: () => number,
    private send: (m: ArenaSend) => void,
    /** A warm light that shows after dark (the night's lights), at world (x, y). */
    nightGlow: (x: number, y: number) => Sprite | null = () => null,
  ) {
    const a = map.objects.find((o) => o.kind === "arena")!;
    this.arenaObj = a;
    this.ox = a.x + 1;
    this.oy = a.y + 1;
    const rect = (o: MapObject): Rect => ({ x: o.x - this.ox, y: o.y - this.oy, w: o.w, h: o.h });
    this.ring = new Ring(
      a.w - 2,
      a.h - 2,
      map.objects.filter((o) => o.kind === "arena_pillar").map(rect),
      map.objects.filter((o) => o.kind === "arena_spikes").map(rect),
    );
    // On the sand: the fire's glow and the spikes over the floor, under the fighters; effects over all.
    this.floor.zIndex = this.oy * TILE + 2;
    this.scene.sorted.addChild(this.floor);
    this.top.zIndex = 1e9;
    this.top.addChild(this.fx);
    this.scene.world.addChild(this.top);
    // The braziers on the pillars: their fire (live), their glow by day and their light by night.
    for (const o of map.objects.filter((q) => q.kind === "arena_pillar")) {
      const x = o.x * TILE + (o.w * TILE) / 2;
      const y = o.y * TILE - PILLAR_OVERHANG + PILLAR_FIRE_Y;
      const glow = new Sprite(fireGlow());
      glow.anchor.set(0.5);
      glow.blendMode = "add";
      glow.position.set(x, y - 6);
      this.top.addChildAt(glow, 0);
      this.fires.push({ x, y, glow, night: nightGlow(x, y + 10), phase: Math.random() * 10 });
      this.flamesG.zIndex = Math.max(this.flamesG.zIndex, (o.y + o.h) * TILE);
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
        this.fires.push({ x, y, glow, night: nightGlow(x, y + 10), phase: Math.random() * 10 });
      }
      this.flamesG.zIndex = Math.max(this.flamesG.zIndex, (gateObj.y + gateObj.h) * TILE);
    }
    // Caesar, on his dais: where his head is (for the prompt over him, and his words).
    const court = map.objects.find((q) => q.kind === "arena_court");
    if (court) {
      this.caesarAt = { x: court.x * TILE + COURT_CAESAR[0], y: court.y * TILE - COURT_OVERHANG + COURT_CAESAR[1], tx: court.x + court.w / 2, ty: court.y + court.h };
      this.prompt.anchor.set(0.5, 1);
      this.prompt.scale.set(1.4);
      this.top.addChild(this.prompt, this.promptArrow);
    }
    if (this.fires.length) this.scene.sorted.addChild(this.flamesG);
    // Petals lying on the sand and the carpet: over the floor, under the people.
    this.petalsG.zIndex = this.oy * TILE + 3;
    const carpet = map.objects.find((q) => q.kind === "arena_carpet");
    this.carpetY = carpet ? carpet.y - this.oy - 0.5 : Infinity;
    this.petalsOutG.zIndex = carpet ? carpet.y * TILE + 2 : this.petalsG.zIndex;
    this.scene.sorted.addChild(this.petalsG, this.petalsOutG);
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
    const s = this.scene.scale;
    const w = this.scene.world.position;
    return { x: (this.mouse.sx - w.x) / s / TILE - this.ox, y: (this.mouse.sy - w.y) / s / TILE - this.oy };
  }

  /** Where the camera looks: a little toward the aim, shaking on big blows. */
  camera(pos: { x: number; y: number }): { x: number; y: number } {
    if (!this.capturing) return pos;
    // In the parade: just ahead of us, the way we're walking.
    if (this.state?.status === OVER) return { x: pos.x, y: pos.y + 1 };
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    return { x: pos.x + this.camLead.x + sx, y: pos.y + this.camLead.y + sy };
  }

  // ---- input -------------------------------------------------------------------

  private act(what: number, aim = this.me.aim) {
    this.send({ t: "ArenaAct", act: what, aim: toU16(aim) });
  }

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
    if (e.button === 0) this.press();
    if (e.button === 2) this.block(true);
  };

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
    if (e.pointerType !== "touch") this.mouse = { sx: e.clientX, sy: e.clientY };
  };

  private onUp = (e: PointerEvent) => {
    if (this.stick && this.stick.id === e.pointerId) {
      this.stick = null;
      return;
    }
    if (e.pointerType === "touch" || !this.capturing) return;
    if (e.button === 0) this.release();
    if (e.button === 2) this.block(false);
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
    this.me.pressAt = this.serverNow();
    this.me.charging = false;
  }

  private release() {
    const now = this.serverNow();
    if (!this.me.pressAt) return;
    const p = this.mine();
    if (this.me.charging) {
      this.act(INPUT.HEAVY_RELEASE);
      // The lunge, at once (as the server will have it).
      const held = now - this.me.pressAt - HOLD_MS;
      if (p && held >= HEAVY_MIN_MS && p.stamina >= HEAVY_COST * 0.5 && !(p.flags & FLAG.WINDED)) {
        const charge = Math.min(1, (held - HEAVY_MIN_MS) / (HEAVY_FULL_MS - HEAVY_MIN_MS));
        this.me.lungeFrom = now + HEAVY[0];
        this.me.lungeUntil = now + HEAVY[0] + HEAVY[1];
        this.me.lungeDir = this.me.aim;
        this.me.lungeDist = HEAVY_LUNGE * (1 + charge * 0.3);
      }
    } else {
      this.act(INPUT.LIGHT);
      this.me.swingAt = now;
    }
    this.me.pressAt = 0;
    this.me.charging = false;
  }

  private block(on: boolean) {
    if (on === this.me.blocking) return;
    this.me.blocking = on;
    this.act(on ? INPUT.BLOCK_ON : INPUT.BLOCK_OFF);
  }

  private roll() {
    const p = this.mine();
    const now = this.serverNow();
    if (!p || p.flags & FLAG.DOWN || now < this.me.rollReady || p.stamina < ROLL_COST * 0.5 || this.state?.status !== FIGHTING) return;
    if (p.act === ACT.STUN || p.act === ACT.SPIN || p.act === ACT.HEAVY || p.act === ACT.THROW || p.flags & (FLAG.KNOCKED | FLAG.WINDED)) return;
    // (A charge, cut short.)
    this.me.pressAt = 0;
    this.me.charging = false;
    const d = this.moveDir();
    const dir = d.x || d.y ? Math.atan2(d.y, d.x) : this.me.aim + Math.PI;
    this.me.rollDir = dir;
    this.me.rollUntil = now + ROLL_MS;
    this.me.rollReady = now + ROLL_MS + ROLL_CD_MS;
    this.act(INPUT.ROLL, dir);
    snd.whoosh(0.8);
    this.dust(this.me.x, this.me.y, 6);
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
    const key = s ? `${s.status}|${s.slots.join(",")}|${s.crowns.join(",")}|${mine}|${s.level}` : "none";
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    this.lobby.replaceChildren();
    const head = el("div", "ar-lobby-head");
    const close = button("✕", () => {
      this.lobbyOpen = false;
      this.lobby.hidden = true;
    }, "subtle ar-close");
    head.append(el("strong", "", "🏛️ Caesar's Games"), close);
    const running = !!s && s.status !== LOBBY;
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
      row.style.setProperty("--c", CSS[k]);
      row.append(el("span", "ar-dot"), el("span", "ar-place-name", name), el("span", "ar-place-crowns", running ? "♛".repeat(s!.crowns[k]) : ""));
      // In the lobby, a bot can be taken out, or put in an empty place.
      if (canEdit && bot) row.append(button("✕ Remove", () => this.send({ t: "ArenaBot", slot: k, on: false }), "subtle ar-bot-btn"));
      if (canEdit && id === 0) row.append(button("🤖 + Add bot", () => this.send({ t: "ArenaBot", slot: k, on: true }), "subtle ar-bot-btn"));
      places.append(row);
    }
    // The match this makes.
    const fighters = s ? s.slots.filter((x) => x !== 0).length : 0;
    const people = s ? s.slots.filter((x) => x !== 0 && !(x >= BOT_BASE && x < BOT_BASE + SLOTS)).length : 0;
    const mode = fighters <= 1 ? "Add a bot (or wait for someone) to fight" : fighters === 2 ? "⚔️ A duel: one on one" : fighters === 3 ? "⚔️ A three-way fight" : "⚔️ A four-gladiator brawl";
    const bots = fighters - people;
    const modeEl = el("p", "ar-mode", running ? (bots > 0 ? `Bots: ${levelLabel(s!.level)}` : "") : `${mode}${fighters >= 2 ? ` · ${people} ${people === 1 ? "person" : "people"}, ${bots} ${bots === 1 ? "bot" : "bots"}` : ""}`);
    // How good the bots are: those with a place pick, in the lobby.
    const level = !running && s ? levelPicker(s.level, canEdit ? (l) => this.send({ t: "ArenaLevel", level: l }) : null) : null;
    const actions = el("div", "ar-lobby-actions");
    if (!running && mine >= 0) {
      const go = button("⚔️ FIGHT!", () => this.send({ t: "ArenaStart", bots: false }), "primary");
      go.disabled = fighters < 2;
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
        : "WASD move · mouse aim · click slash (keep clicking: combo) · hold click: heavy lunge · holding a spear or bomb, click throws it · right click/Shift block (just in time: PARRY) · Space roll · Q whirlwind",
    );
    this.lobby.append(head, sub, places, modeEl, ...(level ? [level] : []), actions, how);
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
      if (!this.me.known || p.fix !== this.me.fix || s.status !== FIGHTING || p.flags & FLAG.DOWN || far > 2.5) {
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
    if (this.capturing && !this.touchMode && matchMedia("(pointer: coarse)").matches) this.setTouchMode(true);
    if (this.capturing) this.lobbyOpen = false;
    this.renderLobby();
  }

  onEvent(e: ArenaEv) {
    const me = this.selfId();
    const x = e.x / 100;
    const y = e.y / 100;
    const nearMe = this.near(x, y);
    const now = performance.now();
    switch (e.kind) {
      case EV.SWING:
        sfx.swordSwing(e.n === ACT.HEAVY ? 0 : 1, nearMe * (e.n === ACT.HEAVY ? 1 : 0.5));
        break;
      case EV.HIT: {
        const blocked = (e.m & 1) !== 0;
        const heavy = (e.m & 2) !== 0;
        const big = heavy || (e.m & 4) !== 0 || (e.m & 32) !== 0;
        const color = blocked ? 0x9fd3ee : big ? 0xffa03f : 0xfff1a8;
        this.sparks(x, y - 0.4, color, blocked ? 8 : big ? 18 : 10);
        this.float(blocked ? `${e.n}` : `-${e.n}`, blocked ? "#9fd3ee" : big ? "#ff8a4a" : "#ffffff", x, y - 1.3, big ? 1.5 : 1);
        if (blocked) sfx.swordClang(nearMe * 0.7);
        else sfx.swordHit(nearMe * (big ? 1 : 0.65));
        if (big) {
          this.hitStop([e.a, e.b], heavy ? 110 : 80);
          if (e.a === me || e.b === me) this.shake = Math.max(this.shake, heavy ? 0.28 : 0.18);
        }
        if (e.a === me) this.buzz(big ? 30 : 12);
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
        this.ringFx(x, y, 0xffffff, heavy ? 2.2 : 1.6);
        this.sparks(x, y - 0.5, heavy ? 0xffe14f : 0xffffff, heavy ? 34 : 22);
        this.float(heavy ? "HEAVY PARRIED!" : "PARRY!", "#ffe14f", x, y - 1.6, heavy ? 1.8 : 2);
        sfx.swordParry(nearMe);
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
        sfx.swordClang(nearMe);
        this.sparks(x, y - 0.5, 0xff9a3f, 14);
        break;
      case EV.WALL_SLAM:
        this.float("WALL SLAM!", "#ff6a6a", x, y - 1.6, 1.6);
        this.dust(x, y, 16);
        snd.thud(nearMe);
        this.hitStop([e.b], 120);
        if (e.a === me || e.b === me) this.shake = Math.max(this.shake, 0.3);
        sfx.crowdRoar(0.35);
        break;
      case EV.DOWN:
        this.sparks(x, y - 0.4, COLORS[this.slotOf(e.b)], 26);
        this.dust(x, y, 18);
        this.float("DOWN!", "#ff4f6a", x, y - 1.8, 1.8);
        this.addFeed(e.a, e.b);
        sfx.crowdRoar(0.7);
        if (e.b === me) this.announce("YOU'RE DOWN", "#ff4f6a", 1.3, "watch the rest of the round from the sand");
        else if (e.a === me) this.announce(`${this.who(e.b).toUpperCase()} IS DOWN!`, "#ffe14f", 1.2);
        break;
      case EV.ROLL:
        if (e.a !== me) {
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
        this.ringFx(x, y, 0xffe14f, 1);
        this.float(g?.name ?? "GIFT", "#ffe14f", x, y - 1.4, 1.2);
        snd.pickup();
        if (e.a === me) {
          if (e.n === GIFT.SPEAR || e.n === GIFT.BOMB) this.announce(`${g.icon} ${g.name}`, "#ffe14f", 1, this.touchMode ? "tap ⚔️ to throw it" : "attack (click) to throw it where you aim");
          else if (e.n === GIFT.FURY) this.announce("⛑️ FURY!", "#ff9a3f", 1.2, "hits half again as hard, for a while");
        }
        break;
      }
      case EV.THROW: {
        const aim = fromU16(e.m);
        const bomb = e.n === GIFT.BOMB;
        const speed = bomb ? BOMB_SPEED : SPEAR_SPEED;
        const range = bomb ? BOMB_RANGE : SPEAR_RANGE;
        this.missiles.push({ by: e.a, kind: e.n, x: x + Math.cos(aim) * 0.5, y: y + Math.sin(aim) * 0.5, vx: Math.cos(aim) * speed, vy: Math.sin(aim) * speed, left: range, range, born: now });
        snd.whoosh(nearMe);
        break;
      }
      case EV.BOOM:
        this.dropMissile(e.a, GIFT.BOMB);
        this.explode(x, y);
        snd.boom(Math.max(0.5, nearMe));
        if (this.capturing && Math.hypot(this.me.x - x, this.me.y - y) < 5) this.shake = Math.max(this.shake, 0.4);
        break;
      case EV.STUCK:
        this.dropMissile(e.a, GIFT.SPEAR);
        this.stuck.push({ x, y, aim: fromU16(e.m), until: now + 2500 });
        snd.thud(nearMe * 0.5);
        break;
      case EV.SPIKED:
        this.float("OUCH!", "#ff6a6a", x, y - 1.4, 1);
        this.sparks(x, y - 0.2, 0xd8dce8, 10);
        if (e.b === me) this.buzz(40);
        break;
      case EV.ROUND_START:
        snd.gong();
        this.announce(`ROUND ${e.n}`, "#ffe14f", 1.8);
        break;
      case EV.FIGHT:
        snd.horn();
        sfx.crowdRoar(0.8);
        this.announce("FIGHT!", "#ff6a3f", 2.2);
        break;
      case EV.ROUND_WON:
        sfx.crowdRoar(1);
        if (e.a === 0) this.announce("NOBODY LEFT STANDING", "#c9c2b0", 1.2);
        else this.announce(e.a === me ? "YOU TAKE THE ROUND! ♛" : `${this.who(e.a).toUpperCase()} TAKES THE ROUND ♛`, CSS[this.slotOf(e.a)], 1.4);
        break;
      case EV.CHAMPION:
        break;
      case EV.SPECIAL:
        this.float("WHIRLWIND!", "#c77dff", x, y - 1.8, 1.6);
        this.ringFx(x, y, 0xc77dff, SPIN_REACH);
        snd.whoosh(nearMe);
        if (e.a === me) this.shake = Math.max(this.shake, 0.15);
        break;
      case EV.FIRE:
        this.announce("🔥 THE RING OF FIRE CLOSES IN", "#ff6a3f", 1.1, "get to the middle!");
        sfx.crowdRoar(0.6);
        break;
      case EV.RAGE_FULL:
        if (e.a === me) this.announce("😡 RAGE FULL", "#c77dff", 1.1, this.touchMode ? "tap 🌪 to whirl" : "press Q to unleash the whirlwind");
        else this.float("RAGE!", "#c77dff", x, y - 1.6, 1);
        break;
    }
  }

  private near(x: number, y: number): number {
    if (!this.capturing) return 0.5;
    return Math.max(0.2, 1 - Math.hypot(x - this.me.x, y - this.me.y) / 18);
  }

  private buzz(pattern: number | number[]) {
    if (this.touchMode) navigator.vibrate?.(pattern);
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
    const dt = Math.min(0.05, (wallNow - this.lastFrame) / 1000);
    this.lastFrame = wallNow;
    this.fx.clear();
    this.drawFires(wallNow, dt);
    this.drawCaesar(wallNow);
    const s = this.state;
    const live = !!s && s.status !== LOBBY;
    const me = this.selfId();
    const p = this.mine();
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
          avatar.setArena({ x: t.x, y: t.y, facing: m.face, frame: m.frame, walking: m.walking, hurt: false, lean: m.lean, lift: m.lift });
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
        const self = f.id === me && this.me.known;
        let pos = self ? { x: this.me.x, y: this.me.y, aim: this.me.aim } : this.glide(f.id, at);
        // Hit-stop: frozen a beat on a big blow.
        const prevPose = this.held.get(f.id);
        if (stopped && this.stopIds.has(f.id) && prevPose) pos = prevPose;
        this.held.set(f.id, pos);
        const prev = self ? null : this.glide(f.id, at - 80);
        const moving = self ? Math.hypot(this.me.vx, this.me.vy) > 0.6 : !!prev && Math.hypot(pos.x - prev.x, pos.y - prev.y) > 0.04;
        const since = serverNow - (s.now - f.actMs) - (self ? 0 : RENDER_DELAY_MS * 0.5);
        const pose = this.pose(f, since, serverNow, self);
        const t = this.toTile(pos.x, pos.y);
        const face: 1 | -1 = f.act === ACT.SPIN ? (Math.floor(serverNow / 90) % 2 ? 1 : -1) : Math.cos(pos.aim) >= 0 ? 1 : -1;
        avatar.setArena({ x: t.x, y: t.y, facing: face, frame: pose.frame, walking: moving && pose.frame === null && !(f.flags & FLAG.DOWN), hurt: pose.hurt, lean: pose.lean, lift: pose.lift });
        avatar.setFade(f.flags & FLAG.DOWN ? 0.7 : 1);
        this.posed.add(f.id);
        this.drawGear(f, pos, since, serverNow, avatar, pose);
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
  }

  private held = new Map<number, { x: number; y: number; aim: number }>();
  private whirled = new Map<number, number>();
  private wasWinded = false;

  /** Us: knocked flying, rolling, lunging, or walking (slower blocking, charging or swinging). */
  private moveSelf(p: F, s: State, serverNow: number, wallNow: number, dt: number) {
    const d = this.moveDir();
    // Aim: the mouse, or by touch whoever's nearest.
    if (this.touchMode) this.me.aim = this.autoAim(d);
    else {
      const aimAt = this.aimPoint();
      if (aimAt) this.me.aim = Math.atan2(aimAt.y - this.me.y, aimAt.x - this.me.x);
    }
    // A press held long enough: charging a heavy blow.
    if (this.me.pressAt && !this.me.charging && serverNow - this.me.pressAt >= HOLD_MS && s.status === FIGHTING) {
      this.me.charging = true;
      this.act(INPUT.HEAVY_START);
    }
    const down = (p.flags & FLAG.DOWN) !== 0;
    if (s.status === FIGHTING && !down) {
      let moved = false;
      if (serverNow < this.me.knockUntil || Math.hypot(this.me.kvx, this.me.kvy) > 0.3) {
        // Knocked flying: the same knock as the server's.
        const [nx, ny, bumped] = this.ring.slide(this.me.x, this.me.y, this.me.kvx * dt, this.me.kvy * dt, BODY_R);
        this.me.x = nx;
        this.me.y = ny;
        const decay = Math.exp(-KB_FRICTION * dt);
        this.me.kvx = bumped ? 0 : this.me.kvx * decay;
        this.me.kvy = bumped ? 0 : this.me.kvy * decay;
        if (Math.hypot(this.me.kvx, this.me.kvy) < 0.3) this.me.kvx = this.me.kvy = 0;
        this.me.vx = this.me.vy = 0;
        moved = true;
      } else if (serverNow < this.me.rollUntil) {
        const step = (ROLL_DIST / (ROLL_MS / 1000)) * dt;
        [this.me.x, this.me.y] = this.ring.slide(this.me.x, this.me.y, Math.cos(this.me.rollDir) * step, Math.sin(this.me.rollDir) * step, BODY_R);
        this.me.vx = Math.cos(this.me.rollDir) * 4;
        this.me.vy = Math.sin(this.me.rollDir) * 4;
        moved = true;
      } else if (serverNow >= this.me.lungeFrom && serverNow < this.me.lungeUntil && p.act !== ACT.STUN) {
        const step = (this.me.lungeDist / (HEAVY[1] / 1000)) * dt;
        [this.me.x, this.me.y] = this.ring.slide(this.me.x, this.me.y, Math.cos(this.me.lungeDir) * step, Math.sin(this.me.lungeDir) * step, BODY_R);
        moved = true;
      }
      if (!moved) {
        const slow = this.speedFor(p, serverNow);
        const k = Math.min(1, dt * (d.x || d.y ? 16 : 20));
        this.me.vx += (d.x * SPEED * slow - this.me.vx) * k;
        this.me.vy += (d.y * SPEED * slow - this.me.vy) * k;
        const [nx, ny] = this.ring.slide(this.me.x, this.me.y, this.me.vx * dt, this.me.vy * dt, BODY_R);
        if (Math.abs(nx - this.me.x) < Math.abs(this.me.vx * dt) * 0.5) this.me.vx = 0;
        if (Math.abs(ny - this.me.y) < Math.abs(this.me.vy * dt) * 0.5) this.me.vy = 0;
        this.me.x = nx;
        this.me.y = ny;
      }
      if (wallNow - this.me.sentAt >= MOVE_EVERY_MS) {
        const x = Math.round(this.me.x * 100);
        const y = Math.round(this.me.y * 100);
        const aim = toU16(this.me.aim);
        if (x !== this.me.sent.x || y !== this.me.sent.y || Math.abs(aim - this.me.sent.aim) > 300) {
          this.send({ t: "ArenaMove", x, y, aim });
          this.me.sent = { x, y, aim };
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
  private pose(f: F, since: number, now: number, self: boolean): Pose {
    if (f.flags & FLAG.DOWN) return { frame: 2, lean: 0, lift: 0, hurt: false };
    const face = Math.cos(fromU16(f.aim)) >= 0 ? 1 : -1;
    // Our own slash shows the moment it's pressed.
    if (self && f.act === ACT.NONE && now - this.me.swingAt < LIGHT[0][0]) return { frame: SWORD_RAISE, lean: -face * 0.06, lift: 0, hurt: false };
    if (self && this.me.charging && f.act !== ACT.CHARGE) return { frame: SWORD_RAISE, lean: -face * 0.1, lift: 0, hurt: false };
    switch (f.act) {
      case ACT.LIGHT1:
      case ACT.LIGHT2:
      case ACT.LIGHT3: {
        const [w] = LIGHT[f.act - ACT.LIGHT1];
        return since < w ? { frame: SWORD_RAISE, lean: -face * 0.06, lift: 0, hurt: false } : { frame: BOWL_RELEASE, lean: face * (f.act === ACT.LIGHT3 ? 0.18 : 0.1), lift: 0, hurt: false };
      }
      case ACT.CHARGE: {
        const k = Math.min(1, since / HEAVY_FULL_MS);
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
        return { frame: null, lean: Math.sin(now / 55) * 0.1, lift: 0, hurt: true };
      case ACT.THROW:
        return since < THROW[0] ? { frame: SWORD_RAISE, lean: -face * 0.15, lift: 0, hurt: false } : { frame: BOWL_RELEASE, lean: face * 0.2, lift: 0, hurt: false };
      case ACT.SPIN:
        return { frame: BOWL_RELEASE, lean: 0, lift: 2, hurt: false };
    }
    if (f.flags & FLAG.KNOCKED) return { frame: null, lean: 0, lift: 0, hurt: true };
    return { frame: null, lean: 0, lift: 0, hurt: false };
  }

  /** Sword and shield (in their colour), the ring under them, the slash's arc, and their bars. */
  private drawGear(f: F, pos: { x: number; y: number; aim: number }, since: number, now: number, avatar: Avatar, pose: Pose) {
    let g = this.gear.get(f.id);
    if (!g) {
      g = new Graphics();
      this.scene.sorted.addChild(g);
      this.gear.set(f.id, g);
    }
    g.clear();
    const slot = this.slotOf(f.id);
    const color = COLORS[slot];
    const fx = this.wx(pos.x);
    const feet = this.wy(pos.y) - 4;
    const down = (f.flags & FLAG.DOWN) !== 0;
    g.position.set(0, 0);
    g.zIndex = avatar.sprite.zIndex + 0.4;
    const face = Math.cos(pos.aim) >= 0 ? 1 : -1;
    // The ring under them.
    g.ellipse(fx, feet + 2, 12, 5).stroke({ width: f.id === this.selfId() ? 2 : 1.5, color, alpha: down ? 0.3 : 0.85 });
    if (down) return;
    // Charging: a glow building under them.
    if (f.act === ACT.CHARGE || (f.id === this.selfId() && this.me.charging)) {
      const k = Math.min(1, since / HEAVY_FULL_MS);
      g.ellipse(fx, feet + 2, 10 + k * 8, 4 + k * 3).fill({ color: 0xff9a3f, alpha: 0.18 + 0.3 * k });
      if (k >= 1 && Math.floor(now / 120) % 2) g.ellipse(fx, feet + 2, 20, 8).stroke({ width: 1, color: 0xffe14f, alpha: 0.9 });
    }
    const ox = fx;
    const oy = feet - pose.lift;
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
    const blocking = f.act === ACT.BLOCK || (f.id === this.selfId() && this.me.blocking && f.act === ACT.NONE);
    const swinging = [ACT.LIGHT1, ACT.LIGHT2, ACT.LIGHT3, ACT.HEAVY, ACT.THROW].includes(f.act);
    // The shield, in their colour: up in front when blocking.
    if (f.act !== ACT.ROLL) {
      const sh = blocking ? { x: face * 7, y: -30 } : { x: -face * 11, y: -22 };
      g.rect(ox + sh.x - 6, oy + sh.y - 1, 12, 13).fill({ color: 0x1a1020 });
      g.rect(ox + sh.x - 5, oy + sh.y, 10, 11).fill({ color });
      g.rect(ox + sh.x - 1, oy + sh.y + 3, 2, 4).fill({ color: 0xfff6d8 });
      if (blocking) g.rect(ox + sh.x - 7, oy + sh.y - 3, 14, 17).stroke({ color: 0x9fe8ff, width: 1, alpha: 0.6 + 0.3 * Math.sin(now / 90) });
    }
    // The sword.
    if (f.act === ACT.CHARGE) {
      const k = Math.min(1, since / HEAVY_FULL_MS);
      blade(face * 4, -32, -face * (6 + 8 * k), -46 - 4 * k, true);
    } else if (f.act === ACT.SPIN) {
      const a = (now / 60) % (Math.PI * 2);
      blade(0, -18, Math.cos(a) * 22, -18 + Math.sin(a) * 10, true);
    } else if (swinging) {
      const w = f.act === ACT.HEAVY ? HEAVY[0] : f.act === ACT.THROW ? THROW[0] : LIGHT[f.act - ACT.LIGHT1][0];
      if (since < w) blade(face * 6, -26, -face * 10, -32, f.act === ACT.HEAVY);
      else if (f.act === ACT.HEAVY) blade(face * 8, -24, face * 30, -6);
      else blade(face * 8, -17, face * 26, -17 + (f.act === ACT.LIGHT2 ? 6 : 0));
    } else if (blocking) blade(face * 9, -10, face * 9, -34);
    else if (f.act !== ACT.ROLL) blade(face * 7, -13, face * 15, -23);
    // What they're holding, over their shoulder.
    if (f.holding === 2) line(ox - face * 10, oy - 6, ox + face * 6, oy - 40, 0x8f6236, 2);
    if (f.holding === 3) g.circle(ox - face * 10, oy - 18, 4).fill({ color: 0x2f2c38 }).stroke({ width: 1, color: 0x1a1020 });
    // Bars over the head: health in their colour, rage under it.
    const bx = Math.round(fx) - 15;
    const by = Math.round(oy) - 52;
    g.rect(bx - 1, by - 1, 32, 6).fill({ color: 0x1a1020 });
    g.rect(bx, by, 30, 4).fill({ color: 0x3a3046 });
    g.rect(bx, by, Math.round((30 * f.hp) / 100), 4).fill({ color: f.hp < 30 ? 0xff4f6a : color });
    g.rect(bx, by + 5, 30, 1).fill({ color: 0x1a1020 });
    g.rect(bx, by + 5, Math.round((30 * f.rage) / 100), 1).fill({ color: f.rage >= 100 ? (Math.floor(now / 150) % 2 ? 0xffe14f : 0xc77dff) : 0xc77dff });
    if (f.flags & FLAG.FURY) g.rect(bx - 3, by - 3, 36, 10).stroke({ width: 1, color: 0xff9a3f, alpha: 0.7 + 0.3 * Math.sin(now / 80) });
    // The swing's arc, swept out on the sand (in the effects layer).
    this.arc(f, pos, since, now, color);
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
        const [w, a] = LIGHT[f.act - ACT.LIGHT1];
        if (since >= w && since < w + a + 80) sweep(LIGHT_REACH, LIGHT_ARC, Math.min(1, (since - w) / a), f.act === ACT.LIGHT3 ? 0xffe14f : 0xffffff, f.act === ACT.LIGHT3 ? 4 : 3, 0.85);
        break;
      }
      case ACT.HEAVY:
        if (since >= HEAVY[0] && since < HEAVY[0] + HEAVY[1] + 100) {
          sweep(HEAVY_REACH, HEAVY_ARC, Math.min(1, (since - HEAVY[0]) / HEAVY[1]), 0xff9a3f, 5, 0.95);
          if (Math.random() < 0.6) this.dust(pos.x, pos.y, 1);
        }
        break;
      case ACT.SPIN: {
        const r = SPIN_REACH * TILE * 0.85;
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
    if (running) {
      const gx = (a.x + a.w / 2 - 1) * TILE;
      // The parade: the south gate winched up for the champion.
      const pt = this.parade && s?.status === OVER ? (serverNow - this.parade.start) / 1000 : -1;
      const up = pt < 0 ? 0 : Math.min(1, Math.max(0, (pt - (SALUTE - 0.9)) / 0.8));
      for (const gy of [a.y * TILE, (a.y + a.h - 1) * TILE]) {
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
        const inside = fire * fire - dy * dy;
        const half = inside > 0 ? Math.sqrt(inside) * cx : 0;
        const x0 = cx - half;
        const x1 = cx + half;
        if (x0 > 0) g.rect(this.wx(0), this.wy(y), x0 * TILE, TILE / 4).fill({ color: 0xff4f1a, alpha: 0.22 });
        if (x1 < this.ring.w) g.rect(this.wx(x1), this.wy(y), (this.ring.w - x1) * TILE, TILE / 4).fill({ color: 0xff4f1a, alpha: 0.22 });
      }
      // Flames along the edge.
      for (let i = 0; i < 90; i++) {
        const t = (i / 90) * Math.PI * 2;
        const x = cx + Math.cos(t) * cx * fire;
        const y = cy + Math.sin(t) * cy * fire;
        if (x < 0 || y < 0 || x > this.ring.w || y > this.ring.h) continue;
        const flick = Math.sin(wallNow / 70 + i * 1.7) * 0.5 + 0.5;
        const h = 6 + flick * 8;
        g.rect(Math.round(this.wx(x)) - 2, Math.round(this.wy(y) - h), 4, h).fill({ color: flick > 0.5 ? 0xffd23f : 0xff6a1a, alpha: 0.85 });
        g.rect(Math.round(this.wx(x)) - 1, Math.round(this.wy(y) - h - 3), 2, 3).fill({ color: 0xfff4c4, alpha: flick });
      }
    }
    // The spikes: rattling (red, shaking), then up.
    this.ring.spikes.forEach((sp, k) => {
      const phase = s.spikes[k] ?? 0;
      if (phase === 2 && this.lastSpikes[k] !== 2) {
        this.spikeUpAt[k] = wallNow;
        // (Heard only right by them: they come up all match long.)
        const near = this.capturing ? 1 - Math.hypot(sp.x + 1 - this.me.x, sp.y + 1 - this.me.y) / 4 : 0;
        if (near > 0) snd.spikes(near);
      }
      this.lastSpikes[k] = phase;
      const x0 = this.wx(sp.x);
      const y0 = this.wy(sp.y);
      if (phase === 1) {
        const pulse = 0.25 + 0.25 * Math.sin(wallNow / 60);
        const jx = Math.round(Math.sin(wallNow / 23) * 1);
        g.rect(x0 + 3 + jx, y0 + 3, sp.w * TILE - 6, sp.h * TILE - 6).fill({ color: 0xff2a2a, alpha: pulse });
      } else if (phase === 2) {
        const k2 = Math.min(1, (wallNow - (this.spikeUpAt[k] ?? 0)) / 90);
        for (let yy = 9; yy < sp.h * TILE - 6; yy += 9) {
          for (let xx = 9 + ((yy / 9) % 2) * 4; xx < sp.w * TILE - 6; xx += 9) {
            const h = 10 * k2;
            g.poly([x0 + xx - 3, y0 + yy + 1, x0 + xx + 3, y0 + yy + 1, x0 + xx, y0 + yy + 1 - h]).fill({ color: 0xd8dce8 });
            g.rect(x0 + xx - 1, y0 + yy + 1 - h, 1, h * 0.7).fill({ color: 0xffffff, alpha: 0.8 });
          }
        }
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
      sp.position.set(Math.round(this.wx(x)), Math.round(this.wy(y) - fall * 160 - (left <= 0 ? 3 + Math.sin(wallNow / 250) * 2 : 0)));
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
        if (!this.ring.free(nx, ny, 0.05)) return m.kind === 3 ? true : false;
        m.x = nx;
        m.y = ny;
        // On someone (the server says what it did): gone from here.
        const hit = s.fighters.some((f) => f.id !== m.by && !(f.flags & (FLAG.DOWN | FLAG.IFRAMES)) && (() => {
          const p = f.id === this.selfId() ? this.me : this.glide(f.id, at);
          return Math.hypot(p.x - nx, p.y - ny) < BODY_R + 0.2;
        })());
        if (hit) return m.kind === 3;
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
    const x = this.ring.w / 2 + (champ ? 0 : k % 2 === 0 ? -0.55 : 0.55);
    const fy = this.ring.h / 2 - off;
    const ey = this.ring.h + PARADE_END - off;
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
    const color = COLORS[this.slotOf(f.id)];
    const fx = this.wx(m.x);
    const feet = this.wy(m.y) - 4;
    const ox = fx;
    const oy = feet - m.lift;
    const face = m.face;
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
      const color = CSS[this.slotOf(champ)];
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
    this.floaters.push({ sprite: s, x: c.x, y: c.y - 24, at: performance.now(), life });
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
      this.floaters.push({ sprite: s, x: c.x + 18, y: c.y - 40, at: wallNow, life: 2600 });
    }
  }

  // ---- the braziers ---------------------------------------------------------------

  /**
   * Each brazier's fire, alive: a flickering core of nested flame shapes,
   * tongues of flame licking up off it (white-hot, yellow, orange, red, then
   * smoke), sparks drifting high, and its warm light breathing with it.
   */
  private drawFires(wallNow: number, dt: number) {
    if (!this.fires.length) return;
    const g = this.flamesG.clear();
    const t = wallNow / 1000;
    for (const f of this.fires) {
      // New tongues, sparks and smoke.
      const n = Math.random() < (dt * 130) % 1 ? Math.ceil(dt * 130) : Math.floor(dt * 130);
      for (let i = 0; i < n; i++) {
        this.flames.push({ x: f.x + (Math.random() - 0.5) * 20, y: f.y + 2, vx: (Math.random() - 0.5) * 8, vy: -(30 + Math.random() * 30), born: wallNow, life: 320 + Math.random() * 320, kind: 0, size: Math.random() < 0.5 ? 4 : 3 });
      }
      if (Math.random() < dt * 5) this.flames.push({ x: f.x + (Math.random() - 0.5) * 10, y: f.y - 6, vx: (Math.random() - 0.5) * 18, vy: -(40 + Math.random() * 40), born: wallNow, life: 700 + Math.random() * 600, kind: 1, size: 1 });
      if (Math.random() < dt * 4) this.flames.push({ x: f.x + (Math.random() - 0.5) * 6, y: f.y - 18, vx: (Math.random() - 0.5) * 4, vy: -(10 + Math.random() * 8), born: wallNow, life: 1200 + Math.random() * 600, kind: 2, size: 3 });
      // The core: nested flame shapes (red outside, white at the heart), swaying.
      const layers: [number, number, number][] = [
        [12, 29, 0xd8341a],
        [10, 24, 0xff6a1a],
        [8, 18, 0xff9a3f],
        [5, 12, 0xffd23f],
        [3, 7, 0xfff4c4],
      ];
      for (const [r, h, color] of layers) {
        const hh = h * (0.9 + 0.12 * Math.sin(t * 11 + f.phase + r) + 0.06 * Math.sin(t * 23 + r * 3));
        for (let yy = 0; yy < hh; yy++) {
          const k = yy / hh;
          const half = r * Math.pow(1 - k, 0.75) * (1 + 0.14 * Math.sin(t * 17 + yy * 0.7 + f.phase));
          const sway = Math.sin(t * 6 + yy * 0.35 + f.phase) * k * 3;
          if (half < 0.5) continue;
          g.rect(Math.round(f.x - half + sway), Math.round(f.y - yy), Math.max(1, Math.round(half * 2)), 1).fill({ color });
        }
      }
      // The glow breathing; brighter as the flames leap.
      const flick = 0.85 + 0.1 * Math.sin(t * 9 + f.phase) + 0.05 * Math.sin(t * 21 + f.phase * 2) + (Math.random() - 0.5) * 0.06;
      f.glow.scale.set(2.3 * flick, 2.1 * flick);
      f.glow.alpha = 0.42 * flick;
      if (f.night) f.night.alpha = 0.7 * flick;
    }
    // The tongues, sparks and smoke, rising and fading.
    this.flames = this.flames.filter((p) => wallNow - p.born < p.life);
    for (const p of this.flames) {
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

  private explode(x: number, y: number) {
    const now = performance.now();
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + Math.random() * 6;
      this.particles.push({ x, y, z: 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: 1 + Math.random() * 4, born: now, life: 300 + Math.random() * 500, color: [0xffd23f, 0xff9a3f, 0xff4f1a, 0x5a5050][i % 4], size: i % 5 === 0 ? 4 : 3 });
    }
    this.ringFx(x, y, 0xff9a3f, BOMB_R);
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
    this.floaters.push({ sprite, x: this.wx(x), y: this.wy(y), at: performance.now(), life: 1100 });
  }

  private drawFx(wallNow: number, dt: number, s: State | null, serverNow: number) {
    void serverNow;
    const g = this.fx;
    // Missiles: a spear flying level, a bomb arcing with its fuse fizzing.
    for (const m of this.missiles) {
      const x = this.wx(m.x);
      const y = this.wy(m.y);
      g.ellipse(x, y, 4, 1.5).fill({ color: 0x000000, alpha: 0.25 });
      if (m.kind === 3) {
        const k = 1 - m.left / m.range;
        const h = 14 + Math.sin(k * Math.PI) * 26;
        g.circle(x, y - h, 5).fill({ color: 0x2f2c38 }).stroke({ width: 1, color: 0x1a1020 });
        g.rect(x + 2, y - h - 7, 2, 3).fill({ color: Math.floor(wallNow / 60) % 2 ? 0xffd23f : 0xff6a3f });
      } else {
        const a = Math.atan2(m.vy, m.vx);
        const L = 20;
        for (let k = 0; k < L; k += 1) g.rect(Math.round(x - Math.cos(a) * k), Math.round(y - 14 - Math.sin(a) * k * 0.7), 2, 2).fill({ color: k < 4 ? 0xd8dce8 : 0x8f6236 });
      }
    }
    // Spears stuck in the walls a while.
    this.stuck = this.stuck.filter((st) => wallNow < st.until);
    for (const st of this.stuck) {
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
    this.rings = this.rings.filter((r) => now - r.at < 450);
    for (const r of this.rings) {
      const t = (now - r.at) / 450;
      g.ellipse(this.wx(r.x), this.wy(r.y) - 10, r.r * TILE * (0.3 + t * 0.8), r.r * TILE * 0.6 * (0.3 + t * 0.8)).stroke({ width: 3, color: r.color, alpha: 1 - t });
    }
    // Words floating up.
    this.floaters = this.floaters.filter((f) => {
      const t = (wallNow - f.at) / f.life;
      if (t >= 1) {
        f.sprite.destroy();
        return false;
      }
      f.sprite.position.set(Math.round(f.x), Math.round(f.y - t * 30));
      f.sprite.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      return true;
    });
    void s;
  }

  // ---- the HUD -------------------------------------------------------------------

  private buildHud() {
    this.yieldBtn = confirmButton("ar-yield", "🏳 Leave", "Tap again to leave", () => this.send({ t: "ArenaLeave" }));
    this.yieldBtn.classList.add("ar-yield");
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
    document.body.append(this.vignette, this.hud, this.lobby, this.results);
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
      s.style.color = id ? CSS[this.slotOf(id)] : "#ff9a3f";
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
        const hp = f ? Math.max(0, f.hp) : 0;
        return `<div class="ar-chip${f && f.flags & FLAG.DOWN ? " down" : ""}${id === this.selfId() ? " me" : ""}" style="--c:${CSS[k]}"><b>${escape(this.who(id))}</b><span class="ar-cr">${crowns}</span><span class="ar-hp"><i style="width:${hp}%"></i></span></div>`;
      })
      .join("");
    const fire = s.fire / 1000;
    const left = Math.max(0, s.phaseMs - (serverNow - s.now));
    const head = s.status === COUNTDOWN ? `ROUND ${s.round}` : s.status === FIGHTING ? (fire < 1.14 ? "🔥 FIRE!" : `ROUND ${s.round}`) : s.status === OVER ? "CHAMPION" : "ROUND OVER";
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
      const html2 = `<div class="ar-bar hp"><i style="width:${p.hp}%"></i><span>${Math.ceil(p.hp)}</span></div><div class="ar-bar st${p.flags & FLAG.WINDED ? " winded" : p.stamina < 25 ? " low" : ""}"><i style="width:${p.stamina}%"></i>${p.flags & FLAG.WINDED ? "<span>WINDED</span>" : ""}</div><div class="ar-bar rage${rage ? " full" : ""}"><i style="width:${p.rage}%"></i><span>${rage ? (this.touchMode ? "🌪 READY" : "Q · WHIRLWIND") : "RAGE"}</span></div>${hold ? `<div class="ar-hold">${hold.icon}<small>${this.touchMode ? "⚔️ throws" : "click throws"}</small></div>` : ""}${p.flags & FLAG.FURY ? `<div class="ar-fury">⛑️ FURY</div>` : ""}`;
      if (this.selfEl.dataset.v !== html2) {
        this.selfEl.dataset.v = html2;
        this.selfEl.innerHTML = html2;
      }
      this.hint.textContent = p.holding ? "click: THROW it · right-click/Shift: block · Space roll · Q whirlwind" : "click slash · hold: heavy · right-click/Shift: block (time it: PARRY) · Space roll · Q whirlwind";
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
    if (champ) h.style.color = CSS[this.slotOf(champ)];
    card.append(h, el("div", "pb-results-score", champ && champ !== me ? "is the champion of the arena" : "Crown of the Colosseum"));
    const table = el("div", "pb-results-table");
    const rows = s.slots.map((id, k) => ({ id, k })).filter((r) => r.id).sort((a, b) => s.crowns[b.k] - s.crowns[a.k]);
    for (const r of rows) {
      const row = el("div", `pb-results-row${r.id === me ? " me" : ""}`);
      const n = el("span", "", this.who(r.id));
      n.style.color = CSS[r.k];
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
    for (const sp of this.giftSprites.values()) sp.destroy();
    this.floor.destroy();
    this.spikesG.destroy();
    this.flamesG.destroy();
    this.petalsG.destroy();
    this.petalsOutG.destroy();
    for (const f of this.fires) f.night?.destroy();
    this.top.destroy({ children: true });
    for (const e of [this.hud, this.lobby, this.results, this.vignette]) e.remove();
    document.body.classList.remove("pb-playing", "pb-touch-mode");
  }
}

function smooth(k: number): number {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
