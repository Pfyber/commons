// The arcade's prize counter: trade tickets won at the cabinets for clothes
// (the same ones the clothes shop sells, at TICKETS_PER_COIN tickets per
// coin). What you get is yours to wear at any changing room.

import { type Economy, TICKET, TICKETS_PER_COIN } from "../economy";
import { ApiError } from "../net/api";
import { Panel, button, el, icon } from "./panels";

const SLOT_ICON: Record<string, string> = { outfit: "👕", hat: "🧢", accessory: "✨" };

export class PrizePanel extends Panel {
  private msg = el("p", "error");
  private busy = false;

  constructor(
    private eco: Economy,
    private onWon: (name: string) => void,
  ) {
    super("🎟️ Prize counter", "prizes");
    eco.onChange(() => this.open && this.render());
  }

  render() {
    this.body.replaceChildren();
    const tickets = this.eco.qty(TICKET);
    const head = el("div", "coins");
    head.append(icon(this.eco.items.get(TICKET)), `${tickets} tickets`);
    this.body.append(head, el("p", "hint", "Win tickets at the cabinets, then pick a prize. Wear it at any changing room."), this.msg);
    const list = el("div", "rows");
    const prizes = this.eco.ofKind("clothing").sort((a, b) => (a.meta.price ?? 0) - (b.meta.price ?? 0));
    for (const it of prizes) {
      const cost = (it.meta.price ?? 0) * TICKETS_PER_COIN;
      const owned = this.eco.qty(it.id) > 0;
      const row = el("div", "row");
      row.append(el("span", "prize-icon", SLOT_ICON[it.meta.slot ?? ""] ?? "🎁"), el("span", "name", it.name), el("span", "price", `${cost} 🎟️`));
      if (owned) {
        row.append(el("span", "hint", "✓ Yours"));
      } else {
        const b = button("Get it", () => void this.get(it.id, it.name), "small");
        b.disabled = this.busy || tickets < cost;
        row.append(b);
      }
      list.append(row);
    }
    this.body.append(list);
  }

  private async get(item: number, name: string) {
    this.busy = true;
    this.msg.textContent = "";
    this.render();
    try {
      await this.eco.redeem(item);
      this.onWon(name);
    } catch (e) {
      this.msg.textContent = e instanceof ApiError ? e.message : "That didn't work. Try again?";
    } finally {
      this.busy = false;
      if (this.open) this.render();
    }
  }
}
