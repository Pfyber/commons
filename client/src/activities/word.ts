// The town word at the arcade (server: api play.rs): one five-letter word a
// day, solved by everyone together. Every guess stays up for later visitors,
// so each one helps the next person.

import { ApiError } from "../net/api";
import type { Town, WordState } from "../town";
import { Panel, button, el } from "../ui/panels";

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

export class WordPanel extends Panel {
  private state: WordState | null = null;
  private draft = "";
  private msg = el("p", "error");

  constructor(
    private town: Town,
    private onWon: (s: WordState) => void,
  ) {
    super("🕹️ The town word", "word");
  }

  show() {
    super.show();
    this.town
      .word()
      .then((s) => {
        this.state = s;
        if (this.open) this.render();
      })
      .catch((e) => (this.msg.textContent = e instanceof ApiError ? e.message : "Couldn't load today's word."));
  }

  private async submit() {
    const g = this.draft.trim().toLowerCase();
    if (!/^[a-z]{5}$/.test(g)) {
      this.msg.textContent = "Five letters, please.";
      return;
    }
    this.msg.textContent = "";
    try {
      const s = await this.town.guess(g);
      this.state = s;
      this.draft = "";
      if (s.won) {
        this.msg.className = "ok";
        this.msg.textContent = "You got it! Everyone who helped today gets a little something. 🎉";
        this.onWon(s);
      }
    } catch (e) {
      this.msg.className = "error";
      this.msg.textContent = e instanceof ApiError ? e.message : "That didn't work.";
    }
    this.render();
  }

  /** Best known state of each letter from today's guesses. */
  private letterStates(): Map<string, string> {
    const best = new Map<string, string>();
    const rank: Record<string, number> = { ".": 0, y: 1, g: 2 };
    for (const g of this.state?.guesses ?? []) {
      [...g.guess].forEach((ch, i) => {
        const m = g.marks[i];
        if ((rank[m] ?? 0) >= (rank[best.get(ch) ?? ""] ?? -1)) best.set(ch, m);
      });
    }
    return best;
  }

  render() {
    this.body.replaceChildren();
    const s = this.state;
    if (!s) {
      this.body.append(el("p", "empty", "Loading…"), this.msg);
      return;
    }
    this.body.append(
      el("p", "hint", "One word a day for the whole town. Everyone's guesses stay up, so each one helps the next person."),
    );
    const grid = el("div", "word-grid");
    for (const g of s.guesses) {
      const row = el("div", "word-row");
      for (let i = 0; i < 5; i++) row.append(el("span", `tile m${g.marks[i] === "." ? "x" : g.marks[i]}`, g.guess[i]));
      row.append(el("span", "who", g.name));
      grid.append(row);
    }
    if (!s.guesses.length) grid.append(el("p", "empty", "No guesses yet today. Start us off!"));
    this.body.append(grid);

    if (s.solved_by) {
      this.body.append(el("p", "ok", `Solved by ${s.solved_by} · ${s.helpers} ${s.helpers === 1 ? "person" : "people"} helped. The word was “${s.answer}”. New one tomorrow!`));
    } else if (s.answer) {
      this.body.append(el("p", "hint", `The town ran out of guesses. It was “${s.answer}”. New one tomorrow!`));
    } else {
      const form = el("form", "add-friend");
      const input = el("input");
      input.maxLength = 5;
      input.placeholder = "Five letters";
      input.value = this.draft;
      input.autocomplete = "off";
      input.oninput = () => (this.draft = input.value.replace(/[^a-z]/gi, "").slice(0, 5));
      const go = button("Guess", () => form.requestSubmit(), "small primary-sm");
      go.disabled = s.mine_left === 0;
      form.append(input, go);
      form.onsubmit = (e) => {
        e.preventDefault();
        void this.submit();
      };
      this.body.append(form);
      this.body.append(el("p", "hint", `You have ${s.mine_left} guesses left today · the town has ${s.town_left}.`));

      const states = this.letterStates();
      const kb = el("div", "word-keys");
      for (const r of ROWS) {
        const row = el("div", "");
        for (const ch of r) {
          const m = states.get(ch);
          const k = button(ch, () => {
            if (this.draft.length < 5) this.draft += ch;
            input.value = this.draft;
          }, `key ${m === "g" ? "mg" : m === "y" ? "my" : m === "." ? "mx" : ""}`);
          row.append(k);
        }
        kb.append(row);
      }
      this.body.append(kb);
    }
    this.body.append(this.msg);
  }
}
