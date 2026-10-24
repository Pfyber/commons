// Clubs (ADR 0014): one panel, opened from the 🛡 button or the Club Hall's
// desk, directory and stairs. Your clubs and invites; founding a club (by
// renting its room); a club's page: this week (the meetup, the goals, the
// club call), events for everyone, the board, the members and their roles,
// inviting friends, the treasury and the room and its rent (or a clubhouse
// on a club lot); and, for everyone, what's on and the clubs of the week.

import { type ClubEvent, type ClubTier, type Clubs, type Detail, type Leaderboard, type Life, type MyClub, type PublicClub, ROLE_NAMES, type Role, roomStatus } from "../clubs";
import type { Economy } from "../economy";
import { ApiError } from "../net/api";
import type { Social } from "../social";
import { confirmButton } from "./homes";
import { Panel, button, el } from "./panels";

export interface ClubsHost {
  /** Up to the club's room (members only). */
  goToRoom(club: string): void;
  /** The club whose room you're in, if any. */
  inRoom(): string | null;
  toast(text: string): void;
  /** Whether you have a phone (for the club call). */
  hasPhone(): boolean;
  /** Rings every member who's online; how many were rung. */
  callClub(club: string): Promise<number>;
  /** Walks to a named spot in the city (an event's place, a lot). */
  walkToSpot(spot: string): void;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "Thursday 20:00", in local time. */
function when(unix: number): string {
  const d = new Date(unix * 1000);
  return `${DAYS[(d.getDay() + 6) % 7]} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** A local weekday (0 Monday) and "HH:MM" as the UTC weekday and minute the server keeps. */
export function toUtc(day: number, time: string): { dow: number; minute: number } {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  d.setDate(d.getDate() + ((day - ((d.getDay() + 6) % 7) + 7) % 7));
  return { dow: (d.getUTCDay() + 6) % 7, minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** The meetup's local weekday (0 Monday) and "HH:MM", from when the next one starts. */
function localOf(next: number): { day: number; time: string } {
  const d = new Date(next * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { day: (d.getDay() + 6) % 7, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

type View =
  | { kind: "list" }
  | { kind: "found" }
  | { kind: "club"; id: string }
  | { kind: "directory" }
  /** The stairs: which of your clubs' rooms to go up to. */
  | { kind: "rooms" }
  /** What's on: club events, for everyone (C3). */
  | { kind: "events" }
  /** The clubs of the week. */
  | { kind: "leaderboard" };

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "That didn't work.");

function ago(unix: number): string {
  const s = Math.max(0, Date.now() / 1000 - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** A club's crest on its colour. */
export function crestEl(c: { crest: string; color: string }, big = false): HTMLElement {
  const e = el("span", big ? "crest big" : "crest", c.crest);
  e.style.background = c.color;
  return e;
}

export class ClubsPanel extends Panel {
  private view: View = { kind: "list" };
  private detail: Detail | null = null;
  private directory: PublicClub[] | null = null;
  private msg = el("p", "error");
  private loading = 0;
  /** The founding form's choices, kept while you look around. */
  private form = { name: "", crest: "", color: "", tier: 0, lot: "" };
  private lotsAsked = false;

  constructor(
    private clubs: Clubs,
    private social: Social,
    private eco: Economy,
    private host: ClubsHost,
  ) {
    super("🛡 Clubs", "clubs");
    clubs.onChange(() => this.open && this.view.kind !== "club" && this.view.kind !== "found" && this.render());
    clubs.onClubChanged = (id) => {
      if (this.open && this.view.kind === "club" && this.view.id === id) void this.loadClub(id);
    };
  }

  /** Your clubs (from the 🛡 button or the desk). */
  showList() {
    this.go({ kind: "list" });
  }

  showClub(id: string) {
    this.go({ kind: "club", id });
  }

  showDirectory() {
    this.go({ kind: "directory" });
  }

  showEvents() {
    this.eventList = null;
    this.go({ kind: "events" });
  }

  showLeaderboard() {
    this.board = null;
    this.go({ kind: "leaderboard" });
  }

  /** Into a club's room (its clubhouse door, for members). */
  goToRoom(club: string) {
    this.host.goToRoom(club);
  }

  /** At the stairs: straight up if there's one room to go to, else pick. */
  showRooms() {
    const rooms = this.clubs.mine.filter((c) => c.room);
    if (rooms.length === 1) return this.host.goToRoom(rooms[0].id);
    this.go({ kind: "rooms" });
  }

  private go(v: View) {
    this.view = v;
    this.msg.textContent = "";
    this.detail = null;
    this.show();
    void this.clubs.load().catch(() => {});
    if (v.kind === "club") void this.loadClub(v.id);
    if (v.kind === "directory") {
      this.directory = null;
      void this.clubs
        .directory()
        .then((d) => {
          this.directory = d;
          if (this.open && this.view.kind === "directory") this.render();
        })
        .catch(() => {});
    }
  }

  private async loadClub(id: string) {
    const ticket = ++this.loading;
    try {
      const d = await this.clubs.detail(id);
      if (ticket !== this.loading || this.view.kind !== "club" || this.view.id !== id) return;
      if (d.role === null) {
        // Not (or no longer) a member.
        this.view = { kind: "list" };
        this.detail = null;
      } else this.detail = d;
    } catch (e) {
      this.msg.textContent = errText(e);
    }
    if (this.open) this.render();
  }

  /** Runs an action, shows how it went, and refreshes the club. */
  private act(p: Promise<unknown>, done?: string) {
    this.msg.textContent = "";
    p.then(() => {
      if (done) this.host.toast(done);
      if (this.view.kind === "club") void this.loadClub(this.view.id);
      else if (this.open) this.render();
    }).catch((e) => {
      this.msg.textContent = errText(e);
    });
  }

  render() {
    this.body.replaceChildren();
    const v = this.view;
    this.titleEl.textContent = "🛡 Clubs";
    if (v.kind === "list") this.renderList();
    else if (v.kind === "found") this.renderFound();
    else if (v.kind === "club") this.renderClub();
    else if (v.kind === "directory") this.renderDirectory();
    else if (v.kind === "events") this.renderEvents();
    else if (v.kind === "leaderboard") this.renderLeaderboard();
    else this.renderRooms();
    this.body.append(this.msg);
  }

  private clubRow(c: MyClub): HTMLElement {
    const row = el("div", "row club-row");
    const text = el("span", "name");
    text.append(el("strong", "", c.name), el("span", "hint", ` · ${c.members} member${c.members === 1 ? "" : "s"} · ${ROLE_NAMES[c.role]}${c.badge ? " · your badge" : ""}`));
    row.append(crestEl(c), text);
    if (c.room?.state === "grace") row.append(el("span", "hint warn", "rent due"));
    row.append(button("Open", () => this.showClub(c.id), "small primary-sm"));
    return row;
  }

  private renderList() {
    const c = this.clubs;
    if (c.invites.length) {
      this.body.append(el("h3", "", "Invites"));
      for (const i of c.invites) {
        const row = el("div", "row club-row");
        const text = el("span", "name");
        text.append(el("strong", "", i.name), el("span", "hint", ` · from ${i.from}`));
        row.append(
          crestEl(i),
          text,
          button("Join", () => this.act(c.answer(i.id, true), `🛡 Welcome to ${i.name}!`), "small primary-sm"),
          button("No thanks", () => this.act(c.answer(i.id, false)), "small"),
        );
        this.body.append(row);
      }
    }
    this.body.append(el("h3", "", "Your clubs"));
    if (!c.mine.length) {
      this.body.append(
        el("p", "", "A club is a few friends with a name, a crest and a room of their own at the Club Hall, with a board for news. Members chip into the club's treasury, which pays the room's rent each week."),
        el("p", "hint", "Friends can invite you into theirs, or you can found one at the Club Hall's desk."),
      );
    } else {
      const rows = el("div", "rows");
      for (const club of c.mine) rows.append(this.clubRow(club));
      this.body.append(rows);
    }
    const tier = c.tiers[0];
    if (c.mine.length < c.max) {
      this.body.append(
        button(`Found a club${tier ? ` (first week's rent: ${tier.rent} coins)` : ""}`, () => this.go({ kind: "found" }), c.mine.length ? "small" : "primary"),
      );
    } else this.body.append(el("p", "hint", `You're in ${c.max} clubs, the most anyone can be in.`));
    this.body.append(this.clubhousePitch());
    const more = el("div", "tier-row");
    more.append(button("📅 What's on", () => this.showEvents(), "small"), button("🏆 Clubs of the week", () => this.showLeaderboard(), "small"), button("Club directory", () => this.showDirectory(), "small"));
    this.body.append(more);
  }

  /** "🏠 Clubhouses": what they are, how many lots are free, and the way to one. */
  private clubhousePitch(): HTMLElement {
    const c = this.clubs;
    const box = el("div", "clubhouse-pitch");
    const house = c.tiers.find((t) => t.lot);
    if (!house) return box;
    if (!c.lots.length && !this.lotsAsked) {
      this.lotsAsked = true;
      void c
        .loadLots()
        .then(() => this.open && this.view.kind === "list" && this.render())
        .catch(() => {});
    }
    const free = c.lots.filter((l) => !l.club).length;
    box.append(
      el("h3", "", "🏠 Clubhouses"),
      el(
        "p",
        "hint",
        `A ${house.name} is your club's own building on one of the city's club lots, its door leading into your room: up to ${house.members} members, ${house.rent} coins a week, and everyone walking past sees your banner.${c.lots.length ? ` ${free} of ${c.lots.length} lots free.` : ""}`,
      ),
    );
    const row = el("div", "tier-row");
    for (const club of c.mine.filter((m) => m.role === "owner" && !m.room?.plot?.startsWith("lot:"))) {
      row.append(
        button(`Move ${club.crest} ${club.name} into one`, () => {
          this.showClub(club.id);
          this.pickLot(club.id, house);
        }, "small primary-sm"),
      );
    }
    if (c.mine.length < c.max) {
      row.append(
        button("Found a club with a clubhouse", () => {
          this.form.tier = house.tier;
          this.go({ kind: "found" });
        }, c.mine.length ? "small" : "small primary-sm"),
      );
    }
    if (row.childElementCount) box.append(row);
    return box;
  }

  private renderFound() {
    const c = this.clubs;
    const f = this.form;
    if (!f.crest) f.crest = c.crests[Math.floor(Math.random() * c.crests.length)] ?? "🛡";
    if (!f.color) f.color = c.colors[Math.floor(Math.random() * c.colors.length)] ?? "#3f7a8a";
    const tier = c.tiers.find((t) => t.tier === f.tier) ?? c.tiers[0];
    this.titleEl.textContent = "🛡 Found a club";
    this.body.append(
      el(
        "p",
        "",
        `Clubs are rented, never bought. You pay the first week, ${tier?.rent ?? "?"} coins; after that the club's treasury pays, from what members chip in.`,
      ),
    );
    // Where it starts: a room upstairs at the Club Hall, or a Clubhouse in the city.
    const where = el("div", "rows");
    for (const t of c.tiers.filter((t) => t === c.tiers[0] || t.lot)) {
      const label = t.lot
        ? `🏠 A ${t.name}: its own building on a club lot in the city · up to ${t.members} members · ${t.rent}/week`
        : `🚪 A ${t.name} upstairs at the Club Hall · up to ${t.members} members · ${t.rent}/week`;
      where.append(button(label, () => ((f.tier = t.tier), this.render()), t === tier ? "small on" : "small"));
    }
    this.body.append(el("h3", "", "Where"), where);
    if (tier?.lot) {
      if (!c.lots.length) void c.loadLots().then(() => this.open && this.render()).catch(() => {});
      const free = c.lots.filter((l) => !l.club);
      if (!free.some((l) => l.lot === f.lot)) f.lot = "";
      const lots = el("div", "rows");
      if (!free.length) lots.append(el("p", "hint", c.lots.length ? "Every club lot is taken just now: start in a club room, and move when one's free." : "Looking at the lots…"));
      for (const l of free) {
        const row = el("div", "row");
        row.append(
          button(`${l.lot === f.lot ? "✓ " : ""}${l.name}`, () => ((f.lot = l.lot), this.render()), l.lot === f.lot ? "small on" : "small"),
          button("Show me", () => (this.hide(), this.host.walkToSpot(l.lot)), "small"),
        );
        lots.append(row);
      }
      this.body.append(el("p", "hint", "Pick its lot:"), lots);
    }
    const preview = el("div", "club-preview");
    const showPreview = () => preview.replaceChildren(crestEl(f, true), el("strong", "", f.name.trim() || "Your club"));
    showPreview();
    const name = el("input");
    name.maxLength = 24;
    name.placeholder = "Club name (3 to 24 letters)";
    name.value = f.name;
    name.oninput = () => {
      f.name = name.value;
      showPreview();
    };
    const crests = el("div", "swatches");
    for (const cr of c.crests) {
      const b = button(cr, () => {
        f.crest = cr;
        this.render();
      }, cr === f.crest ? "small on" : "small");
      crests.append(b);
    }
    const colors = el("div", "swatches");
    for (const col of c.colors) {
      const b = button("", () => {
        f.color = col;
        this.render();
      }, col === f.color ? "small swatch on" : "small swatch");
      b.style.background = col;
      b.setAttribute("aria-label", col);
      colors.append(b);
    }
    const cost = tier?.rent ?? 0;
    const go = button(`Found it (${cost} coins)`, () => {
      this.msg.textContent = "";
      go.disabled = true;
      c.found(f.name.trim(), f.crest, f.color, tier?.tier, tier?.lot ? f.lot : undefined)
        .then((r) => {
          this.form = { name: "", crest: "", color: "", tier: 0, lot: "" };
          void this.eco.load().catch(() => {});
          this.host.toast(`🛡 ${r.name} is founded, and its room is yours for a week. Invite your friends!`);
          this.showClub(r.id);
        })
        .catch((e) => {
          go.disabled = false;
          this.msg.textContent = errText(e);
        });
    }, "primary");
    if (this.eco.coins < cost) {
      go.disabled = true;
      this.msg.textContent = `You need ${cost} coins for the first week's rent.`;
    } else if (tier?.lot && !f.lot) {
      go.disabled = true;
      this.msg.textContent = "Pick a lot for the clubhouse.";
    }
    this.body.append(preview, name, el("h3", "", "Crest"), crests, el("h3", "", "Colour"), colors, go, button("Back", () => this.showList(), "small"));
    window.setTimeout(() => name.focus(), 0);
  }

  private renderRooms() {
    this.titleEl.textContent = "🛡 Up to the club rooms";
    const rooms = this.clubs.mine.filter((c) => c.room);
    if (!rooms.length) {
      this.body.append(el("p", "", "The club rooms upstairs are for members. Found a club at the desk, or ask a friend to invite you into theirs."));
      this.body.append(button("Your clubs", () => this.showList(), "primary"));
      return;
    }
    const rows = el("div", "rows");
    for (const c of rooms) {
      const row = el("div", "row club-row");
      row.append(crestEl(c), el("span", "name", c.name), button("Go up", () => (this.hide(), this.host.goToRoom(c.id)), "small primary-sm"));
      rows.append(row);
    }
    this.body.append(rows);
  }

  private renderDirectory() {
    this.titleEl.textContent = "🛡 Club directory";
    const d = this.directory;
    if (!d) {
      this.body.append(el("p", "hint", "Reading the directory…"));
      return;
    }
    if (!d.length) this.body.append(el("p", "empty", "No clubs have a room yet. Be the first!"));
    const mine = new Set(this.clubs.mine.map((c) => c.id));
    const rows = el("div", "rows");
    for (const c of d) {
      const row = el("div", "row club-row");
      const text = el("span", "name");
      text.append(el("strong", "", c.name), el("span", "hint", ` · ${c.members} member${c.members === 1 ? "" : "s"}`));
      row.append(crestEl(c), text);
      if (mine.has(c.id)) row.append(button("Open", () => this.showClub(c.id), "small primary-sm"));
      rows.append(row);
    }
    this.body.append(rows, el("p", "hint", "Clubs grow by invitation between friends. Know someone in one? Ask them!"), button("Your clubs", () => this.showList(), "small"));
  }

  /** Choosing a club lot for a Clubhouse. */
  private picking: { club: string; tier: ClubTier } | null = null;

  private pickLot(club: string, tier: ClubTier) {
    this.picking = { club, tier };
    void this.clubs
      .loadLots()
      .then(() => this.open && this.render())
      .catch(() => {});
    this.render();
  }

  private renderLots(club: string, tier: ClubTier) {
    const box = el("div", "lot-pick");
    box.append(el("p", "", `Pick a club lot for the ${tier.name}. Its door will lead into the club's room, and everyone passing sees your banner.`));
    const free = this.clubs.lots.filter((l) => !l.club);
    if (!free.length) box.append(el("p", "hint", this.clubs.lots.length ? "Every club lot is taken just now." : "Looking at the lots…"));
    for (const l of free) {
      const row = el("div", "row");
      row.append(
        el("span", "name", l.name),
        button("Show me", () => (this.hide(), this.host.walkToSpot(l.lot)), "small"),
        button(`Rent it (${tier.rent}/week)`, () => {
          this.picking = null;
          this.act(this.clubs.rentRoom(club, tier.tier, l.lot), `🏠 The club's clubhouse stands on ${l.name} now!`);
        }, "small primary-sm"),
      );
      box.append(row);
    }
    box.append(button("Never mind", () => ((this.picking = null), this.render()), "small"));
    this.body.append(box);
  }

  // ---- what's on, and the clubs of the week -------------------------------

  private eventList: ClubEvent[] | null = null;
  private board: Leaderboard | null = null;

  private renderEvents() {
    this.titleEl.textContent = "📅 What's on";
    if (!this.eventList) {
      this.body.append(el("p", "hint", "Reading the board…"));
      void this.clubs
        .events()
        .then((e) => {
          this.eventList = e;
          if (this.open && this.view.kind === "events") this.render();
        })
        .catch((e) => (this.msg.textContent = errText(e)));
      return;
    }
    this.body.append(el("p", "hint", "Events clubs hold for everyone, at public places in the city. Say you're going and you'll be reminded."));
    if (!this.eventList.length) this.body.append(el("p", "empty", "Nothing planned yet. A club's owner or moderators can plan one from the club's page."));
    for (const e of this.eventList) this.body.append(this.eventCard(e));
    this.body.append(button("Your clubs", () => this.showList(), "small"));
  }

  private eventCard(e: ClubEvent): HTMLElement {
    const card = el("div", e.live ? "event live" : "event");
    const head = el("div", "row");
    const text = el("span", "name");
    text.append(el("strong", "", e.title), el("span", "hint", ` · ${e.club.name}`));
    head.append(crestEl(e.club), text);
    card.append(head);
    const time = e.live
      ? `🎉 On now, until ${new Date(e.ends_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : `📅 ${when(e.starts_at)}, ${new Date(e.starts_at * 1000).toLocaleDateString([], { day: "numeric", month: "short" })}`;
    const who = `${e.going} going${e.friends.length ? ` · ${e.friends.join(", ")}` : ""}`;
    card.append(el("p", "hint", `${time} · at ${e.place_name} · ${who}`));
    const row = el("div", "tier-row");
    const toggle = button(e.me ? "✓ Going" : "I'm going", () => {
      toggle.disabled = true;
      this.clubs
        .rsvp(e.id, !e.me)
        .then((r) => {
          e.me = r.me;
          e.going = r.going;
          if (r.me) this.host.toast(`📅 You're going to “${e.title}”. You'll be reminded 15 minutes before.`);
          this.render();
        })
        .catch((err) => (this.msg.textContent = errText(err)));
    }, e.me ? "small" : "small primary-sm");
    row.append(toggle, button("Show me", () => (this.hide(), this.host.walkToSpot(e.place)), "small"));
    if (e.staff) {
      row.append(
        confirmButton("Call it off", "Really call it off?", () =>
          this.act(this.clubs.cancelEvent(e.club.id, e.id).then(() => (this.eventList = null)), "📅 Called off. Those going are told."),
        ),
      );
    }
    card.append(row);
    return card;
  }

  private renderLeaderboard() {
    this.titleEl.textContent = "🏆 Clubs of the week";
    const b = this.board;
    if (!b) {
      this.body.append(el("p", "hint", "Adding up the points…"));
      void this.clubs
        .leaderboard()
        .then((r) => {
          this.board = r;
          if (this.open && this.view.kind === "leaderboard") this.render();
        })
        .catch((e) => (this.msg.textContent = errText(e)));
      return;
    }
    const left = Math.max(0, Math.ceil((b.week_ends - Date.now() / 1000) / 86400));
    this.body.append(
      el("p", "hint", `Points this week: 10 per goal reached, 5 per member at the meetup, 1 per 10 minutes together in the room. In ${left} day${left === 1 ? "" : "s"} the top three win ${b.awards.join(", ")} coins for their treasuries.`),
    );
    if (b.last.length) {
      this.body.append(el("h3", "", "Last week"));
      for (const s of b.last) {
        const row = el("div", "row club-row");
        row.append(el("span", "rank", ["🥇", "🥈", "🥉"][s.rank - 1] ?? `${s.rank}`), crestEl(s), el("span", "name", s.name), el("span", "hint", `+${s.coins} coins`));
        this.body.append(row);
      }
    }
    this.body.append(el("h3", "", "This week"));
    if (!b.standings.some((s) => s.points > 0)) this.body.append(el("p", "empty", "No points yet this week. Meet up, reach a goal, spend time together!"));
    const rows = el("div", "rows");
    for (const s of b.standings.filter((x) => x.points > 0 || x.mine)) {
      const row = el("div", s.mine ? "row club-row mine" : "row club-row");
      row.append(el("span", "rank", `${s.rank}.`), crestEl(s), el("span", "name", s.name), el("span", "price", `${s.points}`));
      rows.append(row);
    }
    this.body.append(rows, button("Your clubs", () => this.showList(), "small"));
  }

  /** The club's events, and planning one (owner and moderators). */
  private renderClubEvents(d: Detail, staff: boolean) {
    const id = d.club.id;
    this.body.append(el("h3", "", "Events for everyone"));
    if (this.eventList === null) {
      void this.clubs
        .events()
        .then((e) => {
          this.eventList = e;
          if (this.open && this.view.kind === "club") this.render();
        })
        .catch(() => {});
    }
    const mine = (this.eventList ?? []).filter((e) => e.club.id === id);
    for (const e of mine) this.body.append(this.eventCard(e));
    if (!mine.length) this.body.append(el("p", "hint", "Hold an event anyone can come to: a fishing contest, a bowling night, a concert at the bandstand."));
    if (!staff) return;
    const form = el("div", "event-form");
    const title = el("input");
    title.maxLength = 60;
    title.placeholder = "What's happening (e.g. Fishing contest)";
    const place = el("select");
    const lot = this.clubs.lotOf(id);
    const places = [...this.clubs.places, ...(lot ? [{ key: lot, name: "our clubhouse's lot" }] : [])];
    if (!places.length) places.push({ key: "stage", name: "the Fairground bandstand" });
    for (const p of places) {
      const o = el("option", "", p.name);
      o.value = p.key;
      place.append(o);
    }
    const day = el("select");
    for (let i = 0; i < 14; i++) {
      const d0 = new Date(Date.now() + i * 86400_000);
      const o = el("option", "", i === 0 ? "Today" : i === 1 ? "Tomorrow" : d0.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" }));
      o.value = String(i);
      day.append(o);
    }
    const time = el("input");
    time.type = "time";
    time.value = "19:00";
    const hours = el("select");
    for (const h of [1, 2]) {
      const o = el("option", "", h === 1 ? "an hour" : "two hours");
      o.value = String(h);
      hours.append(o);
    }
    const go = button("Plan it", () => {
      const [hh, mm] = time.value.split(":").map(Number);
      const at = new Date(Date.now() + Number(day.value) * 86400_000);
      at.setHours(hh || 0, mm || 0, 0, 0);
      this.msg.textContent = "";
      this.clubs
        .planEvent(id, title.value.trim(), place.value, Math.floor(at.getTime() / 1000), Number(hours.value))
        .then(() => {
          this.eventList = null;
          this.host.toast("📅 Planned! It's on the What's on board for everyone.");
          void this.loadClub(id);
        })
        .catch((e) => (this.msg.textContent = errText(e)));
    }, "small primary-sm");
    form.append(title, place, day, time, hours, go);
    this.body.append(form);
  }

  /** This week: the meetup, the goals, the club call and decorating. */
  private renderWeek(d: Detail, staff: boolean) {
    const id = d.club.id;
    const life: Life | undefined = d.life;
    if (!life) return;
    this.body.append(el("h3", "", "This week"));
    const m = life.meetup;
    const here = this.host.inRoom() === id;
    if (m?.live_until) {
      const box = el("div", "meetup live");
      box.append(el("strong", "", "🎉 The meetup is on now!"), el("span", "hint", ` Until ${new Date(m.live_until * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Stay ${m.stay_mins} minutes in the room for ${m.reward} coins.`));
      if (m.came.length) box.append(el("p", "hint", `Here so far: ${m.came.join(", ")}`));
      if (!here && d.room) box.append(button("Go up to the room", () => (this.hide(), this.host.goToRoom(id)), "small primary-sm"));
      this.body.append(box);
    } else if (m) {
      this.body.append(el("p", "", `📅 Meetup every ${when(m.next)} (your time), in the club room. Come for ${m.stay_mins} minutes and get ${m.reward} coins.`));
    } else {
      this.body.append(el("p", "hint", staff ? "No meetup yet: pick a weekly hour when everyone can come." : "No meetup yet. The owner or a moderator can set one."));
    }
    if (staff) {
      const form = el("div", "meetup-form");
      const day = el("select");
      DAYS.forEach((name, i) => {
        const o = el("option", "", name);
        o.value = String(i);
        day.append(o);
      });
      const time = el("input");
      time.type = "time";
      const cur = m ? localOf(m.next) : { day: 4, time: "20:00" };
      day.value = String(cur.day);
      time.value = cur.time;
      form.append(
        day,
        time,
        button(m ? "Change" : "Set the meetup", () => this.act(this.clubs.setMeetup(id, toUtc(Number(day.value), time.value)), "📅 Meetup set. Everyone's told half an hour before."), "small primary-sm"),
      );
      if (m) form.append(button("Cancel it", () => this.act(this.clubs.setMeetup(id, null)), "small"));
      this.body.append(form);
    }
    // The goals.
    const goals = el("div", "goals");
    for (const g of life.goals) {
      const row = el("div", g.done ? "goal done" : "goal");
      const bar = el("div", "bar");
      const fill = el("span");
      fill.style.width = `${Math.round((100 * Math.min(g.progress, g.target)) / Math.max(1, g.target))}%`;
      bar.append(fill);
      row.append(el("span", "name", `${g.done ? "✅" : "🎯"} ${g.title}`), el("span", "hint", `${Math.min(g.progress, g.target)}/${g.target} · +${g.reward}`), bar);
      goals.append(row);
    }
    const left = Math.max(0, Math.ceil((life.week_ends - Date.now() / 1000) / 86400));
    this.body.append(goals, el("p", "hint", `Each goal reached pays the treasury. New goals in ${left} day${left === 1 ? "" : "s"}.`));
    // The club call, and decorating.
    const actions = el("div", "tier-row");
    const online = d.members.filter((x) => x.online && x.id !== this.social.selfId).length;
    const ring = button(`📞 Call the club (${online} online)`, () => {
      ring.disabled = true;
      this.host
        .callClub(id)
        .then((n) => this.host.toast(`📞 Ringing ${n} member${n === 1 ? "" : "s"}…`))
        .catch((e) => (this.msg.textContent = errText(e)))
        .finally(() => (ring.disabled = false));
    }, "small");
    ring.disabled = !this.host.hasPhone() || online === 0;
    if (!this.host.hasPhone()) ring.title = "You need a phone: the mall's Tools & Gadgets shop has them.";
    actions.append(ring);
    this.body.append(actions);
    const cap = d.tiers.find((t) => t.tier === d.room?.tier)?.furniture ?? 0;
    if (d.room) {
      this.body.append(
        el("p", "hint", `🪑 Furniture: ${life.furniture} of ${cap} pieces. ${here ? "Place things from your bag here; they stay yours." : "Decorate together in the room, from your own bags: each piece stays its owner's."}`),
      );
    }
  }

  private renderClub() {
    const d = this.detail;
    if (!d) {
      this.body.append(el("p", "hint", "Opening the club's book…"));
      return;
    }
    const c = this.clubs;
    const id = d.club.id;
    const staff = d.role === "owner" || d.role === "mod";
    const me = this.social.selfId;
    const room = d.room;
    this.titleEl.textContent = `${d.club.crest} ${d.club.name}`;
    const head = el("div", "club-preview");
    head.append(crestEl(d.club, true), el("span", "hint", `${d.members.length} of ${d.cap} members · you're ${d.role === "mod" ? "a moderator" : d.role === "owner" ? "the owner" : "a member"}`));
    this.body.append(head);

    if (d.room?.state === "grace") this.body.append(el("p", "hint warn", `Rent is due and the treasury has ${d.treasury} of ${d.room.rent} coins. Chip in below.`));
    this.renderWeek(d, staff);
    this.renderClubEvents(d, staff);

    // The board.
    this.body.append(el("h3", "", "Board"));
    const form = el("form", "add-friend");
    const input = el("input");
    input.maxLength = 280;
    input.placeholder = "Something for the members…";
    form.append(input, button("Post", () => form.requestSubmit(), "small primary-sm"));
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) this.act(c.say(id, text));
    };
    this.body.append(form);
    if (!d.posts.length) this.body.append(el("p", "empty", "Nothing on the board yet."));
    for (const p of d.posts) {
      const row = el("div", "note club-post");
      row.append(el("span", "text", `${p.author ?? "Someone"}: ${p.text}`), el("span", "time", ago(p.at)));
      if (staff || p.author_id === me) row.append(button("Remove", () => this.act(c.unsay(id, p.id)), "small"));
      this.body.append(row);
    }

    // Members.
    this.body.append(el("h3", "", "Members"));
    const rows = el("div", "rows");
    for (const m of d.members) {
      const row = el("div", "row member-row");
      const text = el("span", "name");
      text.append(el("span", m.online ? "dot on" : "dot", "●"), document.createTextNode(` ${m.name}`), el("span", "hint", ` · ${ROLE_NAMES[m.role]}`));
      row.append(text);
      if (m.id !== me) {
        if (d.role === "owner" && m.role === "member") row.append(button("Make moderator", () => this.act(c.setRole(id, m.id, "mod")), "small"));
        if (d.role === "owner" && m.role === "mod") row.append(button("Make member", () => this.act(c.setRole(id, m.id, "member")), "small"));
        if (d.role === "owner") row.append(confirmButton("Hand over", `Make ${m.name} the owner?`, () => this.act(c.setRole(id, m.id, "owner" as Role), `🛡 ${m.name} owns ${d.club.name} now.`)));
        if (d.role === "owner" || (d.role === "mod" && m.role === "member")) row.append(confirmButton("Remove", `Remove ${m.name}?`, () => this.act(c.remove(id, m.id))));
      }
      rows.append(row);
    }
    this.body.append(rows);

    // Inviting friends.
    if (staff) {
      const inClub = new Set(d.members.map((m) => m.id));
      const friends = this.social.friends.filter((f) => !inClub.has(f.id));
      if (d.members.length >= d.cap) this.body.append(el("p", "hint", "The room's full. A bigger room fits more members."));
      else if (!friends.length) this.body.append(el("p", "hint", "Clubs grow along friendships: make friends to invite them."));
      else {
        const pick = el("select");
        for (const f of friends) {
          const o = el("option", "", f.name);
          o.value = f.id;
          pick.append(o);
        }
        const row = el("div", "add-friend");
        row.append(pick, button("Invite", () => this.act(c.invite(id, pick.value), `🛡 Invite sent to ${friends.find((f) => f.id === pick.value)?.name ?? "your friend"}.`), "small primary-sm"));
        this.body.append(row);
      }
    }

    // The treasury.
    this.body.append(el("h3", "", `Treasury: ${d.treasury} coins`));
    const weeks = room && room.rent > 0 ? Math.floor(d.treasury / room.rent) : 0;
    this.body.append(el("p", "hint", room ? `Enough for ${weeks} more week${weeks === 1 ? "" : "s"} of rent. Coins given to the club stay with the club.` : "Coins given to the club stay with the club and pay its rent."));
    const give = el("div", "tier-row");
    for (const n of [5, 10, 25, 50]) {
      const b = button(`Chip in ${n}`, () => this.act(c.donate(id, n).then(() => this.eco.load()), `🛡 Thank you! ${n} coins to ${d.club.name}.`), "small");
      b.disabled = this.eco.coins < n;
      give.append(b);
    }
    this.body.append(give);

    // The room and its rent.
    this.body.append(el("h3", "", "The room"));
    if (room) {
      this.body.append(el("p", room.state === "grace" ? "hint warn" : "hint", roomStatus(room)));
      if (this.host.inRoom() !== id) this.body.append(button("Go to the room", () => (this.hide(), this.host.goToRoom(id)), "primary"));
      if (room.state === "grace" && staff) {
        this.body.append(button(`Pay ${room.rent} coins from the treasury`, () => this.act(c.pay(id), "🛡 Rent paid. The room is the club's for another week."), "small primary-sm"));
      }
      if (d.role === "owner" && room.state === "active") {
        const row = el("div", "tier-row");
        for (const t of d.tiers) {
          if (t.tier === room.tier) continue;
          const up = t.rent > room.rent;
          const where = t.lot ? " on a club lot in the city" : "";
          const label = up ? `Move up to a ${t.name}${where} (${t.members} members, ${t.rent}/week, ${t.rent - room.rent} now)` : `Move down to a ${t.name} (${t.members} members, ${t.rent}/week)`;
          row.append(button(label, () => (t.lot ? this.pickLot(id, t) : this.act(c.rentRoom(id, t.tier), `🛡 The club has a ${t.name} now.`)), up ? "small primary-sm" : "small"));
        }
        this.body.append(row);
      }
      const lot = room.plot.startsWith("lot:") ? room.plot : null;
      if (lot) {
        const name = c.lots.find((l) => l.lot === lot)?.name ?? "a club lot";
        this.body.append(el("p", "hint", `🏠 The clubhouse stands on ${name} in the city: its door leads into this room.`), button("Show me the clubhouse", () => (this.hide(), this.host.walkToSpot(lot)), "small"));
      }
      if (this.picking?.club === id) this.renderLots(id, this.picking.tier);
    } else {
      this.body.append(el("p", "hint", "The club has no room just now (the rent wasn't paid). Everything else carries on."));
      if (d.role === "owner") {
        const row = el("div", "tier-row");
        for (const t of d.tiers) row.append(button(`Rent a ${t.name} (${t.members} members, ${t.rent}/week from the treasury)`, () => (t.lot ? this.pickLot(id, t) : this.act(c.rentRoom(id, t.tier), `🛡 The club has a room again!`)), "small primary-sm"));
        this.body.append(row);
        if (this.picking?.club === id) this.renderLots(id, this.picking.tier);
      }
    }

    // You.
    this.body.append(el("h3", "", "You"));
    const you = el("div", "tier-row");
    if (!d.badge) you.append(button(`Show ${d.club.crest} by my name`, () => this.act(c.showBadge(id), `${d.club.crest} Now showing by your name.`), "small"));
    else you.append(el("span", "hint", `${d.club.crest} shows by your name.`));
    const alone = d.members.length === 1;
    if (d.role !== "owner" || alone) {
      you.append(
        confirmButton(alone ? "Close the club" : "Leave", alone ? "Close it? The room is given up" : `Leave ${d.club.name}?`, () =>
          this.act(c.leave(id).then(() => this.showList()), alone ? `🛡 ${d.club.name} is closed.` : `You've left ${d.club.name}.`),
        ),
      );
    } else you.append(el("span", "hint", "To leave, hand the club over to another member first."));
    this.body.append(you, button("Your clubs", () => this.showList(), "small"));
  }
}
