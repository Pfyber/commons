// Doing your house up outside (ADR 0011, M7): paint, a fence, something in
// the yard and a postbox, from what you've bought at the Home Exterior shop.

import { EXTERIOR_SLOTS, type Goods } from "../goods";
import type { Homes } from "../homes";
import { Panel, button, el, icon } from "./panels";

export class DecoratePanel extends Panel {
  private msg = el("p", "error");

  constructor(
    private goods: Goods,
    private homes: Homes,
  ) {
    super("Outside your house", "decorate");
    goods.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    this.msg.textContent = "";
  }

  render() {
    this.body.replaceChildren();
    const plot = this.homes.mine;
    if (!plot || plot.startsWith("apt:")) {
      this.body.append(el("p", "hint", "This is for a house in the home blocks."));
      return;
    }
    const looks = this.goods.houses.get(plot) ?? {};
    const mine = this.goods.owned("exterior");
    this.body.append(el("p", "hint", "Everyone passing sees it. More at the mall's Home Exterior shop."));
    for (const { slot, name } of EXTERIOR_SLOTS) {
      this.body.append(el("h3", "", name));
      const row = el("div", "tier-row");
      const set = (item: number) => () => {
        this.msg.textContent = "";
        this.goods.setExterior(plot, slot, item).catch((e) => (this.msg.textContent = e instanceof Error ? e.message : "That didn't work."));
      };
      const now = looks[slot] ?? 0;
      const plain = button(now ? "Plain" : "Plain ✓", set(0), "small");
      plain.disabled = !now;
      row.append(plain);
      for (const it of mine.filter((i) => i.meta.slot === slot)) {
        const on = it.meta.code === now;
        const b = button(on ? `${it.name} ✓` : it.name, set(it.id), on ? "small primary-sm" : "small");
        b.prepend(icon(it));
        b.disabled = on;
        row.append(b);
      }
      if (!mine.some((i) => i.meta.slot === slot)) row.append(el("span", "hint", "Nothing yet."));
      this.body.append(row);
    }
    this.body.append(this.msg);
  }
}

