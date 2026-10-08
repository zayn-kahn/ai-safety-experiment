/**
 * Publish runs to the read-only site: copies them into web/public/data (committed to git, served by Vercel).
 *
 *   pnpm export                    every finished real run
 *   pnpm export <id> [<id> ...]    only these runs
 *   pnpm export --exclude <id>     everything except these (repeatable)
 *   pnpm export --list             show what would be published, write nothing
 *
 * Replaces whatever was published before. Dry runs are never published.
 * Keeps only the events the viewer uses, and refuses to write anything that looks like a token.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { readRun, type Ev } from "../src/analysis/evidence.js";
import { summarizeRun } from "../src/analysis/summary.js";
import { isDryRun } from "../src/runs.js";
import { RUNS_DIR } from "../src/paths.js";

const OUT = "web/public/data";
const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: { exclude: { type: "string", multiple: true, default: [] }, list: { type: "boolean", default: false } },
});

const finishedReal = (existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR) : [])
  .filter((f) => f.endsWith(".jsonl") && !isDryRun(`${RUNS_DIR}/${f}`))
  .map((f) => f.slice(0, -".jsonl".length))
  .filter((id) => {
    const L = readRun(id, RUNS_DIR);
    return L.some((e) => e.kind === "episode_end") && !L.some((e) => e.kind === "episode_abort");
  });
const ids = (positionals.length ? positionals : finishedReal).filter((id) => !a.exclude!.includes(id));
for (const id of ids) if (!finishedReal.includes(id)) throw new Error(`${id} is not a finished real run`);

// The viewer only uses these provider events; the rest is raw Copilot bookkeeping.
const KEEP_LLM = new Set(["assistant.reasoning", "assistant.message", "session.error", "permission_rejected"]);
function slim(L: Ev[]): Ev[] {
  return L.flatMap((e) => {
    if (e.kind !== "llm_event") return [e];
    const t = e.event?.type;
    if (!KEEP_LLM.has(t)) return [];
    if (t === "assistant.message") {
      const content = e.event.data?.content;
      return typeof content === "string" && content.trim() ? [{ ...e, event: { type: t, data: { content } } }] : [];
    }
    if (t === "assistant.reasoning") return [{ ...e, event: { type: t, data: { content: e.event.data?.content ?? "" } } }];
    return [e];
  });
}

/** Label for the runs list, same as the local viewer's. */
function meta(L: Ev[]) {
  const start = L.find((e) => e.kind === "episode_start")!;
  const all = Object.values(start.backends ?? {}) as string[];
  const models = [...new Set(all.filter((b) => !b.startsWith("scripted")))];
  const scripted = all.some((b) => b.startsWith("scripted"));
  const backend = `${models.length > 1 ? `copilot:mixed (${models.length} models)` : models[0]}${scripted ? " + scripted defector" : ""}`;
  return { condition: start.condition, defector: start.defector, seed: start.seed, rounds: start.rounds, backend, variant: start.variant };
}

const SECRET = /github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9-]{10,}|COPILOT_GITHUB_TOKEN\s*=/;

const rows = ids
  .map((id) => ({ id, mtime: statSync(`${RUNS_DIR}/${id}.jsonl`).mtimeMs }))
  .sort((x, y) => y.mtime - x.mtime);

console.log(`${a.list ? "Would publish" : "Publishing"} ${rows.length} run(s) to ${OUT}:`);
const files: [string, string][] = [];
const runsIndex = [];
for (const { id, mtime } of rows) {
  const L = readRun(id, RUNS_DIR);
  const body = JSON.stringify(slim(L));
  files.push([`runs/${id}.json`, body]);
  runsIndex.push({ id, mtime, meta: meta(L), done: true, running: false });
  const s = summarizeRun(id)!;
  console.log(`  ${id}  ${(body.length / 1024).toFixed(0)} KB · ${s.condition} · ${s.judged ? "judged" : "not judged"}`);
}
files.push(["runs.json", JSON.stringify(runsIndex)]);
files.push(["summaries.json", JSON.stringify(rows.map((r) => summarizeRun(r.id)))]);

for (const [name, body] of files) {
  const m = body.match(SECRET);
  if (m) throw new Error(`Refusing to publish: ${name} contains something that looks like a token (${m[0].slice(0, 12)}…)`);
}
if (a.list) process.exit(0);

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(`${OUT}/runs`, { recursive: true });
for (const [name, body] of files) writeFileSync(`${OUT}/${name}`, body);
const total = files.reduce((s, [, b]) => s + b.length, 0);
console.log(`\nDone: ${(total / 1024 / 1024).toFixed(1)} MB. Commit web/public/data and push to update the site.`);
