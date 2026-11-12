import { describe, expect, it } from "vitest";

// Nothing else checks the stylesheet: one lost brace (a merge, once) and
// every rule after it silently stops applying.
describe("styles.css", () => {
  it("has balanced braces", async () => {
    // Read as a file (the client has no Node types; tests run under Node).
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(p: URL, enc: string): string };
    const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.length, "the stylesheet itself").toBeGreaterThan(10_000);
    // (Checked brace by brace, but asserted once, at the first thing wrong: an
    // `expect` per character took seconds on a stylesheet this size.)
    let depth = 0;
    let wrong = "";
    for (const [i, line] of css.split("\n").entries()) {
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        if (depth < 0) wrong ||= `line ${i + 1}: a brace closed that wasn't open`;
      }
      // Rules here don't nest (no @media inside @media): never deeper than 2.
      if (depth > 2) wrong ||= `line ${i + 1}: a rule left open?`;
      if (wrong) break;
    }
    expect(wrong).toBe("");
    expect(depth).toBe(0);
  });
});
