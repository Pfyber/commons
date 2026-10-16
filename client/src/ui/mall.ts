// The Commons Mall (ADR 0011): the directory map at the entrance (the floor
// drawn from the map, every shop named, "you are here", tap to walk there)
// and the shop panel (one display up close, or a shop's counter).

import departments from "../../../assets/mall/departments.json";
import type { Economy } from "../economy";
import type { Shelf, Shop } from "../shop";
import { type ZoneMap, nearestWalkable, spot } from "../world/map";
import type { TileXY } from "../world/motion";
import { cityImage, drawYou } from "./citymap";
import { Panel, button, el, icon } from "./panels";

const NAMES = new Map(departments.departments.map((d) => [d.key, d.name]));

export interface DirectoryHost {
  where(): { map: ZoneMap; here: TileXY } | null;
  walk(t: TileXY): void;
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
};

/** A shop's goods: one display up close, or everything at the counter. */
export class ShopPanel extends Panel {
  private dept = "";
  private slot: number | null = null;
  private msg = el("p", "error");

  constructor(
    private shop: Shop,
    private eco: Economy,
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
        .catch((e) => (this.msg.textContent = e instanceof Error ? e.message : "That didn't work."));
    }, cls);
    b.disabled = this.eco.coins < s.price;
    return b;
  }

  render() {
    this.body.replaceChildren();
    const d = this.shop.depts.get(this.dept);
    this.titleEl.textContent = d?.name ?? "Shop";
    if (!d?.open) {
      this.body.append(el("p", "hint", "Opening soon."));
      return;
    }
    const coins = el("p", "hint", `You have ${this.eco.coins} coins.`);
    if (this.slot !== null) {
      const s = d.shelves.find((x) => x.slot === this.slot);
      if (!s) return void this.body.append(el("p", "hint", "Nothing here right now."));
      const it = this.eco.items.get(s.item);
      const card = el("div", "shop-card");
      const pic = icon(it);
      pic.classList.add("big");
      card.append(pic, el("strong", "", it?.name ?? s.key), el("span", "price", `${s.price} coins`));
      const owned = this.eco.qty(s.item);
      this.body.append(card, el("p", "hint", ABOUT[it?.kind ?? ""] ?? ""), el("p", "hint", owned ? `You have ${owned}.` : ""), coins, this.buyButton(s, "primary"));
    } else {
      // Each item once, cheapest first.
      const seen = new Set<number>();
      const rows = [...d.shelves].sort((a, b) => a.price - b.price).filter((s) => !seen.has(s.item) && seen.add(s.item));
      for (const s of rows) {
        const row = el("div", "row");
        row.append(icon(this.eco.items.get(s.item)), el("span", "name", this.eco.name(s.item)), el("span", "price", `${s.price}c`), this.buyButton(s, "small"));
        this.body.append(row);
      }
      this.body.append(coins);
    }
    this.body.append(this.msg);
  }
}
