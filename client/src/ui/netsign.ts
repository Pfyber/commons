// A little "no connection" sign, top right: up while the zone's socket is down
// or has gone quiet, the requests are failing, or the device itself is offline.
// It sits above everything, the "Reconnecting…" card too.

/** The socket pings every 5 s, so this long with nothing back means it's stopped answering. */
const SILENT_MS = 8000;
/** A socket closed this briefly's a hand-over (between zones), not a problem. */
const GRACE_MS = 2500;
/** How long a failed request keeps it up (nothing else may come to clear it). */
const REQUEST_BAD_MS = 10_000;

const ICON = ["....######....", "..##......##..", ".#..######..#.", "#..#......#..#", "..#..####..#..", ".....#..#.....", "..............", "......##......", "......##......"];

let watching = false;
let wanted = false;
let open = false;
let heardAt = 0;
let closedAt = 0;
let requestsBadUntil = 0;
let sign: HTMLElement | null = null;
let label: HTMLElement | null = null;

function icon(): string {
  let px = "";
  ICON.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === "#") px += `<rect x="${x + 1}" y="${y + 2}" width="1" height="1" fill="#3b3a2e"/>`;
  }));
  // Struck through, in red.
  for (let i = 0; i < 12; i++) px += `<rect x="${2 + i}" y="${12 - i}" width="2" height="2" fill="#c8302a"/>`;
  return `<svg viewBox="0 0 16 16" width="24" height="24" shape-rendering="crispEdges" aria-hidden="true">${px}</svg>`;
}

function trouble(): string | null {
  const now = performance.now();
  if (!navigator.onLine) return "No connection";
  if (wanted && !open && now - closedAt > GRACE_MS) return "No connection";
  if (wanted && open && now - heardAt > SILENT_MS) return "Server not responding";
  if (now < requestsBadUntil) return "No connection";
  return null;
}

/** Starts watching, the first time there's anything to watch. */
function watch() {
  if (watching) return;
  watching = true;
  window.setInterval(refresh, 1000);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  // (A hidden tab's timers crawl, pings with them: it hasn't gone quiet, we just weren't asking.)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) heardAt = performance.now();
  });
}

function refresh() {
  const t = trouble();
  if (!sign) {
    if (!t) return;
    sign = document.createElement("div");
    sign.className = "net-sign";
    sign.setAttribute("role", "status");
    sign.innerHTML = icon();
    label = document.createElement("span");
    sign.append(label);
    document.body.append(sign);
  }
  sign.hidden = !t;
  if (t && label) {
    label.textContent = t;
    sign.title = t;
  }
}

/** A socket's on its way. */
export function netConnecting() {
  watch();
  // (Timed from when it first went: another try doesn't start the clock again.)
  if (open || !wanted) closedAt = performance.now();
  wanted = true;
  open = false;
}

/** Word from the server (the socket's open, if it wasn't). */
export function netHeard() {
  open = true;
  heardAt = performance.now();
  refresh();
}

/** The socket's gone (we'll be trying again). */
export function netLost() {
  if (open) closedAt = performance.now();
  open = false;
}

/** No socket, and none coming, nothing wrong with that (signed in elsewhere, say). */
export function netIdle() {
  wanted = false;
  refresh();
}

export function netRequestOk() {
  requestsBadUntil = 0;
}

export function netRequestFailed() {
  watch();
  requestsBadUntil = performance.now() + REQUEST_BAD_MS;
  refresh();
}

