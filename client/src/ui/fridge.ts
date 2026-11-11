// The mini fridge: fish keep in it. Out in your bag a fish keeps a week,
// then it's gone off (a Rotten Fish, 2 coins); in the fridge it never does,
// and taken out it has a fresh week from then. Up to 50 fish a fridge.

import type { Applied, Economy } from "../economy";
import { Panel, button, el, icon } from "./panels";

interface FridgeState {
  fish: { item: number; qty: number }[];
  room: number;
  /** When each of your bag's fish first goes off (unix s, the soonest of them). */
  goes_off: { item: number; at: number }[];
  went_off: number;
}

/** "in 3 days", "in 5 hours", "very soon". */
function inTime(at: number): string {
  const s = at - Date.now() / 1000;
  if (s < 3600) return "very soon";
  if (s < 86_400) return `in ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86_400);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

export class FridgePanel extends Panel {
  private state: FridgeState | null = null;
  private msg = el("p", "hint");

  constructor(private eco: Economy) {
    super("🧊 Mini fridge", "fridge");
  }

  async openUp() {
    this.show();
    this.body.replaceChildren(el("p", "hint", "Opening the fridge…"));
    try {
      this.state = await this.eco.api.get<FridgeState>("/api/fridge");
      this.msg.textContent = this.state.went_off ? `${this.state.went_off} fish in your bag had gone off.` : "";
      this.draw();
    } catch (e) {
      this.body.replaceChildren(el("p", "error", e instanceof Error ? e.message : "The fridge won't open."));
    }
  }

  private async move(path: "put" | "take", item: number, qty: number) {
    try {
      const r = await this.eco.api.send<{ applied: Applied; fish: FridgeState["fish"] }>(`/api/fridge/${path}`, { item, qty, key: crypto.randomUUID() });
      this.eco.applyResult(r.applied);
      if (this.state) this.state.fish = r.fish;
      this.msg.textContent = path === "put" ? `In it goes: ${qty} ${this.eco.name(item)}.` : `Out: ${qty} ${this.eco.name(item)}, good for a week now.`;
      // (Your bag's fish, and when they go off, as they are now.)
      this.state = await this.eco.api.get<FridgeState>("/api/fridge");
    } catch (e) {
      this.msg.textContent = e instanceof Error ? e.message : "That didn't work.";
    }
    this.draw();
  }

  private draw() {
    const s = this.state;
    if (!s) return;
    const held = s.fish.reduce((n, f) => n + f.qty, 0);
    this.body.replaceChildren(
      el("p", "hint", `Fish keep in here. Out in your bag they go off after a week (into Rotten Fish); in here they never do, and taken out they're fresh for a week again. ${held} of ${s.room} fish.`),
      this.msg,
    );
    this.body.append(el("h3", "", "In the fridge"));
    if (!s.fish.length) this.body.append(el("p", "empty", "Nothing in here yet."));
    for (const f of s.fish) {
      const row = el("div", "row");
      row.append(icon(this.eco.items.get(f.item)), el("span", "name", `${this.eco.name(f.item)} ×${f.qty}`), button("Take 1", () => void this.move("take", f.item, 1), "small"));
      if (f.qty > 1) row.append(button(`Take all`, () => void this.move("take", f.item, f.qty), "small"));
      this.body.append(row);
    }
    this.body.append(el("h3", "", "Your bag's fish"));
    const off = new Map(s.goes_off.map((g) => [g.item, g.at]));
    const mine = this.eco.ofKind("fish").filter((f) => this.eco.qty(f.id) > 0);
    if (!mine.length) this.body.append(el("p", "empty", "No fish in your bag."));
    const space = s.room - held;
    for (const f of mine) {
      const n = this.eco.qty(f.id);
      const row = el("div", "row");
      const at = off.get(f.id);
      row.append(icon(f), el("span", "name", `${f.name} ×${n}`), el("span", "hint", at ? `goes off ${inTime(at)}` : ""));
      if (space > 0) {
        row.append(button("Put 1", () => void this.move("put", f.id, 1), "small"));
        if (n > 1) row.append(button("Put all", () => void this.move("put", f.id, Math.min(n, space)), "small primary-sm"));
      }
      this.body.append(row);
    }
    if (space <= 0) this.body.append(el("p", "hint", "The fridge is full."));
  }
}
