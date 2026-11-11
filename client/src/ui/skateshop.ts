// Dusty's van: build your board. A big window with your board turning in it
// (fake 3D pixel art: skateboard3d.ts), how it rides (acceleration, top
// speed) and what tricks its trucks can do, and the parts, a tab each:
// decks (colours, and one that glows in the dark), wheels, bearings (upgraded
// a level at a time), trucks (which tricks) and trails. Tap a part to see it
// on your board; buy it (it's yours for good) or pick it from what you've
// got. And a tab of Dusty's daily quests: three to do, coins for each.

import { till } from "../ambient/salvagesfx";
import type { Economy } from "../economy";
import { ApiError } from "../net/api";
import { drawBoard3d } from "../world/skateboard3d";
import { DECKS, OPTIONS, itemOf, owns, ride, type Kit, type Part } from "../activities/skatekit";
import type { Quests } from "../activities/skatequests";
import { Panel, button, el } from "./panels";

type Tab = Part | "quests";

const TABS: [Tab, string][] = [
  ["deck", "🛹 Deck"],
  ["wheels", "⚪ Wheels"],
  ["bearings", "⚙️ Bearings"],
  ["trucks", "🔩 Trucks"],
  ["trail", "✨ Trail"],
  ["quests", "🎯 Quests"],
];

/** The window's board, in art pixels (drawn twice the size, crisp). */
const VIEW_W = 200;
const VIEW_H = 120;

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export class SkateShopPanel extends Panel {
  private tab: Tab = "deck";
  /** The part being looked at (on the board in the window), if it isn't the one ridden. */
  private looking: { part: Part; code: number } | null = null;
  private view = document.createElement("canvas");
  private raf = 0;
  private msg = el("p", "error");
  private busy = false;

  constructor(
    private eco: Economy,
    /** Your board as it's built now, and building it anew. */
    private board: () => Kit,
    private build: (k: Kit) => void,
    /** Dusty's daily quests, and claiming one's coins. */
    private quests: Quests,
    private claim: (day: number, slot: number) => void,
  ) {
    super("🛹 Dusty's Skate Shop", "skate-shop");
    this.view.width = VIEW_W;
    this.view.height = VIEW_H;
    this.view.className = "skate-shop-view";
    eco.onChange(() => this.open && this.render());
  }

  show() {
    this.looking = null;
    this.msg.textContent = "";
    super.show();
    cancelAnimationFrame(this.raf);
    const ctx = this.view.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const tick = (now: number) => {
      drawBoard3d(ctx, this.preview(), now / 1000);
      if (this.open) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  hide() {
    cancelAnimationFrame(this.raf);
    super.hide();
  }

  /** The board as it'd be with the part being looked at on it. */
  private preview(): Kit {
    const k = this.board();
    return this.looking ? { ...k, [this.looking.part]: this.looking.code } : k;
  }

  render() {
    this.body.replaceChildren();
    const kit = this.preview();
    // The window: the board turning, how it rides, its tricks.
    const show = el("div", "skate-shop-show");
    const r = ride(kit);
    const bar = (label: string, v: number, max: number) => {
      const row = el("div", "skate-stat");
      const fill = el("span", "skate-stat-fill");
      fill.style.width = `${Math.round(Math.min(1, v / max) * 100)}%`;
      const track = el("span", "skate-stat-bar");
      track.append(fill);
      row.append(el("span", "skate-stat-name", label), track);
      return row;
    };
    const tricks = el("div", "skate-tricks");
    const chip = (name: string, ok: boolean) => tricks.append(el("span", ok ? "skate-trick on" : "skate-trick", `${ok ? "✓" : "🔒"} ${name}`));
    chip("Ollie", true);
    chip("Kickflip", r.flips.has(""));
    chip("Heelflip", r.flips.has("left"));
    chip("Varial & Hardflip", r.flips.has("right"));
    chip("Doubles", r.doubles);
    chip("All grabs", r.grabs);
    chip("All grinds", r.grinds);
    chip("Backflips", r.body);
    chip("🌊 Pumping", r.pump > 0);
    show.append(this.view, bar("Acceleration", r.accel, 3.2), bar("Top speed", r.top, 1.2), tricks);
    // The parts: tabs, then the options.
    const shop = el("div", "skate-shop-parts");
    const tabs = el("div", "tabs");
    for (const [t, label] of TABS) {
      const waiting = t === "quests" ? this.quests.waiting : 0;
      tabs.append(button(waiting ? `${label} (${waiting}!)` : label, () => ((this.tab = t), (this.looking = null), this.render()), `${t === this.tab ? "on" : ""}${waiting ? " ready" : ""}`));
    }
    shop.append(tabs, el("p", "hint", `You have ${this.eco.coins} coins.`));
    if (this.tab === "quests") shop.append(this.questList(), this.msg);
    else {
      if (this.tab === "bearings") shop.append(this.bearings());
      else shop.append(this.options(this.tab));
      shop.append(this.action(), this.msg);
    }
    this.body.append(show, shop);
  }

  /** The options for a part, as tiles. */
  private options(part: Part): HTMLElement {
    const grid = el("div", "skate-options");
    const on = this.board()[part];
    for (const o of OPTIONS[part]) {
      const it = itemOf(this.eco, part, o.code);
      const mine = owns(this.eco, part, o.code);
      const looking = this.looking?.part === part ? this.looking.code : on;
      const tile = button("", () => {
        this.looking = o.code === on ? null : { part, code: o.code };
        this.msg.textContent = "";
        this.render();
      }, `skate-option${looking === o.code ? " picked" : ""}${o.code === on ? " riding" : ""}`);
      tile.append(this.swatch(part, o.code), el("strong", "", o.name), el("span", "skate-option-tag", o.code === on ? "Riding" : mine ? "Yours" : `${it?.meta.buy ?? "?"} 🪙`));
      grid.append(tile);
    }
    return grid;
  }

  /** A little picture of an option: the deck's colour, the wheel's size, the trail's look… */
  private swatch(part: Part, code: number): HTMLElement {
    const sw = el("span", `skate-swatch ${part}`);
    if (part === "deck") {
      const d = DECKS[code];
      sw.style.background = hex(d.color);
      sw.style.boxShadow = d.glow ? `0 0 10px 2px ${hex(d.glow)}` : "";
      if (d.shine) sw.classList.add("shine");
    } else if (part === "wheels") {
      sw.textContent = ["●", "•", "⬤"][code];
    } else if (part === "trucks") {
      sw.style.background = ["#b9c2c9", "#e8566b", "#3a3a44", "#e8b923", "#3fd8e8", "linear-gradient(135deg,#3fd8e8,#2a7fff 55%,#f4f1e8)"][code];
    } else if (part === "trail") {
      sw.style.background = ["transparent", "linear-gradient(90deg,#ffd23f,#fff3a0)", "linear-gradient(90deg,#3fd8e8,#ff8fd8)", "linear-gradient(90deg,#ff4d4d,#ffa53d,#ffe14d,#5fe06a,#4da6ff,#a66bff)", "linear-gradient(90deg,#ff3a1a,#ffa53d,#ffe14d)", "linear-gradient(90deg,#2a1450,#5a2a9a,#4d6bff)"][code];
      if (!code) sw.textContent = "—";
    }
    return sw;
  }

  /** Bearings: a level at a time, up to five; any you've got, ridden. */
  private bearings(): HTMLElement {
    const box = el("div", "skate-bearings");
    const on = this.board().bearings;
    const top = [1, 2, 3, 4, 5, 6].filter((l) => owns(this.eco, "bearings", l)).pop() ?? 1;
    const pips = el("div", "skate-pips");
    for (let l = 1; l <= 6; l++) {
      const mine = owns(this.eco, "bearings", l);
      const b = button(l === 6 ? "Pro" : `Lv ${l}`, () => mine && l !== on && this.equip("bearings", l), `skate-pip${l <= top ? " got" : ""}${l === on ? " riding" : ""}`);
      b.disabled = !mine;
      pips.append(b);
    }
    box.append(pips);
    if (top < 6) {
      const next = top + 1;
      const it = itemOf(this.eco, "bearings", next);
      const price = it?.meta.buy ?? 0;
      const up = button(`⬆ Upgrade to ${next === 6 ? "Pro bearings" : `Lv ${next}`} — ${price} 🪙`, () => it && void this.buy("bearings", next, price), "primary skate-upgrade");
      up.disabled = this.busy || this.eco.coins < price;
      box.append(up, el("p", "hint", OPTIONS.bearings[next - 1].about));
    } else box.append(el("p", "hint", "Maxed out: the fastest bearings there are."));
    return box;
  }

  /** Dusty's quests for today: each, how far you've got, its coins (claimed here). */
  private questList(): HTMLElement {
    const box = questList(this.quests, (day, slot) => {
      this.claim(day, slot);
      this.msg.textContent = "";
    });
    box.prepend(el("p", "skate-quest-intro", "“Three things for you today, dude. Pull 'em off and the coins are yours.”"));
    return box;
  }

  /** Under the options: buy what you're looking at, or ride it. */
  private action(): HTMLElement {
    const row = el("div", "skate-action");
    if (this.tab === "bearings" || this.tab === "quests") return row;
    const part = this.tab;
    const code = this.looking?.part === part ? this.looking.code : this.board()[part];
    const o = OPTIONS[part].find((x) => x.code === code)!;
    row.append(el("p", "skate-about", `${o.name}: ${o.about}`));
    if (code === this.board()[part]) {
      row.append(el("span", "skate-riding", "✓ On your board"));
    } else if (owns(this.eco, part, code)) {
      row.append(button("Put it on my board", () => this.equip(part, code), "primary"));
    } else {
      const price = itemOf(this.eco, part, code)?.meta.buy ?? 0;
      const b = button(`Buy it for ${price} 🪙`, () => void this.buy(part, code, price), "primary");
      b.disabled = this.busy || this.eco.coins < price;
      row.append(b);
      if (this.eco.coins < price) row.append(el("span", "hint", `${price - this.eco.coins} more coins to go.`));
    }
    return row;
  }

  private equip(part: Part, code: number) {
    this.build({ ...this.board(), [part]: code });
    this.looking = null;
    this.render();
  }

  private async buy(part: Part, code: number, price: number) {
    const it = itemOf(this.eco, part, code);
    if (!it || this.busy) return;
    this.busy = true;
    this.msg.textContent = "";
    this.render();
    try {
      await this.eco.buy(it.id, 1);
      till(price);
      // Bought: straight onto your board.
      this.build({ ...this.board(), [part]: code });
      this.looking = null;
      this.msg.textContent = `✓ ${it.name}: it's yours, and on your board.`;
    } catch (e) {
      this.msg.textContent = e instanceof ApiError ? e.message : "That didn't work.";
    } finally {
      this.busy = false;
      if (this.open) this.render();
    }
  }
}

/** Today's quests from `quests`: each, how far you've got, its coins (a Claim button, done). */
export function questList(quests: Quests, claim: (day: number, slot: number) => void): HTMLElement {
  const box = el("div", "skate-quests");
  for (const q of quests.today()) {
    const row = el("div", `skate-quest${q.done ? " done" : ""}${q.claimed ? " claimed" : ""}`);
    const bar = el("span", "skate-quest-bar");
    const fill = el("span", "skate-quest-fill");
    fill.style.width = `${Math.round(Math.min(1, q.progress / q.target) * 100)}%`;
    bar.append(fill);
    const info = el("div", "skate-quest-info");
    info.append(el("strong", "", q.text), bar, el("span", "skate-quest-prog", q.shown));
    const side = el("div", "skate-quest-side");
    if (q.claimed) side.append(el("span", "skate-quest-got", "✓ Paid"));
    else if (q.done) {
      side.append(button(`Claim ${q.coins} 🪙`, () => claim(quests.day, q.slot), "primary"));
    } else side.append(el("span", "skate-quest-coins", `${q.coins} 🪙`));
    row.append(info, side);
    box.append(row);
  }
  const left = 86_400_000 - (Date.now() % 86_400_000);
  box.append(el("p", "hint", `New quests in ${Math.floor(left / 3_600_000)}h ${Math.floor((left % 3_600_000) / 60_000)}m.`));
  return box;
}
