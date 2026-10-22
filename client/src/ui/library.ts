// The Library's panels (ADR 0012): the catalogue at the circulation desk
// (search everything, every language; "Show me" walks you to the book),
// a bookcase up close (five shelves of spines with their titles: browse
// along the row), a book's card, and the reader (L2: the book itself, a
// page at a time, your place kept).

import {
  type Card,
  type Found,
  LANGUAGES,
  type Library,
  NEW,
  PER_SHELF,
  type Place,
  type Reading,
  SHELVES,
  type Spine,
  type TextPage,
  WINGS,
  byline,
  rangeText,
  wingName,
} from "../library";
import { spineLook } from "../world/libraryart";
import { Panel, button, el, isTyping } from "./panels";

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
  /** Set once the reader exists (it's made after the card). */
  reader: ReaderPanel | null = null;
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
    const reader = this.reader;
    if (reader) actions.append(button("📖 Read", () => reader.openBook(c.id, c.title), "small read"));
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
    const link = el("a", "book-link", `Also at gutenberg.org/ebooks/${c.id} ↗`);
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
  private reading: Reading[] = [];
  /** Set once the reader exists. */
  reader: ReaderPanel | null = null;

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
        // A new library stocks itself from Gutenberg in a minute or so.
        this.counts = w.total ? `${w.total.toLocaleString()} books in eight wings.` : "The books are still being unpacked: come back in a minute.";
        this.wingCounts = new Map(w.wings.map((x) => [x.key, x.count]));
        if (w.arrivals) this.wingCounts.set(NEW, w.arrivals);
        if (this.open) this.render();
      })
      .catch(() => {});
    void this.lib
      .recent()
      .then((r) => {
        this.reading = r;
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
      const reader = this.reader;
      if (this.reading.length && reader) {
        this.body.append(el("h3", "", "Continue reading"));
        const list = el("div", "rows");
        for (const r of this.reading.slice(0, 3)) {
          const row = el("div", "row");
          const name = el("span", "name");
          name.append(el("strong", "", r.title), el("span", "hint", ` · page ${r.page + 1} of ${r.pages}`));
          row.append(name, button("Read", () => reader.openBook(r.id, r.title), "small"));
          list.append(row);
        }
        this.body.append(list);
      }
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

/** Gutenberg's _underscores_ are italics. */
function inline(text: string, into: HTMLElement) {
  const parts = text.split(/_([^_\n]+)_/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2) into.append(el("em", "", part));
    else into.append(document.createTextNode(part));
  });
}

const SIZES = [15, 17, 19, 22];

function loadSize(): number {
  try {
    const v = Number(localStorage.getItem("commons.readerSize"));
    return SIZES.includes(v) ? v : 17;
  } catch {
    return 17;
  }
}

/**
 * The reader: a book a page at a time, on paper. Turn pages with the
 * buttons, the arrow keys or a swipe; jump by the contents or the slider.
 * Your place is kept as you go, so the book opens where you left off.
 */
export class ReaderPanel extends Panel {
  private book: TextPage | null = null;
  private contents: { page: number; title: string }[] = [];
  private loading = 0;
  private error = "";
  private saveTimer = 0;
  private size = loadSize();
  private pageCache = new Map<string, Promise<TextPage>>();
  private sheet = el("div", "reader-page");
  /** Told whenever the open book or page changes (null: closed). */
  onRead: (book: { id: number; title: string } | null) => void = () => {};

  constructor(private lib: Library) {
    super("📖 Reading", "reader");
    // Page turns from the keyboard, before the game takes the arrows for walking.
    window.addEventListener(
      "keydown",
      (e) => {
        if (!this.open || isTyping(e) || !this.book) return;
        const dir = e.key === "ArrowRight" || e.key === "PageDown" ? 1 : e.key === "ArrowLeft" || e.key === "PageUp" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.turn(dir);
      },
      true,
    );
    let startX = 0;
    let startY = 0;
    this.sheet.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    });
    this.sheet.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) this.turn(dx < 0 ? 1 : -1);
    });
  }

  /** Opens book `id` where you left off (or at `page`). */
  openBook(id: number, title: string, page?: number) {
    this.book = null;
    this.contents = [];
    this.error = "";
    this.pageCache.clear();
    this.titleEl.textContent = `📖 ${title}`;
    this.show();
    this.load(id, page, true);
  }

  hide() {
    if (this.open) this.onRead(null);
    super.hide();
  }

  private fetchPage(id: number, page?: number): Promise<TextPage> {
    if (page === undefined) return this.lib.text(id);
    const key = `${id}:${page}`;
    let p = this.pageCache.get(key);
    if (!p) {
      p = this.lib.text(id, page);
      p.catch(() => this.pageCache.delete(key));
      this.pageCache.set(key, p);
      if (this.pageCache.size > 12) this.pageCache.delete(this.pageCache.keys().next().value!);
    }
    return p;
  }

  private load(id: number, page: number | undefined, opening = false) {
    const ticket = ++this.loading;
    if (!opening) this.sheet.classList.add("turning");
    this.fetchPage(id, page)
      .then((t) => {
        if (ticket !== this.loading) return;
        this.book = t;
        if (t.contents) this.contents = t.contents;
        this.titleEl.textContent = `📖 ${t.title}`;
        this.error = "";
        this.render();
        this.sheet.scrollTop = 0;
        this.body.scrollTop = 0;
        this.onRead({ id: t.id, title: t.title });
        if (!opening) this.keepPlace();
        // The next page, ready for the turn.
        if (t.page + 1 < t.pages) void this.fetchPage(t.id, t.page + 1).catch(() => {});
      })
      .catch((e) => {
        if (ticket !== this.loading) return;
        this.error = e instanceof Error && e.message ? e.message : "Couldn't open the book. Try again?";
        this.render();
      })
      .finally(() => this.sheet.classList.remove("turning"));
  }

  private keepPlace() {
    const b = this.book;
    if (!b) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.lib.savePlace(b.id, b.page).catch(() => {}), 800);
  }

  private turn(dir: number) {
    const b = this.book;
    if (!b) return;
    const to = b.page + dir;
    if (to < 0 || to >= b.pages) return;
    this.load(b.id, to);
  }

  private goTo(page: number) {
    const b = this.book;
    if (b && page !== b.page) this.load(b.id, page);
  }

  render() {
    this.body.replaceChildren();
    const b = this.book;
    if (!b) {
      this.body.append(this.error ? el("p", "error", this.error) : el("p", "hint", "Fetching it from the stacks… (the first time a book is opened takes a moment)"));
      return;
    }
    const bar = el("div", "reader-bar");
    if (this.contents.length) {
      const toc = el("select", "reader-toc");
      toc.append(new Option("Contents", "-1"));
      let current = -1;
      this.contents.forEach((c, i) => {
        toc.append(new Option(c.title.length > 48 ? `${c.title.slice(0, 46)}…` : c.title, String(c.page)));
        if (c.page <= b.page) current = i;
      });
      toc.selectedIndex = current + 1;
      toc.onchange = () => {
        const p = Number(toc.value);
        if (p >= 0) this.goTo(p);
      };
      bar.append(toc);
    } else {
      bar.append(el("span", ""));
    }
    const sizes = el("span", "reader-sizes");
    const resize = (d: number) => {
      const i = Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(this.size) + d));
      this.size = SIZES[i];
      try {
        localStorage.setItem("commons.readerSize", String(this.size));
      } catch {
        // storage unavailable
      }
      this.sheet.style.fontSize = `${this.size}px`;
    };
    sizes.append(button("A−", () => resize(-1), "small"), button("A+", () => resize(1), "small"));
    bar.append(sizes);
    this.body.append(bar);

    this.sheet.replaceChildren();
    this.sheet.style.fontSize = `${this.size}px`;
    for (const para of b.body.split("\n\n")) {
      // "[Illustration: Reading Jane's letters]": a picture in the printed book.
      if (para.trimStart().startsWith("[Illustration")) {
        const caption = para
          .replace(/^\s*\[Illustration:?/, "")
          .replace(/\]\s*$/, "")
          .replace(/_([^_]+)_/g, "$1")
          .replace(/\s+/g, " ")
          .trim();
        this.sheet.append(el("p", "illus", caption ? `🖼 ${caption}` : "🖼"));
        continue;
      }
      const verse = para.includes("\n");
      const p = el("p", verse ? "verse" : "");
      inline(para, p);
      this.sheet.append(p);
    }
    if (b.page === b.pages - 1) this.sheet.append(el("p", "reader-end", "— The End —"));
    this.body.append(this.sheet);

    const nav = el("div", "reader-nav");
    const prev = button("‹", () => this.turn(-1), "small");
    prev.disabled = b.page === 0;
    prev.setAttribute("aria-label", "Previous page");
    const next = button("›", () => this.turn(1), "small");
    next.disabled = b.page >= b.pages - 1;
    next.setAttribute("aria-label", "Next page");
    const where = el("div", "reader-where");
    const slider = el("input");
    slider.type = "range";
    slider.min = "1";
    slider.max = String(b.pages);
    slider.value = String(b.page + 1);
    const label = el("span", "", `Page ${b.page + 1} of ${b.pages}`);
    slider.oninput = () => (label.textContent = `Page ${slider.value} of ${b.pages}`);
    slider.onchange = () => this.goTo(Number(slider.value) - 1);
    where.append(label, slider);
    nav.append(prev, where, next);
    this.body.append(nav);
    this.body.append(el("p", "reader-credit", "From the collection of Project Gutenberg"));
  }
}
