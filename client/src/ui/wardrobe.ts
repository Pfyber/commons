// The changing room (the tailor's tent, the wardrobe at home, the fitting
// room in the clothes shop) and the clothes shop itself: a live preview that
// walks and turns, and every option shown on you. While you try things on,
// your avatar wears them too, but only you see it.
//
// In a changing room you wear clothes you own. In the shop you can try on
// anything, then buy what's new and wear it, or cancel.

import type { Economy, Item } from "../economy";
import { ApiError } from "../net/api";
import { HAIR_COLORS, SKIN_COLORS, avatarCanvas } from "../world/art";
import { ACCESSORIES, HAIRSTYLES, HATS, type Look, OUTFITS, decodeLook, encodeLook, randomLook } from "../world/look";
import { Panel, button, el } from "./panels";

export type Tab = "hair" | "outfit" | "hat" | "extras" | "skin";
export type Mode = "room" | "shop";
type Slot = "outfit" | "hat" | "accessory";

const ROOM_TABS: [Tab, string][] = [
  ["hair", "Hair"],
  ["outfit", "Outfit"],
  ["hat", "Hat"],
  ["extras", "Extras"],
  ["skin", "Skin"],
];
const SHOP_TABS: [Tab, string][] = [
  ["outfit", "Outfits"],
  ["hat", "Hats"],
  ["extras", "Accessories"],
];
const SLOTS: Slot[] = ["outfit", "hat", "accessory"];

/** 16 outfit hues and 12 hat hues, as look bytes. */
const OUTFIT_HUES = Array.from({ length: 16 }, (_, i) => i * 16);
const HAT_HUES = Array.from({ length: 12 }, (_, i) => Math.round((i * 256) / 12));
const hsl = (byte: number, s: number, l: number) => `hsl(${Math.round((byte * 360) / 256)} ${s}% ${l}%)`;

const pieceOf = (l: Look, slot: Slot) => (slot === "outfit" ? l.outfit : slot === "hat" ? l.hat : l.accessory);
const withPiece = (slot: Slot, i: number): Partial<Look> => (slot === "outfit" ? { outfit: i } : slot === "hat" ? { hat: i } : { accessory: i });

/** Draws `look` at `scale`× on a fresh canvas (pixel-crisp). */
function figure(look: number, scale: number, frame: 0 | 1 | 2 = 0, flip = false): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 24 * scale;
  c.height = 34 * scale;
  paint(c, look, frame, flip);
  return c;
}

function paint(c: HTMLCanvasElement, look: number, frame: 0 | 1 | 2, flip: boolean) {
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.save();
  if (flip) {
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(avatarCanvas(look, frame), 0, 0, c.width, c.height);
  ctx.restore();
}

export interface WardrobeHooks {
  /** The look you're wearing (saved). */
  current(): number;
  /** A changing room: wear clothes you own. */
  wear(look: number): Promise<void>;
  /** The shop: buy the new clothes in `look` for `price` coins, and wear it. */
  buy(look: number, price: number): Promise<void>;
  /** Shows `look` on your avatar while you try things on (only you see it). */
  preview(look: number): void;
}

export class WardrobePanel extends Panel {
  private look: Look = decodeLook(0);
  private mode: Mode = "room";
  private tab: Tab = "hair";
  private preview = document.createElement("canvas");
  private raf = 0;
  private msg = el("p", "error");
  private saving = false;

  constructor(
    private eco: Economy,
    private hooks: WardrobeHooks,
  ) {
    super("Changing room", "wardrobe");
    this.preview.width = 24 * 5;
    this.preview.height = 34 * 5;
    this.preview.className = "wardrobe-preview";
    eco.onChange(() => this.open && !this.saving && this.render());
  }

  /** Opens a changing room (or, with mode "shop", the shop) titled `title`. */
  openAs(title: string, mode: Mode = "room", tab?: Tab) {
    // Moving between the shop's racks keeps what you're trying on.
    const same = this.open && this.mode === mode;
    this.titleEl.textContent = title;
    this.mode = mode;
    const tabs = mode === "shop" ? SHOP_TABS : ROOM_TABS;
    this.tab = tab ?? (same && tabs.some(([t]) => t === this.tab) ? this.tab : tabs[0][0]);
    if (!same) this.look = decodeLook(this.hooks.current());
    this.msg.textContent = "";
    this.show();
  }

  show() {
    super.show();
    cancelAnimationFrame(this.raf);
    const tick = (t: number) => {
      // Walk a few steps one way, stand, walk back: see it from both sides.
      const cycle = t % 4800;
      const walking = cycle % 2400 < 1400;
      const frame = (walking ? Math.floor(t / 180) % 2 : 0) as 0 | 1;
      paint(this.preview, encodeLook(this.look), frame, cycle >= 2400);
      if (this.open) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  hide() {
    super.hide();
    cancelAnimationFrame(this.raf);
    // Back into what you're actually wearing (the new look, if you just wore it).
    this.hooks.preview(this.hooks.current());
  }

  private set(change: Partial<Look>) {
    this.look = { ...this.look, ...change };
    this.msg.textContent = "";
    this.hooks.preview(encodeLook(this.look));
    this.render();
  }

  /** Whether you may wear `slot` = `index` without buying it. */
  private owns(slot: Slot, index: number): boolean {
    const item = this.eco.clothing(slot, index);
    if (!item) return true; // the tee, no hat, no accessory
    if (pieceOf(decodeLook(this.hooks.current()), slot) === index) return true;
    return this.eco.qty(item.id) > 0;
  }

  /** New clothes in the look you're trying on: what the counter will charge for. */
  private basket(): Item[] {
    return SLOTS.filter((s) => !this.owns(s, pieceOf(this.look, s))).map((s) => this.eco.clothing(s, pieceOf(this.look, s))!);
  }

  /** A random look; in a changing room, only from clothes you own. */
  private surprise(): Look {
    const l = decodeLook(randomLook());
    if (this.mode === "shop") return { ...this.look, outfit: l.outfit, hat: l.hat, accessory: l.accessory, hue: l.hue, hatHue: l.hatHue };
    for (const s of SLOTS) if (!this.owns(s, pieceOf(l, s))) Object.assign(l, withPiece(s, 0));
    return l;
  }

  render() {
    this.body.replaceChildren();
    const shop = this.mode === "shop";
    const top = el("div", "wardrobe-top");
    const stage = el("div", "wardrobe-stage");
    stage.append(this.preview);
    const side = el("div", "wardrobe-side");
    side.append(
      el("p", "hint", shop ? "Try anything on: looking is free, and only you see it until you buy." : "Try things on; nobody sees until you wear them."),
      button("🎲 Surprise me", () => this.set(this.surprise()), "small"),
      button("Undo all", () => this.set(decodeLook(this.hooks.current())), "small subtle"),
    );
    if (shop) side.append(el("p", "coins-line", `🪙 $${this.eco.coins}`));
    top.append(stage, side);
    this.body.append(top);

    const tabs = el("div", "tabs");
    for (const [t, label] of shop ? SHOP_TABS : ROOM_TABS) {
      tabs.append(button(label, () => ((this.tab = t), this.render()), t === this.tab ? "on" : ""));
    }
    this.body.append(tabs, this.section());
    this.body.append(shop ? this.counter() : this.roomFooter(), this.msg);
  }

  private roomFooter(): HTMLElement {
    const box = el("div", "wardrobe-footer");
    const wear = button("Wear it ✨", () => void this.save(() => this.hooks.wear(encodeLook(this.look))), "primary");
    wear.disabled = this.saving || encodeLook(this.look) === this.hooks.current();
    box.append(wear);
    if (this.eco.ofKind("clothing").some((it) => !this.owns(it.meta.slot!, it.meta.index!))) {
      box.append(el("p", "hint", "🔒 More clothes at the Clothes Shop, by the bandstand."));
    }
    return box;
  }

  /** The shop's counter: what's new, the total, and buy-and-wear or cancel. */
  private counter(): HTMLElement {
    const box = el("div", "shop-counter");
    const items = this.basket();
    const total = items.reduce((n, it) => n + (it.meta.price ?? 0), 0);
    const changed = encodeLook(this.look) !== this.hooks.current();
    const cancel = button(changed ? "Cancel" : "Close", () => this.cancel(), "subtle");
    if (items.length) {
      const list = el("ul", "basket");
      for (const it of items) {
        const row = el("li", "");
        row.append(el("span", "", it.name), el("span", "price", `$${it.meta.price}`));
        list.append(row);
      }
      const short = total - this.eco.coins;
      const sum = el("p", "total", `Total $${total}`);
      const buy = button(`Buy & wear · $${total}`, () => void this.save(() => this.hooks.buy(encodeLook(this.look), total)), "primary");
      buy.disabled = this.saving || short > 0;
      box.append(el("h3", "", "Trying on"), list, sum);
      if (short > 0) box.append(el("p", "hint", `You need ${short} more coins. Fish, garden or sell at the market cart.`));
      const row = el("div", "shop-buttons");
      row.append(buy, cancel);
      box.append(row);
    } else {
      if (changed) box.append(el("p", "hint", "All yours already: nothing to pay."));
      const row = el("div", "shop-buttons");
      if (changed) {
        const wear = button("Wear it ✨", () => void this.save(() => this.hooks.buy(encodeLook(this.look), 0)), "primary");
        wear.disabled = this.saving;
        row.append(wear);
      } else {
        box.append(el("p", "hint", "Pick something to try on."));
      }
      row.append(cancel);
      box.append(row);
    }
    return box;
  }

  /** Puts back what you came in wearing. */
  private cancel() {
    this.look = decodeLook(this.hooks.current());
    this.hide();
  }

  private section(): HTMLElement {
    const box = el("div", "wardrobe-section");
    const l = this.look;
    switch (this.tab) {
      case "hair":
        box.append(this.tiles(HAIRSTYLES, l.style, (i) => ({ style: i }), "head"));
        box.append(this.swatches(HAIR_COLORS, l.hair, (i) => ({ hair: i })));
        break;
      case "outfit":
        box.append(this.tiles(OUTFITS, l.outfit, (i) => ({ outfit: i }), "body", "outfit"));
        box.append(
          this.swatches(
            OUTFIT_HUES.map((h) => hsl(h, 45, 58)),
            OUTFIT_HUES.findIndex((h) => Math.abs(h - l.hue) < 8),
            (i) => ({ hue: OUTFIT_HUES[i] }),
          ),
        );
        break;
      case "hat":
        box.append(this.tiles(HATS, l.hat, (i) => ({ hat: i }), "head", "hat"));
        box.append(el("p", "hint", "The hat colour also dyes scarves and headphones."));
        box.append(
          this.swatches(
            HAT_HUES.map((h) => hsl(h, 55, 55)),
            HAT_HUES.findIndex((h) => Math.abs(h - l.hatHue) < 11),
            (i) => ({ hatHue: HAT_HUES[i] }),
          ),
        );
        break;
      case "extras":
        box.append(this.tiles(ACCESSORIES, l.accessory, (i) => ({ accessory: i }), "head", "accessory"));
        break;
      case "skin":
        box.append(this.swatches(SKIN_COLORS, l.skin, (i) => ({ skin: i })));
        break;
    }
    return box;
  }

  /**
   * One tile per option, each showing you wearing it. For clothes (`slot`),
   * the shop shows prices and a changing room locks what you don't own.
   */
  private tiles(names: string[], current: number, change: (i: number) => Partial<Look>, crop: "head" | "body", slot?: Slot): HTMLElement {
    const grid = el("div", "wardrobe-tiles");
    names.forEach((name, i) => {
      const item = slot ? this.eco.clothing(slot, i) : undefined;
      const owned = !slot || this.owns(slot, i);
      const locked = !owned && this.mode === "room";
      const b = button("", () => this.set(change(i)), `outfit-tile${i === current ? " on" : ""}${locked ? " locked" : ""}`);
      b.disabled = locked;
      b.title = locked ? `${name}: sold at the Clothes Shop` : name;
      const pic = figure(encodeLook({ ...this.look, ...change(i) }), 2);
      const view = el("div", crop === "head" ? "pic head" : "pic");
      view.append(pic);
      b.append(view, el("span", "", name));
      if (item && this.mode === "shop") b.append(el("span", owned ? "tag owned" : "tag", owned ? "✓ Yours" : `$${item.meta.price}`));
      else if (locked) b.append(el("span", "tag", `🔒 $${item?.meta.price ?? ""}`));
      grid.append(b);
    });
    return grid;
  }

  private swatches(colors: string[], current: number, change: (i: number) => Partial<Look>): HTMLElement {
    const row = el("div", "swatches");
    colors.forEach((c, i) => {
      const b = button("", () => this.set(change(i)), i === current ? "swatch on" : "swatch");
      b.style.background = c;
      b.setAttribute("aria-label", `Colour ${i + 1}`);
      row.append(b);
    });
    return row;
  }

  private async save(run: () => Promise<void>) {
    this.saving = true;
    this.render();
    try {
      await run();
      this.saving = false;
      this.hide();
    } catch (e) {
      this.msg.textContent = e instanceof ApiError ? e.message : "That didn't work. Try again?";
    } finally {
      this.saving = false;
      if (this.open) this.render();
    }
  }
}
