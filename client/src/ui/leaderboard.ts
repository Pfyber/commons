// The town's leaderboards (opened from any of the leaderboard signs): a tab
// for each, the richest, the arena's and the Splat Yard's winners and the
// anglers; the top hundred on each, and where you stand.

import type { Auth } from "../net/api";
import { Panel, button, el } from "./panels";

export type BoardKey = "coins" | "arena" | "fish" | "paintball";
export interface Entry {
  rank: number;
  name: string;
  value: number;
}
export interface Board {
  top: Entry[];
  me: { rank: number; value: number } | null;
}
export type Boards = Record<BoardKey, Board>;

const TABS: { key: BoardKey; icon: string; name: string; unit: (n: number) => string }[] = [
  { key: "coins", icon: "💰", name: "Richest", unit: (n) => `${n.toLocaleString()} coins` },
  { key: "arena", icon: "⚔️", name: "Arena", unit: (n) => `${n} ${n === 1 ? "win" : "wins"}` },
  { key: "fish", icon: "🎣", name: "Anglers", unit: (n) => `${n} fish` },
  { key: "paintball", icon: "🎨", name: "Paintball", unit: (n) => `${n} ${n === 1 ? "win" : "wins"}` },
];

export class LeaderboardPanel extends Panel {
  data: Boards | null = null;
  private tab: BoardKey = "coins";
  private loadedAt = 0;

  constructor(private auth: Auth) {
    super("🏆 Leaderboards", "leaderboards");
  }

  /** Fresh rankings (at most every `maxAgeMs`). */
  async load(maxAgeMs = 0): Promise<void> {
    if (this.data && performance.now() - this.loadedAt < maxAgeMs) return;
    this.loadedAt = performance.now();
    this.data = await this.auth.get<Boards>("/api/leaderboards");
    if (this.open) this.render();
  }

  /** Opens on board `key`. */
  openOn(key: BoardKey) {
    this.tab = key;
    this.show();
    void this.load(15_000).catch(() => {});
  }

  render() {
    this.body.replaceChildren();
    const tabs = el("div", "tier-row lb-tabs");
    for (const t of TABS) tabs.append(button(`${t.icon} ${t.name}`, () => ((this.tab = t.key), this.render()), t.key === this.tab ? "small on" : "small"));
    this.body.append(tabs);
    const t = TABS.find((x) => x.key === this.tab)!;
    const b = this.data?.[this.tab];
    if (!b) {
      this.body.append(el("p", "hint", "Fetching the rankings…"));
      return;
    }
    this.body.append(el("p", "hint lb-me", b.me ? `You: #${b.me.rank} · ${t.unit(b.me.value)}` : "You're not on this board yet."));
    if (!b.top.length) {
      this.body.append(el("p", "hint", "No one's on it yet: be the first!"));
      return;
    }
    const list = el("div", "rows lb-rows");
    for (const e of b.top) {
      const medal = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : `${e.rank}.`;
      const mine = !!b.me && b.me.rank === e.rank && b.me.value === e.value;
      const row = el("div", `row lb-row${mine ? " mine" : ""}`);
      row.append(el("span", "lb-rank", medal), el("span", "name", e.name), el("span", "price", t.unit(e.value)));
      list.append(row);
    }
    this.body.append(list);
  }
}
