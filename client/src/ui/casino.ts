// The Casino (ADR 0017): a slot machine (three reels that spin and stop one
// by one), the tables everyone shares (K2: the roulette wheel, where all bet
// on the same spin, and two blackjack tables of five seats against the
// dealer) and the cashier's desk (the rules, the limits, today's play, taking
// a break). Coins only, never real money; every outcome comes from the server.

import type { Auth } from "../net/api";
import { ApiError } from "../net/api";
import type { Social } from "../social";
import { Panel, button, el } from "./panels";

export interface CasinoStatus {
  can_play: boolean;
  why: string | null;
  today: { bet: number; won: number; net: number; loss_left: number };
  limits: { slots: [number, number]; roulette: [number, number]; roulette_round: number; blackjack: [number, number]; daily_loss: number };
  slots: { symbols: string[]; three: number[]; two_cherries: number };
  break_until: number | null;
}

/** An idempotency key for one round. */
function key(): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const SYMBOL_ICONS: Record<string, string> = { cherry: "🍒", lemon: "🍋", bell: "🔔", star: "⭐", gem: "💎", seven: "7️⃣" };

export type RouletteBet = { on: "red" | "black" | "odd" | "even" | "low" | "high" } | { on: "dozen"; n: number } | { on: "number"; n: number };

export class Casino {
  status: CasinoStatus | null = null;
  /** Called after any round, so the coins on screen catch up. */
  onPlayed: () => void = () => {};
  constructor(private auth: Auth) {}

  async load(): Promise<CasinoStatus> {
    this.status = await this.auth.get<CasinoStatus>("/api/social/casino");
    return this.status;
  }

  async slots(bet: number): Promise<{ outcome: { reels: string[]; pays: number }; payout: number }> {
    const r = await this.auth.send<{ outcome: { reels: string[]; pays: number }; payout: number }>("/api/social/casino/slots", { bet, key: key() });
    this.onPlayed();
    return r;
  }

  takeBreak(days: 1 | 7) {
    return this.auth.send<{ until: number }>("/api/social/casino/break", { days });
  }
}

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "That didn't work.");

function todayLine(s: CasinoStatus | null): string {
  if (!s) return "";
  const net = s.today.net;
  return `Today: ${net >= 0 ? "+" : ""}${net} coins · you can lose ${s.today.loss_left} more today`;
}

// ---- the slot machine -------------------------------------------------------------

export class SlotsPanel extends Panel {
  private bet = 5;
  private reels: HTMLElement[] = [];
  private spinning = false;
  private msg = el("p", "casino-msg");
  private foot = el("p", "hint");

  constructor(private casino: Casino) {
    super("🎰 Slots", "casino slots");
  }

  show() {
    super.show();
    void this.casino
      .load()
      .then(() => this.open && this.render())
      .catch(() => {});
  }

  render() {
    this.body.replaceChildren();
    const s = this.casino.status;
    const box = el("div", "slot-reels");
    this.reels = [0, 1, 2].map(() => {
      const r = el("div", "slot-reel", "🍒");
      box.append(r);
      return r;
    });
    this.body.append(box);
    if (s && !s.can_play) {
      this.body.append(el("p", "hint warn", s.why ?? "You can't play just now."));
      return;
    }
    const [lo, hi] = s?.limits.slots ?? [1, 20];
    const bets = el("div", "tier-row");
    for (const b of [1, 2, 5, 10, 20].filter((b) => b >= lo && b <= hi)) {
      bets.append(button(`${b}`, () => ((this.bet = b), this.render()), b === this.bet ? "small on" : "small"));
    }
    const spin = button(`Spin (${this.bet} coins)`, () => void this.spin(spin), "primary");
    this.body.append(el("p", "hint", "Bet:"), bets, spin, this.msg);
    if (s) {
      const card = s.slots.symbols.map((sym, i) => `${SYMBOL_ICONS[sym]}×3 pays ${s.slots.three[i]}×`).join(" · ");
      this.body.append(el("p", "hint pay-card", `${card} · 🍒🍒 pays 2×. Returns about 95% of what's bet.`));
    }
    this.foot.textContent = todayLine(s);
    this.body.append(this.foot);
  }

  private async spin(btn: HTMLButtonElement) {
    if (this.spinning) return;
    this.spinning = true;
    btn.disabled = true;
    this.msg.textContent = "";
    const all = Object.values(SYMBOL_ICONS);
    const timers = this.reels.map((r, i) => window.setInterval(() => (r.textContent = all[(Math.random() * all.length) | 0]), 70 + i * 10));
    this.reels.forEach((r) => r.classList.add("spinning"));
    try {
      const res = await this.casino.slots(this.bet);
      // The reels stop one by one.
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 450 : 320));
        window.clearInterval(timers[i]);
        this.reels[i].classList.remove("spinning");
        this.reels[i].textContent = SYMBOL_ICONS[res.outcome.reels[i]] ?? "?";
      }
      if (res.payout > 0) {
        this.msg.textContent = `✨ You win ${res.payout} coins!`;
        this.msg.className = "casino-msg win";
      } else {
        this.msg.textContent = "No luck this time.";
        this.msg.className = "casino-msg";
      }
      await this.casino.load().catch(() => {});
      this.foot.textContent = todayLine(this.casino.status);
    } catch (e) {
      timers.forEach((t) => window.clearInterval(t));
      this.reels.forEach((r) => r.classList.remove("spinning"));
      this.msg.textContent = errText(e);
      this.msg.className = "casino-msg";
    } finally {
      this.spinning = false;
      btn.disabled = false;
    }
  }
}

// ---- the tables, shared (K2) ---------------------------------------------------------

export interface Chip {
  player: string;
  name: string;
  bet: RouletteBet;
  amount: number;
}

export interface WheelState {
  phase: "open" | "betting" | "spinning";
  closes: number | null;
  number: number | null;
  lands: number | null;
  chips: Chip[];
  ready: string[];
  last: { number: number; red: boolean; winners: { name: string; coins: number }[] } | null;
  /** The numbers that came up, newest first. */
  history: number[];
}

/** Chip colours, one per player at the table (in the order they joined the spin). */
export const CHIP_COLORS = ["#e05a47", "#4f86d8", "#f2c94c", "#5fb36b", "#b06fd8", "#ef8bb5", "#5ec8c8", "#f08a3c"];

/** Someone with chips down on this spin. */
export interface TablePlayer {
  id: string;
  name: string;
  color: string;
  total: number;
  ready: boolean;
  last: RouletteBet;
}

/** Everyone with chips on the wheel's spin, each with their colour (the same on every screen). */
export function playersOf(w: WheelState | null): TablePlayer[] {
  const out: TablePlayer[] = [];
  for (const c of w?.chips ?? []) {
    let p = out.find((x) => x.id === c.player);
    if (!p) {
      p = { id: c.player, name: c.name, color: CHIP_COLORS[out.length % CHIP_COLORS.length], total: 0, ready: w!.ready.includes(c.player), last: c.bet };
      out.push(p);
    }
    p.total += c.amount;
    p.last = c.bet;
  }
  return out;
}

export function sameBet(a: RouletteBet, b: RouletteBet): boolean {
  return a.on === b.on && ("n" in a ? a.n : -1) === ("n" in b ? b.n : -1);
}

/** "red", "black" or "green": the pocket's colour. */
export function pocketColour(n: number): "red" | "black" | "green" {
  return n === 0 ? "green" : RED.has(n) ? "red" : "black";
}

export interface CardFace {
  face: string;
  suit: number;
}

export interface Hand {
  cards: CardFace[];
  total: number | null;
  soft?: boolean;
  hidden?: number;
}

export interface SeatState {
  player: string;
  name: string;
  bet: number;
  hand: Hand | null;
  doubled: boolean;
  done: boolean;
  result: { outcome: "blackjack" | "win" | "push" | "lose" | "bust"; paid: number } | null;
}

export interface TableState {
  phase: "betting" | "playing" | "done";
  deal_at: number | null;
  turn: number | null;
  until: number;
  dealer: Hand | null;
  seats: (SeatState | null)[];
}

export interface Floor {
  instance: number | null;
  roulette: WheelState;
  blackjack: TableState[];
  /** Bumped on every change: an older one (a slow reply) is ignored. */
  seq: number;
  now: number;
}

/**
 * The tables on the casino floor, as the server has them, kept up to date by
 * its pushes; and the moves you can make at them.
 */
export class Tables {
  floor: Floor | null = null;
  /** Server clock minus ours, so countdowns agree. */
  private skew = 0;
  private listeners = new Set<() => void>();
  /** A big win somewhere on the floor. */
  onCheer: (text: string) => void = () => {};
  /** Coins moved (a bet, a payout). */
  onCoins: () => void = () => {};

  constructor(
    private auth: Auth,
    readonly selfId: string,
    social: Social,
  ) {
    social.onPush((m) => {
      if (m.t === "casino_tables") this.take(m as unknown as Floor);
      if (m.t === "casino_win") this.onCheer(String(m.text));
    });
  }

  /** Server time now, in ms. */
  now(): number {
    return Date.now() + this.skew;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private take(f: Floor) {
    if (f.instance === null) return;
    // A reply that left the server before news we've already had: stale.
    if (this.floor && this.floor.instance === f.instance && f.seq < this.floor.seq) return;
    const had = this.floor;
    this.floor = f;
    this.skew = f.now - Date.now();
    // Our chips were paid (the wheel landed), or a hand of ours was.
    const paid = (had?.roulette.phase === "spinning" && f.roulette.phase !== "spinning") || f.blackjack.some((t, i) => t.phase === "done" && had?.blackjack[i]?.phase !== "done" && t.seats.some((s) => s?.player === this.selfId));
    if (paid) this.onCoins();
    this.listeners.forEach((fn) => fn());
  }

  async load() {
    this.take(await this.auth.get<Floor>("/api/social/casino/tables"));
  }

  private async send(path: string, body: unknown) {
    const f = await this.auth.send<Floor>(`/api/social/casino/${path}`, body);
    this.take(f);
    return f;
  }

  async rouletteBet(bet: RouletteBet, amount: number) {
    await this.send("roulette/bet", { bet, amount, key: key() });
    this.onCoins();
  }
  rouletteSpin() {
    return this.send("roulette/spin", {});
  }
  sit(table: number, seat: number) {
    return this.send("blackjack/sit", { table, seat });
  }
  standUp() {
    return this.send("blackjack/stand_up", {});
  }
  async bet(amount: number) {
    await this.send("blackjack/bet", { amount, key: key() });
    this.onCoins();
  }
  async act(action: "hit" | "stand" | "double") {
    await this.send("blackjack/act", { action });
    if (action === "double") this.onCoins();
  }

  /** Where we sit, if we do: table and seat. */
  mySeat(): { table: number; seat: number } | null {
    for (const [t, table] of (this.floor?.blackjack ?? []).entries()) {
      const seat = table.seats.findIndex((s) => s?.player === this.selfId);
      if (seat >= 0) return { table: t, seat };
    }
    return null;
  }
}

/** Seconds left until server time `at`. */
function secsLeft(tables: Tables, at: number | null): number {
  return at ? Math.max(0, Math.ceil((at - tables.now()) / 1000)) : 0;
}

/** Names a roulette bet: "Red", "2nd 12", "17". */
export function betName(b: RouletteBet): string {
  switch (b.on) {
    case "red":
      return "Red";
    case "black":
      return "Black";
    case "odd":
      return "Odd";
    case "even":
      return "Even";
    case "low":
      return "1–18";
    case "high":
      return "19–36";
    case "dozen":
      return ["1st 12", "2nd 12", "3rd 12"][b.n - 1];
    case "number":
      return `${b.n}`;
  }
}

/** What a bet pays back on `n` (the stake included), as a multiple (`commons_sim::casino`). */
export function betPays(b: RouletteBet, n: number): number {
  const red = RED.has(n);
  const win =
    b.on === "red" ? red
    : b.on === "black" ? n !== 0 && !red
    : b.on === "odd" ? n !== 0 && n % 2 === 1
    : b.on === "even" ? n !== 0 && n % 2 === 0
    : b.on === "low" ? n >= 1 && n <= 18
    : b.on === "high" ? n >= 19 && n <= 36
    : b.on === "dozen" ? n !== 0 && Math.floor((n - 1) / 12) + 1 === b.n
    : b.on === "number" && n === b.n;
  if (!win) return 0;
  return b.on === "number" ? 36 : b.on === "dozen" ? 3 : 2;
}

// ---- roulette ---------------------------------------------------------------------

/** The pockets round a European wheel, in order. */
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/**
 * The roulette table, shared: everyone in the casino bets on the same spin,
 * sees each other's chips, and watches the same wheel land.
 */
export class RoulettePanel extends Panel {
  private amount = 10;
  private angle = 0;
  private canvas = el("canvas", "wheel");
  private msg = el("p", "casino-msg");
  private clock = el("p", "table-clock");
  private foot = el("p", "hint");
  private landed: number | null = null;
  /** The spin being shown (its landing time), so a push mid-spin doesn't restart it. */
  private showing: number | null = null;
  private off: (() => void) | null = null;
  private timer = 0;

  constructor(
    private casino: Casino,
    private tables: Tables,
  ) {
    super("🎡 Roulette", "casino roulette");
    this.canvas.width = 170;
    this.canvas.height = 170;
  }

  show() {
    super.show();
    this.off ??= this.tables.onChange(() => this.open && this.update());
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 250);
    void Promise.all([this.casino.load(), this.tables.load()])
      .then(() => this.open && this.render())
      .catch(() => {});
  }

  hide() {
    super.hide();
    this.off?.();
    this.off = null;
    window.clearInterval(this.timer);
  }

  private get wheel(): WheelState | null {
    return this.tables.floor?.roulette ?? null;
  }

  /** A push came: spin the wheel if it's just started, and redraw the rest. */
  private update() {
    const w = this.wheel;
    if (w?.phase === "spinning" && w.lands && w.number !== null && this.showing !== w.lands) {
      this.showing = w.lands;
      this.landed = null;
      this.msg.textContent = "No more bets!";
      this.msg.className = "casino-msg";
      void this.spinTo(w.number, Math.max(600, w.lands - this.tables.now()));
    }
    this.render();
  }

  private tick() {
    const w = this.wheel;
    if (!w) return;
    if (w.phase === "betting") this.clock.textContent = `Place your bets: ${secsLeft(this.tables, w.closes)} s`;
  }

  render() {
    this.body.replaceChildren();
    const s = this.casino.status;
    const w = this.wheel;
    const self = this.tables.selfId;
    const spinning = w?.phase === "spinning";
    const canPlay = !s || s.can_play;
    this.draw();
    // The wheel; beside it the clock, who's playing (each in their colour)
    // and the board of the last numbers.
    const top = el("div", "wheel-row");
    const side = el("div", "wheel-side");
    top.append(this.canvas, side);
    this.body.append(top);
    side.append(this.clock);
    this.clock.textContent =
      w?.phase === "betting" ? `Place your bets: ${secsLeft(this.tables, w.closes)} s`
      : spinning ? "No more bets: the wheel's spinning…"
      : "The table's open: put a chip down to start a spin.";
    const players = playersOf(w);
    if (players.length) {
      const list = el("div", "table-players");
      for (const p of players) {
        const row = el("div", "table-player");
        const dot = el("span", "chip-dot");
        dot.style.background = p.color;
        row.append(dot, el("span", p.id === self ? "mine" : "", `${p.id === self ? "You" : p.name} · ${p.total}${p.ready ? " ✓" : ""}`));
        // Back a friend's hunch: the same bet, with your chip.
        if (p.id !== self && !spinning && canPlay) row.append(button("Same bet", () => void this.place(p.last), "tiny"));
        list.append(row);
      }
      side.append(list);
    }
    if (w?.history.length) {
      const board = el("div", "history");
      for (const n of w.history) board.append(el("span", `num ${pocketColour(n)}`, String(n)));
      side.append(board);
    }
    if (w?.last && !spinning && !players.length) {
      const won = w.last.winners.length ? w.last.winners.map((x) => `${x.name} +${x.coins}`).join(", ") : "nobody this time";
      side.append(el("p", "hint", `Last spin: ${w.last.number} ${pocketColour(w.last.number)}. Won: ${won}.`));
    }
    if (!canPlay) {
      this.body.append(el("p", "hint warn", s?.why ?? "You can't play just now."));
      return;
    }
    // While it spins, everyone just watches.
    if (spinning) {
      this.body.append(this.felt(w, players, true), this.msg);
      this.body.scrollTop = 0;
      return;
    }
    const [lo, hi] = s?.limits.roulette ?? [1, 50];
    const amounts = el("div", "tier-row");
    amounts.append(el("span", "hint", "Chip:"));
    for (const a of [1, 5, 10, 25, 50].filter((a) => a >= lo && a <= hi)) {
      amounts.append(button(`${a}`, () => ((this.amount = a), this.render()), a === this.amount ? "small on chip" : "small chip"));
    }
    const mine = (w?.chips ?? []).filter((c) => c.player === self);
    const others = players.filter((p) => p.id !== self && !p.ready).length;
    const ready = w?.ready.includes(self);
    const go = button(ready ? `Waiting for ${others} more…` : others ? "Spin! (when everyone's ready)" : "Spin!", () => void this.ready(go), "primary");
    go.disabled = !mine.length || !!ready;
    this.body.append(amounts, this.felt(w, players, false), el("p", "hint", "Tap the felt to put a chip down: a number pays 35:1, a dozen 2:1, the outside boxes 1:1."), go, this.msg);
    this.foot.textContent = `${todayLine(s)} · Up to ${s?.limits.roulette_round ?? 100} a spin · One zero: every bet returns 97.3%.`;
    this.body.append(this.foot);
  }

  /** The betting layout: tap a box to put a chip on it; everyone's chips show on it in their colours. */
  private felt(w: WheelState | null, players: TablePlayer[], locked: boolean): HTMLElement {
    const felt = el("div", locked ? "felt locked" : "felt");
    const colour = new Map(players.map((p) => [p.id, p.color]));
    const cell = (b: RouletteBet, label: string, cls: string) => {
      const c = button(label, () => !locked && void this.place(b), `cell ${cls}`);
      const on = (w?.chips ?? []).filter((x) => sameBet(x.bet, b));
      if (on.length) {
        const stack = el("span", "stack");
        const seen = new Set<string>();
        for (const x of on) {
          if (seen.has(x.player)) continue;
          seen.add(x.player);
          const dot = el("span", "chip-dot");
          dot.style.background = colour.get(x.player) ?? "#fff";
          stack.append(dot);
        }
        c.append(stack);
        c.title = on.map((x) => `${x.name}: ${x.amount}`).join(", ");
        c.classList.add("has-chips");
      }
      return c;
    };
    const numbers = el("div", "felt-numbers");
    numbers.append(cell({ on: "number", n: 0 }, "0", "zero green"));
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 12; k++) {
        const n = k * 3 + (3 - r);
        numbers.append(cell({ on: "number", n }, String(n), pocketColour(n)));
      }
    }
    const dozens = el("div", "felt-row");
    for (const n of [1, 2, 3]) dozens.append(cell({ on: "dozen", n }, betName({ on: "dozen", n }), "out"));
    const outside = el("div", "felt-row");
    for (const b of [{ on: "low" }, { on: "even" }, { on: "red" }, { on: "black" }, { on: "odd" }, { on: "high" }] as RouletteBet[]) {
      outside.append(cell(b, b.on === "red" || b.on === "black" ? "◆" : betName(b), `out ${b.on === "red" ? "red" : b.on === "black" ? "black" : ""}`));
    }
    felt.append(numbers, dozens, outside);
    return felt;
  }

  private async place(b: RouletteBet) {
    try {
      await this.tables.rouletteBet(b, this.amount);
      this.msg.textContent = "";
      await this.casino.load().catch(() => {});
    } catch (e) {
      this.msg.textContent = errText(e);
      this.msg.className = "casino-msg";
    }
    if (this.open) this.render();
  }

  private async ready(btn: HTMLButtonElement) {
    btn.disabled = true;
    try {
      await this.tables.rouletteSpin();
    } catch (e) {
      this.msg.textContent = errText(e);
    }
  }

  /** Turns the wheel so pocket `n` ends under the ball, over `dur` ms; then says how we did. */
  private async spinTo(n: number, dur: number) {
    const mine = (this.wheel?.chips ?? []).filter((c) => c.player === this.tables.selfId);
    const step = (Math.PI * 2) / WHEEL.length;
    const target = -WHEEL.indexOf(n) * step;
    const start = this.angle;
    const turns = Math.PI * 2 * 5;
    let end = target;
    while (end > start - turns) end -= Math.PI * 2;
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const frame = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const ease = 1 - (1 - t) ** 3;
        this.angle = start + (end - start) * ease;
        this.draw();
        if (t < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
    this.angle = target;
    this.landed = n;
    this.draw();
    const colour = n === 0 ? "green" : RED.has(n) ? "red" : "black";
    const won = mine.reduce((sum, c) => sum + c.amount * betPays(c.bet, n), 0);
    if (!mine.length) this.msg.textContent = `${n} ${colour}!`;
    else this.msg.textContent = won > 0 ? `${n} ${colour}! ✨ You win ${won} coins.` : `${n} ${colour}. Not this time.`;
    this.msg.className = won > 0 ? "casino-msg win" : "casino-msg";
    await this.casino.load().catch(() => {});
    if (this.open) this.render();
  }

  private draw() {
    const c = this.canvas;
    const ctx = c.getContext("2d")!;
    const r = c.width / 2;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(this.angle);
    const step = (Math.PI * 2) / WHEEL.length;
    ctx.fillStyle = "#3b3a2e";
    ctx.beginPath();
    ctx.arc(0, 0, r - 2, 0, Math.PI * 2);
    ctx.fill();
    WHEEL.forEach((n, i) => {
      ctx.fillStyle = n === 0 ? "#2f8f4f" : RED.has(n) ? "#c8553d" : "#2b2723";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r - 6, i * step - step / 2 - Math.PI / 2, i * step + step / 2 - Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.rotate(i * step);
      ctx.fillStyle = "#fff8e3";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(n), 0, -r + 20);
      ctx.restore();
    });
    ctx.fillStyle = "#8a5a33";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d8b45a";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // The ball, at the top, and the number it landed on.
    ctx.fillStyle = "#fff8e3";
    ctx.strokeStyle = "#3b3a2e";
    ctx.beginPath();
    ctx.arc(r, 30, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (this.landed !== null) {
      ctx.fillStyle = "#fff8e3";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(this.landed), r, r + 8);
    }
  }
}

// ---- blackjack ----------------------------------------------------------------------

const SUITS = ["♠", "♥", "♦", "♣"];

function cardEl(c: CardFace | null): HTMLElement {
  if (!c) return el("span", "card back", "");
  const red = c.suit === 1 || c.suit === 2;
  return el("span", red ? "card red" : "card", `${c.face}${SUITS[c.suit]}`);
}

function handEl(h: Hand | null): HTMLElement {
  const box = el("div", "cards");
  if (!h) return box;
  for (const c of h.cards) box.append(cardEl(c));
  for (let i = 0; i < (h.hidden ?? 0); i++) box.append(cardEl(null));
  if (h.total !== null && h.cards.length) box.append(el("span", "total", h.hidden ? `${h.total} + ?` : `${h.soft && h.total < 21 ? "soft " : ""}${h.total}`));
  return box;
}

const OUTCOME: Record<string, string> = { blackjack: "Blackjack! 🃏", win: "Wins", push: "Push", lose: "Loses", bust: "Bust" };

/**
 * A blackjack table: five seats against the dealer. Sit down, bet, and play
 * your hand in turn while the others watch (and they theirs while you do).
 */
export class BlackjackPanel extends Panel {
  /** Which table (0: the left one). */
  table = 0;
  private amount = 10;
  private msg = el("p", "casino-msg");
  private clock = el("p", "table-clock");
  private off: (() => void) | null = null;
  private timer = 0;

  constructor(
    private casino: Casino,
    private tables: Tables,
  ) {
    super("🃏 Blackjack", "casino blackjack");
  }

  /** Opens table `t`. */
  at(t: number): this {
    this.table = t;
    this.titleEl.textContent = `🃏 Blackjack · table ${t + 1}`;
    return this;
  }

  show() {
    super.show();
    this.off ??= this.tables.onChange(() => this.open && this.render());
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 250);
    void Promise.all([this.casino.load(), this.tables.load()])
      .then(() => this.open && this.render())
      .catch(() => {});
  }

  hide() {
    super.hide();
    this.off?.();
    this.off = null;
    window.clearInterval(this.timer);
  }

  private get state(): TableState | null {
    return this.tables.floor?.blackjack[this.table] ?? null;
  }

  private clockText(t: TableState): string {
    if (t.phase === "betting") return t.deal_at ? `Dealing in ${secsLeft(this.tables, t.deal_at)} s (or when everyone's bet)` : "Take a seat and place a bet to start a hand.";
    if (t.phase === "playing" && t.turn !== null) {
      const who = t.seats[t.turn];
      const mine = who?.player === this.tables.selfId;
      return `${mine ? "Your turn" : `${who?.name ?? "?"}'s turn`} · ${secsLeft(this.tables, t.until)} s`;
    }
    return "Hand over: the next one's coming.";
  }

  private tick() {
    const t = this.state;
    if (t) this.clock.textContent = this.clockText(t);
  }

  render() {
    this.body.replaceChildren();
    const t = this.state;
    const s = this.casino.status;
    if (!t) {
      this.body.append(el("p", "hint", "Pulling up a chair…"));
      return;
    }
    const me = this.tables.selfId;
    const seat = this.tables.mySeat();
    const mine = seat?.table === this.table ? t.seats[seat.seat] : null;
    // The dealer.
    const dealer = el("div", "dealer");
    dealer.append(el("strong", "", "Dealer"), handEl(t.dealer));
    this.body.append(dealer, this.clock);
    this.clock.textContent = this.clockText(t);
    // The seats.
    const seats = el("div", "seats");
    t.seats.forEach((st, i) => {
      const row = el("div", st && t.turn === i && t.phase === "playing" ? "seat turn" : "seat");
      if (!st) {
        row.append(el("span", "seat-name hint", `Seat ${i + 1}`));
        if (!seat && s?.can_play !== false) {
          const b = button("Sit here", () => void this.do(() => this.tables.sit(this.table, i)), "small");
          row.append(b);
        } else row.append(el("span", "hint", "empty"));
      } else {
        row.append(el("span", st.player === me ? "seat-name mine" : "seat-name", st.name));
        row.append(el("span", "seat-bet", st.bet ? `🪙 ${st.bet}${st.doubled ? " (doubled)" : ""}` : t.phase === "betting" ? "betting…" : "sitting out"));
        row.append(handEl(st.hand));
        if (st.result) row.append(el("span", st.result.paid > st.bet ? "seat-result win" : "seat-result", `${OUTCOME[st.result.outcome]}${st.result.paid ? ` +${st.result.paid}` : ""}`));
      }
      seats.append(row);
    });
    this.body.append(seats);
    if (s && !s.can_play) {
      this.body.append(el("p", "hint warn", s.why ?? "You can't play just now."));
      return;
    }
    // Your moves.
    const moves = el("div", "tier-row");
    if (mine && t.phase === "betting" && !mine.bet) {
      const [lo, hi] = s?.limits.blackjack ?? [1, 50];
      for (const a of [1, 5, 10, 25, 50].filter((a) => a >= lo && a <= hi)) {
        moves.append(button(`${a}`, () => ((this.amount = a), this.render()), a === this.amount ? "small on chip" : "small chip"));
      }
      moves.append(button(`Bet ${this.amount}`, () => void this.do(() => this.tables.bet(this.amount)), "primary"));
    } else if (mine && t.phase === "playing" && t.turn === seat!.seat) {
      moves.append(button("Hit", () => void this.do(() => this.tables.act("hit")), "primary"));
      moves.append(button("Stand", () => void this.do(() => this.tables.act("stand")), ""));
      if (mine.hand?.cards.length === 2 && !mine.doubled) moves.append(button(`Double (+${mine.bet})`, () => void this.do(() => this.tables.act("double")), ""));
    }
    if (mine) moves.append(button("Stand up", () => void this.do(() => this.tables.standUp()), "small"));
    if (moves.childElementCount) this.body.append(moves);
    this.body.append(this.msg);
    this.body.append(el("p", "hint", `Dealer stands on 17 · blackjack pays 3:2 · double on your first two cards. ${todayLine(s)}`));
  }

  private async do(f: () => Promise<unknown>) {
    try {
      this.msg.textContent = "";
      await f();
      await this.casino.load().catch(() => {});
    } catch (e) {
      this.msg.textContent = errText(e);
      this.msg.className = "casino-msg";
    }
    if (this.open) this.render();
  }
}

// ---- the cashier's desk --------------------------------------------------------------

export class CagePanel extends Panel {
  private msg = el("p", "error");

  constructor(private casino: Casino) {
    super("🪙 Cashier", "casino cage");
  }

  show() {
    super.show();
    void this.casino
      .load()
      .then(() => this.open && this.render())
      .catch(() => {});
  }

  render() {
    this.body.replaceChildren();
    const s = this.casino.status;
    this.body.append(
      el("p", "", "Welcome to the Casino. It's all for fun: coins only, never real money, and nothing here can be bought or cashed out."),
      el("p", "hint", `Slots: ${s?.limits.slots.join("–") ?? "1–20"} coins a spin, returning about 95%. Roulette (shared, everyone on the same spin): ${s?.limits.roulette.join("–") ?? "1–50"} a bet, returning 97.3%. Blackjack: ${s?.limits.blackjack.join("–") ?? "1–50"} a hand, five seats a table. You can lose ${s?.limits.daily_loss ?? 300} coins a day at most.`),
    );
    if (s) {
      this.body.append(el("h3", "", "Today"), el("p", "", `Bet ${s.today.bet} · won ${s.today.won} · ${s.today.net >= 0 ? "up" : "down"} ${Math.abs(s.today.net)} coins.`));
    }
    this.body.append(el("h3", "", "Take a break"));
    if (s?.break_until) {
      this.body.append(el("p", "", `You're on a break until ${new Date(s.break_until * 1000).toLocaleString([], { weekday: "long", hour: "2-digit", minute: "2-digit" })}. See you then!`));
    } else {
      this.body.append(el("p", "hint", "Close the casino to yourself for a while. It can't be undone early."));
      const row = el("div", "tier-row");
      for (const [days, label] of [
        [1, "For a day"],
        [7, "For a week"],
      ] as const) {
        row.append(
          button(label, () => {
            if (!confirm(`Close the casino to yourself ${label.toLowerCase()}? It can't be undone early.`)) return;
            this.casino
              .takeBreak(days)
              .then(() => this.casino.load())
              .then(() => this.render())
              .catch((e) => (this.msg.textContent = errText(e)));
          }, "small"),
        );
      }
      this.body.append(row);
    }
    this.body.append(this.msg);
  }
}
