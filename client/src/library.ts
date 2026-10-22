// The Library's catalogue (ADR 0012; server: crates/api/src/library.rs):
// every Project Gutenberg text, standing in its wing at its place in the
// shelf list. Bookcase n of a wing holds books 100n..100n+99, five shelves
// of twenty from the top left. Loaded a bookcase at a time as you browse.

import type { Auth } from "./net/api";

export const PER_SHELF = 20;
export const SHELVES = 5;
export const PER_CASE = PER_SHELF * SHELVES;
/** The New Arrivals case in the hall. */
export const NEW = "new";
/** The hall's zone; each wing is `library_<key>`. */
export const HALL = "library";

/** The wings, as `commons_sim::library::WINGS` (in the order of their doors). */
export const WINGS: { key: string; name: string; icon: string }[] = [
  { key: "children", name: "Children's Library", icon: "🧸" },
  { key: "lit", name: "Literature", icon: "📖" },
  { key: "world", name: "World Languages", icon: "🌍" },
  { key: "history", name: "History & Geography", icon: "🗺️" },
  { key: "society", name: "Philosophy, Religion & Society", icon: "🏛️" },
  { key: "science", name: "Science & Technology", icon: "🔭" },
  { key: "arts", name: "Arts & Music", icon: "🎻" },
  { key: "reference", name: "Periodicals & Reference", icon: "📰" },
];

/** The languages with the most books, for the catalogue's filter. */
export const LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["fr", "French"],
  ["fi", "Finnish"],
  ["de", "German"],
  ["nl", "Dutch"],
  ["it", "Italian"],
  ["es", "Spanish"],
  ["hu", "Hungarian"],
  ["pt", "Portuguese"],
  ["zh", "Chinese"],
  ["sv", "Swedish"],
  ["el", "Greek"],
  ["eo", "Esperanto"],
  ["la", "Latin"],
  ["ca", "Catalan"],
  ["da", "Danish"],
  ["tl", "Tagalog"],
  ["pl", "Polish"],
  ["no", "Norwegian"],
  ["ja", "Japanese"],
  ["cy", "Welsh"],
  ["cs", "Czech"],
];

export function wingZone(key: string): string {
  return `library_${key}`;
}

/** The wing a zone is (`library_lit` → lit), if it's one. */
export function wingOfZone(zone: string): string | null {
  const key = zone.startsWith("library_") ? zone.slice(8) : "";
  return WINGS.some((w) => w.key === key) ? key : null;
}

export function wingName(key: string): string {
  return key === NEW ? "New Arrivals" : (WINGS.find((w) => w.key === key)?.name ?? key);
}

export interface WingCount {
  key: string;
  name: string;
  zone: string;
  count: number;
  cases: number;
}

export interface Wings {
  total: number;
  arrivals: number;
  wings: WingCount[];
}

/** What a row-end sign says about a book: class, author (or title), language. */
export interface SignLabel {
  c: string;
  a: string;
  l: string;
}

export interface WingIndex {
  key: string;
  count: number;
  /** First and last book of each filled bookcase. */
  cases: [SignLabel, SignLabel][];
}

export interface Spine {
  slot: number;
  id: number;
  title: string;
  authors: string;
  lang: string;
  language: string;
}

export interface Place {
  wing: string;
  case: number;
  slot: number | null;
}

export interface Found {
  id: number;
  title: string;
  authors: string;
  lang: string;
  language: string;
  at: Place;
}

export interface Card {
  id: number;
  title: string;
  authors: string[];
  languages: { code: string; name: string }[];
  subjects: string[];
  locc: string[];
  bookshelves: string[];
  issued: string | null;
  at: Place;
}

/** "Austen, Jane, 1775-1817" → "Jane Austen". */
export function authorName(a: string): string {
  const parts = a
    .replace(/\s*\[[^\]]*\]/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/^\d|^-?\d{1,4}\??-?\d{0,4}( BCE)?$/.test(s) && !/^(fl\.|active|approximately)/i.test(s));
  if (parts.length >= 2 && !parts[1].includes("(")) return `${parts[1]} ${parts[0]}`;
  if (parts.length >= 2) return `${parts[1].replace(/\s*\(.*\)/, "")} ${parts[0]}`;
  return parts[0] ?? "";
}

/** A book's authors for a card or a spine: "Jane Austen", "A and B", "A et al.". */
export function byline(authors: string): string {
  const names = authors
    .split(";")
    .map((a) => authorName(a))
    .filter(Boolean);
  if (!names.length) return "Anonymous";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} et al.`;
}

/** What a stack sign shows: "PR · Austen – Brontë" (in World Languages, the language). */
export function rangeText(from: SignLabel, to: SignLabel, world: boolean): string {
  if (world) return from.l === to.l ? `${from.l} · ${from.a} – ${to.a}` : `${from.l} – ${to.l}`;
  const cls = from.c === to.c ? from.c : `${from.c}–${to.c}`;
  return `${cls ? `${cls} · ` : ""}${from.a} – ${to.a}`;
}

/** A page of a book (with the contents, on opening). */
export interface TextPage {
  id: number;
  title: string;
  page: number;
  pages: number;
  body: string;
  contents?: { page: number; title: string }[];
}

/** A book you've been reading. */
export interface Reading {
  id: number;
  title: string;
  authors: string;
  page: number;
  pages: number;
}

export class Library {
  private wingsP: Promise<Wings> | null = null;
  private wingsAt = 0;
  private index = new Map<string, Promise<WingIndex>>();
  private cases = new Map<string, Promise<Spine[]>>();
  private cards = new Map<number, Promise<Card>>();
  /** A book to walk to on arriving in its wing ("Show me"). */
  showing: (Place & { id: number; title: string }) | null = null;

  constructor(private auth: Auth) {}

  /** How many books each wing holds (refreshed every ten minutes). */
  wings(): Promise<Wings> {
    if (!this.wingsP || Date.now() - this.wingsAt > 600_000) {
      this.wingsAt = Date.now();
      this.wingsP = this.auth.get<Wings>("/api/library/wings");
      this.wingsP.catch(() => (this.wingsP = null));
    }
    return this.wingsP;
  }

  wing(key: string): Promise<WingIndex> {
    let p = this.index.get(key);
    if (!p) {
      p = this.auth.get<WingIndex>(`/api/library/wing/${key}`);
      p.catch(() => this.index.delete(key));
      this.index.set(key, p);
    }
    return p;
  }

  /** The books in a bookcase (the last fifty looked at are kept). */
  case(wing: string, n: number): Promise<Spine[]> {
    const key = `${wing}:${n}`;
    let p = this.cases.get(key);
    if (p) {
      this.cases.delete(key);
    } else {
      p = this.auth.get<{ books: Spine[] }>(`/api/library/case/${wing}/${n}`).then((r) => r.books);
      p.catch(() => this.cases.delete(key));
    }
    this.cases.set(key, p);
    if (this.cases.size > 50) this.cases.delete(this.cases.keys().next().value!);
    return p;
  }

  search(q: string, lang = ""): Promise<Found[]> {
    const qs = new URLSearchParams({ q, lang });
    return this.auth.get<{ books: Found[] }>(`/api/library/search?${qs}`).then((r) => r.books);
  }

  /** A page of book `id`; without `page`, where you left off (fetching the text first if nobody has opened it yet). */
  text(id: number, page?: number): Promise<TextPage> {
    const q = page === undefined ? "" : `?page=${page}`;
    return this.auth.get<TextPage>(`/api/library/books/${id}/text${q}`);
  }

  /** Keeps your place in a book. */
  savePlace(book: number, page: number): Promise<unknown> {
    return this.auth.send("/api/library/reading", { book, page });
  }

  /** What you've been reading, latest first. */
  recent(): Promise<Reading[]> {
    return this.auth.get<{ books: Reading[] }>("/api/library/reading").then((r) => r.books);
  }

  book(id: number): Promise<Card> {
    let p = this.cards.get(id);
    if (!p) {
      p = this.auth.get<Card>(`/api/library/books/${id}`);
      p.catch(() => this.cards.delete(id));
      this.cards.set(id, p);
    }
    return p;
  }
}
