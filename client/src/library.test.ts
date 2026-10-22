import { describe, expect, it } from "vitest";
import { authorName, byline, rangeText, wingOfZone } from "./library";

describe("the library", () => {
  it("writes authors the way a card does", () => {
    expect(authorName("Austen, Jane, 1775-1817")).toBe("Jane Austen");
    expect(authorName("Kennedy, John F. (John Fitzgerald), 1917-1963")).toBe("John F. Kennedy");
    expect(authorName("Homer, 751? BCE-651? BCE")).toBe("Homer");
    expect(authorName("Ásgeir Pétursson [Editor]")).toBe("Ásgeir Pétursson");
    expect(byline("Austen, Jane, 1775-1817")).toBe("Jane Austen");
    expect(byline("Byron, May, 1861-1936; Dulac, Edmund, 1882-1953")).toBe("May Byron and Edmund Dulac");
    expect(byline("A, B; C, D; E, F")).toBe("B A et al.");
    expect(byline("")).toBe("Anonymous");
  });

  it("says what's on a row", () => {
    const pr = { c: "PR", a: "Austen", l: "English" };
    const ps = { c: "PS", a: "Twain", l: "English" };
    expect(rangeText(pr, pr, false)).toBe("PR · Austen – Austen");
    expect(rangeText(pr, ps, false)).toBe("PR–PS · Austen – Twain");
    const fr = { c: "PQ", a: "Balzac", l: "French" };
    expect(rangeText(fr, { ...fr, a: "Zola" }, true)).toBe("French · Balzac – Zola");
    expect(rangeText(fr, { ...fr, l: "Finnish" }, true)).toBe("French – Finnish");
  });

  it("knows its wings", () => {
    expect(wingOfZone("library_lit")).toBe("lit");
    expect(wingOfZone("library")).toBe(null);
    expect(wingOfZone("library_nope")).toBe(null);
    expect(wingOfZone("mall")).toBe(null);
  });
});
