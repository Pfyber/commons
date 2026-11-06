// The spectators' bets: while a round's getting ready and for its first few
// seconds, anyone watching can put 10 coins on a fighter (or, in the Goliath's
// and the teams' matches, on a side). The server holds the book: this shows
// what's on offer and how it went.

import { button, el } from "../ui/panels";

/** The ArenaState this needs. */
export interface BetState {
  round: number;
  mode: number;
  slots: number[];
  goliath: number;
  betMs: number;
  bets: number[];
  betPay: number;
}

export interface BetHost {
  bet(pick: number): void;
  /** A fighter's name, by place, and their colour. */
  name(slot: number): string;
  css(slot: number): string;
}

export const BET_STAKE = 10;
const STAKE = BET_STAKE;
const GOLIATH = 1;
const TEAMS = 2;

let allowed = true;

/** Off for under-18s, as the casino is. */
export function setBetting(on: boolean) {
  allowed = on;
}

export class BetPanel {
  private box = el("div", "ar-bet");
  private key = "";
  /** What we're on this round: its name, what it pays. */
  private mine: { label: string; css: string; pays: number; pick: number } | null = null;
  /** Clicked, not yet confirmed. */
  private asked = -1;
  private round = -1;

  constructor(private host: BetHost) {
    this.box.hidden = true;
    document.body.append(this.box);
  }

  /** What there is to bet on: (pick, name, who's in it, colour). */
  private sides(s: BetState): { pick: number; name: string; sub: string; css: string }[] {
    const { host } = this;
    if (s.mode === GOLIATH) {
      const men = s.slots.map((id, k) => (id !== 0 && k !== s.goliath ? host.name(k) : "")).filter(Boolean);
      return [
        { pick: 0, name: "⚔️ Gladiators", sub: men.join(", "), css: "#ffd23f" },
        { pick: 1, name: "👹 The Goliath", sub: host.name(s.goliath), css: "#ff5a2a" },
      ];
    }
    if (s.mode === TEAMS) {
      const of = (a: number, b: number) => [a, b].filter((k) => s.slots[k] !== 0).map((k) => host.name(k)).join(" & ");
      return [
        { pick: 0, name: "🔵 Blue team", sub: of(0, 1), css: host.css(0) },
        { pick: 1, name: "🔴 Red team", sub: of(2, 3), css: host.css(2) },
      ];
    }
    return s.slots.flatMap((id, k) => (id !== 0 ? [{ pick: k, name: host.name(k), sub: "", css: host.css(k) }] : []));
  }

  /** Every frame. `can`: we're watching, and not fighting. */
  update(s: BetState | null, can: boolean) {
    if (!s) {
      this.box.hidden = true;
      return;
    }
    if (s.round !== this.round) {
      this.round = s.round;
      this.mine = null;
      this.asked = -1;
    }
    const open = can && allowed && s.betMs > 0;
    if (!open && !this.mine) {
      this.box.hidden = true;
      this.key = "";
      return;
    }
    this.box.hidden = false;
    const left = Math.ceil(s.betMs / 1000);
    if (this.mine) {
      const m = this.mine;
      const key = `on|${m.label}|${m.pays}`;
      if (key !== this.key) {
        this.key = key;
        this.box.className = "ar-bet placed";
        this.box.replaceChildren(el("div", "ar-bet-head", `🪙 ${STAKE} on`), Object.assign(el("div", "ar-bet-pick", m.label), { style: `color:${m.css}` }), el("div", "ar-bet-pays", `pays ${m.pays} coins`));
      }
      return;
    }
    const sides = this.sides(s);
    const key = `open|${s.bets.join()}|${sides.map((q) => q.name + q.sub).join()}|${this.asked}|${s.betPay}`;
    if (key !== this.key) {
      this.key = key;
      this.box.className = "ar-bet";
      const head = el("div", "ar-bet-head");
      head.append(el("span", "", `🪙 Bet ${STAKE} coins`), el("span", "ar-bet-time", `${left}s`));
      const rows = sides.map((q) => {
        const b = button("", () => {
          if (this.asked >= 0) return;
          this.asked = q.pick;
          this.key = "";
          this.host.bet(q.pick);
        }, "ar-bet-btn");
        b.style.setProperty("--c", q.css);
        b.disabled = this.asked >= 0;
        const name = el("span", "ar-bet-name", q.name);
        const n = s.bets[q.pick] ?? 0;
        b.append(el("span", "ar-bet-dot"), name, ...(q.sub ? [el("small", "ar-bet-sub", q.sub)] : []), el("span", "ar-bet-odds", `${s.betPay}${n ? ` · ${n}🪙` : ""}`));
        return b;
      });
      this.box.replaceChildren(head, ...rows);
    }
    const t = this.box.querySelector(".ar-bet-time");
    if (t && t.textContent !== `${left}s`) {
      t.textContent = `${left}s`;
      t.classList.toggle("soon", left <= 3);
    }
  }

  /** The server took it. */
  placed(s: BetState | null, pick: number, pays: number) {
    const side = s && this.sides(s).find((q) => q.pick === pick);
    this.mine = { label: side?.name ?? "your pick", css: side?.css ?? "#ffd23f", pays, pick };
    this.asked = -1;
    this.key = "";
  }

  /** It's out of our hands (not taken, say). */
  refused() {
    this.asked = -1;
    this.key = "";
  }

  /** Over for the round. */
  settled() {
    this.mine = null;
    this.key = "";
  }

  destroy() {
    this.box.remove();
  }
}
