/**
 * Remove caches, build output, and temp files. Run data in data/runs/ is kept unless you ask.
 *
 *   pnpm clean              caches, builds, temp browser profiles, test screenshots
 *   pnpm clean --dry-run    show what would be removed, remove nothing
 *   pnpm clean --runs       also delete all run logs (your experiment data!)
 *   pnpm clean --deps       also delete installed packages (run `pnpm install` after)
 *
 * Never touches .env, source code, contract sources, or contracts/lib/forge-std.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { RUNS_DIR } from "../src/paths.js";

const args = new Set(process.argv.slice(2));
const dry = args.has("--dry-run");

interface Target {
  path: string;
  what: string;
  /** Returns a reason to skip (e.g. in use), or null. */
  skip?: () => string | null;
}

const listening = (port: number) => {
  try {
    return execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() !== "";
  } catch {
    return false;
  }
};
const processUsing = (needle: string) => {
  try {
    return execSync(`pgrep -f ${JSON.stringify(needle)}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() !== "";
  } catch {
    return false;
  }
};

const targets: Target[] = [
  { path: "contracts/out", what: "compiled contracts (rebuilt by forge build)" },
  { path: "contracts/cache", what: "Foundry cache" },
  { path: "web/.next", what: "viewer build", skip: () => (listening(3000) || listening(3001) ? "the viewer is running (stop it first)" : null) },
  { path: "web/tsconfig.tsbuildinfo", what: "TypeScript incremental cache" },
  // Everything inside .tmp/, one entry each, so nothing is counted twice.
  ...(existsSync(".tmp") ? readdirSync(".tmp") : []).map(
    (name): Target => ({
      path: `.tmp/${name}`,
      what: name.endsWith("-profile") ? "throwaway browser profile" : "temp file",
      skip: () => (processUsing(`.tmp/${name}`) ? "in use by an open window (close it first)" : null),
    }),
  ),
  { path: ".playwright-mcp", what: "UI test screenshots and snapshots" },
  { path: ".copilot", what: "Copilot session data (your token is in .env and is kept)", skip: () => (processUsing("scripts/sim.ts") ? "a simulation is running" : null) },
  { path: ".cache", what: "pnpm metadata cache" },
];
if (args.has("--runs")) targets.push({ path: RUNS_DIR, what: "ALL run logs (experiment data)", skip: () => (processUsing("scripts/sim.ts") ? "a simulation is running" : null) });
if (args.has("--deps")) {
  targets.push({ path: "node_modules", what: "installed packages" });
  targets.push({ path: "web/node_modules", what: "viewer packages" });
  targets.push({ path: ".pnpm-store", what: "pnpm package store" });
}

const size = (p: string) => {
  try {
    return execSync(`du -sk ${JSON.stringify(p)}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().split("\t")[0];
  } catch {
    return "0";
  }
};

let freedKb = 0;
let skipped = 0;
for (const t of targets) {
  if (!existsSync(t.path)) continue;
  const reason = t.skip?.();
  const kb = Number(size(t.path));
  const mb = (kb / 1024).toFixed(1).padStart(7);
  if (reason) {
    console.log(`  skip   ${mb} MB  ${t.path.padEnd(26)} ${reason}`);
    skipped++;
    continue;
  }
  if (!dry) rmSync(t.path, { recursive: true, force: true });
  freedKb += kb;
  console.log(`  ${dry ? "would" : "removed"} ${mb} MB  ${t.path.padEnd(26)} ${t.what}`);
}

console.log(`\n${dry ? "Would free" : "Freed"} ${(freedKb / 1024).toFixed(1)} MB.${skipped ? ` ${skipped} item(s) skipped because they're in use.` : ""}`);
if (!args.has("--runs") && existsSync(RUNS_DIR)) console.log(`Kept ${RUNS_DIR}/ (your run data). Add --runs to delete it too.`);
if (args.has("--deps") && !dry) console.log("Run `pnpm install` to reinstall packages.");
