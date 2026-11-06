// The Casino's newer games: the big machine (five reels four high, twenty
// symbols; enough of one anywhere pays) and the horse races (back one of six
// to win). Like the rest, every outcome comes from the server; these only
// show it happening.

import * as cs from "../ambient/casinosfx";
import { type Casino, type RaceState, type Tables, errText, todayLine } from "./casino";
import { Panel, button, el } from "./panels";

const MEGA_ICONS: Record<string, string> = { cherry: "🍒", lemon: "🍋", grape: "🍇", bell: "🔔", star: "⭐", gem: "💎", seven: "7️⃣" };
const COLS = 5;
const ROWS = 4;
const CELL = 54;

interface Reel {
  strip: string[];
  offset: number;
  from: number;
  to: number;
  start: number;
  dur: number;
  done: boolean;
}

// ---- the big machine ------------------------------------------------------------------

export class MegaSlotsPanel extends Panel {
  private bet = 5;
  private canvas = el("canvas", "mega-reels");
  private msg = el("p", "casino-msg");
  private foot = el("p", "hint");
  private spinning = false;
  private reels: Reel[] = [];
  /** Which symbols paid (shown glowing), and when the win was shown. */
  private paid = new Set<string>();
  private wonAt = 0;
  private raf = 0;

  constructor(private casino: Casino) {
    super("🎰 Big Machine", "casino mega");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = COLS * CELL * dpr;
    this.canvas.height = ROWS * CELL * dpr;
    this.canvas.style.width = `${COLS * CELL}px`;
    this.canvas.style.height = `${ROWS * CELL}px`;
    const syms = Object.keys(MEGA_ICONS);
    this.reels = Array.from({ length: COLS }, () => {
      const strip = Array.from({ length: ROWS }, () => syms[(Math.random() * syms.length) | 0]);
      return { strip, offset: 0, from: 0, to: 0, start: 0, dur: 0, done: true };
    });
  }

  show() {
    super.show();
    void this.casino
      .load()
      .then(() => this.open && this.render())
      .catch(() => {});
  }

  hide() {
    super.hide();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  render() {
    this.body.replaceChildren();
    const s = this.casino.status;
    const frame = el("div", "mega-frame");
    frame.append(this.canvas);
    this.body.append(frame);
    this.draw(performance.now());
    if (s && !s.can_play) {
      this.body.append(el("p", "hint warn", s.why ?? "You can't play just now."));
      return;
    }
    const [lo, hi] = s?.limits.mega ?? [1, 20];
    const bets = el("div", "tier-row");
    for (const b of [1, 2, 5, 10, 20].filter((b) => b >= lo && b <= hi)) {
      bets.append(button(`${b}`, () => ((this.bet = b), this.render()), b === this.bet ? "small on" : "small"));
    }
    const spin = button(`Spin (${this.bet} coins)`, () => void this.spin(spin), "primary");
    spin.disabled = this.spinning;
    this.body.append(el("p", "hint", "Bet:"), bets, spin, this.msg);
    if (s?.mega) {
      const m = s.mega;
      const card = m.symbols
        .map((sym, i) => `${MEGA_ICONS[sym]} ${m.min[i]}+ pays ${m.pays[i][0] / 10}× · ${m.min[i] + 2}+ ${m.pays[i][1] / 10}× · ${m.min[i] + 4}+ ${m.pays[i][2] / 10}×`)
        .join("<br>");
      const p = el("p", "hint pay-card");
      p.innerHTML = `Enough of one symbol anywhere on the twenty pays:<br>${card}<br>Returns about 95% of what's bet.`;
      this.body.append(p);
    }
    this.foot.textContent = todayLine(s);
    this.body.append(this.foot);
  }

  private async spin(btn: HTMLButtonElement) {
    if (this.spinning) return;
    this.spinning = true;
    btn.disabled = true;
    this.paid.clear();
    this.msg.textContent = "";
    this.msg.className = "casino-msg";
    cs.pull();
    try {
      const res = await this.casino.mega(this.bet);
      const cells = res.outcome.cells;
      const syms = Object.keys(MEGA_ICONS);
      const now = performance.now();
      // Each reel: what's showing, a long run of others, and its four at the end.
      this.reels = this.reels.map((r, c) => {
        const showing = r.strip.slice(Math.round(r.offset), Math.round(r.offset) + ROWS);
        const run = Array.from({ length: 26 + c * 6 }, () => syms[(Math.random() * syms.length) | 0]);
        const end = Array.from({ length: ROWS }, (_, row) => cells[row * COLS + c]);
        const strip = [...showing, ...run, ...end];
        return { strip, offset: 0, from: 0, to: strip.length - ROWS, start: now, dur: 1100 + c * 330, done: false };
      });
      await this.animate();
      // What paid: every symbol with enough of it.
      const m = this.casino.status?.mega;
      if (m) {
        m.symbols.forEach((sym, i) => {
          if (cells.filter((x) => x === sym).length >= m.min[i]) this.paid.add(sym);
        });
      }
      this.wonAt = performance.now();
      if (res.payout > 0) {
        const mult = res.payout / this.bet;
        this.msg.textContent = mult >= 10 ? `🎉 BIG WIN! ${res.payout} coins!` : `✨ You win ${res.payout} coins!`;
        this.msg.className = mult >= 10 ? "casino-msg win big" : "casino-msg win";
        cs.win(mult);
        void this.glow();
      } else {
        cs.lose(0.7);
        this.msg.textContent = "No luck this time.";
      }
      await this.casino.load().catch(() => {});
      this.foot.textContent = todayLine(this.casino.status);
    } catch (e) {
      this.msg.textContent = errText(e);
    } finally {
      this.spinning = false;
      btn.disabled = false;
    }
  }

  /** The reels run, and stop one by one (a little bounce as each lands). */
  private animate(): Promise<void> {
    let lastTick = 0;
    return new Promise((done) => {
      const frame = (now: number) => {
        let moving = 0;
        this.reels.forEach((r, c) => {
          if (r.done) return;
          const t = Math.min(1, (now - r.start) / r.dur);
          // Fast, then easing in with a small overshoot (back-out).
          const k = 1.6;
          const e = 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2;
          r.offset = r.from + (r.to - r.from) * e;
          if (t >= 1) {
            r.offset = r.to;
            r.done = true;
            cs.reelStop(c);
          } else moving++;
        });
        if (moving && now - lastTick > 55) {
          lastTick = now;
          cs.reelTick(0.6 + moving * 0.1);
        }
        this.draw(now);
        if (moving) this.raf = requestAnimationFrame(frame);
        else done();
      };
      this.raf = requestAnimationFrame(frame);
    });
  }

  /** The winning symbols pulse a couple of seconds. */
  private glow(): Promise<void> {
    return new Promise((done) => {
      const frame = (now: number) => {
        this.draw(now);
        if (now - this.wonAt < 2400 && this.open) this.raf = requestAnimationFrame(frame);
        else {
          this.draw(now);
          done();
        }
      };
      this.raf = requestAnimationFrame(frame);
    });
  }

  private draw(now: number) {
    const c = this.canvas;
    const ctx = c.getContext("2d")!;
    const s = c.width / (COLS * CELL);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const W = COLS * CELL;
    const H = ROWS * CELL;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#f7ecd0");
    bg.addColorStop(0.5, "#fffaf0");
    bg.addColorStop(1, "#ecdcb4");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const pulse = 0.5 + 0.5 * Math.sin((now - this.wonAt) / 120);
    const showWin = this.paid.size > 0 && !this.spinning;
    this.reels.forEach((r, col) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(col * CELL, 0, CELL, H);
      ctx.clip();
      const first = Math.floor(r.offset);
      // (Moving fast: smeared.)
      const speed = r.done ? 0 : 1;
      for (let j = first; j <= first + ROWS; j++) {
        const sym = r.strip[j];
        if (!sym) continue;
        const y = (j - r.offset) * CELL;
        const cx = col * CELL + CELL / 2;
        const cy = y + CELL / 2;
        const win = showWin && this.paid.has(sym);
        if (win) {
          ctx.fillStyle = `rgba(255, 210, 63, ${0.35 + 0.4 * pulse})`;
          ctx.fillRect(col * CELL + 3, y + 3, CELL - 6, CELL - 6);
        }
        ctx.globalAlpha = showWin && !win ? 0.35 : 1;
        ctx.font = `${win ? 32 + pulse * 4 : 32}px serif`;
        if (speed) {
          ctx.globalAlpha = 0.35;
          ctx.fillText(MEGA_ICONS[sym], cx, cy - 8);
          ctx.fillText(MEGA_ICONS[sym], cx, cy + 8);
          ctx.globalAlpha = 0.8;
        }
        ctx.fillText(MEGA_ICONS[sym], cx, cy + 2);
        ctx.globalAlpha = 1;
      }
      // The reel's curve: shaded top and bottom.
      const shade = ctx.createLinearGradient(0, 0, 0, H);
      shade.addColorStop(0, "rgba(60,40,10,0.35)");
      shade.addColorStop(0.18, "rgba(60,40,10,0)");
      shade.addColorStop(0.82, "rgba(60,40,10,0)");
      shade.addColorStop(1, "rgba(60,40,10,0.35)");
      ctx.fillStyle = shade;
      ctx.fillRect(col * CELL, 0, CELL, H);
      ctx.restore();
      if (col) {
        ctx.fillStyle = "#3b3a2e";
        ctx.fillRect(col * CELL - 1, 0, 2, H);
      }
    });
    ctx.textBaseline = "alphabetic";
  }
}

// ---- the horse races --------------------------------------------------------------------

const SILKS = ["#c8553d", "#4f86d8", "#f2c94c", "#5fb36b", "#b06fd8", "#ef8bb5"];
const COATS = ["#5a3418", "#2b2320", "#8a5a33", "#b0a090", "#6b3a1c", "#c79a5a"];
const TRACK_W = 320;
const TRACK_H = 200;
const START_X = 26;
const FINISH_X = TRACK_W - 34;

/**
 * The horse races: one race for the whole floor, on a loop. You back a horse
 * while betting's open, and everyone watches the same race together; open
 * this halfway through one and you're halfway through it too.
 */
export class RacePanel extends Panel {
  private bet = 5;
  private horse = 0;
  private canvas = el("canvas", "race-track");
  private msg = el("p", "casino-msg");
  private call = el("p", "race-call");
  private clock = el("p", "table-clock");
  private foot = el("p", "hint");
  /** The race on screen, from the server. */
  private run: { finish: number[]; stride: number[]; starts: number; ends: number; order: number[] } | null = null;
  private raf = 0;
  private off: (() => void) | null = null;
  private timer = 0;
  /** The race whose result has been told. */
  private told = 0;
  private leader = -1;
  private roared = false;
  private lastHoof = 0;

  constructor(
    private casino: Casino,
    private tables: Tables,
  ) {
    super("🏇 Horse Races", "casino races");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = TRACK_W * dpr;
    this.canvas.height = TRACK_H * dpr;
    this.canvas.style.width = `${TRACK_W}px`;
    this.canvas.style.height = `${TRACK_H}px`;
  }

  show() {
    super.show();
    this.off ??= this.tables.onChange(() => this.open && this.update());
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 250);
    void Promise.all([this.casino.load(), this.tables.load()])
      .then(() => this.open && this.update())
      .catch(() => {});
  }

  hide() {
    super.hide();
    this.off?.();
    this.off = null;
    window.clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private get state(): RaceState | null {
    return this.tables.floor?.races ?? null;
  }

  /** What we've got on this race, by horse. */
  private mine(): Map<number, number> {
    const out = new Map<number, number>();
    for (const c of this.state?.slips ?? []) if (c.player === this.tables.selfId) out.set(c.horse, (out.get(c.horse) ?? 0) + c.amount);
    return out;
  }

  /** News from the floor: the off, or the result. */
  private update() {
    const r = this.state;
    if (r?.phase === "running" && r.starts && r.finish && r.stride && r.order && r.ends && this.run?.starts !== r.starts) {
      this.run = { finish: r.finish, stride: r.stride, starts: r.starts, ends: r.ends, order: r.order };
      this.leader = -1;
      this.roared = false;
      this.msg.textContent = "";
      this.msg.className = "casino-msg";
      // (Only if we were here for the off.)
      if (this.tables.now() - r.starts < 1000) cs.raceBell();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
    if (r?.phase === "betting" && this.run && this.told !== this.run.starts) this.result(r);
    this.render();
  }

  /** The race is run: how it went, for us. */
  private result(r: RaceState) {
    const run = this.run!;
    this.told = run.starts;
    const names = this.casino.status?.horses?.names ?? [];
    const o = r.last?.order ?? run.order;
    this.call.textContent = `🏁 ${names[o[0]] ?? "?"} wins! Then ${names[o[1]] ?? "?"}, ${names[o[2]] ?? "?"}.`;
    const staked = this.staked;
    const on = staked.get(o[0]);
    const won = on ? Math.floor((on * (this.casino.status?.horses?.pays[o[0]] ?? 0)) / 10) : 0;
    if (won) {
      this.msg.textContent = `✨ ${names[o[0]]} came in first! You win ${won} coins.`;
      this.msg.className = "casino-msg win";
      cs.win(won / on!);
    } else if (staked.size) {
      const h = [...staked.keys()].sort((a, b) => o.indexOf(a) - o.indexOf(b))[0];
      this.msg.textContent = `${names[h]} came in ${ordinal(o.indexOf(h) + 1)}. Not this time.`;
      cs.lose(0.7);
    }
    this.staked = new Map();
    void this.casino.load().then(() => this.open && this.render()).catch(() => {});
  }

  /** What we had on the race being run, by horse. */
  private staked = new Map<number, number>();

  private frame(now: number) {
    const r = this.run;
    if (!r || !this.open) return;
    const ms = this.tables.now() - r.starts;
    this.draw(ms);
    const names = this.casino.status?.horses?.names ?? [];
    const mine = this.mine();
    if (mine.size) this.staked = mine;
    if (now - this.lastHoof > 230) {
      this.lastHoof = now;
      cs.hooves(ms < Math.max(...r.finish) ? 0.9 : 0.3);
    }
    // Who's in front (called when it changes).
    const front = [...r.finish.keys()].sort((a, b) => this.progress(b, ms) - this.progress(a, ms))[0];
    if (front !== this.leader && ms < r.finish[r.order[0]]) {
      this.leader = front;
      this.call.textContent = `${names[front] ?? "?"} ${ms < 800 ? "breaks in front!" : "takes the lead!"}${mine.has(front) ? " (That's yours!)" : ""}`;
    }
    if (!this.roared && ms > r.finish[r.order[0]] - 1500 && ms < r.finish[r.order[0]]) {
      this.roared = true;
      cs.crowd(2.2);
    }
    if (ms < r.ends - r.starts) this.raf = requestAnimationFrame((t) => this.frame(t));
    else this.raf = 0;
  }

  /** Four times a second: the clock. */
  private tick() {
    const r = this.state;
    if (r?.phase === "betting" && r.closes) {
      const left = Math.max(0, Math.ceil((r.closes - this.tables.now()) / 1000));
      this.clock.textContent = `Next race in ${left}s`;
    } else if (r) this.clock.textContent = "They're off! No more bets.";
  }

  render() {
    this.body.replaceChildren();
    const s = this.casino.status;
    const r = this.state;
    this.tick();
    this.body.append(this.canvas, this.call, this.clock);
    if (!this.raf) this.draw(this.run ? this.tables.now() - this.run.starts : 0);
    if (s && !s.can_play) {
      this.body.append(el("p", "hint warn", s.why ?? "You can't play just now."));
      return;
    }
    const open = r?.phase === "betting";
    const mine = this.mine();
    const crowd = new Map<number, number>();
    for (const c of r?.slips ?? []) crowd.set(c.horse, (crowd.get(c.horse) ?? 0) + c.amount);
    const h = s?.horses;
    if (h) {
      const list = el("div", "race-horses");
      h.names.forEach((name, i) => {
        const b = button("", () => ((this.horse = i), this.render()), i === this.horse ? "small on" : "small");
        const on = mine.get(i);
        b.innerHTML = `<span class="silk" style="background:${SILKS[i]}"></span>${i + 1}. ${name} <small>pays ${h.pays[i] / 10}×${on ? ` · you: ${on}` : ""}${crowd.get(i) ? ` · 🪙${crowd.get(i)}` : ""}</small>`;
        b.disabled = !open;
        list.append(b);
      });
      this.body.append(el("p", "hint", "Back a horse to win:"), list);
    }
    const [lo, hi] = s?.limits.race ?? [1, 30];
    const bets = el("div", "tier-row");
    for (const b of [1, 2, 5, 10, 20, 30].filter((b) => b >= lo && b <= hi)) {
      bets.append(button(`${b}`, () => ((this.bet = b), this.render()), b === this.bet ? "small on" : "small"));
    }
    const name = h?.names[this.horse] ?? "your horse";
    const go = button(`Bet ${this.bet} coins on ${name}`, () => void this.place(go), "primary");
    go.disabled = !open;
    this.body.append(el("p", "hint", "Bet:"), bets, go, this.msg);
    this.foot.textContent = todayLine(s);
    this.body.append(this.foot);
  }

  private async place(btn: HTMLButtonElement) {
    btn.disabled = true;
    try {
      await this.tables.raceBet(this.bet, this.horse);
      this.msg.textContent = "";
      this.msg.className = "casino-msg";
      await this.casino.load().catch(() => {});
    } catch (e) {
      this.msg.textContent = errText(e);
    }
    if (this.open) this.render();
  }

  /** How far horse `i` is (0 at the start, 1 at the line) `ms` into the race. */
  private progress(i: number, ms: number): number {
    const r = this.run;
    if (!r) return 0;
    const T = r.finish[i];
    const u = Math.max(0, Math.min(ms / T, 1.15));
    if (u >= 1) return 1 + (u - 1) * 0.6;
    // A steady pace with surges and fades, pinned to the start and the line.
    return u + 0.055 * Math.sin(u * Math.PI * 2.3 + r.stride[i]) * u * (1 - u) * 4;
  }

  private draw(ms: number) {
    const c = this.canvas;
    const ctx = c.getContext("2d")!;
    const s = c.width / TRACK_W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    // The grass, the dirt track in lanes, the rails, the start and the line.
    ctx.fillStyle = "#4f8a3a";
    ctx.fillRect(0, 0, TRACK_W, TRACK_H);
    ctx.fillStyle = "#3f7a2e";
    for (let y = 0; y < 22; y += 4) ctx.fillRect(0, y, TRACK_W, 2);
    const lane = (TRACK_H - 34) / 6;
    const top = 24;
    ctx.fillStyle = "#b9864f";
    ctx.fillRect(0, top, TRACK_W, lane * 6);
    for (let i = 0; i <= 6; i++) {
      ctx.fillStyle = i === 0 || i === 6 ? "#fff8e3" : "rgba(255,248,227,0.25)";
      ctx.fillRect(0, top + i * lane - (i === 0 || i === 6 ? 1 : 0), TRACK_W, i === 0 || i === 6 ? 2 : 1);
    }
    // (Dirt kicked into the track: specks.)
    ctx.fillStyle = "rgba(90,52,24,0.35)";
    for (let k = 0; k < 60; k++) ctx.fillRect((k * 97) % TRACK_W, top + ((k * 53) % (lane * 6)), 2, 1);
    ctx.fillStyle = "#fff8e3";
    ctx.fillRect(START_X, top, 2, lane * 6);
    for (let y = 0; y < lane * 6; y += 4) {
      ctx.fillStyle = (y / 4) % 2 ? "#1b1816" : "#fff8e3";
      ctx.fillRect(FINISH_X, top + y, 4, 4);
    }
    // The stand behind: the crowd in dots.
    for (let k = 0; k < 70; k++) {
      ctx.fillStyle = SILKS[k % 6];
      ctx.fillRect(4 + k * 4.5, 6 + ((k * 7) % 3) * 4, 3, 3);
    }
    // The horses, back to front.
    const run = this.run;
    const backed = this.mine();
    for (let i = 0; i < 6; i++) {
      const p = run ? this.progress(i, ms) : 0;
      const x = START_X - 18 + p * (FINISH_X - START_X);
      const y = top + i * lane + lane * 0.62;
      const moving = run !== null && ms > 0 && p < 1.14;
      horseArt(ctx, x, y, i, moving ? ms / 70 + i : 0, backed.has(i) || (!run && i === this.horse));
    }
  }
}

/** A little horse and jockey facing right, feet at (x, y); `gait` turns the legs. */
function horseArt(ctx: CanvasRenderingContext2D, x: number, y: number, i: number, gait: number, mine: boolean) {
  const coat = COATS[i];
  const bob = Math.sin(gait * 2) * 1.2;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(x + 10, y + 1, 12, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Legs: front and back pairs swinging opposite.
  ctx.strokeStyle = coat;
  ctx.lineWidth = 2;
  for (const [lx, ph] of [[3, 0], [6, Math.PI], [15, Math.PI * 0.5], [18, Math.PI * 1.5]] as [number, number][]) {
    const sw = Math.sin(gait + ph) * 4;
    ctx.beginPath();
    ctx.moveTo(x + lx, y - 8 + bob);
    ctx.lineTo(x + lx + sw, y);
    ctx.stroke();
  }
  // Body, neck and head, tail.
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.ellipse(x + 10, y - 10 + bob, 10, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + 16, y - 12 + bob);
  ctx.lineTo(x + 22, y - 19 + bob);
  ctx.lineTo(x + 25, y - 17 + bob);
  ctx.lineTo(x + 19, y - 9 + bob);
  ctx.fill();
  ctx.fillRect(x + 22, y - 20 + bob, 6, 4);
  ctx.strokeStyle = "#1b1816";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 11 + bob);
  ctx.lineTo(x - 5, y - 7 + bob + Math.sin(gait) * 2);
  ctx.stroke();
  // The jockey: silks and cap in the horse's colours, the saddle cloth's number.
  ctx.fillStyle = SILKS[i];
  ctx.fillRect(x + 8, y - 21 + bob, 6, 7);
  ctx.beginPath();
  ctx.arc(x + 13, y - 23 + bob, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff8e3";
  ctx.fillRect(x + 6, y - 12 + bob, 6, 5);
  ctx.fillStyle = "#1b1816";
  ctx.font = "bold 5px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(String(i + 1), x + 9, y - 8 + bob);
  if (mine) {
    ctx.fillStyle = "#ffe14f";
    ctx.beginPath();
    ctx.moveTo(x + 11, y - 34 + bob);
    ctx.lineTo(x + 7, y - 39 + bob);
    ctx.lineTo(x + 15, y - 39 + bob);
    ctx.fill();
  }
}

function ordinal(n: number): string {
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}
