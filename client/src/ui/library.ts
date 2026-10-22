// The Library's panels (ADR 0012): the catalogue at the circulation desk
// (search everything, every language; "Show me" walks you to the book),
// a bookcase up close (five shelves of spines with their titles: browse
// along the row), and a book's card.

import {
  type Card,
  type Found,
  LANGUAGES,
  type Library,
  NEW,
  PER_SHELF,
  type Place,
  SHELVES,
  type Spine,
  WINGS,
  byline,
  rangeText,
  wingName,
} from "../library";
import { spineLook } from "../world/libraryart";
import { Panel, button, el } from "./panels";

/** What the panels need from the game. */
export interface LibraryHost {
  /** Walk to a book (travelling to its wing first if need be) and make it glow. */
  showMe(at: Place, id: number, title: string): void;
  /** Walk to bookcase `n` of the wing you're in (browsing along the row). */
  browse(wing: string, n: number): void;
  /** How many bookcases the wing has. */
  cases(wing: string): number;
}

function placeText(at: Place): string {
  return at.wing === NEW ? "New Arrivals, in the hall" : `${wingName(at.wing)} · bookcase ${at.case + 1}`;
}

/** A book's card: who wrote it, in what language, what it's about, where it stands. */
export class BookCardPanel extends Panel {
  private card: Card | null = null;
  private loading = 0;
  private back: (() => void) | null = null;
  private here = false;

  constructor(
    private lib: Library,
    private host: LibraryHost,
  ) {
    super("📖 Book", "book-card");
  }

  /** Opens book `id`'s card; `back` returns to where it was opened from; `here`: you're at its shelf already. */
  showBook(id: number, back: (() => void) | null, here = false) {
    this.back = back;
    this.here = here;
    this.card = null;
    const ticket = ++this.loading;
    this.show();
    void this.lib
      .book(id)
      .then((c) => {
        if (ticket !== this.loading) return;
        this.card = c;
        if (this.open) this.render();
      })
      .catch(() => {
        if (ticket === this.loading && this.open) this.body.replaceChildren(el("p", "error", "The card's gone missing. Try again?"));
      });
  }

  render() {
    this.body.replaceChildren();
    const c = this.card;
    if (!c) {
      this.body.append(el("p", "hint", "Finding the card…"));
      return;
    }
    const head = el("div", "book-head");
    const look = c.at.slot === null ? spineLook(NEW, 0, c.id % 100) : spineLook(c.at.wing, c.at.case, c.at.slot);
    const cover = el("div", "book-cover");
    cover.style.background = look.color;
    const t = el("div", "book-title");
    t.append(el("strong", "", c.title), el("span", "by", c.authors.length ? c.authors.map((a) => byline(a)).join(", ") : "Anonymous"));
    head.append(cover, t);
    this.body.append(head);
    const facts = el("dl", "book-facts");
    const fact = (k: string, v: string) => {
      if (!v) return;
      facts.append(el("dt", "", k), el("dd", "", v));
    };
    fact(c.languages.length > 1 ? "Languages" : "Language", c.languages.map((l) => l.name).join(", "));
    fact("About", c.subjects.slice(0, 5).join(" · "));
    fact("Shelved under", [...c.locc, ...c.bookshelves.slice(0, 3)].join(" · "));
    fact("Added", c.issued ? new Date(c.issued).getFullYear().toString() : "");
    fact("Stands in", placeText(c.at));
    this.body.append(facts);
    const actions = el("div", "book-actions");
    if (this.back) {
      const back = this.back;
      actions.append(button("‹ Back", () => back(), "small"));
    }
    if (!this.here) {
      actions.append(
        button("📍 Show me", () => {
          this.hide();
          this.host.showMe(c.at, c.id, c.title);
        }, "small"),
      );
    }
    this.body.append(actions);
    this.body.append(el("p", "hint", "Reading in the library opens soon. Until then, it's free to read at Project Gutenberg:"));
    const link = el("a", "book-link", `gutenberg.org/ebooks/${c.id} ↗`);
    link.href = `https://www.gutenberg.org/ebooks/${c.id}`;
    link.target = "_blank";
    link.rel = "noopener";
    this.body.append(link);
  }
}

/** A bookcase up close: five shelves of twenty spines, titles on them. */
export class ShelfPanel extends Panel {
  private wing = "";
  private n = 0;
  private books: Spine[] | null = null;
  private range = "";
  private loading = 0;
  /** A slot to pick out (arrived with "Show me"). */
  private mark: number | null = null;

  constructor(
    private lib: Library,
    private card: BookCardPanel,
    private host: LibraryHost,
  ) {
    super("📚 Bookcase", "shelf");
  }

  openCase(wing: string, n: number, mark: number | null = null) {
    this.wing = wing;
    this.n = n;
    this.mark = mark;
    this.books = null;
    this.range = "";
    this.titleEl.textContent = wing === NEW ? "🆕 New Arrivals" : `📚 ${wingName(wing)} · bookcase ${n + 1}`;
    const ticket = ++this.loading;
    this.show();
    void this.lib
      .case(wing, n)
      .then((b) => {
        if (ticket !== this.loading) return;
        this.books = b;
        if (this.open) this.render();
      })
      .catch(() => {
        if (ticket === this.loading && this.open) this.body.replaceChildren(el("p", "error", "Couldn't reach the shelf. Try again?"));
      });
    if (wing !== NEW) {
      void this.lib
        .wing(wing)
        .then((idx) => {
          const r = idx.cases[n];
          if (ticket !== this.loading || !r) return;
          this.range = rangeText(r[0], r[1], wing === "world");
          if (this.open) this.render();
        })
        .catch(() => {});
    }
  }

  render() {
    this.body.replaceChildren();
    if (this.range) this.body.append(el("p", "shelf-range", this.range));
    const books = this.books;
    if (!books) {
      this.body.append(el("p", "hint", "Taking a look…"));
      return;
    }
    if (!books.length) {
      this.body.append(el("p", "hint", this.wing === NEW ? "Nothing new since the last re-shelving." : "This bookcase is waiting for books."));
    }
    const bySlot = new Map(books.map((b) => [b.slot, b]));
    const shelves = el("div", "shelves");
    const kids = this.wing === "children";
    for (let s = 0; s < SHELVES; s++) {
      const shelf = el("div", kids ? "shelf-row kids" : "shelf-row");
      for (let i = 0; i < PER_SHELF; i++) {
        const slot = s * PER_SHELF + i;
        const b = bySlot.get(slot);
        if (!b) {
          shelf.append(el("span", "spine empty"));
          continue;
        }
        const look = spineLook(this.wing, this.n, slot);
        const sp = button(b.title, () => this.card.showBook(b.id, () => this.openCase(this.wing, this.n), true), "spine");
        sp.style.background = look.color;
        sp.style.height = `${60 + look.height * 5}%`;
        if (look.bands) sp.classList.add("bands");
        if (slot === this.mark) sp.classList.add("marked");
        sp.title = `${b.title} · ${byline(b.authors)}${b.lang !== "en" ? ` · ${b.language}` : ""}`;
        shelf.append(sp);
      }
      shelves.append(shelf);
    }
    this.body.append(shelves);
    if (this.wing !== NEW) {
      const nav = el("div", "shelf-nav");
      const prev = button("‹ Previous bookcase", () => this.host.browse(this.wing, this.n - 1), "small");
      prev.disabled = this.n <= 0;
      const next = button("Next bookcase ›", () => this.host.browse(this.wing, this.n + 1), "small");
      next.disabled = this.n + 1 >= this.host.cases(this.wing) || books.length < PER_SHELF * SHELVES;
      nav.append(prev, next);
      this.body.append(nav);
    }
    this.body.append(el("p", "hint", "Tap a spine to take the book down."));
  }
}

/** The catalogue at the circulation desk: search the whole collection. */
export class CataloguePanel extends Panel {
  private input = el("input");
  private lang = el("select");
  private results: Found[] | null = null;
  private searching = 0;
  private msg = el("p", "error");
  private counts = "";
  private wingCounts = new Map<string, number>();

  constructor(
    private lib: Library,
    private card: BookCardPanel,
    private host: LibraryHost,
  ) {
    super("🗂️ Catalogue", "catalogue");
    this.input.type = "search";
    this.input.placeholder = "Title, author or subject";
    this.input.enterKeyHint = "search";
    this.input.onkeydown = (e) => {
      if (e.key === "Enter") void this.search();
    };
    this.lang.append(new Option("Any language", ""));
    for (const [code, name] of LANGUAGES) this.lang.append(new Option(name, code));
    this.lang.onchange = () => this.input.value.trim() && void this.search();
  }

  show() {
    super.show();
    void this.lib
      .wings()
      .then((w) => {
        this.counts = `${w.total.toLocaleString()} books in eight wings.`;
        this.wingCounts = new Map(w.wings.map((x) => [x.key, x.count]));
        if (w.arrivals) this.wingCounts.set(NEW, w.arrivals);
        if (this.open) this.render();
      })
      .catch(() => {});
  }

  private async search() {
    const q = this.input.value.trim();
    if (!q) {
      this.results = null;
      this.render();
      return;
    }
    const ticket = ++this.searching;
    this.msg.textContent = "";
    try {
      const r = await this.lib.search(q, this.lang.value);
      if (ticket !== this.searching) return;
      this.results = r;
    } catch {
      if (ticket === this.searching) this.msg.textContent = "The catalogue's stuck. Try again?";
    }
    if (this.open) this.render();
  }

  render() {
    this.body.replaceChildren();
    const form = el("div", "catalogue-search");
    form.append(this.input, this.lang, button("Search", () => void this.search(), "small"));
    this.body.append(form, this.msg);
    const results = this.results;
    if (!results) {
      this.body.append(el("p", "hint", this.counts ? `${this.counts} Search them all, or browse a wing:` : "Every book in Project Gutenberg, in every language."));
      const list = el("div", "rows");
      const go = (wing: string) => this.host.showMe({ wing, case: 0, slot: null }, 0, wingName(wing));
      for (const w of WINGS) {
        const row = el("div", "row");
        const n = this.wingCounts.get(w.key);
        row.append(el("span", "", w.icon), el("span", "name", w.name), el("span", "hint", n === undefined ? "" : n.toLocaleString()));
        row.append(button("Go", () => go(w.key), "small"));
        list.append(row);
      }
      const arrivals = this.wingCounts.get(NEW);
      if (arrivals) {
        const row = el("div", "row");
        row.append(el("span", "", "🆕"), el("span", "name", "New Arrivals"), el("span", "hint", arrivals.toLocaleString()));
        row.append(button("Go", () => go(NEW), "small"));
        list.append(row);
      }
      this.body.append(list);
      return;
    }
    if (!results.length) {
      this.body.append(el("p", "hint", "Nothing by that name. Try fewer words, or another language."));
      return;
    }
    const list = el("div", "catalogue-results");
    for (const b of results) {
      const row = button("", () => this.card.showBook(b.id, () => this.show()), "found");
      const t = el("strong", "", b.title);
      const meta = el("span", "hint", `${byline(b.authors)}${b.lang !== "en" ? ` · ${b.language}` : ""} · ${placeText(b.at)}`);
      row.append(t, meta);
      list.append(row);
    }
    this.body.append(list);
    if (results.length >= 40) this.body.append(el("p", "hint", "The first 40. Add a word to narrow it down."));
  }
}
