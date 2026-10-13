// An avatar's look, packed into one u32 (stored with the player, carried in
// tokens and EntityInfo):
//
//   bits  0–7   outfit hue        bits 16–23  hat hue
//   bits  8–9   skin tone         bits 24–26  hairstyle
//   bits 10–12  hair colour       bits 27–29  accessory
//   bits 13–14  hat               bits 15, 30–31  outfit style
//
// Mirrored on the server only as "anything but the NPC looks is allowed".

export interface Look {
  hue: number; // 0–255
  skin: number; // 0–3
  hair: number; // 0–7
  hat: number; // 0–3: none, beanie, cap, flower
  hatHue: number; // 0–255
  style: number; // 0–7 hairstyle
  accessory: number; // 0–7
  outfit: number; // 0–7
}

export const HAIRSTYLES = ["Short", "Long", "Bob", "Ponytail", "Buns", "Spiky", "Shaved", "Curly"];
export const OUTFITS = ["Tee", "Overalls", "Stripes", "Dress", "Hoodie", "Jacket", "Heart jumper", "Waistcoat"];
export const ACCESSORIES = ["None", "Glasses", "Sunglasses", "Scarf", "Backpack", "Bow", "Headphones", "Flower crown"];
export const HATS = ["None", "Beanie", "Cap", "Flower"];

export function decodeLook(look: number): Look {
  return {
    hue: look & 0xff,
    skin: (look >>> 8) & 3,
    hair: (look >>> 10) & 7,
    hat: (look >>> 13) & 3,
    hatHue: (look >>> 16) & 0xff,
    style: (look >>> 24) & 7,
    accessory: (look >>> 27) & 7,
    outfit: ((look >>> 15) & 1) | (((look >>> 30) & 3) << 1),
  };
}

export function encodeLook(l: Look): number {
  return (
    ((l.hue & 0xff) |
      ((l.skin & 3) << 8) |
      ((l.hair & 7) << 10) |
      ((l.hat & 3) << 13) |
      ((l.outfit & 1) << 15) |
      ((l.hatHue & 0xff) << 16) |
      ((l.style & 7) << 24) |
      ((l.accessory & 7) << 27) |
      (((l.outfit >>> 1) & 3) << 30)) >>>
    0
  );
}

export function randomLook(): number {
  const r = (n: number) => Math.floor(Math.random() * n);
  return encodeLook({ hue: r(256), skin: r(4), hair: r(8), hat: r(4), hatHue: r(256), style: r(8), accessory: r(3) === 0 ? r(8) : 0, outfit: r(8) });
}
