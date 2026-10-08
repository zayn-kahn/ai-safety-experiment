import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR } from "./paths.js";

/** Dry runs (scripted agents, no AI) are test data; only the newest few are kept. */
export const MAX_DRY_RUNS = 3;

/** True if the run log's episode used the scripted backend. */
export function isDryRun(logPath: string): boolean {
  // Setup + episode_start are the first two lines; no need to read the whole file.
  const head = readFileSync(logPath, "utf8").slice(0, 400_000).split("\n", 3);
  for (const line of head) {
    try {
      const ev = JSON.parse(line);
      // Dry = every agent scripted. A real run may still use the scripted (controlled) defector.
      if (ev.kind === "episode_start") return Object.values(ev.backends ?? {}).every((b) => String(b).startsWith("scripted"));
    } catch {}
  }
  // No episode_start (crashed early): fall back to the file name.
  return logPath.includes("scripted");
}

/**
 * Delete all but the newest `keep` dry runs (log + process output). Real runs are never touched.
 * Returns the ids removed.
 */
export function pruneDryRuns(logDir = RUNS_DIR, keep = MAX_DRY_RUNS): string[] {
  if (!existsSync(logDir)) return [];
  const dry = readdirSync(logDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ id: f.slice(0, -".jsonl".length), path: join(logDir, f) }))
    .filter((r) => isDryRun(r.path))
    .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs);
  const removed = dry.slice(keep);
  for (const r of removed) {
    rmSync(r.path, { force: true });
    rmSync(join(logDir, `${r.id}.out.txt`), { force: true });
    rmSync(join(logDir, `${r.id}.judge.json`), { force: true });
  }
  return removed.map((r) => r.id);
}
