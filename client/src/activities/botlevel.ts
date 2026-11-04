// How good the bots are, in the minigames that have them (the arena, the
// Splat Yard): a picker for their lobbies. The server's `sim::level`.

import { el } from "../ui/panels";

export const LEVELS = [
  { name: "Easy", icon: "😌", blurb: "slow to react, shaky aim: good for learning" },
  { name: "Medium", icon: "😐", blurb: "a fair fight" },
  { name: "Hard", icon: "😈", blurb: "quick, sharp and ruthless" },
  // The arena's only: they read you, wait their moment and work together.
  { name: "Extreme", icon: "💀", blurb: "patient and cunning: they read your wind-ups, take turns, punish every slip" },
];

/** The level's label, e.g. "😈 Hard". */
export function levelLabel(level: number): string {
  const l = LEVELS[Math.min(LEVELS.length - 1, Math.max(0, level))];
  return `${l.icon} ${l.name}`;
}

/**
 * Bot difficulty: Easy · Medium · Hard (· Extreme, where `extreme`), the
 * current one lit (and what it means under them). With `pick`, they're
 * buttons; without, just shown.
 */
export function levelPicker(level: number, pick: ((level: number) => void) | null, extreme = false): HTMLElement {
  const levels = extreme ? LEVELS : LEVELS.slice(0, 3);
  const at = Math.min(levels.length - 1, Math.max(0, level));
  const box = el("div", "bot-level");
  const row = el("div", `bot-level-row${extreme ? " four" : ""}`);
  row.append(el("span", "bot-level-title", "🤖 Bots"));
  levels.forEach((l, k) => {
    const b = el("button", `bot-level-btn l${k}${k === level ? " on" : ""}`, `${l.icon} ${l.name}`);
    b.type = "button";
    b.disabled = !pick;
    b.setAttribute("aria-pressed", String(k === level));
    if (pick) b.addEventListener("click", () => k !== level && pick(k));
    row.append(b);
  });
  box.append(row, el("div", "bot-level-blurb", levels[at].blurb));
  return box;
}
