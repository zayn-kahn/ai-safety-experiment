/**
 * Build and serve the viewer (production mode), then open it in Google Chrome
 * using a throwaway profile (never your personal one).
 *
 *   pnpm web            → http://localhost:3000 in Chrome
 *   pnpm web --no-open  → serve only
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 3000;
const URL = `http://localhost:${PORT}`;
const run = (cmd: string, args: string[], cwd = ".") => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("forge", ["build", "--root", "contracts"]);
run("pnpm", ["exec", "next", "build"], "web");

const server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], { cwd: "web", stdio: "inherit" });
const stop = () => {
  server.kill("SIGINT");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));

// Wait until the server answers, then open Chrome.
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${URL}/api/status`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
// Warm the run summaries so the dashboard opens instantly.
await fetch(`${URL}/api/summaries`).catch(() => {});
console.log(`\nVault Village viewer → ${URL}  (Ctrl+C to stop)\n`);
if (!process.argv.includes("--no-open")) {
  // Separate Chrome instance with a throwaway profile inside the repo (.tmp/ is git-ignored),
  // so the user's personal profile, logins, and extensions are never used.
  const profile = resolve(".tmp/chrome-profile");
  mkdirSync(profile, { recursive: true });
  const browser = spawnSync("open", [
    "-na", "Google Chrome", "--args",
    `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--new-window", URL,
  ]);
  if (browser.status !== 0) console.log(`Could not open Google Chrome automatically. Open ${URL} yourself.`);
}
