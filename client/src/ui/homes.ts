// Renting in the city: the Post Office (your home and stall, rent, tiers,
// moving out), the Market Apartments and the market stalls.

import type { Economy } from "../economy";
import type { Homes } from "../homes";
import { type Lease, type Rent, type Tier, leaseStatus } from "../rent";
import { Panel, button, el } from "./panels";

export interface PostOfficeHost {
  /** Walks to a named spot on the city map ("door:b0_3:5", "apartments"). */
  walkToSpot(spot: string): void;
  /** Walks to the nearest free house; false if none is free. */
  findHome(): boolean;
  goInside(): void;
  toast(text: string): void;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work.");

/** A button that asks again before doing something you can't take back. */
export function confirmButton(label: string, ask: string, run: () => void): HTMLButtonElement {
  let armed = false;
  const b = button(label, () => {
    if (armed) return run();
    armed = true;
    b.textContent = ask;
    b.classList.add("danger");
  }, "small");
  return b;
}

/** Buttons to move to the other tiers of a lease. */
function tierButtons(l: Lease, tiers: Tier[], change: (t: Tier) => void): HTMLElement {
  const row = el("div", "tier-row");
  for (const t of tiers) {
    if (t.tier === l.tier) continue;
    const up = t.rent > l.rent;
    const label = up ? `Move up to a ${t.name} (${t.rent}/week, ${t.rent - l.rent} now)` : `Move down to a ${t.name} (${t.rent}/week)`;
    row.append(button(label, () => change(t), up ? "small primary-sm" : "small"));
  }
  return row;
}

export class PostOfficePanel extends Panel {
  private msg = el("p", "error");

  constructor(
    private homes: Homes,
    private rent: Rent,
    private host: PostOfficeHost,
  ) {
    super("Post Office", "post-office");
    homes.onChange(() => this.open && this.render());
    rent.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    this.msg.textContent = "";
    void Promise.all([this.homes.load(), this.rent.load(), this.rent.loadStalls()]).catch(() => {});
  }

  private act(p: Promise<unknown>, done?: string) {
    this.msg.textContent = "";
    p.then(() => done && this.host.toast(done)).catch((e) => (this.msg.textContent = errText(e)));
  }

  render() {
    this.body.replaceChildren();
    const home = this.rent.home;
    this.body.append(el("h3", "", "Your home"));
    if (home) {
      const what = home.kind === "apartment" ? "an apartment above the Market" : "a house in the home blocks";
      this.body.append(
        el("p", "", `A ${home.tier_name}: ${what}.`),
        el("p", home.state === "grace" ? "hint warn" : "hint", leaseStatus(home)),
        el("p", "hint", `Furniture: ${this.rent.furnitureUsed} of ${home.furniture ?? 0} pieces.`),
      );
      if (home.state === "grace") this.body.append(button(`Pay ${home.rent} coins now`, () => this.act(this.rent.pay("home"), "🏡 Rent paid. Thank you!"), "primary"));
      else this.body.append(tierButtons(home, this.rent.tiers(home.kind), (t) => this.act(this.rent.changeTier("home", t.tier), `🏡 Your home is a ${t.name} now.`)));
      this.body.append(
        button("Walk home", () => (this.hide(), this.host.walkToSpot(`door:${home.plot}`)), "primary"),
        button("Go straight inside", () => (this.hide(), this.host.goInside())),
        confirmButton("Move out", "Really move out? Your things go back to your bag", () =>
          this.act(this.rent.end("home").then(() => this.homes.load()), "📦 You've moved out. Your furniture is back in your bag."),
        ),
      );
    } else {
      const cottage = this.rent.tiers("home")[0];
      const studio = this.rent.tiers("apartment")[0];
      const free = this.homes.free;
      this.body.append(
        el("p", "", "Homes are rented by the week, never bought. A house in the home blocks has a garden and a postbox; an apartment above the Market is small and in the middle of everything."),
        el("p", "hint", `${free} of ${this.homes.total} houses free${cottage ? `, from ${cottage.rent} coins a week (a ${cottage.name})` : ""}.${studio ? ` Apartments from ${studio.rent} a week.` : ""}`),
      );
      if (free > 0) this.body.append(button("Show me a free house", () => (this.hide(), this.host.findHome()), "primary"));
      this.body.append(button("The Market Apartments", () => (this.hide(), this.host.walkToSpot("apartments"))));
    }

    this.body.append(el("h3", "", "Your market stall"));
    const stall = this.rent.stall;
    if (stall) {
      this.body.append(el("p", "", `A ${stall.tier_name} (${stall.plot.replace("stall:", "stall ")}).`), el("p", stall.state === "grace" ? "hint warn" : "hint", leaseStatus(stall)));
      if (stall.state === "grace") this.body.append(button(`Pay ${stall.rent} coins now`, () => this.act(this.rent.pay("stall"), "🧺 Stall rent paid."), "primary"));
      else this.body.append(tierButtons(stall, this.rent.tiers("stall"), (t) => this.act(this.rent.changeTier("stall", t.tier), `🧺 Your stall is a ${t.name} now.`)));
      this.body.append(
        button("Walk to my stall", () => (this.hide(), this.host.walkToSpot(stall.plot))),
        confirmButton("Give it up", "Really? Your goods go back to your bag", () => this.act(this.rent.end("stall"), "🧺 Stall given up. Your goods are back in your bag.")),
      );
    } else {
      const small = this.rent.tiers("stall")[0];
      const freeStall = [1, 2, 3, 4, 5, 6].map((n) => `stall:${n}`).find((s) => !this.rent.stallAt(s));
      this.body.append(el("p", "hint", `Sell things from your bag at your own price, from a stall on the south side of the Market${small ? ` (from ${small.rent} coins a week)` : ""}.`));
      if (freeStall) this.body.append(button("Show me a free stall", () => (this.hide(), this.host.walkToSpot(freeStall))));
      else this.body.append(el("p", "hint", "Every stall is taken right now."));
    }
    this.body.append(this.msg);
  }
}

export class ApartmentsPanel extends Panel {
  private msg = el("p", "error");

  constructor(
    private homes: Homes,
    private rent: Rent,
    private host: PostOfficeHost,
  ) {
    super("Market Apartments", "apartments");
    homes.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    this.msg.textContent = "";
    void Promise.all([this.homes.load(), this.rent.load()]).catch(() => {});
  }

  render() {
    this.body.replaceChildren();
    const studio = this.rent.tiers("apartment")[0];
    this.body.append(el("p", "hint", `Eight flats above the Market's shops${studio ? `, from ${studio.rent} coins a week (a ${studio.name})` : ""}.`));
    const mine = this.homes.mine;
    for (let n = 1; n <= this.homes.apartments; n++) {
      const plot = `apt:${n}`;
      const r = this.homes.resident(plot);
      const row = el("div", "row");
      row.append(el("span", "name", `Flat ${n}`), el("span", "price", plot === mine ? "Yours" : r ? r.name : "Free"));
      if (plot === mine) row.append(button("Go inside", () => (this.hide(), this.host.goInside()), "small primary-sm"));
      else if (!r && !mine && studio) {
        row.append(
          button(`Rent (${studio.rent}/week)`, () => {
            this.msg.textContent = "";
            this.homes
              .claim(plot)
              .then(() => this.rent.load())
              .then(() => this.host.toast(`🏡 Flat ${n} is yours. Welcome home! The door is right here.`))
              .catch((e) => (this.msg.textContent = errText(e)));
          }, "small primary-sm"),
        );
      }
      this.body.append(row);
    }
    if (mine && !mine.startsWith("apt:")) this.body.append(el("p", "hint", "You have a house already: one home at a time."));
    this.body.append(this.msg);
  }
}

export class StallPanel extends Panel {
  private stall = "";
  private msg = el("p", "error");

  constructor(
    private rent: Rent,
    private eco: Economy,
    private host: PostOfficeHost,
  ) {
    super("Market stall", "stall");
    rent.onChange(() => this.open && this.render());
  }

  openFor(stall: string) {
    this.stall = stall;
    this.msg.textContent = "";
    this.show();
    void Promise.all([this.rent.load(), this.rent.loadStalls()]).catch(() => {});
  }

  private act(p: Promise<unknown>, done?: string) {
    this.msg.textContent = "";
    p.then(() => {
      void this.eco.load().catch(() => {});
      if (done) this.host.toast(done);
    }).catch((e) => (this.msg.textContent = errText(e)));
  }

  render() {
    this.body.replaceChildren();
    const s = this.rent.stallAt(this.stall);
    const n = this.stall.replace("stall:", "");
    this.titleEl.textContent = s ? `${s.mine ? "Your" : `${s.name}'s`} stall` : `Stall ${n}`;
    if (!s) {
      const tiers = this.rent.tiers("stall");
      this.body.append(el("p", "", "A free stall. Rent it to put things from your bag on show at your own price; anyone passing can buy them."));
      if (this.rent.stall) this.body.append(el("p", "hint", "You rent a stall already."));
      else for (const t of tiers) this.body.append(button(`Rent a ${t.name}: ${t.listings} things on show, ${t.rent} coins a week`, () => this.act(this.rent.claimStall(this.stall, t.tier), "🧺 The stall is yours. Put something on show!"), t.tier === 1 ? "primary" : ""));
    } else {
      if (!s.goods.length) this.body.append(el("p", "empty", s.mine ? "Nothing on show yet." : "Nothing on show right now."));
      for (const g of s.goods) {
        const row = el("div", "row");
        row.append(el("span", "name", `${this.eco.name(g.item)} ×${g.qty}`), el("span", "price", `${g.price} each`));
        if (s.mine) row.append(button("Take back", () => this.act(this.rent.take(g.id)), "small"));
        else row.append(button("Buy 1", () => this.act(this.rent.buy(g.id, 1), `🧺 Bought ${this.eco.name(g.item)} from ${s.name}.`), "small primary-sm"));
        this.body.append(row);
      }
      if (s.mine) this.putForm(s.lease);
    }
    this.body.append(this.msg);
  }

  /** Pick something from your bag, how many and the price. */
  private putForm(l: Lease) {
    const full = (this.rent.stallAt(this.stall)?.goods.length ?? 0) >= (l.listings ?? 0);
    this.body.append(el("h3", "", "Put something on show"));
    if (full) {
      this.body.append(el("p", "hint", `Your ${l.tier_name} is full (${l.listings} things). A bigger stall holds more; ask at the Post Office.`));
      return;
    }
    const pick = el("select", "stall-item");
    for (const [id, qty] of this.eco.inventory) {
      if (qty <= 0 || id === 1 || this.eco.items.get(id)?.meta.account_bound) continue;
      const o = el("option", "", `${this.eco.name(id)} (you have ${qty})`);
      o.value = String(id);
      pick.append(o);
    }
    if (!pick.options.length) {
      this.body.append(el("p", "hint", "Your bag is empty. Catch, grow or find something first."));
      return;
    }
    const qty = el("input", "stall-qty");
    qty.type = "number";
    qty.min = "1";
    qty.value = "1";
    const price = el("input", "stall-price");
    price.type = "number";
    price.min = "1";
    price.max = "9999";
    price.value = "10";
    for (const i of [qty, price]) i.onkeydown = (e) => e.stopPropagation();
    const form = el("div", "stall-form");
    form.append(pick, el("label", "", "how many"), qty, el("label", "", "coins each"), price);
    this.body.append(
      form,
      button("Put on show", () => this.act(this.rent.put(Number(pick.value), Number(qty.value), Number(price.value)), "🧺 On show!"), "primary"),
    );
  }
}
