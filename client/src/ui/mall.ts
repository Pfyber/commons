// The Commons Mall (ADR 0011): the directory map at the entrance (the floor
// drawn from the map, every shop named, "you are here", tap to walk there)
// and the shop panel (one display up close, or a shop's counter).

import departments from "../../../assets/mall/departments.json";
import type { Economy } from "../economy";
import type { Dept, Shelf, Shop } from "../shop";
import { isWearable } from "../world/items";
import { type ZoneMap, nearestWalkable, spot } from "../world/map";
import type { TileXY } from "../world/motion";
import { cityImage, drawYou } from "./citymap";
import { Panel, button, el, icon } from "./panels";

const NAMES = new Map(departments.departments.map((d) => [d.key, d.name]));

export interface DirectoryHost {
  where(): { map: ZoneMap; here: TileXY } | null;
  walk(t: TileXY): void;
  /** What's new on show this week, by shop (item names). */
  newThisWeek(): { dept: string; items: string[] }[];
  /** When the shelves change (unix seconds; 0 if unknown). */
  endsAt(): number;
}

/** CSS pixels across the map in the panel. */
const SIZE = 400;

export class DirectoryPanel extends Panel {
  private canvas = document.createElement("canvas");
  private timer = 0;

  constructor(private host: DirectoryHost) {
    super("Directory", "citymap directory");
    this.canvas.className = "city-canvas";
    this.canvas.onclick = (e) => this.tap(e);
  }

  render() {
    this.body.replaceChildren();
    this.body.append(el("p", "hint", "Tap a shop to walk there. The food court is in the middle."), this.canvas);
    const fresh = this.host.newThisWeek();
    if (fresh.length) {
      this.body.append(el("h3", "", "New this week"));
      for (const f of fresh) this.body.append(el("p", "hint", `${f.dept}: ${f.items.join(", ")}`));
    }
    const days = Math.max(0, Math.ceil((this.host.endsAt() * 1000 - Date.now()) / 86_400_000));
    if (this.host.endsAt()) this.body.append(el("p", "hint", days <= 1 ? "The shelves change tomorrow." : `The shelves change in ${days} days.`));
    this.draw();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => (this.open ? this.draw() : window.clearInterval(this.timer)), 50);
  }

  hide() {
    super.hide();
    window.clearInterval(this.timer);
  }

  private draw() {
    const w = this.host.where();
    if (!w) return;
    const { map, here } = w;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(SIZE * dpr);
    const ph = Math.round((pw * map.height) / map.width);
    if (this.canvas.width !== pw) {
      this.canvas.width = pw;
      this.canvas.height = ph;
      this.canvas.style.aspectRatio = `${map.width} / ${map.height}`;
    }
    const k = pw / map.width;
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cityImage(map), 0, 0, pw, ph);
    ctx.font = `${Math.round(10 * dpr)}px "Pixelify Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tag = (text: string, x: number, y: number) => {
      const tw = ctx.measureText(text).width + 6 * dpr;
      ctx.fillStyle = "rgba(255, 248, 227, 0.9)";
      ctx.fillRect(x - tw / 2, y - 7 * dpr, tw, 14 * dpr);
      ctx.fillStyle = "#3b3a2e";
      ctx.fillText(text, x, y + 0.5 * dpr);
    };
    for (const o of map.objects) {
      if (o.kind === "dept" && o.label) tag(NAMES.get(o.label) ?? o.label, (o.x + o.w / 2) * k, (o.y + o.h / 2) * k);
    }
    const fc = spot(map, "food_court");
    if (fc) tag("Food court", (fc.x + 0.5) * k, (fc.y - 6) * k);
    const ent = spot(map, "entrance");
    if (ent) tag("Entrance · Pop-up", (ent.x + 0.5) * k, (ent.y - 6) * k);
    drawYou(ctx, (here.x + 0.5) * k, (here.y + 0.5) * k, 4 * dpr, performance.now());
  }

  private tap(e: MouseEvent) {
    const w = this.host.where();
    if (!w) return;
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * w.map.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * w.map.height);
    // Tapping a shop walks to its doorway; anywhere else, to the nearest floor.
    const dept = w.map.objects.find((o) => o.kind === "dept" && x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h);
    const t = (dept?.label && spot(w.map, `dept:${dept.label}`)) || nearestWalkable(w.map, x, y, 8);
    if (!t) return;
    this.hide();
    this.host.walk(t);
  }
}

const ABOUT: Record<string, string> = {
  furniture: "For your home: place it from your bag. How many pieces fit depends on your home.",
  seed: "Plant it in a soil patch: the Community Garden, your courtyard beds, or at home.",
  outfit: "To wear: once it's yours, put it on in any changing room. Yours to keep (it can't be sold on or given).",
  hat: "To wear: once it's yours, put it on in any changing room. Yours to keep (it can't be sold on or given).",
  accessory: "To wear: once it's yours, put it on in any changing room. Yours to keep (it can't be sold on or given).",
  skin: "A full-body suit: you, as a whole new character. Yours to keep (it can't be sold on or given).",
  vehicle: "Faster anywhere outdoors in the city; you hop off at every door. Yours to keep. Try it on the test track first!",
  pet: "A friend for life. Pets live at your house and wait in the yard by your door. They'd love a walk every day: take them out, show them the city, bring them home.",
};

/** Whether you can give a pet a home. */
export type PetHome = "ok" | "no_house" | "apartment" | "have_pet";

/** A shop's goods: one display up close, or everything at the counter. */
export class ShopPanel extends Panel {
  private dept = "";
  private slot: number | null = null;
  private msg = el("p", "error");

  constructor(
    private shop: Shop,
    private eco: Economy,
    /** Opens the fitting room with this thing to wear on. */
    private tryOn: (dept: string, item: number) => void,
    /** Whether you can adopt (a house, no pet yet), and after adopting. */
    private petHome: () => PetHome,
    private adopted: (name: string) => void,
    /** A test ride on the Vehicles shop's track. */
    private testRide: (item: number) => void,
  ) {
    super("Shop", "shop");
    eco.onChange(() => this.open && this.render());
  }

  /** Whether a department is open (has stock). */
  isOpen(dept: string): boolean {
    return this.shop.depts.get(dept)?.open ?? false;
  }

  /** Inspecting the thing on one display. */
  openItem(dept: string, slot: number) {
    this.dept = dept;
    this.slot = slot;
    this.msg.textContent = "";
    this.show();
  }

  /** Everything the shop has on show, at its counter. */
  openDept(dept: string) {
    this.dept = dept;
    this.slot = null;
    this.msg.textContent = "";
    this.show();
  }

  private buyButton(s: Shelf, cls: string): HTMLButtonElement {
    const b = button(`Buy for ${s.price}`, () => {
      this.msg.textContent = "";
      this.shop
        .buy(this.dept, s.slot)
        .then(() => (this.msg.textContent = `✓ ${this.eco.name(s.item)} is in your bag.`))
        .catch((e) => (this.msg.textContent = e instanceof Error ? e.message : "That didn't work."))
        // Fresh counts ("2 left"), or the new week's shelves.
        .finally(() => this.open && this.render());
    }, cls);
    b.disabled = this.eco.coins < s.price || s.left === 0;
    if (s.left === 0) b.textContent = "Sold out";
    return b;
  }

  /** A name and "Adopt", if you can give it a home. */
  private adoptForm(s: Shelf): HTMLElement[] {
    const why: Record<Exclude<PetHome, "ok">, string> = {
      no_house: "A pet needs a garden: rent a house first (ask at the Post Office).",
      apartment: "A pet needs a garden: the apartments don't have one. A house in the home blocks does.",
      have_pet: "You have a pet already: one is plenty of love.",
    };
    const home = this.petHome();
    if (home !== "ok") return [el("p", "hint", why[home])];
    const name = el("input", "pet-name");
    name.placeholder = "Their name";
    name.maxLength = 16;
    name.onkeydown = (e) => e.stopPropagation();
    const adopt = button(`Adopt for ${s.price}`, () => {
      this.msg.textContent = "";
      const n = name.value.trim();
      if (n.length < 2) return void (this.msg.textContent = "Give them a name first.");
      this.shop
        .buy(this.dept, s.slot, n)
        .then(() => {
          this.hide();
          this.adopted(n);
        })
        .catch((e) => (this.msg.textContent = e instanceof Error ? e.message : "That didn't work."));
    }, "primary");
    adopt.disabled = this.eco.coins < s.price || s.left === 0;
    if (s.left === 0) adopt.textContent = "Adopted this week";
    return [el("p", "hint", `You have ${this.eco.coins} coins.`), name, adopt];
  }

  /** "New this week", "Only 3 left this week". */
  private badges(s: Shelf): HTMLElement {
    const box = el("span", "badges");
    if (s.new) box.append(el("span", "badge new", "New"));
    if (s.limited !== null) box.append(el("span", "badge limited", s.left === 0 ? "Sold out this week" : `${s.left} of ${s.limited} left`));
    return box;
  }

  /** The pop-up's season, or when the next one starts. */
  private season(d: Dept): HTMLElement | null {
    if (this.dept !== "popup") return null;
    const day = (md: string) => {
      const [m, dd] = md.split("-").map(Number);
      return new Date(2026, m - 1, dd).toLocaleDateString([], { day: "numeric", month: "short" });
    };
    if (d.event) return el("p", "hint", `${d.event.name}, until ${day(d.event.to)}.${d.next ? ` Then ${d.next.name}.` : ""}`);
    return d.next ? el("p", "hint", `Between seasons. ${d.next.name} opens ${day(d.next.from)}.`) : null;
  }

  render() {
    this.body.replaceChildren();
    const d = this.shop.depts.get(this.dept);
    this.titleEl.textContent = d?.name ?? "Shop";
    if (!d?.open) {
      this.body.append((d && this.season(d)) || el("p", "hint", "Opening soon."));
      return;
    }
    const season = this.season(d);
    if (season) this.body.append(season);
    const coins = el("p", "hint", `You have ${this.eco.coins} coins.`);
    if (this.slot !== null) {
      const s = d.shelves.find((x) => x.slot === this.slot);
      if (!s) return void this.body.append(el("p", "hint", "Nothing here right now."));
      const it = this.eco.items.get(s.item);
      const card = el("div", "shop-card");
      const pic = icon(it);
      pic.classList.add("big");
      card.append(pic, el("strong", "", it?.name ?? s.key), el("span", "price", `${s.price} coins`), this.badges(s));
      const owned = this.eco.qty(s.item);
      this.body.append(card, el("p", "hint", ABOUT[it?.kind ?? ""] ?? ""));
      if (it?.kind === "pet") return void this.body.append(...this.adoptForm(s), this.msg);
      if (it?.kind === "vehicle") {
        this.body.append(button("Test ride on the track 🛼", () => (this.hide(), this.testRide(s.item)), owned ? "" : "primary"));
        if (owned) return void this.body.append(el("p", "hint", "It's yours: ride it outside from your bag or the ride button."), this.msg);
      }
      if (it && isWearable(it.kind)) {
        const dept = this.dept;
        this.body.append(button("Try it on 👗", () => (this.hide(), this.tryOn(dept, s.item)), owned ? "primary" : ""));
        if (owned) return void this.body.append(el("p", "hint", "It's yours: wear it from any changing room."), this.msg);
      } else if (owned) this.body.append(el("p", "hint", `You have ${owned}.`));
      this.body.append(coins, this.buyButton(s, "primary"));
    } else {
      // Each item once, cheapest first.
      const seen = new Set<number>();
      const rows = [...d.shelves].sort((a, b) => a.price - b.price).filter((s) => !seen.has(s.item) && seen.add(s.item));
      for (const s of rows) {
        const row = el("div", "row");
        const name = el("span", "name", this.eco.name(s.item));
        name.append(this.badges(s));
        row.append(icon(this.eco.items.get(s.item)), name, el("span", "price", `${s.price}c`), this.buyButton(s, "small"));
        this.body.append(row);
      }
      this.body.append(coins);
    }
    this.body.append(this.msg);
  }
}
