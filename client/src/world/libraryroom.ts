// The Library's rooms in the world (ADR 0012): fills a wing's bookcases
// with as many books as the catalogue has for them and its row-end signs
// with what's on each row, shows New Arrivals in the hall, and makes a
// book's spine glow when "Show me" brings you to it.

import { Graphics } from "pixi.js";
import { HALL, type Library, NEW, PER_CASE, type WingIndex, rangeText, wingOfZone } from "../library";
import { TILE } from "./art";
import { slotRect } from "./libraryart";
import type { MapObject, ZoneMap } from "./map";
import type { TileXY } from "./motion";
import type { Scene } from "./scene";

const GLOW_MS = 30_000;

export class LibraryRoom {
  /** The wing this is (null: the hall). */
  readonly wing: string | null;
  private cases: MapObject[] = [];
  private index: WingIndex | null = null;
  private glow: Graphics | null = null;
  private glowUntil = 0;
  private stopLoans: () => void = () => {};

  constructor(
    private scene: Scene,
    map: ZoneMap,
    zoneId: string,
    private lib: Library,
  ) {
    this.wing = wingOfZone(zoneId);
    const wing = this.wing;
    if (wing) {
      this.cases = map.objects.filter((o) => o.kind === "bookcase").sort((a, b) => Number(a.label) - Number(b.label));
      for (const o of this.cases) {
        o.wing = wing;
        o.books = 0;
      }
      void lib
        .wings()
        .then((w) => {
          const count = w.wings.find((x) => x.key === wing)?.count ?? 0;
          for (const o of this.cases) {
            o.books = Math.max(0, Math.min(PER_CASE, count - Number(o.label) * PER_CASE));
            if (o.books) scene.redraw(o);
          }
        })
        .catch(() => {});
      void lib
        .wing(wing)
        .then((idx) => {
          this.index = idx;
          for (const o of map.objects) {
            if (o.kind !== "stack_sign") continue;
            const first = idx.cases[this.signRange(o)[0]]?.[0];
            if (!first) continue;
            o.sign = wing === "world" ? first.l.slice(0, 3).toUpperCase() : first.c || "—";
            scene.redraw(o);
          }
        })
        .catch(() => {});
      this.showGaps();
      // Borrowing or bringing one back here changes the shelves at once.
      this.stopLoans = lib.onLoans(() => this.showGaps());
    } else if (zoneId === HALL) {
      const shelf = map.objects.find((o) => o.kind === "new_arrivals");
      if (shelf) {
        void lib
          .wings()
          .then((w) => {
            shelf.books = w.arrivals;
            scene.redraw(shelf);
          })
          .catch(() => {});
      }
    }
  }

  /** Gaps where books are out on loan. */
  private showGaps() {
    const wing = this.wing;
    if (!wing) return;
    void this.lib
      .out(wing)
      .then((places) => {
        const by = new Map<number, number[]>();
        for (const p of places) {
          const n = Math.floor(p / PER_CASE);
          by.set(n, [...(by.get(n) ?? []), p % PER_CASE]);
        }
        for (const o of this.cases) {
          const gaps = by.get(Number(o.label)) ?? [];
          if ((o.gaps ?? []).join() === gaps.join()) continue;
          o.gaps = gaps;
          this.scene.redraw(o);
        }
      })
      .catch(() => {});
  }

  /** Bookcase `n` of this wing. */
  caseObj(n: number): MapObject | undefined {
    return this.cases[n];
  }

  get caseCount(): number {
    return this.cases.length;
  }

  /** Where to stand to browse a bookcase (in front of it, nearer `from`). */
  front(o: MapObject, from: TileXY | null): TileXY {
    const y = o.y + o.h;
    const right = from ? Math.abs(from.x - (o.x + 1)) < Math.abs(from.x - o.x) : false;
    return { x: right ? o.x + 1 : o.x, y };
  }

  /** The bookcases a row-end sign stands for ("12-23"). */
  private signRange(o: MapObject): [number, number] {
    const [a, z] = (o.label ?? "0-0").split("-").map(Number);
    return [a, z];
  }

  /** What a row-end sign says in full ("PR · Austen – Brontë"), once known. */
  signText(o: MapObject): string | null {
    const idx = this.index;
    if (!idx) return null;
    const [a, z] = this.signRange(o);
    const from = idx.cases[a]?.[0];
    const to = idx.cases[Math.min(z, idx.cases.length - 1)]?.[1];
    if (!from || !to) return "Empty for now: room for new books.";
    return `Bookcases ${a + 1}–${Math.min(z, idx.cases.length - 1) + 1}: ${rangeText(from, to, this.wing === "world")}`;
  }

  /** Makes the spine in `slot` of bookcase `n` glow for a while. */
  glowAt(n: number, slot: number) {
    const o = this.wing === NEW ? undefined : this.caseObj(n);
    if (!o) return;
    this.glow?.destroy();
    const r = slotRect(slot);
    const g = new Graphics();
    const x = o.x * TILE + r.x;
    const y = o.y * TILE + r.y;
    g.rect(x - 1, y - 1, r.w + 2, r.h + 2).fill({ color: 0xfff2b8, alpha: 0.45 });
    g.rect(x - 2, y - 2, r.w + 4, r.h + 4).stroke({ color: 0xf2dc98, width: 2 });
    // A bookmark arrow over the bookcase, pointing down at the spine.
    const ax = x + r.w / 2;
    const top = o.y * TILE - 54;
    g.poly([ax - 7, top, ax + 7, top, ax, top + 9]).fill(0xf2b33d).stroke({ color: 0x3b3a2e, width: 1 });
    g.zIndex = (o.y + o.h) * TILE + 40;
    this.scene.sorted.addChild(g);
    this.glow = g;
    this.glowUntil = performance.now() + GLOW_MS;
  }

  update(now: number) {
    const g = this.glow;
    if (!g) return;
    if (now > this.glowUntil) {
      g.destroy();
      this.glow = null;
      return;
    }
    g.alpha = 0.55 + 0.45 * Math.sin(now / 180);
  }

  destroy() {
    this.stopLoans();
    this.glow?.destroy();
    this.glow = null;
  }
}
