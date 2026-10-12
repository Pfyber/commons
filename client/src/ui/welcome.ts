// The Caretaker's panel (the first three tasks, planting your founder's
// seedling, gathering hours) and the Founders' Stone.

import { ApiError } from "../net/api";
import type { TileXY } from "../world/motion";
import { GATHERINGS, type Welcome, nextOccurrence, whenText } from "../welcome";
import { Panel, button, el } from "./panels";

export const STAGES = ["seedling", "sapling", "young tree", "tree"];

/** Places the tasks send you to. */
export const TASK_SPOTS: Record<"fish" | "plant" | "sit" | "grove", TileXY> = {
  fish: { x: 36, y: 65 }, // the pier
  plant: { x: 27, y: 27 }, // the community garden
  sit: { x: 57, y: 41 }, // the chess tables
  grove: { x: 70, y: 41 }, // the Founders' Stone
};

const TASKS: { key: "fish" | "plant" | "sit"; title: string; hint: string }[] = [
  { key: "fish", title: "Catch a fish", hint: "Tap the pond from the pier, then reel in when it bites." },
  { key: "plant", title: "Plant a seed", hint: "Tap a soil patch in the Community Garden. There are seeds in your bag." },
  { key: "sit", title: "Sit with someone", hint: "Share a bench with a neighbour, or play chess. The Park Elder always has time for a game." },
];

function errText(e: unknown): string {
  return e instanceof ApiError ? e.message : "That didn't work.";
}

function date(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export class WelcomePanel extends Panel {
  private msg = el("p", "error");
  private busy = false;

  constructor(
    private welcome: Welcome,
    private go: (t: TileXY) => void,
    private onFounder: (no: number) => void,
  ) {
    super("The Caretaker", "welcome");
    welcome.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    void this.welcome.load().catch((e) => (this.msg.textContent = errText(e)));
  }

  render() {
    this.body.replaceChildren();
    const s = this.welcome.status;
    if (!s) {
      this.body.append(el("p", "empty", "Loading…"), this.msg);
      return;
    }
    const f = s.founder;
    if (f) {
      const box = el("div", "founder-card");
      box.append(
        el("strong", "", `🌱 You're Founder #${f.no}`),
        el("span", "hint", `Your ${STAGES[f.stage]} has been growing in the Founders' Grove since ${date(f.planted_at)}. Trees here grow over real months.`),
        button("Visit my tree", () => this.visit(), "small primary-sm"),
      );
      this.body.append(box);
    } else {
      this.body.append(
        el("p", "intro", "Welcome! I look after the park until the town can look after itself. Three little things to feel at home here:"),
      );
    }

    const list = el("div", "tasks");
    for (const t of TASKS) {
      const done = s.tasks[t.key];
      const row = el("div", done ? "task done" : "task");
      const text = el("div", "task-text");
      text.append(el("strong", "", `${done ? "✓" : "○"} ${t.title}`));
      if (!done) text.append(el("span", "hint", t.hint));
      row.append(text);
      if (!done) row.append(button("Show me", () => this.walk(TASK_SPOTS[t.key]), "small"));
      list.append(row);
    }
    this.body.append(list);

    if (!f) {
      const all = this.welcome.done === 3;
      if (s.season.open) {
        const box = el("div", "plant-box");
        box.append(
          el(
            "span",
            "hint",
            all
              ? "All done! Plant your seedling: it carries your name, grows in the Founders' Grove over the coming months, and makes you one of the town's founders."
              : `Finish all three and you'll plant a seedling with your name in the Founders' Grove, as one of the town's founders. ${s.season.left} of ${s.season.slots} spots are left.`,
          ),
        );
        if (all) {
          const b = button("Plant my seedling 🌱", () => void this.plant(), "primary");
          b.disabled = this.busy;
          box.append(b);
        }
        this.body.append(box);
      } else {
        this.body.append(el("p", "hint", "The founding season has closed: the grove is full. You'll find every founder's name on the Founders' Stone."));
      }
    }

    this.body.append(el("h3", "", "Gathering hours"));
    const now = Date.now();
    for (const g of GATHERINGS) {
      const o = nextOccurrence(g, now);
      const row = el("div", "row");
      const on = o.start <= now;
      row.append(el("span", "name", g.title), el("span", "price", on ? "On now!" : whenText(o.start, now)));
      if (on) row.append(button("Go", () => this.walk(g.at), "small primary-sm"));
      this.body.append(row);
    }
    this.body.append(el("p", "hint", "Come along: that's when the park is liveliest."), this.msg);
  }

  private walk(t: TileXY) {
    this.hide();
    this.go(t);
  }

  private visit() {
    const f = this.welcome.status?.founder;
    if (!f) return;
    this.hide();
    this.go(TASK_SPOTS.grove);
    this.onFounder(f.no);
  }

  private async plant() {
    this.busy = true;
    this.msg.textContent = "";
    this.render();
    try {
      const f = await this.welcome.plant();
      this.onFounder(f.no);
    } catch (e) {
      this.msg.textContent = errText(e);
    } finally {
      this.busy = false;
      if (this.open) this.render();
    }
  }
}

/** The Founders' Stone: every founder's name, in order. */
export class FoundersPanel extends Panel {
  private filter = "";

  constructor(
    private welcome: Welcome,
    private selfName: () => string,
  ) {
    super("Founders' Stone", "founders");
    welcome.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    void this.welcome.loadFounders().catch(() => {});
  }

  render() {
    this.body.replaceChildren();
    const all = this.welcome.founders;
    const season = this.welcome.season;
    this.body.append(
      el(
        "p",
        "hint",
        all.length
          ? `${all.length} founder${all.length === 1 ? "" : "s"} so far${season && season.open ? `; ${season.left} spots left in the grove.` : ". The founding season has closed."}`
          : "No names yet. The first founder's name will be cut here. Ask the Caretaker how.",
      ),
    );
    if (all.length > 12) {
      const search = el("input", "search");
      search.placeholder = "Find a name";
      search.value = this.filter;
      search.oninput = () => {
        this.filter = search.value;
        this.renderList(list);
      };
      this.body.append(search);
    }
    const list = el("div", "founder-list");
    this.body.append(list);
    this.renderList(list);
  }

  private renderList(list: HTMLElement) {
    list.replaceChildren();
    const me = this.selfName();
    const q = this.filter.trim().toLowerCase();
    for (const f of this.welcome.founders) {
      if (q && !f.name.toLowerCase().includes(q)) continue;
      const row = el("div", f.name === me ? "row me" : "row");
      row.append(el("span", "no", `#${f.no}`), el("span", "name", f.name), el("span", "price", STAGES[f.stage]));
      list.append(row);
    }
  }
}
