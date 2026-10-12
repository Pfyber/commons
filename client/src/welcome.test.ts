import { describe, expect, it } from "vitest";
import { GATHERINGS, happeningNow, nextOccurrence } from "./welcome";

const evening = GATHERINGS.find((g) => g.key === "evening")!;
const chess = GATHERINGS.find((g) => g.key === "chess")!;

describe("gathering hours", () => {
  it("finds today's evening, or tomorrow's once it's over", () => {
    const morning = Date.UTC(2026, 9, 12, 9, 0);
    expect(nextOccurrence(evening, morning).start).toBe(Date.UTC(2026, 9, 12, 18, 0));
    const during = Date.UTC(2026, 9, 12, 18, 30);
    expect(nextOccurrence(evening, during).start).toBe(Date.UTC(2026, 9, 12, 18, 0));
    expect(happeningNow(during)?.key).toBe("evening");
    const after = Date.UTC(2026, 9, 12, 19, 0);
    expect(nextOccurrence(evening, after).start).toBe(Date.UTC(2026, 9, 13, 18, 0));
  });

  it("chess night is weekly on Thursdays", () => {
    // Monday 12 October 2026 → Thursday 15 October.
    const mon = Date.UTC(2026, 9, 12, 12, 0);
    const { start, end } = nextOccurrence(chess, mon);
    expect(new Date(start).getUTCDay()).toBe(4);
    expect(start).toBe(Date.UTC(2026, 9, 15, 18, 30));
    expect(end - start).toBe(90 * 60_000);
    // Late on Thursday it's next week's.
    expect(nextOccurrence(chess, Date.UTC(2026, 9, 15, 21, 0)).start).toBe(Date.UTC(2026, 9, 22, 18, 30));
  });
});
