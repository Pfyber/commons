// The campfire circle: crackling flames, and a gentle question for whoever
// sits round the fire. The question comes from the clock, so everyone at the
// fire sees the same one and can talk about it.

import { Graphics } from "pixi.js";
import { TILE } from "../world/art";
import type { TileXY } from "../world/motion";

/** A new question this often. */
const QUESTION_MS = 4 * 60_000;

export const QUESTIONS = [
  "What's a small thing that made you smile this week?",
  "What's a smell that takes you straight back to childhood?",
  "If you could have dinner with anyone, past or present, who would it be?",
  "What's something you're quietly proud of?",
  "What's the best piece of advice someone ever gave you?",
  "Where's a place you felt completely at peace?",
  "What song do you never skip?",
  "What's something you'd like to get better at?",
  "What did you want to be when you were little?",
  "What's a kind thing a stranger once did for you?",
  "What's your favourite way to spend a rainy day?",
  "What's a book, film or game that stayed with you?",
  "If you could live anywhere for a year, where would it be?",
  "What's something that always cheers you up?",
  "What's a tradition you love, or would like to start?",
  "What are you looking forward to?",
  "What's the most beautiful thing you've seen lately?",
  "Tea, coffee, or something else entirely?",
  "What's a skill you'd teach everyone if you could?",
  "Who's someone you're grateful for, and why?",
];

export function questionAt(now: number): string {
  const k = Math.floor(now / QUESTION_MS);
  // A shuffled walk through the list, so neighbours rarely repeat.
  return QUESTIONS[(k * 7) % QUESTIONS.length];
}

export class Campfire {
  readonly flames = new Graphics();
  private card: HTMLDivElement;
  private shown = "";

  constructor(readonly at: TileXY) {
    this.flames.position.set(at.x * TILE + TILE / 2, at.y * TILE + TILE / 2 + 2);
    this.flames.zIndex = at.y * TILE + TILE;
    this.card = document.createElement("div");
    this.card.className = "fire-card";
    this.card.hidden = true;
    document.body.appendChild(this.card);
  }

  /** Animates the flames; shows the question while you sit by the fire. */
  update(wallNow: number, seatedHere: boolean) {
    const g = this.flames.clear();
    const t = wallNow / 90;
    const glow = 0.9 + Math.sin(wallNow / 160) * 0.1;
    g.circle(0, -6, 30).fill({ color: 0xff9a40, alpha: 0.1 * glow });
    g.circle(0, -6, 18).fill({ color: 0xffb860, alpha: 0.16 * glow });
    for (let i = 0; i < 3; i++) {
      const h = 12 + Math.sin(t + i * 2.1) * 3 + (i === 1 ? 5 : 0);
      const x = -6 + i * 5;
      g.rect(x - 1, -h, 6, h).fill(0xe8642c);
      g.rect(x, -h + 4, 4, h - 4).fill(0xf6a14f);
      g.rect(x + 1, -h + 8, 2, h - 8).fill(0xffe39a);
    }
    const spark = Math.floor(wallNow / 250) % 6;
    g.rect(-3 + spark * 2, -18 - spark * 3, 1, 1).fill(0xffe39a);

    if (!seatedHere) {
      if (!this.card.hidden) this.card.hidden = true;
      return;
    }
    const q = questionAt(Date.now());
    if (q !== this.shown || this.card.hidden) {
      this.shown = q;
      this.card.replaceChildren();
      const head = document.createElement("small");
      head.textContent = "🔥 Around the fire";
      const text = document.createElement("span");
      text.textContent = q;
      const foot = document.createElement("small");
      foot.textContent = "Everyone here sees the same question. Answer if you like, or just listen.";
      this.card.append(head, text, foot);
      this.card.hidden = false;
    }
  }

  destroy() {
    if (!this.flames.destroyed) this.flames.destroy();
    this.card.remove();
  }
}
