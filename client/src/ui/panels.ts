// M3 panels: bag, album, market, garden plot menu, fishing reel mini-game
// and the furniture placement banner. Plain DOM, styled in styles.css.

import { COIN, type Economy, type Item } from "../economy";
import { ApiError } from "../net/api";
import { itemIconUrl } from "../world/items";
import { pxIcon } from "./icons";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function icon(item: Item | undefined): HTMLImageElement {
  const img = el("img", "icon");
  img.alt = "";
  if (item) img.src = itemIconUrl(item.key, item.kind);
  return img;
}

export function button(label: string, run: () => void, cls = ""): HTMLButtonElement {
  const b = el("button", cls, label);
  b.type = "button";
  b.onclick = run;
  return b;
}

/** Whether a key event belongs to a text field, so game keys must leave it alone. */
export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable);
}

/** A closable floating panel. */
export class Panel {
  /** Panels share one spot on screen, so only one is open at a time. */
  private static current: Panel | null = null;
  /** Where in the world the panel belongs (a board, a stall…): it closes
   * when you walk away. Null for panels opened from the HUD. */
  anchor: { x: number; y: number; range: number } | null = null;

  /** The open panel, if any. */
  static get open(): Panel | null {
    return Panel.current;
  }
  readonly el: HTMLDivElement;
  protected body: HTMLDivElement;
  protected titleEl: HTMLElement;

  constructor(title: string, cls: string) {
    this.el = el("div", `panel ${cls}`);
    this.el.hidden = true;
    const head = el("div", "panel-head");
    this.titleEl = el("strong", "", title);
    const close = button("", () => this.hide(), "x");
    close.setAttribute("aria-label", "Close");
    close.append(pxIcon("close", 2));
    head.append(this.titleEl, close);
    this.body = el("div", "panel-body");
    this.el.append(head, this.body);
    document.body.appendChild(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  /** Closes whichever panel is open; returns whether one was. */
  static closeCurrent(): boolean {
    if (!Panel.current) return false;
    Panel.current.hide();
    return true;
  }

  show() {
    if (Panel.current && Panel.current !== this) Panel.current.hide();
    Panel.current = this;
    this.el.hidden = false;
    this.render();
  }

  hide() {
    this.el.hidden = true;
    this.anchor = null;
    if (Panel.current === this) Panel.current = null;
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  render() {}

  destroy() {
    this.el.remove();
  }
}

const KIND_ORDER: [string, string][] = [
  ["fish", "Fish"],
  ["junk", "Odds & ends"],
  ["plant", "Harvest"],
  ["seed", "Seeds"],
  ["furniture", "Furniture"],
  ["vehicle", "To ride"],
  ["tool", "Tools"],
  ["instrument", "Instruments"],
  ["toy", "Toys"],
  ["wrap", "Gift wrapping"],
  ["card", "Cards"],
  ["exterior", "For your house"],
];

export class BagPanel extends Panel {
  placeable = false;

  constructor(
    private eco: Economy,
    private onPlace: (item: Item) => void,
    /** Riding: get on (`item`) or off (null); whether you're on it now. */
    private onRide?: (item: Item) => void,
    private ridingNow?: (item: Item) => boolean,
    /** Anything more to do with an item (use a tool, play a toy…). */
    private extra?: (item: Item) => HTMLElement | null,
  ) {
    super("Bag", "bag");
    eco.onChange(() => this.open && this.render());
  }

  render() {
    this.body.replaceChildren();
    const coins = el("div", "coins");
    coins.append(icon(this.eco.items.get(COIN)), `${this.eco.coins} coins`);
    this.body.append(coins);
    let any = false;
    for (const [kind, label] of KIND_ORDER) {
      const items = this.eco.ofKind(kind).filter((i) => this.eco.qty(i.id) > 0);
      if (!items.length) continue;
      any = true;
      this.body.append(el("h3", "", label));
      const grid = el("div", "item-grid");
      for (const it of items) {
        const cell = el("div", "item");
        cell.title = it.name;
        cell.append(icon(it), el("span", "qty", `${this.eco.qty(it.id)}`), el("span", "name", it.name));
        if (kind === "furniture" && this.placeable) cell.append(button("Place", () => this.onPlace(it), "small"));
        if (kind === "seed") cell.append(el("span", "hint", "Tap a garden plot"));
        if (kind === "vehicle" && this.onRide) cell.append(button(this.ridingNow?.(it) ? "Get off" : "Ride", () => this.onRide?.(it), "small"));
        const more = this.extra?.(it);
        if (more) cell.append(more);
        grid.append(cell);
      }
      this.body.append(grid);
    }
    if (!any) this.body.append(el("p", "empty", "Your bag is empty. Try fishing at the pond or the market cart by the fountain."));
  }
}

export class AlbumPanel extends Panel {
  constructor(private eco: Economy) {
    super("Album", "album");
    eco.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    this.eco.loadAlbum().catch(() => {});
  }

  render() {
    this.body.replaceChildren();
    for (const [title, kinds] of [
      ["Fish", ["fish", "junk"]],
      ["Plants", ["plant"]],
    ] as [string, string[]][]) {
      const items = this.eco.ofKind(...kinds);
      const found = items.filter((i) => this.eco.album.has(i.id)).length;
      const head = el("h3", "", `${title} · ${found}/${items.length}`);
      if (found === items.length && items.length) head.append(el("span", "stamp", "Complete!"));
      this.body.append(head);
      const grid = el("div", "item-grid");
      for (const it of items) {
        const entry = this.eco.album.get(it.id);
        const cell = el("div", entry ? "item" : "item unknown");
        cell.append(icon(it), el("span", "name", entry ? it.name : "???"));
        if (entry) cell.append(el("span", "qty", `×${entry.total}`));
        if (!entry && it.meta.night) cell.append(el("span", "hint", "comes out at night"));
        grid.append(cell);
      }
      this.body.append(grid);
    }
  }
}

export class MarketPanel extends Panel {
  private tab: "sell" | "buy" = "sell";
  private err = el("p", "error");

  constructor(private eco: Economy) {
    super("Market cart", "market");
    eco.onChange(() => this.open && this.render());
  }

  private async act(f: () => Promise<void>) {
    this.err.textContent = "";
    try {
      await f();
    } catch (e) {
      this.err.textContent = e instanceof ApiError ? e.message : "That didn't work.";
    }
  }

  render() {
    this.body.replaceChildren();
    const tabs = el("div", "tabs");
    tabs.append(
      button("Sell", () => ((this.tab = "sell"), this.render()), this.tab === "sell" ? "on" : ""),
      button("Buy", () => ((this.tab = "buy"), this.render()), this.tab === "buy" ? "on" : ""),
    );
    const coins = el("div", "coins");
    coins.append(icon(this.eco.items.get(COIN)), `${this.eco.coins} coins`);
    this.body.append(tabs, coins, this.err);
    const list = el("div", "rows");
    if (this.tab === "sell") {
      const sellable = [...this.eco.items.values()].filter((i) => i.meta.sell && this.eco.qty(i.id) > 0);
      if (!sellable.length) list.append(el("p", "empty", "Nothing to sell yet: catch fish or grow flowers."));
      for (const it of sellable) {
        const n = this.eco.qty(it.id);
        const row = el("div", "row");
        row.append(icon(it), el("span", "name", `${it.name} ×${n}`), el("span", "price", `${it.meta.sell}c`));
        row.append(button("Sell 1", () => this.act(() => this.eco.sell(it.id, 1)), "small"));
        if (n > 1) row.append(button(`All ${n}`, () => this.act(() => this.eco.sell(it.id, Math.min(n, 99))), "small"));
        list.append(row);
      }
    } else {
      list.append(el("p", "empty", "Seeds, furniture and garden things are sold at the Commons Mall now: the big doors on the north side of the Market."));
    }
    this.body.append(list);
  }
}

export interface PlotInfo {
  plant: number;
  stage: number;
  watered: boolean;
  owner: string;
  stageLeftMs: number;
}

const STAGES = ["Seed", "Sprout", "Growing", "In bloom"];

/** Menu for one garden plot: plant / water / harvest. */
export class PlotMenu extends Panel {
  private tile = { x: 0, y: 0 };
  private info: PlotInfo | null = null;

  constructor(
    private eco: Economy,
    private act: (x: number, y: number, action: number, item: number) => void,
  ) {
    super("Garden plot", "plot");
    eco.onChange(() => this.open && this.render());
  }

  showFor(x: number, y: number, info: PlotInfo | null) {
    this.tile = { x, y };
    this.info = info && info.plant ? info : null;
    this.show();
  }

  update(x: number, y: number, info: PlotInfo) {
    if (this.open && this.tile.x === x && this.tile.y === y) {
      this.info = info.plant ? info : null;
      this.render();
    }
  }

  render() {
    this.body.replaceChildren();
    const { x, y } = this.tile;
    const p = this.info;
    if (!p) {
      const seeds = this.eco.ofKind("seed").filter((s) => this.eco.qty(s.id) > 0);
      this.body.append(el("p", "", seeds.length ? "Plant something:" : "You have no seeds. The market cart sells them."));
      for (const s of seeds) {
        const row = el("div", "row");
        row.append(icon(s), el("span", "name", `${s.name} ×${this.eco.qty(s.id)}`), button("Plant", () => (this.act(x, y, 1, s.id), this.hide()), "small"));
        this.body.append(row);
      }
      return;
    }
    const plant = this.eco.items.get(p.plant);
    const row = el("div", "row");
    row.append(icon(plant), el("span", "name", `${plant?.name ?? "Plant"}: ${STAGES[p.stage] ?? ""}`));
    this.body.append(row, el("p", "hint", `Planted by ${p.owner}`));
    if (p.stage >= 3) {
      this.body.append(button("Harvest", () => (this.act(x, y, 3, 0), this.hide()), "primary"));
    } else if (p.watered) {
      const mins = Math.ceil(p.stageLeftMs / 60000);
      this.body.append(el("p", "", `Watered. Growing: next stage in about ${mins >= 60 ? `${Math.round(mins / 60)} h` : `${mins} min`}.`));
    } else {
      this.body.append(el("p", "", "Thirsty: it won't grow until watered."), button("Water", () => (this.act(x, y, 2, 0), this.hide()), "primary"));
    }
  }
}

/**
 * The reel mini-game: a needle sweeps across a bar; stop it in the green.
 * Calls back with a quality score 0–1000, or never if the window passes.
 */
export class ReelGame {
  private el = el("div", "reel");
  private needle = el("div", "needle");
  private start = 0;
  private raf = 0;
  private done: ((q: number) => void) | null = null;
  private key = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      this.hit();
    }
  };

  constructor() {
    const bar = el("div", "bar");
    bar.append(el("div", "sweet"), this.needle);
    const btn = button("Reel in!", () => this.hit(), "primary");
    this.el.append(el("div", "title", "A bite! Stop the needle in the green"), bar, btn);
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  private pos(t: number) {
    // Back and forth, speeding up slightly.
    const s = (t - this.start) / 1000;
    return 0.5 + 0.5 * Math.sin(s * (5 + s * 2));
  }

  play(windowMs: number, done: (quality: number) => void) {
    this.done = done;
    this.start = performance.now();
    this.el.hidden = false;
    window.addEventListener("keydown", this.key, true);
    const frame = (t: number) => {
      this.needle.style.left = `${this.pos(t) * 100}%`;
      if (t - this.start > windowMs) return this.stop();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private hit() {
    if (!this.done) return;
    const d = Math.abs(this.pos(performance.now()) - 0.5);
    const quality = Math.max(0, Math.round(1000 - d * 2400));
    const f = this.done;
    this.stop();
    f(quality);
  }

  stop() {
    this.done = null;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.key, true);
    this.el.hidden = true;
  }

  destroy() {
    this.stop();
    this.el.remove();
  }
}

/** "Placing: Wooden Chair (Esc to cancel)". */
export class PlaceBanner {
  private el = el("div", "place-banner");
  item: Item | null = null;

  constructor(private onCancel: () => void) {
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  show(item: Item) {
    this.item = item;
    this.el.replaceChildren(icon(item), `Tap a spot to place your ${item.name}`, button("Cancel", () => this.onCancel(), "small"));
    this.el.hidden = false;
  }

  hide() {
    this.item = null;
    this.el.hidden = true;
  }

  destroy() {
    this.el.remove();
  }
}

/** A small titled menu of actions (e.g. "Wooden Chair: Pick up"). */
export class ActionMenu extends Panel {
  private actions: [string, () => void][] = [];
  private note = "";

  constructor() {
    super("", "action-menu");
  }

  showWith(title: string, note: string, actions: [string, () => void][]) {
    this.el.querySelector(".panel-head strong")!.textContent = title;
    this.note = note;
    this.actions = actions;
    this.show();
  }

  render() {
    this.body.replaceChildren();
    if (this.note) this.body.append(el("p", "hint", this.note));
    for (const [label, run] of this.actions) this.body.append(button(label, () => (this.hide(), run()), "primary"));
  }
}
