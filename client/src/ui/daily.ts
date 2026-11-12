// The day's missions in one place: the three skate quests, the fisherman's
// order and his magnet order, each with how far along it is, and a bar for
// the day as a whole. Each is claimed right here (a skate quest's coins, or
// what he ordered handed in from your bag), no trip to the van or the Pond
// needed. Everything done: a bonus (`DAILY_BONUS` coins, once a day).

import type { Applied, Economy, FishQuest } from "../economy";
import type { DailyQuest } from "../activities/skatequests";
import { Panel, button, el } from "./panels";

interface Order {
  need: number;
  given: number;
  done: boolean;
}

interface DailyState {
  day: number;
  /** Each skate quest paid today (claimed at the van). */
  skate: boolean[];
  fish: Order;
  magnet: Order;
  all_done: boolean;
  bonus: number;
  claimed: boolean;
}

/** One mission's row: what, how far, and what's next. */
interface Row {
  icon: string;
  title: string;
  /** 0–1. */
  part: number;
  shown: string;
  done: boolean;
  /** Done but waiting on something (claiming it at the van). */
  hint?: string;
  /** What can be done about it here: a claim, a hand-in (label, what it does). */
  acts?: [string, () => void][];
}

export class DailyPanel extends Panel {
  private state: DailyState | null = null;
  private msg = el("p", "hint");
  /** Today's skate quests as you've done them (the city's skatepark; none elsewhere). */
  skateQuests: (() => DailyQuest[]) | null = null;
  /** Claims skate quest `slot`'s coins (in the city, where the skatepark is; null elsewhere). */
  claimSkate: ((slot: number) => void) | null = null;
  /** The fisherman's two orders, item by item (for handing in from here). */
  private orders: { fish: FishQuest | null; magnet: FishQuest | null } = { fish: null, magnet: null };
  private busy = false;
  /** Whether everything's done but the bonus not had (for the button's mark). */
  onReady: ((ready: boolean) => void) | null = null;

  constructor(private eco: Economy) {
    super("📋 Daily missions", "daily");
  }

  async openUp() {
    this.show();
    await this.refresh();
  }

  /** Fresh from the server (and the bonus mark on the button with it). */
  async refresh() {
    try {
      this.state = await this.eco.api.get<DailyState>("/api/daily");
      if (this.open) {
        const [fish, magnet] = await Promise.all([this.eco.fishQuest(false).catch(() => null), this.eco.fishQuest(true).catch(() => null)]);
        this.orders = { fish, magnet };
      }
      this.onReady?.(this.state.all_done && !this.state.claimed);
      if (this.open) this.draw();
    } catch (e) {
      if (this.open) this.body.replaceChildren(el("p", "error", e instanceof Error ? e.message : "Couldn't load today's missions."));
    }
  }

  private rows(s: DailyState): Row[] {
    const out: Row[] = [];
    const skate = this.skateQuests?.() ?? [];
    for (let slot = 0; slot < 3; slot++) {
      const q = skate.find((x) => x.slot === slot);
      const paid = !!s.skate[slot];
      out.push({
        icon: "🛹",
        title: q ? `${q.text} (${q.coins} coins)` : `Skate quest ${slot + 1}`,
        part: paid ? 1 : q ? Math.min(1, q.progress / Math.max(1, q.target)) : 0,
        shown: paid ? "Done" : (q?.shown ?? "At the skatepark"),
        done: paid,
        hint: !paid && q?.done && !this.claimSkate ? "Done: claim it back in the city" : undefined,
        acts: !paid && q?.done && this.claimSkate ? [[`🪙 Claim ${q.coins} coins`, () => this.claimSkate?.(slot)]] : undefined,
      });
    }
    const order = (icon: string, title: string, o: Order, q: FishQuest | null, magnet: boolean): Row => {
      // What he still wants that's in your bag: handed in from here, paid as at the Pond.
      const acts: [string, () => void][] = [];
      const wants: string[] = [];
      for (const it of q?.items ?? []) {
        const left = it.need - it.given;
        if (left <= 0) continue;
        const have = this.eco.qty(it.item);
        const name = this.eco.name(it.item);
        wants.push(`${left}× ${name}`);
        if (have > 0) {
          const n = Math.min(left, have);
          acts.push([`📦 Hand in ${n}× ${name} (+${n * it.price} 🪙)`, () => void this.handIn(it.item, n, magnet)]);
        }
      }
      return {
        icon,
        title,
        part: o.need ? Math.min(1, o.given / o.need) : 0,
        shown: o.done ? "Done" : `${o.given} / ${o.need} handed in`,
        done: o.done,
        hint: !o.done && wants.length ? `Still wanted: ${wants.join(", ")}` : undefined,
        acts: o.done ? undefined : acts,
      };
    };
    out.push(order("🎣", "The fisherman's order", s.fish, this.orders.fish, false));
    out.push(order("🧲", "His magnet order", s.magnet, this.orders.magnet, true));
    return out;
  }

  private draw() {
    const s = this.state;
    if (!s) return;
    const rows = this.rows(s);
    const done = rows.filter((r) => r.done).length;
    const all = el("div", "daily-all");
    const bar = el("div", "daily-bar");
    const fill = el("div", "daily-fill");
    fill.style.width = `${Math.round((done / rows.length) * 100)}%`;
    bar.append(fill);
    all.append(el("strong", "", `Today: ${done} of ${rows.length} done`), bar);
    this.body.replaceChildren(el("p", "hint", `Do every mission today for a bonus of ${s.bonus} coins.`), all, this.msg);
    for (const r of rows) {
      const row = el("div", r.done ? "daily-row done" : "daily-row");
      const head = el("div", "daily-head");
      head.append(el("span", "daily-icon", r.done ? "✅" : r.icon), el("span", "daily-title", r.title), el("span", "daily-shown", r.shown));
      const b = el("div", "daily-bar small");
      const f = el("div", "daily-fill");
      f.style.width = `${Math.round(r.part * 100)}%`;
      b.append(f);
      row.append(head, b);
      if (r.hint) row.append(el("div", "hint", r.hint));
      if (r.acts?.length) {
        const acts = el("div", "daily-acts");
        for (const [label, go] of r.acts) {
          const b = button(label, go, "primary small");
          b.disabled = this.busy;
          acts.append(b);
        }
        row.append(acts);
      }
      this.body.append(row);
    }
    if (s.claimed) this.body.append(el("p", "daily-got", `🎉 Bonus collected: +${s.bonus} coins. New missions tomorrow!`));
    else if (s.all_done) this.body.append(button(`🎁 Claim your ${s.bonus} coin bonus`, () => void this.claim(), "primary"));
    else this.body.append(el("p", "hint", "Skate quests are done at the skatepark; fish and magnet finds he wants can be handed in right here."));
  }

  /** Hands `qty` of `item` in for one of his orders, from wherever you are. */
  private async handIn(item: number, qty: number, magnet: boolean) {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.eco.deliverFish(item, qty, magnet);
      this.msg.textContent = `✓ Handed in ${qty}× ${this.eco.name(item)}.`;
    } catch (e) {
      this.msg.textContent = e instanceof Error ? e.message : "That didn't work.";
    } finally {
      this.busy = false;
    }
    await this.refresh();
  }

  private async claim() {
    try {
      const r = await this.eco.api.send<{ applied: Applied }>("/api/daily/bonus", {});
      this.eco.applyResult(r.applied);
      this.msg.textContent = "";
    } catch (e) {
      this.msg.textContent = e instanceof Error ? e.message : "That didn't work.";
    }
    await this.refresh();
  }
}
