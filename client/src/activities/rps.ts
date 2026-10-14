// Rock paper scissors (protocol `together::RPS`, `rps::*`): ask anyone, and
// once they accept you both have ten seconds to pick. Then the two of you
// face each other, pump your fists three times and show your hands.

/** `together::RPS`. */
export const RPS = 6;
/** `rps::*` picks and phases. */
export const ROCK = 1;
export const PAPER = 2;
export const SCISSORS = 3;
export const CHOOSING = 0;
export const REVEAL = 1;
export const CANCELLED = 2;

export const PICKS: { pick: number; icon: string; name: string }[] = [
  { pick: ROCK, icon: "✊", name: "Rock" },
  { pick: PAPER, icon: "✋", name: "Paper" },
  { pick: SCISSORS, icon: "✌️", name: "Scissors" },
];

/** The hand shown at the reveal; a shrug for someone who didn't pick in time. */
export const pickIcon = (p: number) => PICKS.find((x) => x.pick === p)?.icon ?? "🤷";

/** Whether `a` beats `b` (protocol `rps::beats`): not picking loses to any pick. */
export function beats(a: number, b: number): boolean {
  return (a === ROCK && b === SCISSORS) || (a === PAPER && b === ROCK) || (a === SCISSORS && b === PAPER) || (a !== 0 && b === 0);
}

/** "✊ Rock paper scissors with Ana · 7s  [✊] [✋] [✌️]" while you choose. */
export class RpsPicker {
  private el = document.createElement("div");
  private title = document.createElement("strong");
  private clock = document.createElement("span");
  private buttons: HTMLButtonElement[] = [];
  private raf = 0;

  constructor(private onPick: (pick: number) => void) {
    this.el.className = "offer-card rps-card";
    this.el.hidden = true;
    this.clock.className = "rps-clock";
    const row = document.createElement("div");
    row.className = "rps-picks";
    for (const p of PICKS) {
      const b = document.createElement("button");
      b.type = "button";
      b.title = p.name;
      b.setAttribute("aria-label", p.name);
      b.append(Object.assign(document.createElement("span"), { className: "rps-icon", textContent: p.icon }), p.name);
      b.onclick = () => this.choose(p.pick, b);
      this.buttons.push(b);
      row.append(b);
    }
    const head = document.createElement("div");
    head.className = "rps-head";
    head.append(this.title, this.clock);
    this.el.append(head, row);
    document.body.appendChild(this.el);
  }

  /** Opens for a match against `name`; `left()` is the ms remaining. */
  show(name: string, left: () => number) {
    this.title.textContent = `✊ Rock paper scissors with ${name}`;
    for (const b of this.buttons) {
      b.disabled = false;
      b.classList.remove("on");
    }
    this.el.hidden = false;
    cancelAnimationFrame(this.raf);
    const tick = () => {
      const ms = Math.max(0, left());
      this.clock.textContent = `${Math.ceil(ms / 1000)}s`;
      this.clock.classList.toggle("hurry", ms < 3000);
      if (ms > 0 && !this.el.hidden) this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  private choose(pick: number, b: HTMLButtonElement) {
    for (const x of this.buttons) x.disabled = true;
    b.classList.add("on");
    this.title.textContent = `${pickIcon(pick)} Picked! Waiting for the reveal…`;
    this.onPick(pick);
  }

  hide() {
    this.el.hidden = true;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.hide();
    this.el.remove();
  }
}
