// M3 panels: bag, album, market, garden plot menu, fishing reel mini-game
// and the furniture placement banner. Plain DOM, styled in styles.css.

import { till } from "../ambient/salvagesfx";
import { COIN, type Economy, type FishQuest, type Item } from "../economy";
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
  if (item && ["fish", "junk", "bug", "shroom", "scrap"].includes(item.kind)) {
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
const NOT_TYPED = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  // (A slider, checkbox or button that's kept the focus isn't: the keys still walk.)
  if (t instanceof HTMLInputElement) return !NOT_TYPED.has(t.type);
  return !!t && (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable);
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

  /** A game board or the map: stays open when the world behind it is tapped. */
  sticky = false;

  /**
   * A tap on the world while a menu or shop is open: it was meant for the
   * window (closing it, or a slip of the finger), not a walk. Closes it and
   * says so (game boards and the map stay open: see `sticky`).
   */
  static dismissOnWorldTap(): boolean {
    const p = Panel.current;
    if (!p || !p.open || p.sticky) return false;
    p.hide();
    return true;
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
  ["scrap", "Salvage"],
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
  ["ticket", "Arcade tickets"],
  ["crate", "Lucky finds"],
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
    /** Opening a lucky crate. */
    private onOpen: (item: Item) => void = () => {},
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
    if (!any) this.body.append(el("p", "empty", "Your bag is empty. Try fishing at the pond or a look round the Commons Mall."));
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

/**
 * The fisherman on the pier: he buys your catch, a coin for a minnow up to
 * ten for a dragonfish. His board lists every fish, rarest (and dearest)
 * first, each in its rarity's colour; ones you've never landed are a mystery.
 */
export class FishermanPanel extends Panel {
  private err = el("p", "error");
  private busy = false;
  /** Which tab: his shop, today's fish order, or today's magnet order (each once fetched). */
  private tab: "shop" | "quest" | "magnet" = "shop";
  private quest: FishQuest | null = null;
  private magnetQuest: FishQuest | null = null;
  /** Told when one of the day's orders is filled (for a cheer). */
  onQuestDone: (magnet: boolean) => void = () => {};

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
      .filter((i) => (i.kind === "fish" || i.kind === "junk" || i.kind === "scrap") && i.meta.sell)
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
      till(this.eco.items.get(ROD_ITEM)?.meta.buy ?? 0);
      this.onRod();
    } catch (e) {
      this.err.textContent = e instanceof ApiError ? e.message : "He shook his head. Try again?";
    }
    this.busy = false;
    this.render();
  }

  private async buyMagnet() {
    if (this.busy) return;
    this.busy = true;
    this.err.textContent = "";
    try {
      await this.eco.buy(MAGNET_ITEM, 1);
      till(this.eco.items.get(MAGNET_ITEM)?.meta.buy ?? 0);
    } catch (e) {
      this.err.textContent = e instanceof ApiError ? e.message : "He shook his head. Try again?";
    }
    this.busy = false;
    this.render();
  }

  private async buyLure(item = LURE_ITEM) {
    if (this.busy) return;
    this.busy = true;
    this.err.textContent = "";
    try {
      await this.eco.buy(item, 1);
      till(this.eco.items.get(item)?.meta.buy ?? 0);
      this.onLure();
    } catch (e) {
      this.err.textContent = e instanceof ApiError ? e.message : "He shook his head. Try again?";
    }
    this.busy = false;
    this.render();
  }

  render() {
    this.body.replaceChildren();
    // Three tabs: his shop, today's fish order, today's magnet order.
    const tabs = el("div", "tier-row fisher-tabs");
    const so = (q: FishQuest | null) => (q && !q.done ? ` · ${q.given}/${q.need}` : q?.done ? " ✓" : "");
    tabs.append(
      button("🛒 Shop", () => ((this.tab = "shop"), this.render()), this.tab === "shop" ? "small on" : "small"),
      button(`📜 Daily order${so(this.quest)}`, () => ((this.tab = "quest"), this.render(), void this.loadQuest()), this.tab === "quest" ? "small on" : "small"),
      button(`🧲 Magnet order${so(this.magnetQuest)}`, () => ((this.tab = "magnet"), this.render(), void this.loadQuest()), this.tab === "magnet" ? "small on" : "small"),
    );
    if (this.tab !== "shop") {
      this.body.append(tabs);
      this.renderQuest();
      return;
    }
    this.renderShop();
    this.body.prepend(tabs);
  }

  /** The order on the tab that's open, fetched fresh. */
  private async loadQuest() {
    const magnet = this.tab === "magnet";
    try {
      const q = await this.eco.fishQuest(magnet);
      if (magnet) this.magnetQuest = q;
      else this.quest = q;
    } catch (e) {
      this.err.textContent = e instanceof ApiError ? e.message : "He can't think what he wants just now.";
    }
    if (this.open) this.render();
  }

  /** Hands what he still wants of `it` (as many as you have) over. */
  private async deliver(it: Item, qty: number) {
    if (this.busy) return;
    this.busy = true;
    this.err.textContent = "";
    const magnet = this.tab === "magnet";
    try {
      const before = (magnet ? this.magnetQuest : this.quest)?.items.find((x) => x.item === it.id);
      const q = await this.eco.deliverFish(it.id, qty, magnet);
      if (magnet) this.magnetQuest = q;
      else this.quest = q;
      const paid = (before?.price ?? 0) * qty;
      this.onSold(paid, it);
      if (q.done) this.onQuestDone(magnet);
    } catch (e) {
      this.err.textContent = e instanceof ApiError ? e.message : "He shook his head. Try again?";
    }
    this.busy = false;
    this.render();
  }

  private renderQuest() {
    const magnet = this.tab === "magnet";
    const q = magnet ? this.magnetQuest : this.quest;
    if (!q) {
      this.body.append(el("p", "hint", "\"Now, what was I after today…\""), this.err);
      void this.loadQuest();
      return;
    }
    const left = Math.max(0, q.ends - Date.now() / 1000);
    const h = Math.floor(left / 3600);
    const m = Math.floor((left % 3600) / 60);
    this.body.append(
      el("p", "hint", q.done ? "\"That's the lot! Grand. Come back for my next order.\"" : magnet ? "\"Fish these up off the bottom with a magnet and I'll pay three times the going rate.\"" : "\"Bring me these and I'll pay three times the going rate. Every one.\""),
    );
    if (magnet && !q.done && this.eco.qty(MAGNET_ITEM) <= 0) this.body.append(el("p", "hint", "You'll need a Salvage Magnet first: it's in his shop."));
    // The order's progress, all three things together.
    const bar = el("div", "quest-bar");
    const fill = el("i");
    fill.style.width = `${q.need ? (100 * q.given) / q.need : 0}%`;
    bar.append(fill, el("span", "", `${q.given} / ${q.need}${q.done ? " ✓ done" : ""}`));
    this.body.append(bar, el("p", "hint quest-time", `${q.done ? "Next order" : "A new order"} in ${h}h ${m}m`), this.err);
    const list = el("div", "rows fisher-rows quest-rows");
    for (const want of q.items) {
      const it = this.eco.items.get(want.item);
      if (!it) continue;
      const t: Tier = tier(it.rarity);
      const have = this.eco.qty(it.id);
      const still = want.need - want.given;
      const row = el("div", `row fisher-row quest-row tier-${Math.max(0, Math.min(5, it.rarity))}${still <= 0 ? " filled" : ""}`);
      row.style.setProperty("--tier", t.color);
      const name = el("span", "name");
      name.append(el("b", "", `${want.need}× ${it.name}`), el("small", "", ` ${t.name} · ${want.price} coins each (3×) · you have ${have}`));
      row.append(icon(it), name, el("span", "price", `${want.given}/${want.need}`));
      if (still <= 0) row.append(el("span", "fisher-rod-owned", "✓"));
      else {
        const n = Math.min(have, still);
        const give = button(n ? `Hand over ${n} · +${n * want.price}` : magnet ? "Go salvage some" : "Go catch some", () => this.deliver(it, n), n ? "small primary" : "small");
        give.disabled = !n || this.busy;
        row.append(give);
      }
      list.append(row);
    }
    this.body.append(list);
  }

  private renderShop() {
    this.body.replaceChildren();
    const all = this.fish();
    const mine = all.filter((i) => this.eco.qty(i.id) > 0).map((i) => [i, Math.min(99, this.eco.qty(i.id))] as [Item, number]);
    const total = mine.reduce((sum, [i, n]) => sum + (i.meta.sell ?? 0) * n, 0);
    const head = el("div", "fisher-head");
    const coins = el("div", "coins");
    coins.append(icon(this.eco.items.get(COIN)), `${this.eco.coins} coins`);
    const all_btn = button(total ? `Sell the lot · +${total} coins` : "Nothing to sell yet", () => this.sell(mine), "primary");
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
        const buy = button(`Buy · ${price} coins`, () => this.buyRod(), "primary");
        buy.disabled = this.busy || this.eco.coins < price;
        card.append(buy);
      }
      this.body.append(card);
    }
    // The salvage magnet: scrap from the bottom (he buys that too).
    const magnet = this.eco.items.get(MAGNET_ITEM);
    if (magnet) {
      const owned = this.eco.qty(MAGNET_ITEM) > 0;
      const price = magnet.meta.buy ?? 0;
      const card = el("div", `fisher-rod fisher-magnet${owned ? " owned" : ""}`);
      const text = el("div", "fisher-rod-text");
      text.append(el("b", "", `🧲 ${magnet.name} · $${price}`), el("small", "", "Drop it in instead of a line: it finds scrap on the bottom (slowly), then haul it up in the salvage game. I buy the scrap."));
      card.append(icon(magnet), text);
      if (owned) card.append(el("span", "fisher-rod-owned", "✓ Yours"));
      else {
        const buy = button(`Buy · ${price} coins`, () => this.buyMagnet(), "primary");
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
    // …and, for the deep of pocket, the legendary one.
    const gold = this.eco.items.get(GOLD_LURE_ITEM);
    if (gold) {
      const have = this.eco.qty(GOLD_LURE_ITEM);
      const price = gold.meta.buy ?? 0;
      const card = el("div", "fisher-rod fisher-lure fisher-gold");
      const text = el("div", "fisher-rod-text");
      text.append(
        el("b", "", `🌟 ${gold.name} · $${price}${have ? ` · you have ${have}` : ""}`),
        el("small", "", "Turns its circle of water gold for 3 minutes: only epic fish and rarer bite there, for anyone fishing in it"),
      );
      card.append(icon(gold), text);
      const buy = button(`Buy · $${price}`, () => this.buyLure(GOLD_LURE_ITEM), "primary");
      buy.disabled = this.busy || this.eco.coins < price;
      card.append(buy);
      this.body.append(card);
    }
    // …and one for the magnet.
    const ml = this.eco.items.get(MAGNET_LURE_ITEM);
    if (ml) {
      const have = this.eco.qty(MAGNET_LURE_ITEM);
      const price = ml.meta.buy ?? 0;
      const card = el("div", "fisher-rod fisher-lure");
      const text = el("div", "fisher-rod-text");
      text.append(
        el("b", "", `🧲 ${ml.name} · $${price}${have ? ` · you have ${have}` : ""}`),
        el("small", "", "Attracts rare metals to the area of your magnet. Turns its circle of water purple for 5 minutes"),
      );
      card.append(icon(ml), text);
      const buy = button(`Buy · $${price}`, () => this.buyLure(MAGNET_LURE_ITEM), "primary");
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
    // Two lists: what comes up on a line, and under it what the magnet pulls up.
    const fromRod = el("div", "rows fisher-rows");
    const fromMagnet = el("div", "rows fisher-rows");
    for (const it of all) {
      const list = it.kind === "scrap" ? fromMagnet : fromRod;
      const t: Tier = tier(it.rarity);
      const n = this.eco.qty(it.id);
      const known = n > 0 || this.eco.album.has(it.id);
      const row = el("div", `row fisher-row tier-${Math.max(0, Math.min(5, it.rarity))}${known ? "" : " unknown"}`);
      row.style.setProperty("--tier", t.color);
      const name = el("span", "name");
      name.append(el("b", "", known ? it.name : "???"), el("small", "tier-name", t.name + (it.meta.night ? " · night" : "")));
      row.append(icon(it), name, el("span", "qty", n ? `×${n}` : ""), el("span", "price", `${it.meta.sell}c`));
      const one = button("Sell 1", () => this.sell([[it, 1]]), "small");
      one.disabled = !n || this.busy;
      row.append(one);
      if (n > 1) row.append(button(`All ${n}`, () => this.sell([[it, Math.min(n, 99)]]), "small"));
      list.append(row);
    }
    const section = (title: string, rows: HTMLElement) => {
      const c = el("div", "fisher-col");
      c.append(el("h4", "fisher-col-head", title), rows);
      return c;
    };
    this.body.append(section("🎣 Fish", fromRod), section("🧲 Magnet finds", fromMagnet));
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
      this.body.append(el("p", "", seeds.length ? "Plant something:" : "You have no seeds. The Commons Mall sells them."));
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
/** The legendary lure (server `fishing::GOLD_LURE_ITEM`). */
export const GOLD_LURE_ITEM = 119;
/** The Glimmering Magnet Lure (server `fishing::MAGNET_LURE_ITEM`). */
export const MAGNET_LURE_ITEM = 142;
/** The salvage magnet (server `fishing::MAGNET_ITEM`). */
export const MAGNET_ITEM = 120;
const ROD_PACE = 0.85;
const ROD_EXTRA_MAX_MS = 3000;

/** Rare fish and up, missed, may stay hooked for one more swing (the server holds them this long: 3 s). */
const SECOND_CHANCE_FROM = 2;
const SECOND_CHANCE_MAX_MS = 2800;
/** The magnet's reel game, as the server reads it (`fishing::SALVAGE_BEST`): the middle, the band round it. */
const MAGNET_BEST = 1000;
const MAGNET_BAND = 500;
/** How many times the needle swings there and back, and a moment more (ms). (Fits the server's `MAGNET_REEL_MS`.) */
const MAGNET_SWINGS = 2;
const MAGNET_SLACK_MS = 250;
/** Half the band's width: well wide, quite easy to hit. */
const MAGNET_BAND_W = 0.3;
/** Legendary and mythical fish must be stopped in the zone twice (the server holds them 2 s longer). */
const DOUBLE_HIT_FROM = 4;
const DOUBLE_HIT_MS = 1800;

export class ReelGame {
  private el = el("div", "reel");
  private needle = el("div", "needle");
  private sweet = el("div", "sweet");
  /** The magnet's game: the easy band round the middle, a rarity down. */
  private band = el("div", "sweet band");
  private title = el("div", "title");
  private magnet = false;
  /** Half the middle's width and the band's, in the magnet's game. */
  private middle = 0;
  private bandW = 0;
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
      e.stopPropagation();
      // A held key repeats: those aren't taps (they'd hit wherever the needle happens to be).
      if (!e.repeat) this.hit();
    }
  };

  constructor() {
    const bar = el("div", "bar");
    this.band.hidden = true;
    bar.append(this.band, this.sweet, this.needle);
    // Counted the moment it's pressed (a click comes on release, a beat late).
    const btn = button("Reel in! (Space)", () => {}, "primary");
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.hit();
    });
    this.el.append(this.title, bar, btn);
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  /** When "Reel in!" was last pressed (the bar hides at once, but the click's release comes after). */
  hitAt = -Infinity;

  /** Whether a bite is being reeled in right now, or was just now (its click still finishing). */
  get active(): boolean {
    return !this.el.hidden || performance.now() - this.hitAt < 700;
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
    this.magnet = false;
    this.band.hidden = true;
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
    // Space reels in: out of the chat box (or anything else being typed in) so it does.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
    window.addEventListener("keydown", this.key, true);
    const frame = (t: number) => {
      this.needle.style.left = `${this.pos(t) * 100}%`;
      if (t > this.deadline) {
        // (The magnet's told, so it isn't left waiting out the server's time.)
        const f = this.magnet ? this.done : null;
        this.stop();
        return f?.(0);
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  /**
   * The magnet's found something of `rarity`: the same bar, its middle (as
   * hard as a fish that rare) that thing, and an easy band round it a rarity
   * lower. `done` is told which: `MAGNET_BEST`, `MAGNET_BAND`, or 0 for a miss
   * (or too late: the needle swings there and back `MAGNET_SWINGS` times, however
   * quick it is). (Common's only got the easy one: there's nothing below it.)
   */
  playMagnet(rarity: number, done: (quality: number) => void) {
    const r = Math.max(0, Math.min(5, rarity));
    this.play(MAGNET_SWINGS * ((2 * Math.PI) / tier(r).pace) * 1000 + MAGNET_SLACK_MS, done);
    this.magnet = true;
    this.tier = tier(r);
    this.pace = this.tier.pace;
    this.middle = r ? this.tier.sweet : MAGNET_BAND_W;
    this.bandW = r ? MAGNET_BAND_W : 0;
    this.sweet.style.left = `${(0.5 - this.middle) * 100}%`;
    this.sweet.style.width = `${this.middle * 200}%`;
    this.sweet.style.background = this.tier.color;
    this.el.style.setProperty("--tier", this.tier.color);
    this.el.className = `reel tier-${r}`;
    const name = el("b", "", this.tier.name.toUpperCase());
    name.style.color = this.tier.color;
    this.title.replaceChildren("🧲 ", name);
    if (r) {
      const low = tier(r - 1);
      this.band.hidden = false;
      this.band.style.left = `${(0.5 - MAGNET_BAND_W) * 100}%`;
      this.band.style.width = `${MAGNET_BAND_W * 200}%`;
      this.band.style.background = low.color;
      const lower = el("b", "", low.name.toUpperCase());
      lower.style.color = low.color;
      this.title.append(" in the middle, ", lower, " round it: stop the needle!");
    } else this.title.append(": stop the needle in the coloured zone!");
  }

  private hit() {
    if (!this.done) return;
    this.hitAt = performance.now();
    // In the zone (a hair of slack at its edges): the closer to its middle the better.
    const d = Math.abs(this.pos(performance.now()) - 0.5);
    if (this.magnet) {
      const f = this.done;
      const q = d <= this.middle + 0.008 ? MAGNET_BEST : d <= this.bandW + 0.008 ? MAGNET_BAND : 0;
      this.stop();
      return f(q);
    }
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
