// Fish sprites: chunky, cute, retro, each species its own shape. Every one is
// hand-drawn on a 16-pixel grid (shown at 2×) in the same style: a black
// outline, a head in a deeper shade with a gill line, a bright eye. The
// commons are simple little fish; the rarer, the wilder: a sail of a fin,
// armour plates, a flowing koi tail, a horned and crested dragon.

/**
 * Grid letters: O outline · E eye · W white (glint, teeth, plates) · H head
 * · B body · L belly · F fin · T tail · A, C accents · . empty.
 */
interface FishSpec {
  rows: string[];
  H: string;
  B: string;
  L?: string;
  F: string;
  T?: string;
  A?: string;
  C?: string;
}

const OUT = "#141018";

const SPECS: Record<string, FishSpec> = {
  // ---- common: plain little fish ----
  /** Small and slim. */
  minnow: {
    H: "#7f95a2",
    B: "#c9d8e0",
    L: "#e6eef2",
    F: "#5d7280",
    rows: [
      "....OOO.........",
      "..OOFFFOOO...OO.",
      ".OHHOBBBBBO.OTO.",
      "OHEWOBBBBBBOOTO.",
      "OHHHOBBBBBBOOTO.",
      ".OHHOLLLLLO.OTO.",
      "..OOOOOOOOO..OO.",
    ],
  },
  /** A round sunfish with a dark ear spot and an orange throat. */
  bluegill: {
    H: "#5f9ae0",
    B: "#a8cff8",
    L: "#d4e8fc",
    F: "#3f7ed0",
    A: "#1f3a6a",
    C: "#f2a541",
    rows: [
      ".....OOOOO......",
      "...OOFFFFFOO....",
      "..OBBBBBBBBBO.OO",
      ".OHHOBBBBBBBBOTO",
      "OHEWOABBBBBBBTTO",
      "OHHHOBBBBBBBBOTO",
      "OCCHOBBBBBBBBTTO",
      ".OCCOLLLLLLLLOTO",
      "..OOLLLLLLLLO.OO",
      "...OOFFFFFOO....",
      ".....OOOOO......",
    ],
  },
  /** Barred, with a spiky back fin and orange fins. */
  perch: {
    H: "#a89a3a",
    B: "#e2d47a",
    L: "#f2eaa8",
    F: "#e0743a",
    A: "#5a6a22",
    rows: [
      "....O.O.O.O.....",
      "...OFOFOFOFO....",
      "..OOFFFFFFFOO.OO",
      ".OHHOBABBABBOOTO",
      "OHEWOBABBABBBTTO",
      "OHHHOBABBABBBOTO",
      ".OHHOLALLALLOOTO",
      "..OOOOOFFOOO.OTO",
      ".......OO.....OO",
    ],
  },
  // ---- uncommon: a feature each ----
  /** Big-scaled and whiskered. */
  carp: {
    H: "#a06a32",
    B: "#dcae6c",
    L: "#f0d4a0",
    F: "#8a5a2a",
    A: "#b07c3c",
    rows: [
      ".....OOOOOO.....",
      "....OFFFFFFO....",
      "..OOOOBBBBBBO.OO",
      ".OHHHOBABABABOTO",
      "OHEWHOABABABBTTO",
      "OHHHHOBABABABOTO",
      "OHHHHOLLLLLLLTTO",
      ".OHHHOLLLLLLOOTO",
      "O.OOOOOFFFOO.OTO",
      "O.....OOO.....OO",
    ],
  },
  /** Long and speckled, with its pink stripe and a little back fin. */
  rainbow_trout: {
    H: "#5f8f6f",
    B: "#d8e6e0",
    L: "#f2f6f4",
    F: "#4f7a5f",
    A: "#ef7aab",
    C: "#2f3f2f",
    rows: [
      "....OOOO........",
      "...OFFFFO.O..OO.",
      ".OOOOOOOOOFO.OTO",
      "OHEWOBCBBBCBOOTO",
      "OHHHOAAAAAAAATTO",
      "OHHHOLLCLLLCLOTO",
      ".OOOOOOFFOOOO.OO",
      ".......OO.......",
    ],
  },
  // ---- rare: bigger and bolder ----
  /** A flat broad head, long whiskers and a fat round tail. */
  catfish: {
    H: "#4f4b46",
    B: "#857f72",
    L: "#c8c2b2",
    F: "#3c3832",
    T: "#3c3832",
    rows: [
      "......OOO.......",
      ".....OFFFO......",
      "..OOOOOOOOOO.OO.",
      ".OHHHHOBBBBBOOTO",
      "OHEHHHOBBBBBBTTO",
      "OHHHHHOBBBBBBTTO",
      "OHHHHHOLLLLLLTTO",
      ".OHHHHOLLLLLOOTO",
      "O.OOOOOOOOOO.OO.",
      "O..O............",
      "O..O............",
    ],
  },
  /** A torpedo with a duckbill snout full of teeth. */
  pike: {
    H: "#4f6f2f",
    B: "#94b462",
    L: "#d4e4a8",
    F: "#3f5a22",
    C: "#e8f2b8",
    rows: [
      "..........OO....",
      ".........OFFO.OO",
      "..OOOOOOOOOOOOTO",
      ".OHHHEWOBCBBCBTO",
      "OHHHHHHOBBBBBTTO",
      ".OWOWOHOLLLLLOTO",
      "..O.O.OOOFFOO.OO",
      ".........OO.....",
    ],
  },
  /** A big-mouthed, humped bass with a dark stripe down its side. */
  bass: {
    H: "#3f6a2a",
    B: "#7fae4a",
    L: "#dce8b0",
    F: "#2f5220",
    A: "#24401a",
    rows: [
      ".....O.O.O......",
      "....OFOFOFOO....",
      "..OOOOOOOOOOO.OO",
      ".OHHHOBBBBBBBOTO",
      "OHEWHOBABBABBTTO",
      "OOOOHOAAAAAAATTO",
      "OHHHHOLLLLLLLTTO",
      ".OHHHOLLLLLLOOTO",
      "..OOOOOFFOOOO.OO",
      "......OO........",
    ],
  },
  // ---- epic: strange creatures ----
  /** Long and armoured: bony plates down its back, a pointed snout, a shark's tail. */
  sturgeon: {
    H: "#5a6672",
    B: "#a2aebb",
    L: "#ccd4dc",
    F: "#404c58",
    A: "#7a8693",
    rows: [
      "............OO..",
      "...OWOWOWO..OTO.",
      "..OOOOOOOOOOOTO.",
      ".OHEWOBBBBBBBTO.",
      "OHHHHOBABABABTO.",
      ".OOHHOLLLLLLOOTO",
      "O..OOOOFOOFOO.OO",
      "..............OO",
    ],
  },
  /** A tall round moon of a fish with sail fins and a glowing crescent. */
  moonfish: {
    H: "#7a6fc8",
    B: "#ddd8fa",
    L: "#f2f0fe",
    F: "#5a4fb0",
    A: "#ffd84f",
    rows: [
      "......OO........",
      ".....OFFO.......",
      "....OFFFFOO.....",
      "...OOOOOOOOOO...",
      "..OHHOBBBBBBBO..",
      ".OHHHOBBBBBAABOO",
      "OHEWHOBBBBABBBTO",
      "OHHHHOBBBBABBBTO",
      "OHHHHOBBBBBAABOO",
      ".OHHHOLLLLLLLO..",
      "..OHHOLLLLLLO...",
      "...OOOOOOOOO....",
      "....OFFFFO......",
      ".....OFFO.......",
      "......OO........",
    ],
  },
  /** A long eel wriggling in a wave, crackling with yellow lightning. */
  electric_eel: {
    H: "#3f6272",
    B: "#4f7a8a",
    L: "#9ab8c0",
    F: "#2a4656",
    T: "#4f7a8a",
    A: "#ffe14f",
    rows: [
      "..............O.",
      "....OOOO.....OTO",
      ".OOOBBBBO...OBTO",
      "OHEWOABBBO.OBAO.",
      "OHHHOBBABBOBABO.",
      ".OOOLLLOABBBAO..",
      "....OOOOOLLLO...",
      "........OOOO....",
    ],
  },
  // ---- legendary ----
  /** A butterfly koi: patched gold and red and white, with a great flowing tail and whiskers. */
  golden_koi: {
    H: "#f28a1a",
    B: "#ffd86a",
    L: "#fff0b8",
    F: "#f28c28",
    T: "#ff9a3a",
    A: "#ffffff",
    C: "#e8462a",
    rows: [
      "....OOO.........",
      "...OFFFO........",
      "..OOOOOOOO...OO.",
      ".OHHOABCCO..OTTO",
      "OHEWOAABCCOOTTTO",
      "OHHHOBBBBBTTTTO.",
      "OHHHOLLLLLTTTTTO",
      ".OHHOLLLLOOTTTTO",
      "O.OOOOOOO..OTTTO",
      "O...OFFO....OTO.",
      "....OOO......O..",
    ],
  },
  /** A long silver dragon of the river: big aqua-rimmed scales, an upturned jaw and chin barbels. */
  arowana: {
    H: "#8a9aa8",
    B: "#eef4f8",
    L: "#ffffff",
    F: "#4fb8c8",
    T: "#3fa8b8",
    A: "#a8e4ee",
    rows: [
      "..........OOO...",
      "..OOOOOOOOFFFO.O",
      ".OHHOBABABABOOTO",
      "OHEWOABABABABTTO",
      "OHHHOBABABABATTO",
      "OHHHOLLLLLLLLTTO",
      ".OOHOLLLLLLLOOTO",
      "..OOOOOOOOFFFO.O",
      "..O.O.....OOO...",
      "..O.O...........",
    ],
  },
  // ---- mythical ----
  /** A dragon of a fish: horns, a flaming crest, fangs, wing fins and a burning tail. */
  dragonfish: {
    H: "#c8304a",
    B: "#ff7a8e",
    L: "#ffc0c8",
    F: "#ffb84f",
    T: "#ffb84f",
    A: "#ffe14f",
    C: "#e8405e",
    rows: [
      "..O.....O.O.O...",
      ".OAO...OAOAOAO..",
      ".OAO..OFFFFFFFO.",
      "..OHHOBBBBBBBO.O",
      ".OHEWHOBCBCBCBOO",
      "OHHHHHOBBBBBBBTO",
      "OWOWHHOCBCBCBTTO",
      ".OOOHHOLLLLLLTTO",
      "..OAOOOFFOFFOOTO",
      "..OAO.OFFO.OFO.O",
      "...O...OO...O...",
    ],
  },
};

/** Whether we have a sprite for this fish. */
export function hasFishSprite(key: string): boolean {
  return key in SPECS;
}

/** Draws fish `key` into a 32×32 canvas: its 16-pixel drawing, doubled and centred. */
export function drawFish(ctx: CanvasRenderingContext2D, key: string) {
  const s = SPECS[key] ?? SPECS.minnow;
  const colour: Record<string, string | undefined> = { O: OUT, E: OUT, W: "#ffffff", H: s.H, B: s.B, L: s.L ?? s.B, F: s.F, T: s.T ?? OUT, A: s.A, C: s.C };
  const w = Math.max(...s.rows.map((r) => r.length));
  const left = Math.floor((16 - w) / 2);
  const top = Math.floor((16 - s.rows.length) / 2);
  s.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colour[row[x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect((left + x) * 2, (top + y) * 2, 2, 2);
    }
  });
}
