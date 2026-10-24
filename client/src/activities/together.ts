// Being together: moods (a little sign above your head saying how you'd like
// company), and things done with someone (a hug, a high five, a dance), which
// one person offers and the other accepts.

export const MOODS: { id: number; icon: string; label: string; hint: string }[] = [
  { id: 0, icon: "🚶", label: "Just wandering", hint: "No sign above your head." },
  { id: 1, icon: "💬", label: "Open to chat", hint: "Anyone's welcome to come and say hi." },
  { id: 2, icon: "🌙", label: "Quiet company", hint: "Sit with me; no need to talk." },
  { id: 3, icon: "♟", label: "Up for a game", hint: "Chess, the ball, the arcade…" },
];

export const TOGETHER: Record<number, { icon: string; offer: string; verb: string; done: string }> = {
  1: { icon: "🤗", offer: "Offer a hug", verb: "a hug", done: "hug" },
  2: { icon: "✋", offer: "High five", verb: "a high five", done: "high-five" },
  3: { icon: "💃", offer: "Dance together", verb: "a dance", done: "dance together" },
  // Rock paper scissors (see rps.ts): played out by the Rps messages.
  6: { icon: "✊", offer: "Rock paper scissors", verb: "a game of rock paper scissors", done: "play" },
};

/** `together::FOLLOW` / `STOP_FOLLOW`: walking after someone. */
export const FOLLOW = 4;
export const STOP_FOLLOW = 5;
/** `together::BOAT`: come aboard my rowboat. */
export const BOAT = 7;

export const moodIcon = (m: number) => (m > 0 ? (MOODS.find((x) => x.id === m)?.icon ?? "") : "");

/** A small card for an offer: "Ana offers a hug 🤗 [Hug back] [Not now]". */
export class OfferCard {
  private el: HTMLDivElement;
  private timer = 0;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "offer-card";
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  show(name: string, kind: number, accept: () => void) {
    const t = TOGETHER[kind];
    if (!t && kind !== FOLLOW && kind !== BOAT) return;
    this.el.replaceChildren();
    const text = document.createElement("span");
    text.textContent = kind === FOLLOW ? `👣 ${name} would like to follow you around` : kind === BOAT ? `🚣 ${name} invites you aboard their rowboat` : `${t.icon} ${name} offers you ${t.verb}`;
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "primary-sm";
    yes.textContent = kind === FOLLOW ? "Sure, come along" : kind === BOAT ? "Climb aboard 🚣" : kind === 1 ? "Hug back" : kind === 2 ? "Slap it ✋" : kind === 6 ? "Let's play ✊" : "Dance!";
    yes.onclick = () => {
      accept();
      this.hide();
    };
    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "Not now";
    no.onclick = () => this.hide();
    this.el.append(text, yes, no);
    this.el.hidden = false;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), 18_000);
  }

  hide() {
    this.el.hidden = true;
  }

  destroy() {
    this.el.remove();
  }
}

/** The mood picker, opened from the HUD. */
export class MoodPicker {
  readonly el: HTMLDivElement;

  constructor(private pick: (mood: number) => void) {
    this.el = document.createElement("div");
    this.el.className = "mood-picker";
    this.el.hidden = true;
    const title = document.createElement("strong");
    title.textContent = "How are you feeling about company?";
    this.el.append(title);
    for (const m of MOODS) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.mood = String(m.id);
      const label = document.createElement("span");
      label.textContent = `${m.icon} ${m.label}`;
      const hint = document.createElement("small");
      hint.textContent = m.hint;
      b.append(label, hint);
      b.onclick = () => {
        this.pick(m.id);
        this.hide();
      };
      this.el.append(b);
    }
    document.body.appendChild(this.el);
    // Escape or a tap anywhere else puts it away.
    window.addEventListener("keydown", (e) => e.key === "Escape" && this.hide());
    window.addEventListener("pointerdown", (e) => {
      const t = e.target as Element | null;
      if (!this.el.hidden && t && !this.el.contains(t) && !t.closest(".mood-btn")) this.hide();
    });
  }

  setCurrent(mood: number) {
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("on", b.dataset.mood === String(mood));
  }

  toggle() {
    this.el.hidden = !this.el.hidden;
  }

  hide() {
    this.el.hidden = true;
  }
}
