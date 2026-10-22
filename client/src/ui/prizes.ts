// The arcade's prize counter: trade tickets won at the cabinets for prizes
// from the mall (server: crates/api/src/prizes.rs): toys, a few things to
// wear and gift wrapping. Things kept for good can only be won once.

import { type Economy, TICKET } from "../economy";
import { ApiError } from "../net/api";
import { Panel, button, el, icon } from "./panels";

export class PrizePanel extends Panel {
  private msg = el("p", "error");
  private busy = false;
  private shelf: { item: number; tickets: number; once: boolean }[] = [];

  constructor(
    private eco: Economy,
    private onWon: (name: string) => void,
  ) {
    super("🎟️ Prize counter", "prizes");
    eco.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    void this.eco
      .prizes()
      .then((p) => {
        this.shelf = p;
        if (this.open) this.render();
      })
      .catch(() => {});
  }

  render() {
    this.body.replaceChildren();
    const tickets = this.eco.qty(TICKET);
    const head = el("div", "coins");
    head.append(icon(this.eco.items.get(TICKET)), `${tickets} tickets`);
    this.body.append(head, el("p", "hint", "Win tickets at the cabinets, then pick a prize."), this.msg);
    const list = el("div", "rows");
    for (const p of [...this.shelf].sort((a, b) => a.tickets - b.tickets)) {
      const it = this.eco.items.get(p.item);
      if (!it) continue;
      const owned = p.once && this.eco.qty(it.id) > 0;
      const row = el("div", "row");
      row.append(icon(it), el("span", "name", it.name), el("span", "price", `${p.tickets} 🎟️`));
      if (owned) {
        row.append(el("span", "hint", "✓ Yours"));
      } else {
        const b = button("Get it", () => void this.get(it.id, it.name), "small");
        b.disabled = this.busy || tickets < p.tickets;
        row.append(b);
      }
      list.append(row);
    }
    if (!this.shelf.length) list.append(el("p", "hint", "Stocking the shelf…"));
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
