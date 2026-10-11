import { Application } from "pixi.js";
import mapUrl from "../../assets/maps/founders_park.json?url";
import { Game } from "./game";
import { ApiError, Auth } from "./net/api";
import type { CloseReason } from "./net/socket";
import { Hud } from "./ui/hud";
import { signIn } from "./ui/login";
import type { ZoneMap } from "./world/map";
import "./styles.css";

const ZONE = "founders_park";
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

async function main() {
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  const auth = new Auth();
  const [map, resumed] = await Promise.all([
    fetch(mapUrl).then((r) => r.json() as Promise<ZoneMap>),
    new URLSearchParams(location.search).has("login") ? Promise.resolve(false) : auth.resume(),
  ]);
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

  let game: Game;
  const hud = new Hud(document.getElementById("hud")!, {
    onChat: (text) => game.chat(text),
    onEmote: (id) => game.emote(id),
    onSit: () => game.toggleSit(),
  });

  let retry = 0;
  const join = async () => {
    try {
      const ticket = await auth.join(ZONE);
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
  const scheduleRetry = () => {
    const delay = Math.min(30_000, 1000 * 2 ** retry++);
    showOverlay("Reconnecting…", "Lost the connection to the park. Trying again shortly.");
    window.setTimeout(join, delay);
  };
  const onDisconnect = (reason: CloseReason) => {
    if (reason?.code === ERR_REPLACED) {
      showOverlay("You joined from somewhere else", "Commons is open in another tab or device.", {
        label: "Play here instead",
        run: () => void join(),
      });
    } else if (reason?.code === ERR_VERSION) {
      showOverlay("Commons was updated", "Reload to get the latest version.", { label: "Reload", run: () => location.reload() });
    } else {
      scheduleRetry();
    }
  };

  game = new Game(app, map, hud, document.getElementById("labels")!, {
    onWelcome: () => (retry = 0),
    onDisconnect,
  });
  if (import.meta.env.DEV) (window as unknown as { __commons: Game }).__commons = game;
  await join();
}

main().catch((e) => {
  console.error(e);
  showOverlay("Couldn't start Commons", String(e?.message ?? e));
});
