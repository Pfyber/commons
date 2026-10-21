// M3 panels: bag, album, market, garden plot menu, fishing reel mini-game
// and the furniture placement banner. Plain DOM, styled in styles.css.

import { COIN, type Economy, type Item } from "../economy";
import { ApiError } from "../net/api";
import { itemIconUrl } from "../world/items";
import { pxIcon } from "./icons";
import { TIERS, type Tier, tier } from "./rarity";

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
  // Fish wear their rarity: a coloured frame, common grey to mythical pink.
  if (item && (item.kind === "fish" || item.kind === "junk")) {
    img.classList.add("rarity", `rarity-${Math.max(0, Math.min(5, item.rarity))}`);
    img.title = `${item.name} · ${tier(item.rarity).name}`;
  }
  return img;
}

export function button(label: string, run: () => void, cls = ""): HTMLButtonElement {
  const b = el("button", cls, label);
  b.type = "button";
  b.onclick = run;
  return b;
}

/** When each two-tap button (by key) stops waiting for its second tap. */
const armedUntil = new Map<string, number>();

/**
 * A button for something you can't take back (leaving a game, resigning):
 * the first tap asks (`ask`), a second within 3 seconds does it. Keyed, so
 * a panel redrawn in between still remembers the first tap.
 */
export function confirmButton(key: string, label: string, ask: string, run: () => void, cls = "subtle"): HTMLButtonElement {
  const armed = () => performance.now() < (armedUntil.get(key) ?? 0);
  const b = button(armed() ? ask : label, () => {
    if (armed()) {
      armedUntil.delete(key);
      run();
      return;
    }
    armedUntil.set(key, performance.now() + 3000);
    b.textContent = ask;
    window.setTimeout(() => {
      if (b.isConnected && !armed()) b.textContent = label;
    }, 3050);
  }, cls);
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

  /**
   * Adds a button beside the close one that blows the panel up to fill the
   * screen (and back); remembered per panel. For the game tables: while big,
   * `canvas` is sized to the room left over by everything else in the panel
   * (less `besideW` px of things next to it), so nothing needs scrolling.
   */
  protected enlargeable(canvas: HTMLCanvasElement, besideW = 0) {
    const key = `commons.big.${this.el.className.split(" ")[1]}`;
    const fit = () => {
      if (!this.el.classList.contains("big") || this.el.hidden) {
        canvas.style.width = "";
        return;
      }
      const body = this.body;
      const gap = parseFloat(getComputedStyle(body).rowGap) || 0;
      let used = 0;
      let rows = 0;
      for (const child of Array.from(body.children) as HTMLElement[]) {
        rows++;
        if (child.contains(canvas)) {
          // what the canvas's own row adds around it (margins and the like)
          const cs = getComputedStyle(canvas);
          used += parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
          continue;
        }
        used += child.offsetHeight;
      }
      used += gap * Math.max(0, rows - 1);
      const h = body.clientHeight - used - 4;
      const w = body.clientWidth - besideW - 8;
      const width = Math.max(120, Math.min(w, (h * canvas.width) / canvas.height));
      canvas.style.width = `${Math.floor(width)}px`;
    };
    new ResizeObserver(fit).observe(this.body);
    new MutationObserver(() => requestAnimationFrame(fit)).observe(this.body, { childList: true, subtree: true });
    const btn = button("", () => set(!this.el.classList.contains("big")), "x");
    const set = (big: boolean) => {
      this.el.classList.toggle("big", big);
      requestAnimationFrame(fit);
      btn.replaceChildren(pxIcon(big ? "shrink" : "expand", 2));
      btn.title = big ? "Smaller" : "Bigger";
      btn.setAttribute("aria-label", btn.title);
      try {
        localStorage.setItem(key, big ? "1" : "0");
      } catch {
        // storage unavailable
      }
    };
    let big = false;
    try {
      big = localStorage.getItem(key) === "1";
    } catch {
      // storage unavailable
    }
    set(big);
    this.titleEl.after(btn);
    this.titleEl.style.marginRight = "auto";
  }

  destroy() {
    this.el.remove();
  }
}

/**
 * A choice in the middle of the screen over a blurred world, for the moment
 * you step up to a game: play the AI bot, or wait for someone. Each way to
 * play is a big card (icon, what it is, what's in it for you). It stays
 * until you pick (or back out).
 */
export class ChoiceModal {
  private el = el("div", "choice-modal");
  private card = el("div", "choice-card");
  /** What's on show, so re-renders don't rebuild it under your pointer. */
  private key = "";

  constructor() {
    this.el.hidden = true;
    this.el.append(this.card);
    document.body.appendChild(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  /**
   * Shows `title` (with `kicker` above it, `text` below) and a card per
   * choice; `back` is the way out ("Not now").
   */
  show(
    title: string,
    text: string,
    choices: { icon: string; label: string; sub?: string; primary?: boolean; pick: () => void }[],
    back: () => void,
    kicker = "",
  ) {
    const key = [kicker, title, text, ...choices.map((c) => c.label + c.sub)].join("|");
    this.el.hidden = false;
    if (key === this.key) return;
    this.key = key;
    this.card.replaceChildren();
    if (kicker) this.card.append(el("p", "choice-kicker", kicker));
    this.card.append(el("h3", "choice-title", title));
    if (text) this.card.append(el("p", "choice-text", text));
    const row = el("div", "choice-options");
    for (const c of choices) {
      const b = el("button", c.primary ? "choice-opt main" : "choice-opt");
      b.type = "button";
      b.append(el("span", "choice-icon", c.icon), el("span", "choice-label", c.label));
      if (c.sub) b.append(el("span", "choice-sub", c.sub));
      b.onclick = () => {
        this.hide();
        c.pick();
      };
      row.append(b);
    }
    const no = el("button", "choice-back", "Not now");
    no.type = "button";
    no.onclick = () => {
      this.hide();
      back();
    };
    this.card.append(row, no);
  }

  hide() {
    this.el.hidden = true;
    this.key = "";
  }

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
  ["ticket", "Arcade tickets"],
  ["tool", "Gear"],
  ["crate", "Lucky finds"],
];

export class BagPanel extends Panel {
  placeable = false;

  constructor(
    private eco: Economy,
    private onPlace: (item: Item) => void,
    private onOpen: (item: Item) => void = () => {},
  ) {
    super("Bag", "bag");
    eco.onChange(() => this.open && this.render());
  }

  render() {
    this.body.replaceChildren();
    const coins = el("div", "coins");
    coins.append(icon(this.eco.items.get(COIN)), `$${this.eco.coins}`);
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
        if (kind === "crate") {
          // One crate per tap: held off a moment so a double tap can't ask twice.
          const open = button("Open", () => {
            open.disabled = true;
            this.onOpen(it);
            window.setTimeout(() => (open.disabled = false), 1500);
          }, "small");
          cell.append(open);
        }
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
    coins.append(icon(this.eco.items.get(COIN)), `$${this.eco.coins}`);
    this.body.append(tabs, coins, this.err);
    const list = el("div", "rows");
    if (this.tab === "sell") {
      const sellable = [...this.eco.items.values()].filter((i) => i.meta.sell && this.eco.qty(i.id) > 0);
      if (!sellable.length) list.append(el("p", "empty", "Nothing to sell yet: catch fish or grow flowers."));
      for (const it of sellable) {
        const n = this.eco.qty(it.id);
        const row = el("div", "row");
        row.append(icon(it), el("span", "name", `${it.name} ×${n}`), el("span", "price", `$${it.meta.sell}`));
        row.append(button("Sell 1", () => this.act(() => this.eco.sell(it.id, 1)), "small"));
        if (n > 1) row.append(button(`All ${n}`, () => this.act(() => this.eco.sell(it.id, Math.min(n, 99))), "small"));
        list.append(row);
      }
    } else {
      for (const it of this.eco.ofKind("seed", "furniture").filter((i) => i.meta.buy)) {
        const row = el("div", "row");
        const b = button("Buy", () => this.act(() => this.eco.buy(it.id, 1)), "small");
        b.disabled = this.eco.coins < (it.meta.buy ?? 0);
        row.append(icon(it), el("span", "name", it.name), el("span", "price", `$${it.meta.buy}`), b);
        list.append(row);
      }
    }
    this.body.append(list);
  }
}

/**
 * The fisherman on the pier: he buys your catch, a coin for a minnow up to
 * ten for a dragonfish. His board lists every fish, rarest (and dearest)
 * first, each in its rarity's colour; ones you've never landed are a mystery.
 */
export class FishermanPanel extends Panel {
  private err = el("p", "error");
  private busy = false;

  constructor(
    private eco: Economy,
    private onSold: (coins: number, best: Item) => void,
    private onRod: () => void,
    private onLure: () => void = () => {},
  ) {
    super("🎣 The Fisherman", "fisherman");
    eco.onChange(() => this.open && !this.busy && this.render());
  }

  private fish(): Item[] {
    return [...this.eco.items.values()]
      .filter((i) => (i.kind === "fish" || i.kind === "junk") && i.meta.sell)
      .sort((a, b) => (b.meta.sell ?? 0) - (a.meta.sell ?? 0) || b.rarity - a.rarity);
  }

  private async sell(list: [Item, number][]) {
    if (this.busy || !list.length) return;
    this.busy = true;
    this.err.textContent = "";
    let coins = 0;
    try {
      for (const [it, n] of list) {
        await this.eco.sell(it.id, n);
        coins += (it.meta.sell ?? 0) * n;
      }
    } catch (e) {
      this.err.textContent = e instanceof ApiError ? e.message : "He shook his head. Try again?";
    }
    this.busy = false;
    if (coins) this.onSold(coins, list[0][0]);
    this.render();
  }

  private async buyRod() {
    if (this.busy) return;
    this.busy = true;
    this.err.textContent = "";
    try {
      await this.eco.buy(ROD_ITEM, 1);
      this.onRod();
    } catch (e) {
      this.err.textContent = e instanceof ApiError ? e.message : "He shook his head. Try again?";
    }
    this.busy = false;
    this.render();
  }

  private async buyLure() {
    if (this.busy) return;
    this.busy = true;
    this.err.textContent = "";
    try {
      await this.eco.buy(LURE_ITEM, 1);
      this.onLure();
    } catch (e) {
      this.err.textContent = e instanceof ApiError ? e.message : "He shook his head. Try again?";
    }
    this.busy = false;
    this.render();
  }

  render() {
    this.body.replaceChildren();
    const all = this.fish();
    const mine = all.filter((i) => this.eco.qty(i.id) > 0).map((i) => [i, Math.min(99, this.eco.qty(i.id))] as [Item, number]);
    const total = mine.reduce((sum, [i, n]) => sum + (i.meta.sell ?? 0) * n, 0);
    const head = el("div", "fisher-head");
    const coins = el("div", "coins");
    coins.append(icon(this.eco.items.get(COIN)), `$${this.eco.coins}`);
    const all_btn = button(total ? `Sell the lot · +$${total}` : "Nothing to sell yet", () => this.sell(mine), "primary");
    all_btn.disabled = !total || this.busy;
    head.append(coins, all_btn);
    this.body.append(el("p", "hint", "\"I'll buy whatever you pull out of that pond. The rarer it is, the more it's worth.\""), head, this.err);
    // His one thing for sale: a better rod.
    const rod = this.eco.items.get(ROD_ITEM);
    if (rod) {
      const owned = this.eco.qty(ROD_ITEM) > 0;
      const price = rod.meta.buy ?? 0;
      const card = el("div", `fisher-rod${owned ? " owned" : ""}`);
      const text = el("div", "fisher-rod-text");
      text.append(el("b", "", `🎣 ${rod.name} · $${price}`), el("small", "", "Fish bite 25% sooner · a slower needle · one more swing to catch it"));
      card.append(icon(rod), text);
      if (owned) card.append(el("span", "fisher-rod-owned", "✓ Yours"));
      else {
        const buy = button(`Buy · $${price}`, () => this.buyRod(), "primary");
        buy.disabled = this.busy || this.eco.coins < price;
        card.append(buy);
      }
      this.body.append(card);
    }
    // …and glimmer lures, as many as you like.
    const lure = this.eco.items.get(LURE_ITEM);
    if (lure) {
      const have = this.eco.qty(LURE_ITEM);
      const price = lure.meta.buy ?? 0;
      const card = el("div", "fisher-rod fisher-lure");
      const text = el("div", "fisher-rod-text");
      text.append(
        el("b", "", `✨ ${lure.name} · $${price}${have ? ` · you have ${have}` : ""}`),
        el("small", "", "Throw it in the water: for 5 minutes, rarer fish bite in the circle round it, for anyone fishing there"),
      );
      card.append(icon(lure), text);
      const buy = button(`Buy · $${price}`, () => this.buyLure(), "primary");
      buy.disabled = this.busy || this.eco.coins < price;
      card.append(buy);
      this.body.append(card);
    }
    // The tiers, as a key.
    const key = el("div", "fisher-key");
    for (const t of TIERS) {
      const chip = el("span", "chip", t.name);
      chip.style.setProperty("--tier", t.color);
      key.append(chip);
    }
    this.body.append(key);
    const list = el("div", "rows fisher-rows");
    for (const it of all) {
      const t: Tier = tier(it.rarity);
      const n = this.eco.qty(it.id);
      const known = n > 0 || this.eco.album.has(it.id);
      const row = el("div", `row fisher-row tier-${Math.max(0, Math.min(5, it.rarity))}${known ? "" : " unknown"}`);
      row.style.setProperty("--tier", t.color);
      const name = el("span", "name");
      name.append(el("b", "", known ? it.name : "???"), el("small", "tier-name", t.name + (it.meta.night ? " · night" : "")));
      row.append(icon(it), name, el("span", "qty", n ? `×${n}` : ""), el("span", "price", `$${it.meta.sell}`));
      const one = button("Sell 1", () => this.sell([[it, 1]]), "small");
      one.disabled = !n || this.busy;
      row.append(one);
      if (n > 1) row.append(button(`All ${n}`, () => this.sell([[it, Math.min(n, 99)]]), "small"));
      list.append(row);
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
/** The upgraded rod (item): the needle's pace, and the most it adds to the reel window (the server allows a little more). */
export const ROD_ITEM = 112;
/** The fisherman's glimmer lure (server `fishing::LURE_ITEM`). */
export const LURE_ITEM = 117;
const ROD_PACE = 0.85;
const ROD_EXTRA_MAX_MS = 3000;

/** Rare fish and up, missed, may stay hooked for one more swing (the server holds them this long: 3 s). */
const SECOND_CHANCE_FROM = 2;
const SECOND_CHANCE_MAX_MS = 2800;
/** Legendary and mythical fish must be stopped in the zone twice (the server holds them 2 s longer). */
const DOUBLE_HIT_FROM = 4;
const DOUBLE_HIT_MS = 1800;

export class ReelGame {
  private el = el("div", "reel");
  private needle = el("div", "needle");
  private sweet = el("div", "sweet");
  private title = el("div", "title");
  private start = 0;
  /** This bite's difficulty (rarity tier), and the needle's pace (slower with the upgraded rod). */
  private tier: Tier = TIERS[0];
  private pace = TIERS[0].pace;
  /** When the fish gets away; a rare one, missed, may stay hooked once (pushing it back). */
  private deadline = 0;
  private rarity = 0;
  private secondChance = false;
  /** A two-hit fish: the first hit's quality, once landed. */
  private firstHit = 0;
  private raf = 0;
  private done: ((q: number) => void) | null = null;
  private key = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      // A held key repeats: those aren't taps (they'd hit wherever the needle happens to be).
      if (!e.repeat) this.hit();
    }
  };

  constructor() {
    const bar = el("div", "bar");
    bar.append(this.sweet, this.needle);
    // Counted the moment it's pressed (a click comes on release, a beat late).
    const btn = button("Reel in!", () => {}, "primary");
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.hit();
    });
    this.el.append(this.title, bar, btn);
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  private pos(t: number) {
    // Back and forth from one end, quicker the rarer the fish.
    const s = (t - this.start) / 1000;
    return 0.5 + 0.5 * Math.sin(s * this.pace - Math.PI / 2);
  }

  /**
   * A bite: reel in within `windowMs`; `rarity` (0–5) sets how hard it is.
   * With the upgraded `rod` the needle moves a little slower and swings
   * through once more before the fish gets away.
   */
  play(windowMs: number, done: (quality: number) => void, rarity = 0, rod = false) {
    this.done = done;
    this.tier = tier(rarity);
    this.pace = this.tier.pace * (rod ? ROD_PACE : 1);
    if (rod) windowMs += Math.min(ROD_EXTRA_MAX_MS, ((2 * Math.PI) / this.pace) * 1000);
    const w = this.tier.sweet;
    this.sweet.style.left = `${(0.5 - w) * 100}%`;
    this.sweet.style.width = `${w * 200}%`;
    this.sweet.style.background = this.tier.color;
    this.el.style.setProperty("--tier", this.tier.color);
    this.el.className = `reel tier-${Math.max(0, Math.min(5, rarity))}`;
    this.title.replaceChildren();
    const name = el("b", "", this.tier.name.toUpperCase());
    name.style.color = this.tier.color;
    this.title.append(rarity >= 3 ? "‼️ " : "", name, " bite! Stop the needle in the coloured zone", rarity >= DOUBLE_HIT_FROM ? " twice" : "", rod ? " (🎣 Angler's Rod: an extra swing)" : "");
    this.start = performance.now();
    this.deadline = this.start + windowMs;
    this.rarity = rarity;
    this.secondChance = false;
    this.firstHit = 0;
    if (rarity >= DOUBLE_HIT_FROM) this.deadline += DOUBLE_HIT_MS;
    this.el.hidden = false;
    window.addEventListener("keydown", this.key, true);
    const frame = (t: number) => {
      this.needle.style.left = `${this.pos(t) * 100}%`;
      if (t > this.deadline) return this.stop();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private hit() {
    if (!this.done) return;
    // In the zone (a hair of slack at its edges): the closer to its middle the better.
    const d = Math.abs(this.pos(performance.now()) - 0.5);
    const w = this.tier.sweet + 0.008;
    const quality = d <= w ? Math.round(1000 - (d / w) * 600) : 0;
    // Missed a rare one: a coin flip says whether it stays hooked for one more go.
    if (quality === 0 && this.rarity >= SECOND_CHANCE_FROM && !this.secondChance && Math.random() < 0.5) {
      this.secondChance = true;
      this.deadline += Math.min(SECOND_CHANCE_MAX_MS, ((2 * Math.PI) / this.pace) * 1000);
      this.title.replaceChildren(el("span", "lucky-note", "🍀 Lucky! Still hooked, try again"));
      this.el.classList.remove("lucky");
      void this.el.offsetWidth;
      this.el.classList.add("lucky");
      return;
    }
    // A big one needs a second hit; the catch is as good as the two together.
    if (quality > 0 && this.rarity >= DOUBLE_HIT_FROM && !this.firstHit) {
      this.firstHit = quality;
      this.title.replaceChildren(el("span", "lucky-note", "💪 Hit! Once more to land it"));
      return;
    }
    const f = this.done;
    this.stop();
    f(quality > 0 && this.firstHit ? Math.round((quality + this.firstHit) / 2) : quality);
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
