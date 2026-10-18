// Rarity tiers (the catalogue's `rarity`, 0–5): a name and a colour, used to
// frame item icons and to colour catches. The reel game gets harder with
// each tier: a narrower green and a quicker needle.

export interface Tier {
  name: string;
  color: string;
  /** Reel game: half the green's width (fraction of the bar) and the needle's pace. */
  sweet: number;
  pace: number;
}

export const TIERS: Tier[] = [
  { name: "Common", color: "#c8c4b8", sweet: 0.1, pace: 2.6 },
  { name: "Uncommon", color: "#5fd07a", sweet: 0.085, pace: 3.1 },
  { name: "Rare", color: "#4fa8ff", sweet: 0.07, pace: 3.7 },
  { name: "Epic", color: "#b07bff", sweet: 0.055, pace: 4.4 },
  { name: "Legendary", color: "#ffb84f", sweet: 0.042, pace: 4.6 },
  { name: "Mythical", color: "#ff4fa3", sweet: 0.034, pace: 4.8 },
];

export function tier(rarity: number | undefined): Tier {
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, rarity ?? 0))];
}
