// The Skate Trainer: a coach waiting by the skatepark's gate who teaches
// everything, one lesson at a time. Talk to him for a book of lessons in
// tabs (the basics, tricks, rails and manuals, ramps and air, the modes,
// your board), each saying what it is, which keys, and a tip. "Try it"
// puts you on a board with a banner telling you what to do; land it and
// it's ticked off (kept on this device), with the next one a tap away.

import * as sfx from "../ambient/skatesfx";
import type { EntityInfo } from "../net/protocol.gen";
import { Panel, button, el } from "../ui/panels";
import { Avatar } from "../world/avatars";
import { STREET_SKATER_LOOK } from "../world/art";
import type { Scene } from "../world/scene";
import { BODY_FLIPS, FLIPS, GRABS, GRINDS, type SkateEvent, type Skater } from "./skatesim";

/** The trainer's NPC id, clear of the others'. */
const TRAINER_ID = 0xfffffe20;
/** Where he waits: in the skatepark's north gateway, by the fence (tiles). */
const SPOT = { x: 116, y: 214 };
const STORE = "commons.skatelessons";

export const TRAINER = {
  name: "Skate Trainer",
  // A real street skater: a hoodie, shades, a beanie, baggy jeans (see art's STREET_SKATER_LOOK).
  look: STREET_SKATER_LOOK,
  hellos: ["Hey! Want to learn something new today?", "Step up, I'll teach you anything.", "Every pro started with an ollie.", "Pick a lesson, then show me!"],
};

/** What a lesson's watching for: a trick of some name, a moment of play, or something done. */
type Check = (e: SkateEvent | { t: "run" } | { t: "line" } | { t: "frame" }, me: Skater) => boolean;

export interface Lesson {
  id: string;
  title: string;
  /** What it is, in a sentence. */
  what: string;
  /** The keys (shown as key caps), and on a phone. */
  keys: string[];
  /** A tip from the trainer. */
  tip: string;
  /** What the banner says to do while you try it. */
  goal: string;
  /** How it's done (else it's one to read: "Got it"). */
  done?: Check;
  /** Started in a run or a line (else free skating). */
  mode?: "run" | "line";
  /** How many times (the banner counts). */
  times?: number;
}

const names = (o: Record<string, { name: string }>) => new Set(Object.values(o).map((v) => v.name));
const FLIP_NAMES = names(FLIPS);
const GRAB_NAMES = names(GRABS);
const BODY_NAMES = names(BODY_FLIPS);
const isTrick = (e: Parameters<Check>[0], f: (name: string) => boolean) => e.t === "trick" && f(e.name);

export const TABS: { name: string; lessons: Lesson[] }[] = [
  {
    name: "Basics",
    lessons: [
      { id: "push", title: "Push and steer", what: "Push off to get going and steer where you want to go.", keys: ["←", "↑", "→", "↓"], tip: "Each push adds speed: keep holding the way you're going and you'll keep pushing.", goal: "Hold a direction and push up to a good speed.", done: (e, me) => e.t === "frame" && me.speed > 150 },
      { id: "slide", title: "Turn around", what: "Press back the way you came to powerslide round.", keys: ["opposite arrow"], tip: "Going slow? It's a quick kick turn instead.", goal: "Get rolling, then press the opposite way.", done: (e, me) => e.t === "frame" && me.slideDir !== 0 },
      { id: "ollie", title: "Ollie", what: "The jump every trick starts from.", keys: ["Space"], tip: "Hold Space to crouch, let go to pop. The longer you hold, the higher you go.", goal: "Hold Space, then let go to jump.", done: (e) => isTrick(e, (n) => n === "Ollie") },
      { id: "big_ollie", title: "Big ollie", what: "A fully charged ollie: as high as you can go.", keys: ["hold Space"], tip: "Wait until you're crouched right down before letting go.", goal: "Hold Space for a full crouch, then pop.", done: (e) => e.t === "pop" && e.power >= 0.9 },
      { id: "bank", title: "Combos", what: "Tricks in a row add up; land and they're banked as points.", keys: [], tip: "More tricks in one combo means each one's worth more: the total is multiplied by how many.", goal: "Land a combo of 2 tricks or more.", done: (e) => e.t === "bank" && e.count >= 2 },
    ],
  },
  {
    name: "Tricks",
    lessons: [
      { id: "flip", title: "Kickflip and friends", what: "Flip the board under you in the air.", keys: ["J", "+ arrow"], tip: "No arrow is a Kickflip, ← Heelflip, → Varial, ↑ Hardflip, ↓ Shove-it. Press J twice quickly for a double. Needs Flip, Pro or Surf trucks from Dusty.", goal: "Ollie, then press J in the air.", done: (e) => isTrick(e, (n) => FLIP_NAMES.has(n.replace(/^Double /, ""))) },
      { id: "grab", title: "Grabs", what: "Grab the board in the air for points.", keys: ["K", "+ arrow"], tip: "Hold K longer for more points, but let go before you land or it's sketchy.", goal: "Ollie, hold K in the air, let go before landing.", done: (e) => isTrick(e, (n) => GRAB_NAMES.has(n)) },
      { id: "spin", title: "Spins", what: "Spin round in the air: 180, 360, 540…", keys: ["Q", "E"], tip: "Land facing straight forwards or backwards, never sideways.", goal: "Ollie and hold Q or E to spin.", done: (e) => isTrick(e, (n) => /^\d+ /.test(n)) },
      { id: "body", title: "Full flip", what: "Off a ramp, flip your whole body head over heels.", keys: ["Space", "in the air"], tip: "Only off a ramp, and make it all the way round before you land. Needs Vert, Pro or Surf trucks.", goal: "Launch off a kicker or quarter pipe, then press Space in the air.", done: (e) => isTrick(e, (n) => BODY_NAMES.has(n)) },
    ],
  },
  {
    name: "Rails & manuals",
    lessons: [
      { id: "manual", title: "Manual", what: "Balance on your back wheels while you roll.", keys: ["L", "← →"], tip: "Tap the arrow on the side the needle drifts to. Small taps beat holding.", goal: "Roll along and press L, then keep the needle in the green.", done: (e) => isTrick(e, (n) => n.endsWith("Manual")) },
      { id: "grind", title: "Grind", what: "Slide along a rail or a ledge.", keys: ["Space", "← →"], tip: "Come down onto it moving along it, not across it. Balance with ← →, Space pops you off.", goal: "Ollie onto a rail or the edge of a box, moving along it.", done: (e) => isTrick(e, (n) => Object.values(GRINDS).some((g) => n.startsWith(g))) },
      { id: "link", title: "Link a big combo", what: "Land into a manual to keep a combo going across landings.", keys: ["L", "on landing"], tip: "Press L just before you touch down, then pop out of the manual with Space into another trick.", goal: "Land a combo of 4 tricks or more.", done: (e) => e.t === "bank" && e.count >= 4 },
    ],
  },
  {
    name: "Ramps & air",
    lessons: [
      { id: "air", title: "Air off a quarter pipe", what: "Ride straight up a quarter pipe and fly out over its lip.", keys: ["↑", "toward it"], tip: "More speed means more air. Hold the way out over the lip to fly off it instead of dropping back in.", goal: "Push hard straight up a quarter pipe.", done: (e) => isTrick(e, (n) => n === "Air" || n === "Big Air") },
      { id: "dropin", title: "Drop in", what: "Roll in over a ramp's tall back edge and down its face.", keys: [], tip: "Ride up onto the deck behind a ramp, then roll off its edge into it.", goal: "Roll over a ramp's top edge from behind it.", done: (e) => isTrick(e, (n) => n === "Drop In") },
      { id: "launch", title: "Ramp to ramp", what: "Pop off a ramp in the direction you hold.", keys: ["Space", "+ arrow"], tip: "Pop near the top of a kicker for the biggest launch.", goal: "Clear a gap: kicker to kicker, over the funbox, or down the stairs.", done: (e) => isTrick(e, (n) => n === "Kicker Gap" || n === "Funbox Gap" || n === "Stair Set") },
      { id: "special", title: "Special meter", what: "Big tricks fill the meter under your score. Full, every trick's worth 1.5×.", keys: [], tip: "It slowly drains when you're not doing tricks, so keep the combos coming.", goal: "Fill the special meter.", done: (e) => e.t === "special" },
    ],
  },
  {
    name: "Modes",
    lessons: [
      { id: "run", title: "60-second run", what: "Score everything you can before the horn.", keys: [], tip: "Combos still in the air at the horn count, as long as you land them.", goal: "Finish a 60-second run.", mode: "run", done: (e) => e.t === "run" },
      { id: "line", title: "Line", what: "One combo, as long as you can keep it going.", keys: [], tip: "Manuals are the glue: land into one every time.", goal: "Finish a line.", mode: "line", done: (e) => e.t === "line" },
      { id: "duel", title: "1v1", what: "Go head to head for 60 seconds, against a skater or the bot.", keys: [], tip: "Pick “Grinds only” on the Skatepark board for a grinding battle.", goal: "" },
      { id: "quests", title: "Daily quests", what: "Three quests a day from Dusty, 20 to 50 coins each.", keys: [], tip: "Check the Quests tab at Dusty's van or on the Skatepark board.", goal: "" },
    ],
  },
  {
    name: "Your board",
    lessons: [
      { id: "shop", title: "Build your board", what: "Dusty's van sells decks, wheels, bearings, trucks and trails.", keys: [], tip: "Trucks unlock tricks, bearings make you faster off the mark, big wheels go faster.", goal: "" },
      { id: "pump", title: "Pumping", what: "On Surf trucks, steer side to side to pump yourself along.", keys: ["← →", "or ↑ ↓"], tip: "Find a steady rhythm across the way you're heading: each switch shoves you on.", goal: "Pump 4 times (on Surf trucks).", times: 4, done: (e) => e.t === "pump" },
    ],
  },
];

export const TIPS = [
  "Hold the direction you're going and you keep pushing on your own.",
  "Charge your ollie (hold Space) to clear boxes and reach rails.",
  "Land straight: a spin that ends sideways is a bail.",
  "Don't hold K or J as you land, let go a moment before.",
  "Manuals between tricks keep a combo alive.",
  "Tap Dusty's van any time, even on your board, to change your setup.",
  "Ride out through a gate and you step off your board.",
];

const ALL = TABS.flatMap((t) => t.lessons);

/** The trainer by the gate, his book of lessons, and the coach while you try one. */
export class SkateTrainer {
  readonly avatar: Avatar;
  readonly panel: TrainerPanel;
  private learned = new Set<string>();
  /** The lesson being tried (and how many times so far). */
  private trying: { lesson: Lesson; count: number } | null = null;
  private banner = el("div", "skate-coach");
  private said = 0;

  constructor(
    scene: Scene,
    labels: HTMLElement,
    /** On a board for a lesson (in a run or a line, or free). */
    private ride: (mode: "free" | "run" | "line") => boolean,
  ) {
    const info: EntityInfo = { id: TRAINER_ID, name: TRAINER.name, look: TRAINER.look, x: SPOT.x, y: SPOT.y, state: 0, speedX10: 0, t0: 0, sprintIn: 0, path: [], mood: 0, away: false, reading: 0, calling: false, style: 0, pet: 0, vehicle: 0, tool: 0 };
    this.avatar = new Avatar(info, scene, labels, false, Date.now());
    this.avatar.markNpc();
    try {
      for (const id of JSON.parse(localStorage.getItem(STORE) ?? "[]") as string[]) this.learned.add(id);
    } catch {
      /* (Nothing kept.) */
    }
    this.panel = new TrainerPanel(this);
    this.banner.hidden = true;
    document.body.append(this.banner);
  }

  get pos() {
    return this.avatar.pos;
  }

  /** Whether a tap at (x, y) (tiles) is on him. */
  hit(x: number, y: number): boolean {
    const p = this.avatar.pos;
    return Math.abs(x - (p.x + 0.5)) < 0.7 && y > p.y - 1.3 && y < p.y + 1.1;
  }

  greet() {
    this.said++;
    this.avatar.say(this.said % 2 ? TRAINER.hellos[Math.floor(Math.random() * TRAINER.hellos.length)] : TIPS[Math.floor(Math.random() * TIPS.length)]);
  }

  isLearned(id: string): boolean {
    return this.learned.has(id);
  }

  get progress(): [number, number] {
    return [ALL.filter((l) => this.learned.has(l.id)).length, ALL.length];
  }

  /** The first lesson not yet learned, after `id` (or from the start). */
  next(after?: string): Lesson | null {
    const i = after ? ALL.findIndex((l) => l.id === after) : -1;
    return [...ALL.slice(i + 1), ...ALL.slice(0, i + 1)].find((l) => !this.learned.has(l.id) && l.done) ?? null;
  }

  learn(id: string) {
    if (this.learned.has(id)) return;
    this.learned.add(id);
    try {
      localStorage.setItem(STORE, JSON.stringify([...this.learned]));
    } catch {
      /* (A private window: not kept.) */
    }
    if (this.panel.open) this.panel.render();
  }

  /** "Try it": on a board, the banner up, watching for it. */
  try(lesson: Lesson) {
    if (!this.ride(lesson.mode ?? "free")) return;
    this.panel.hide();
    this.trying = { lesson, count: 0 };
    this.showBanner();
  }

  private showBanner(done = false) {
    const t = this.trying;
    if (!t) return;
    const l = t.lesson;
    const b = this.banner;
    b.classList.toggle("done", done);
    const keys = el("div", "skate-coach-keys");
    for (const k of l.keys) keys.append(el("kbd", "", k));
    const close = button("✕", () => this.stop(), "skate-coach-close");
    close.title = "Stop the lesson";
    if (done) {
      const next = this.next(l.id);
      const row = el("div", "skate-coach-btns");
      if (next) row.append(button(`Next: ${next.title} ▶`, () => this.try(next), "primary"));
      row.append(button("Lessons", () => (this.stop(), this.panel.show())));
      b.replaceChildren(close, el("div", "skate-coach-title", `✓ Nailed it! ${l.title}`), el("div", "skate-coach-goal", l.tip), row);
    } else {
      const count = l.times ? ` (${t.count}/${l.times})` : "";
      b.replaceChildren(close, el("div", "skate-coach-title", `Lesson: ${l.title}`), el("div", "skate-coach-goal", `${l.goal}${count}`), keys, el("div", "skate-coach-tip", `Tip: ${l.tip}`));
    }
    b.hidden = false;
  }

  stop() {
    this.trying = null;
    this.banner.hidden = true;
  }

  /** What happened on your board: the lesson being tried, done? */
  watch(e: Parameters<Check>[0], me: Skater) {
    const t = this.trying;
    if (!t || !t.lesson.done || this.banner.classList.contains("done")) return;
    if (!t.lesson.done(e, me)) return;
    t.count++;
    if (t.lesson.times && t.count < t.lesson.times) return this.showBanner();
    this.learn(t.lesson.id);
    sfx.special();
    this.showBanner(true);
  }

  update(now: number, wallNow: number) {
    this.avatar.update(now, wallNow);
  }

  destroy() {
    this.avatar.destroy();
    this.banner.remove();
    this.panel.hide();
    this.panel.el.remove();
  }
}

/** The trainer's book: lessons in tabs, what each is, its keys and a tip; try it, or read it. */
class TrainerPanel extends Panel {
  private tab = 0;

  constructor(private trainer: SkateTrainer) {
    super("Skate Trainer", "skate-trainer");
  }

  render() {
    this.body.replaceChildren();
    const [got, all] = this.trainer.progress;
    const head = el("div", "trainer-head");
    const bar = el("span", "trainer-bar");
    const fill = el("span", "trainer-fill");
    fill.style.width = `${Math.round((got / all) * 100)}%`;
    bar.append(fill);
    head.append(el("span", "", `Learned ${got} of ${all}`), bar);
    const next = this.trainer.next();
    if (next) head.append(button(`Start: ${next.title} ▶`, () => this.trainer.try(next), "primary small"));
    const tabs = el("div", "tabs");
    TABS.forEach((t, i) => tabs.append(button(t.name, () => ((this.tab = i), this.render()), i === this.tab ? "on" : "")));
    tabs.append(button("Tips", () => ((this.tab = -1), this.render()), this.tab === -1 ? "on" : ""));
    this.body.append(head, tabs);
    if (this.tab === -1) {
      const list = el("ul", "trainer-tips");
      for (const t of TIPS) list.append(el("li", "", t));
      this.body.append(list);
      return;
    }
    const list = el("div", "trainer-lessons");
    for (const l of TABS[this.tab].lessons) {
      const done = this.trainer.isLearned(l.id);
      const card = el("div", `trainer-lesson${done ? " done" : ""}`);
      const top = el("div", "trainer-lesson-top");
      top.append(el("strong", "", `${done ? "✓ " : ""}${l.title}`));
      if (l.keys.length) {
        const keys = el("span", "trainer-keys");
        for (const k of l.keys) keys.append(el("kbd", "", k));
        top.append(keys);
      }
      card.append(top, el("p", "", l.what), el("p", "trainer-tip", `Tip: ${l.tip}`));
      card.append(
        l.done
          ? button(done ? "Practise again" : "Try it", () => this.trainer.try(l), done ? "small" : "primary small")
          : button(done ? "✓ Got it" : "Got it", () => this.trainer.learn(l.id), "small"),
      );
      list.append(card);
    }
    this.body.append(list);
  }
}
