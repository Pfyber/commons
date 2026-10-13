// Pixel icons for the HUD, drawn from 12×12 grids in the same palette and
// outline as the world's sprites, so buttons look like part of the game.
// Shown with `image-rendering: pixelated` at 2× or 3×.

const PAL: Record<string, string> = {
  o: "#3b3a2e", // outline, as in the sprites
  w: "#fff8e3",
  k: "#e8d5b0",
  y: "#f6c343",
  Y: "#c9952a",
  r: "#c8553d",
  R: "#8f3a2b",
  p: "#e8566b",
  g: "#6a9a4a",
  G: "#4a7240",
  b: "#5f8fc4",
  B: "#3f6fa0",
  s: "#f5d0b0",
  i: "#b97c55",
  n: "#a0703f",
  N: "#6e4b30",
};

export const ICONS: Record<string, string[]> = {
  bag: [
    "....oooo....",
    "...on..no...",
    "..oooooooo..",
    ".onnnnnnnno.",
    ".oNNNNNNNNo.",
    ".onnnnnnnno.",
    ".onnoyyonno.",
    ".onnoyyonno.",
    ".onnnnnnnno.",
    ".onnnnnnnno.",
    ".oNNNNNNNNo.",
    "..oooooooo..",
  ],
  book: [
    "............",
    ".ooooooooo..",
    ".oGgggggggo.",
    ".oGgwwwwggo.",
    ".oGgggggggo.",
    ".oGgwwwgggo.",
    ".oGgggggggo.",
    ".oGgggggggo.",
    ".oGgggggggo.",
    ".oGoooooooo.",
    ".oGwwwwwwwo.",
    "..ooooooooo.",
  ],
  friends: [
    "............",
    "..ooo..ooo..",
    ".osssooiiio.",
    ".osssooiiio.",
    ".osssooiiio.",
    "..ooo..ooo..",
    ".obbbooorrro",
    "obbbbbborrro",
    "obbbbbborrro",
    "obbbbbborrro",
    "oooooooooooo",
    "............",
  ],
  bell: [
    ".....oo.....",
    "....oyyo....",
    "...oyyyyo...",
    "..oyywyyyo..",
    "..oyywyyyo..",
    "..oyyyyyyo..",
    ".oyyyyyyyyo.",
    ".oYYYYYYYYo.",
    "oooooooooooo",
    ".....oo.....",
    "....oYYo....",
    ".....oo.....",
  ],
  sound: [
    "......o.....",
    ".....oo..o..",
    "....owo...o.",
    "oooowwo.o..o",
    "owwwwwo..o.o",
    "owwwwwo..o.o",
    "owwwwwo..o.o",
    "oooowwo.o..o",
    "....owo...o.",
    ".....oo..o..",
    "......o.....",
    "............",
  ],
  mute: [
    "......o.....",
    ".....oo.....",
    "....owo.....",
    "oooowwo.r..r",
    "owwwwwo..rr.",
    "owwwwwo..rr.",
    "owwwwwo.r..r",
    "oooowwo.....",
    "....owo.....",
    ".....oo.....",
    "......o.....",
    "............",
  ],
  coin: [
    "............",
    "...oooooo...",
    "..oyyyyyyo..",
    ".oyywyyyyYo.",
    ".oywyyoyyYo.",
    ".oyyyyoyyYo.",
    ".oyyyyoyyYo.",
    ".oyyyyoyyYo.",
    ".oyyyyyyyYo.",
    "..oYYYYYYo..",
    "...oooooo...",
    "............",
  ],
  sit: [
    "..oooooo....",
    "..onnnno....",
    "..onNNno....",
    "..onnnno....",
    "..onnnno....",
    "..oooooooo..",
    "..onnnnnno..",
    "..oNNNNNNo..",
    "..oo....oo..",
    "..oo....oo..",
    "..oo....oo..",
    "............",
  ],
  stand: [
    ".....oo.....",
    "....osso....",
    "....osso....",
    ".....oo.....",
    "...obbbbo...",
    "..obbbbbbo..",
    "..osbbbbso..",
    "...obbbbo...",
    "...oNooNo...",
    "...oNooNo...",
    "...oo..oo...",
    "............",
  ],
  chat: [
    "............",
    ".oooooooooo.",
    "owwwwwwwwwwo",
    "owwwwwwwwwwo",
    "owwowwowwowo",
    "owwwwwwwwwwo",
    ".ooowoooooo.",
    "...owo......",
    "...oo.......",
    "............",
    "............",
    "............",
  ],
  wave: [
    "............",
    "............",
    ".....ooo....",
    "....osssoo..",
    "..o.osssoso.",
    ".osoossssso.",
    ".osssssssso.",
    "..osssssso..",
    "..osssssso..",
    "...osssso...",
    "...osssso...",
    "....oooo....",
  ],
  laugh: [
    "............",
    "...oooooo...",
    "..oyyyyyyo..",
    ".oyyoyyoyyo.",
    ".oyoyooyoyo.",
    ".oyyyyyyyyo.",
    ".oyooooooyo.",
    ".oyorrrroyo.",
    "..oyooooyo..",
    "...oooooo...",
    "............",
    "............",
  ],
  clap: [
    ".....o......",
    "....oyo.....",
    "....oyo.....",
    "...oyyyo....",
    "ooyyywyyyoo.",
    "..ooyyyoo...",
    "...oyyyo....",
    "....oyo..y..",
    "....oyo.yyy.",
    ".....o...y..",
    "............",
    "............",
  ],
  dance: [
    "......o.....",
    "......oo....",
    "......obo...",
    "......o.bo..",
    "......o..o..",
    "......o..o..",
    "......o.o...",
    "...oooo.....",
    "..obbbo.....",
    "..obbbo.....",
    "...ooo......",
    "............",
  ],
  sleep: [
    "............",
    ".......BBBB.",
    ".........B..",
    "........B...",
    ".......BBBB.",
    "BBBBBB......",
    "....B.......",
    "...B........",
    "..B.........",
    ".B..........",
    "BBBBBB......",
    "............",
  ],
  cheer: [
    "....y..p....",
    ".p...oo....b",
    "....oyyo....",
    "....orro....",
    "...oyyyyo...",
    "...orrrro...",
    "..oyyyyyyo..",
    "..orrrrrro..",
    ".oyyyyyyyyo.",
    ".oooooooooo.",
    "b.........p.",
    "............",
  ],
  heart: [
    "............",
    "..ooo..ooo..",
    ".opwpoopppo.",
    ".oppppppppo.",
    ".oppppppppo.",
    "..oppppppo..",
    "...oppppo...",
    "....oppo....",
    ".....oo.....",
    "............",
    "............",
    "............",
  ],
  close: [
    "............",
    "............",
    "..oo....oo..",
    "..ooo..ooo..",
    "...oooooo...",
    "....oooo....",
    "....oooo....",
    "...oooooo...",
    "..ooo..ooo..",
    "..oo....oo..",
    "............",
    "............",
  ],
};

const cache = new Map<string, string>();

/** Data URL of icon `name` (12×12 at 1×). */
export function iconUrl(name: string): string {
  let url = cache.get(name);
  if (url) return url;
  const grid = ICONS[name];
  const c = document.createElement("canvas");
  c.width = 12;
  c.height = 12;
  const ctx = c.getContext("2d")!;
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = PAL[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  url = c.toDataURL();
  cache.set(name, url);
  return url;
}

/** An <img> of icon `name`, `scale`× (2 → 24 px). */
export function pxIcon(name: string, scale = 2): HTMLImageElement {
  const img = document.createElement("img");
  img.className = "px-icon";
  img.src = iconUrl(name);
  img.width = 12 * scale;
  img.height = 12 * scale;
  img.alt = "";
  img.draggable = false;
  return img;
}

/** Emote id → icon name (ids as in protocol `emote::*`). */
export const EMOTE_ICONS: Record<number, string> = { 1: "wave", 2: "laugh", 3: "clap", 4: "dance", 5: "sleep", 6: "cheer", 7: "heart" };
