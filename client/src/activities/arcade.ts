// The arcade's cabinets (protocol ArcadeState / ArcadeInput; see
// zone/src/instance/arcade.rs). This panel draws the game at the cabinet
// you're playing or watching and turns clicks and keys into moves. Every
// game can be played against the arcade's AI bot or whoever joins.
//
// Pong, light cycles, connect four, memory and the tank duel run on the
// server. The contests (basket catch, turbo racer, dance off) run here on
// each player's screen from a shared seed, smooth at full frame rate, and
// report scores to the server, which keeps them honest and calls the result.

import { ChoiceModal, Panel, button, el } from "../ui/panels";
import * as snd from "./arcade-sfx";
import { BUMPERS, BALL_R as PIN_BALL_R, FLIPPERS, FLIP_BASE_R, FLIP_BOTTOM, FLIP_LEN, FLIP_TIP_R, FLIP_TOP, HOLE_HALF, PH, PINBALL, PW, type Press, RAILS, RAIL_R, carry, unpack } from "./pinball";
import { BEAT_MS, DANCE_BEATS, danceHalf, danceNotes, rng } from "./arcade-shared";
import { DanceMusic } from "./dance-music";

export { BEAT_MS };

/** protocol `arcade::*`. */
export const PONG = 1;
export const CYCLES = 2;
export const CONNECT4 = 3;
export const MEMORY = 5;
export const CATCH = 7;
export const RACER = 8;
export const DANCE = 9;
export const TANKS = 10;
const EMPTY = 0;
export const PLAYING = 1;
const A_WON = 2;
const B_WON = 3;
const WAITING = 4;
const DRAW = 5;
export const BOT = 0xfffffff5;
const SCORE_FLAG = 0x8000;
const RACE_GOAL = 3000;
const RACE_TOP_SPEED = 120;
const KEY_FORWARD = 1;
const KEY_BACK = 2;
const KEY_LEFT = 4;
const KEY_RIGHT = 8;
const KEY_FIRE = 16;

export interface ArcadeState {
  cab: number;
  kind: number;
  a: number;
  b: number;
  status: number;
  turn: number;
  t0: number;
  data: number[];
}

type Out = { t: "ArcadeJoin"; cab: number; vsBot: boolean } | { t: "ArcadeLeave"; cab: number } | { t: "ArcadeInput"; cab: number; value: number };

const HOW: Record<number, string> = {
  [PONG]: "Move your paddle with the mouse, or ↑ ↓ (W S). First to 5.",
  [CYCLES]: "Steer with the arrow keys or WASD (or the buttons). Don't hit a wall or a trail.",
  [CONNECT4]: "Click a column to drop a disc. Four in a row wins.",
  [MEMORY]: "Turn over two cards. A pair is yours, and you go again.",
  [CATCH]: "Move your basket with the mouse or ← →. Fruit +1, stars +3, bombs −3.",
  [RACER]: "Steer with ← → (A D) or the mouse. Dodge the traffic; first to the finish wins.",
  [TANKS]: "Drive with WASD or the arrows, fire with Space. Three hits and you're out.",
  [PINBALL]: "Flip with ↑ ↓ (W S) for your top and bottom flipper, or Space / hold the mouse for both. Knock the ball into the other end's hole. First to 10.",
  [DANCE]: "Hit the arrow keys as the arrows reach the top; stray presses cost points. Starts easy, speeds up; best score after 40 s wins. Stay on your pad!",
};

/** The two players' colours: a cyan, b pink (as on the cabinets' screens). */
const SIDE = ["#3fe0ff", "#ff4fa3"];
const MEMORY_PICS = ["", "🍒", "⭐", "🍀", "🌙", "🎈", "🐟", "🍄", "🎲"];

const CW = 480;
const CH = 288;

/** Contest data: seed, start, end, scores, positions, finished. */
function contest(d: number[]) {
  return {
    seed: d[0],
    start: d[1] * 65536 + d[2],
    end: d[3] * 65536 + d[4],
    score: [d[5], d[6]],
    pos: [d[7], d[8]],
    finished: [d[9], d[10]],
  };
}

// ---- the contests' courses, the same on every screen ----------------------------------

interface Item {
  t: number; // ms after the start it appears at the top
  x: number; // 0–1 across the lane
  kind: 0 | 1 | 2; // fruit, star, bomb
}

/** Basket catch: what falls, when, for 45 s, a little faster as it goes. */
function catchItems(seed: number): Item[] {
  const r = rng(seed);
  const items: Item[] = [];
  for (let t = 400; t < 45_000; t += 520 - Math.min(260, t / 140)) {
    const k = r();
    items.push({ t, x: 0.08 + r() * 0.84, kind: k < 0.7 ? 0 : k < 0.8 ? 1 : 2 });
  }
  return items;
}
const FALL_MS = 2600;

interface Car {
  d: number; // distance along the road
  lane: number; // 0, 1, 2
  color: string;
}

/** Turbo racer: the traffic on the road, by distance. */
function traffic(seed: number): Car[] {
  const r = rng(seed ^ 0x5eed);
  const cars: Car[] = [];
  const colors = ["#ffe14f", "#5fe08a", "#b07bff", "#ff9a4f"];
  for (let d = 260; d < RACE_GOAL; d += 90 + r() * 110) {
    cars.push({ d, lane: Math.floor(r() * 3), color: colors[Math.floor(r() * 4)] });
    if (r() < 0.25) cars.push({ d: d + 6, lane: Math.floor(r() * 3), color: colors[Math.floor(r() * 4)] });
  }
  return cars;
}

interface Note {
  beat: number; // in beats after the start (halves for eighth notes)
  lane: number; // 0 ←, 1 ↓, 2 ↑, 3 →
}

/**
 * Dance off: the chart. Easy to start (an arrow every other beat), then one
 * every beat, then extra half-beat arrows for the last stretch.
 */
export function danceChart(seed: number): Note[] {
  const r = rng(seed ^ 0xda7ce);
  const notes: Note[] = [];
  for (let b = 0; b < DANCE_BEATS; b++) {
    const lane = Math.floor(r() * 4);
    if (danceNotes(b)) notes.push({ beat: b, lane });
    if (danceHalf(b) && r() < 0.5) notes.push({ beat: b + 0.5, lane: (lane + 1 + Math.floor(r() * 3)) % 4 });
  }
  return notes;
}

/** How far apart (pixels) arrows a beat apart are drawn: they speed up as the dance goes on. */
const beatGap = (beat: number) => 52 + 38 * Math.min(1, Math.max(0, beat / DANCE_BEATS));

export class ArcadePanel extends Panel {
  private states = new Map<number, ArcadeState>();
  /** The tank duel's latest states (by server time), to carry them on smoothly. */
  private snaps: { t: number; data: number[] }[] = [];
  /** Where things are drawn: eased toward where they should be, so updates never jump. */
  private tankShow: ({ x: number; y: number; a: number } | null)[] = [null, null];
  private ballShow: { x: number; y: number } | null = null;
  private eased = new Map<string, number>();
  /** Seconds since the last frame. */
  private dt = 1 / 60;
  /** The countdown's last shown number (to beep once each). */
  private lastCount = "";
  /** When the game on screen last finished. */
  private endedAt = 0;
  /** Pinball: your flippers held (and each change, by server time), the mouse held. */
  private flipKeys = 0;
  private presses: Press[] = [];
  private mouseFlip = false;
  /** Pinball: where the ball's drawn, its trail, when each bumper last lit (server time). */
  private pinShow: { x: number; y: number } | null = null;
  private pinTrail: { x: number; y: number }[] = [];
  private pinLit = Array(9).fill(0);
  /** Pinball: the score last drawn, and the last point (which end, when) for its flash. */
  private pinScore: [number, number] | null = null;
  private pinGoal: { side: number; at: number } | null = null;
  /** Play the bot or wait for a player: asked in the middle of the screen. */
  private choice = new ChoiceModal();
  private cab = 0;
  private canvas = document.createElement("canvas");
  private raf = 0;
  /** What the DOM last showed, so a moving ball doesn't rebuild it. */
  private shown = "";
  private keys = new Set<string>();
  private hover: { x: number; y: number } | null = null;
  /** Pong: your paddle (drawn straight away) and the last one sent. */
  private paddle = 60;
  private sentAt = 0;
  private sentPos = -1;
  /** The contest you're playing on this screen, for this seed. */
  private local: Local | null = null;
  private tankKeys = 0;
  private music: DanceMusic;

  constructor(
    private labels: string[],
    private selfId: () => number,
    private nameOf: (id: number) => string,
    private send: (m: Out) => void,
    private serverNow: () => number,
    muted: () => boolean,
  ) {
    super("🕹️ Arcade", "arcade");
    this.enlargeable(this.canvas);
    this.music = new DanceMusic(muted);
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.canvas.className = "arcade-canvas";
    this.canvas.addEventListener("pointermove", (e) => this.pointer(e, false));
    this.canvas.addEventListener("pointerdown", (e) => this.pointer(e, true));
    this.canvas.addEventListener("pointerleave", () => (this.hover = null));
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKeyUp, true);
  }

  /** Opens cabinet `cab`. */
  openCab(cab: number) {
    this.cab = cab;
    this.shown = "";
    this.titleEl.textContent = `🕹️ ${this.labels[cab] ?? "Arcade"}`;
    this.show();
  }

  /** The latest state of every cabinet (the world shows the dance machine's). */
  stateOf(cab: number): ArcadeState | undefined {
    return this.states.get(cab);
  }

  onState(m: ArcadeState) {
    const prev = this.states.get(m.cab);
    this.states.set(m.cab, m);
    if (m.cab === this.cab) {
      if (m.kind === TANKS) this.keepSnap(m, prev);
      if (this.open && prev) this.sounds(prev, m);
    }
    if (!this.open || m.cab !== this.cab) return;
    const key = `${m.status}:${m.a}:${m.b}:${m.turn}:${this.score(m)}`;
    if (key !== this.shown) this.render();
  }

  private get state(): ArcadeState | undefined {
    return this.states.get(this.cab);
  }

  private side(): number {
    const s = this.state;
    const me = this.selfId();
    return s && s.status === PLAYING ? (s.a === me ? 0 : s.b === me ? 1 : -1) : -1;
  }

  private myTurn(): boolean {
    const s = this.state;
    return !!s && this.side() >= 0 && s.turn === this.side();
  }

  private who(id: number) {
    return id === this.selfId() ? "You" : id === BOT ? "AI bot 🤖" : this.nameOf(id);
  }

  private input(value: number) {
    this.send({ t: "ArcadeInput", cab: this.cab, value });
  }

  show() {
    super.show();
    cancelAnimationFrame(this.raf);
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      this.dt = dt;
      last = t;
      this.step(dt, t);
      this.draw();
      if (this.open) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  hide() {
    super.hide();
    this.choice.hide();
    cancelAnimationFrame(this.raf);
    this.keys.clear();
    this.music.stop();
    if (this.tankKeys) {
      this.tankKeys = 0;
      if (this.state?.kind === TANKS) this.input(0);
    }
    this.mouseFlip = false;
    if (this.flipKeys) {
      this.flipKeys = 0;
      if (this.state?.kind === PINBALL) this.input(0);
    }
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.music.stop();
    this.choice.destroy();
    super.destroy();
  }

  /** Keys for the real-time games, kept from walking you about meanwhile. */
  private onKey = (e: KeyboardEvent) => {
    const s = this.state;
    if (!this.open || !s || s.status !== PLAYING || this.side() < 0) return;
    const k = keyName(e);
    if (!k) return;
    const handled = this.keyDown(s, k, e.repeat);
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = keyName(e);
    if (!k) return;
    this.keys.delete(k);
    const s = this.state;
    if (s?.kind === TANKS && this.open) this.sendTankKeys();
    if (s?.kind === PINBALL && this.open) this.sendFlips();
  };

  private onPointerUp = () => {
    if (!this.mouseFlip) return;
    this.mouseFlip = false;
    if (this.state?.kind === PINBALL && this.open) this.sendFlips();
  };

  /** Pinball: your flippers as held (keys or the mouse), sent when they change. */
  private sendFlips() {
    let v = 0;
    if (this.keys.has("up") || this.keys.has("fire") || this.mouseFlip) v |= FLIP_TOP;
    if (this.keys.has("down") || this.keys.has("fire") || this.mouseFlip) v |= FLIP_BOTTOM;
    if (v === this.flipKeys) return;
    if (v & ~this.flipKeys) snd.flipper();
    this.flipKeys = v;
    const now = this.serverNow();
    this.presses = this.presses.filter((p) => now - p.t < 3000);
    this.presses.push({ t: now, keys: v });
    this.input(v);
  }

  private keyDown(s: ArcadeState, k: string, repeat: boolean): boolean {
    const dir = ["up", "right", "down", "left"].indexOf(k);
    switch (s.kind) {
      case CYCLES:
        if (dir < 0) return false;
        if (!repeat) snd.turn();
        this.input(dir);
        return true;
      case PONG:
      case CATCH:
      case RACER:
        if (k === "fire") return false;
        this.keys.add(k);
        if (s.kind === RACER && !repeat && (k === "left" || k === "right")) {
          this.local?.steer(k === "left" ? -1 : 1);
          snd.laneHop();
        }
        return true;
      case TANKS:
        this.keys.add(k);
        this.sendTankKeys();
        return true;
      case PINBALL:
        if (k !== "up" && k !== "down" && k !== "fire") return false;
        this.keys.add(k);
        this.sendFlips();
        return true;
      case DANCE: {
        const lane = { left: 0, down: 1, up: 2, right: 3 }[k];
        if (lane === undefined) return false;
        if (!repeat) this.local?.hit(lane, this.serverNow());
        return true;
      }
    }
    return false;
  }

  private sendTankKeys() {
    let v = 0;
    if (this.keys.has("up")) v |= KEY_FORWARD;
    if (this.keys.has("down")) v |= KEY_BACK;
    if (this.keys.has("left")) v |= KEY_LEFT;
    if (this.keys.has("right")) v |= KEY_RIGHT;
    if (this.keys.has("fire")) v |= KEY_FIRE;
    if (v !== this.tankKeys) {
      this.tankKeys = v;
      this.input(v);
    }
  }

  /** A point on the canvas (in its own pixels). */
  private at(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * CW, y: ((e.clientY - r.top) / r.height) * CH };
  }

  private pointer(e: PointerEvent, click: boolean) {
    const s = this.state;
    if (!s) return;
    const p = this.at(e);
    this.hover = p;
    const side = this.side();
    if (side < 0) return;
    if (s.kind === PONG) {
      this.paddle = Math.min(106, Math.max(14, p.y / 2.4));
      return;
    }
    if (s.kind === PINBALL) {
      if (click) {
        this.mouseFlip = true;
        this.sendFlips();
      }
      return;
    }
    if (s.kind === CATCH || s.kind === RACER) {
      // Your lane is the left half if you're a, the right if you're b.
      const lane = (p.x - side * (CW / 2)) / (CW / 2);
      this.local?.aim(Math.min(1, Math.max(0, lane)));
      return;
    }
    if (!click || !this.myTurn()) return;
    const move = this.moveAt(s, p.x, p.y);
    if (move !== null) this.input(move);
  }

  /** Which move a click at (x, y) makes in a turn-based game, if any. */
  private moveAt(s: ArcadeState, x: number, y: number): number | null {
    if (s.kind === CONNECT4) {
      const col = Math.floor((x - 100) / 40);
      return col >= 0 && col < 7 ? col : null;
    }
    if (s.kind === MEMORY) {
      const cx = Math.floor((x - 100) / 70);
      const cy = Math.floor((y - 4) / 70);
      return cx >= 0 && cx < 4 && cy >= 0 && cy < 4 ? cy * 4 + cx : null;
    }
    return null;
  }

  /** Each frame: your paddle and your contest move on, and get reported. */
  private step(dt: number, t: number) {
    const s = this.state;
    if (!s || s.status !== PLAYING) {
      if (this.local) this.music.stop();
      this.local = null;
      return;
    }
    const side = this.side();
    if (s.kind === PONG && side >= 0) {
      const dir = (this.keys.has("up") ? -1 : 0) + (this.keys.has("down") ? 1 : 0);
      this.paddle = Math.min(106, Math.max(14, this.paddle + dir * 130 * dt));
      if (t - this.sentAt > 66 && Math.abs(this.paddle - this.sentPos) > 0.2) {
        this.sentAt = t;
        this.sentPos = this.paddle;
        this.input(Math.round(this.paddle * 10));
      }
    }
    if ((s.kind === CATCH || s.kind === RACER || s.kind === DANCE) && side >= 0) {
      const c = contest(s.data);
      if (!this.local || this.local.seed !== c.seed || this.local.kind !== s.kind) {
        this.local = new Local(s.kind, c.seed, c.start);
        this.local.onEvent = (e, v) => {
          if (e === "catch") snd.caught(v);
          else if (e === "bump") snd.bump();
          else if (e === "step") snd.step(v > 0);
        };
        if (s.kind === DANCE) this.music.start(c.start - this.serverNow(), c.seed);
      }
      const now = this.serverNow();
      if (s.kind === CATCH || s.kind === RACER) {
        const dir = (this.keys.has("left") ? -1 : 0) + (this.keys.has("right") ? 1 : 0);
        if (dir) this.local.nudge(dir * dt * (s.kind === CATCH ? 1.6 : 0));
      }
      this.local.update(now, dt);
      // Report: the score when it changes, where you are ten times a second.
      const score = Math.max(0, Math.min(0x7ffe, Math.round(this.local.score)));
      // The race's distance changes every frame: tell the server five times a second (and at the line).
      const due = s.kind !== RACER || t - this.local.sentAt > 200 || score >= RACE_GOAL;
      if (score !== this.local.sentScore && due) {
        this.local.sentScore = score;
        this.local.sentAt = t;
        this.input(SCORE_FLAG + score);
      }
      if (s.kind !== DANCE && t - this.sentAt > 100) {
        const pos = Math.round(this.local.x * 1000);
        if (pos !== this.sentPos) {
          this.sentAt = t;
          this.sentPos = pos;
          this.input(pos);
        }
      }
    }
  }

  /** How a finished game came out, from where you stand. */
  private result(s: ArcadeState): string {
    if (s.status === DRAW) return "A draw!";
    const me = this.selfId();
    const winner = s.status === A_WON ? s.a : s.b;
    const loser = s.status === A_WON ? s.b : s.a;
    return winner === me ? `🏆 You win! +${loser === BOT ? 5 : 10} tickets` : loser === me ? `${this.who(winner)} wins. Win next time for tickets!` : `🏆 ${this.who(winner)} wins.`;
  }

  /** A tank duel state, kept by its server time (a repeat of the same moment replaces it). */
  private keepSnap(m: ArcadeState, prev: ArcadeState | undefined) {
    if (m.status !== PLAYING) return;
    if (!prev || prev.status !== PLAYING || prev.kind !== TANKS) {
      this.snaps = [];
      this.tankShow = [null, null];
    }
    const last = this.snaps[this.snaps.length - 1];
    if (last && last.t >= m.t0) {
      if (last.t === m.t0) last.data = m.data;
      return;
    }
    this.snaps.push({ t: m.t0, data: m.data });
    if (this.snaps.length > 6) this.snaps.shift();
  }

  /** The cabinet's noises: what changed between two states of the game you're looking at. */
  private sounds(p: ArcadeState, m: ArcadeState) {
    const side = m.a === this.selfId() ? 0 : m.b === this.selfId() ? 1 : -1;
    if (p.status === PLAYING && m.status !== PLAYING) {
      this.endedAt = performance.now();
      if (m.kind === CYCLES) snd.crash();
      if (m.kind === TANKS) snd.boom();
      const won = (m.status === A_WON && side === 0) || (m.status === B_WON && side === 1);
      const lost = (m.status === A_WON && side === 1) || (m.status === B_WON && side === 0);
      snd.ending(won ? "win" : lost ? "lose" : "over");
      return;
    }
    if (m.status !== PLAYING || p.status !== PLAYING || p.kind !== m.kind) return;
    const a = p.data;
    const b = m.data;
    switch (m.kind) {
      case PONG: {
        if (b[6] !== a[6] || b[7] !== a[7]) {
          snd.point((b[6] > a[6] && side === 0) || (b[7] > a[7] && side === 1));
          break;
        }
        const vx0 = a[2] - 32768;
        const vx1 = b[2] - 32768;
        if (vx0 && vx1 && Math.sign(vx0) !== Math.sign(vx1)) snd.paddle(vx1 < 0 ? 1 : 0);
        else if (vx1 && a[3] !== b[3] && Math.sign(a[3] - 32768) !== Math.sign(b[3] - 32768)) snd.wall();
        else if (a[8] && !b[8]) snd.paddle(0);
        break;
      }
      case CONNECT4:
        if (b.slice(0, 42).filter(Boolean).length > a.slice(0, 42).filter(Boolean).length) snd.disc();
        if (side >= 0 && m.turn === side && p.turn !== side) window.setTimeout(snd.yourTurn, 250);
        break;
      case MEMORY: {
        let flipped = 0;
        let matched = 0;
        let hidden = 0;
        for (let i = 0; i < 16; i++) {
          const was = a[i];
          const now = b[i];
          if (!(was & 15) && now & 15) flipped++;
          if (was & 15 && !(now & 15)) hidden++;
          if (!(was >> 4) && now >> 4 && now >> 4 !== 3) matched++;
        }
        if (matched) snd.match();
        else if (flipped) snd.flip();
        else if (hidden) snd.mismatch();
        break;
      }
      case PINBALL: {
        if (b[4] !== a[4] || b[5] !== a[5]) snd.point((b[4] > a[4] && side === 0) || (b[5] > a[5] && side === 1));
        // A bumper hit this screen didn't see coming: light it now.
        const now = this.serverNow();
        for (let i = 0; i < 9; i++) {
          if (b[11 + i] !== a[11 + i] && now - this.pinLit[i] > 300) {
            this.pinLit[i] = now;
            snd.bumper(i);
          }
        }
        break;
      }
      case TANKS: {
        if (b[7] < a[7] || b[11] < a[11]) snd.boom();
        else if (b[12] > a[12]) snd.fire();
        else if (b[12] < a[12]) snd.thud();
        break;
      }
    }
  }

  private score(s: ArcadeState): string {
    const d = s.data;
    switch (s.kind) {
      case PONG:
        return `${d[6]} – ${d[7]}`;
      case MEMORY:
        return `${d[16]} – ${d[17]}`;
      case CATCH:
      case DANCE:
        return `${d[5]} – ${d[6]}`;
      case RACER:
        return `${Math.round((d[5] / RACE_GOAL) * 100)}% – ${Math.round((d[6] / RACE_GOAL) * 100)}%`;
      case TANKS:
        return `${"♥".repeat(d[7])} – ${"♥".repeat(d[11])}`;
      case PINBALL:
        return `${d[4]} – ${d[5]}`;
    }
    return "";
  }

  render() {
    const s = this.state;
    const me = this.selfId();
    this.body.replaceChildren();
    if (!s) return;
    // Scores that tick every frame (the race) don't rebuild the panel each time.
    this.shown = `${s.status}:${s.a}:${s.b}:${s.turn}:${s.kind === RACER ? "" : this.score(s)}`;
    const players = el("div", "arcade-players");
    if (s.status === EMPTY) players.textContent = "Free to play. Take on the AI bot, or wait for a challenger.";
    else if (s.status === WAITING) players.textContent = `${this.who(s.a)} ${s.a === me ? "are" : "is"} waiting for a challenger…`;
    else {
      const a = el("span", "", this.who(s.a));
      a.style.color = SIDE[0];
      const b = el("span", "", this.who(s.b));
      b.style.color = SIDE[1];
      players.append(a, " vs ", b);
    }
    const status = el("p", "arcade-status");
    if (s.status === PLAYING) {
      const turnBased = s.kind === CONNECT4 || s.kind === MEMORY;
      const up = s.turn === 0 ? s.a : s.b;
      status.textContent = !turnBased ? HOW[s.kind] : up === me ? `Your move. ${HOW[s.kind]}` : `${this.who(up)}'s move.`;
    } else if (s.status === A_WON || s.status === B_WON || s.status === DRAW) {
      status.textContent = this.result(s);
    } else {
      status.textContent = HOW[s.kind] ?? "";
    }
    this.body.append(players, this.canvas, status);

    if (s.kind === CYCLES && this.side() >= 0) {
      // Buttons for touch screens.
      const pad = el("div", "arcade-pad");
      for (const [label, dir] of [["←", 3], ["↑", 0], ["↓", 2], ["→", 1]] as [string, number][]) {
        pad.append(button(label, () => this.input(dir), "small"));
      }
      this.body.append(pad);
    }

    const row = el("div", "arcade-actions");
    const inGame = s.a === me || s.b === me;
    if (s.status === PLAYING && inGame) {
      row.append(button("Leave game", () => this.send({ t: "ArcadeLeave", cab: this.cab }), "subtle"));
    } else if (s.status === WAITING && s.a === me) {
      row.append(
        button("Play the AI bot instead 🤖", () => this.send({ t: "ArcadeJoin", cab: this.cab, vsBot: true }), "primary"),
        button("Step away", () => this.send({ t: "ArcadeLeave", cab: this.cab }), "subtle"),
      );
    } else if (s.status === WAITING) {
      row.append(button(`🕹️ Play ${this.who(s.a)}`, () => this.send({ t: "ArcadeJoin", cab: this.cab, vsBot: false }), "primary"));
    } else if (s.status !== PLAYING) {
      row.append(
        button("Play the AI bot 🤖", () => this.send({ t: "ArcadeJoin", cab: this.cab, vsBot: true }), "primary"),
        button("Wait for a player", () => this.send({ t: "ArcadeJoin", cab: this.cab, vsBot: false })),
      );
    } else {
      row.append(el("p", "hint", "A game's on. Watch, or try another cabinet."));
    }
    row.append(el("p", "hint arcade-tickets", "🎟️ Win for tickets: 10 against a person, 5 against the AI bot."));
    this.body.append(row);
    this.ask(s);
    this.draw();
  }

  /** Stepping up to a free cabinet (or one with someone waiting): how do you want to play? */
  private ask(s: ArcadeState) {
    const me = this.selfId();
    const join = (vsBot: boolean) => () => this.send({ t: "ArcadeJoin", cab: this.cab, vsBot });
    const title = this.labels[this.cab] ?? "Arcade";
    if (s.status === WAITING && s.a !== me) {
      this.choice.show(
        title,
        `${this.who(s.a)} is waiting for a challenger.`,
        [{ icon: "🕹️", label: `Play ${this.who(s.a)}`, sub: "Win 10 🎟️", primary: true, pick: join(false) }],
        () => this.hide(),
        s.kind === PINBALL ? "🍺 The Mossy Mug" : "🕹️ Arcade",
      );
    } else if (s.status !== PLAYING && s.status !== WAITING) {
      const ended = s.status !== EMPTY;
      const wait = this.endedAt + 1600 - performance.now();
      if (ended && wait > 0) {
        this.choice.hide();
        window.setTimeout(() => this.open && this.render(), wait + 20);
        return;
      }
      this.choice.show(
        ended ? this.result(s) : title,
        ended ? "Play again?" : (HOW[s.kind] ?? ""),
        [
          { icon: "🤖", label: "Play the AI bot", sub: "Starts now · win 5 🎟️", primary: true, pick: join(true) },
          { icon: "👥", label: "Wait for a player", sub: "Someone joins · win 10 🎟️", pick: join(false) },
        ],
        () => this.hide(),
        ended ? title : s.kind === PINBALL ? "🍺 The Mossy Mug" : "🕹️ Arcade",
      );
    } else {
      this.choice.hide();
    }
  }

  // ---- drawing --------------------------------------------------------------------

  /** `target`, eased toward from where `key` was last drawn (`tau` s to close most of the gap). */
  private ease(key: string, target: number, tau = 0.08, snapOver = Infinity): number {
    const v = this.eased.get(key);
    const next = v === undefined || Math.abs(target - v) > snapOver ? target : v + (target - v) * (1 - Math.exp(-this.dt / tau));
    this.eased.set(key, next);
    return next;
  }

  private draw() {
    const ctx = this.canvas.getContext("2d")!;
    const res = this.state?.kind === PINBALL ? 3 : 1;
    if (this.canvas.width !== CW * res) {
      this.canvas.width = CW * res;
      this.canvas.height = CH * res;
      this.canvas.style.imageRendering = res > 1 ? "auto" : "";
    }
    ctx.setTransform(res, 0, 0, res, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#05030c";
    ctx.fillRect(0, 0, CW, CH);
    const s = this.state;
    if (!s) return;
    switch (s.kind) {
      case PONG:
        return this.drawPong(ctx, s);
      case CYCLES:
        return this.drawCycles(ctx, s);
      case CONNECT4:
        return this.drawConnect4(ctx, s);
      case MEMORY:
        return this.drawMemory(ctx, s);
      case CATCH:
        return this.drawCatch(ctx, s);
      case RACER:
        return this.drawRacer(ctx, s);
      case DANCE:
        return this.drawDance(ctx, s);
      case TANKS:
        return this.drawTanks(ctx, s);
      case PINBALL:
        return this.drawPinball(ctx, s);
    }
  }

  /** Pinball 1v1: the playfield lying on its side, a's flippers on the left, b's on the right. */
  private drawPinball(ctx: CanvasRenderingContext2D, s: ArcadeState) {
    const k = CW / PW;
    const st = unpack(s.data);
    const now = this.serverNow();
    const wall = performance.now();
    const mine = this.side();
    const live = s.status === PLAYING;
    const bot = s.a === BOT ? 0 : s.b === BOT ? 1 : -1;
    const view = live ? carry(st, s.t0, now, mine, this.presses, bot) : { x: st.x, y: st.y, vx: 0, vy: 0, ang: st.ang, hits: [] as [number, number][], gone: false };
    // Bumpers the carried-on ball hit: light them (once each hit).
    for (const [i, t] of view.hits) {
      if (t - this.pinLit[i] > 150) {
        this.pinLit[i] = t;
        if (now - t < 120) snd.bumper(i);
      }
    }
    // A point just scored: that end flashes.
    if (this.pinScore && (st.score[0] !== this.pinScore[0] || st.score[1] !== this.pinScore[1])) {
      this.pinGoal = { side: st.score[0] > this.pinScore[0] ? 0 : 1, at: wall };
    }
    this.pinScore = st.score;
    const X = (x: number) => x * k;
    const Y = (y: number) => y * k;

    // ---- the playfield art ----
    const bg = ctx.createRadialGradient(CW / 2, CH / 2, 10, CW / 2, CH / 2, CW * 0.62);
    bg.addColorStop(0, "#3a1868");
    bg.addColorStop(0.55, "#1c0e3a");
    bg.addColorStop(1, "#0b0618");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CW, CH);
    // Sunburst rays behind the centre bumper, slowly turning.
    ctx.save();
    ctx.translate(X(PW / 2), Y(PH / 2));
    ctx.rotate(wall / 9000);
    for (let r = 0; r < 16; r++) {
      ctx.fillStyle = r % 2 ? "rgba(255,79,163,0.07)" : "rgba(63,224,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, CW, (r / 16) * Math.PI * 2, ((r + 0.5) / 16) * Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Rings round the middle, and the bar's name.
    for (const [rad, col] of [[52, "rgba(255,225,79,0.22)"], [44, "rgba(255,225,79,0.12)"]] as [number, string][]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(PW / 2), Y(PH / 2), rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = "bold 9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,225,79,0.55)";
    ctx.fillText("★ MOSSY MUG ★", X(PW / 2), Y(PH / 2) - 58);
    ctx.fillText("★ PINBALL ★", X(PW / 2), Y(PH / 2) + 58);
    // Chevron lights down the middle to each hole, chasing toward it (faster
    // when the ball's on that side: danger!).
    for (const side of [0, 1]) {
      const dir = side ? 1 : -1;
      const near = (side ? view.x > PW / 2 : view.x < PW / 2) && !view.gone;
      const phase = (wall / (near ? 70 : 160)) % 5;
      for (let i = 0; i < 5; i++) {
        const cx = X(PW / 2 + dir * (78 + i * 10));
        const on = Math.abs(i - phase) < 0.8 || (i === 4 && Math.abs(phase - 0) < 0.4);
        ctx.fillStyle = on ? SIDE[side] : SIDE[side] + "33";
        ctx.shadowColor = SIDE[side];
        ctx.shadowBlur = on ? 10 : 0;
        ctx.beginPath();
        ctx.moveTo(cx + dir * 5, Y(PH / 2));
        ctx.lineTo(cx - dir * 3, Y(PH / 2) - 7);
        ctx.lineTo(cx - dir * 1, Y(PH / 2));
        ctx.lineTo(cx - dir * 3, Y(PH / 2) + 7);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.shadowBlur = 0;
    // Rollover lamps along the long walls, chasing round.
    const lamps = 22;
    for (let i = 0; i < lamps; i++) {
      for (const wy of [6, CH - 6]) {
        const x = 40 + (i / (lamps - 1)) * (CW - 80);
        const on = (Math.floor(wall / 90) + i + (wy > 10 ? 11 : 0)) % 6 === 0;
        ctx.fillStyle = on ? "#ffe14f" : "rgba(255,225,79,0.16)";
        ctx.beginPath();
        ctx.arc(x, wy, on ? 2.6 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // A neon border, flaring in the scorer's colour after a point.
    const goal = this.pinGoal && wall - this.pinGoal.at < 1200 ? this.pinGoal : null;
    const flare = goal ? 1 - (wall - goal.at) / 1200 : 0;
    ctx.strokeStyle = goal ? SIDE[goal.side] : "#b07bff";
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 8 + flare * 24;
    ctx.lineWidth = 2 + flare * 3;
    ctx.strokeRect(2, 2, CW - 4, CH - 4);
    ctx.shadowBlur = 0;
    // The holes: glowing drains in each player's colour, pulsing.
    for (const side of [0, 1]) {
      const pulse = 0.55 + 0.45 * Math.sin(wall / 260 + side * Math.PI);
      const hy = Y(PH / 2 - HOLE_HALF);
      const hh = Y(HOLE_HALF * 2);
      const x0 = side ? CW : 0;
      const glow = ctx.createLinearGradient(x0, 0, side ? CW - 70 : 70, 0);
      glow.addColorStop(0, SIDE[side] + "cc");
      glow.addColorStop(1, SIDE[side] + "00");
      ctx.globalAlpha = pulse;
      ctx.fillStyle = glow;
      ctx.fillRect(side ? CW - 70 : 0, hy, 70, hh);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#05030c";
      ctx.fillRect(side ? CW - 5 : 0, hy, 5, hh);
    }

    // ---- the hardware ----
    // Rails: chrome guides.
    ctx.lineCap = "round";
    for (const [ax, ay, bx, by] of RAILS) {
      for (const [w, col] of [[Y(RAIL_R) * 2 + 4, "#2a2638"], [Y(RAIL_R) * 2, "#a9a6c0"], [1.5, "#f2f0ff"]] as [number, string][]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(X(ax), Y(ay));
        ctx.lineTo(X(bx), Y(by));
        ctx.stroke();
      }
    }
    ctx.lineCap = "butt";
    // Bumpers (mushroom caps) and posts: flashing and springing when hit.
    const BUMP_COL = ["#ffe14f", "#5fe08a", "#5fe08a", "#b07bff", "#b07bff", "#ff8f4f", "#ff8f4f", "#e8e8f0", "#e8e8f0"];
    BUMPERS.forEach(([bx, by, br, kick], i) => {
      const t = Math.max(0, now - this.pinLit[i]);
      const lit = Math.exp(-t / 240);
      const spring = 1 + (kick ? 0.3 : 0.18) * Math.exp(-t / 150) * Math.cos(t / 36);
      const r = br * k * spring;
      const cx = X(bx);
      const cy = Y(by);
      const col = BUMP_COL[i];
      // a ring of light rushing out from the hit
      if (t < 350) {
        ctx.strokeStyle = col;
        ctx.globalAlpha = 1 - t / 350;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 4 + t / 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // a soft shadow, the skirt, the cap
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.arc(cx + 2, cy + 3, r + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = col;
      ctx.shadowBlur = 6 + lit * 22;
      ctx.fillStyle = kick ? "#1a1430" : "#3a3650";
      ctx.beginPath();
      ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      const cap = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
      cap.addColorStop(0, "#ffffff");
      cap.addColorStop(0.35 - lit * 0.2, lit > 0.3 ? "#ffffff" : col);
      cap.addColorStop(1, col);
      ctx.fillStyle = cap;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      if (kick) {
        // a star on top
        ctx.fillStyle = `rgba(20,10,40,${0.55 - lit * 0.4})`;
        ctx.beginPath();
        for (let p = 0; p < 10; p++) {
          const a = (p / 10) * Math.PI * 2 - Math.PI / 2;
          const rr = p % 2 ? r * 0.22 : r * 0.5;
          if (p) ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          else ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
      }
    });
    // Flippers: tapered, rubber-rimmed, in the player's colour. Yours as you
    // press them; the bot's as the server plays it; another player's eased.
    for (let f = 0; f < 4; f++) {
      const side = f >> 1;
      const a = side === mine || side === bot ? view.ang[f] : this.ease(`flip${f}`, view.ang[f], 0.03);
      const [px, py] = FLIPPERS[f];
      const tx = px + Math.cos(a) * FLIP_LEN;
      const ty = py + Math.sin(a) * FLIP_LEN;
      const shape = (grow: number, dx = 0, dy = 0) => {
        const r0 = (FLIP_BASE_R + grow) * k;
        const r1 = (FLIP_TIP_R + grow) * k;
        const ax = X(px) + dx;
        const ay = Y(py) + dy;
        const bx = X(tx) + dx;
        const by = Y(ty) + dy;
        const ang = Math.atan2(by - ay, bx - ax);
        const len = Math.hypot(bx - ax, by - ay);
        const off = Math.asin(Math.max(-1, Math.min(1, (r0 - r1) / len)));
        ctx.beginPath();
        ctx.arc(ax, ay, r0, ang + Math.PI / 2 + off, ang - Math.PI / 2 - off);
        ctx.arc(bx, by, r1, ang - Math.PI / 2 - off, ang + Math.PI / 2 + off);
        ctx.closePath();
      };
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      shape(0.6, 2, 3);
      ctx.fill();
      ctx.fillStyle = "#f4f0ff";
      shape(0.7);
      ctx.fill();
      const body = ctx.createLinearGradient(X(px), Y(py) - 6, X(px), Y(py) + 6);
      body.addColorStop(0, "#ffffff");
      body.addColorStop(0.4, SIDE[side]);
      body.addColorStop(1, SIDE[side]);
      ctx.fillStyle = body;
      shape(0);
      ctx.fill();
      ctx.fillStyle = "#d8d4ec";
      ctx.beginPath();
      ctx.arc(X(px), Y(py), 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#6a6680";
      ctx.beginPath();
      ctx.arc(X(px), Y(py), 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- the ball ----
    if (!view.gone) {
      const shown = this.pinShow;
      if (!shown || st.serving || Math.hypot(shown.x - view.x, shown.y - view.y) > 15) this.pinShow = { x: view.x, y: view.y };
      else {
        const e = 1 - Math.exp(-this.dt / 0.02);
        shown.x += (view.x - shown.x) * e;
        shown.y += (view.y - shown.y) * e;
      }
      const b = this.pinShow!;
      this.pinTrail.push({ x: b.x, y: b.y });
      if (this.pinTrail.length > 8) this.pinTrail.shift();
      this.pinTrail.forEach((p, i) => {
        ctx.fillStyle = `rgba(190,215,255,${0.05 * (i + 1)})`;
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), PIN_BALL_R * k * (0.5 + i * 0.06), 0, Math.PI * 2);
        ctx.fill();
      });
      const r = PIN_BALL_R * k;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.arc(X(b.x) + 2, Y(b.y) + 3, r, 0, Math.PI * 2);
      ctx.fill();
      const chrome = ctx.createRadialGradient(X(b.x) - r * 0.35, Y(b.y) - r * 0.4, r * 0.05, X(b.x), Y(b.y), r);
      chrome.addColorStop(0, "#ffffff");
      chrome.addColorStop(0.35, "#dfe2f0");
      chrome.addColorStop(0.75, "#8a8ca4");
      chrome.addColorStop(1, "#4a4c60");
      ctx.fillStyle = chrome;
      ctx.beginPath();
      ctx.arc(X(b.x), Y(b.y), r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      this.pinTrail = [];
    }

    // ---- the score display: an amber dot-matrix panel ----
    const dw = 120;
    const dh = 30;
    const dx = CW / 2 - dw / 2;
    ctx.fillStyle = "rgba(8,4,2,0.88)";
    ctx.fillRect(dx, 12, dw, dh);
    ctx.strokeStyle = "#5a3a10";
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, 12, dw, dh);
    ctx.font = "bold 20px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#ffb84f";
    ctx.shadowBlur = 8;
    ctx.fillStyle = SIDE[0];
    ctx.textAlign = "right";
    ctx.fillText(String(st.score[0]).padStart(2, "0"), CW / 2 - 12, 28);
    ctx.fillStyle = "#ffb84f";
    ctx.textAlign = "center";
    ctx.fillText(":", CW / 2, 27);
    ctx.fillStyle = SIDE[1];
    ctx.textAlign = "left";
    ctx.fillText(String(st.score[1]).padStart(2, "0"), CW / 2 + 12, 28);
    ctx.shadowBlur = 0;
    ctx.font = "bold 8px ui-monospace, monospace";
    ctx.fillStyle = "rgba(255,184,79,0.75)";
    ctx.textAlign = "center";
    ctx.fillText("FIRST TO 10", CW / 2, 48);
    // "POINT!" flaring up at the end that scored.
    if (goal) {
      const t = (wall - goal.at) / 1200;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.font = `bold ${22 + t * 10}px ui-monospace, monospace`;
      ctx.fillStyle = SIDE[goal.side];
      ctx.shadowColor = SIDE[goal.side];
      ctx.shadowBlur = 16;
      ctx.fillText(goal.side === mine ? "POINT!" : mine >= 0 ? "OUCH!" : "POINT!", goal.side ? CW * 0.75 : CW * 0.25, CH / 2 - t * 20);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    if (live && st.serving) banner(ctx, "GET READY…");
  }

  private countdown(ctx: CanvasRenderingContext2D, s: ArcadeState, start: number, end: number) {
    if (s.status !== PLAYING) return;
    const now = this.serverNow();
    const label = now < start ? String(Math.ceil((start - now) / 1000)) : now < start + 600 ? "GO!" : "";
    if (label !== this.lastCount) {
      if (label) snd.count(label === "GO!");
      this.lastCount = label;
    }
    if (label) banner(ctx, label);
    else {
      ctx.font = "bold 13px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#c8c0e0";
      ctx.fillText(`${Math.max(0, Math.ceil((end - now) / 1000))}s`, CW / 2, 4);
    }
  }

  private drawPong(ctx: CanvasRenderingContext2D, s: ArcadeState) {
    const d = s.data;
    const k = 2.4;
    ctx.fillStyle = "#2a2046";
    for (let y = 0; y < CH; y += 16) ctx.fillRect(CW / 2 - 1, y, 2, 8);
    // The ball, carried on from where the server last saw it, off the walls.
    let x = d[0] / 10;
    let y = d[1] / 10;
    if (!d[8] && s.status === PLAYING) {
      const dt = Math.max(0, this.serverNow() - s.t0) / 1000;
      x += ((d[2] - 32768) / 10) * dt;
      y = fold(y + ((d[3] - 32768) / 10) * dt, 2, 118);
      x = Math.min(200, Math.max(0, x));
    }
    // Ease the drawn ball onto that path, so a late bounce doesn't jump it.
    const shown = this.ballShow;
    if (!shown || d[8] || Math.hypot(shown.x - x, shown.y - y) > 20) this.ballShow = { x, y };
    else {
      const k = 1 - Math.exp(-this.dt / 0.035);
      shown.x += (x - shown.x) * k;
      shown.y += (y - shown.y) * k;
    }
    x = this.ballShow!.x;
    y = this.ballShow!.y;
    const paddles = [this.ease("pong0", d[4] / 10, 0.05), this.ease("pong1", d[5] / 10, 0.05)];
    const mine = this.side();
    if (mine >= 0) paddles[mine] = this.paddle;
    [8, 192].forEach((px, i) => {
      ctx.fillStyle = SIDE[i];
      ctx.fillRect(px * k - 3, (paddles[i] - 14) * k, 6, 28 * k);
    });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x * k - 4, y * k - 4, 8, 8);
    ctx.font = "bold 28px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = SIDE[0];
    ctx.fillText(String(d[6]), CW / 2 - 50, 34);
    ctx.fillStyle = SIDE[1];
    ctx.fillText(String(d[7]), CW / 2 + 50, 34);
  }

  private drawCycles(ctx: CanvasRenderingContext2D, s: ArcadeState) {
    const d = s.data;
    const c = 12;
    ctx.fillStyle = "#120c22";
    for (let x = 0; x <= 40; x += 4) ctx.fillRect(x * c, 0, 1, CH);
    for (let y = 0; y <= 24; y += 4) ctx.fillRect(0, y * c, CW, 1);
    for (let i = 0; i < 960; i++) {
      const cell = (d[7 + (i >> 3)] >> ((i & 7) * 2)) & 3;
      if (!cell) continue;
      ctx.fillStyle = SIDE[cell - 1];
      ctx.fillRect((i % 40) * c + 1, Math.floor(i / 40) * c + 1, c - 2, c - 2);
    }
    for (const side of [0, 1]) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(d[side * 2] * c + 2, d[side * 2 + 1] * c + 2, c - 4, c - 4);
    }
    if (s.status === PLAYING && d[6] === 0) banner(ctx, "GET READY…");
  }

  private drawConnect4(ctx: CanvasRenderingContext2D, s: ArcadeState) {
    const d = s.data;
    ctx.fillStyle = "#1b2a8a";
    ctx.fillRect(96, 20, 288, 248);
    if (this.myTurn() && this.hover) {
      const col = Math.floor((this.hover.x - 100) / 40);
      if (col >= 0 && col < 7) {
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(100 + col * 40, 20, 40, 248);
      }
    }
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row < 6; row++) {
        const v = d[col * 6 + row];
        const cx = 120 + col * 40;
        const cy = 244 - row * 40;
        ctx.fillStyle = v ? (v === 1 ? "#ffe14f" : SIDE[1]) : "#05030c";
        ctx.beginPath();
        ctx.arc(cx, cy, 15, 0, Math.PI * 2);
        ctx.fill();
        if (d[42] === col * 6 + row) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }
  }

  private drawMemory(ctx: CanvasRenderingContext2D, s: ArcadeState) {
    const d = s.data;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "34px system-ui, sans-serif";
    for (let i = 0; i < 16; i++) {
      const x = 100 + (i % 4) * 70 + 3;
      const y = 4 + Math.floor(i / 4) * 70 + 3;
      const v = d[i];
      const pic = v & 15;
      const owner = v >> 4;
      if (!pic) {
        ctx.fillStyle = "#3a2470";
        ctx.fillRect(x, y, 64, 64);
        ctx.fillStyle = "#b07bff";
        ctx.fillRect(x + 4, y + 4, 56, 56);
        ctx.fillStyle = "#3a2470";
        ctx.fillRect(x + 8, y + 8, 48, 48);
        ctx.fillStyle = "#b07bff";
        ctx.fillText("?", x + 32, y + 34);
      } else {
        ctx.fillStyle = owner === 3 ? "#f4f1e8" : "#2a2046";
        ctx.fillRect(x, y, 64, 64);
        if (owner === 1 || owner === 2) {
          ctx.strokeStyle = SIDE[owner - 1];
          ctx.lineWidth = 3;
          ctx.strokeRect(x + 1.5, y + 1.5, 61, 61);
        }
        ctx.fillText(MEMORY_PICS[pic], x + 32, y + 35);
      }
    }
  }

  /** Two lanes side by side: yours played here, theirs from what they report. */
  private lanes(ctx: CanvasRenderingContext2D, s: ArcadeState, paint: (side: number, x0: number, mine: boolean) => void) {
    const mine = this.side();
    for (const side of [0, 1]) {
      const x0 = side * (CW / 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, CW / 2, CH);
      ctx.clip();
      paint(side, x0, side === mine);
      ctx.restore();
    }
    ctx.fillStyle = "#2a2046";
    ctx.fillRect(CW / 2 - 1, 0, 2, CH);
    const c = contest(s.data);
    ctx.font = "bold 16px ui-monospace, monospace";
    ctx.textBaseline = "top";
    for (const side of [0, 1]) {
      ctx.textAlign = side ? "right" : "left";
      ctx.fillStyle = SIDE[side];
      const shown = side === mine && this.local ? Math.round(this.local.score) : c.score[side];
      const text = s.kind === RACER ? `${Math.min(100, Math.round((shown / RACE_GOAL) * 100))}%` : String(shown);
      ctx.fillText(text, side ? CW - 8 : 8, 6);
    }
    this.countdown(ctx, s, c.start, c.end);
  }

  private drawCatch(ctx: CanvasRenderingContext2D, s: ArcadeState) {
    const c = contest(s.data);
    const items = catchItems(c.seed);
    const now = this.serverNow() - c.start;
    const W = CW / 2;
    this.lanes(ctx, s, (side, x0, mine) => {
      ctx.fillStyle = side ? "#1a0f1e" : "#0c1620";
      ctx.fillRect(x0, 0, W, CH);
      const caught = mine && this.local ? this.local.gone : null;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const f = (now - it.t) / FALL_MS;
        if (f < 0 || f > 1.05 || caught?.has(i)) continue;
        const x = x0 + 12 + it.x * (W - 24);
        const y = f * (CH - 20);
        drawItem(ctx, it.kind, x, y);
      }
      const bx = mine && this.local ? this.local.x : this.ease(`catch${side}`, c.pos[side] / 1000, 0.1);
      const x = x0 + 12 + bx * (W - 24);
      ctx.fillStyle = SIDE[side];
      ctx.fillRect(x - 20, CH - 22, 40, 4);
      ctx.fillStyle = "#6e4b30";
      ctx.fillRect(x - 18, CH - 18, 36, 12);
      ctx.fillStyle = "#a0703f";
      for (let k = -14; k < 16; k += 6) ctx.fillRect(x + k, CH - 17, 2, 10);
    });
  }

  private drawRacer(ctx: CanvasRenderingContext2D, s: ArcadeState) {
    const c = contest(s.data);
    const cars = traffic(c.seed);
    const W = CW / 2;
    this.lanes(ctx, s, (side, x0, mine) => {
      const dist = mine && this.local ? this.local.score : this.ease(`race${side}`, c.score[side], 0.2, 400);
      const lx = mine && this.local ? this.local.x : this.ease(`lane${side}`, c.pos[side] / 1000, 0.1);
      ctx.fillStyle = "#1d3a1d";
      ctx.fillRect(x0, 0, W, CH);
      ctx.fillStyle = "#2a2a36";
      ctx.fillRect(x0 + 30, 0, W - 60, CH);
      // Lane lines scroll with the distance.
      ctx.fillStyle = "#c8c8d8";
      const off = (dist * 3) % 40;
      for (const k of [1, 2]) for (let y = -40 + off; y < CH; y += 40) ctx.fillRect(x0 + 30 + (k * (W - 60)) / 3 - 1, y, 2, 20);
      ctx.fillStyle = "#ffe14f";
      ctx.fillRect(x0 + 30, 0, 2, CH);
      ctx.fillRect(x0 + W - 32, 0, 2, CH);
      const laneX = (l: number) => x0 + 30 + ((l + 0.5) * (W - 60)) / 3;
      const carY = CH - 50;
      const gone = mine && this.local ? this.local.gone : null;
      cars.forEach((car, i) => {
        if (gone?.has(i)) return;
        const y = carY - (car.d - dist) * 3;
        if (y < -30 || y > CH + 30) return;
        drawCar(ctx, laneX(car.lane), y, car.color);
      });
      // The finish line.
      const fy = carY - (RACE_GOAL - dist) * 3;
      if (fy > -10 && fy < CH) {
        for (let k = 0; k < 10; k++) {
          ctx.fillStyle = k % 2 ? "#ffffff" : "#05030c";
          ctx.fillRect(x0 + 30 + k * ((W - 60) / 10), fy, (W - 60) / 10, 6);
        }
      }
      const px = x0 + 30 + 14 + lx * (W - 60 - 28);
      const slow = mine && this.local && this.local.slowUntil > this.serverNow();
      drawCar(ctx, px, carY, slow && Math.floor(performance.now() / 100) % 2 ? "#ffffff" : SIDE[side]);
      if (c.finished[side]) banner(ctx, "FINISH!", x0 + W / 2);
    });
  }

  private drawDance(ctx: CanvasRenderingContext2D, s: ArcadeState) {
    const c = contest(s.data);
    const chart = danceChart(c.seed);
    const now = this.serverNow();
    const beat = (now - c.start) / BEAT_MS;
    const W = CW / 2;
    this.lanes(ctx, s, (side, x0, mine) => {
      // The floor pulses on the beat.
      const pulse = Math.max(0, 1 - (beat - Math.floor(beat)) * 2.5);
      ctx.fillStyle = side ? `rgba(255,79,163,${0.06 + pulse * 0.08})` : `rgba(63,224,255,${0.06 + pulse * 0.08})`;
      ctx.fillRect(x0, 0, W, CH);
      const laneX = (l: number) => x0 + 30 + l * ((W - 60) / 3);
      const topY = 40;
      const flash = mine && this.local ? this.local.flash : null;
      for (let l = 0; l < 4; l++) {
        const lit = flash && performance.now() - flash[l] < 120;
        ctx.strokeStyle = lit ? "#ffffff" : "#5a5078";
        ctx.lineWidth = 2;
        ctx.strokeRect(laneX(l) - 15, topY - 15, 30, 30);
        arrow(ctx, l, laneX(l), topY, lit ? "#ffffff" : "#5a5078", 11);
      }
      const hit = mine && this.local ? this.local.gone : null;
      chart.forEach((n, i) => {
        if (hit?.has(i)) return;
        const y = topY + (n.beat - beat) * beatGap(beat);
        if (y < topY - 20 || y > CH + 20) return;
        arrow(ctx, n.lane, laneX(n.lane), y, ["#ff4fa3", "#3fe0ff", "#5fe08a", "#ffe14f"][n.lane], 13);
      });
      if (mine && this.local?.judgement && performance.now() - this.local.judgedAt < 500) {
        ctx.font = "bold 18px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffe14f";
        ctx.fillText(this.local.judgement, x0 + W / 2, 100);
        if (this.local.combo > 2) {
          ctx.font = "bold 13px ui-monospace, monospace";
          ctx.fillText(`${this.local.combo} combo`, x0 + W / 2, 122);
        }
      }
    });
  }

  private drawTanks(ctx: CanvasRenderingContext2D, s: ArcadeState) {
    const k = 2.8;
    const ox = 16;
    const oy = 4;
    ctx.fillStyle = "#14200f";
    ctx.fillRect(ox, oy, 160 * k, 100 * k);
    ctx.fillStyle = "#1b2a14";
    for (let x = 0; x < 160; x += 10) ctx.fillRect(ox + x * k, oy, 1, 100 * k);
    for (let y = 0; y < 100; y += 10) ctx.fillRect(ox, oy + y * k, 160 * k, 1);
    ctx.fillStyle = "#5a5078";
    for (const [x0, y0, x1, y1] of TANK_WALLS) {
      ctx.fillRect(ox + x0 * k, oy + y0 * k, (x1 - x0) * k, (y1 - y0) * k);
    }
    const d = s.data;
    const view = this.tankView(s);
    for (const side of [0, 1]) {
      const t = view.tanks[side];
      if (!t) continue;
      ctx.save();
      ctx.translate(ox + t.x * k, oy + t.y * k);
      ctx.rotate(t.a);
      ctx.fillStyle = "#05030c";
      ctx.fillRect(-15, -12, 30, 24);
      ctx.fillStyle = SIDE[side];
      ctx.fillRect(-13, -10, 26, 20);
      ctx.fillStyle = "#05030c";
      ctx.fillRect(-13, -12, 26, 4);
      ctx.fillRect(-13, 8, 26, 4);
      ctx.fillRect(-5, -5, 10, 10);
      ctx.fillRect(0, -2, 20, 4);
      ctx.restore();
    }
    ctx.fillStyle = "#ffe14f";
    for (const sh of view.shells) ctx.fillRect(ox + sh.x * k - 3, oy + sh.y * k - 3, 6, 6);
    ctx.font = "bold 16px ui-monospace, monospace";
    ctx.textBaseline = "top";
    for (const side of [0, 1]) {
      ctx.textAlign = side ? "right" : "left";
      ctx.fillStyle = SIDE[side];
      ctx.fillText("♥".repeat(d[7 + side * 4]), side ? CW - 22 : 22, 8);
    }
    this.countdown(ctx, s, d[0] * 65536 + d[1], d[2] * 65536 + d[3]);
  }

  /**
   * Where the tanks and shells are now, carried on from the server's last
   * states (they come ten times a second). Your own tank is driven ahead on
   * your keys, exactly as the server drives it, so it answers straight away;
   * the other tank and the shells go on at the speed they were going. What's
   * drawn eases toward that, so a fresh state never makes anything jump.
   */
  private tankView(s: ArcadeState): { tanks: ({ x: number; y: number; a: number } | null)[]; shells: { x: number; y: number }[] } {
    const d = s.data;
    const live = s.status === PLAYING && this.snaps.length > 0;
    const last = live ? this.snaps[this.snaps.length - 1] : { t: s.t0, data: d };
    const before = live && this.snaps.length > 1 ? this.snaps[this.snaps.length - 2] : null;
    const now = this.serverNow();
    const startAt = d[0] * 65536 + d[1];
    const ahead = live && now > startAt ? Math.min(0.25, Math.max(0, now - Math.max(last.t, startAt)) / 1000) : 0;
    const span = before ? Math.max(0.03, (last.t - before.t) / 1000) : 0.1;
    const mine = this.side();
    const tanks = [0, 1].map((side) => {
      const b = 4 + side * 4;
      if (d[b + 3] === 0) return null;
      let t = { x: last.data[b] / 10, y: last.data[b + 1] / 10, a: last.data[b + 2] / 1000 };
      if (ahead > 0) {
        if (side === mine) {
          t = driveTank(t, this.tankKeys, ahead);
        } else if (before) {
          // Their speed and turn between the last two states, carried on.
          let da = t.a - before.data[b + 2] / 1000;
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          const vx = (t.x - before.data[b] / 10) / span;
          const vy = (t.y - before.data[b + 1] / 10) / span;
          const nx = t.x + vx * ahead;
          const ny = t.y + vy * ahead;
          t = { x: tankFree(nx, t.y) ? nx : t.x, y: tankFree(t.x, ny) ? ny : t.y, a: t.a + (da / span) * ahead };
        }
      }
      // Ease what's drawn toward it.
      const shown = this.tankShow[side];
      if (!shown || Math.hypot(shown.x - t.x, shown.y - t.y) > 15) {
        this.tankShow[side] = { ...t };
        return t;
      }
      const e = 1 - Math.exp(-this.dt / (side === mine ? 0.045 : 0.07));
      let da = t.a - shown.a;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      shown.x += (t.x - shown.x) * e;
      shown.y += (t.y - shown.y) * e;
      shown.a += da * e;
      return shown;
    });
    // Shells fly straight: each one's velocity from where it was a state ago
    // (or, fresh out of the barrel, from the tank that fired it).
    const shells: { x: number; y: number }[] = [];
    const n = last.data[12] ?? 0;
    const prev: { x: number; y: number }[] = [];
    if (before) for (let i = 0; i < before.data[12]; i++) prev.push({ x: before.data[13 + i * 2] / 10, y: before.data[14 + i * 2] / 10 });
    for (let i = 0; i < n; i++) {
      const x = last.data[13 + i * 2] / 10;
      const y = last.data[14 + i * 2] / 10;
      let vx = 0;
      let vy = 0;
      const was = prev.find((p) => Math.hypot(p.x - x, p.y - y) < SHELL_SPEED * span * 1.5 && Math.hypot(p.x - x, p.y - y) > 0.5);
      if (was) {
        vx = (x - was.x) / span;
        vy = (y - was.y) / span;
      } else {
        let best = Infinity;
        for (const side of [0, 1]) {
          const b = 4 + side * 4;
          const tx = last.data[b] / 10;
          const ty = last.data[b + 1] / 10;
          const dist = Math.hypot(x - tx, y - ty);
          if (dist < best && dist > 0) {
            best = dist;
            vx = ((x - tx) / dist) * SHELL_SPEED;
            vy = ((y - ty) / dist) * SHELL_SPEED;
          }
        }
      }
      const sx = x + vx * ahead;
      const sy = y + vy * ahead;
      if (tankWall(sx, sy, 0.5)) continue;
      shells.push({ x: sx, y: sy });
    }
    return { tanks, shells };
  }
}

// ---- the tank duel's ground rules (as zone/src/instance/arcade.rs) -------------------

const TANK_W = 160;
const TANK_H = 100;
const TANK_WALLS = [
  [36, 14, 44, 40],
  [116, 60, 124, 86],
  [72, 44, 88, 56],
  [60, 80, 76, 86],
];
const TANK_R = 5;
const TANK_SPEED = 34;
const TANK_TURN = 2.6;
const SHELL_SPEED = 110;

function tankWall(x: number, y: number, r: number): boolean {
  return x < r || y < r || x > TANK_W - r || y > TANK_H - r || TANK_WALLS.some(([x0, y0, x1, y1]) => x > x0 - r && x < x1 + r && y > y0 - r && y < y1 + r);
}

const tankFree = (x: number, y: number) => !tankWall(x, y, TANK_R);

/** A tank driven on `keys` for `secs`, in the server's small steps, sliding along walls. */
function driveTank(t: { x: number; y: number; a: number }, keys: number, secs: number) {
  let { x, y, a } = t;
  let left = secs;
  while (left > 0) {
    const dt = Math.min(0.01, left);
    left -= dt;
    if (keys & KEY_LEFT) a -= TANK_TURN * dt;
    if (keys & KEY_RIGHT) a += TANK_TURN * dt;
    const dir = (keys & KEY_FORWARD ? 1 : 0) - (keys & KEY_BACK ? 1 : 0);
    if (dir) {
      const dx = Math.cos(a) * TANK_SPEED * dt * dir;
      const dy = Math.sin(a) * TANK_SPEED * dt * dir;
      if (tankFree(x + dx, y)) x += dx;
      if (tankFree(x, y + dy)) y += dy;
    }
  }
  return { x, y, a };
}

// ---- your side of a contest, played on this screen ----------------------------------

/** Dance off: points lost for pressing an arrow when there's none to hit. */
const WRONG_PRESS = 50;

class Local {
  /** Basket or car position across your lane, 0–1. */
  x = 0.5;
  /** Score (catch, dance) or distance raced. */
  score = 0;
  sentScore = -1;
  sentAt = 0;
  /** Items caught or missed, cars passed or hit, notes judged: by index. */
  gone = new Set<number>();
  /** Racer: slowed after a crash until then; the lane you're steering for. */
  slowUntil = 0;
  private target: number | null = null;
  private speed = 70;
  /** Dance: when each lane was last hit (for the glow), the last verdict, the combo. */
  flash = [0, 0, 0, 0];
  judgement = "";
  judgedAt = 0;
  combo = 0;
  private items: Item[] = [];
  private cars: Car[] = [];
  private notes: Note[] = [];
  /** Something to hear: "catch" (item kind), "bump", "step" (1 good, 0 stray). */
  onEvent: ((e: "catch" | "bump" | "step", v: number) => void) | null = null;

  constructor(
    readonly kind: number,
    readonly seed: number,
    private start: number,
  ) {
    if (kind === CATCH) this.items = catchItems(seed);
    if (kind === RACER) this.cars = traffic(seed);
    if (kind === DANCE) this.notes = danceChart(seed);
  }

  aim(x: number) {
    this.x = x;
    this.target = null;
  }

  nudge(dx: number) {
    this.x = Math.min(1, Math.max(0, this.x + dx));
  }

  /** Racer: hop a lane left or right. */
  steer(dir: number) {
    const lane = Math.round(this.x * 2);
    this.target = Math.min(2, Math.max(0, lane + dir)) / 2;
  }

  update(now: number, dt: number) {
    const t = now - this.start;
    if (t < 0) return;
    if (this.kind === CATCH) {
      for (let i = 0; i < this.items.length; i++) {
        if (this.gone.has(i)) continue;
        const it = this.items[i];
        const f = (t - it.t) / FALL_MS;
        if (f < 0.88) continue;
        // At the basket's height: in it, or past it.
        if (Math.abs(it.x - this.x) < 0.14 && f < 1) {
          this.gone.add(i);
          this.score = Math.max(0, this.score + [1, 3, -3][it.kind]);
          this.onEvent?.("catch", it.kind);
        } else if (f >= 1) {
          this.gone.add(i);
        }
      }
    } else if (this.kind === RACER) {
      if (this.score >= RACE_GOAL) return;
      if (this.target !== null) {
        const d = this.target - this.x;
        this.x += Math.sign(d) * Math.min(Math.abs(d), dt * 3.5);
        if (Math.abs(d) < 0.01) this.target = null;
      }
      this.speed = Math.min(RACE_TOP_SPEED * 0.97, 70 + (t / 1000) * 2.2);
      const v = now < this.slowUntil ? this.speed * 0.3 : this.speed;
      this.score = Math.min(RACE_GOAL, this.score + v * dt);
      const lane = this.x * 2;
      this.cars.forEach((car, i) => {
        if (this.gone.has(i)) return;
        if (car.d < this.score - 12) {
          this.gone.add(i);
        } else if (Math.abs(car.d - this.score) < 10 && Math.abs(car.lane - lane) < 0.7) {
          this.gone.add(i);
          this.slowUntil = now + 1500;
          this.onEvent?.("bump", 0);
        }
      });
    } else if (this.kind === DANCE) {
      // Notes that slipped by unhit are misses.
      this.notes.forEach((n, i) => {
        if (!this.gone.has(i) && now - (this.start + n.beat * BEAT_MS) > 160) {
          this.gone.add(i);
          this.combo = 0;
          this.judgement = "MISS";
          this.judgedAt = performance.now();
        }
      });
    }
  }

  /** Dance: you pressed a lane's arrow at `now`. */
  hit(lane: number, now: number) {
    this.flash[lane] = performance.now();
    let best = -1;
    let off = Infinity;
    this.notes.forEach((n, i) => {
      if (this.gone.has(i) || n.lane !== lane) return;
      const d = Math.abs(now - (this.start + n.beat * BEAT_MS));
      if (d < off) {
        off = d;
        best = i;
      }
    });
    if (best < 0 || off > 150) {
      // Nothing there to hit: mashing costs a little and breaks the combo.
      this.score = Math.max(0, this.score - WRONG_PRESS);
      this.combo = 0;
      this.judgement = "OOPS -" + WRONG_PRESS;
      this.judgedAt = performance.now();
      this.onEvent?.("step", 0);
      return;
    }
    this.gone.add(best);
    const [points, word] = off <= 45 ? [300, "PERFECT!"] : off <= 90 ? [200, "GREAT"] : [100, "GOOD"];
    this.combo++;
    this.score += points + Math.min(100, this.combo * 5);
    this.judgement = word;
    this.judgedAt = performance.now();
    this.onEvent?.("step", 1);
  }
}

// ---- drawing helpers ---------------------------------------------------------------------

function keyName(e: KeyboardEvent): string | null {
  const k = e.key.toLowerCase();
  if (k === "arrowup" || k === "w") return "up";
  if (k === "arrowdown" || k === "s") return "down";
  if (k === "arrowleft" || k === "a") return "left";
  if (k === "arrowright" || k === "d") return "right";
  if (k === " ") return "fire";
  return null;
}

/** Reflects `v` back into [lo, hi] as the ball bounces off the walls. */
function fold(v: number, lo: number, hi: number): number {
  const span = hi - lo;
  let t = (v - lo) % (2 * span);
  if (t < 0) t += 2 * span;
  return lo + (t > span ? 2 * span - t : t);
}

function drawItem(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number) {
  if (kind === 2) {
    ctx.fillStyle = "#05030c";
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ff4f4f";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffe14f";
    ctx.fillRect(x + 3, y - 12, 3, 4);
    return;
  }
  if (kind === 1) {
    ctx.fillStyle = "#ffe14f";
    ctx.fillRect(x - 2, y - 9, 4, 18);
    ctx.fillRect(x - 9, y - 2, 18, 4);
    ctx.fillRect(x - 5, y - 5, 10, 10);
    return;
  }
  ctx.fillStyle = "#e8566b";
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5fe08a";
  ctx.fillRect(x - 1, y - 11, 3, 5);
}

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = "#05030c";
  ctx.fillRect(x - 11, y - 17, 22, 34);
  ctx.fillStyle = color;
  ctx.fillRect(x - 9, y - 15, 18, 30);
  ctx.fillStyle = "#9fd8f0";
  ctx.fillRect(x - 7, y - 10, 14, 6);
  ctx.fillStyle = "#05030c";
  ctx.fillRect(x - 12, y - 12, 3, 7);
  ctx.fillRect(x + 9, y - 12, 3, 7);
  ctx.fillRect(x - 12, y + 6, 3, 7);
  ctx.fillRect(x + 9, y + 6, 3, 7);
}

/** An arrow pointing the lane's way (0 ←, 1 ↓, 2 ↑, 3 →). */
function arrow(ctx: CanvasRenderingContext2D, lane: number, x: number, y: number, color: string, r: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate([Math.PI, Math.PI / 2, -Math.PI / 2, 0][lane]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(0, -r);
  ctx.lineTo(0, -r / 2.4);
  ctx.lineTo(-r, -r / 2.4);
  ctx.lineTo(-r, r / 2.4);
  ctx.lineTo(0, r / 2.4);
  ctx.lineTo(0, r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function banner(ctx: CanvasRenderingContext2D, text: string, cx = CW / 2) {
  ctx.fillStyle = "rgba(5,3,12,0.7)";
  ctx.fillRect(0, CH / 2 - 24, CW, 48);
  ctx.font = "bold 26px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffe14f";
  ctx.fillText(text, cx, CH / 2);
}

