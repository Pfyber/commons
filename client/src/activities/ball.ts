// The pitch's ball (server: zone instance/play.rs). The server sends its
// position and velocity at `t0` on every kick, bounce and goal; in between we
// evaluate the same friction formula, so it rolls smoothly with no updates.

import { Container, Graphics } from "pixi.js";
import type { ServerMsg } from "../net/protocol.gen";
import { TILE } from "../world/art";

/** Mirrors protocol BALL_UNITS, BALL_V_OFFSET and BALL_FRICTION. */
const UNITS = 64;
const V_OFFSET = 32768;
const FRICTION = 3.5;

type BallMsg = Extract<ServerMsg, { t: "Ball" }>;

export class Ball {
  readonly sprite = new Container();
  private pos = { x: 0, y: 0 };
  private vel = { x: 0, y: 0 };
  private t0 = 0;
  private spin = 0;
  private body = new Graphics();
  left = 0;
  right = 0;
  seen = false;

  constructor() {
    const shadow = new Graphics().ellipse(0, 1, 5, 2).fill({ color: 0x000000, alpha: 0.25 });
    this.sprite.addChild(shadow, this.body);
    this.drawBody();
    this.sprite.visible = false;
  }

  private drawBody() {
    const g = this.body.clear();
    g.circle(0, -5, 5).fill(0x3b3a2e);
    g.circle(0, -5, 4).fill(0xffffff);
    // Patches that turn as it rolls.
    const a = this.spin;
    for (let i = 0; i < 3; i++) {
      const ang = a + (i * Math.PI * 2) / 3;
      g.rect(Math.round(Math.cos(ang) * 2) - 1, Math.round(-5 + Math.sin(ang) * 2) - 1, 2, 2).fill(0x3b3a2e);
    }
  }

  /** Applies a server update; returns which end scored, if any. */
  apply(m: BallMsg): "left" | "right" | null {
    this.pos = { x: m.x / UNITS, y: m.y / UNITS };
    this.vel = { x: (m.vx - V_OFFSET) / UNITS, y: (m.vy - V_OFFSET) / UNITS };
    this.t0 = m.t0;
    const scored = !this.seen ? null : m.left > this.left ? "left" : m.right > this.right ? "right" : null;
    this.left = m.left;
    this.right = m.right;
    this.seen = true;
    this.sprite.visible = true;
    return scored;
  }

  /** Position (tiles) at server time `t`. */
  at(t: number): { x: number; y: number } {
    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (speed <= 0) return this.pos;
    const dt = Math.min(Math.max(0, t - this.t0) / 1000, speed / FRICTION);
    const d = speed * dt - (FRICTION * dt * dt) / 2;
    return { x: this.pos.x + (this.vel.x / speed) * d, y: this.pos.y + (this.vel.y / speed) * d };
  }

  update(serverNow: number) {
    if (!this.seen) return;
    const p = this.at(serverNow);
    const px = Math.round(p.x * TILE);
    const py = Math.round(p.y * TILE);
    if (px !== this.sprite.x) {
      this.spin += (px - this.sprite.x) / 6;
      this.drawBody();
    }
    this.sprite.position.set(px, py);
    this.sprite.zIndex = py;
  }
}
