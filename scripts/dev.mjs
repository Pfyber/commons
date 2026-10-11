#!/usr/bin/env node
// Starts the whole dev stack with prefixed logs: api, orchestrator, zone
// server, social gateway and the Vite client (Postgres must be running). Ctrl+C stops everything.
//
//   node scripts/dev.mjs            # everything
//   node scripts/dev.mjs --bots 50  # plus 50 wandering bots for company
import { spawn, spawnSync } from "node:child_process";
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

const botsIdx = args.indexOf("--bots");
const bots = botsIdx >= 0 ? Number(args[botsIdx + 1] ?? 50) : 0;

console.log("building servers…");
const build = spawnSync("cargo", ["build", "--release", "--bin", "api", "--bin", "orchestrator", "--bin", "zone", "--bin", "social", "--bin", "botswarm"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const exe = (name) => path.join(root, "target", "release", process.platform === "win32" ? `${name}.exe` : name);
const colors = { api: 36, orch: 35, zone: 33, soc: 34, web: 32, bots: 90 };
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

run("api", exe("api"), []);
run("orch", exe("orchestrator"), []);
run("zone", exe("zone"), []);
run("soc", exe("social"), []);
run("web", "npm", ["run", "dev"], { cwd: path.join(root, "client") });
if (bots > 0) {
  setTimeout(() => run("bots", exe("botswarm"), ["--bots", String(bots), "--ramp", "5", "--duration", "86400", "--behaviour", "mix"]), 2000);
}

console.log("\nCommons is starting: open http://localhost:5173 (Ctrl+C to stop)\n");

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
