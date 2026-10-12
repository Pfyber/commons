// The shared easels in the art corner (server: api play.rs for saving, zone
// instance/play.rs for live strokes). Anyone can paint; strokes appear live
// for people nearby, and the canvas is saved so the next visitor carries on.
// A finished painting is hung in the gallery, credited to everyone who
// painted it.

import { Sprite, Texture } from "pixi.js";
import { ApiError } from "../net/api";
import type { Painting, Town } from "../town";
import { Panel, button, el } from "../ui/panels";

export const EASEL_SIZE = 16;
export const MIN_TO_HANG = 24;
/** Palette index → colour; 0 is the blank canvas. */
export const PALETTE = [
  "#fbf7ee", "#1d2b3a", "#ffffff", "#e8566b", "#f28c6b", "#f6c343", "#7dbb5c", "#3f7a4a",
  "#5ea9c8", "#2b5f8f", "#9b6fd4", "#f4a7b9", "#b07d4f", "#a9a69c", "#efe3cf", "#5a3b2b",
];

/** Draws cells into `ctx` at (x, y), `size` pixels per cell. */
export function drawCells(ctx: CanvasRenderingContext2D, cells: ArrayLike<number>, x: number, y: number, size: number) {
  for (let i = 0; i < EASEL_SIZE * EASEL_SIZE; i++) {
    ctx.fillStyle = PALETTE[cells[i] ?? 0] ?? PALETTE[0];
    ctx.fillRect(x + (i % EASEL_SIZE) * size, y + Math.floor(i / EASEL_SIZE) * size, size, size);
  }
}

function canvasOf(cells: ArrayLike<number>, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = EASEL_SIZE * size;
  drawCells(c.getContext("2d")!, cells, 0, 0, size);
  return c;
}

/** The paintings on the easels in the world, kept up to date. */
export class EaselDisplays {
  private canvases: HTMLCanvasElement[] = [];
  private textures: Texture[] = [];
  readonly sprites: Sprite[] = [];
  cells: Uint8Array[] = [];

  constructor(count: number, place: (i: number, s: Sprite) => void) {
    for (let i = 0; i < count; i++) {
      const c = document.createElement("canvas");
      c.width = c.height = EASEL_SIZE;
      const t = Texture.from(c);
      t.source.scaleMode = "nearest";
      const s = new Sprite(t);
      this.canvases.push(c);
      this.textures.push(t);
      this.sprites.push(s);
      this.cells.push(new Uint8Array(EASEL_SIZE * EASEL_SIZE));
      place(i, s);
      this.redraw(i);
    }
  }

  set(i: number, cells: ArrayLike<number>) {
    if (!this.cells[i]) return;
    this.cells[i].set(Array.from(cells).slice(0, EASEL_SIZE * EASEL_SIZE));
    this.redraw(i);
  }

  paint(i: number, cell: number, color: number) {
    if (!this.cells[i] || cell < 0 || cell >= EASEL_SIZE * EASEL_SIZE) return;
    this.cells[i][cell] = color;
    const ctx = this.canvases[i].getContext("2d")!;
    ctx.fillStyle = PALETTE[color] ?? PALETTE[0];
    ctx.fillRect(cell % EASEL_SIZE, Math.floor(cell / EASEL_SIZE), 1, 1);
    this.textures[i].source.update();
  }

  private redraw(i: number) {
    drawCells(this.canvases[i].getContext("2d")!, this.cells[i], 0, 0, 1);
    this.textures[i].source.update();
  }
}

export interface EaselHost {
  /** Live relay to people nearby (zone `Paint`). */
  sendPaint(easel: number, cell: number, color: number): void;
  displays(): EaselDisplays | null;
}

const CELL_PX = 18;

export class EaselPanel extends Panel {
  private easel = 0;
  private view: "paint" | "gallery" = "paint";
  private color = 1;
  private painters: string[] = [];
  private pending = new Map<number, number>();
  private flushTimer = 0;
  private canvas: HTMLCanvasElement | null = null;
  private gallery: Painting[] = [];
  private msg = el("p", "error");

  constructor(
    private town: Town,
    private host: EaselHost,
  ) {
    super("Easels", "easel");
  }

  private get cells(): Uint8Array {
    return this.host.displays()?.cells[this.easel] ?? new Uint8Array(EASEL_SIZE * EASEL_SIZE);
  }

  async openFor(easel: number) {
    this.easel = easel;
    this.view = "paint";
    this.msg.textContent = "";
    this.show();
    await this.reload();
  }

  private async reload() {
    try {
      const e = await this.town.easel(this.easel);
      this.host.displays()?.set(this.easel, e.cells);
      this.painters = e.painters;
    } catch (e) {
      this.msg.textContent = e instanceof ApiError ? e.message : "Couldn't load the easel.";
    }
    if (this.open) this.render();
  }

  hide() {
    this.flush();
    super.hide();
  }

  /** A stroke from someone else nearby. */
  remote(easel: number, cell: number, color: number) {
    this.host.displays()?.paint(easel, cell, color);
    if (this.open && this.view === "paint" && easel === this.easel) this.drawCell(cell);
  }

  private drawCell(cell: number) {
    const ctx = this.canvas?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = PALETTE[this.cells[cell]] ?? PALETTE[0];
    ctx.fillRect((cell % EASEL_SIZE) * CELL_PX, Math.floor(cell / EASEL_SIZE) * CELL_PX, CELL_PX, CELL_PX);
  }

  private paintAt(e: PointerEvent) {
    const c = this.canvas!;
    const r = c.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * EASEL_SIZE);
    const y = Math.floor(((e.clientY - r.top) / r.height) * EASEL_SIZE);
    if (x < 0 || y < 0 || x >= EASEL_SIZE || y >= EASEL_SIZE) return;
    const cell = y * EASEL_SIZE + x;
    if (this.cells[cell] === this.color) return;
    this.host.displays()?.paint(this.easel, cell, this.color);
    this.drawCell(cell);
    this.host.sendPaint(this.easel, cell, this.color);
    this.pending.set(cell, this.color);
    if (this.pending.size >= 64) this.flush();
    else {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = window.setTimeout(() => this.flush(), 400);
    }
    this.updateHang();
  }

  /** Saves pending strokes. */
  private flush() {
    window.clearTimeout(this.flushTimer);
    if (!this.pending.size) return;
    const cells = [...this.pending.entries()];
    this.pending.clear();
    const easel = this.easel;
    this.town
      .paint(easel, cells)
      .then(() => {
        if (!this.painters.length) void this.reload();
      })
      .catch((e) => (this.msg.textContent = e instanceof ApiError ? e.message : "Couldn't save that stroke."));
  }

  private hangBtn: HTMLButtonElement | null = null;
  private updateHang() {
    const painted = this.cells.reduce((n, c) => n + (c ? 1 : 0), 0);
    if (this.hangBtn) {
      this.hangBtn.disabled = painted < MIN_TO_HANG;
      this.hangBtn.title = painted < MIN_TO_HANG ? `Paint ${MIN_TO_HANG - painted} more cells first` : "";
    }
  }

  render() {
    this.body.replaceChildren();
    const tabs = el("div", "tabs");
    for (let i = 0; i < 3; i++) {
      tabs.append(
        button(`Easel ${i + 1}`, () => {
          this.flush();
          void this.openFor(i);
        }, this.view === "paint" && this.easel === i ? "on" : ""),
      );
    }
    tabs.append(
      button("Gallery", () => {
        this.flush();
        this.view = "gallery";
        this.render();
        void this.town.gallery().then((g) => {
          this.gallery = g;
          if (this.open && this.view === "gallery") this.render();
        });
      }, this.view === "gallery" ? "on" : ""),
    );
    this.body.append(tabs);
    if (this.view === "gallery") return this.renderGallery();

    this.body.append(el("p", "hint", "Paint together: anyone here sees your strokes, and the next visitor carries on."));
    const c = el("canvas", "easel-canvas");
    c.width = c.height = EASEL_SIZE * CELL_PX;
    this.canvas = c;
    drawCells(c.getContext("2d")!, this.cells, 0, 0, CELL_PX);
    let down = false;
    c.onpointerdown = (e) => {
      down = true;
      c.setPointerCapture(e.pointerId);
      this.paintAt(e);
    };
    c.onpointermove = (e) => down && this.paintAt(e);
    c.onpointerup = () => (down = false);
    c.onpointercancel = () => (down = false);
    this.body.append(c);

    const pal = el("div", "palette");
    PALETTE.forEach((col, i) => {
      const b = button(i === 0 ? "⌫" : "", () => {
        this.color = i;
        pal.querySelectorAll("button").forEach((x, j) => x.classList.toggle("on", j === i));
      }, i === this.color ? "on" : "");
      b.style.background = col;
      b.title = i === 0 ? "Eraser" : "";
      pal.append(b);
    });
    this.body.append(pal);
    if (this.painters.length) this.body.append(el("p", "hint", `Painted by ${this.painters.join(", ")}`));

    const form = el("form", "add-friend");
    const title = el("input");
    title.placeholder = "Call it…";
    title.maxLength = 40;
    this.hangBtn = button("Hang it in the gallery", () => form.requestSubmit(), "small primary-sm");
    form.append(title, this.hangBtn);
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!title.value.trim()) {
        this.msg.textContent = "Give it a title first.";
        return;
      }
      this.flush();
      this.town
        .hang(this.easel, title.value.trim())
        .then((r) => {
          this.host.displays()?.set(this.easel, new Uint8Array(EASEL_SIZE * EASEL_SIZE));
          this.painters = [];
          this.msg.className = "ok";
          this.msg.textContent = `Hung in the gallery, by ${r.painters.join(", ")} 🖼️`;
          this.render();
        })
        .catch((e) => {
          this.msg.className = "error";
          this.msg.textContent = e instanceof ApiError ? e.message : "That didn't work.";
        });
    };
    this.body.append(form, this.msg);
    this.updateHang();
  }

  private renderGallery() {
    if (!this.gallery.length) {
      this.body.append(el("p", "empty", "Nothing hung yet. The first painting is yours to make."));
      return;
    }
    const grid = el("div", "gallery");
    for (const p of this.gallery) {
      const card = el("div", "painting");
      const img = canvasOf(p.cells, 4);
      img.className = "art";
      card.append(img, el("strong", "", p.title), el("span", "hint", p.painters.join(", ")));
      grid.append(card);
    }
    this.body.append(grid);
  }
}
