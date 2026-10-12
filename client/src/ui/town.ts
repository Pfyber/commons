// Town life panels: a topic corner's board, the notice board's daily
// requests, and the town goal at the fountain.

import { COIN, type Economy } from "../economy";
import { ApiError } from "../net/api";
import type { Goal, Post, TagInfo, Town } from "../town";
import { Panel, button, el, icon } from "./panels";

function errText(e: unknown): string {
  return e instanceof ApiError ? e.message : "That didn't work.";
}

function ago(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** A topic corner's board: membership, busy tags, posts and a composer. */
export class QuarterPanel extends Panel {
  private slug = "";
  private tag: string | null = null;
  private posts: Post[] = [];
  private tags: TagInfo[] = [];
  private msg = el("p", "error");
  private draft = "";

  constructor(private town: Town) {
    super("Corner", "quarter");
  }

  async openFor(slug: string) {
    if (this.slug !== slug) {
      this.tag = null;
      this.draft = "";
    }
    this.slug = slug;
    this.msg.textContent = "";
    this.show();
    await Promise.all([this.town.loadQuarters(), this.load()]).catch((e) => (this.msg.textContent = errText(e)));
    this.render();
  }

  private async load() {
    const b = await this.town.board(this.slug, this.tag ?? undefined);
    this.posts = b.posts;
    this.tags = b.tags;
  }

  private async act(f: () => Promise<unknown>) {
    this.msg.textContent = "";
    try {
      await f();
      await Promise.all([this.town.loadQuarters(), this.load()]);
    } catch (e) {
      this.msg.textContent = errText(e);
    }
    if (this.open) this.render();
  }

  render() {
    const q = this.town.quarter(this.slug);
    this.titleEl.textContent = q ? `${q.icon} ${q.name}` : "Corner";
    this.body.replaceChildren();
    if (!q) {
      this.body.append(el("p", "empty", "Loading…"), this.msg);
      return;
    }
    const head = el("div", "quarter-head");
    head.append(el("p", "hint", q.blurb));
    const meta = el("div", "quarter-meta");
    meta.append(
      el("span", "", `${q.members} ${q.members === 1 ? "member" : "members"} · ${q.posts_this_week} ${q.posts_this_week === 1 ? "post" : "posts"} this week`),
      button(q.joined ? "Leave" : "Join", () => this.act(() => this.town.setJoined(q.slug, !q.joined)), q.joined ? "small subtle" : "small primary-sm"),
    );
    head.append(meta);
    this.body.append(head);

    if (this.tags.length) {
      const chips = el("div", "chips");
      chips.append(button("All", () => ((this.tag = null), void this.act(async () => {})), this.tag === null ? "chip on" : "chip"));
      for (const t of this.tags) {
        const b = button(`#${t.tag}`, () => ((this.tag = t.tag), void this.act(async () => {})), this.tag === t.tag ? "chip on" : "chip");
        b.title = `${t.authors} people lately`;
        if (t.forming) b.append(el("span", "badge", "street forming"));
        chips.append(b);
      }
      this.body.append(chips);
      const forming = this.tags.filter((t) => t.forming);
      if (forming.length) {
        this.body.append(
          el("p", "hint", `A street is forming here: ${forming.map((t) => `#${t.tag}`).join(", ")}. Enough neighbours keep talking about it to give it its own alley one day.`),
        );
      }
    }

    const form = el("form", "add-friend");
    const input = el("input");
    input.maxLength = 280;
    input.placeholder = this.tag ? `Say something about #${this.tag}` : "Say something… add #tags";
    input.value = this.draft;
    input.oninput = () => (this.draft = input.value);
    form.append(input, button("Post", () => form.requestSubmit(), "small primary-sm"));
    form.onsubmit = (e) => {
      e.preventDefault();
      let text = input.value.trim();
      if (!text) return;
      if (this.tag && !text.toLowerCase().includes(`#${this.tag}`)) text += ` #${this.tag}`;
      void this.act(async () => {
        await this.town.post(this.slug, text);
        this.draft = "";
      });
    };
    this.body.append(form, this.msg);

    const list = el("div", "posts");
    if (!this.posts.length) list.append(el("p", "empty", this.tag ? `Nothing about #${this.tag} yet.` : "Nobody has posted yet. Be the first!"));
    for (const p of this.posts) {
      const row = el("div", "post");
      const top = el("div", "post-top");
      top.append(el("strong", "", p.author_name), el("span", "time", ago(p.at)));
      row.append(top, el("p", "body", p.body));
      list.append(row);
    }
    this.body.append(list);
  }
}

/** The notice board: three small requests from the neighbours, new each day. */
export class RequestsPanel extends Panel {
  private msg = el("p", "error");
  private list: Awaited<ReturnType<Town["requests"]>> = [];

  constructor(
    private town: Town,
    private eco: Economy,
  ) {
    super("Notice board", "requests");
    eco.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    this.town
      .requests()
      .then((r) => {
        this.list = r;
        if (this.open) this.render();
      })
      .catch((e) => (this.msg.textContent = errText(e)));
  }

  private async deliver(n: number) {
    this.msg.textContent = "";
    try {
      this.eco.applyResult(await this.town.deliver(n));
      this.list = await this.town.requests();
      this.msg.className = "ok";
      this.msg.textContent = "Thank you! That made someone's day.";
    } catch (e) {
      this.msg.className = "error";
      this.msg.textContent = errText(e);
    }
    this.render();
  }

  render() {
    this.body.replaceChildren();
    this.body.append(el("p", "hint", "Neighbours pin small wishes here. New ones every morning."));
    const rows = el("div", "rows");
    if (!this.list.length) rows.append(el("p", "empty", "Loading…"));
    for (const r of this.list) {
      const item = this.eco.items.get(r.item);
      const row = el("div", r.done ? "row request done" : "row request");
      const text = el("div", "request-text");
      text.append(el("span", "", r.text), el("span", "price", `Reward: ${r.reward} coins`));
      row.append(icon(item), text);
      if (r.done) row.append(el("span", "badge new", "Done"));
      else {
        const have = this.eco.qty(r.item);
        const b = button(`Give ${r.qty}`, () => void this.deliver(r.n), "small primary-sm");
        b.disabled = have < r.qty;
        b.title = `You have ${have}`;
        row.append(b);
      }
      rows.append(row);
    }
    this.body.append(rows, this.msg);
  }
}

/** The town goal at the fountain: everyone's coins towards one thing. */
export class GoalPanel extends Panel {
  private msg = el("p", "error");

  constructor(
    private town: Town,
    private eco: Economy,
    private onReached: (g: Goal) => void,
  ) {
    super("Town goal", "goal");
    eco.onChange(() => this.open && this.render());
  }

  show() {
    super.show();
    this.town
      .loadGoal()
      .then(() => this.open && this.render())
      .catch((e) => (this.msg.textContent = errText(e)));
  }

  private async donate(amount: number) {
    this.msg.textContent = "";
    try {
      const r = await this.town.donate(amount);
      this.eco.setTotal(COIN, r.coins, false);
      this.msg.className = "ok";
      this.msg.textContent = r.completed ? "You did it, together! 🎉" : `You gave ${r.accepted} coins. Thank you!`;
      if (r.completed) this.onReached(r.goal);
    } catch (e) {
      this.msg.className = "error";
      this.msg.textContent = errText(e);
    }
    this.render();
  }

  render() {
    this.body.replaceChildren();
    const g = this.town.goal;
    if (!g) {
      this.body.append(el("p", "empty", "Loading…"), this.msg);
      return;
    }
    this.body.append(el("h3", "", g.title), el("p", "hint", g.blurb));
    const bar = el("div", "progress");
    const fill = el("div", "fill");
    fill.style.width = `${Math.min(100, (g.raised / g.target) * 100)}%`;
    bar.append(fill);
    this.body.append(bar, el("p", "progress-text", `${g.raised} / ${g.target} coins${g.done ? " · reached!" : ""}`));
    if (g.mine > 0) this.body.append(el("p", "hint", `You've given ${g.mine} coins to this.`));
    if (!g.done) {
      const btns = el("div", "btns");
      for (const amount of [10, 50, 100]) {
        const b = button(`Give ${amount}`, () => void this.donate(amount), "small primary-sm");
        b.disabled = this.eco.coins < amount;
        btns.append(b);
      }
      this.body.append(btns);
    } else {
      this.body.append(el("p", "hint", "Every goal so far has been reached. More soon!"));
    }
    this.body.append(this.msg);
  }
}
