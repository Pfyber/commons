// Bowling at the alley (protocol BowlState / BowlRolled; the game's rules on
// the server in commons_sim::bowling). Each lane: you see it from above,
// pins at the top. On your ball a line sweeps left and right across the
// lane, like the fishing needle: Space or a click stops it where the ball
// will meet the pins (the nearer the middle, the more fall). Then a power
// bar, green to red, runs up and down as at the pool table: stop it for how
// hard. The screen over the lane shouts STRIKE!, SPARE! and the rest, and
// keeps the score card: five frames, scored like ten-pin.

import * as sfx from "../ambient/sfx";
import type { ServerMsg } from "../net/protocol.gen";
import { ChoiceModal, Panel, button, confirmButton, el, isTyping } from "../ui/panels";
import { drawPixelText, pixelWidth } from "../world/pixelfont";
import { SETTLE_MS, fallMs, rollMs } from "../world/bowlfx";

/** protocol `bowl::*`. */
export const EMPTY = 0;
export const PLAYING = 1;
export const A_WON = 2;
export const B_WON = 3;
export const WAITING = 4;
export const DRAW = 5;
export const BOT = 0xfffffff8;
const AIM_MIDDLE = 1000;
/** sim::bowling: the pins, five frames, the gutter, the lane's half-width (pin spacings). */
const ALL = 0x3ff;
const FRAMES = 5;
const GUTTER = 0.92;
const LANE_HALF = 2.3;
/** sim::bowling::POWER_STRIKE: the top 3% of the power bar, with the ball dead centre, is a strike (the only way to one). */
const POWER_STRIKE = 0.97;

type State = Extract<ServerMsg, { t: "BowlState" }>;
type Rolled = Extract<ServerMsg, { t: "BowlRolled" }>;

/** Where pin `i` stands: (across, back) in pin spacings from the head pin (sim::bowling::pin_pos). */
export function pinPos(i: number): [number, number] {
  const [row, k] = i === 0 ? [0, 0] : i <= 2 ? [1, i - 1] : i <= 5 ? [2, i - 3] : [3, i - 6];
  return [k - row / 2, row * 0.866];
}

/** Running totals per frame (sim::bowling::frame_scores): null until a frame's bonus rolls are in. */
export function frameScores(rolls: number[]): (number | null)[] {
  const out: (number | null)[] = [];
  let total = 0;
  let i = 0;
  for (let f = 0; f < FRAMES; f++) {
    const first = rolls[i];
    if (first === undefined) {
      out.push(null);
      continue;
    }
    const last = f === FRAMES - 1;
    let score: number | null;
    if (first === 10) {
      score = rolls[i + 1] !== undefined && rolls[i + 2] !== undefined ? 10 + rolls[i + 1] + rolls[i + 2] : null;
      i += last ? 3 : 1;
    } else if (rolls[i + 1] !== undefined) {
      const second = rolls[i + 1];
      if (first + second === 10) {
        score = rolls[i + 2] !== undefined ? 10 + rolls[i + 2] : null;
        i += last ? 3 : 2;
      } else {
        score = first + second;
        i += 2;
      }
    } else {
      score = null;
      i += 2;
    }
    if (score === null) {
      while (out.length < FRAMES) out.push(null);
      break;
    }
    total += score;
    out.push(total);
  }
  return out;
}

/**
 * Running totals so far, frame by frame, counting a strike or spare's bonus
 * balls as far as they've been bowled (`final` once they all have): so the
 * score moves the moment the pins fall, and settles when the bonus is in.
 * `null` for frames not bowled yet. Final totals match `frameScores`.
 */
export function runningScores(rolls: number[]): ({ total: number; final: boolean } | null)[] {
  const out: ({ total: number; final: boolean } | null)[] = [];
  let total = 0;
  let i = 0;
  const at = (k: number) => rolls[k] ?? 0;
  for (let f = 0; f < FRAMES; f++) {
    if (rolls[i] === undefined) {
      out.push(null);
      continue;
    }
    const last = f === FRAMES - 1;
    const first = rolls[i];
    let score: number;
    let need: number;
    if (first === 10) {
      score = 10 + at(i + 1) + at(i + 2);
      need = i + 3;
      i += last ? 3 : 1;
    } else if (rolls[i + 1] !== undefined && first + rolls[i + 1] === 10) {
      score = 10 + at(i + 2);
      need = i + 3;
      i += last ? 3 : 2;
    } else {
      score = first + at(i + 1);
      need = i + 2;
      i += 2;
    }
    total += score;
    out.push({ total, final: rolls.length >= need });
  }
  return out;
}

/** The score so far (bonus balls counted as far as bowled). */
export function scoreSoFar(rolls: number[]): number {
  return runningScores(rolls).reduce<number>((best, s) => (s ? s.total : best), 0);
}

/** What each frame's boxes show: X for a strike, / a spare, - nothing. */
export function frameMarks(rolls: number[]): string[][] {
  const marks: string[][] = [];
  let i = 0;
  const n = (k: number) => (k === 0 ? "-" : String(k));
  for (let f = 0; f < FRAMES && i < rolls.length; f++) {
    if (f < FRAMES - 1) {
      if (rolls[i] === 10) {
        marks.push(["X"]);
        i += 1;
      } else {
        const a = rolls[i];
        const b = rolls[i + 1];
        marks.push(b === undefined ? [n(a)] : [n(a), a + b === 10 ? "/" : n(b)]);
        i += 2;
      }
    } else {
      // The last frame: up to three balls, a fresh rack after a strike or spare.
      const m: string[] = [];
      let up = 10;
      for (let k = 0; k < 3 && i < rolls.length; k++, i++) {
        const r = rolls[i];
        m.push(r === 10 && up === 10 ? "X" : up < 10 && r === up ? "/" : n(r));
        up = up - r === 0 ? 10 : up - r;
        if (k === 1 && m[0] !== "X" && m[1] !== "/") break;
      }
      marks.push(m);
    }
  }
  return marks;
}

/** Strikes in a row a player has just bowled (for the TURKEY). */
function strikesInARow(rolls: number[]): number {
  let run = 0;
  for (const m of frameMarks(rolls)) {
    for (const x of m) run = x === "X" ? run + 1 : 0;
  }
  return run;
}

/** Whether `standing` is a split: the head pin gone, the rest in two groups or more with a gap between. */
function isSplit(standing: number): boolean {
  if (standing & 1) return false;
  const up = [...Array(10).keys()].filter((i) => standing & (1 << i));
  if (up.length < 2) return false;
  const seen = new Set([up[0]]);
  const stack = [up[0]];
  while (stack.length) {
    const i = stack.pop()!;
    const [ix, iy] = pinPos(i);
    for (const j of up) {
      if (seen.has(j)) continue;
      const [jx, jy] = pinPos(j);
      if (Math.hypot(jx - ix, jy - iy) <= 1.05) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size < up.length;
}

const popcount = (m: number) => [...Array(10).keys()].filter((i) => m & (1 << i)).length;

// ---- the lane, first person ---------------------------------------------------
//
// Fake 3D in chunky pixels: the lane is drawn into a small canvas, one pixel
// at a time, as seen from the foul line: boards running away to the pins,
// gutters either side, the next lanes beyond, the pin deck and the masking
// unit at the far end. Pins and the ball are drawn over it, smaller the
// further away. Then it's blown up 2× with no smoothing.
//
// Lane coordinates: `u` across (-1, 1 the lane's edges; the gutters beyond),
// `z` along it (0 the foul line, about 1 the pins; below 0 the approach).

const LW = 150;
const LH = 230;
const PX = 2;
const CW = LW * PX;
const CH = LH * PX;
const MIDX = 75;
/** The vanishing point's height, the foul line's, and the lane's half-width there (px). */
const VY = 34;
const Y0 = 194;
const HALF0 = 58;
/** How fast things shrink into the distance. */
const K = 2.3;
const GUTTER_W = 0.22;
/** The head pin's depth, each row behind it, and the end of the deck (the pit). */
const PIN_Z = 0.9;
const ROW_Z = 0.035;
const DECK_Z = 1.06;
/** Where the ball is held, just short of the foul line, at the bottom of the view. */
const HAND_Z = -0.05;
/** Ball and pin sizes, in px at the foul line. */
const BALL_PX = 15;
const PIN_PX = 34;
/** How long the swing takes (the ball leaves the hand as the avatar lets go), the roll, and the pins settling. */
const THROW_MS = 850;

/** One sweep of the aim line across and back, and one trip of the power arrow. */
const AIM_MS = 1900;
const POWER_MS = 950;

const scaleAt = (z: number) => 1 / (1 + z * K);
const yAt = (z: number) => VY + (Y0 - VY) * scaleAt(z);
const xAt = (u: number, z: number) => MIDX + u * HALF0 * scaleAt(z);
/** How far down the lane the ball is, `t` ms into its roll. */
const ballZ = (t: number, ms: number) => Math.min(1.2, t / ms) ** 1.15 * 1.2;
/** The ball in your hand leans a little the way you aim (of the aim). */
const LEAN = 0.18;
/**
 * Where the ball is across the lane `z` along it, aimed at `aim`: from the
 * middle at the foul line, straight out on a diagonal to meet the pins at
 * `aim`. Aimed into a gutter, it heads for the lane's edge and drops in.
 */
const ballPath = (aim: number, z: number): { u: number; drop: number } => {
  const f = Math.max(0, z) / PIN_Z;
  if (Math.abs(aim) < GUTTER) return { u: aim * LEAN + (aim - aim * LEAN) * f, drop: 0 };
  const edge = Math.sign(aim) * (1 + GUTTER_W / 2);
  const g = Math.min(1, f / 0.8);
  const u = aim * LEAN + (edge - aim * LEAN) * g;
  return { u, drop: Math.abs(u) > 1 ? 5 : 0 };
};
/** Pin `i`'s place in lane coordinates. */
const pinUZ = (i: number) => {
  const [x, y] = pinPos(i);
  return { u: x / LANE_HALF, z: PIN_Z + (y / 0.866) * ROW_Z };
};

/** A colour as [r, g, b], and mixed toward another. */
type RGB = [number, number, number];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const C = {
  board: hex(0xe0ad6a),
  board2: hex(0xd29c58),
  approach: hex(0xe8bf84),
  approach2: hex(0xdcb078),
  deck: hex(0xedc58c),
  arrow: hex(0x7a4a22),
  foul: hex(0xc8303a),
  gutter: hex(0x241a3a),
  gutterLip: hex(0x5a4a7a),
  next: hex(0x8a6a4a),
  next2: hex(0x7e5f40),
  capping: hex(0x2f8f8a),
  fog: hex(0x140e24),
  pit: hex(0x07060d),
};

interface Roll {
  by: number;
  aim: number;
  power: number;
  knocked: number;
  /** Which pins stood when it was bowled. */
  standing: number;
  start: number;
  /** How each knocked pin flies (lane units), and which way it tips. */
  fly: Map<number, { du: number; dz: number; tip: number }>;
  announced: boolean;
  rumbled: boolean;
}

export class BowlingPanel extends Panel {
  private states = new Map<number, State>();
  private lane = 0;
  private canvas = document.createElement("canvas");
  /** The small canvas the lane is drawn into, a pixel at a time, then blown up; and its floor, painted once. */
  private lo = document.createElement("canvas");
  private floor: ImageData | null = null;
  /** The lane's name, on its masking unit. */
  private laneTitle = "";
  private screen = el("div", "bowl-screen");
  private screenText = el("div", "bowl-screen-text");
  private card = el("div", "bowl-card");
  private status = el("p", "bowl-status");
  private actions = el("div", "bowl-actions");
  private choice = new ChoiceModal();
  /** Your ball: lining up the aim, then the power (time each began). */
  private phase: "idle" | "aim" | "power" = "idle";
  private phaseAt = 0;
  private lockedAim = 0;
  /** A roll on screen, and the state to show once it's done. */
  private roll: Roll | null = null;
  private pending: State | null = null;
  private raf = 0;
  private screenTimer = 0;

  private onKey = (e: KeyboardEvent) => {
    if (!this.open || isTyping(e) || e.code !== "Space") return;
    e.preventDefault();
    // Held down, the key repeats: that would lock the aim and fire off a
    // weak roll a moment later. One press, one step.
    if (!e.repeat) this.act();
  };

  constructor(
    private selfId: () => number,
    private nameOf: (id: number) => string,
    private send: (m: { t: "BowlJoin"; lane: number; vsBot: boolean } | { t: "BowlLeave"; lane: number } | { t: "BowlRoll"; lane: number; aim: number; power: number }) => void,
  ) {
    super("🎳 Bowling", "bowling");
    this.enlargeable(this.canvas);
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.lo.width = LW;
    this.lo.height = LH;
    this.canvas.className = "bowl-canvas";
    this.screen.append(this.screenText);
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.act();
    });
    window.addEventListener("keydown", this.onKey);
  }

  /** Who's bowling on each lane now (for the avatars' pose). */
  players(lane: number): number[] {
    const s = this.states.get(lane);
    return s?.status === PLAYING ? [s.a, s.b] : [];
  }

  /** Who's up on `lane` with the ball in hand (0: nobody, or it's rolling). */
  upOn(lane: number): number {
    const s = this.states.get(lane);
    if (s?.status !== PLAYING || (lane === this.lane && this.roll)) return 0;
    return s.turn === 0 ? s.a : s.b;
  }

  /** A lane's status (`EMPTY` if we haven't heard). */
  statusOf(lane: number): number {
    return this.states.get(lane)?.status ?? EMPTY;
  }

  private get state(): State | undefined {
    return this.states.get(this.lane);
  }

  private who(id: number) {
    return id === this.selfId() ? "You" : id === BOT ? "Bowling bot 🤖" : this.nameOf(id);
  }

  private myTurn(): boolean {
    const s = this.state;
    return !!s && !this.roll && s.status === PLAYING && (s.turn === 0 ? s.a : s.b) === this.selfId();
  }

  /** Space or a click: stop the aim line, then the power arrow, and bowl. */
  private act() {
    if (!this.myTurn()) return;
    const now = performance.now();
    if (this.phase === "aim") {
      this.lockedAim = this.aimNow(now);
      this.phase = "power";
      this.phaseAt = now;
      sfx.tone(sfx.at(0), 0.06, 0.06, "square", 660);
    } else if (this.phase === "power") {
      const power = this.powerNow(now);
      this.phase = "idle";
      this.send({ t: "BowlRoll", lane: this.lane, aim: Math.round(AIM_MIDDLE + this.lockedAim * 1000), power: Math.round(power * 1000) });
    }
    this.renderStatus();
  }

  /** The aim line: across the whole lane and back, gutters and all (-1 to 1). */
  private aimNow(now: number): number {
    return Math.sin(((now - this.phaseAt) / AIM_MS) * Math.PI * 2);
  }

  /** The power arrow: up the bar and down again (0 to 1). */
  private powerNow(now: number): number {
    return 0.5 - 0.5 * Math.cos(((now - this.phaseAt) / POWER_MS) * Math.PI * 2);
  }

  /** Walking up to lane `lane`: see it, and join if it's free. */
  openLane(lane: number, title: string) {
    this.lane = lane;
    this.laneTitle = title;
    this.el.querySelector(".panel-head strong")!.textContent = `🎳 ${title}`;
    this.show();
  }

  onState(s: State) {
    if (this.roll && s.lane === this.lane) {
      this.pending = s;
      return;
    }
    this.apply(s);
  }

  private apply(s: State) {
    const before = this.states.get(s.lane);
    this.states.set(s.lane, s);
    if (s.lane !== this.lane || !this.open) return;
    // Your ball comes up: start the aim line.
    const mine = s.status === PLAYING && (s.turn === 0 ? s.a : s.b) === this.selfId();
    if (mine && this.phase === "idle") {
      this.phase = "aim";
      this.phaseAt = performance.now();
    } else if (!mine) this.phase = "idle";
    if (before?.status === PLAYING && s.status !== PLAYING && s.status !== WAITING && s.status !== EMPTY) this.announceEnd(s);
    this.render();
  }

  onRolled(m: Rolled) {
    const s = this.states.get(m.lane);
    if (m.lane !== this.lane || !this.open || !s || m.shot !== s.shot + 1) return;
    const aim = (m.aim - AIM_MIDDLE) / 1000;
    // Each pin that goes flies off away from where the ball hit, and tips that way.
    const fly = new Map<number, { du: number; dz: number; tip: number }>();
    for (let i = 0; i < 10; i++) {
      if (!(m.knocked & (1 << i))) continue;
      const p = pinUZ(i);
      const du = (p.u - aim) * 1.1 + (Math.random() - 0.5) * 0.25;
      fly.set(i, { du, dz: 0.02 + Math.random() * 0.06, tip: (du >= 0 ? 1 : -1) * (0.9 + Math.random() * 0.6) });
    }
    this.roll = { by: m.by, aim, power: m.power / 1000, knocked: m.knocked, standing: s.standing, start: performance.now(), fly, announced: false, rumbled: false };
    this.phase = "idle";
    this.renderStatus();
  }

  /** What the screen over the lane says about a roll. */
  private announce(r: Roll, s: State) {
    const n = popcount(r.knocked);
    const first = r.standing === ALL;
    const rolls = [...((s.turn === 0 ? s.rollsA : s.rollsB) ?? [])];
    // (The state is from before this roll: add it to see the run of strikes.)
    rolls.push(n);
    const left = r.standing & ~r.knocked;
    let text: string;
    let kind: string;
    if (first && n === 10) {
      const run = strikesInARow(rolls);
      [text, kind] = run >= 3 ? ["TURKEY!", "strike"] : run === 2 ? ["DOUBLE!", "strike"] : ["STRIKE!", "strike"];
    } else if (!first && left === 0) [text, kind] = ["SPARE!", "spare"];
    else if (n === 0) [text, kind] = Math.abs(r.aim) >= GUTTER ? ["GUTTER BALL", "gutter"] : ["MISS", "gutter"];
    else if (first && isSplit(left)) [text, kind] = [`SPLIT! · ${n}`, "split"];
    else [text, kind] = [`${n} PIN${n === 1 ? "" : "S"}`, "count"];
    this.flash(text, kind);
    if (kind === "strike") sfx.strikeCheer();
  }

  private announceEnd(s: State) {
    const me = this.selfId();
    if (s.status === DRAW) return this.flash("IT'S A TIE!", "spare");
    const winner = s.status === A_WON ? s.a : s.b;
    this.flash(winner === me ? "YOU WIN! 🏆" : `${this.who(winner).toUpperCase()} WINS`, winner === me ? "strike" : "count");
  }

  /** The screen's big message, with its little show, then back to the frame. */
  private flash(text: string, kind: string) {
    window.clearTimeout(this.screenTimer);
    this.screenText.replaceChildren();
    // Letter by letter, so each can bounce in turn.
    [...text].forEach((ch, i) => {
      const span = el("span", "bowl-letter", ch === " " ? " " : ch);
      span.style.animationDelay = `${i * 45}ms`;
      this.screenText.append(span);
    });
    this.screen.className = `bowl-screen show ${kind}`;
    void this.screen.offsetWidth;
    this.screen.classList.add("go");
    this.screenTimer = window.setTimeout(() => this.idleScreen(), 2400);
  }

  private idleScreen() {
    const s = this.state;
    this.screen.className = "bowl-screen";
    let text = "COMMONS LANES";
    if (s?.status === PLAYING) {
      const up = s.turn === 0 ? s.a : s.b;
      text = `FRAME ${s.frame + 1} · ${this.who(up).toUpperCase()}${s.ball ? ` · BALL ${s.ball + 1}` : ""}`;
    } else if (s?.status === WAITING) text = "WAITING FOR A BOWLER…";
    this.screenText.textContent = text;
  }

  show() {
    super.show();
    if (this.myTurn() && this.phase === "idle") {
      this.phase = "aim";
      this.phaseAt = performance.now();
    }
    cancelAnimationFrame(this.raf);
    const tick = (t: number) => {
      this.step(t);
      this.draw(t);
      if (this.open) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  hide() {
    super.hide();
    this.choice.hide();
    cancelAnimationFrame(this.raf);
    this.phase = "idle";
    if (this.roll) {
      this.roll = null;
      if (this.pending) this.apply(this.pending);
      this.pending = null;
    }
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    this.choice.destroy();
    super.destroy();
  }

  /** The roll's time: the pins crash as the ball reaches them; when all's settled, on to the next. */
  private step(now: number) {
    const r = this.roll;
    if (!r) return;
    const t = now - r.start;
    // Away down the lane once the swing lets go of it.
    if (t > THROW_MS && !r.rumbled) {
      r.rumbled = true;
      sfx.bowlRoll(rollMs(r.power), r.power);
    }
    if (t > THROW_MS + rollMs(r.power) * 0.82 && !r.announced) {
      r.announced = true;
      const n = popcount(r.knocked);
      if (n) sfx.pinsCrash(n);
      const s = this.state;
      if (s) this.announce(r, s);
    }
    // The pins left standing (or none) stay in view a while before the next ball, or rack.
    if (t > THROW_MS + rollMs(r.power) + fallMs(r.power) + SETTLE_MS) {
      this.roll = null;
      const p = this.pending;
      this.pending = null;
      if (p) this.apply(p);
      else this.render();
    }
  }

  render() {
    const s = this.state;
    const me = this.selfId();
    this.body.replaceChildren();
    if (!this.screenText.textContent || !this.screen.classList.contains("show")) this.idleScreen();
    this.renderCard();
    this.renderStatus();
    this.body.append(this.screen, this.card, this.canvas, this.status, this.actions);
    this.actions.replaceChildren();
    const lane = this.lane;
    const inGame = !!s && (s.a === me || s.b === me);
    if (!s || s.status === EMPTY || s.status === A_WON || s.status === B_WON || s.status === DRAW) {
      this.actions.append(
        button("Bowl against the bot 🤖", () => this.send({ t: "BowlJoin", lane, vsBot: true }), "primary"),
        button("Wait for a player", () => this.send({ t: "BowlJoin", lane, vsBot: false })),
      );
    } else if (s.status === WAITING && s.a === me) {
      this.actions.append(
        button("Bowl against the bot instead 🤖", () => this.send({ t: "BowlJoin", lane, vsBot: true }), "primary"),
        button("Put the ball back", () => this.send({ t: "BowlLeave", lane }), "subtle"),
      );
    } else if (s.status === WAITING) {
      this.actions.append(button(`🎳 Bowl with ${this.who(s.a)}`, () => this.send({ t: "BowlJoin", lane, vsBot: false }), "primary"));
    } else if (inGame) {
      const leave = () => this.send({ t: "BowlLeave", lane });
      // Mid-game, a stray tap shouldn't throw it away.
      this.actions.append(s.status === PLAYING ? confirmButton(`bowl-leave-${lane}`, "Leave game", "Tap again to leave the game", leave) : button("Leave game", leave, "subtle"));
    } else {
      this.actions.append(el("p", "hint", "A game's on. Grab a seat and watch, or try another lane."));
    }
    this.ask();
  }

  /** Stepping up to a free lane (or one with someone waiting): how do you want to play? */
  private ask() {
    const s = this.state;
    const me = this.selfId();
    const lane = this.lane;
    const join = (vsBot: boolean) => () => this.send({ t: "BowlJoin", lane, vsBot });
    if (s?.status === WAITING && s.a !== me) {
      this.choice.show("Bowling", `${this.who(s.a)} is waiting for someone to bowl with.`, [{ icon: "🎳", label: `Bowl with ${this.who(s.a)}`, sub: "Five frames, head to head", primary: true, pick: join(false) }], () => this.hide(), "🎳 Commons Lanes");
    } else if (!s || s.status === EMPTY) {
      this.choice.show(
        "Bowling",
        "Five frames, scored like the real thing. Stop the line for your aim, then the bar for your power.",
        [
          { icon: "🤖", label: "Play the bot", sub: "It bowls a decent game", primary: true, pick: join(true) },
          { icon: "🧍", label: "Wait for a player", sub: "Someone can join you here", pick: join(false) },
        ],
        () => this.hide(),
        "🎳 Commons Lanes",
      );
    } else this.choice.hide();
  }

  /** The score card: both bowlers, five frames, marks and running totals. */
  private renderCard() {
    const s = this.state;
    this.card.replaceChildren();
    if (!s || (s.status !== PLAYING && !s.rollsA.length)) return;
    const table = el("table", "bowl-score");
    const head = el("tr");
    head.append(el("th", "", ""));
    for (let f = 0; f < FRAMES; f++) head.append(el("th", s.status === PLAYING && s.frame === f ? "now" : "", String(f + 1)));
    head.append(el("th", "", "Total"));
    table.append(head);
    for (const [p, id, rolls] of [
      [0, s.a, s.rollsA],
      [1, s.b, s.rollsB],
    ] as [number, number, number[]][]) {
      const row = el("tr", s.status === PLAYING && s.turn === p ? "up" : "");
      row.append(el("td", "who", this.who(id)));
      const marks = frameMarks(rolls);
      const scores = runningScores(rolls);
      for (let f = 0; f < FRAMES; f++) {
        const cell = el("td", "frame");
        const box = el("div", "marks");
        for (const m of marks[f] ?? []) box.append(el("span", m === "X" ? "x" : m === "/" ? "sp" : "", m));
        const s = scores[f];
        // Still waiting on a strike or spare's bonus balls: shown, but dimmed.
        cell.append(box, el("div", s && !s.final ? "run pending" : "run", s ? String(s.total) : ""));
        row.append(cell);
      }
      row.append(el("td", "total", String(scoreSoFar(rolls))));
      table.append(row);
    }
    this.card.append(table);
  }

  private renderStatus() {
    const s = this.state;
    const me = this.selfId();
    if (!s || s.status !== PLAYING) {
      this.status.textContent = "";
      return;
    }
    const up = s.turn === 0 ? s.a : s.b;
    this.status.textContent = this.roll
      ? "Rolling…"
      : up !== me
        ? `${this.who(up)}'s ball.`
        : this.phase === "aim"
          ? "Your ball: press Space or click to stop the line where you want to hit. The middle knocks the most!"
          : "Now the power: press Space or click to stop the arrow. Higher is harder. A strike takes the glowing top AND a ball dead centre!";
  }

  // ---- drawing -----------------------------------------------------------------

  private draw(now: number) {
    const lo = this.lo.getContext("2d")!;
    const s = this.state;
    if (!this.floor) this.floor = this.paintFloor(lo);
    lo.putImageData(this.floor, 0, 0);
    this.paintBackWall(lo);

    const r = this.roll;
    const t = r ? now - r.start : 0;
    const standing = r ? r.standing : (s?.standing ?? ALL);
    const mineUp = !!s && (s.turn === 0 ? s.a : s.b) === this.selfId();
    // Where the ball is: in your hand, on the swing, or down the lane.
    let ball: { u: number; z: number; drop: number; spin: number } | null = null;
    if (r) {
      if (t < THROW_MS) {
        // The swing: back and down out of sight, then forward and up onto the lane.
        const k = t / THROW_MS;
        const drop = (k < 0.5 ? k * 2 : (1 - k) * 2) * 90;
        ball = { u: r.aim * LEAN, z: HAND_Z + Math.max(0, k - 0.5) * 2 * -HAND_Z, drop, spin: 0 };
      } else {
        const z = ballZ(t - THROW_MS, rollMs(r.power));
        const { u, drop } = ballPath(r.aim, z);
        ball = z < DECK_Z ? { u, z, drop, spin: t / 70 } : null;
      }
    } else if (s?.status === PLAYING) {
      const aiming = this.myTurn() && this.phase !== "idle";
      const aim = this.phase === "aim" ? this.aimNow(now) : this.phase === "power" ? this.lockedAim : 0;
      if (aiming) this.paintAim(lo, aim);
      ball = { u: aiming ? aim * LEAN : 0, z: HAND_Z, drop: 0, spin: 0 };
    }
    // Pins and the ball, far to near.
    const things: { z: number; draw: () => void }[] = [];
    const bz = r && t >= THROW_MS ? ballZ(t - THROW_MS, rollMs(r.power)) : -1;
    for (let i = 0; i < 10; i++) {
      if (!(standing & (1 << i))) continue;
      const p = pinUZ(i);
      const f = r?.fly.get(i);
      if (f && r && bz >= p.z - 0.03) {
        // Hit: it tips over, skids off and fades.
        const hitAt = THROW_MS + rollMs(r.power) * ((p.z - 0.03) / 1.2) ** (1 / 1.15);
        const k = Math.min(1, Math.max(0, (t - hitAt) / fallMs(r.power)));
        if (k >= 1) continue;
        const e = 1 - (1 - k) ** 2;
        const z = p.z + f.dz * e;
        things.push({ z, draw: () => this.paintPin(lo, p.u + f.du * e, z, f.tip * e, k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1) });
        continue;
      }
      things.push({ z: p.z, draw: () => this.paintPin(lo, p.u, p.z, 0, 1) });
    }
    if (ball) {
      const b = ball;
      const mine = r ? r.by === this.selfId() : mineUp;
      things.push({ z: b.z, draw: () => this.paintBall(lo, b.u, b.z, b.drop, b.spin, mine) });
    }
    things.sort((a, b) => b.z - a.z);
    for (const th of things) th.draw();
    // Your hand under the ball while you line it up, and the power bar.
    if (!r && this.myTurn() && this.phase !== "idle") this.paintHand(lo, (this.phase === "aim" ? this.aimNow(now) : this.lockedAim) * LEAN);
    if (!r && this.myTurn() && this.phase === "power") this.paintPower(lo, this.powerNow(now));

    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.lo, 0, 0, CW, CH);
  }

  /** The floor, pixel by pixel: the lane's boards and arrows, the approach, the gutters, the lanes either side. */
  private paintFloor(lo: CanvasRenderingContext2D): ImageData {
    const img = lo.createImageData(LW, LH);
    const d = img.data;
    const yDeck = Math.floor(yAt(DECK_Z));
    for (let y = 0; y < LH; y++) {
      for (let x = 0; x < LW; x++) {
        let c: RGB = C.fog;
        if (y > yDeck) {
          const sc = (y + 0.5 - VY) / (Y0 - VY);
          const z = (1 / sc - 1) / K;
          const u = (x + 0.5 - MIDX) / (HALF0 * sc);
          const au = Math.abs(u);
          if (au <= 1) {
            const board = Math.floor((u + 1) * 9.5);
            if (z >= PIN_Z - 0.04) c = C.deck;
            else if (z < 0) c = board % 2 ? C.approach : C.approach2;
            else c = board % 2 ? C.board : C.board2;
            // The foul line, the dots and the arrows.
            if (z >= -0.012 && z < 0) c = C.foul;
            if (z > 0.03 && z < 0.036 && board % 3 === 1) c = C.arrow;
            for (let k = -3; k <= 3; k++) {
              const tip = 0.15 + Math.abs(k) * 0.014;
              if (z >= tip && z < tip + 0.045 && Math.abs(u - k * 0.2) < 0.045 * ((z - tip) / 0.045)) c = C.arrow;
            }
            // A sheen of oil down the middle, nearer.
            if (au < 0.55 && z > 0 && z < 0.7) c = mix(c, [255, 240, 210], 0.12 * (1 - au / 0.55));
          } else if (au <= 1 + GUTTER_W) {
            c = au > 1 + GUTTER_W - 0.03 ? C.gutterLip : C.gutter;
          } else if (au <= 1 + GUTTER_W + 0.12) {
            c = C.capping;
          } else {
            const board = Math.floor((au - 1.34) * 9.5);
            c = board % 2 ? C.next : C.next2;
            if (z >= PIN_Z - 0.04) c = mix(C.deck, C.fog, 0.3);
          }
          // Further off, dimmer.
          c = mix(c, C.fog, Math.min(0.55, Math.max(0, z) * 0.42));
          if (z < -0.3) c = mix(c, C.fog, 0.2);
        }
        const i = (y * LW + x) * 4;
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
        d[i + 3] = 255;
      }
    }
    return img;
  }

  /** The far end: the pit behind the deck and the masking unit over it, lit in neon, with the lane's name. */
  private paintBackWall(lo: CanvasRenderingContext2D) {
    const yDeck = Math.floor(yAt(DECK_Z));
    lo.fillStyle = css(C.pit);
    lo.fillRect(0, yDeck - 5, LW, 6);
    lo.fillStyle = "#1a1030";
    lo.fillRect(0, 0, LW, yDeck - 5);
    const half = Math.round(HALF0 * scaleAt(DECK_Z) + 8);
    // The neighbours' masking units, dimmer.
    for (const side of [-1, 1]) {
      const cx = Math.round(MIDX + side * HALF0 * scaleAt(DECK_Z) * 2.75);
      lo.fillStyle = "#211936";
      lo.fillRect(cx - half, yDeck - 28, half * 2, 22);
      lo.fillStyle = "rgba(63,224,255,0.4)";
      lo.fillRect(cx - half, yDeck - 8, half * 2, 1);
    }
    // Ours: a panel over the pins, neon-trimmed, with the lane's name.
    lo.fillStyle = "#2a2046";
    lo.fillRect(MIDX - half, yDeck - 30, half * 2, 25);
    lo.fillStyle = "#ff4fa3";
    lo.fillRect(MIDX - half, yDeck - 30, half * 2, 2);
    lo.fillStyle = "#3fe0ff";
    lo.fillRect(MIDX - half, yDeck - 8, half * 2, 2);
    const label = (this.laneTitle || "LANE").toUpperCase();
    drawPixelText(lo, label, Math.round(MIDX - pixelWidth(label) / 2), yDeck - 21, "#ffe14f");
    // Neon strip lights along the ceiling.
    lo.fillStyle = "rgba(63,224,255,0.25)";
    lo.fillRect(0, 3, LW, 2);
    lo.fillStyle = "rgba(255,79,163,0.2)";
    lo.fillRect(0, 9, LW, 1);
  }

  /** A pin at (`u`, `z`), seen from the front: white, two red stripes at the neck; `tip` leans it over (falling), `a` fades it. */
  private paintPin(lo: CanvasRenderingContext2D, u: number, z: number, tip: number, a: number) {
    const sc = scaleAt(z);
    const h = Math.max(4, Math.round(PIN_PX * sc * (1 - Math.min(0.6, Math.abs(tip) * 0.4))));
    const bx = xAt(u, z);
    const by = Math.round(yAt(z));
    // Half-width at height t (0 the base, 1 the top): base, belly, neck, head.
    const width = (t: number) => {
      if (t < 0.3) return 0.22 + t * 0.55;
      if (t < 0.62) return 0.385 - (t - 0.3) * 0.75;
      if (t < 0.8) return 0.145 + (t - 0.62) * 0.4;
      return Math.max(0.06, 0.217 - (t - 0.8) * 0.65);
    };
    lo.globalAlpha = a;
    // The outline (a pixel bigger all round), then the body, row by row from the base up.
    for (const pass of [0, 1]) {
      for (let r = 0; r < h; r++) {
        const t = r / h;
        const w = Math.max(1, Math.round(width(t) * h * 0.9)) + (pass ? 0 : 2);
        const x = Math.round(bx + tip * r * 1.1 - w / 2);
        const y = by - r;
        lo.fillStyle = pass ? ((t > 0.6 && t < 0.66) || (t > 0.69 && t < 0.73) ? "#c8303a" : "#f4f1e8") : "#1a1020";
        lo.fillRect(x, pass ? y : y - 1, w, pass ? 1 : 3);
      }
    }
    // A highlight down its left.
    lo.fillStyle = "#ffffff";
    lo.fillRect(Math.round(bx - h * 0.12 + tip * h * 0.3), by - Math.round(h * 0.55), 1, Math.max(1, Math.round(h * 0.25)));
    // Its shadow on the deck.
    lo.globalAlpha = a * 0.35;
    lo.fillStyle = "#000000";
    lo.fillRect(Math.round(bx - h * 0.18), by, Math.max(2, Math.round(h * 0.36)), 1);
    lo.globalAlpha = 1;
  }

  /** The ball at (`u`, `z`): shaded, its finger holes turning as it rolls; `drop` sinks it (into a gutter, or out of sight on the backswing). */
  private paintBall(lo: CanvasRenderingContext2D, u: number, z: number, drop: number, spin: number, mine: boolean) {
    const sc = scaleAt(z);
    const r = Math.max(2, Math.round(BALL_PX * sc));
    const cx = Math.round(xAt(u, z));
    const cy = Math.round(yAt(z) - r + drop * sc);
    const base = mine ? hex(0x3f5fd0) : hex(0xc8303a);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        // Lit from the upper left; the rim darker.
        const lit = Math.max(0, 1 - Math.hypot(dx + r * 0.35, dy + r * 0.4) / (r * 1.5));
        const c = d2 > (r - 1) * (r - 1) ? mix(base, [0, 0, 0], 0.6) : mix(base, [255, 255, 255], lit * 0.45);
        lo.fillStyle = css(c);
        lo.fillRect(cx + dx, cy + dy, 1, 1);
      }
    }
    // Finger holes, coming round the front of the ball as it turns over.
    const hole = Math.max(1, Math.round(r / 5));
    lo.fillStyle = "#0f0a1c";
    for (const [a0, side] of [
      [0, -1],
      [0, 1],
      [0.6, 0],
    ]) {
      const a = spin + a0;
      if (Math.cos(a) < 0) continue; // round the back
      lo.fillRect(Math.round(cx + side * r * 0.3 - hole / 2), Math.round(cy - r * 0.25 + Math.sin(a) * r * 0.6), hole, hole);
    }
    // Its shadow.
    lo.fillStyle = "rgba(0,0,0,0.3)";
    lo.fillRect(cx - r + 1, Math.round(yAt(z)), r * 2 - 2, Math.max(1, Math.round(r / 5)));
  }

  /** Your hand under the ball, and a sleeve, at the bottom of the view. */
  private paintHand(lo: CanvasRenderingContext2D, u: number) {
    const cx = Math.round(xAt(u, HAND_Z));
    const y = Math.round(yAt(HAND_Z));
    lo.fillStyle = "#1a1020";
    lo.fillRect(cx - 12, y - 4, 24, LH - y + 4);
    lo.fillStyle = "#e8b48a";
    lo.fillRect(cx - 11, y - 3, 22, 9);
    lo.fillStyle = "#c8916a";
    lo.fillRect(cx - 11, y + 4, 22, 2);
    lo.fillStyle = "#3f7ed0";
    lo.fillRect(cx - 10, y + 6, 20, LH - y);
  }

  /** The aim: a needle at the foul line, and a dotted line from it up the lane to the pins. */
  private paintAim(lo: CanvasRenderingContext2D, aim: number) {
    // The ball's path, from your hand in the middle out to where it meets the pins.
    const gutter = Math.abs(aim) >= GUTTER;
    lo.fillStyle = gutter ? "#e8566b" : "#ffffff";
    for (let z = 0.02; z < PIN_Z - 0.04; z += 0.06) {
      const w = Math.max(1, Math.round(2 * scaleAt(z)));
      lo.fillRect(Math.round(xAt(ballPath(aim, z).u, z)) - (w >> 1), Math.round(yAt(z)), w, w);
    }
    // The needle: where it'll hit, just short of the head pin.
    const tz = PIN_Z - 0.06;
    const tu = ballPath(aim, tz).u;
    const h = Math.max(4, Math.round(12 * scaleAt(tz)));
    lo.fillStyle = gutter ? "#e8566b" : "#ffe14f";
    lo.fillRect(Math.round(xAt(tu, tz)) - 1, Math.round(yAt(tz)) - h + 2, 2, h);
    lo.fillRect(Math.round(xAt(tu, tz)) - 3, Math.round(yAt(tz)) + 1, 6, 1);
  }

  /** The power bar at the right: green at the bottom to red at the top, and its arrow. */
  private paintPower(lo: CanvasRenderingContext2D, p: number) {
    const x = LW - 12;
    const top = 60;
    const h = 110;
    lo.fillStyle = "#0f0a1c";
    lo.fillRect(x - 1, top - 1, 9, h + 2);
    for (let i = 0; i < h; i++) {
      const k = 1 - i / h;
      lo.fillStyle = css(k < 0.55 ? mix(hex(0x5f9e4b), hex(0xf6c343), k / 0.55) : mix(hex(0xf6c343), hex(0xc8553d), (k - 0.55) / 0.45));
      lo.fillRect(x, top + i, 7, 1);
    }
    // The very top: every pin goes. Striped and glowing.
    const zone = Math.max(2, Math.round((1 - POWER_STRIKE) * h));
    const glow = 0.6 + 0.4 * Math.sin(performance.now() / 120);
    for (let i = 0; i < zone; i++) {
      lo.fillStyle = i % 2 ? "#fff2a8" : "#e8566b";
      lo.fillRect(x, top + i, 7, 1);
    }
    lo.fillStyle = `rgba(255,225,120,${0.5 * glow})`;
    lo.fillRect(x - 2, top - 2, 11, zone + 3);
    const ay = Math.round(top + h - p * h);
    lo.fillStyle = "#ffffff";
    lo.fillRect(x - 1, ay, 9, 1);
    for (let i = 0; i < 4; i++) lo.fillRect(x - 3 - i, ay - i, 1, i * 2 + 1);
  }
}
