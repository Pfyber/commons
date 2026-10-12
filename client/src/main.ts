import { Application } from "pixi.js";
import parkUrl from "../../assets/maps/founders_park.json?url";
import homeUrl from "../../assets/maps/home.json?url";
import { Economy } from "./economy";
import { Game, type Ui } from "./game";
import { ApiError, Auth, type Destination } from "./net/api";
import type { CloseReason } from "./net/socket";
import { Social } from "./social";
import { Town } from "./town";
import { Gov } from "./gov";
import { ReportPanel, StoryPanel, TownHallPanel } from "./ui/gov";
import { FoundersPanel, WelcomePanel } from "./ui/welcome";
import { GATHERINGS, Welcome, nextOccurrence } from "./welcome";
import { Soundscape } from "./ambient/sound";
import { Hud } from "./ui/hud";
import { signIn } from "./ui/login";
import { ActionMenu, AlbumPanel, BagPanel, MarketPanel, PlaceBanner, PlotMenu, ReelGame } from "./ui/panels";
import { FriendsPanel, NotificationsPanel } from "./ui/social";
import { GoalPanel, QuarterPanel, RequestsPanel } from "./ui/town";
import { EaselPanel } from "./activities/easel";
import { WordPanel } from "./activities/word";
import type { ZoneMap } from "./world/map";
import "./styles.css";

const MAP_URLS: Record<string, string> = { founders_park: parkUrl, home: homeUrl };
const ERR_REPLACED = 6;
const ERR_VERSION = 3;

const overlay = document.getElementById("overlay")!;

function showOverlay(title: string, text: string, action?: { label: string; run: () => void }) {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h2");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = text;
  card.append(h, p);
  if (action) {
    const b = document.createElement("button");
    b.className = "primary";
    b.textContent = action.label;
    b.onclick = action.run;
    card.append(b);
  }
  overlay.replaceChildren(card);
  overlay.hidden = false;
}

function hideOverlay() {
  overlay.hidden = true;
  overlay.replaceChildren();
}

const maps = new Map<string, ZoneMap>();
async function loadMap(zone: string): Promise<ZoneMap> {
  let m = maps.get(zone);
  if (!m) {
    m = (await fetch(MAP_URLS[zone]).then((r) => r.json())) as ZoneMap;
    maps.set(zone, m);
  }
  // Each visit gets its own copy: placed furniture edits the collision layer.
  return structuredClone(m);
}

async function main() {
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  const auth = new Auth();
  const resumed = new URLSearchParams(location.search).has("login") ? false : await auth.resume();
  if (!resumed) await signIn(overlay, auth);

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: "#6f8d62", // hedge green around maps smaller than the screen
    antialias: false,
    roundPixels: true, // keep sprites on whole device pixels
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  document.getElementById("stage")!.appendChild(app.canvas);

  let game: Game | null = null;
  const eco = new Economy(auth);
  const social = new Social(auth, auth.player!.id);
  const town = new Town(auth);
  const sound = new Soundscape();
  const gov = new Gov(auth);
  const townhall = new TownHallPanel(gov);
  const welcome = new Welcome(auth);
  const welcomePanel = new WelcomePanel(
    welcome,
    (t) => game?.walkTo(t),
    (no) => hud.toast(`🌱 Founder #${no}! Your seedling is in the Founders' Grove, east of the chess tables.`, 7000),
  );
  const place = new PlaceBanner(() => place.hide());
  const friendActions = {
    join: (f: { id: string }) => void travel({ friend: f.id }),
    visit: (f: { id: string }) => void travel({ zone: "home", owner: f.id }),
    visitId: (id: string) => void travel({ zone: "home", owner: id }),
    goHome: () => void travel({ zone: "home" }),
  };
  const hud = new Hud(document.getElementById("hud")!, {
    onChat: (text) => game?.chat(text),
    onEmote: (id) => game?.emote(id),
    onSit: () => game?.toggleSit(),
    onBag: () => ui.bag.toggle(),
    onAlbum: () => ui.album.toggle(),
    onFriends: () => (ui.friends.open ? ui.friends.hide() : ui.friends.showList()),
    onNotifications: () => notifications.toggle(),
    onSound: () => sound.toggle(),
    onTasks: () => welcomePanel.show(),
  });
  hud.setMuted(sound.muted);
  const ui: Ui = {
    eco,
    hud,
    bag: new BagPanel(eco, (item) => {
      ui.bag.hide();
      place.show(item);
    }),
    album: new AlbumPanel(eco),
    market: new MarketPanel(eco),
    plot: new PlotMenu(eco, (x, y, action, item) => game?.plotAction(x, y, action, item)),
    reel: new ReelGame(),
    place,
    menu: new ActionMenu(),
    social,
    friends: new FriendsPanel(social, eco, friendActions),
    town,
    quarter: new QuarterPanel(town),
    requests: new RequestsPanel(town, eco),
    goal: new GoalPanel(town, eco, (g) => {
      game?.milestones.apply(g.reached);
      hud.toast(`The town reached “${g.title}”! 🎉`, 6000);
    }),
    easel: new EaselPanel(town, {
      sendPaint: (e, c, col) => game?.sendPaint(e, c, col),
      displays: () => game?.easels ?? null,
    }),
    word: new WordPanel(town, () => void eco.load().catch(() => {})),
    sound,
    gov,
    townhall,
    story: new StoryPanel(gov, (id) => void townhall.openAt({ kind: "proposal", id })),
    report: new ReportPanel(gov),
    welcome,
    welcomePanel,
    founders: new FoundersPanel(welcome, () => auth.player?.display_name ?? ""),
  };
  // The Caretaker's tasks chip, until you're a founder (or the season closes).
  welcome.onChange(() => {
    const s = welcome.status;
    if (!s || s.founder || (!s.season.open && welcome.done < 3)) return hud.setTasks(null);
    hud.setTasks(welcome.done === 3 ? "🌱 Plant your seedling!" : `🌿 Caretaker's tasks ${welcome.done}/3`);
  });
  const notifications = new NotificationsPanel(social, friendActions);
  eco.onChange(() => hud.setCoins(eco.coins));
  social.onChange(() => hud.setBadge(social.unreadCount));
  social.onToast = (t) => hud.toast(t, 4000);
  await Promise.all([eco.load().catch(() => {}), social.start().catch(() => {})]);

  let dest: Destination = { zone: "founders_park" };
  let retry = 0;
  /** Joins `dest`; on failure either retries (connection trouble) or throws (refused). */
  const enter = async (refusalThrows = false) => {
    try {
      const ticket = await auth.join(dest);
      const map = await loadMap(ticket.zone_id);
      const placeInfo = { label: ticket.label, owner: ticket.owner };
      if (!game || game.zoneId !== ticket.zone_id || game.place.owner !== placeInfo.owner) {
        game?.destroy();
        game = new Game(app, map, ticket.zone_id, placeInfo, ui, document.getElementById("labels")!, {
          onWelcome: () => (retry = 0),
          onDisconnect,
          onTravel: (z) => void travel({ zone: z }),
        });
        if (import.meta.env.DEV) (window as unknown as { __commons: Game }).__commons = game;
      }
      // A friend's location becomes the place to reconnect to.
      dest = { zone: ticket.zone_id, owner: ticket.owner ?? undefined };
      game.connect(ticket.server_url, ticket.join_token);
      hideOverlay();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        auth.signOut();
        location.reload();
        return;
      }
      if (refusalThrows && e instanceof ApiError && e.status >= 400 && e.status < 500) throw e;
      scheduleRetry();
    }
  };
  const travel = async (to: Destination) => {
    const previous = dest;
    dest = to;
    document.body.classList.add("fading");
    await new Promise((r) => setTimeout(r, 250));
    try {
      await enter(true);
    } catch (e) {
      dest = previous;
      hud.toast(e instanceof ApiError ? e.message : "You can't go there right now.", 4000);
    } finally {
      document.body.classList.remove("fading");
    }
  };
  const scheduleRetry = () => {
    const delay = Math.min(30_000, 1000 * 2 ** retry++);
    showOverlay("Reconnecting…", "Lost the connection to the park. Trying again shortly.");
    window.setTimeout(() => void enter(), delay);
  };
  const onDisconnect = (reason: CloseReason) => {
    if (reason?.code === ERR_REPLACED) {
      showOverlay("You joined from somewhere else", "Commons is open in another tab or device.", {
        label: "Play here instead",
        run: () => void enter(),
      });
    } else if (reason?.code === ERR_VERSION) {
      showOverlay("Commons was updated", "Reload to get the latest version.", { label: "Reload", run: () => location.reload() });
    } else {
      scheduleRetry();
    }
  };

  await enter();
  // First visit: the Caretaker says hello. Afterwards, keep the tasks fresh
  // (sitting together is reported by the zone about once a minute).
  welcome
    .load()
    .then((s) => {
      let met = false;
      try {
        met = localStorage.getItem("commons.metCaretaker") === "1";
        localStorage.setItem("commons.metCaretaker", "1");
      } catch {
        // storage unavailable
      }
      if (!met && !s.founder) window.setTimeout(() => welcomePanel.show(), 1500);
    })
    .catch(() => {});
  window.setInterval(() => {
    const s = welcome.status;
    if (s && !s.founder && welcome.done < 3) void welcome.load().catch(() => {});
  }, 20_000);
  // Gathering hours: a nudge when one is about to start, or has just begun.
  const nudged = new Set<string>();
  const gatherings = () => {
    const now = Date.now();
    for (const g of GATHERINGS) {
      const { start } = nextOccurrence(g, now);
      const key = `${g.key}:${start}`;
      if (nudged.has(key)) continue;
      if (start - now <= 10 * 60_000 && now - start <= 15 * 60_000) {
        nudged.add(key);
        hud.toast(start > now ? `🌆 ${g.title} starts in ${Math.ceil((start - now) / 60_000)} min, at ${g.where}.` : `🌆 ${g.title} has begun, at ${g.where}. Come along!`, 7000);
      }
    }
  };
  window.setTimeout(gatherings, 9000);
  window.setInterval(gatherings, 60_000);
  // A gentle nudge when there's a vote you can take part in.
  gov
    .loadStory()
    .then((s) => {
      const me = s.me;
      if (!me) return;
      const open = s.open.find((o) => !me.voted.includes(o.id) && (o.status === "voting" || o.status === "collecting"));
      if (open && (me.can_vote_founding || me.can_vote)) {
        hud.toast(`🗳 ${open.status === "voting" ? "A town vote is open" : "The town is collecting ideas"}: “${open.title}”. Visit the Town Hall.`, 7000);
      }
    })
    .catch(() => {});
  // A small daily gift, no streaks (spec §8.3).
  eco
    .daily()
    .then((g) => g && hud.toast(`A little gift for today: ${g.qty}× ${eco.name(g.item)} 🌱`, 5000))
    .catch(() => {});
}

main().catch((e) => {
  console.error(e);
  showOverlay("Couldn't start Commons", String(e?.message ?? e));
});
