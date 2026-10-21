// The lucky crate where it sits in the park: a little golden "?" block,
// about a head high, bobbing up and down and rocking a touch (so it catches
// the eye), with a soft golden glow round it, a shadow under it and a
// glint now and then. In its last minute before it moves somewhere else
// it turns see-through and blinks (faster at the very end).

import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { TILE } from "./art";
import { itemTexture } from "./items";
import type { TileXY } from "./motion";
import type { Scene } from "./scene";

/** A soft golden glow, fading out to nothing at its edge. */
function glowTexture(): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,214,80,0.8)");
  g.addColorStop(0.45, "rgba(255,200,60,0.3)");
  g.addColorStop(1, "rgba(255,190,50,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return Texture.from(c);
}

let glowTex: Texture | null = null;

export class LuckyCrate {
  private root: Container | null = null;
  private box: Sprite | null = null;
  private halo: Sprite | null = null;
  private shadow: Graphics | null = null;
  private glint: Graphics | null = null;
  /** Where it sits (tile), if anywhere. */
  at: TileXY | null = null;
  /** When (server time) it moves somewhere else. */
  private moves = Infinity;

  constructor(private scene: Scene) {}

  show(at: TileXY, moves: number) {
    this.hide();
    this.at = at;
    this.moves = moves;
    const root = new Container();
    const x = at.x * TILE + TILE / 2;
    const foot = at.y * TILE + TILE - 4;
    root.zIndex = foot;
    const shadow = new Graphics();
    const box = new Sprite(itemTexture("lucky_crate", "crate"));
    box.texture.source.scaleMode = "nearest";
    box.anchor.set(0.5, 1);
    const glint = new Graphics().star(0, 0, 4, 3, 1).fill({ color: 0xffffff });
    glowTex ??= glowTexture();
    const halo = new Sprite(glowTex);
    halo.anchor.set(0.5);
    halo.blendMode = "add";
    root.addChild(shadow, halo, box, glint);
    this.halo = halo;
    root.position.set(x, foot);
    this.scene.sorted.addChild(root);
    this.root = root;
    this.box = box;
    this.shadow = shadow;
    this.glint = glint;
  }

  hide() {
    this.root?.destroy({ children: true });
    this.root = this.box = this.halo = this.shadow = this.glint = null;
    this.at = null;
  }

  update(serverNow: number, now: number) {
    if (!this.box || !this.shadow || !this.glint || !this.root) return;
    // About to move: see-through, blinking (faster in the last ten seconds).
    const left = this.moves - serverNow;
    if (left < 60_000) {
      const period = left < 10_000 ? 220 : 500;
      this.root.alpha = Math.floor(now / period) % 2 ? 0.55 : 0.18;
    } else this.root.alpha = 1;
    // Bobbing in whole pixels, rocking a little, its shadow shrinking as it rises.
    const bob = (Math.sin(now / 420) + 1) / 2;
    const lift = 3 + Math.round(bob * 4);
    this.box.y = -lift;
    this.box.rotation = Math.round(Math.sin(now / 650) * 2) * 0.05;
    // A soft golden glow, breathing slowly.
    if (this.halo) {
      this.halo.y = -lift - 8;
      this.halo.scale.set(0.95 + bob * 0.06);
      this.halo.alpha = 0.62 + 0.1 * Math.sin(now / 900);
    }
    this.shadow.clear().ellipse(0, 0, 7 - bob * 2, 2.5 - bob * 0.6).fill({ color: 0x000000, alpha: 0.25 });
    // A glint across a corner every couple of seconds.
    const g = (now % 2200) / 2200;
    this.glint.visible = g < 0.16;
    if (this.glint.visible) {
      const s = Math.sin((g / 0.16) * Math.PI);
      this.glint.scale.set(s);
      this.glint.position.set(5, -lift - 13);
      this.glint.rotation = now / 300;
    }
  }

  destroy() {
    this.hide();
  }
}
