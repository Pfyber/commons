// Governance panels: the Story of the Town board, the Town Hall (votes,
// suggestions, discussion, the archive, the Caretaker's tools) and reports.

import type { Gov, LedgerEntry, Proposal, ProposalSummary, Report, Story } from "../gov";
import { ApiError } from "../net/api";
import { Panel, button, el } from "./panels";

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

function left(unix: number): string {
  const s = unix - Date.now() / 1000;
  if (s <= 60) return "closing now";
  if (s < 3600) return `${Math.ceil(s / 60)} min left`;
  if (s < 86400) return `${Math.round(s / 3600)} h left`;
  return `${Math.round(s / 86400)} days left`;
}

const STAGE: Record<string, string> = {
  collecting: "Collecting ideas",
  discussion: "Discussion",
  voting: "Voting",
  passed: "Passed",
  failed: "Didn't pass",
  withdrawn: "Withdrawn",
};

const PHASES = ["Founding", "Equal voice", "Time-weighted voice", "Self-governing"];
const TIERS: Record<string, string> = { visitor: "Visitor", newcomer: "Newcomer", resident: "Resident", steward: "Steward" };

function ledgerList(entries: LedgerEntry[]): HTMLElement {
  const list = el("div", "ledger");
  if (!entries.length) list.append(el("p", "empty", "Nothing recorded yet. The town's story starts soon."));
  for (const e of entries) {
    const row = el("div", "ledger-row");
    row.append(el("span", "time", ago(e.at)), el("span", "", e.summary));
    list.append(row);
  }
  return list;
}

/** The Story of the Town board by the fountain (spec §10.1). */
export class StoryPanel extends Panel {
  private msg = el("p", "error");

  constructor(
    private gov: Gov,
    private openVote: (id: number) => void,
  ) {
    super("Story of the Town", "story");
  }

  show() {
    super.show();
    this.gov
      .loadStory()
      .then(() => this.open && this.render())
      .catch((e) => (this.msg.textContent = errText(e)));
  }

  render() {
    this.body.replaceChildren();
    const s = this.gov.story;
    if (!s) {
      this.body.append(el("p", "empty", "Loading…"), this.msg);
      return;
    }
    this.titleEl.textContent = `The story of ${s.name}`;
    this.body.append(el("p", "story-phase", `Phase ${s.phase}: ${PHASES[s.phase] ?? ""}`));
    if (s.phase === 0) {
      this.body.append(
        el("p", "hint", "The town is just starting. The Caretaker looks after things for now, and every decision is posted here. The first votes are open to neighbours who've spent a few days here."),
      );
    }
    const next = el("div", "story-next");
    next.append(el("span", "", s.next.text));
    if (s.next.need) {
      const bar = el("div", "progress");
      const fill = el("div", "fill");
      fill.style.width = `${Math.min(100, ((s.next.have ?? 0) / s.next.need) * 100)}%`;
      bar.append(fill);
      next.append(bar, el("span", "hint", `${s.next.have ?? 0} of ${s.next.need} so far`));
    }
    this.body.append(next);

    if (s.me) this.body.append(this.standing(s));

    this.body.append(el("h3", "", "Open votes"));
    if (!s.open.length) this.body.append(el("p", "empty", "No votes open right now."));
    for (const o of s.open) {
      const row = el("div", "row");
      const voted = s.me?.voted.includes(o.id);
      row.append(el("span", "name", o.title), el("span", "price", `${STAGE[o.status]} · ${left(o.ends)}`));
      row.append(button(voted ? "Voted ✓" : o.status === "voting" ? "Vote" : "Look", () => this.openVote(o.id), voted ? "small" : "small primary-sm"));
      this.body.append(row);
    }
    this.body.append(el("h3", "", "Recently"), ledgerList(s.recent), this.msg);
  }

  private standing(s: Story): HTMLElement {
    const me = s.me!;
    const box = el("div", "story-me");
    box.append(el("strong", "", `You: ${TIERS[me.tier] ?? me.tier} · ${me.days} active ${me.days === 1 ? "day" : "days"}`));
    const r = s.rules;
    const can: string[] = [];
    if (me.can_vote_founding) can.push("vote in founding votes");
    if (me.can_vote) can.push("vote");
    if (me.can_propose) can.push("propose");
    box.append(
      el("span", "hint", can.length ? `You can ${can.join(", ")}.` : `Founding votes open at ${r.founding_days} active days.`),
      el("span", "hint", `An active day: ${r.active_minutes}+ minutes here and ${r.active_interactions}+ things done with others (chat, games, gifts, gardening…).`),
    );
    return box;
  }
}

type View = { kind: "list" } | { kind: "proposal"; id: number } | { kind: "archive" } | { kind: "caretaker" } | { kind: "propose" };

/** The Town Hall: proposals and votes, the archive, the Caretaker's desk. */
export class TownHallPanel extends Panel {
  private view: View = { kind: "list" };
  private list: ProposalSummary[] = [];
  private current: Proposal | null = null;
  private ranking: number[] = [];
  private ledger: LedgerEntry[] = [];
  private reports: Report[] = [];
  private msg = el("p", "error");

  constructor(private gov: Gov) {
    super("Town Hall", "townhall");
  }

  async openAt(view: View) {
    this.view = view;
    this.msg.textContent = "";
    this.show();
    await this.load();
  }

  private async load() {
    try {
      if (!this.gov.story) await this.gov.loadStory();
      if (this.view.kind === "list") this.list = await this.gov.proposals();
      if (this.view.kind === "proposal") {
        const id = this.view.id;
        if (this.current?.id !== id) this.ranking = [];
        this.current = await this.gov.proposal(id);
      }
      if (this.view.kind === "archive") this.ledger = await this.gov.ledger();
      if (this.view.kind === "caretaker") this.reports = await this.gov.reports();
    } catch (e) {
      this.msg.className = "error";
      this.msg.textContent = errText(e);
    }
    if (this.open) this.render();
  }

  private async act(f: () => Promise<unknown>, ok?: string) {
    this.msg.textContent = "";
    try {
      await f();
      if (ok) {
        this.msg.className = "ok";
        this.msg.textContent = ok;
      }
      await this.gov.loadStory().catch(() => {});
    } catch (e) {
      this.msg.className = "error";
      this.msg.textContent = errText(e);
    }
    await this.load();
  }

  private go(view: View) {
    void this.openAt(view);
  }

  render() {
    this.body.replaceChildren();
    const me = this.gov.story?.me;
    const tabs = el("div", "tabs");
    const tab = (label: string, v: View) =>
      tabs.append(button(label, () => this.go(v), this.view.kind === v.kind || (v.kind === "list" && this.view.kind === "proposal") ? "on" : ""));
    tab("Votes", { kind: "list" });
    if (me?.can_propose && !me.caretaker) tab("Propose", { kind: "propose" });
    tab("Archive", { kind: "archive" });
    if (me?.caretaker) tab("Caretaker", { kind: "caretaker" });
    this.body.append(tabs);
    switch (this.view.kind) {
      case "list":
        this.renderList();
        break;
      case "proposal":
        this.renderProposal();
        break;
      case "archive":
        this.body.append(el("p", "hint", "Everything the town decides is written here, and can never be changed."), ledgerList(this.ledger));
        break;
      case "caretaker":
        this.renderCaretaker();
        break;
      case "propose":
        this.renderPropose();
        break;
    }
    this.body.append(this.msg);
  }

  private renderList() {
    const open = this.list.filter((p) => ["collecting", "discussion", "voting"].includes(p.status));
    const done = this.list.filter((p) => !["collecting", "discussion", "voting"].includes(p.status));
    if (!open.length) this.body.append(el("p", "empty", "No votes open right now."));
    const row = (p: ProposalSummary) => {
      const r = el("div", "row proposal-row");
      const text = el("div", "request-text");
      text.append(el("strong", "", p.title));
      const status = ["passed", "failed"].includes(p.status) && p.result?.winner_text ? `${STAGE[p.status]}: ${p.result.winner_text}` : STAGE[p.status];
      text.append(el("span", "hint", `${status}${["collecting", "discussion", "voting"].includes(p.status) ? ` · ${left(p.ends)}` : ""} · by ${p.author}`));
      r.append(text, button("Open", () => this.go({ kind: "proposal", id: p.id }), "small"));
      return r;
    };
    for (const p of open) this.body.append(row(p));
    if (done.length) {
      this.body.append(el("h3", "", "Decided"));
      for (const p of done.slice(0, 10)) this.body.append(row(p));
    }
  }

  private renderProposal() {
    const p = this.current;
    if (!p) {
      this.body.append(el("p", "empty", "Loading…"));
      return;
    }
    const open = ["collecting", "discussion", "voting"].includes(p.status);
    this.body.append(el("h3", "", p.title));
    this.body.append(el("p", "hint", `${STAGE[p.status]}${open ? ` · ${left(p.ends)}` : ""} · opened by ${p.author}`));
    if (p.body) this.body.append(el("p", "proposal-body", p.body));
    const who = p.electorate === "founders" ? "A founding vote" : "A town vote";
    const rule = p.ranked ? "ranked choice" : p.threshold > 0.5 ? `needs ${Math.round(p.threshold * 100)}% yes` : "simple majority";
    this.body.append(
      el("p", "hint", `${who}: open to neighbours with ${p.me.needs_days} active days (you have ${p.me.days}) · ${rule} · ${Math.round(p.quorum * 100)}% turnout needed.`),
    );

    if (p.status === "collecting") this.renderSuggestions(p);
    if (p.status === "voting") this.renderBallot(p);
    if (p.status === "discussion") this.body.append(el("p", "hint", "Voting opens after the discussion. Say what you think below."));
    if (["passed", "failed"].includes(p.status) && p.result) this.renderResult(p);

    if (p.me.caretaker && open) {
      this.body.append(button(`End “${STAGE[p.status]}” now`, () => void this.act(() => this.gov.advance(p.id), "Moved on."), "small"));
    }
    this.renderComments(p, open);
  }

  private renderSuggestions(p: Proposal) {
    this.body.append(el("h3", "", "Ideas so far"));
    if (!p.suggestions.length) this.body.append(el("p", "empty", "No ideas yet. Be the first!"));
    for (const s of p.suggestions) {
      const row = el("div", "row");
      row.append(el("span", "name", s.text), el("span", "price", `♥ ${s.support}`));
      if (!s.mine && !s.supported && p.me.eligible) row.append(button("Support", () => void this.act(() => this.gov.support(p.id, s.id)), "small"));
      if (s.supported) row.append(el("span", "badge new", s.mine ? "yours" : "supported"));
      this.body.append(row);
    }
    if (p.me.eligible && !p.suggestions.some((s) => s.mine)) {
      const form = el("form", "add-friend");
      const input = el("input");
      input.placeholder = "Your idea";
      input.maxLength = 40;
      form.append(input, button("Suggest", () => form.requestSubmit(), "small primary-sm"));
      form.onsubmit = (e) => {
        e.preventDefault();
        if (input.value.trim()) void this.act(() => this.gov.suggest(p.id, input.value.trim()), "Thanks! Your idea is on the board.");
      };
      this.body.append(form);
    }
    this.body.append(el("p", "hint", "The best-supported ideas go to a vote. You can support up to three."));
  }

  private renderBallot(p: Proposal) {
    if (p.me.voted) {
      this.body.append(el("p", "ok", `You've voted ✓ Ballots are secret. ${p.voters} ${p.voters === 1 ? "neighbour has" : "neighbours have"} voted so far.`));
      return;
    }
    if (!p.me.eligible) {
      this.body.append(el("p", "hint", `${p.voters} voted so far. You'll be able to vote after ${p.me.needs_days} active days.`));
      return;
    }
    if (!p.ranked) {
      const btns = el("div", "btns");
      btns.append(
        button("Yes", () => void this.act(() => this.gov.vote(p.id, [0]), "Your vote is in ✓"), "small primary-sm"),
        button("No", () => void this.act(() => this.gov.vote(p.id, [1]), "Your vote is in ✓"), "small"),
      );
      this.body.append(btns);
      return;
    }
    this.body.append(el("p", "hint", "Tap options in the order you'd like them: your first choice first. You don't have to rank them all."));
    const opts = el("div", "rank-options");
    p.options.forEach((o, i) => {
      const pos = this.ranking.indexOf(i);
      const b = button(pos >= 0 ? `${pos + 1}. ${o}` : o, () => {
        if (pos >= 0) this.ranking.splice(pos, 1);
        else this.ranking.push(i);
        this.render();
      }, pos >= 0 ? "rank on" : "rank");
      opts.append(b);
    });
    this.body.append(opts);
    const cast = button(this.ranking.length ? "Cast my vote" : "Pick at least one", () => void this.act(() => this.gov.vote(p.id, this.ranking), "Your vote is in ✓"), "small primary-sm");
    cast.disabled = !this.ranking.length;
    const btns = el("div", "btns");
    btns.append(cast, button("Clear", () => ((this.ranking = []), this.render()), "small"));
    this.body.append(btns);
  }

  private renderResult(p: Proposal) {
    const r = p.result!;
    const box = el("div", "result");
    if (r.reason) box.append(el("strong", "", r.reason));
    else if (!r.quorum_met) box.append(el("strong", "", "Not enough neighbours voted, so nothing changes."));
    else if (p.ranked && r.winner_text) box.append(el("strong", "", `The town chose “${r.winner_text}”.`));
    else box.append(el("strong", "", p.status === "passed" ? "Passed." : "Didn't pass."));
    box.append(el("span", "hint", `${r.voters} voted · turnout ${r.turnout.toFixed(0)} of ${r.eligible.toFixed(0)} eligible`));
    if (!p.ranked && r.detail.share !== undefined) box.append(el("span", "hint", `${Math.round(r.detail.share * 100)}% yes`));
    if (p.ranked && r.detail.rounds) {
      r.detail.rounds.forEach((round, k) => {
        const parts = round.map((v, i) => (v === null ? null : `${p.options[i]} ${v.toFixed(0)}`)).filter(Boolean);
        box.append(el("span", "hint", `Round ${k + 1}: ${parts.join(" · ")}`));
      });
    }
    this.body.append(box);
  }

  private renderComments(p: Proposal, open: boolean) {
    this.body.append(el("h3", "", "Discussion"));
    const list = el("div", "posts");
    if (!p.comments.length) list.append(el("p", "empty", "No comments yet."));
    for (const c of p.comments) {
      const row = el("div", "post");
      const top = el("div", "post-top");
      top.append(el("strong", "", c.author), el("span", "time", ago(c.at)));
      row.append(top, el("p", "body", c.body));
      list.append(row);
    }
    this.body.append(list);
    if (open) {
      const form = el("form", "add-friend");
      const input = el("input");
      input.placeholder = "Say what you think…";
      input.maxLength = 280;
      form.append(input, button("Post", () => form.requestSubmit(), "small primary-sm"));
      form.onsubmit = (e) => {
        e.preventDefault();
        if (input.value.trim()) void this.act(() => this.gov.comment(p.id, input.value.trim()));
      };
      this.body.append(form);
    }
  }

  private renderPropose() {
    this.body.append(el("p", "hint", "Residents can propose a town rule (needs 60% yes), an event or a public building. One proposal at a time."));
    const form = el("form", "gov-form");
    const kind = el("select");
    for (const [v, label] of [["event", "An event"], ["public_building", "A public building"], ["town_rule", "A town rule"]]) {
      const o = el("option", "", label);
      o.value = v;
      kind.append(o);
    }
    const title = el("input");
    title.placeholder = "Title";
    title.maxLength = 80;
    const body = el("textarea");
    body.placeholder = "What and why?";
    body.maxLength = 1000;
    form.append(kind, title, body, button("Propose", () => form.requestSubmit(), "small primary-sm"));
    form.onsubmit = (e) => {
      e.preventDefault();
      void this.act(async () => {
        const r = await this.gov.create({ kind: kind.value, title: title.value, body: body.value });
        this.view = { kind: "proposal", id: r.id };
      }, "Proposed! It's open for discussion.");
    };
    this.body.append(form);
  }

  private renderCaretaker() {
    this.body.append(el("h3", "", "Founding votes"));
    const btns = el("div", "btns wrap");
    btns.append(
      button("Name the town", () =>
        void this.act(async () => {
          const r = await this.gov.create({
            kind: "town_name",
            title: "What should our town be called?",
            body: "Suggest a name and support the ones you love. The best-supported go to a ranked vote.",
            collect: true,
          });
          this.view = { kind: "proposal", id: r.id };
        }, "Opened: neighbours can suggest names now."), "small primary-sm"),
      button("Beyond the bridge", () =>
        void this.act(async () => {
          const r = await this.gov.create({
            kind: "bridge",
            title: "What lies beyond the bridge?",
            body: "The fog over the east bridge lifts where the town chooses. The winner opens a construction pool everyone can give to.",
            options: ["A lakeside village", "A wild forest", "A market street", "Gardens and greenhouses"],
          });
          this.view = { kind: "proposal", id: r.id };
        }, "Opened for discussion; voting follows."), "small primary-sm"),
    );
    this.body.append(btns);

    this.body.append(el("h3", "", "Post a decision"), el("p", "hint", "During the founding phase, Caretaker decisions are posted publicly as temporary, with when they end."));
    const d = el("form", "gov-form");
    const title = el("input");
    title.placeholder = "Decision";
    title.maxLength = 80;
    const until = el("input");
    until.placeholder = "Until… (e.g. the first council)";
    const body = el("textarea");
    body.placeholder = "Why";
    d.append(title, until, body, button("Post to the ledger", () => d.requestSubmit(), "small"));
    d.onsubmit = (e) => {
      e.preventDefault();
      void this.act(() => this.gov.decision(title.value, body.value, until.value), "Posted.");
    };
    this.body.append(d);

    this.body.append(el("h3", "", `Reports (${this.reports.length})`));
    if (!this.reports.length) this.body.append(el("p", "empty", "No open reports."));
    for (const r of this.reports) {
      const box = el("div", "post");
      const top = el("div", "post-top");
      top.append(el("strong", "", `${r.target_name} · ${r.reason}`), el("span", "time", ago(r.at)));
      box.append(top, el("p", "body", r.context || "(no details)"), el("span", "hint", `from ${r.reporter} · ${r.reports_against} reports about them in total`));
      const acts = el("div", "btns wrap");
      for (const [label, action] of [["Dismiss", "dismiss"], ["Warn", "warn"], ["Mute 1 h", "mute_1h"], ["Mute 24 h", "mute_24h"]]) {
        acts.append(button(label, () => void this.act(() => this.gov.resolve(r.id, action), "Done."), "small"));
      }
      box.append(acts);
      this.body.append(box);
    }
  }
}

const REASONS: [string, string][] = [
  ["harassment", "Harassment or bullying"],
  ["hate", "Hate or slurs"],
  ["sexual", "Sexual content"],
  ["spam", "Spam"],
  ["cheating", "Cheating or exploits"],
  ["other", "Something else"],
];

/** Reporting a player to the Caretaker. */
export class ReportPanel extends Panel {
  private target = "";
  private msg = el("p", "error");

  constructor(private gov: Gov) {
    super("Report", "report");
  }

  openFor(name: string) {
    this.target = name;
    this.msg.textContent = "";
    this.show();
  }

  render() {
    this.titleEl.textContent = `Report ${this.target}`;
    this.body.replaceChildren();
    this.body.append(el("p", "hint", "Reports go to the Caretaker, who will look at what happened. They're private: the person won't know who reported them."));
    const form = el("form", "gov-form");
    const reason = el("select");
    for (const [v, label] of REASONS) {
      const o = el("option", "", label);
      o.value = v;
      reason.append(o);
    }
    const context = el("textarea");
    context.placeholder = "What happened? (optional)";
    context.maxLength = 500;
    form.append(reason, context, button("Send report", () => form.requestSubmit(), "small primary-sm"));
    form.onsubmit = (e) => {
      e.preventDefault();
      this.gov
        .report(this.target, reason.value, context.value)
        .then(() => {
          this.msg.className = "ok";
          this.msg.textContent = "Thank you. The Caretaker will take a look.";
          form.remove();
        })
        .catch((err) => {
          this.msg.className = "error";
          this.msg.textContent = errText(err);
        });
    };
    this.body.append(form, this.msg);
  }
}
