import { Application } from "pixi.js";
import parkUrl from "../../assets/maps/founders_park.json?url";
import homeUrl from "../../assets/maps/home.json?url";
import { Economy } from "./economy";
import { Game, type Ui } from "./game";
import { ApiError, Auth } from "./net/api";
import type { CloseReason } from "./net/socket";
import { Hud } from "./ui/hud";
import { signIn } from "./ui/login";
import { ActionMenu, AlbumPanel, BagPanel, MarketPanel, PlaceBanner, PlotMenu, ReelGame } from "./ui/panels";
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
    background: "#e3e9e6", // fog beyond the map edge
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  document.getElementById("stage")!.appendChild(app.canvas);

  let game: Game | null = null;
  const eco = new Economy(auth);
  const place = new PlaceBanner(() => place.hide());
  const ui: Ui = {
    eco,
    hud: new Hud(document.getElementById("hud")!, {
      onChat: (text) => game?.chat(text),
      onEmote: (id) => game?.emote(id),
      onSit: () => game?.toggleSit(),
      onBag: () => ui.bag.toggle(),
      onAlbum: () => ui.album.toggle(),
    }),
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
  };
  eco.onChange(() => ui.hud.setCoins(eco.coins));
  await eco.load().catch(() => {});

  let zone = "founders_park";
  let retry = 0;
  const enter = async () => {
    try {
      const [ticket, map] = await Promise.all([auth.join(zone), loadMap(zone)]);
      if (!game || game.zoneId !== zone) {
        game?.destroy();
        game = new Game(app, map, zone, ui, document.getElementById("labels")!, {
          onWelcome: () => (retry = 0),
          onDisconnect,
          onTravel: (z) => void travel(z),
        });
        if (import.meta.env.DEV) (window as unknown as { __commons: Game }).__commons = game;
      }
      game.connect(ticket.server_url, ticket.join_token);
      hideOverlay();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        auth.signOut();
        location.reload();
        return;
      }
      scheduleRetry();
    }
  };
  const travel = async (to: string) => {
    if (to === zone) return;
    zone = to;
    document.body.classList.add("fading");
    await new Promise((r) => setTimeout(r, 250));
    await enter();
    document.body.classList.remove("fading");
  };
  const scheduleRetry = () => {
    const delay = Math.min(30_000, 1000 * 2 ** retry++);
    showOverlay("Reconnecting…", "Lost the connection to the park. Trying again shortly.");
    window.setTimeout(enter, delay);
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
  // A small daily gift, no streaks (spec §8.3).
  eco
    .daily()
    .then((g) => g && ui.hud.toast(`A little gift for today: ${g.qty}× ${eco.name(g.item)} 🌱`, 5000))
    .catch(() => {});
}

main().catch((e) => {
  console.error(e);
  showOverlay("Couldn't start Commons", String(e?.message ?? e));
});
