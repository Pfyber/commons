// The changing room (the tailor's tent, the wardrobe at home, and the mall's
// fitting rooms and mirror): a live preview that walks and turns, and every
// option shown on you. The look's own options are free; things to wear from
// the mall ("Mine") are worn once bought, and in a fitting room this week's
// clothes can be tried on and bought on the spot.

import type { Economy, Item } from "../economy";
import { ApiError } from "../net/api";
import type { Shop } from "../shop";
import { HAIR_COLORS, SKIN_COLORS, avatarCanvas, styleFor, styleParts } from "../world/art";
import { isWearable } from "../world/items";
import { ACCESSORIES, HAIRSTYLES, HATS, type Look, OUTFITS, decodeLook, encodeLook, randomLook } from "../world/look";
import { Panel, button, el } from "./panels";

type Tab = "shop" | "mine" | "hair" | "outfit" | "hat" | "extras" | "skin";
const TABS: [Tab, string][] = [
  ["mine", "Mine"],
  ["hair", "Hair"],
  ["outfit", "Outfit"],
  ["hat", "Hat"],
  ["extras", "Extras"],
  ["skin", "Skin"],
];
const SLOTS = ["outfit", "hat", "accessory", "skin"] as const;
const SLOT_NAMES: Record<string, string> = { outfit: "Outfits", hat: "Hats", accessory: "Accessories", skin: "Full-body skins" };

/** 16 outfit hues and 12 hat hues, as look bytes. */
const OUTFIT_HUES = Array.from({ length: 16 }, (_, i) => i * 16);
const HAT_HUES = Array.from({ length: 12 }, (_, i) => Math.round((i * 256) / 12));
const hsl = (byte: number, s: number, l: number) => `hsl(${Math.round((byte * 360) / 256)} ${s}% ${l}%)`;

/** Draws `look` (and `style`) at `scale`× on a fresh canvas (pixel-crisp). */
function figure(look: number, scale: number, frame: 0 | 1 | 2 = 0, flip = false, style = 0): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 24 * scale;
  c.height = 34 * scale;
  paint(c, look, frame, flip, style);
  return c;
}

function paint(c: HTMLCanvasElement, look: number, frame: 0 | 1 | 2, flip: boolean, style = 0) {
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.save();
  if (flip) {
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(avatarCanvas(look, frame, style), 0, 0, c.width, c.height);
  ctx.restore();
}

/** The item's byte in `style` for its slot. */
function slotOf(it: Item): number {
  return SLOTS.indexOf(it.kind as (typeof SLOTS)[number]);
}

export class WardrobePanel extends Panel {
  private look: Look = decodeLook(0);
  /** What's worn from the mall, as tried on now. */
  private style = 0;
  private tab: Tab = "hair";
  /** In a fitting room or at the mirror: the shop whose things can be tried. */
  private fitting: string | null = null;
  private preview = document.createElement("canvas");
  private raf = 0;
  private msg = el("p", "error");
  private saving = false;

  constructor(
    private current: () => { look: number; style: number },
    private save: (look: number, style: number) => Promise<void>,
    private eco: Economy,
    private shop: Shop,
  ) {
    super("Changing room", "wardrobe");
    this.preview.width = 24 * 5;
    this.preview.height = 34 * 5;
    this.preview.className = "wardrobe-preview";
  }

  /** Opens the room; `title` names the place (Tailor, Wardrobe). */
  openAs(title: string) {
    this.fitting = null;
    if (this.tab === "shop") this.tab = "hair";
    this.begin(title);
  }

  /** A mall fitting room or mirror: this week's things from `dept` to try on. */
  openFitting(dept: string, title: string, tryOn?: number) {
    this.fitting = dept;
    this.tab = "shop";
    this.begin(title);
    const it = tryOn !== undefined ? this.eco.items.get(tryOn) : undefined;
    if (it) this.wearOrRemove(it);
  }

  private begin(title: string) {
    this.titleEl.textContent = title;
    const now = this.current();
    this.look = decodeLook(now.look);
    this.style = now.style;
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
      paint(this.preview, encodeLook(this.look), frame, cycle >= 2400, this.style);
      if (this.open) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  hide() {
    super.hide();
    cancelAnimationFrame(this.raf);
  }

  private set(change: Partial<Look>) {
    this.look = { ...this.look, ...change };
    this.render();
  }

  /** Puts a thing to wear on (or takes it off, if it's on). */
  private wearOrRemove(it: Item) {
    const i = slotOf(it);
    const code = it.meta.code ?? 0;
    const shift = 8 * i;
    const on = ((this.style >>> shift) & 0xff) === code;
    this.style = ((this.style & ~(0xff << shift)) | (on ? 0 : styleFor(it.kind, code))) >>> 0;
    this.render();
  }

  /** Things worn now that you don't own yet. */
  private unowned(): Item[] {
    const p = styleParts(this.style);
    return SLOTS.map((slot) => [...this.eco.items.values()].find((it) => it.kind === slot && it.meta.code === p[slot] && p[slot] !== 0))
      .filter((it): it is Item => !!it && this.eco.qty(it.id) < 1);
  }

  render() {
    this.body.replaceChildren();
    const top = el("div", "wardrobe-top");
    const stage = el("div", "wardrobe-stage");
    stage.append(this.preview);
    const side = el("div", "wardrobe-side");
    side.append(
      el("p", "hint", "Try things on; nobody sees until you wear them."),
      button("🎲 Surprise me", () => this.set(decodeLook(randomLook())), "small"),
      button("Undo all", () => {
        this.style = this.current().style;
        this.set(decodeLook(this.current().look));
      }, "small subtle"),
    );
    top.append(stage, side);
    this.body.append(top);

    const tabs = el("div", "tabs");
    const all: [Tab, string][] = this.fitting ? [["shop", "This week"], ...TABS] : TABS;
    for (const [t, label] of all) {
      const b = button(label, () => ((this.tab = t), this.render()), t === this.tab ? "on" : "");
      tabs.append(b);
    }
    this.body.append(tabs, this.section());

    const wear = button("Wear it ✨", () => void this.wear(), "primary");
    const now = this.current();
    const missing = this.unowned();
    wear.disabled = this.saving || missing.length > 0 || (encodeLook(this.look) === now.look && this.style === now.style);
    if (missing.length) this.body.append(el("p", "hint", `Buy the ${missing.map((m) => m.name).join(" and ")} to wear it out.`));
    // What you're trying on, to buy right here (if this shop has it this week).
    const d = this.fitting ? this.shop.depts.get(this.fitting) : undefined;
    for (const it of missing) {
      const s = d?.shelves.find((x) => x.item === it.id);
      if (!d || !s) continue;
      const buy = button(s.left === 0 ? `The ${it.name} is sold out this week` : `Buy the ${it.name} for ${s.price}`, () => {
        this.msg.textContent = "";
        this.shop
          .buy(d.key, s.slot)
          .then(() => (this.msg.textContent = `✓ The ${it.name} is yours. Wear it out!`))
          .catch((e) => (this.msg.textContent = e instanceof Error ? e.message : "That didn't work."))
          .finally(() => this.open && this.render());
      }, "primary try-buy");
      buy.disabled = s.left === 0 || this.eco.coins < s.price;
      this.body.append(buy);
    }
    this.body.append(wear, this.msg);
  }

  private section(): HTMLElement {
    const box = el("div", "wardrobe-section");
    const l = this.look;
    switch (this.tab) {
      case "shop":
        box.append(this.shopTiles());
        break;
      case "mine": {
        const mine = [...this.eco.items.values()].filter((it) => isWearable(it.kind) && this.eco.qty(it.id) > 0);
        if (!mine.length) box.append(el("p", "empty", "Nothing from the mall yet. The Commons Mall's Clothing and Skins shops have things to try on."));
        for (const slot of SLOTS) {
          const of = mine.filter((it) => it.kind === slot);
          if (!of.length) continue;
          box.append(el("h3", "", SLOT_NAMES[slot]), this.wearTiles(of));
        }
        break;
      }
      case "hair":
        box.append(this.tiles(HAIRSTYLES, l.style, (i) => ({ style: i }), "head"));
        box.append(this.swatches(HAIR_COLORS, l.hair, (i) => ({ hair: i })));
        break;
      case "outfit":
        box.append(this.tiles(OUTFITS, l.outfit, (i) => ({ outfit: i }), "body"));
        box.append(
          this.swatches(
            OUTFIT_HUES.map((h) => hsl(h, 45, 58)),
            OUTFIT_HUES.findIndex((h) => Math.abs(h - l.hue) < 8),
            (i) => ({ hue: OUTFIT_HUES[i] }),
          ),
        );
        break;
      case "hat":
        box.append(this.tiles(HATS, l.hat, (i) => ({ hat: i }), "head"));
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
        box.append(this.tiles(ACCESSORIES, l.accessory, (i) => ({ accessory: i }), "head"));
        break;
      case "skin":
        box.append(this.swatches(SKIN_COLORS, l.skin, (i) => ({ skin: i })));
        break;
    }
    return box;
  }

  /** Things to wear as tiles showing you in them; tap to put on or take off. */
  private wearTiles(items: Item[], price?: (it: Item) => HTMLElement | null): HTMLElement {
    const grid = el("div", "wardrobe-tiles");
    const p = styleParts(this.style);
    for (const it of items) {
      const on = p[it.kind as keyof typeof p] === it.meta.code;
      const b = button("", () => this.wearOrRemove(it), on ? "outfit-tile on" : "outfit-tile");
      b.title = it.name;
      const view = el("div", it.kind === "hat" ? "pic head" : "pic");
      view.append(figure(encodeLook(this.look), 2, 0, false, on ? this.style : ((this.style & ~(0xff << (8 * slotOf(it)))) | styleFor(it.kind, it.meta.code ?? 0)) >>> 0));
      b.append(view, el("span", "", it.name));
      const tag = price?.(it);
      const cell = el("div", "wear-cell");
      cell.append(b);
      if (tag) cell.append(tag);
      grid.append(cell);
    }
    return grid;
  }

  /** This week's things in the shop, to try on and buy. */
  private shopTiles(): HTMLElement {
    const d = this.fitting ? this.shop.depts.get(this.fitting) : undefined;
    if (!d?.open) return el("p", "empty", "Nothing on the racks right now.");
    const seen = new Set<number>();
    const shelves = d.shelves.filter((s) => !seen.has(s.item) && seen.add(s.item));
    const items = shelves.map((s) => this.eco.items.get(s.item)).filter((it): it is Item => !!it);
    return this.wearTiles(items, (it) => {
      const s = shelves.find((x) => x.item === it.id)!;
      if (this.eco.qty(it.id) > 0) return el("span", "price", "Yours");
      const b = button(s.left === 0 ? "Sold out" : `Buy ${s.price}`, () => {
        this.msg.textContent = "";
        this.shop
          .buy(d.key, s.slot)
          .then(() => (this.msg.textContent = `✓ The ${it.name} is yours. Wear it out!`))
          .catch((e) => (this.msg.textContent = e instanceof Error ? e.message : "That didn't work."))
          .finally(() => this.open && this.render());
      }, "small primary-sm");
      b.disabled = s.left === 0 || this.eco.coins < s.price;
      return b;
    });
  }

  /** One tile per option, each showing you wearing it. */
  private tiles(names: string[], current: number, change: (i: number) => Partial<Look>, crop: "head" | "body"): HTMLElement {
    const grid = el("div", "wardrobe-tiles");
    names.forEach((name, i) => {
      const b = button("", () => this.set(change(i)), i === current ? "outfit-tile on" : "outfit-tile");
      b.title = name;
      const pic = figure(encodeLook({ ...this.look, ...change(i) }), 2, 0, false, this.style);
      const view = el("div", crop === "head" ? "pic head" : "pic");
      view.append(pic);
      b.append(view, el("span", "", name));
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

  private async wear() {
    this.saving = true;
    this.render();
    try {
      await this.save(encodeLook(this.look), this.style);
      this.hide();
    } catch (e) {
      this.msg.textContent = e instanceof ApiError ? e.message : "That didn't work. Try again?";
    } finally {
      this.saving = false;
      if (this.open) this.render();
    }
  }
}
