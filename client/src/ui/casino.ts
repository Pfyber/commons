// The Casino, K1 (ADR 0017): a slot machine (three reels that spin and stop
// one by one), the roulette table (a single-zero wheel that spins and lands)
// and the cashier's desk (the rules, the limits, today's play, taking a
// break). Coins only, never real money; every outcome comes from the server.

import type { Auth } from "../net/api";
import { ApiError } from "../net/api";
import { Panel, button, el } from "./panels";

export interface CasinoStatus {
  can_play: boolean;
  why: string | null;
  today: { bet: number; won: number; net: number; loss_left: number };
  limits: { slots: [number, number]; roulette: [number, number]; daily_loss: number };
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

  async roulette(bet: RouletteBet, amount: number): Promise<{ outcome: { number: number; red: boolean }; payout: number }> {
    const r = await this.auth.send<{ outcome: { number: number; red: boolean }; payout: number }>("/api/social/casino/roulette", { bet, amount, key: key() });
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

// ---- roulette ---------------------------------------------------------------------

/** The pockets round a European wheel, in order. */
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export class RoulettePanel extends Panel {
  private amount = 10;
  private bet: RouletteBet = { on: "red" };
  private angle = 0;
  private canvas = el("canvas", "wheel");
  private spinning = false;
  private msg = el("p", "casino-msg");
  private foot = el("p", "hint");
  private landed: number | null = null;

  constructor(private casino: Casino) {
    super("🎡 Roulette", "casino roulette");
    this.canvas.width = 170;
    this.canvas.height = 170;
  }

  show() {
    super.show();
    void this.casino
      .load()
      .then(() => this.open && this.render())
      .catch(() => {});
  }

  private betName(b: RouletteBet): string {
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

  render() {
    this.body.replaceChildren();
    const s = this.casino.status;
    this.draw();
    this.body.append(this.canvas);
    if (s && !s.can_play) {
      this.body.append(el("p", "hint warn", s.why ?? "You can't play just now."));
      return;
    }
    const pick = (b: RouletteBet) => {
      this.bet = b;
      this.render();
    };
    const same = (b: RouletteBet) => JSON.stringify(b) === JSON.stringify(this.bet);
    const row1 = el("div", "tier-row");
    for (const b of [{ on: "red" }, { on: "black" }, { on: "odd" }, { on: "even" }, { on: "low" }, { on: "high" }] as RouletteBet[]) {
      const btn = button(this.betName(b), () => pick(b), same(b) ? "small on" : "small");
      if (b.on === "red") btn.classList.add("red");
      if (b.on === "black") btn.classList.add("black");
      row1.append(btn);
    }
    const row2 = el("div", "tier-row");
    for (const n of [1, 2, 3]) {
      const b: RouletteBet = { on: "dozen", n };
      row2.append(button(this.betName(b), () => pick(b), same(b) ? "small on" : "small"));
    }
    const num = el("input");
    num.type = "number";
    num.min = "0";
    num.max = "36";
    num.placeholder = "0–36";
    num.value = this.bet.on === "number" ? String(this.bet.n) : "";
    num.onkeydown = (e) => e.stopPropagation();
    num.onchange = () => {
      const n = Math.max(0, Math.min(36, Number(num.value) | 0));
      pick({ on: "number", n });
    };
    row2.append(el("span", "hint", "or one number:"), num);
    const [lo, hi] = s?.limits.roulette ?? [1, 50];
    const chips = el("div", "tier-row");
    for (const a of [1, 5, 10, 25, 50].filter((a) => a >= lo && a <= hi)) {
      chips.append(button(`${a}`, () => ((this.amount = a), this.render()), a === this.amount ? "small on chip" : "small chip"));
    }
    const pays = this.bet.on === "number" ? "35:1" : this.bet.on === "dozen" ? "2:1" : "1:1";
    const spin = button(`Spin: ${this.amount} on ${this.betName(this.bet)} (pays ${pays})`, () => void this.spin(spin), "primary");
    this.body.append(el("p", "hint", "Bet on:"), row1, row2, el("p", "hint", "Coins:"), chips, spin, this.msg);
    this.foot.textContent = `${todayLine(s)} · One zero: every bet returns 97.3%.`;
    this.body.append(this.foot);
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

  private async spin(btn: HTMLButtonElement) {
    if (this.spinning) return;
    this.spinning = true;
    btn.disabled = true;
    this.msg.textContent = "";
    this.landed = null;
    try {
      const res = await this.casino.roulette(this.bet, this.amount);
      const n = res.outcome.number;
      // Turn the wheel so pocket n ends under the ball: a few turns, slowing down.
      const step = (Math.PI * 2) / WHEEL.length;
      const target = -WHEEL.indexOf(n) * step;
      const start = this.angle;
      const turns = Math.PI * 2 * 4;
      // The same place as `target`, at least four turns on from where it is.
      let end = target;
      while (end > start - turns) end -= Math.PI * 2;
      const t0 = performance.now();
      const dur = 2600;
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
      const colour = n === 0 ? "green" : res.outcome.red ? "red" : "black";
      this.msg.textContent = res.payout > 0 ? `${n} ${colour}! ✨ You win ${res.payout} coins.` : `${n} ${colour}. Not this time.`;
      this.msg.className = res.payout > 0 ? "casino-msg win" : "casino-msg";
      await this.casino.load().catch(() => {});
      this.foot.textContent = `${todayLine(this.casino.status)} · One zero: every bet returns 97.3%.`;
    } catch (e) {
      this.msg.textContent = errText(e);
      this.msg.className = "casino-msg";
    } finally {
      this.spinning = false;
      btn.disabled = false;
    }
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
      el("p", "hint", `Slots: ${s?.limits.slots.join("–") ?? "1–20"} coins a spin, returning about 95%. Roulette: ${s?.limits.roulette.join("–") ?? "1–50"} a bet, returning 97.3%. You can lose ${s?.limits.daily_loss ?? 300} coins a day at most.`),
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
