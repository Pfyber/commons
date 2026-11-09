// Doing a room up (wallpaper, flooring, any colour) and the laptop's big
// page of everything a drone can bring.

import { ApiError } from "../net/api";
import { COIN, type Economy, type Item } from "../economy";
import type { HomeLife, Look } from "../homelife";
import { Panel, button, el, icon } from "./panels";

const hex = (n: number, fallback: string) => (n < 0 ? fallback : `#${n.toString(16).padStart(6, "0")}`);
const errText = (e: unknown) => (e instanceof ApiError ? e.message : "That didn't work.");

export class RoomPanel extends Panel {
  private look: Look = { wall: 0, wall_color: -1, floor: 0, floor_color: -1 };
  private msg = el("p", "error");
  /** Shows a look on the room (saved or not). */
  onLook: (l: Look) => void = () => {};

  constructor(
    private eco: Economy,
    private life: HomeLife,
  ) {
    super("🎨 Decorate your room", "room-style");
    eco.onChange(() => this.open && this.render());
  }

  openWith(l: Look) {
    this.look = { ...l };
    this.msg.textContent = "";
    this.show();
  }

  private set(change: Partial<Look>) {
    this.look = { ...this.look, ...change };
    this.onLook(this.look);
    this.life.setLook(this.look).catch((e) => (this.msg.textContent = errText(e)));
    this.render();
  }

  private part(name: string, skin: "wall" | "floor", plain: string, fallback: string) {
    const item = skin === "wall" ? this.look.wall : this.look.floor;
    const color = skin === "wall" ? this.look.wall_color : this.look.floor_color;
    const pick = (id: number) => () => this.set(skin === "wall" ? { wall: id } : { floor: id });
    this.body.append(el("h3", "", name));
    const row = el("div", "tier-row");
    const none = button(item ? plain : `${plain} ✓`, pick(0), "small");
    none.disabled = !item;
    row.append(none);
    for (const it of this.eco.ofKind("room").filter((i) => (i.meta as { skin?: string }).skin === skin && this.eco.qty(i.id) > 0)) {
      const b = button(it.id === item ? `${it.name} ✓` : it.name, pick(it.id), it.id === item ? "small primary-sm" : "small");
      b.prepend(icon(it));
      b.disabled = it.id === item;
      row.append(b);
    }
    const input = el("input", "room-color");
    input.type = "color";
    input.value = hex(color, fallback);
    input.addEventListener("change", () => {
      const c = parseInt(input.value.slice(1), 16);
      this.set(skin === "wall" ? { wall_color: c } : { floor_color: c });
    });
    const label = el("label", "room-color-row", "Colour ");
    label.append(input);
    this.body.append(row, label);
  }

  render() {
    this.body.replaceChildren();
    this.body.append(el("p", "hint", "Skins stay yours. Any skin takes any colour. More at the Market cart, or by drone."));
    this.part("Walls", "wall", "Plain", "#d9b98f");
    this.part("Floor", "floor", "Planks", "#a9774a");
    this.body.append(this.msg);
  }
}

export class DronePanel extends Panel {
  private shelf: { item: Item; price: number }[] = [];
  private fee = 0;
  private query = "";
  private msg = el("p", "error");
  private list = el("div", "rows");
  private coins = el("div", "coins");
  private search = el("input", "drone-search");

  constructor(
    private eco: Economy,
    private life: HomeLife,
    private toast: (text: string) => void,
  ) {
    super("🚁 Drone Delivery", "drone");
    this.search.placeholder = "Search the market…";
    this.search.addEventListener("input", () => {
      this.query = this.search.value.toLowerCase();
      this.fill();
    });
    eco.onChange(() => this.open && this.fill());
  }

  show() {
    super.show();
    this.msg.textContent = "";
    this.life
      .catalog()
      .then((c) => {
        this.fee = c.fee;
        this.shelf = c.items.flatMap((s) => {
          const item = this.eco.items.get(s.item);
          return item ? [{ item, price: s.price }] : [];
        });
        this.shelf.sort((a, b) => a.item.kind.localeCompare(b.item.kind) || a.price - b.price);
        this.render();
      })
      .catch((e) => (this.msg.textContent = errText(e)));
  }

  render() {
    this.body.replaceChildren();
    this.body.append(el("p", "hint", `Anything in the market, flown from the Market to your front door. ${this.fee} coin delivery fee per order; pick the parcel up on your step.`), this.coins, this.search, this.msg, this.list);
    this.fill();
  }

  private fill() {
    this.coins.replaceChildren(icon(this.eco.items.get(COIN)), `${this.eco.coins} coins`);
    this.list.replaceChildren();
    for (const { item, price } of this.shelf.filter((s) => s.item.name.toLowerCase().includes(this.query))) {
      const row = el("div", "row");
      const qty = el("input", "drone-qty");
      qty.type = "number";
      qty.min = "1";
      qty.max = "20";
      qty.value = "1";
      const cost = () => price * Math.max(1, Math.min(20, Number(qty.value) || 1)) + this.fee;
      const send = button(`Send ${cost()}c`, () => {
        this.msg.textContent = "";
        const n = Math.max(1, Math.min(20, Number(qty.value) || 1));
        this.life
          .order(item.id, n)
          .then(() => this.toast(`🚁 ${item.name} is on its way! Watch your front door.`))
          .catch((e) => (this.msg.textContent = errText(e)));
      }, "small primary-sm");
      qty.addEventListener("input", () => {
        send.textContent = `Send ${cost()}c`;
        send.disabled = this.eco.coins < cost();
      });
      send.disabled = this.eco.coins < cost();
      row.append(icon(item), el("span", "name", item.name), ownedTag(this.eco, item.id), el("span", "price", `${price}c`), qty, send);
      this.list.append(row);
    }
    if (!this.list.childElementCount) this.list.append(el("p", "empty", "Nothing by that name."));
  }
}

/** How many of `item` are in your bag, shown by anything you can buy. */
export function ownedTag(eco: Economy, item: number): HTMLElement {
  return el("span", "owned-tag", `🎒 ${eco.qty(item)}`);
}
