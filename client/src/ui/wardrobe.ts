// The changing room (the tailor's tent in the park, the wardrobe at home):
// a live preview that walks and turns, and every option shown on you.

import { ApiError } from "../net/api";
import { HAIR_COLORS, SKIN_COLORS, avatarCanvas } from "../world/art";
import { ACCESSORIES, HAIRSTYLES, HATS, type Look, OUTFITS, decodeLook, encodeLook, randomLook } from "../world/look";
import { Panel, button, el } from "./panels";

type Tab = "hair" | "outfit" | "hat" | "extras" | "skin";
const TABS: [Tab, string][] = [
  ["hair", "Hair"],
  ["outfit", "Outfit"],
  ["hat", "Hat"],
  ["extras", "Extras"],
  ["skin", "Skin"],
];

/** 16 outfit hues and 12 hat hues, as look bytes. */
const OUTFIT_HUES = Array.from({ length: 16 }, (_, i) => i * 16);
const HAT_HUES = Array.from({ length: 12 }, (_, i) => Math.round((i * 256) / 12));
const hsl = (byte: number, s: number, l: number) => `hsl(${Math.round((byte * 360) / 256)} ${s}% ${l}%)`;

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

export class WardrobePanel extends Panel {
  private look: Look = decodeLook(0);
  private tab: Tab = "hair";
  private preview = document.createElement("canvas");
  private raf = 0;
  private msg = el("p", "error");
  private saving = false;

  constructor(
    private current: () => number,
    private save: (look: number) => Promise<void>,
  ) {
    super("Changing room", "wardrobe");
    this.preview.width = 24 * 5;
    this.preview.height = 34 * 5;
    this.preview.className = "wardrobe-preview";
  }

  /** Opens the room; `title` names the place (Tailor, Wardrobe). */
  openAs(title: string) {
    this.titleEl.textContent = title;
    this.look = decodeLook(this.current());
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
  }

  private set(change: Partial<Look>) {
    this.look = { ...this.look, ...change };
    this.render();
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
      button("Undo all", () => this.set(decodeLook(this.current())), "small subtle"),
    );
    top.append(stage, side);
    this.body.append(top);

    const tabs = el("div", "tabs");
    for (const [t, label] of TABS) {
      const b = button(label, () => ((this.tab = t), this.render()), t === this.tab ? "on" : "");
      tabs.append(b);
    }
    this.body.append(tabs, this.section());

    const wear = button("Wear it ✨", () => void this.wear(), "primary");
    wear.disabled = this.saving || encodeLook(this.look) === this.current();
    this.body.append(wear, this.msg);
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

  /** One tile per option, each showing you wearing it. */
  private tiles(names: string[], current: number, change: (i: number) => Partial<Look>, crop: "head" | "body"): HTMLElement {
    const grid = el("div", "wardrobe-tiles");
    names.forEach((name, i) => {
      const b = button("", () => this.set(change(i)), i === current ? "outfit-tile on" : "outfit-tile");
      b.title = name;
      const pic = figure(encodeLook({ ...this.look, ...change(i) }), 2);
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
      await this.save(encodeLook(this.look));
      this.hide();
    } catch (e) {
      this.msg.textContent = e instanceof ApiError ? e.message : "That didn't work. Try again?";
    } finally {
      this.saving = false;
      if (this.open) this.render();
    }
  }
}
