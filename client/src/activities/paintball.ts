// Paintball at the Splat Yard (protocol PbState / PbShot / PbEvent; the
// rules on the server in commons_sim::paintball). Blue against Red, three a
// side, bots in the empty places; three hits and you're out, back to base,
// and a point to them; first to ten.
//
// It plays on the map, with everyone's own avatar: move with WASD (or the
// arrows), aim with the mouse, hold the button to shoot, Space (or Shift)
// to roll, R to reload. On a phone: a stick on the left, hold anywhere on
// the right to shoot there. You move and shoot at once (the server checks);
// everyone else glides a beat behind, between the server's ticks. Balls fly
// the same here as on the server (`Ball.advance`), off drums and (with the
// Bounce power-up) walls. Paint stays where it lands: on the turf, and on
// the people it hits, until they're out.
//
// The feel: muzzle puffs and recoil, ball trails and shadows, a hit marker
// and a tick when yours land, a shake and a red edge (and an arrow to where
// it came from) when you're hit, a heartbeat on your last paint, a kill
// feed, streak calls (Double Splat, On Fire, Shutdown), match point, a
// countdown, and the results at the end.

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import * as sfx from "../ambient/sfx";
import type { EntityInfo, ServerMsg } from "../net/protocol.gen";
import { button, el, isTyping } from "../ui/panels";
import { TILE, toTexture } from "../world/art";
import { Avatar } from "../world/avatars";
import { encodeLook } from "../world/look";
import type { MapObject } from "../world/map";
import { BLUE_PAINT, RED_PAINT, splat } from "../world/paintballart";
import { drawPixelText, pixelWidth } from "../world/pixelfont";
import type { Scene } from "../world/scene";
import { levelLabel, levelPicker } from "./botlevel";

// ---- the rules (as commons_sim::paintball) -------------------------------------

const LOBBY = 0;
const COUNTDOWN = 1;
const PLAYING = 2;
const OVER = 3;
const BOT_BASE = 0xffffff10;
const SLOTS = 6;
const HP = 3;
const HOPPER = 12;
const FIRE_MS = 170;
const FIRE_HOT_MS = 125;
const FIRE_RAPID_MS = 85;
const SPEED = 4.8;
const DASH_SPEED = 15;
const DASH_MS = 170;
const DASH_CD_MS = 2400;
const BALL_SPEED = 17;
const RANGE = 14.5;
const BALL_STEP = 0.2;
const BALL_R = 0.12;
const PLAYER_R = 0.3;
const HIT_R = 0.46;
const MUZZLE = 0.45;
const SPREAD = 0.15;
const RELOAD_MS = 1300;
const TO_WIN = 10;
const OB = { HAY: 1, CRATE: 2, TIRES: 3, DRUM: 4, SNAKE: 5, XBUNK: 6, HEDGE: 7 };
const POWER = { RAPID: 1, SPREAD: 2, SHIELD: 3, BOUNCE: 4 };
const EV = { HIT: 1, OUT: 2, SHIELDED: 3, PICKUP: 5, PAD: 6, SHUTDOWN: 7, MATCH_POINT: 8, RESPAWN: 9, DASH: 10, START: 11, END: 12, RELOAD: 13, HOT: 14 };
const FLAG = { OUT: 1, SPAWN_SHIELD: 2, DASHING: 4, HIDDEN: 8, HOT: 16, RELOADING: 32 };
const POWERS: Record<number, { icon: string; name: string; color: number; css: string; tip: string }> = {
  [POWER.RAPID]: { icon: "⚡", name: "RAPID FIRE", color: 0xffd23f, css: "#ffd23f", tip: "Twice the rate, and the hopper never runs dry" },
  [POWER.SPREAD]: { icon: "🔱", name: "SPREAD SHOT", color: 0xff9a3f, css: "#ff9a3f", tip: "Three balls a shot" },
  [POWER.SHIELD]: { icon: "🛡", name: "SHIELD", color: 0x7af7ff, css: "#7af7ff", tip: "Takes the next two hits" },
  [POWER.BOUNCE]: { icon: "🪃", name: "BOUNCE", color: 0xc77dff, css: "#c77dff", tip: "Your balls bounce off walls" },
};

/** Others are drawn this far behind the server's clock, to glide between its ticks. */
const RENDER_DELAY_MS = 160;
/** How often we tell the server where we are (ms). */
const MOVE_EVERY_MS = 50;
const TEAM_COLOR = [0x3fa9ff, 0xff4f6a];
const TEAM_CSS = [BLUE_PAINT, RED_PAINT];
const TEAM_NAME = ["BLUE", "RED"];
const BOT_NAMES = ["Splatbot Rex", "Captain Drip", "Smudge", "Blotto", "Speckles", "Ricochet"];
/** Bots' looks: dressed for their side. */
const BOT_LOOKS = BOT_NAMES.map((_, i) => {
  const blue = i < 3;
  return encodeLook({ hue: blue ? 205 + i * 8 : 355 - i * 6, skin: (i * 3 + 1) % 4, hair: (i * 5 + 2) % 8, hat: i % 3 === 0 ? 1 : 0, hatHue: blue ? 210 : 0, style: 0, accessory: 0, outfit: (i % 2) * 2 + 1 });
});

type State = Extract<ServerMsg, { t: "PbState" }>;
type ShotMsg = Extract<ServerMsg, { t: "PbShot" }>;
type EventMsg = Extract<ServerMsg, { t: "PbEvent" }>;
type Pb = State["players"][number];
export type PbSend =
  | { t: "PbJoin"; team: number }
  | { t: "PbLeave" }
  | { t: "PbStart"; bots: boolean }
  | { t: "PbBot"; slot: number; on: boolean }
  | { t: "PbLevel"; level: number }
  | { t: "PbMove"; x: number; y: number; aim: number }
  | { t: "PbFire"; shot: number; x: number; y: number; aim: number }
  | { t: "PbDash" }
  | { t: "PbReload" };

interface Obstacle {
  kind: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const KINDS: Record<string, number> = { pb_hay: OB.HAY, pb_crate: OB.CRATE, pb_tires: OB.TIRES, pb_drum: OB.DRUM, pb_snake: OB.SNAKE, pb_x: OB.XBUNK, pb_hedge: OB.HEDGE };

const blocks = (o: Obstacle) => o.kind !== OB.HEDGE;
const inside = (o: Obstacle, x: number, y: number, pad: number) => x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad;

/** The field (as `paintball::Field`): what's on it, and moving about it. */
class Field {
  constructor(
    readonly w: number,
    readonly h: number,
    readonly obstacles: Obstacle[],
  ) {}

  free(x: number, y: number, r: number): boolean {
    if (x < r || y < r || x > this.w - r || y > this.h - r) return false;
    for (const o of this.obstacles) {
      if (!blocks(o)) continue;
      const nx = Math.min(Math.max(x, o.x), o.x + o.w);
      const ny = Math.min(Math.max(y, o.y), o.y + o.h);
      if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return false;
    }
    return true;
  }

  slide(x: number, y: number, dx: number, dy: number, r: number): [number, number] {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.15));
    const sx = dx / n;
    const sy = dy / n;
    for (let i = 0; i < n; i++) {
      if (this.free(x + sx, y, r)) x += sx;
      if (this.free(x, y + sy, r)) y += sy;
    }
    return [x, y];
  }

  inHedge(x: number, y: number): boolean {
    return this.obstacles.some((o) => o.kind === OB.HEDGE && inside(o, x, y, -0.1));
  }
}

type Flight = { k: "fly" } | { k: "splat"; x: number; y: number; wall: boolean } | { k: "hit"; id: number; x: number; y: number };

/** A ball in flight (as `paintball::Ball`, step for step). */
class Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  left = RANGE;
  constructor(
    readonly by: number,
    readonly team: number,
    readonly n: number,
    x: number,
    y: number,
    aim: number,
    public bounces: number,
  ) {
    this.vx = Math.cos(aim);
    this.vy = Math.sin(aim);
    this.x = x + this.vx * MUZZLE;
    this.y = y + this.vy * MUZZLE;
  }

  advance(field: Field, dist: number, hit: (x: number, y: number) => number | null): Flight {
    let todo = dist;
    while (todo > 1e-9) {
      if (this.left <= 1e-9) return { k: "splat", x: this.x, y: this.y, wall: false };
      const step = Math.min(todo, BALL_STEP, this.left);
      todo -= step;
      const px = this.x;
      const py = this.y;
      const nx = px + this.vx * step;
      const ny = py + this.vy * step;
      this.left -= step;
      if (nx < 0 || ny < 0 || nx > field.w || ny > field.h) {
        if (this.bounces > 0) {
          this.bounces--;
          if (nx < 0 || nx > field.w) this.vx = -this.vx;
          else this.vy = -this.vy;
          continue;
        }
        return { k: "splat", x: Math.min(Math.max(px, 0), field.w), y: Math.min(Math.max(py, 0), field.h), wall: true };
      }
      const o = field.obstacles.find((q) => blocks(q) && inside(q, nx, ny, BALL_R));
      if (o) {
        if (o.kind === OB.DRUM || this.bounces > 0) {
          if (o.kind !== OB.DRUM) this.bounces--;
          if (px > o.x - BALL_R && px < o.x + o.w + BALL_R) this.vy = -this.vy;
          else this.vx = -this.vx;
          if (o.kind === OB.DRUM) clang(this.x, this.y);
          continue;
        }
        return { k: "splat", x: px, y: py, wall: true };
      }
      this.x = nx;
      this.y = ny;
      const id = hit(nx, ny);
      if (id !== null) return { k: "hit", id, x: nx, y: ny };
      if (this.left <= 1e-9) return { k: "splat", x: this.x, y: this.y, wall: false };
    }
    return { k: "fly" };
  }
}

// ---- sound -------------------------------------------------------------------

/** How loud something at field point (x, y) is for us (set each frame). */
let ear: { x: number; y: number } | null = null;
const near = (x: number, y: number) => (ear ? Math.max(0.12, 1 - Math.hypot(x - ear.x, y - ear.y) / 20) : 0.5);

const snd = {
  shot(vol: number) {
    const t = sfx.at(0);
    sfx.burst(t, 0.06, 0.32 * vol, "lowpass", 900, 260, 0.7);
    sfx.tone(t, 0.07, 0.16 * vol, "sine", 190, 70);
    sfx.burst(t + 0.005, 0.03, 0.08 * vol, "highpass", 3800);
  },
  splat(vol: number) {
    const t = sfx.at(0);
    sfx.burst(t, 0.14, 0.3 * vol, "bandpass", 1100, 240, 0.9);
    sfx.tone(t, 0.1, 0.12 * vol, "sine", 260, 70);
  },
  hitMarker() {
    const t = sfx.at(0);
    sfx.tone(t, 0.035, 0.12, "square", 1900);
    sfx.tone(t + 0.035, 0.05, 0.1, "triangle", 2600);
  },
  hurt() {
    const t = sfx.at(0);
    sfx.burst(t, 0.18, 0.4, "bandpass", 700, 200, 0.8);
    sfx.tone(t, 0.18, 0.16, "sawtooth", 320, 110);
  },
  out(vol: number) {
    const t = sfx.at(0);
    sfx.burst(t, 0.3, 0.45 * vol, "bandpass", 1400, 150, 0.7);
    sfx.tone(t, 0.25, 0.2 * vol, "sine", 420, 50);
    sfx.tone(t + 0.08, 0.2, 0.1 * vol, "triangle", 880, 440);
  },
  kill() {
    const t = sfx.at(0);
    for (const [k, hz] of [[0, 784], [1, 988], [2, 1319]]) sfx.tone(t + k * 0.06, 0.14, 0.11, "square", hz);
  },
  dash(vol: number) {
    const t = sfx.at(0);
    sfx.burst(t, 0.16, 0.25 * vol, "bandpass", 600, 2400, 1.2);
  },
  reload(vol: number) {
    const t = sfx.at(0);
    sfx.burst(t, 0.03, 0.2 * vol, "bandpass", 2600, 2600, 3);
    sfx.burst(t + 0.18, 0.05, 0.12 * vol, "lowpass", 500, 300);
    sfx.burst(t + RELOAD_MS / 1000 - 0.08, 0.04, 0.25 * vol, "bandpass", 3400, 3400, 3);
  },
  dry() {
    sfx.burst(sfx.at(0), 0.02, 0.15, "highpass", 4200);
  },
  pickup() {
    const t = sfx.at(0);
    for (const [k, hz] of [[0, 660], [1, 880], [2, 1320], [3, 1760]]) sfx.tone(t + k * 0.05, 0.16, 0.09, "triangle", hz);
  },
  shield() {
    const t = sfx.at(0);
    sfx.tone(t, 0.25, 0.12, "sine", 1500, 900);
    sfx.burst(t, 0.1, 0.1, "highpass", 5000);
  },
  beep(hi: boolean) {
    const t = sfx.at(0);
    sfx.tone(t, hi ? 0.45 : 0.12, 0.14, "square", hi ? 880 : 440);
    if (hi) sfx.tone(t, 0.6, 0.1, "sawtooth", 220, 330);
  },
  heart() {
    const t = sfx.at(0);
    sfx.tone(t, 0.1, 0.22, "sine", 70, 40);
    sfx.tone(t + 0.16, 0.12, 0.16, "sine", 62, 38);
  },
  fanfare(win: boolean) {
    const t = sfx.at(0);
    const notes = win ? [523, 659, 784, 1047] : [440, 392, 349, 262];
    notes.forEach((hz, k) => sfx.tone(t + k * 0.13, k === 3 ? 0.6 : 0.16, 0.12, "square", hz));
    if (win) sfx.crowdRoar();
  },
  ricochet(vol: number) {
    const t = sfx.at(0);
    sfx.tone(t, 0.12, 0.09 * vol, "triangle", 2400, 900);
  },
};

let lastClang = 0;
function clang(x: number, y: number) {
  const now = performance.now();
  if (now - lastClang < 60) return;
  lastClang = now;
  snd.ricochet(near(x, y));
}

// ---- pixel words -------------------------------------------------------------

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

/** Splats as white textures (tinted to the paint), a few shapes each size. */
const splatTex = new Map<string, Texture>();
function splatTexture(size: number, k: number): Texture {
  const key = `${size}:${k}`;
  let t = splatTex.get(key);
  if (!t) {
    const d = size * 4 + 6;
    const c = document.createElement("canvas");
    c.width = c.height = d;
    const ctx = c.getContext("2d")!;
    let s = 1000 + k * 7717 + size * 31;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    splat(ctx, "#ffffff", d / 2, d / 2, size, rnd);
    t = toTexture(c);
    splatTex.set(key, t);
  }
  return t;
}

/** A marker in each team's colour, pointing right (its grip at the anchor). */
const gunTex: Texture[] = [];
function gunTexture(team: number): Texture {
  if (!gunTex[team]) {
    const c = document.createElement("canvas");
    c.width = 18;
    c.height = 10;
    const ctx = c.getContext("2d")!;
    const px = (col: string, x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = col;
      ctx.fillRect(x, y, w, h);
    };
    const paint = TEAM_CSS[team];
    px("#2b2233", 2, 4, 12, 4);
    px("#454b58", 3, 5, 10, 2);
    px("#2b2233", 13, 5, 5, 2);
    px("#6b7280", 13, 5, 4, 1);
    px("#2b2233", 5, 0, 6, 5);
    px(paint, 6, 1, 4, 3);
    px("#ffffff", 6, 1, 1, 1);
    px("#2b2233", 3, 7, 3, 3);
    px("#3a3f4a", 4, 7, 1, 2);
    gunTex[team] = toTexture(c);
  }
  return gunTex[team];
}

// ---- the show ------------------------------------------------------------------

/** A thumb on a stick: where it went down, and where it is. */
interface Stick {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  at: number;
  far: number;
}
/** How far a stick goes (screen px). */
const STICK_R = 56;

function stickEl(kind: string): HTMLDivElement {
  const base = el("div", `pb-stick ${kind}`);
  base.append(el("div", "pb-stick-knob"));
  base.hidden = true;
  return base;
}

interface LiveBall {
  ball: Ball;
  color: number;
  hot: boolean;
  trail: { x: number; y: number }[];
  /** Where it's drawn: ours fly at once; others' fly from when we heard. */
  mine: boolean;
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

interface Gear {
  ring: Graphics;
  gun: Sprite;
  paint: Container;
  kick: number;
}

/** What a bot looks like (the server only knows its id). */
function botInfo(id: number, at: { x: number; y: number }): EntityInfo {
  const k = (id - BOT_BASE) % SLOTS;
  return { id, name: `${BOT_NAMES[k]} 🤖`, look: BOT_LOOKS[k], style: 0, pet: 0, vehicle: 0, tool: 0, x: Math.round(at.x), y: Math.round(at.y), state: 0, speedX10: 0, t0: 0, sprintIn: 0, path: [], mood: 0, away: false, reading: 0, calling: false };
}

export class PaintballShow {
  readonly field: Field;
  /** The field's corner (map tiles). */
  private ox: number;
  private oy: number;
  private state: State | null = null;
  private snaps: { t: number; ps: Map<number, { x: number; y: number; aim: number }> }[] = [];
  /** Us, run ahead of the server. */
  private me = {
    x: 0,
    y: 0,
    aim: 0,
    fix: -1,
    known: false,
    out: false,
    ammo: HOPPER,
    nextFire: 0,
    reloadUntil: 0,
    dashUntil: 0,
    dashReady: 0,
    dashDir: { x: 1, y: 0 },
    lastShotAt: 0,
    sentAt: 0,
    sent: { x: -1, y: -1, aim: -1 },
    shotN: 0,
    hp: HP,
    lastHurtAt: 0,
    vx: 0,
    vy: 0,
    reloadDoneAt: 0,
  };
  private bots = new Map<number, Avatar>();
  private gear = new Map<number, Gear>();
  /** Paint on each player (until they're out). */
  private balls: LiveBall[] = [];
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private decals = new Container();
  private fx = new Graphics();
  private top = new Container();
  private bars = new Graphics();
  private pads = new Graphics();
  private lastFrame = performance.now();
  // Input.
  private keys = new Set<string>();
  private mouse: { sx: number; sy: number } | null = null;
  private firing = false;
  /** Played by touch: twin sticks on screen (from the first touch). */
  private touchMode = false;
  private moveStick: Stick | null = null;
  private aimStick: Stick | null = null;
  /** A quick tap on the right: one shot. */
  private tapShot = false;
  private stickEls = { move: stickEl("move"), aim: stickEl("aim") };
  private aimLine = new Graphics();
  // Feel.
  private shake = 0;
  private camLead = { x: 0, y: 0 };
  private lastCount = -1;
  private nextHeart = 0;
  private recentKills: number[] = [];
  // The HUD.
  private hud = el("div", "pb-hud");
  private scoreEl = el("div", "pb-score");
  private feed = el("div", "pb-feed");
  private center = el("div", "pb-center");
  private bottom = el("div", "pb-bottom");
  private hpEl = el("div", "pb-hp");
  private ammoEl = el("div", "pb-ammo");
  private dashEl = el("div", "pb-dash");
  private powerEl = el("div", "pb-power");
  private vignette = el("div", "pb-vignette");
  private respawnEl = el("div", "pb-respawn");
  private dirEl = el("div", "pb-dir");
  private cross = el("div", "pb-cross");
  private lobby = el("div", "pb-lobby");
  private results = el("div", "pb-results");
  private touchPad = el("div", "pb-touch");
  private lobbyKey = "";
  private shownResults = false;

  constructor(
    private scene: Scene,
    map: { objects: MapObject[] },
    private labels: HTMLElement,
    private canvas: HTMLCanvasElement,
    private selfId: () => number,
    private avatarOf: (id: number) => Avatar | undefined,
    private nameOf: (id: number) => string,
    private serverNow: () => number,
    private send: (m: PbSend) => void,
  ) {
    const f = map.objects.find((o) => o.kind === "pb_field")!;
    this.ox = f.x;
    this.oy = f.y;
    this.field = new Field(
      f.w,
      f.h,
      map.objects.filter((o) => KINDS[o.kind]).map((o) => ({ kind: KINDS[o.kind], x: o.x - f.x, y: o.y - f.y, w: o.w, h: o.h })),
    );
    // Paint on the turf: just over the field's markings, under everyone.
    this.decals.zIndex = f.y * TILE + 2;
    this.scene.sorted.addChild(this.decals);
    this.pads.zIndex = f.y * TILE + 3;
    this.scene.sorted.addChild(this.pads);
    this.top.zIndex = 1e9;
    this.top.addChild(this.aimLine, this.fx, this.bars);
    this.scene.world.addChild(this.top);
    this.buildHud();
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("blur", this.onBlur);
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.style.touchAction = "none";
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
  }

  // ---- who's who -----------------------------------------------------------------

  /** Whether we're out on the field (our input goes to the match, not the world). */
  get capturing(): boolean {
    const s = this.state;
    return !!s && (s.status === COUNTDOWN || s.status === PLAYING) && s.players.some((p) => p.id === this.selfId());
  }

  /** Ids out on the field (they don't walk about). */
  get players(): number[] {
    const s = this.state;
    return s && (s.status === COUNTDOWN || s.status === PLAYING || s.status === OVER) ? s.players.map((p) => p.id) : [];
  }

  private mine(): Pb | undefined {
    return this.state?.players.find((p) => p.id === this.selfId());
  }

  private who(id: number): string {
    if (id === this.selfId()) return "You";
    if (id >= BOT_BASE && id < BOT_BASE + SLOTS) return BOT_NAMES[(id - BOT_BASE) % SLOTS];
    return this.nameOf(id);
  }

  private teamOf(id: number): number {
    return this.state?.players.find((p) => p.id === id)?.team ?? (this.state ? Math.floor(Math.max(0, this.state.slots.indexOf(id)) / 3) : 0);
  }

  /** World pixels for field point (x, y). */
  private wx(x: number) {
    return (this.ox + x) * TILE;
  }
  private wy(y: number) {
    return (this.oy + y) * TILE;
  }

  /** The field point under the mouse (or the aiming finger). */
  private aimPoint(): { x: number; y: number } | null {
    if (!this.mouse) return null;
    const s = this.scene.scale;
    const w = this.scene.world.position;
    return { x: (this.mouse.sx - w.x) / s / TILE - this.ox, y: (this.mouse.sy - w.y) / s / TILE - this.oy };
  }

  /** Where the camera looks: a little ahead of us toward the aim, shaking when we're hit. */
  camera(pos: { x: number; y: number }): { x: number; y: number } {
    if (!this.capturing) return pos;
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    return { x: pos.x + this.camLead.x + sx, y: pos.y + this.camLead.y + sy };
  }

  // ---- input -------------------------------------------------------------------

  private onKey = (e: KeyboardEvent) => {
    if (!this.capturing || isTyping(e)) return;
    const code = e.code;
    const move = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code);
    if (!move && !["Space", "ShiftLeft", "ShiftRight", "KeyR"].includes(code)) return;
    e.preventDefault();
    e.stopPropagation();
    if (move) this.keys.add(code);
    else if (!e.repeat && (code === "Space" || code.startsWith("Shift"))) this.dash();
    else if (!e.repeat && code === "KeyR") this.reload();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.keys.delete(e.code) && this.capturing) e.stopPropagation();
  };

  private onBlur = () => {
    this.keys.clear();
    this.firing = false;
    this.moveStick = null;
    this.aimStick = null;
  };

  private onDown = (e: PointerEvent) => {
    if (!this.capturing) return;
    if (e.pointerType === "touch") {
      e.preventDefault();
      this.setTouchMode(true);
      const st: Stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, at: performance.now(), far: 0 };
      // Left half: the move stick; right half: the aim stick (push it out to fire).
      if (e.clientX < window.innerWidth / 2) {
        if (!this.moveStick) this.moveStick = st;
      } else if (!this.aimStick) this.aimStick = st;
      return;
    }
    this.setTouchMode(false);
    this.mouse = { sx: e.clientX, sy: e.clientY };
    if (e.button === 0) this.firing = true;
    if (e.button === 2) this.dash();
  };

  private onMove = (e: PointerEvent) => {
    for (const st of [this.moveStick, this.aimStick]) {
      if (!st || st.id !== e.pointerId) continue;
      st.x = e.clientX;
      st.y = e.clientY;
      // Past the rim, the stick follows the thumb (no dead edge).
      const dx = st.x - st.x0;
      const dy = st.y - st.y0;
      const d = Math.hypot(dx, dy);
      st.far = Math.max(st.far, d);
      if (d > STICK_R * 1.35) {
        const k = (d - STICK_R * 1.35) / d;
        st.x0 += dx * k;
        st.y0 += dy * k;
      }
      return;
    }
    if (e.pointerType === "touch") return;
    this.mouse = { sx: e.clientX, sy: e.clientY };
    this.cross.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  };

  private onUp = (e: PointerEvent) => {
    if (this.moveStick?.id === e.pointerId) this.moveStick = null;
    else if (this.aimStick?.id === e.pointerId) {
      // A quick tap on the right: one shot where we're facing.
      const st = this.aimStick;
      this.aimStick = null;
      if (performance.now() - st.at < 220 && st.far < 14) this.tapShot = true;
    } else if (e.pointerType !== "touch" && e.button === 0) this.firing = false;
  };

  private setTouchMode(on: boolean) {
    if (on === this.touchMode) return;
    this.touchMode = on;
    document.body.classList.toggle("pb-touch-mode", on);
    if (!on) {
      this.moveStick = null;
      this.aimStick = null;
    }
  }

  /** A stick's push: x, y each -1..1 (a dead zone in the middle), or zero. */
  private push(st: Stick | null): { x: number; y: number; m: number } {
    if (!st) return { x: 0, y: 0, m: 0 };
    const dx = (st.x - st.x0) / STICK_R;
    const dy = (st.y - st.y0) / STICK_R;
    const m = Math.min(1, Math.hypot(dx, dy));
    if (m < 0.14) return { x: 0, y: 0, m: 0 };
    const d = Math.hypot(dx, dy);
    return { x: (dx / d) * m, y: (dy / d) * m, m };
  }

  /** Where the keys (or the stick) want us to go: up to a unit vector (the stick is analog), or zero. */
  private moveDir(): { x: number; y: number } {
    const p = this.push(this.moveStick);
    if (p.m > 0) {
      // Analog, but never a crawl.
      const m = Math.max(0.45, p.m);
      return { x: (p.x / p.m) * m, y: (p.y / p.m) * m };
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

  /**
   * Aim assist (by touch): an enemy in sight within a narrow cone of where
   * the stick points pulls the aim most of the way onto them.
   */
  private assist(raw: number): number {
    const s = this.state;
    const p = this.mine();
    if (!s || !p) return raw;
    const at = this.serverNow() - RENDER_DELAY_MS;
    let best: { diff: number; d: number } | null = null;
    for (const q of s.players) {
      if (q.team === p.team || q.flags & (FLAG.OUT | FLAG.HIDDEN)) continue;
      const pos = this.glide(q.id, at);
      const d = Math.hypot(pos.x - this.me.x, pos.y - this.me.y);
      if (d > 13 || d < 0.5) continue;
      let diff = Math.atan2(pos.y - this.me.y, pos.x - this.me.x) - raw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 0.38 || !this.clearLine(this.me.x, this.me.y, pos.x, pos.y)) continue;
      if (!best || Math.abs(diff) + d * 0.01 < Math.abs(best.diff) + best.d * 0.01) best = { diff, d };
    }
    return best ? raw + best.diff * 0.8 : raw;
  }

  private clearLine(ax: number, ay: number, bx: number, by: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25));
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n;
      const y = ay + ((by - ay) * i) / n;
      if (this.field.obstacles.some((o) => blocks(o) && inside(o, x, y, 0))) return false;
    }
    return true;
  }

  /** A buzz in the hand (phones). */
  private buzz(pattern: number | number[]) {
    if (this.touchMode) navigator.vibrate?.(pattern);
  }

  private dash() {
    const p = this.mine();
    const now = this.serverNow();
    if (!p || this.state?.status !== PLAYING || this.me.out || now < this.me.dashReady) return;
    const d = this.moveDir();
    this.me.dashDir = d.x || d.y ? d : { x: Math.cos(this.me.aim), y: Math.sin(this.me.aim) };
    this.me.dashUntil = now + DASH_MS;
    this.me.dashReady = now + DASH_CD_MS;
    this.send({ t: "PbDash" });
    snd.dash(1);
    this.afterimage(this.me.x, this.me.y, p.team);
  }

  private reload() {
    const now = this.serverNow();
    const rapid = this.powerOf(this.mine()) === POWER.RAPID;
    if (this.me.out || rapid || this.me.reloadUntil > now || this.me.ammo >= HOPPER) return;
    this.me.reloadUntil = now + RELOAD_MS;
    this.send({ t: "PbReload" });
    snd.reload(1);
  }

  private powerOf(p: Pb | undefined): number {
    return p && p.powerMs > 0 ? p.power : 0;
  }

  // ---- from the server --------------------------------------------------------------

  onState(s: State) {
    const before = this.state;
    const me = this.selfId();
    // The match beginning, or over.
    if (s.status === COUNTDOWN && before?.status !== COUNTDOWN) this.begin();
    if (s.status === OVER && before?.status === PLAYING) this.shownResults = false;
    if (s.status === LOBBY && before && before.status !== LOBBY) this.clearField();
    // Snapshots to glide others between.
    const ps = new Map<number, { x: number; y: number; aim: number }>();
    for (const p of s.players) ps.set(p.id, { x: p.x / 100, y: p.y / 100, aim: (p.aim / 65536) * Math.PI * 2 });
    if (!before || before.status !== s.status) this.snaps = [];
    this.snaps.push({ t: s.now, ps });
    if (this.snaps.length > 10) this.snaps.shift();
    this.state = s;
    // Ourselves: take the server's word when it moved us (respawn, a refused
    // step) or we're out; else we run ahead.
    const p = s.players.find((q) => q.id === me);
    if (p) {
      const out = (p.flags & FLAG.OUT) !== 0;
      const sx = p.x / 100;
      const sy = p.y / 100;
      if (!this.me.known || p.fix !== this.me.fix || out || this.me.out !== out || Math.hypot(sx - this.me.x, sy - this.me.y) > 2.5 || s.status === COUNTDOWN) {
        this.me.x = sx;
        this.me.y = sy;
        this.me.fix = p.fix;
        this.me.known = true;
      }
      this.me.out = out;
      // Reloads run on our clock; the server's word fills in only what we
      // didn't start ourselves, and its hopper count only once ours has settled.
      const now = this.serverNow();
      const settled = now - this.me.lastShotAt > 450 && now - this.me.reloadDoneAt > 700 && !this.me.reloadUntil;
      if (p.reloadMs > 0 && !this.me.reloadUntil && now - this.me.reloadDoneAt > 700) this.me.reloadUntil = s.now + p.reloadMs;
      if (settled && !(p.flags & FLAG.RELOADING)) this.me.ammo = p.ammo;
      this.me.dashReady = Math.max(this.me.dashReady, s.now + p.dashMs);
      this.me.hp = p.hp;
    } else {
      this.me.known = false;
      this.keys.clear();
      this.firing = false;
    }
    document.body.classList.toggle("pb-playing", this.capturing);
    // On a touch screen the sticks are ready from the start (the town's bars out of the thumbs' way).
    if (this.capturing && !this.touchMode && matchMedia("(pointer: coarse)").matches) this.setTouchMode(true);
    this.renderLobby();
  }

  onShot(m: ShotMsg) {
    if (m.by === this.selfId()) return;
    const team = this.teamOf(m.by);
    const aim = (m.aim / 65536) * Math.PI * 2;
    const x = m.x / 100;
    const y = m.y / 100;
    this.launch(m.by, team, m.shot, x, y, aim, m.kind, false);
    snd.shot(near(x, y) * 0.7);
    this.muzzle(x, y, aim, team);
  }

  onEvent(e: EventMsg) {
    const me = this.selfId();
    const x = e.x / 100;
    const y = e.y / 100;
    const now = performance.now();
    switch (e.kind) {
      case EV.HIT:
      case EV.OUT: {
        this.dropBall(e.a, e.n);
        const team = this.teamOf(e.a);
        const color = TEAM_COLOR[team];
        this.decal(x, y, color, e.kind === EV.OUT ? 7 : 4);
        this.burst(x, y, color, e.kind === EV.OUT ? 26 : 10, e.kind === EV.OUT ? 1.6 : 1);
        this.paintOn(e.b, color);
        if (e.a === me) {
          this.flashCross(e.kind === EV.OUT);
          this.buzz(e.kind === EV.OUT ? [25, 40, 25] : 12);
          snd.hitMarker();
          this.shake = Math.max(this.shake, 0.05);
        }
        if (e.b === me) {
          this.hurt(x, y, e.a);
        }
        if (e.kind === EV.HIT) {
          snd.splat(near(x, y));
          break;
        }
        // Out!
        snd.out(near(x, y));
        this.float("SPLAT!", TEAM_CSS[team], x, y - 1.4, 1.6);
        this.addFeed(e.a, e.b);
        this.clearPaint(e.b);
        if (e.a === me) {
          snd.kill();
          this.recentKills = this.recentKills.filter((t) => now - t < 4000);
          this.recentKills.push(now);
          const n = this.recentKills.length;
          this.announce(n >= 4 ? "SPLATTASTIC!" : n === 3 ? "TRIPLE SPLAT!" : n === 2 ? "DOUBLE SPLAT!" : `SPLATTED ${this.who(e.b).toUpperCase()}`, n >= 2 ? "#ffd23f" : "#ffffff", n >= 2 ? 1.25 : 1);
        } else if (e.b === me) {
          this.announce(`SPLATTED BY ${this.who(e.a).toUpperCase()}`, TEAM_CSS[team], 1);
        }
        if (this.state) sfx.crowdRoar();
        break;
      }
      case EV.SHIELDED:
        this.dropBall(e.a, e.n);
        this.ring(x, y, 0x7af7ff);
        this.float("BLOCKED", "#7af7ff", x, y - 1.2, 1);
        snd.shield();
        break;
      case EV.PICKUP: {
        const pw = POWERS[e.b];
        if (!pw) break;
        this.burst(x, y, pw.color, 18, 1.2);
        this.float(pw.name, pw.css, x, y - 1.2, 1.2);
        if (e.a === me) {
          snd.pickup();
          this.announce(`${pw.icon} ${pw.name}`, pw.css, 1.1, pw.tip);
        } else snd.pickup();
        break;
      }
      case EV.PAD:
        this.burst(x, y, POWERS[e.b]?.color ?? 0xffffff, 12, 0.8);
        break;
      case EV.SHUTDOWN:
        this.announce(`SHUTDOWN! ${this.who(e.a)} ended ${this.who(e.b) === "You" ? "your" : `${this.who(e.b)}'s`} streak`, "#ff9a3f", 1.1);
        break;
      case EV.MATCH_POINT:
        this.announce(`MATCH POINT · ${TEAM_NAME[e.a]}`, TEAM_CSS[e.a], 1.3);
        snd.heart();
        break;
      case EV.RESPAWN:
        this.ring(x, y, TEAM_COLOR[this.teamOf(e.a)]);
        if (e.a === me) this.announce("BACK IN!", "#7ee05a", 0.9);
        break;
      case EV.DASH:
        this.afterimage(x, y, this.teamOf(e.a));
        snd.dash(near(x, y) * 0.6);
        break;
      case EV.START:
        snd.beep(true);
        this.announce("SPLAT!", "#ffd23f", 2);
        break;
      case EV.END:
        break;
      case EV.RELOAD:
        if (e.a !== me) snd.reload(near(x, y) * 0.5);
        break;
      case EV.HOT:
        this.announce(e.a === me ? "🔥 YOU'RE ON FIRE!" : `🔥 ${this.who(e.a).toUpperCase()} IS ON FIRE`, "#ff9a3f", 1.2);
        break;
    }
  }

  // ---- shooting -------------------------------------------------------------------

  private launch(by: number, team: number, n: number, x: number, y: number, aim: number, kind: number, mine: boolean) {
    const hot = (this.state?.players.find((p) => p.id === by)?.flags ?? 0) & FLAG.HOT;
    const bounce = kind & 1 ? 1 : 0;
    const add = (k: number, off: number) => this.balls.push({ ball: new Ball(by, team, (n & 0x0fff) | (k << 12), x, y, aim + off, bounce), color: TEAM_COLOR[team], hot: !!hot, trail: [], mine });
    if (kind & 2) {
      add(0, 0);
      add(1, -SPREAD);
      add(2, SPREAD);
    } else add(0, 0);
  }

  private dropBall(by: number, n: number) {
    const i = this.balls.findIndex((b) => b.ball.by === by && b.ball.n === n);
    if (i >= 0) this.balls.splice(i, 1);
  }

  private tryFire(now: number) {
    const p = this.mine();
    const s = this.state;
    if (!p || !s || s.status !== PLAYING || this.me.out || !this.firing) return;
    if (now < this.me.nextFire) return;
    const power = this.powerOf(p);
    const rapid = power === POWER.RAPID;
    if (now < this.me.reloadUntil && !rapid) return;
    if (this.me.ammo <= 0 && !rapid) {
      snd.dry();
      this.reload();
      this.me.nextFire = now + 250;
      return;
    }
    const hot = (p.flags & FLAG.HOT) !== 0;
    this.me.nextFire = now + (rapid ? FIRE_RAPID_MS : hot ? FIRE_HOT_MS : FIRE_MS);
    this.me.lastShotAt = now;
    this.me.shotN = (this.me.shotN + 1) & 0x0fff;
    const aim = this.me.aim;
    const kind = (power === POWER.BOUNCE ? 1 : 0) | (power === POWER.SPREAD ? 2 : 0);
    this.launch(this.selfId(), p.team, this.me.shotN, this.me.x, this.me.y, aim, kind, true);
    this.send({ t: "PbFire", shot: this.me.shotN, x: Math.round(this.me.x * 100), y: Math.round(this.me.y * 100), aim: Math.round((((aim % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 65536) & 0xffff });
    if (!rapid) {
      this.me.ammo--;
      if (this.me.ammo <= 0) {
        // Empty: reloading (and saying so, in case the server's count is a ball behind).
        this.me.reloadUntil = now + RELOAD_MS;
        this.send({ t: "PbReload" });
        snd.reload(0.6);
      }
    }
    snd.shot(1);
    this.muzzle(this.me.x, this.me.y, aim, p.team);
    const g = this.gear.get(this.selfId());
    if (g) g.kick = 1;
    this.shake = Math.max(this.shake, 0.03);
    this.cross.classList.remove("fire");
    void this.cross.offsetWidth;
    this.cross.classList.add("fire");
  }

  // ---- each frame ---------------------------------------------------------------

  update(serverNow: number, wallNow: number) {
    const dt = Math.min(0.05, (wallNow - this.lastFrame) / 1000);
    this.lastFrame = wallNow;
    const s = this.state;
    const live = !!s && s.status !== LOBBY;
    const me = this.selfId();
    const p = this.mine();
    // Us: moving, aiming, rolling, shooting.
    if (p && s && (s.status === PLAYING || s.status === COUNTDOWN)) {
      // A reload done on our clock: the hopper's full again now (the server's agrees a beat later).
      if (this.me.reloadUntil && serverNow >= this.me.reloadUntil) {
        this.me.reloadUntil = 0;
        this.me.ammo = HOPPER;
        this.me.reloadDoneAt = serverNow;
      }
      const d = this.moveDir();
      let aimAt: { x: number; y: number } | null = null;
      if (this.touchMode) {
        // The right stick aims (with a little help) and, pushed out, fires;
        // without it, we face the way we're going.
        const a = this.push(this.aimStick);
        if (a.m > 0) this.me.aim = this.assist(Math.atan2(a.y, a.x));
        else if (d.x || d.y) this.me.aim = Math.atan2(d.y, d.x);
        this.firing = a.m >= 0.5;
        if (this.tapShot) {
          this.tapShot = false;
          this.firing = true;
          this.tryFire(serverNow);
          this.firing = false;
        }
      } else {
        aimAt = this.aimPoint();
        if (aimAt) this.me.aim = Math.atan2(aimAt.y - this.me.y, aimAt.x - this.me.x);
      }
      if (s.status === PLAYING && !this.me.out) {
        const dashing = serverNow < this.me.dashUntil;
        if (dashing) {
          this.me.vx = this.me.dashDir.x * DASH_SPEED;
          this.me.vy = this.me.dashDir.y * DASH_SPEED;
        } else {
          // Ease into a run and out of it (quick, but no jolt).
          const k = Math.min(1, dt * (d.x || d.y ? 16 : 20));
          this.me.vx += (d.x * SPEED - this.me.vx) * k;
          this.me.vy += (d.y * SPEED - this.me.vy) * k;
          if (!d.x && !d.y && Math.hypot(this.me.vx, this.me.vy) < 0.05) this.me.vx = this.me.vy = 0;
        }
        const [nx, ny] = this.field.slide(this.me.x, this.me.y, this.me.vx * dt, this.me.vy * dt, PLAYER_R);
        // Ran into something: that way's speed is gone.
        if (dt > 0) {
          if (Math.abs(nx - this.me.x) < Math.abs(this.me.vx * dt) * 0.5) this.me.vx = 0;
          if (Math.abs(ny - this.me.y) < Math.abs(this.me.vy * dt) * 0.5) this.me.vy = 0;
        }
        this.me.x = nx;
        this.me.y = ny;
        if (dashing && Math.random() < 0.6) this.afterimage(this.me.x, this.me.y, p.team);
        this.tryFire(serverNow);
      } else {
        this.me.vx = this.me.vy = 0;
      }
      if (wallNow - this.me.sentAt >= MOVE_EVERY_MS && s.status === PLAYING && !this.me.out) {
        const x = Math.round(this.me.x * 100);
        const y = Math.round(this.me.y * 100);
        const aim = Math.round(((((this.me.aim % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * 65536) & 0xffff;
        if (x !== this.me.sent.x || y !== this.me.sent.y || Math.abs(aim - this.me.sent.aim) > 200) {
          this.send({ t: "PbMove", x, y, aim });
          this.me.sent = { x, y, aim };
          this.me.sentAt = wallNow;
        }
      }
      // The camera leans toward the aim (by touch: the way the stick points).
      const lead = this.touchMode
        ? this.aimStick
          ? { x: Math.cos(this.me.aim) * 2.5, y: Math.sin(this.me.aim) * 1.6 }
          : { x: d.x * 1.2, y: d.y * 0.8 }
        : aimAt
          ? { x: Math.max(-3, Math.min(3, (aimAt.x - this.me.x) * 0.25)), y: Math.max(-2, Math.min(2, (aimAt.y - this.me.y) * 0.25)) }
          : { x: 0, y: 0 };
      this.camLead.x += (lead.x - this.camLead.x) * Math.min(1, dt * 3);
      this.camLead.y += (lead.y - this.camLead.y) * Math.min(1, dt * 3);
      ear = { x: this.me.x, y: this.me.y };
    } else ear = null;
    this.drawSticks(p);
    this.shake = Math.max(0, this.shake - dt * 0.6);
    // Bots come and go with the match.
    const botIds = new Set(live && s ? s.players.filter((q) => q.id >= BOT_BASE && q.id < BOT_BASE + SLOTS).map((q) => q.id) : []);
    for (const [id, a] of this.bots) {
      if (!botIds.has(id)) {
        a.destroy();
        this.bots.delete(id);
      }
    }
    for (const id of botIds) {
      if (!this.bots.has(id)) {
        const q = s!.players.find((r) => r.id === id)!;
        const a = new Avatar(botInfo(id, this.toTile(q.x / 100, q.y / 100)), this.scene, this.labels, false, Date.now());
        a.markNpc();
        this.bots.set(id, a);
      }
    }
    // Everyone on the field: placed, posed, geared.
    const at = serverNow - RENDER_DELAY_MS;
    const seen = new Set<number>();
    this.bars.clear();
    if (live && s) {
      for (const q of s.players) {
        const avatar = this.bots.get(q.id) ?? this.avatarOf(q.id);
        if (!avatar) continue;
        seen.add(q.id);
        const self = q.id === me;
        const pos = self ? { x: this.me.x, y: this.me.y, aim: this.me.aim } : this.glide(q.id, at);
        const prev = self ? null : this.glide(q.id, at - 80);
        const walking = self ? Math.hypot(this.me.vx, this.me.vy) > 0.6 || serverNow < this.me.dashUntil : !!prev && Math.hypot(pos.x - prev.x, pos.y - prev.y) > 0.05;
        const out = (q.flags & FLAG.OUT) !== 0;
        const t = this.toTile(pos.x, pos.y);
        avatar.setArena({ x: t.x, y: t.y, facing: Math.cos(pos.aim) >= 0 ? 1 : -1, frame: null, walking: walking && !out, hurt: false });
        // Hiding: faint to friends, gone to the other side (bar a rustle).
        const hidden = (q.flags & FLAG.HIDDEN) !== 0;
        const myTeam = p?.team ?? -1;
        const fade = out ? 0 : hidden ? (q.team === myTeam ? 0.45 : 0.06) : self && this.field.inHedge(pos.x, pos.y) ? 0.6 : 1;
        avatar.setFade(fade);
        this.drawGear(q, pos, avatar, out ? 0 : fade, serverNow);
      }
    }
    for (const [id, g] of this.gear) {
      if (!seen.has(id)) {
        g.ring.destroy();
        g.gun.destroy();
        g.paint.destroy({ children: true });
        this.gear.delete(id);
        const a = this.avatarOf(id);
        if (a) {
          a.setArena(null);
          a.setFade(1);
        }
      }
    }
    for (const a of this.bots.values()) a.update(serverNow, wallNow);
    this.flyBalls(dt, s);
    this.drawFx(wallNow, dt);
    this.drawPads(wallNow);
    this.updateHud(serverNow, wallNow);
  }

  /** The sticks under the thumbs, and (by touch) a dotted line where we're aiming. */
  private drawSticks(p: Pb | undefined) {
    const show = (elm: HTMLDivElement, st: Stick | null) => {
      elm.hidden = !st || !this.capturing;
      if (!st) return;
      elm.style.transform = `translate(${st.x0}px, ${st.y0}px)`;
      const dx = st.x - st.x0;
      const dy = st.y - st.y0;
      const d = Math.hypot(dx, dy);
      const k = d > STICK_R ? STICK_R / d : 1;
      (elm.firstElementChild as HTMLElement).style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      elm.classList.toggle("firing", elm === this.stickEls.aim && this.firing);
    };
    show(this.stickEls.move, this.moveStick);
    show(this.stickEls.aim, this.aimStick);
    const g = this.aimLine.clear();
    if (!p || !this.touchMode || !this.capturing || this.me.out) return;
    const reach = this.aimStick ? 6 : 2.5;
    const c = Math.cos(this.me.aim);
    const sn = Math.sin(this.me.aim);
    for (let t = 0.8; t < reach; t += 0.35) {
      const x = this.me.x + c * t;
      const y = this.me.y + sn * t;
      if (!this.field.free(x, y, 0.02)) break;
      g.rect(Math.round(this.wx(x)) - 1, Math.round(this.wy(y) - 12) - 1, 2, 2).fill({ color: TEAM_COLOR[p.team], alpha: (this.aimStick ? 0.8 : 0.35) * (1 - t / reach) });
    }
  }

  /** Avatar tile coordinates (fractional) for field point (x, y): its feet on the point. */
  private toTile(x: number, y: number) {
    return { x: this.ox + x - 0.5, y: this.oy + y - 1 + 4 / TILE };
  }

  /** Where player `id` was at server time `t`, between the two ticks either side. */
  private glide(id: number, t: number): { x: number; y: number; aim: number } {
    const snaps = this.snaps;
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i].t <= t && snaps[i + 1].t >= t) {
        a = snaps[i];
        b = snaps[i + 1];
        break;
      }
    }
    const pa = a?.ps.get(id);
    const pb = b?.ps.get(id) ?? pa;
    if (!pa || !pb) return pb ?? pa ?? { x: 0, y: 0, aim: 0 };
    // Past the newest tick (a late packet): carry on the way they were going, a little.
    if (b === snaps[snaps.length - 1] && t > b.t && snaps.length >= 2) {
      const prev = snaps[snaps.length - 2];
      const pp = prev.ps.get(id);
      if (pp && b.t > prev.t && Math.hypot(pb.x - pp.x, pb.y - pp.y) < 3) {
        const ahead = Math.min(t - b.t, 120) / (b.t - prev.t);
        const [x, y] = this.field.slide(pb.x, pb.y, (pb.x - pp.x) * ahead, (pb.y - pp.y) * ahead, PLAYER_R);
        return { x, y, aim: pb.aim };
      }
      return pb;
    }
    // A jump (respawn): no gliding across the field.
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) > 3) return t >= b.t ? pb : pa;
    const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    let da = pb.aim - pa.aim;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    return { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f, aim: pa.aim + da * f };
  }

  private gearFor(id: number, team: number): Gear {
    let g = this.gear.get(id);
    if (!g) {
      const ring = new Graphics();
      const gun = new Sprite(gunTexture(team));
      gun.anchor.set(0.25, 0.6);
      const paint = new Container();
      this.scene.sorted.addChild(ring, gun, paint);
      g = { ring, gun, paint, kick: 0 };
      this.gear.set(id, g);
    }
    return g;
  }

  /** A player's marker, team ring, paint on them, and their bars overhead. */
  private drawGear(q: Pb, pos: { x: number; y: number; aim: number }, avatar: Avatar, alpha: number, now: number) {
    const g = this.gearFor(q.id, q.team);
    const fx = this.wx(pos.x);
    const fy = this.wy(pos.y) - 4;
    const feet = this.wy(pos.y);
    g.ring.visible = g.gun.visible = g.paint.visible = alpha > 0.05;
    g.ring.alpha = g.gun.alpha = g.paint.alpha = alpha;
    // The ring under them, in their colour (brighter for us).
    const self = q.id === this.selfId();
    g.ring.clear();
    g.ring.ellipse(fx, fy + 1, 11, 5).stroke({ width: self ? 2 : 1.5, color: TEAM_COLOR[q.team], alpha: self ? 0.95 : 0.7 });
    if (q.flags & FLAG.HOT) g.ring.ellipse(fx, fy + 1, 13 + Math.sin(now / 90) * 1.5, 6).stroke({ width: 1, color: 0xff9a3f, alpha: 0.8 });
    g.ring.zIndex = feet - 0.6;
    // The marker, in their hands, pointing where they aim (hopper up).
    const left = Math.cos(pos.aim) < 0;
    g.kick = Math.max(0, g.kick - 0.25);
    g.gun.position.set(Math.round(fx + (left ? -3 : 3) - Math.cos(pos.aim) * g.kick * 2), Math.round(feet - 15 - Math.sin(pos.aim) * g.kick * 2));
    g.gun.rotation = pos.aim;
    g.gun.scale.set(1, left ? -1 : 1);
    // Aiming up, it's behind them; down, in front.
    g.gun.zIndex = avatar.sprite.zIndex + (Math.sin(pos.aim) < -0.3 ? -0.2 : 0.3);
    g.paint.position.set(fx, feet);
    g.paint.zIndex = avatar.sprite.zIndex + 0.25;
    if (alpha <= 0.05) return;
    // Overhead: paint left, the reload, the power-up.
    const hy = feet - 42;
    const b = this.bars;
    for (let i = 0; i < HP; i++) {
      const x = fx - 8 + i * 6;
      b.rect(x - 1, hy - 1, 5, 5).fill({ color: 0x1a1020, alpha: 0.8 * alpha });
      b.rect(x, hy, 3, 3).fill({ color: i < q.hp ? TEAM_COLOR[q.team] : 0x4a4250, alpha });
    }
    if (q.flags & FLAG.RELOADING && q.reloadMs > 0) {
      const f = 1 - q.reloadMs / RELOAD_MS;
      b.rect(fx - 9, hy + 6, 18, 2).fill({ color: 0x1a1020, alpha: 0.8 });
      b.rect(fx - 9, hy + 6, 18 * f, 2).fill({ color: 0xffffff, alpha: 0.9 });
    }
    const pw = POWERS[this.powerOf(q)];
    if (pw) b.circle(fx + 13, hy + 1, 3).fill({ color: pw.color, alpha: 0.7 + 0.3 * Math.sin(now / 120) });
    // The spawn shield and the Shield power-up: a bubble.
    if (q.flags & FLAG.SPAWN_SHIELD || this.powerOf(q) === POWER.SHIELD) {
      const col = q.flags & FLAG.SPAWN_SHIELD ? 0xffffff : 0x7af7ff;
      b.ellipse(fx, feet - 16, 15, 20).stroke({ width: 1.5, color: col, alpha: 0.55 + 0.2 * Math.sin(now / 100) });
      b.ellipse(fx, feet - 16, 15, 20).fill({ color: col, alpha: 0.08 });
    }
    // On Fire: embers rising off them.
    if (q.flags & FLAG.HOT && Math.random() < 0.5) this.particles.push({ x: pos.x + (Math.random() - 0.5) * 0.5, y: pos.y, z: 0.5 + Math.random() * 0.6, vx: 0, vy: 0, vz: 1.2 + Math.random(), born: now, life: 450, color: Math.random() < 0.5 ? 0xff9a3f : 0xffd23f, size: 2 });
  }

  /** A splat stuck on player `id` (until they're out). */
  private paintOn(id: number, color: number) {
    const g = this.gear.get(id);
    if (!g || g.paint.children.length > 8) return;
    const s = new Sprite(splatTexture(2, Math.floor(Math.random() * 6)));
    s.anchor.set(0.5);
    s.tint = color;
    s.position.set((Math.random() - 0.5) * 12, -8 - Math.random() * 18);
    g.paint.addChild(s);
  }

  private clearPaint(id: number) {
    this.gear.get(id)?.paint.removeChildren().forEach((c) => c.destroy());
  }

  private flyBalls(dt: number, s: State | null) {
    if (!s || s.status !== PLAYING) {
      this.balls = [];
      return;
    }
    const me = this.selfId();
    const at = this.serverNow() - RENDER_DELAY_MS;
    // Where each player is drawn (to stop balls on them, for the look; the server says if it counts).
    const bodies = s.players
      .filter((p) => !(p.flags & (FLAG.OUT | FLAG.DASHING)))
      .map((p) => {
        const pos = p.id === me ? this.me : this.glide(p.id, at);
        return { id: p.id, team: p.team, x: pos.x, y: pos.y };
      });
    const keep: LiveBall[] = [];
    for (const lb of this.balls) {
      const b = lb.ball;
      const flight = b.advance(this.field, BALL_SPEED * dt, (x, y) => bodies.find((q) => q.team !== b.team && Math.hypot(q.x - x, q.y - y) < HIT_R * 0.85)?.id ?? null);
      lb.trail.push({ x: b.x, y: b.y });
      if (lb.trail.length > 5) lb.trail.shift();
      if (flight.k === "fly") {
        keep.push(lb);
        continue;
      }
      if (flight.k === "splat") {
        this.decal(flight.x, flight.y, lb.color, flight.wall ? 3 : 2);
        this.burst(flight.x, flight.y, lb.color, 6, 0.7);
        snd.splat(near(flight.x, flight.y) * 0.4);
      } else this.burst(flight.x, flight.y, lb.color, 5, 0.6);
    }
    this.balls = keep;
  }

  // ---- effects ---------------------------------------------------------------------

  private decal(x: number, y: number, color: number, size: number) {
    const s = new Sprite(splatTexture(size, Math.floor(Math.random() * 6)));
    s.anchor.set(0.5);
    s.tint = color;
    s.alpha = 0.92;
    s.rotation = Math.random() * Math.PI * 2;
    s.position.set(this.wx(x), this.wy(y));
    this.decals.addChild(s);
    if (this.decals.children.length > 420) this.decals.removeChildAt(0).destroy();
  }

  private burst(x: number, y: number, color: number, n: number, power: number) {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (1.5 + Math.random() * 3) * power;
      this.particles.push({ x, y, z: 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7, vz: 1.5 + Math.random() * 2.5 * power, born: now, life: 350 + Math.random() * 300, color, size: Math.random() < 0.3 ? 3 : 2 });
    }
  }

  private muzzle(x: number, y: number, aim: number, team: number) {
    const now = performance.now();
    const mx = x + Math.cos(aim) * 0.55;
    const my = y + Math.sin(aim) * 0.55;
    for (let i = 0; i < 4; i++) {
      const a = aim + (Math.random() - 0.5) * 0.9;
      this.particles.push({ x: mx, y: my, z: 0.45, vx: Math.cos(a) * (1 + Math.random() * 2), vy: Math.sin(a) * (1 + Math.random() * 2), vz: 0.3, born: now, life: 160, color: i === 0 ? 0xffffff : TEAM_COLOR[team], size: 2 });
    }
  }

  private afterimage(x: number, y: number, team: number) {
    const now = performance.now();
    for (let i = 0; i < 3; i++) this.particles.push({ x: x + (Math.random() - 0.5) * 0.3, y, z: 0.2 + i * 0.25, vx: 0, vy: 0, vz: 0, born: now, life: 260, color: TEAM_COLOR[team], size: 5 });
  }

  private rings: { x: number; y: number; color: number; at: number }[] = [];
  private ring(x: number, y: number, color: number) {
    this.rings.push({ x, y, color, at: performance.now() });
  }

  private float(text: string, color: string, x: number, y: number, scale: number) {
    const sprite = new Sprite(word(text, color));
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(scale);
    this.top.addChild(sprite);
    this.floaters.push({ sprite, x: this.wx(x), y: this.wy(y), at: performance.now(), life: 1000 });
  }

  private drawFx(wallNow: number, dt: number) {
    const g = this.fx.clear();
    // The balls: a shadow on the turf, the ball up at chest height, its trail.
    for (const lb of this.balls) {
      const b = lb.ball;
      const x = this.wx(b.x);
      const y = this.wy(b.y);
      g.ellipse(x, y, 3, 1.5).fill({ color: 0x000000, alpha: 0.25 });
      lb.trail.forEach((t, i) => {
        const a = ((i + 1) / lb.trail.length) * 0.45;
        g.circle(this.wx(t.x), this.wy(t.y) - 12, 1.5).fill({ color: lb.hot ? 0xff9a3f : lb.color, alpha: a });
      });
      g.circle(x, y - 12, 3).fill({ color: 0x1a1020 });
      g.circle(x, y - 12, 2.2).fill({ color: lb.color });
      g.rect(Math.round(x - 1), Math.round(y - 14), 1, 1).fill({ color: 0xffffff });
    }
    // Paint flying.
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
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      const a = 1 - (now - p.born) / p.life;
      g.rect(Math.round(this.wx(p.x)), Math.round(this.wy(p.y) - p.z * TILE), p.size, p.size).fill({ color: p.color, alpha: Math.max(0, a) });
    }
    // Rings: shields catching a ball, people coming back in.
    this.rings = this.rings.filter((r) => now - r.at < 500);
    for (const r of this.rings) {
      const t = (now - r.at) / 500;
      g.ellipse(this.wx(r.x), this.wy(r.y) - 14, 8 + t * 18, 10 + t * 20).stroke({ width: 2, color: r.color, alpha: 1 - t });
    }
    // Words floating up.
    this.floaters = this.floaters.filter((f) => {
      const t = (wallNow - f.at) / f.life;
      if (t >= 1) {
        f.sprite.destroy();
        return false;
      }
      f.sprite.position.set(Math.round(f.x), Math.round(f.y - t * 26));
      f.sprite.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      return true;
    });
  }

  /** The pads' power-ups, bobbing over them. */
  private drawPads(wallNow: number) {
    const g = this.pads.clear();
    const s = this.state;
    if (!s || s.status === LOBBY) return;
    for (const k of s.pickups) {
      const pw = POWERS[k.kind];
      if (!pw) continue;
      const x = this.wx(k.x / 100);
      const y = this.wy(k.y / 100) - 14 + Math.sin(wallNow / 260) * 3;
      g.ellipse(x, this.wy(k.y / 100) + 1, 10 + Math.sin(wallNow / 200) * 2, 5).fill({ color: pw.color, alpha: 0.3 });
      g.circle(x, y, 9).fill({ color: 0x1a1020, alpha: 0.85 });
      g.circle(x, y, 7).fill({ color: pw.color });
      g.circle(x - 2, y - 2, 2).fill({ color: 0xffffff, alpha: 0.8 });
      g.circle(x, y, 11 + Math.sin(wallNow / 150) * 2).stroke({ width: 1, color: pw.color, alpha: 0.6 });
    }
  }

  // ---- being hit ------------------------------------------------------------------

  private hurt(x: number, y: number, by: number) {
    snd.hurt();
    this.buzz(60);
    this.shake = Math.max(this.shake, 0.18);
    this.me.lastHurtAt = performance.now();
    this.vignette.classList.remove("hit");
    void this.vignette.offsetWidth;
    this.vignette.classList.add("hit");
    // An arrow at the screen's edge toward where it came from.
    const src = this.glide(by, this.serverNow() - RENDER_DELAY_MS);
    const ang = Math.atan2(src.y - y, src.x - x);
    this.dirEl.style.setProperty("--a", `${ang}rad`);
    this.dirEl.style.setProperty("--c", TEAM_CSS[this.teamOf(by)]);
    this.dirEl.classList.remove("show");
    void this.dirEl.offsetWidth;
    this.dirEl.classList.add("show");
  }

  private flashCross(kill: boolean) {
    this.cross.classList.remove("hit", "kill");
    void this.cross.offsetWidth;
    this.cross.classList.add(kill ? "kill" : "hit");
  }

  // ---- the HUD ------------------------------------------------------------------

  private buildHud() {
    this.bottom.append(this.hpEl, this.ammoEl, this.dashEl, this.powerEl);
    this.hud.append(this.scoreEl, this.feed, this.center, this.bottom, this.respawnEl, this.dirEl);
    this.hud.hidden = true;
    this.cross.hidden = true;
    this.results.hidden = true;
    this.lobby.hidden = true;
    // On a phone: roll and reload buttons.
    const pressBtn = (label: string, cls: string, run: () => void) => {
      const b = el("button", `pb-touch-btn ${cls}`, label);
      b.type = "button";
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        run();
        b.classList.remove("pressed");
        void b.offsetWidth;
        b.classList.add("pressed");
      });
      return b;
    };
    this.touchPad.append(pressBtn("💨", "roll", () => this.dash()), pressBtn("🔄", "reload", () => this.reload()));
    this.hud.append(this.touchPad, this.stickEls.move, this.stickEls.aim);
    document.body.append(this.vignette, this.hud, this.cross, this.lobby, this.results);
    this.vignette.hidden = true;
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
      const s = el("span", "", this.who(id));
      s.style.color = TEAM_CSS[this.teamOf(id)];
      if (id === this.selfId()) s.classList.add("me");
      return s;
    };
    row.append(name(a), el("span", "pb-feed-icon", " 🎯 "), name(b));
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    window.setTimeout(() => row.classList.add("old"), 5000);
    window.setTimeout(() => row.remove(), 6000);
  }

  private begin() {
    this.decals.removeChildren().forEach((c) => c.destroy());
    this.feed.replaceChildren();
    this.center.replaceChildren();
    this.lastCount = -1;
    this.me.known = false;
    this.me.ammo = HOPPER;
    this.me.reloadUntil = 0;
    this.me.dashReady = 0;
    this.results.hidden = true;
    this.recentKills = [];
  }

  private clearField() {
    this.balls = [];
    this.results.hidden = true;
    for (const id of [...this.gear.keys()]) this.clearPaint(id);
  }

  private updateHud(serverNow: number, wallNow: number) {
    const s = this.state;
    const playing = this.capturing;
    const watching = !!s && s.status !== LOBBY;
    this.hud.hidden = !watching;
    this.cross.hidden = !playing;
    this.vignette.hidden = !playing;
    if (!s || !watching) return;
    // The score: each side's points as paint pips, and the clock.
    const pips = (n: number, team: number) => {
      let h = "";
      for (let i = 0; i < TO_WIN; i++) h += `<i class="${i < n ? "on" : ""}" style="--c:${TEAM_CSS[team]}"></i>`;
      return h;
    };
    const left = s.status === COUNTDOWN ? 0 : Math.max(0, s.phaseMs - (serverNow - s.now));
    const clock = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;
    const key = `${s.blue}|${s.red}|${clock}|${s.status}`;
    if (this.scoreEl.dataset.key !== key) {
      this.scoreEl.dataset.key = key;
      this.scoreEl.innerHTML = `<div class="pb-side blue"><b>${s.blue}</b><span>BLUE</span><div class="pb-pips">${pips(s.blue, 0)}</div></div><div class="pb-clock">${s.status === PLAYING ? clock : s.status === OVER ? "FINAL" : "GET READY"}</div><div class="pb-side red"><div class="pb-pips">${pips(s.red, 1)}</div><span>RED</span><b>${s.red}</b></div>`;
      this.scoreEl.classList.toggle("mp-blue", s.blue === TO_WIN - 1);
      this.scoreEl.classList.toggle("mp-red", s.red === TO_WIN - 1);
    }
    // The countdown: 3, 2, 1.
    if (s.status === COUNTDOWN) {
      const n = Math.ceil(Math.max(0, s.phaseMs - (serverNow - s.now)) / 1000);
      if (n !== this.lastCount && n > 0 && n <= 3) {
        this.lastCount = n;
        snd.beep(false);
        this.announce(String(n), "#ffffff", 2.4);
      }
    }
    const p = this.mine();
    this.bottom.hidden = !p;
    this.touchPad.hidden = !p || !(this.touchMode || matchMedia("(pointer: coarse)").matches);
    if (p) {
      // Paint left, as drops.
      let hp = "";
      for (let i = 0; i < HP; i++) hp += `<i class="${i < this.me.hp ? "on" : ""}" style="--c:${TEAM_CSS[p.team]}"></i>`;
      if (this.hpEl.dataset.v !== hp) {
        this.hpEl.dataset.v = hp;
        this.hpEl.innerHTML = hp;
      }
      // The hopper.
      const rapid = this.powerOf(p) === POWER.RAPID;
      const reloading = serverNow < this.me.reloadUntil && !rapid;
      let am = "";
      for (let i = 0; i < HOPPER; i++) am += `<i class="${rapid || i < this.me.ammo ? "on" : ""}"></i>`;
      const rf = reloading ? 1 - (this.me.reloadUntil - serverNow) / RELOAD_MS : 1;
      const amKey = `${am}|${reloading ? Math.round(rf * 20) : -1}|${rapid}`;
      if (this.ammoEl.dataset.v !== amKey) {
        this.ammoEl.dataset.v = amKey;
        this.ammoEl.innerHTML = `<div class="pb-balls">${am}</div><div class="pb-reload" style="--f:${rf}">${rapid ? "∞ RAPID" : reloading ? "RELOADING" : this.me.ammo === 0 ? "R TO RELOAD" : `${this.me.ammo}/${HOPPER}`}</div>`;
        this.ammoEl.classList.toggle("low", this.me.ammo <= 3 && !rapid);
      }
      // The roll.
      const df = Math.min(1, 1 - (this.me.dashReady - serverNow) / DASH_CD_MS);
      this.dashEl.style.setProperty("--f", String(Math.max(0, df)));
      this.dashEl.classList.toggle("ready", serverNow >= this.me.dashReady);
      this.dashEl.textContent = "💨";
      // The power-up.
      const pw = POWERS[this.powerOf(p)];
      this.powerEl.hidden = !pw;
      if (pw) this.powerEl.innerHTML = `<span style="color:${pw.css}">${pw.icon} ${pw.name}</span><b style="--f:${Math.max(0, p.powerMs - (serverNow - s.now)) / 10000};--c:${pw.css}"></b>`;
      // Out: the count till we're back.
      const out = (p.flags & FLAG.OUT) !== 0;
      this.respawnEl.hidden = !out;
      if (out) this.respawnEl.innerHTML = `<div>SPLATTED</div><b>${Math.max(1, Math.ceil((p.respawnMs - (serverNow - s.now)) / 1000))}</b>`;
      // Last paint: a heartbeat and a red edge.
      const low = this.me.hp === 1 && !out && s.status === PLAYING;
      this.vignette.classList.toggle("low", low);
      if (low && wallNow >= this.nextHeart) {
        this.nextHeart = wallNow + 900;
        snd.heart();
      }
    } else this.respawnEl.hidden = true;
    // Over: the results.
    if (s.status === OVER && !this.shownResults) {
      this.shownResults = true;
      this.showResults(s);
    }
  }

  private showResults(s: State) {
    const me = this.mine();
    const won = s.winner === 2 ? null : me ? me.team === s.winner : null;
    snd.fanfare(won !== false);
    const title = s.winner === 2 ? "A DRAW!" : won === true ? "VICTORY!" : won === false ? "DEFEAT" : `${TEAM_NAME[s.winner]} WINS!`;
    const rows = [...s.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const mvp = rows[0];
    this.results.replaceChildren();
    const card = el("div", "pb-results-card");
    const h = el("h2", "", title);
    if (s.winner !== 2) h.style.color = TEAM_CSS[s.winner];
    card.append(h, el("div", "pb-results-score", `BLUE ${s.blue} — ${s.red} RED`));
    const table = el("div", "pb-results-table");
    for (const p of rows) {
      const r = el("div", `pb-results-row${p.id === this.selfId() ? " me" : ""}`);
      const n = el("span", "", `${p === mvp ? "⭐ " : ""}${this.who(p.id)}`);
      n.style.color = TEAM_CSS[p.team];
      r.append(n, el("span", "", `${p.kills} 🎯`), el("span", "", `${p.deaths} 💦`));
      table.append(r);
    }
    card.append(table, el("p", "hint", "Back to the lobby in a moment: same teams, ready for a rematch."));
    this.results.append(card);
    this.results.hidden = false;
    window.setTimeout(() => (this.results.hidden = true), 8500);
  }

  // ---- the lobby -------------------------------------------------------------------

  private renderLobby() {
    const s = this.state;
    if (!s) return;
    const me = this.selfId();
    const mySlot = s.slots.indexOf(me);
    const show = !this.capturing && s.status !== OVER;
    this.lobby.hidden = !show;
    if (!show) return;
    const key = `${s.status}|${s.slots.join(",")}|${s.blue}|${s.red}|${mySlot}|${s.level}`;
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    this.lobby.replaceChildren();
    const head = el("div", "pb-lobby-head");
    head.append(el("strong", "", "🎯 Splat Yard · Paintball"), el("span", "pb-lobby-status", s.status === LOBBY ? "3 v 3 · first to 10" : `Match on · ${s.blue} – ${s.red}`));
    const isBot = (id: number) => id >= BOT_BASE && id < BOT_BASE + SLOTS;
    // In the lobby, those with a place choose who plays: each bot can be taken out, or put in an empty place.
    const canEdit = s.status === LOBBY && mySlot >= 0;
    const teams = el("div", "pb-lobby-teams");
    for (const team of [0, 1]) {
      const col = el("div", `pb-lobby-team ${team ? "red" : "blue"}`);
      col.append(el("div", "pb-lobby-team-name", team ? "RED" : "BLUE"));
      for (let k = team * 3; k < team * 3 + 3; k++) {
        const id = s.slots[k];
        const bot = isBot(id);
        const label = id === 0 ? "· empty ·" : bot ? `🤖 ${BOT_NAMES[k]}` : id === me ? `${this.nameOf(id)} (you)` : this.nameOf(id);
        const row = el("div", `pb-slot${id === 0 ? " open" : ""}${id === me ? " me" : ""}${bot ? " bot" : ""}`);
        row.append(el("span", "pb-slot-name", label));
        if (canEdit && bot) row.append(Object.assign(button("✕", () => this.send({ t: "PbBot", slot: k, on: false }), "subtle pb-bot-btn"), { title: "Take this bot out" }));
        if (canEdit && id === 0) row.append(Object.assign(button("+ 🤖", () => this.send({ t: "PbBot", slot: k, on: true }), "subtle pb-bot-btn"), { title: "Put a bot in" }));
        col.append(row);
      }
      const hasBot = s.slots.slice(team * 3, team * 3 + 3).some(isBot);
      const hasRoom = s.slots.slice(team * 3, team * 3 + 3).some((id) => id === 0);
      if (s.status === LOBBY && Math.floor(mySlot / 3) !== team && (hasRoom || hasBot)) col.append(button(mySlot >= 0 ? "Switch here" : `Join ${team ? "Red" : "Blue"}`, () => this.send({ t: "PbJoin", team }), team ? "pb-join red" : "pb-join blue"));
      if (s.status !== LOBBY && mySlot < 0 && (hasBot || hasRoom)) col.append(button(`Jump in for ${team ? "Red" : "Blue"}`, () => this.send({ t: "PbJoin", team }), team ? "pb-join red" : "pb-join blue"));
      teams.append(col);
    }
    // The match this makes: n v m, and who's who.
    const side = (t: number) => s.slots.slice(t * 3, t * 3 + 3).filter((x) => x !== 0);
    const [blue, red] = [side(0), side(1)];
    const bots = [...blue, ...red].filter(isBot).length;
    const people = blue.length + red.length - bots;
    const ready = blue.length > 0 && red.length > 0;
    const modeText =
      s.status !== LOBBY
        ? bots > 0
          ? `Bots: ${levelLabel(s.level)}`
          : ""
        : !ready
          ? `${blue.length ? "Red" : "Blue"} needs someone: add a bot, or wait for a player`
          : `🎯 ${blue.length} v ${red.length} · ${people} ${people === 1 ? "player" : "players"}, ${bots} ${bots === 1 ? "bot" : "bots"}`;
    const mode = el("p", `pb-mode${s.status === LOBBY && !ready ? " warn" : ""}`, modeText);
    const level = s.status === LOBBY ? levelPicker(s.level, canEdit ? (l) => this.send({ t: "PbLevel", level: l }) : null) : null;
    const actions = el("div", "pb-lobby-actions");
    if (s.status === LOBBY && mySlot >= 0) {
      const go = button("▶ Play!", () => this.send({ t: "PbStart", bots: false }), "primary");
      go.disabled = !ready;
      actions.append(go, button("Leave", () => this.send({ t: "PbLeave" }), "subtle"));
    } else if (s.status === LOBBY) {
      actions.append(button("🎯 Quick play", () => this.send({ t: "PbJoin", team: 2 }), "primary"));
    }
    const help = el("p", "hint pb-help", "WASD move · mouse aim · click to shoot · Space roll · R reload. Three hits and you're out. Grab the power-ups on the pads; hide in hedges; steel drums bounce balls back.");
    this.lobby.append(head, teams, ...(modeText ? [mode] : []), ...(level ? [level] : []), actions, help);
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    for (const a of this.bots.values()) a.destroy();
    for (const g of this.gear.values()) {
      g.ring.destroy();
      g.gun.destroy();
      g.paint.destroy({ children: true });
    }
    this.decals.destroy({ children: true });
    this.pads.destroy();
    this.top.destroy({ children: true });
    for (const e of [this.hud, this.cross, this.lobby, this.results, this.vignette]) e.remove();
    document.body.classList.remove("pb-playing", "pb-touch-mode");
    ear = null;
  }
}
