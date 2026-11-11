// Pixel-art icons in place of emoji: wherever one of these emoji turns up
// in the page (the arena's disaster vote and its announcements, bot names
// over their heads, on scoreboards and in menus, "play the bot" buttons),
// it's drawn as a little picture in the game's own style instead: bold
// outlines and a few flat colours, so it reads at a glance, even small.
// The emoji stays in the text (names still read and compare the same),
// wrapped in a span the stylesheet paints the picture over (`.px-icon`).

interface Icon {
  /** For its CSS class (`px-<name>`) and what a screen reader says. */
  name: string;
  /** A character a pixel: `.` clear, the rest keys into `colors`. */
  rows: string[];
  colors: Record<string, string>;
  /**
   * Over heads (name tags), a plainer, bolder one drawn two screen pixels to
   * a pixel, the size the world's own pixels are, so it reads from afar.
   */
  mini?: string[];
}

const ROBOT: Icon = {
  name: "robot",
  rows: [
    ".......kkkk.......",
    ".......kRrk.......",
    ".......krrk.......",
    "........kk........",
    "..kkkkkkkkkkkkkk..",
    "..kHHHHHHHHHHHHk..",
    ".kkHhhhhhhhhhhskk.",
    "knkhkkkkhhkkkksknk",
    "knkhkWYkhhkWYksknk",
    "knkhkYYkhhkYYksknk",
    "knkhkkkkrrkkkksknk",
    "knkhhhhhhhhhhhsknk",
    ".kkhhkkkkkkkkhskk.",
    "..khhkWWkkWWkhsk..",
    "..khhkkkkkkkkssk..",
    "..kkkkkkkkkkkkkk..",
  ],
  mini: [
    ".....r.....",
    ".....k.....",
    ".kkkkkkkkk.",
    ".khhhhhhhk.",
    "kkhWehWehkk",
    "kkheeheehkk",
    ".khhhhhhhk.",
    ".khkkkkkhk.",
    ".kkkkkkkkk.",
  ],
  colors: { k: "#15151c", e: "#15151c", n: "#6d8a93", H: "#eef8fb", h: "#b9d2d9", s: "#7d9aa3", R: "#ffd0d0", r: "#ff3030", W: "#ffffff", Y: "#ffe14d" },
};

const VOLCANO: Icon = {
  name: "volcano",
  rows: [
    ".....gGg...gGg....",
    "....gGGGgggGGGg...",
    ".....ggGGGGGgg....",
    "......y.oy.o......",
    "......kkolokk.....",
    ".....kbollyldk....",
    ".....kBblbbldk....",
    "....kBBlbbbbldk...",
    "....kBlbbbbbbldk..",
    "...kBBlbbbbbbbldk.",
    "...kBlbbbdbbbbbldk",
    "..kBBbbbbbbbdbbddk",
    "..kBbbbdbbbbbbbddk",
    ".kBBbbbbbbbbbbddk.",
    "kBBbbbbbbdbbbbdddk",
    "kkkkkkkkkkkkkkkkkk",
  ],
  colors: { k: "#2a140a", b: "#8a4b22", B: "#c07a3c", d: "#5a2e12", l: "#ff3b1f", o: "#ff9a1f", y: "#ffe14d", g: "#8c8c8c", G: "#d6d6d6" },
};

const METEOR: Icon = {
  name: "meteor",
  rows: [
    "...............kk.",
    "..........kk..kok.",
    "........kkrrkkrok.",
    ".......krroorrook.",
    "......kroooyoook..",
    ".....kroyyyyyok...",
    "....kkroyyyyok....",
    "...kGGGkyyyok.....",
    "..kGWGggkyok......",
    ".kGWGGgggkk.......",
    ".kGGGggggdk.......",
    ".kgGggggddk.......",
    ".kggggdgddk.......",
    "..kgggddddk.......",
    "...kkdddkk........",
    ".....kkk..........",
  ],
  colors: { k: "#1e1612", r: "#e3301c", o: "#ff8c1a", y: "#ffe14d", W: "#ffffff", G: "#d8d8d8", g: "#9a9a9a", d: "#5c5c5c" },
};

const LION: Icon = {
  name: "lion",
  rows: [
    ".....kkkkkk.....",
    "...kkmMMMMmkk...",
    "..kmMMmMMmMMmk..",
    ".kmMmkkkkkkmMmk.",
    ".kMmkffffffkmMk.",
    "kmMkfFFffFFfkMmk",
    "kMmkfeFffFefkmMk",
    "kmMkfeffffefkMmk",
    "kMmkfffnnfffkmMk",
    "kmMkffwnnwffkMmk",
    ".kMmkfwwwwfkmMk.",
    "..kmMkwwwwkMmk..",
    "..kMmMkkkkMmMk..",
    "...kmMmMMmMmk...",
    "....kkmMMmkk....",
    "......kkkk......",
  ],
  colors: { k: "#3a1d0a", m: "#c8641e", M: "#f0a040", f: "#f2c46a", F: "#ffe2a6", e: "#1a1410", n: "#5a2a14", w: "#fff6e6" },
};

const SCORPION: Icon = {
  name: "scorpion",
  rows: [
    ".kk.kk......kk.kk.",
    "kPkkPk......kPkkPk",
    "kPPPPk......kPPPPk",
    ".kPPk........kPPk.",
    "..kPk........kPk..",
    "...kPkkkkkkkkPk...",
    "....kkpPPPPpkk....",
    ".kkkkpPPPPPPpkkkk.",
    "k...kpPPPPPPpk...k",
    ".kkkkppppppppkkkk.",
    "k...kpPPPPPPpk...k",
    ".kkkkkppppppkkkkk.",
    "k.....kpPPpk.kk..k",
    ".......kpPk.kSSk..",
    ".......kpPpkkPSk..",
    "........kpPPPpk...",
    ".........kkkkk....",
  ],
  colors: { k: "#1a0b22", p: "#6a2a9a", P: "#b05ae8", S: "#ffd23f" },
};

const ACID_RAIN: Icon = {
  name: "acid-rain",
  rows: [
    "......kkkk........",
    ".....kHHHHk.kkk...",
    "..kkkHHHHHHkHHHk..",
    ".kHHHHHHHHHHHHHHk.",
    "kHHHHHHHHHHHHHHHck",
    "kcHHHHHHHHHHHHHcck",
    "kccccccccccccccccc",
    ".kkkkkkkkkkkkkkkk.",
    "...a.....a.....a..",
    "..aaA...aaA...aaA.",
    "..aAA...aAA...aAA.",
    "...A.....A.....A..",
    "......a.....a.....",
    ".....aaA...aaA....",
    ".....aAA...aAA....",
    "......A.....A.....",
  ],
  colors: { k: "#2a3632", H: "#d7e2dd", c: "#8ea39a", a: "#b4ff3c", A: "#4f9a12" },
};

// ---- drawn from shapes: each pixel's colour by where it is, then a dark outline round the lot ----

/** A `w`×`h` icon, each pixel `paint`ed (a colour key, or null for clear), outlined in `k`. */
function drawn(w: number, h: number, paint: (x: number, y: number) => string | null): string[] {
  const g: string[][] = [];
  for (let y = 0; y < h; y++) {
    g.push([]);
    for (let x = 0; x < w; x++) g[y].push(paint(x + 0.5, y + 0.5) ?? ".");
  }
  // (A pixel of outline wherever clear touches colour, square on.)
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && g[y][x] !== "." && g[y][x] !== "k";
  return g.map((row, y) => row.map((c, x) => (c === "." && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) ? "k" : c)).join(""));
}

const O = "#2a2433";

/** A gold coin: a rim, a face, a shine at its top left, a mark struck in its middle. */
const COIN: Icon = {
  name: "coin",
  rows: drawn(14, 14, (x, y) => {
    const d = Math.hypot(x - 7, y - 7);
    if (d > 6) return null;
    if (d > 5) return "G";
    if (Math.abs(x - 7) < 1 && Math.abs(y - 7) < 2.6) return "G";
    if (d > 3.6 && d < 4.6 && x + y < 13) return "h";
    return "g";
  }),
  colors: { k: O, g: "#ffd23f", G: "#d99a1e", h: "#fff6b0" },
};

/** A target: rings red and white, a red bullseye. */
const TARGET: Icon = {
  name: "target",
  rows: drawn(14, 14, (x, y) => {
    const d = Math.hypot(x - 7, y - 7);
    if (d > 6.2) return null;
    return d < 1.8 ? "r" : d < 3.3 ? "w" : d < 4.8 ? "r" : "w";
  }),
  colors: { k: O, r: "#e8402a", w: "#fff6e6" },
};

/** A stopwatch: a white face in a red rim, the button on top, a hand at ten past. */
const STOPWATCH: Icon = {
  name: "stopwatch",
  rows: drawn(14, 16, (x, y) => {
    if (y < 2 && Math.abs(x - 7) < 2) return "y";
    if (y >= 2 && y < 3.2 && Math.abs(x - 7) < 1) return "y";
    const d = Math.hypot(x - 7, y - 9.5);
    if (d > 6.2) return null;
    if (d > 4.9) return "r";
    // The hand: up from the middle, and out to the right.
    if (Math.abs(x - 7) < 0.6 && y > 6 && y < 10) return "k";
    if (Math.abs(y - 9.5) < 0.6 && x > 7 && x < 10) return "k";
    return "w";
  }),
  colors: { k: O, y: "#ffd23f", r: "#e8402a", w: "#f8f4ea" },
};

/** A line: a white squiggle, its grey shadow under it. */
const LINK: Icon = {
  name: "link",
  rows: [
    ".....................b",
    ".......bbbbb.........b",
    ".....bbbbbbbb.......bb",
    ".....bbbccccbbb....bbc",
    ".....bbc....ccbbbbbbc.",
    ".....bb.......cccccc..",
    ".....bbbbb............",
    ".....cbbbbbbbb........",
    "......cccbbbbbb.......",
    ".........ccccbbbb.....",
    "..bbbbb......cbbb.....",
    ".bbbbbbb......cbbb....",
    "bbbbbbbbb......cbb....",
    "bbbbccbbbb......bb....",
    "bbbc..cbbbb....bbb....",
    ".bbb...ccbbbbbbbbc....",
    ".bbbbb...cbbbbbcc.....",
    "...bbbb...ccccc.......",
    ".....bbb..............",
    "......bb..............",
    "......bb..............",
    "bb...bbb..............",
    "cbbbbbcc..............",
    ".ccccc................",
  ],
  colors: { b: "#ffffff", c: "#7d7d7d" },
};

/** Two swords, crossed: steel blades, gold guards, brown grips. */
const SWORDS: Icon = {
  name: "swords",
  rows: drawn(16, 16, (x, y) => {
    for (const flip of [false, true]) {
      // Along the blade (0 at the tip, top corner; 1 at the pommel, bottom corner) and across it.
      const u = flip ? 15 - x : x;
      const along = (u + y) / 2 / 15.5;
      const across = (u - y) / Math.SQRT2;
      if (along < 0.68 && Math.abs(across) < 1.1 && along > 0.04) return flip ? "S" : "s";
      if (along >= 0.66 && along < 0.74 && Math.abs(across) < 3.2) return "y";
      if (along >= 0.74 && along < 0.98 && Math.abs(across) < 0.9) return "b";
    }
    return null;
  }),
  colors: { k: O, s: "#e8eef4", S: "#b9c4cf", y: "#ffd23f", b: "#8a4b22" },
};

/** A gold cup: a bowl with handles, a stem, a base. */
const TROPHY: Icon = {
  name: "trophy",
  rows: drawn(16, 16, (x, y) => {
    // The bowl: wide at its rim, narrowing to the stem.
    if (y > 1 && y < 8.5 && Math.abs(x - 8) < 5.2 - (y > 5 ? (y - 5) * 0.9 : 0)) return x < 6.5 && y < 6 ? "h" : "g";
    // The handles: loops either side.
    const hl = Math.hypot((x - 3) / 1.8, (y - 4.5) / 2.4);
    const hr = Math.hypot((x - 13) / 1.8, (y - 4.5) / 2.4);
    if ((hl > 0.55 && hl < 1.1 && x < 4) || (hr > 0.55 && hr < 1.1 && x > 12)) return "G";
    if (y >= 8.5 && y < 11 && Math.abs(x - 8) < 1.1) return "G";
    if (y >= 11 && y < 12.5 && Math.abs(x - 8) < 3) return "g";
    if (y >= 12.5 && y < 14.5 && Math.abs(x - 8) < 4.6) return "b";
    return null;
  }),
  colors: { k: O, g: "#ffd23f", G: "#d99a1e", h: "#fff6b0", b: "#8a4b22" },
};

/** A skateboard side on: a black deck kicked up at the nose and tail, two cream wheels. */
const SKATEBOARD: Icon = {
  name: "skateboard",
  rows: [
    ".bb....................bb.",
    "bbbb..................bbbb",
    "bbbbbbbbbbbbbbbbbbbbbbbbbb",
    ".bbbbbbbbbbbbbbbbbbbbbbbb.",
    "...bbbbbbbbbbbbbbbbbbbb...",
    ".....ccc..........ccc.....",
    ".....cbc..........cbc.....",
    ".....ccc..........ccc.....",
  ],
  colors: { b: "#000000", c: "#f8f3c2" },
};

/** A grind rail: a steel bar on two posts, sparks off it. */
const RAIL: Icon = {
  name: "rail",
  rows: [
    "..y.......y....y..",
    ".y.kkkkkkkkkkkkk..",
    "..kssssssssssssk..",
    "..kSSSSSSSSSSSSk..",
    "..kkkkkkkkkkkkkk..",
    "...kgk......kgk...",
    "...kgk......kgk...",
    "...kgk......kgk...",
    "..kkgkk....kkgkk..",
    "..kgggk....kgggk..",
    "..kkkkk....kkkkk..",
  ],
  colors: { k: O, s: "#e8eef4", S: "#9aa3ad", g: "#6d7680", y: "#ffd23f" },
};

/** Which emoji each is drawn for (with or without the variation selector after it). */
const ICONS: [string, Icon][] = [
  ["\u{1F916}", ROBOT],
  ["\u{1F30B}", VOLCANO],
  ["☄", METEOR],
  ["\u{1F981}", LION],
  ["\u{1F982}", SCORPION],
  ["\u{1F327}", ACID_RAIN],
  ["\u{1FA99}", COIN],
  ["\u{1F3AF}", TARGET],
  ["\u23F1", STOPWATCH],
  ["\u{1F517}", LINK],
  ["\u2694", SWORDS],
  ["\u{1F3C6}", TROPHY],
  ["\u{1F6F9}", SKATEBOARD],
  ["\u{1F6E4}", RAIL],
];

const BY_CHAR = new Map(ICONS);
const FIND = new RegExp(`(${ICONS.map(([c]) => c).join("|")})\\uFE0F?`, "u");
/** Where a picture can't go: the text stays the emoji there. */
const SKIP = new Set(["OPTION", "TEXTAREA", "SCRIPT", "STYLE", "TITLE"]);

/** The icon drawn at its own size (a pixel a pixel), as a PNG data URL, for the browser to scale up crisply. */
function png(icon: Icon, rows = icon.rows): string {
  const w = rows[0].length;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = rows.length;
  const ctx = c.getContext("2d")!;
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`pixel icon ${icon.name}: row ${y} is ${row.length} wide, not ${w}`);
    for (let x = 0; x < w; x++) {
      const k = row[x];
      if (k === ".") continue;
      const color = icon.colors[k];
      if (!color) throw new Error(`pixel icon ${icon.name}: no colour for "${k}"`);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c.toDataURL("image/png");
}

/** Every icon emoji in `node`'s text, wrapped to be drawn as its picture. */
function wrap(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || SKIP.has(parent.tagName) || parent.classList.contains("px-icon") || parent.isContentEditable) return;
    let text = node as Text;
    let m = FIND.exec(text.data);
    while (m) {
      // Split the emoji off into its own node, and wrap it.
      const emoji = text.splitText(m.index);
      text = emoji.splitText(m[0].length);
      const icon = BY_CHAR.get(m[1])!;
      const span = document.createElement("span");
      span.className = `px-icon px-${icon.name}`;
      span.setAttribute("role", "img");
      span.setAttribute("aria-label", icon.name.replace("-", " "));
      emoji.replaceWith(span);
      span.append(emoji);
      m = FIND.exec(text.data);
    }
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has((node as Element).tagName)) return;
  // (Only looked into if there's an icon in there somewhere.)
  if (!FIND.test(node.textContent ?? "")) return;
  const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const found: Node[] = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (FIND.test((n as Text).data)) found.push(n);
  for (const n of found) wrap(n);
}

/** From now on, the pixel icons wherever their emoji are in the page. */
export function installPixelIcons() {
  // Each icon's picture and shape (its width for 1 high), as a class.
  const style = document.createElement("style");
  style.textContent = ICONS.map(([, icon]) => {
    const w = icon.rows[0].length;
    const h = icon.rows.length;
    const own = `.px-${icon.name}{background-image:url("${png(icon)}");--px-w:${w};--px-h:${h}}`;
    if (!icon.mini) return own;
    const m = icon.mini;
    return `${own}
.label .name .px-${icon.name}{background-image:url("${png(icon, m)}");--px-w:${m[0].length * 2};--px-h:${m.length * 2}}`;
  }).join("\n");
  document.head.append(style);
  wrap(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") wrap(r.target);
      else for (const n of r.addedNodes) wrap(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

/** A name for canvas text (no pictures there): its robot left off. */
export function plainName(name: string): string {
  return name.replace(/\s*\u{1F916}\u{FE0F}?\s*/gu, " ").trim();
}
