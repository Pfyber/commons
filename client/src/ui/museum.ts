// The Museum & Gallery's windows (ADR 0018): the Studio, where you paint
// your own canvas in three sizes and hang it in the Salon; a painting's card
// (hearts, reporting); the catalogue of everything on show; the curator's
// desk (the week's theme, your paintings and when they're on the wall, the
// Hall of Fame); and Natural History, where the town gives its fish.

import { till } from "../ambient/salvagesfx";
import type { Economy } from "../economy";
import { ApiError } from "../net/api";
import { NET_ITEM } from "../nature";
import { drawBug, drawShroom } from "../world/critterart";
import { drawFish } from "../world/fish";
import { ART_PALETTE, type Art, type Museum, type NaturalHistory, SIZES, SIZE_NAMES, type Size, type Specimen, paintingCanvas, toBytes } from "../museum";
import { Panel, button, confirmButton, el } from "./panels";

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "That didn't work.");
const RARITY = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythical"];
const RARITY_COLOR = ["#7a7a6e", "#3f7a4a", "#2b5f8f", "#7b4fb8", "#c27a1a", "#c8553d"];

function when(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function day(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** A painting as a small picture (about `px` across, whole pixels per cell). */
function thumb(a: Art, px: number): HTMLCanvasElement {
  const c = paintingCanvas(toBytes(a.cells), a.size, Math.max(1, Math.floor(px / a.size)));
  c.className = "art-thumb";
  return c;
}

const medal = (rank: number | null) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "");

// ---- the Studio ---------------------------------------------------------------------------

type Tool = "pencil" | "fill" | "eraser" | "picker";

/** Painting your own canvas; drafts are kept per size, and hung from here. */
export class StudioPanel extends Panel {
  private size: Size = 32;
  private cells: Uint8Array<ArrayBufferLike> = new Uint8Array(32 * 32);
  private color = 1;
  private tool: Tool = "pencil";
  private brush = 1;
  private mirror = false;
  private grid = true;
  private undo: Uint8Array<ArrayBufferLike>[] = [];
  private canvas = el("canvas", "studio-canvas");
  private status = el("span", "hint");
  private msg = el("p", "casino-msg");
  private title = "";
  private dirty = false;
  private saveTimer = 0;
  private last: { x: number; y: number } | null = null;
  private loaded = false;

  constructor(private museum: Museum) {
    super("🎨 Studio", "studio");
    this.canvas.addEventListener("pointerdown", (e) => this.down(e));
    this.canvas.addEventListener("pointermove", (e) => this.move(e));
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) this.canvas.addEventListener(ev, () => this.up());
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      if (!this.open) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        this.doUndo();
      }
    });
  }

  show() {
    super.show();
    if (!this.loaded) void this.switchTo(this.size);
    void this.museum.load().then(() => this.open && this.render()).catch(() => {});
  }

  hide() {
    void this.flush();
    super.hide();
  }

  private async switchTo(size: Size) {
    await this.flush();
    this.size = size;
    this.undo = [];
    this.cells = new Uint8Array(size * size);
    this.loaded = true;
    try {
      this.cells = await this.museum.draft(size);
    } catch {
      // A fresh canvas, then.
    }
    this.render();
  }

  /** Saves the draft now, if it changed. */
  private async flush() {
    window.clearTimeout(this.saveTimer);
    if (!this.dirty) return;
    this.dirty = false;
    this.status.textContent = "Saving…";
    try {
      await this.museum.saveDraft(this.size, this.cells);
      this.status.textContent = "Saved ✓";
    } catch {
      this.status.textContent = "Couldn't save just now";
      this.dirty = true;
    }
  }

  private changed() {
    this.dirty = true;
    this.status.textContent = "…";
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), 1500);
  }

  private get cellPx(): number {
    return Math.max(4, Math.floor(384 / this.size));
  }

  private draw() {
    const n = this.size;
    const p = this.cellPx;
    const c = this.canvas;
    if (c.width !== n * p) c.width = c.height = n * p;
    const ctx = c.getContext("2d")!;
    for (let i = 0; i < n * n; i++) {
      ctx.fillStyle = ART_PALETTE[this.cells[i]] ?? ART_PALETTE[0];
      ctx.fillRect((i % n) * p, Math.floor(i / n) * p, p, p);
    }
    if (this.grid && p >= 6) {
      ctx.fillStyle = "rgba(59,58,46,0.12)";
      for (let i = 1; i < n; i++) {
        ctx.fillRect(i * p, 0, 1, n * p);
        ctx.fillRect(0, i * p, n * p, 1);
      }
      // A stronger line every 8 cells helps place things.
      ctx.fillStyle = "rgba(59,58,46,0.25)";
      for (let i = 8; i < n; i += 8) {
        ctx.fillRect(i * p, 0, 1, n * p);
        ctx.fillRect(0, i * p, n * p, 1);
      }
    }
  }

  private cellAt(e: PointerEvent): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * this.size);
    const y = Math.floor(((e.clientY - r.top) / r.height) * this.size);
    return x >= 0 && y >= 0 && x < this.size && y < this.size ? { x, y } : null;
  }

  private snapshot() {
    this.undo.push(this.cells.slice());
    if (this.undo.length > 40) this.undo.shift();
  }

  private doUndo() {
    const prev = this.undo.pop();
    if (!prev) return;
    this.cells = prev;
    this.draw();
    this.changed();
  }

  private set(x: number, y: number, c: number) {
    const n = this.size;
    for (let dy = 0; dy < this.brush; dy++) {
      for (let dx = 0; dx < this.brush; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= n || py >= n) continue;
        this.cells[py * n + px] = c;
        if (this.mirror) this.cells[py * n + (n - 1 - px)] = c;
      }
    }
  }

  private fill(x: number, y: number, c: number) {
    const n = this.size;
    const from = this.cells[y * n + x];
    if (from === c) return;
    const stack = [y * n + x];
    while (stack.length) {
      const i = stack.pop()!;
      if (this.cells[i] !== from) continue;
      this.cells[i] = c;
      const cx = i % n;
      const cy = Math.floor(i / n);
      if (cx > 0) stack.push(i - 1);
      if (cx < n - 1) stack.push(i + 1);
      if (cy > 0) stack.push(i - n);
      if (cy < n - 1) stack.push(i + n);
    }
  }

  private line(a: { x: number; y: number }, b: { x: number; y: number }, c: number) {
    // Every cell between, so a quick stroke has no gaps.
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
    for (let i = 0; i <= steps; i++) this.set(Math.round(a.x + ((b.x - a.x) * i) / steps), Math.round(a.y + ((b.y - a.y) * i) / steps), c);
  }

  private down(e: PointerEvent) {
    const at = this.cellAt(e);
    if (!at) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const erase = this.tool === "eraser" || e.button === 2;
    if (this.tool === "picker") {
      this.color = this.cells[at.y * this.size + at.x];
      this.tool = "pencil";
      return this.render();
    }
    this.snapshot();
    if (this.tool === "fill") {
      this.fill(at.x, at.y, this.color);
      this.draw();
      return this.changed();
    }
    this.set(at.x, at.y, erase ? 0 : this.color);
    this.last = at;
    this.draw();
  }

  private move(e: PointerEvent) {
    if (!this.last || !(e.buttons & 3)) return;
    const at = this.cellAt(e);
    if (!at) return;
    const erase = this.tool === "eraser" || (e.buttons & 2) !== 0;
    this.line(this.last, at, erase ? 0 : this.color);
    this.last = at;
    this.draw();
  }

  private up() {
    if (!this.last) return;
    this.last = null;
    this.changed();
  }

  render() {
    this.body.replaceChildren();
    const s = this.museum.status;
    // The sizes.
    const sizes = el("div", "tier-row");
    for (const z of SIZES) {
      sizes.append(button(`${SIZE_NAMES[z]} ${z}×${z}`, () => void this.switchTo(z), z === this.size ? "small on" : "small"));
    }
    this.body.append(sizes);
    // The canvas, and the tools beside it.
    const row = el("div", "studio-row");
    const tools = el("div", "studio-tools");
    const tool = (t: Tool, label: string, tip: string) => {
      const b = button(label, () => ((this.tool = t), this.render()), this.tool === t ? "small on" : "small");
      b.title = tip;
      return b;
    };
    tools.append(
      tool("pencil", "✏️", "Pencil"),
      tool("fill", "🪣", "Fill"),
      tool("eraser", "🧽", "Eraser (or right-click)"),
      tool("picker", "💧", "Pick a colour from the canvas"),
    );
    const brush = button(this.brush === 1 ? "▪ 1" : "◼ 2", () => ((this.brush = this.brush === 1 ? 2 : 1), this.render()), "small");
    brush.title = "Brush size";
    const mirror = button("🪞", () => ((this.mirror = !this.mirror), this.render()), this.mirror ? "small on" : "small");
    mirror.title = "Mirror: paint both halves at once";
    const grid = button("#", () => ((this.grid = !this.grid), this.draw(), this.render()), this.grid ? "small on" : "small");
    grid.title = "Grid";
    const undo = button("↶", () => this.doUndo(), "small");
    undo.title = "Undo (Ctrl+Z)";
    const clear = confirmButton(`studio-clear-${this.size}`, "🗑", "Clear?", () => {
      this.snapshot();
      this.cells.fill(0);
      this.draw();
      this.changed();
    }, "small");
    tools.append(brush, mirror, grid, undo, clear);
    row.append(this.canvas, tools);
    this.body.append(row);
    this.draw();
    // The palette.
    const pal = el("div", "studio-palette");
    ART_PALETTE.forEach((col, i) => {
      const b = button("", () => {
        this.color = i;
        if (this.tool === "eraser" || this.tool === "picker") this.tool = "pencil";
        this.render();
      }, i === this.color ? "swatch on" : "swatch");
      b.style.background = col;
      b.setAttribute("aria-label", i === 0 ? "Canvas" : `Colour ${i}`);
      pal.append(b);
    });
    this.body.append(pal, this.status);
    // Hanging it.
    const hang = el("div", "studio-hang");
    if (s) {
      const left = Math.max(0, Math.ceil((s.week_ends - Date.now() / 1000) / 86400));
      hang.append(el("p", "hint", `This week's theme: “${s.theme}” · ${left} day${left === 1 ? "" : "s"} left. The week's most-loved go to the Hall of Fame.`));
    }
    const title = el("input");
    title.maxLength = 40;
    title.placeholder = "Its title";
    title.value = this.title;
    title.oninput = () => (this.title = title.value);
    title.onkeydown = (e) => e.stopPropagation();
    const mine = s?.mine.find((m) => m.size === this.size);
    const go = button(mine ? "Hang it (replaces your last)" : "Hang it in the Salon", () => void this.hang(go), "primary");
    if (mine) go.title = `It takes the place of “${mine.title}”`;
    const line = el("div", "tier-row");
    line.append(title, go);
    hang.append(line, this.msg);
    this.body.append(hang);
  }

  private async hang(btn: HTMLButtonElement) {
    const painted = this.cells.reduce((n, c) => n + (c ? 1 : 0), 0) / this.cells.length;
    if (painted < (this.museum.status?.min_painted ?? 0.08)) {
      this.msg.textContent = "Paint a little more of the canvas first.";
      return;
    }
    if (!this.title.trim()) {
      this.msg.textContent = "Give it a title.";
      return;
    }
    btn.disabled = true;
    try {
      await this.flush();
      await this.museum.submit(this.size, this.title.trim(), this.cells);
      this.msg.textContent = `🖼 “${this.title.trim()}” hangs in the Salon! Its turn on the wall comes round each day.`;
      this.msg.className = "casino-msg win";
      this.title = "";
    } catch (e) {
      this.msg.textContent = errText(e);
      this.msg.className = "casino-msg";
    }
    btn.disabled = false;
  }
}

// ---- a painting's card ------------------------------------------------------------------

export class ArtCard extends Panel {
  private art: Art | null = null;
  private msg = el("p", "hint");

  constructor(private museum: Museum) {
    super("🖼 Painting", "art-card");
  }

  showArt(a: Art) {
    this.art = a;
    this.msg.textContent = "";
    this.show();
  }

  render() {
    this.body.replaceChildren();
    const a = this.art;
    if (!a) return;
    this.titleEl.textContent = `${medal(a.fame)} ${a.title}`.trim();
    const pic = paintingCanvas(toBytes(a.cells), a.size, Math.max(1, Math.floor(256 / a.size)));
    pic.className = "art-big";
    this.body.append(pic, el("p", "art-by", `by ${a.artist}`), el("p", "hint", `${SIZE_NAMES[a.size]} · week ${a.week.split("-W")[1]}: “${a.theme}” · ${day(a.at)}`));
    if (a.fame) this.body.append(el("p", "art-fame", `${medal(a.fame)} In the Hall of Fame: ${["", "first", "second", "third"][a.fame]} of its week.`));
    const row = el("div", "tier-row");
    if (a.mine) {
      row.append(el("span", "hint", `❤ ${a.hearts} · it's yours!`));
    } else {
      const heart = button(`${a.hearted ? "❤" : "🤍"} ${a.hearts}`, () => {
        heart.disabled = true;
        this.museum
          .heart(a.id, !a.hearted)
          .then((r) => {
            a.hearts = r.hearts;
            a.hearted = r.hearted;
            this.render();
          })
          .catch((e) => (this.msg.textContent = errText(e)));
      }, a.hearted ? "small on" : "small primary-sm");
      heart.title = a.hearted ? "Take your heart back" : "Give it a heart";
      row.append(heart);
      row.append(confirmButton(`report-art-${a.id}`, "Report", "Take it down?", () => {
        this.museum
          .report(a.id)
          .then(() => {
            this.msg.textContent = "Thank you. It's down until someone checks it.";
            this.art = null;
            this.body.replaceChildren(this.msg);
          })
          .catch((e) => (this.msg.textContent = errText(e)));
      }));
    }
    this.body.append(row, this.msg);
  }
}

// ---- the catalogue --------------------------------------------------------------------

export class ArtCataloguePanel extends Panel {
  private size: Size = 16;
  private sort: "new" | "hearts" = "new";
  private art: Art[] = [];
  private page = 0;
  private more = false;

  constructor(
    private museum: Museum,
    private card: ArtCard,
  ) {
    super("📖 Catalogue", "art-catalogue");
  }

  show() {
    super.show();
    void this.load(true);
  }

  private async load(fresh: boolean) {
    if (fresh) {
      this.page = 0;
      this.art = [];
    }
    try {
      const r = await this.museum.catalogue(this.size, this.sort, this.page);
      this.art.push(...r.art);
      this.more = r.more;
    } catch {
      // Shown as empty.
    }
    if (this.open) this.render();
  }

  render() {
    this.body.replaceChildren();
    const sizes = el("div", "tier-row");
    for (const z of SIZES) sizes.append(button(SIZE_NAMES[z], () => ((this.size = z), void this.load(true)), z === this.size ? "small on" : "small"));
    const sorts = el("div", "tier-row");
    sorts.append(
      button("Newest", () => ((this.sort = "new"), void this.load(true)), this.sort === "new" ? "small on" : "small"),
      button("Most loved", () => ((this.sort = "hearts"), void this.load(true)), this.sort === "hearts" ? "small on" : "small"),
    );
    this.body.append(sizes, sorts);
    if (!this.art.length) {
      this.body.append(el("p", "hint", `No ${SIZE_NAMES[this.size].toLowerCase()} paintings in the Salon yet. Be the first: paint one at a Studio easel!`));
      return;
    }
    const grid = el("div", "art-grid");
    for (const a of this.art) {
      const tile = button("", () => this.card.showArt(a), "art-tile");
      tile.append(thumb(a, 64), el("span", "art-tile-title", a.title), el("span", "art-tile-by", `${a.artist} · ${a.hearted ? "❤" : "🤍"} ${a.hearts}`));
      grid.append(tile);
    }
    this.body.append(grid);
    if (this.more) this.body.append(button("More…", () => ((this.page += 1), void this.load(false)), "small"));
  }
}

// ---- the curator's desk -------------------------------------------------------------------

export class DeskPanel extends Panel {
  private view: "desk" | "fame" = "desk";
  private fame: Art[] = [];

  constructor(
    private museum: Museum,
    private card: ArtCard,
    private host: { studio(): void; catalogue(): void; nature(): void },
    private eco: Economy,
  ) {
    super("🏛 Curator", "museum-desk");
    eco.onChange(() => this.open && this.view === "desk" && this.render());
  }

  /** The curator sells bug nets, for the town's naturalists. */
  private netRow(): HTMLElement {
    const box = el("div", "");
    box.append(
      el("h3", "", "🦋 For naturalists"),
      el("p", "hint", "Bugs are out in the Park, the Woods, the Meadow, the Orchard and by the water, different ones by the hour, the weather and the season. Catch them with a net; mushrooms you just pick. Bring me one of each for Natural History!"),
    );
    const net = this.eco.items.get(NET_ITEM);
    if (this.eco.qty(NET_ITEM) > 0) box.append(el("p", "hint", "✓ You have a bug net."));
    else if (net?.meta.buy) {
      const msg = el("span", "hint", "");
      box.append(
        button(`Buy a bug net (${net.meta.buy} coins)`, async () => {
          try {
            await this.eco.buy(NET_ITEM, 1);
            till(net.meta.buy ?? 0);
          } catch (e) {
            msg.textContent = errText(e);
          }
        }, "small primary-sm"),
        msg,
      );
    }
    return box;
  }

  show() {
    this.view = "desk";
    super.show();
    void this.museum.load().then(() => this.open && this.render()).catch(() => {});
  }

  showFame() {
    this.view = "fame";
    super.show();
    void this.museum
      .fame()
      .then((r) => {
        this.fame = r.art;
        if (this.open) this.render();
      })
      .catch(() => {});
  }

  render() {
    this.body.replaceChildren();
    if (this.view === "fame") return this.renderFame();
    const s = this.museum.status;
    this.titleEl.textContent = "🏛 Curator";
    this.body.append(el("p", "", "Welcome to the Museum & Gallery! Paint at the Studio's easels and hang your work in the Salon: its walls turn through everyone's paintings, a new set every hour."));
    if (s) {
      const left = Math.max(0, Math.ceil((s.week_ends - Date.now() / 1000) / 86400));
      this.body.append(
        el("h3", "", `This week: “${s.theme}”`),
        el("p", "hint", `${left} day${left === 1 ? "" : "s"} to go. The three most-loved paintings of each size go to the Hall of Fame for good (and win ${s.prizes.join(", ")} coins).`),
        el("p", "hint", `In the Salon now: ${SIZES.map((z, i) => `${s.counts[i] ?? 0} ${SIZE_NAMES[z].toLowerCase()}`).join(", ")}.`),
      );
      this.body.append(el("h3", "", "Your paintings"));
      if (!s.mine.length) this.body.append(el("p", "hint", "None hanging yet. You can have one of each size in the Salon."));
      for (const a of s.mine) {
        const row = button("", () => this.card.showArt(a), "art-row");
        const next = (a.showings ?? []).filter((t) => t * 1000 > Date.now() - 3600_000);
        const on = next.length && next[0] * 1000 <= Date.now() ? "On the wall now!" : next.length ? `Next on the wall at ${next.slice(0, 3).map(when).join(", ")}` : "";
        row.append(thumb(a, 48), el("span", "", `“${a.title}” · ${SIZE_NAMES[a.size]} · ❤ ${a.hearts}`), el("span", "hint", on));
        this.body.append(row);
      }
    }
    const go = el("div", "tier-row");
    go.append(
      button("🎨 Studio", () => this.host.studio(), "small primary-sm"),
      button("📖 Catalogue", () => this.host.catalogue(), "small"),
      button("🏆 Hall of Fame", () => this.showFame(), "small"),
      button("🏛 Natural History", () => this.host.nature(), "small"),
    );
    this.body.append(go, this.netRow());
  }

  private renderFame() {
    this.titleEl.textContent = "🏆 Hall of Fame";
    if (!this.fame.length) {
      this.body.append(el("p", "hint", "The first week's winners go up here when it ends. Paint something, and give your favourites a heart!"));
    }
    let week = "";
    let grid: HTMLElement | null = null;
    for (const a of this.fame) {
      if (a.week !== week) {
        week = a.week;
        this.body.append(el("h3", "", `Week ${week.split("-W")[1]}, ${week.split("-W")[0]}: “${a.theme}”`));
        grid = el("div", "art-grid");
        this.body.append(grid);
      }
      const tile = button("", () => this.card.showArt(a), "art-tile");
      tile.append(thumb(a, 64), el("span", "art-tile-title", `${medal(a.fame)} ${a.title}`), el("span", "art-tile-by", `${a.artist} · ${SIZE_NAMES[a.size]}`));
      grid!.append(tile);
    }
    this.body.append(button("Back", () => this.show(), "small"));
  }
}

// ---- natural history --------------------------------------------------------------------

export type Room = "fish" | "bugs" | "shrooms";
const ROOMS: { key: Room; label: string; noun: string }[] = [
  { key: "fish", label: "🐟 Fish", noun: "tank" },
  { key: "bugs", label: "🦋 Bugs", noun: "case" },
  { key: "shrooms", label: "🍄 Mushrooms", noun: "case" },
];

/** A specimen's picture, by its room. */
export function drawSpecimen(ctx: CanvasRenderingContext2D, room: Room, key: string) {
  if (room === "fish") drawFish(ctx, key);
  else if (room === "bugs") drawBug(ctx, key);
  else drawShroom(ctx, key);
}

export class NaturePanel extends Panel {
  private rooms: NaturalHistory = { fish: [], bugs: [], shrooms: [] };
  private room: Room = "fish";
  private msg = el("p", "casino-msg");

  constructor(
    private museum: Museum,
    private eco: Economy,
    private onGiven: () => void,
  ) {
    super("🏛 Natural History", "nature");
  }

  /** Opens on a room: the fish tanks, or the bug or mushroom cases. */
  showRoom(room: Room) {
    this.room = room;
    this.msg.textContent = "";
    this.show();
  }

  show() {
    super.show();
    void this.load();
  }

  private async load() {
    try {
      this.rooms = await this.museum.nature();
    } catch {
      // Shown as empty.
    }
    if (this.open) this.render();
  }

  render() {
    this.body.replaceChildren();
    const tabs = el("div", "tabs");
    for (const r of ROOMS) tabs.append(button(r.label, () => ((this.room = r.key), (this.msg.textContent = ""), this.render()), this.room === r.key ? "on" : ""));
    const list = this.rooms[this.room];
    const noun = ROOMS.find((r) => r.key === this.room)!.noun;
    const given = list.filter((f) => f.given).length;
    this.body.append(tabs, el("p", "hint", `One of each kind, given by the town. The first to give a kind is named on its ${noun}. You've given ${given} of ${list.length}.`));
    const rows = el("div", "rows");
    for (const f of list) {
      const row = el("div", f.first ? "specimen" : "specimen empty");
      const pic = el("canvas", "specimen-pic");
      pic.width = pic.height = 32;
      if (f.first || f.given || this.eco.album.has(f.item)) drawSpecimen(pic.getContext("2d")!, this.room, f.key);
      const text = el("div", "specimen-text");
      const known = f.first || this.eco.album.has(f.item);
      const name = el("strong", "", known ? f.name : "???");
      name.style.color = RARITY_COLOR[f.rarity] ?? "";
      text.append(
        name,
        el("span", "hint", `${RARITY[f.rarity] ?? ""}${f.first ? ` · first given by ${f.first.name}, ${day(f.first.at)}` : " · nobody's given one yet: be the first!"}${f.givers > 1 ? ` · ${f.givers} givers` : ""}`),
      );
      row.append(pic, text);
      if (f.given) row.append(el("span", "specimen-given", "✓ Given"));
      else if (this.eco.qty(f.item) > 0) {
        row.append(button("Give one", () => void this.give(f), "small primary-sm"));
      }
      rows.append(row);
    }
    this.body.append(rows, this.msg);
  }

  private async give(f: Specimen) {
    try {
      const r = await this.museum.donate(f.item);
      const noun = ROOMS.find((x) => x.key === this.room)!.noun;
      this.msg.textContent = r.first ? `🏆 You're the first to give a ${r.name}! Your name is on its ${noun}.` : `🏛 Thank you for the ${r.name}!`;
      this.msg.className = "casino-msg win";
      this.onGiven();
      await this.load();
    } catch (e) {
      this.msg.textContent = errText(e);
      this.msg.className = "casino-msg";
    }
  }
}
