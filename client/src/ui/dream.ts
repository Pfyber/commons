// Panels for the dreamier corners: messages in bottles (kind notes between
// strangers) and wish lanterns.

import { ApiError, type Auth } from "../net/api";
import { Panel, button, el } from "./panels";

function errText(e: unknown): string {
  return e instanceof ApiError ? e.message : "That didn't work.";
}

interface Found {
  id: number;
  text: string;
  at: number;
}

const PROMPTS = [
  "Something you wish someone had told you…",
  "A little encouragement for a stranger…",
  "Something that made today good…",
  "A kind word for whoever finds this…",
];

/** Messages in bottles at the end of the pier. */
export class BottlesPanel extends Panel {
  private msg = el("p", "error");
  private ok = el("p", "ok");
  private found: Found | null = null;
  private stats: { thrown: number; found: number; thanked: number; left_today: number } | null = null;

  constructor(private auth: Auth) {
    super("Messages in bottles", "bottles");
  }

  show() {
    super.show();
    this.msg.textContent = "";
    this.ok.textContent = "";
    void this.loadStats();
  }

  private async loadStats() {
    try {
      this.stats = await this.auth.get("/api/bottles");
      if (this.open) this.render();
    } catch {
      // shown as empty
    }
  }

  render() {
    this.body.replaceChildren();
    this.body.append(
      el("p", "hint", "Write a kind note to someone you'll never meet and throw it in the pond. Now and then, the water brings you someone else's. Nobody sees who wrote them."),
    );

    if (this.found) {
      const f = this.found;
      const note = el("div", "bottle-note");
      note.append(el("span", "", f.text), el("small", "", `adrift since ${new Date(f.at * 1000).toLocaleDateString()}`));
      const thanks = button("💛 Send a thank-you", () => void this.thank(f.id), "small primary-sm");
      const report = button("Report", () => void this.report(f.id), "small subtle");
      const row = el("div", "row-buttons");
      row.append(thanks, report);
      note.append(row);
      this.body.append(note);
    }
    this.body.append(button("🌊 Look along the shore", () => void this.find(), "primary"));

    this.body.append(el("h3", "", "Write one"));
    const text = el("textarea", "bottle-text");
    text.maxLength = 200;
    text.rows = 3;
    text.placeholder = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
    const throwIt = button("Throw it in 🍾", () => void this.throwIt(text), "primary-sm");
    if (this.stats && this.stats.left_today <= 0) throwIt.disabled = true;
    this.body.append(text, throwIt);
    if (this.stats) {
      const s = this.stats;
      this.body.append(
        el("p", "hint", s.thrown ? `Your bottles: ${s.thrown} thrown · ${s.found} found by someone · ${s.thanked} thank-you${s.thanked === 1 ? "" : "s"} 💛` : "You haven't thrown one yet."),
      );
    }
    this.body.append(this.ok, this.msg);
  }

  private async find() {
    this.msg.textContent = "";
    this.ok.textContent = "";
    try {
      const r = await this.auth.send<{ found: boolean; bottle?: Found; wait_min?: number; empty?: boolean }>("/api/bottles/find", {});
      if (r.found && r.bottle) this.found = r.bottle;
      else if (r.wait_min) this.ok.textContent = `The water's calm right now. Try again in about ${r.wait_min} min.`;
      else this.ok.textContent = "No bottles washed up today. Maybe throw one for someone else?";
    } catch (e) {
      this.msg.textContent = errText(e);
    }
    this.render();
  }

  private async thank(id: number) {
    try {
      await this.auth.send(`/api/bottles/${id}/thanks`, {});
      this.found = null;
      this.ok.textContent = "💛 Sent. Whoever wrote it will know it reached someone.";
    } catch (e) {
      this.msg.textContent = errText(e);
    }
    this.render();
  }

  private async report(id: number) {
    try {
      await this.auth.send(`/api/bottles/${id}/report`, {});
      this.found = null;
      this.ok.textContent = "Thanks for telling us. The Caretaker will have a look.";
    } catch (e) {
      this.msg.textContent = errText(e);
    }
    this.render();
  }

  private async throwIt(text: HTMLTextAreaElement) {
    const t = text.value.trim();
    if (t.length < 2) return;
    try {
      await this.auth.send("/api/bottles", { text: t });
      this.ok.textContent = "🍾 Off it goes. Someone will find it.";
      await this.loadStats();
    } catch (e) {
      this.msg.textContent = errText(e);
    }
    this.render();
  }
}

/** The wish lantern stand: write a wish, and a lantern carries it up. */
export class WishPanel extends Panel {
  constructor(private release: (text: string) => void) {
    super("Wish lanterns", "wish");
  }

  render() {
    this.body.replaceChildren();
    this.body.append(el("p", "hint", "Write a wish, or a thought for someone, and let a lantern carry it up. Everyone nearby will see it rise. Lovelier after dark."));
    const input = el("input", "wish-text");
    input.maxLength = 60;
    input.placeholder = "for everyone here tonight…";
    const go = button("Let it go 🏮", () => {
      const t = input.value.trim();
      if (!t) return;
      this.release(t);
      this.hide();
    }, "primary");
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") go.click();
    };
    this.body.append(input, go);
    window.setTimeout(() => input.focus(), 50);
  }
}
