// Client for the social gateway (spec §4.1): one socket for live pushes
// (presence, messages, notifications) that stays open across zones, plus
// REST calls for friend actions.

import type { Auth } from "./net/api";

export interface Friend {
  id: string;
  name: string;
  look: number;
  /** 1 friend, 2 close friend. */
  level: number;
  points: number;
  online: boolean;
  where: { zone: string; label: string } | null;
}

export interface Person {
  id: string;
  name: string;
}

export interface Dm {
  id: number;
  from: string;
  to: string;
  text: string;
  at: number;
}

export interface Notification {
  id: number;
  kind: "friend_request" | "friend_accepted" | "gift" | "home_invite" | "close_friend" | string;
  body: { from_id?: string; from_name?: string; item?: number; item_name?: string; qty?: number; club?: string; club_id?: string; crest?: string };
  at: number;
  read: boolean;
}

export interface Gift {
  id: string;
  from: string;
  from_name: string;
  item: number;
  qty: number;
  note: string;
  /** The wrapping's and the card's codes (0: none). */
  wrap: number;
  card: number;
}

export class Social {
  friends: Friend[] = [];
  incoming: Person[] = [];
  outgoing: Person[] = [];
  blocked: Person[] = [];
  notifications: Notification[] = [];
  readonly dms = new Map<string, Dm[]>();
  /** Friend ids with messages not yet seen. */
  readonly unreadDms = new Set<string>();
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  private listeners = new Set<() => void>();
  /** Called for live events worth a toast. */
  onToast: (text: string) => void = () => {};
  /** Other pushes (phone calls: `call_ring`, `call`, …), for whoever handles them. */
  private pushListeners = new Set<(m: { t: string; [k: string]: unknown }) => void>();

  onPush(f: (m: { t: string; [k: string]: unknown }) => void): () => void {
    this.pushListeners.add(f);
    return () => this.pushListeners.delete(f);
  }
  onDm: (from: string, m: Dm) => void = () => {};

  constructor(
    private auth: Auth,
    readonly selfId: string,
  ) {}

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit() {
    for (const f of this.listeners) f();
  }

  get unreadCount(): number {
    return this.notifications.filter((n) => !n.read).length + this.unreadDms.size;
  }

  isBlockedName(name: string): boolean {
    return this.blocked.some((b) => b.name.toLowerCase() === name.toLowerCase());
  }

  friendByName(name: string): Friend | undefined {
    return this.friends.find((f) => f.name.toLowerCase() === name.toLowerCase());
  }

  async start() {
    await Promise.all([this.refresh(), this.loadNotifications()]);
    this.connect();
  }

  stop() {
    this.closed = true;
    this.ws?.close();
  }

  private async connect() {
    if (this.closed) return;
    let token: string;
    try {
      token = await this.auth.accessToken();
    } catch {
      return;
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/social/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () => (this.retry = 0);
    ws.onmessage = (ev) => this.receive(JSON.parse(ev.data as string));
    ws.onclose = () => {
      if (this.closed) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), delay);
    };
  }

  private receive(m: { t: string; [k: string]: unknown }) {
    switch (m.t) {
      case "presence": {
        const f = this.friends.find((x) => x.id === m.id);
        if (f) {
          const wasOnline = f.online;
          f.online = m.online as boolean;
          f.where = (m.where as Friend["where"]) ?? null;
          if (!wasOnline && f.online) this.onToast(`${f.name} is here 👋`);
          this.emit();
        }
        break;
      }
      case "friends":
        void this.refresh();
        break;
      case "notify": {
        const n = m.n as Notification;
        this.notifications.unshift(n);
        this.onToast(describe(n));
        if (["friend_request", "friend_accepted", "close_friend"].includes(n.kind)) void this.refresh();
        else this.emit();
        for (const f of this.pushListeners) f(m);
        break;
      }
      case "dm": {
        const dm = m.m as Dm;
        const list = this.dms.get(dm.from);
        if (list) list.push(dm);
        this.unreadDms.add(dm.from);
        this.onDm(dm.from, dm);
        this.onToast(`💬 ${m.from_name as string}: ${dm.text}`);
        this.emit();
        break;
      }
      default:
        for (const f of this.pushListeners) f(m);
    }
  }

  async refresh() {
    const r = await this.auth.get<{ friends: Friend[]; incoming: Person[]; outgoing: Person[]; blocked: Person[] }>(
      "/api/social/friends",
    );
    Object.assign(this, r);
    this.emit();
  }

  async loadNotifications() {
    this.notifications = await this.auth.get<Notification[]>("/api/social/notifications");
    this.emit();
  }

  async markRead() {
    if (!this.notifications.some((n) => !n.read)) return;
    await this.auth.send("/api/social/notifications/read", {});
    for (const n of this.notifications) n.read = true;
    this.emit();
  }

  async request(name: string): Promise<string> {
    const r = await this.auth.send<{ status: string; name: string }>("/api/social/request", { name });
    await this.refresh();
    return {
      sent: `Friend request sent to ${r.name}.`,
      friends: `You and ${r.name} are now friends!`,
      already_friends: `You're already friends with ${r.name}.`,
      already_sent: `You already asked ${r.name}.`,
    }[r.status] ?? "Done.";
  }

  async respond(id: string, accept: boolean) {
    await this.auth.send("/api/social/respond", { id, accept });
    await this.refresh();
  }

  async remove(id: string) {
    await this.auth.send("/api/social/remove", { id });
    await this.refresh();
  }

  async block(name: string) {
    await this.auth.send("/api/social/block", { name });
    await this.refresh();
  }

  async unblock(id: string) {
    await this.auth.send("/api/social/unblock", { id });
    await this.refresh();
  }

  async history(friend: string): Promise<Dm[]> {
    const list = await this.auth.get<Dm[]>(`/api/social/dm/${friend}`);
    this.dms.set(friend, list);
    this.unreadDms.delete(friend);
    this.emit();
    return list;
  }

  async sendDm(to: string, text: string) {
    const m = await this.auth.send<Dm>("/api/social/dm", { to, text });
    const list = this.dms.get(to);
    if (list) list.push(m);
    this.emit();
  }

  /** Leaves a gift on a friend's doorstep (in wrapping and with a card, if chosen: items, 0 for none). */
  async gift(to: string, item: number, qty: number, note: string, wrap = 0, card = 0) {
    await this.auth.send("/api/social/gift", { to, item, qty, note, wrap, card, key: crypto.randomUUID() });
  }

  async invite(id: string) {
    await this.auth.send("/api/social/invite", { id });
  }

  gifts(): Promise<Gift[]> {
    return this.auth.get<Gift[]>("/api/social/gifts");
  }

  openGift(id: string): Promise<{ from_name: string; applied: { totals: [number, number][]; added: [number, number][] } }> {
    return this.auth.send(`/api/social/gifts/${id}/open`, {});
  }
}

export function describe(n: Notification): string {
  const who = n.body.from_name ?? "Someone";
  switch (n.kind) {
    case "friend_request":
      return `${who} would like to be friends`;
    case "friend_accepted":
      return `${who} is now your friend`;
    case "gift":
      return `${who} left a gift on your doorstep 🎁`;
    case "home_invite":
      return `${who} invited you to their home 🏡`;
    case "close_friend":
      return `You and ${who} are now close friends 💛`;
    case "bottle_thanks":
      return "Someone found your message in a bottle and sent a thank-you 💛";
    case "club_invite":
      return `${who} invited you to join ${n.body.crest ?? "🛡"} ${n.body.club ?? "their club"}`;
    case "club_removed":
      return `You're no longer a member of ${n.body.club ?? "a club"}`;
    case "rent_due": {
      const b = n.body as { what?: string; rent?: number; club?: string };
      if (b.club) return `Rent for ${b.what} is due: ${b.rent ?? "some"} coins from the treasury. Ask members to chip in, then pay at the Club Hall 🛡`;
      return `Rent for ${b.what ?? "your place"} is due: ${b.rent ?? "some"} coins. Pay at the Post Office; nothing is lost if you can't 🏡`;
    }
    case "lease_ended": {
      const b = n.body as { what?: string; returned?: number; club?: string };
      if (b.club) return `${b.what} has been given up: the rent wasn't paid. The club carries on, and can rent a room again at the Club Hall 🛡`;
      return `The lease on ${b.what ?? "your place"} has ended. ${b.returned ? `${b.returned} things went back to your bag.` : ""} The Post Office can find you a new one 📦`;
    }
    case "stall_sale": {
      const b = n.body as { buyer?: string; what?: string; qty?: number; coins?: number };
      return `${b.buyer ?? "Someone"} bought ${b.qty ?? 1}× ${b.what ?? "something"} from your stall for ${b.coins ?? "?"} coins 🧺`;
    }
    default:
      return "Something happened";
  }
}
