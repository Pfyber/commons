import { describe, expect, it } from "vitest";

// Nothing else checks the stylesheet: one lost brace (a merge, once) and
// every rule after it silently stops applying.
describe("styles.css", () => {
  it("has balanced braces", async () => {
    // Read as a file (the client has no Node types; tests run under Node).
    const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(p: URL, enc: string): string };
    const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.length, "the stylesheet itself").toBeGreaterThan(10_000);
    let depth = 0;
    for (const [i, line] of css.split("\n").entries()) {
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        expect(depth, `line ${i + 1}`).toBeGreaterThanOrEqual(0);
      }
      // Rules here don't nest (no @media inside @media): never deeper than 2.
      expect(depth, `line ${i + 1}: a rule left open?`).toBeLessThanOrEqual(2);
    }
    expect(depth).toBe(0);
  });
});
