#!/usr/bin/env node
// Starts the whole dev stack with prefixed logs: api, orchestrator, zone
// server, social gateway, the LiveKit voice server for phone calls and the
// Vite client (Postgres must be running). Ctrl+C stops everything.
//
//   node scripts/dev.mjs            # everything, with 20 bots for company
//   node scripts/dev.mjs --bots 50  # more bots
//   node scripts/dev.mjs --bots 0   # nobody but you
//   node scripts/dev.mjs --no-voice # without the voice server (no phone calls)
//
// LiveKit: `livekit-server` from PATH if you have it, else tools/livekit/,
// where the pinned release is downloaded the first time.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
// Terminals opened before Rust was installed don't have cargo on PATH yet;
// rustup's default location covers that case.
process.env.PATH = [process.env.PATH, path.join(os.homedir(), ".cargo", "bin")].join(path.delimiter);

// Plants grow one stage per minute in dev (production: hours), so gardening
// can be tried in a single session.
process.env.COMMONS_GROWTH_STAGE_SECS ??= "60";
// The game socket goes through the web server (/ws), so the park works from
// other devices and through a tunnel (VS Code port forwarding, ngrok…), not
// just on this machine.
process.env.ZONE_PUBLIC_URL ??= "/ws";

const voice = !args.includes("--no-voice");
const botsIdx = args.indexOf("--bots");
const bots = botsIdx >= 0 ? Number(args[botsIdx + 1] ?? 50) : 20;

console.log("building servers…");
const build = spawnSync("cargo", ["build", "--release", "--bin", "api", "--bin", "orchestrator", "--bin", "zone", "--bin", "social", "--bin", "botswarm"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const exe = (name) => path.join(root, "target", "release", process.platform === "win32" ? `${name}.exe` : name);
const colors = { api: 36, orch: 35, zone: 33, soc: 34, web: 32, bots: 90, lk: 31 };
const children = [];

function run(tag, cmd, cmdArgs, opts = {}) {
  const child = spawn(cmd, cmdArgs, { cwd: root, shell: process.platform === "win32" && !path.isAbsolute(cmd), ...opts });
  const prefix = `\x1b[${colors[tag]}m${tag.padEnd(4)}\x1b[0m │ `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) out.write(prefix + l + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => console.log(`${prefix}exited (${code})`));
  children.push(child);
  return child;
}

/** The LiveKit release fetched into tools/livekit/ when there's none. */
const LIVEKIT_VERSION = "1.13.10";

/** Finds (or fetches) livekit-server: on PATH, or in tools/livekit/. */
async function livekitServer() {
  const name = process.platform === "win32" ? "livekit-server.exe" : "livekit-server";
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["livekit-server"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split(/\r?\n/)[0];
  const dir = path.join(root, "tools", "livekit");
  const bin = path.join(dir, name);
  if (fs.existsSync(bin)) return bin;
  const os_ = { win32: "windows", darwin: "darwin", linux: "linux" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  if (!os_ || !arch) throw new Error(`no LiveKit release for ${process.platform}/${process.arch}`);
  const file = `livekit_${LIVEKIT_VERSION}_${os_}_${arch}.${os_ === "windows" ? "zip" : "tar.gz"}`;
  const url = `https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/${file}`;
  console.log(`voice: fetching LiveKit ${LIVEKIT_VERSION} into tools/livekit/ (once)…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`downloading ${url}: ${res.status}`);
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, file);
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  // tar unpacks both: on Windows, its own tar (10 and later), which reads zip
  // files (Git's GNU tar on PATH doesn't); run in the folder, so no "C:" paths.
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  const unpack = spawnSync(tar, ["-xf", file], { cwd: dir, stdio: "inherit" });
  fs.rmSync(archive, { force: true });
  if (unpack.status !== 0 || !fs.existsSync(bin)) throw new Error("unpacking LiveKit failed");
  return bin;
}

if (voice) {
  try {
    // Dev mode (its key and secret are what the social gateway expects by
    // default), on this machine.
    run("lk", await livekitServer(), ["--dev", "--bind", "127.0.0.1", "--node-ip", "127.0.0.1"]);
  } catch (e) {
    console.log(`voice: ${e.message}; phone calls won't connect (run with --no-voice to skip this)`);
  }
}
run("api", exe("api"), []);
run("orch", exe("orchestrator"), []);
run("zone", exe("zone"), []);
run("soc", exe("social"), []);
run("web", "npm", ["run", "dev"], { cwd: path.join(root, "client") });
if (bots > 0) {
  // Bots join once the zone server answers, however long startup takes.
  const startBots = async () => {
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch("http://127.0.0.1:8082/debug/stats")).ok) {
          // As real (dev) players, so people can befriend them.
          run("bots", exe("botswarm"), ["--bots", String(bots), "--ramp", "5", "--duration", "86400", "--behaviour", "mix", "--api", "http://127.0.0.1:8080"]);
          return;
        }
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log("bots: the zone server never came up, so no bots");
  };
  void startBots();
}

console.log("\nCommons is starting: open http://localhost:5173 (Ctrl+C to stop)\n");

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
