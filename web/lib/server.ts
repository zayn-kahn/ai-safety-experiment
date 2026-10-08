import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { agentTranscript, readRun, watchedActions } from "../../src/analysis/evidence";
import { isPlanned, STUDY } from "../../src/analysis/study-def";
import { LABELS_DIR, RUNS_DIR } from "../../src/paths";

/** Deployed (Vercel) = read-only replay: the API that starts, stops, or judges runs is switched off. */
export const READ_ONLY_DEPLOY = !!process.env.VERCEL || process.env.VV_MODE === "replay";
export const readOnlyResponse = () => Response.json({ error: "This deployment is read-only." }, { status: 403 });

/** The web app lives in <repo>/web; the simulation lives in <repo>. */
export const REPO = resolve(process.cwd(), "..");
export const LOG_DIR = join(REPO, RUNS_DIR);
const TSX = join(REPO, "node_modules/.bin/tsx");
const SIM_PORT = 8546;

/** "none" plus every <repo>/prompts/agent/conditions/<name>.md, read fresh so new condition files appear immediately. */
export function listConditions(): string[] {
  const dir = join(REPO, "prompts/agent/conditions");
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort() : [];
  return ["none", ...names];
}
export const AGENT_IDS = ["agent-0", "agent-1", "agent-2", "agent-3"] as const;

/** Re-read .env on every call so a token pasted while the server runs is picked up. */
export function readEnv(): Record<string, string> {
  const path = join(REPO, ".env");
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
export const tokenConfigured = () => (readEnv().COPILOT_GITHUB_TOKEN ?? "").length > 0;

// Survives Next.js dev hot reloads.
const g = globalThis as unknown as { __vvActive?: { id: string; proc: ChildProcess } | null };
export const activeRun = () => g.__vvActive ?? null;

export const validId = (id: string) => /^[\w.-]{1,200}$/.test(id);

export function readLog(id: string): unknown[] {
  const path = join(LOG_DIR, `${id}.jsonl`);
  if (!validId(id) || !existsSync(path)) return [];
  const out: unknown[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      break; // last line still being written; next poll gets it
    }
  }
  return out;
}

export function readOutput(id: string): string {
  const path = join(LOG_DIR, `${id}.out.txt`);
  return validId(id) && existsSync(path) ? readFileSync(path, "utf8").slice(-20_000) : "";
}

/** Per-run facts read from its log, cached by modification time (a finished run is read once). */
const gr = globalThis as typeof globalThis & { __vvRunCache?: Map<string, { mtime: number; meta: Record<string, unknown> | null; done: boolean; round: number }> };
gr.__vvRunCache ??= new Map();

function runFacts(id: string, mtime: number) {
  const hit = gr.__vvRunCache!.get(id);
  if (hit && hit.mtime === mtime) return hit;
  const text = readFileSync(join(LOG_DIR, `${id}.jsonl`), "utf8");
  let meta: Record<string, unknown> | null = null;
  for (const line of text.split("\n", 5)) {
    try {
      const ev = JSON.parse(line);
      if (ev.kind === "episode_start") {
        const all = Object.values(ev.backends ?? {}) as string[];
        const models = [...new Set(all.filter((b) => !b.startsWith("scripted")))];
        const scripted = all.some((b) => b.startsWith("scripted"));
        const backend = !models.length
          ? all[0]
          : `${models.length > 1 ? `copilot:mixed (${models.length} models)` : models[0]}${scripted ? " + scripted defector" : ""}`;
        meta = { condition: ev.condition, defector: ev.defector, role: ev.scripted?.role ?? null, seed: ev.seed, rounds: ev.rounds, backend, variant: ev.variant };
      }
    } catch {}
  }
  const rounds = [...text.matchAll(/"kind":"round_start","round":(\d+)/g)];
  const facts = { mtime, meta, done: text.includes('"kind":"episode_end"'), round: rounds.length ? Number(rounds[rounds.length - 1][1]) : 0 };
  gr.__vvRunCache!.set(id, facts);
  return facts;
}

export function listRuns() {
  if (!existsSync(LOG_DIR)) return [];
  return readdirSync(LOG_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const id = f.slice(0, -".jsonl".length);
      const mtime = statSync(join(LOG_DIR, f)).mtimeMs;
      const { meta, done, round } = runFacts(id, mtime);
      return {
        id,
        mtime,
        meta,
        done,
        round,
        judged: existsSync(join(LOG_DIR, `${id}.judge.json`)),
        // Runs started from the viewer are tracked directly; CLI/batch runs count as live while their log keeps growing.
        running: activeRun()?.id === id || (!done && Date.now() - mtime < 30_000),
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function int(v: unknown, min: number, max: number, name: string) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

export interface StartRunInput {
  backend?: string;
  model?: string;
  condition?: string;
  defector?: string;
  rounds?: number;
  seed?: number;
  pettyCash?: number;
  maxTools?: number;
  defectorPlayer?: string;
  noReport?: boolean;
}

/** Validates input and spawns `tsx scripts/sim.ts` (no shell). One run at a time. */
export function startRun(body: StartRunInput): string {
  if (activeRun()) throw new Error(`Run ${activeRun()!.id} is still going. Stop it first.`);
  const backend = body.backend === "copilot" ? "copilot" : "scripted";
  const condition = String(body.condition ?? "none");
  if (!listConditions().includes(condition)) throw new Error("Unknown condition");
  const defector = String(body.defector ?? "none");
  if (defector !== "none" && defector !== "random" && !(AGENT_IDS as readonly string[]).includes(defector)) throw new Error("Unknown defector");
  const rounds = int(body.rounds ?? 6, 1, 30, "Rounds");
  const seed = int(body.seed ?? 1, 0, 1_000_000, "Seed");
  const petty = int(body.pettyCash ?? 0, 0, 100, "Petty cash");
  const maxTools = int(body.maxTools ?? 8, 1, 20, "Tools per turn");
  const model = backend === "copilot" ? String(body.model ?? "") : "";
  if (backend === "copilot") {
    if (!/^[\w.:/-]{1,80}$/.test(model)) throw new Error("Pick a model");
    if (!tokenConfigured()) throw new Error("COPILOT_GITHUB_TOKEN is empty in .env");
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const id = [stamp, backend, model.replace(/[^\w.-]/g, "_"), condition, defector === "none" ? "nodef" : `def-${defector}`, `s${seed}`]
    .filter(Boolean)
    .join("_");
  const args = [
    "scripts/sim.ts",
    "--backend", backend,
    "--condition", condition,
    "--defector", defector,
    "--rounds", String(rounds),
    "--seed", String(seed),
    "--petty-cash", String(petty),
    "--max-tools", String(maxTools),
    "--port", String(SIM_PORT),
    "--run-id", id,
    "--defector-player", body.defectorPlayer === "model" ? "model" : "script",
    ...(body.noReport ? ["--no-report"] : []),
    ...(model ? ["--model", model] : []),
  ];
  mkdirSync(LOG_DIR, { recursive: true });
  const proc = spawn(TSX, args, { cwd: REPO, env: { ...process.env, ...readEnv() }, stdio: ["ignore", "pipe", "pipe"] });
  const out = createWriteStream(join(LOG_DIR, `${id}.out.txt`));
  proc.stdout!.pipe(out);
  proc.stderr!.pipe(out);
  proc.on("exit", (code) => {
    out.write(`\n[process exited with code ${code}]\n`);
    if (g.__vvActive?.proc === proc) g.__vvActive = null;
    // Real runs started from the viewer are judged automatically when they finish.
    if (backend === "copilot" && code === 0) judgeRun(id).catch(() => {});
  });
  g.__vvActive = { id, proc };
  return id;
}

export function stopRun(id: string) {
  const a = activeRun();
  if (a?.id === id) a.proc.kill("SIGINT");
}

let modelsCache: { at: number; data: unknown } | null = null;

/** Lists Copilot models by running scripts/models.ts --json (keeps the SDK out of the Next bundle). */
export async function listModels(): Promise<unknown> {
  if (!tokenConfigured()) return { ok: false, error: "COPILOT_GITHUB_TOKEN is empty in .env" };
  if (modelsCache && Date.now() - modelsCache.at < 10 * 60_000) return modelsCache.data;
  const data = await new Promise<unknown>((done) => {
    const proc = spawn(TSX, ["scripts/models.ts", "--json"], { cwd: REPO, env: { ...process.env, ...readEnv() } });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("exit", (code) => {
      try {
        if (code !== 0) {
          // Prefer the API's own message (e.g. a missing token permission) over the stack trace.
          const raw = stderr.match(/"body":"((?:[^"\\]|\\.)*)"/)?.[1];
          const body = raw ? (JSON.parse(`"${raw}"`) as string).trim() : stderr.match(/failed with message: ([^\n{]+)/)?.[1];
          throw new Error(body ?? (stderr.trim().split("\n").slice(-3).join(" ") || `exit ${code}`));
        }
        done({ ok: true, models: JSON.parse(stdout) });
      } catch (err) {
        done({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  });
  if ((data as { ok: boolean }).ok) modelsCache = { at: Date.now(), data };
  return data;
}

// ---- Summaries (dashboard + Results tab) and judging ----

const gs = globalThis as unknown as {
  __vvSummaries?: { key: string; data: unknown[] };
  __vvJudging?: Set<string>;
};
gs.__vvJudging ??= new Set();

/** Runs being judged right now (so the UI can show progress). */
export const judgingNow = () => [...gs.__vvJudging!];

/** Fingerprint of every real-run log and judge file, so the cached summaries refresh only when something changed. */
function logsFingerprint(): string {
  if (!existsSync(LOG_DIR)) return "";
  return readdirSync(LOG_DIR)
    .filter((f) => f.endsWith(".jsonl") || f.endsWith(".judge.json"))
    .map((f) => `${f}:${statSync(join(LOG_DIR, f)).mtimeMs}`)
    .sort()
    .join("|");
}

/** Summaries of all real runs (via `scripts/compare.ts --json`, the same code as the terminal report). */
export async function summaries(): Promise<unknown[]> {
  const key = logsFingerprint();
  if (gs.__vvSummaries?.key === key) return gs.__vvSummaries.data;
  const data = await new Promise<unknown[]>((done, fail) => {
    const proc = spawn(TSX, ["scripts/compare.ts", "--json"], { cwd: REPO });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("exit", (code) => {
      try {
        if (code !== 0) throw new Error(stderr.trim().split("\n").slice(-3).join(" "));
        done(JSON.parse(stdout));
      } catch (err) {
        fail(err);
      }
    });
  });
  gs.__vvSummaries = { key, data };
  return data;
}

/** Judge one run with the LLM judge (scripts/judge.ts). Resolves when the verdicts are written. */
export function judgeRun(id: string): Promise<void> {
  if (!validId(id)) return Promise.reject(new Error("bad run id"));
  if (gs.__vvJudging!.has(id)) return Promise.resolve();
  if (!tokenConfigured()) return Promise.reject(new Error("COPILOT_GITHUB_TOKEN is empty in .env"));
  gs.__vvJudging!.add(id);
  return new Promise((done, fail) => {
    const proc = spawn(TSX, ["scripts/judge.ts", id], { cwd: REPO, env: { ...process.env, ...readEnv() } });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("exit", (code) => {
      gs.__vvJudging!.delete(id);
      if (code === 0) done();
      else fail(new Error(stderr.trim().split("\n").slice(-3).join(" ") || `judge exited ${code}`));
    });
  });
}

// ---- Labels: you label every finished study run, blind (local only) ----

const STUDY_SLUG = STUDY.name.toLowerCase().replace(/\s+/g, "");
const LABELS = join(REPO, LABELS_DIR, `${STUDY_SLUG}-labels.json`);
/** The runs drawn for labeling (pnpm label:sample --batch N). Until a batch is drawn, only pilot runs are shown. */
const SAMPLE = join(REPO, LABELS_DIR, `${STUDY_SLUG}-sample.json`);
function sampledRuns(): Set<string> {
  if (!existsSync(SAMPLE)) return new Set();
  const s = JSON.parse(readFileSync(SAMPLE, "utf8")) as { batches: Record<string, { runs: string[] }> };
  return new Set(Object.values(s.batches).flatMap((b) => b.runs));
}

export interface LabelItem {
  key: string;
  watched: string;
  actions: string[];
  record: string;
  /** From the 2-run pilot (never analysed). */
  pilot: boolean;
}
export type Labels = Record<string, { suspected: boolean; escalated: boolean; note?: string; at: string }>;

/** Label items per run, cached by the log file's modification time (each run is parsed once). */
const gl = globalThis as typeof globalThis & { __vvLabelCache?: Map<string, { mtime: number; items: LabelItem[] }> };
gl.__vvLabelCache ??= new Map();

/** A finished run of the current study (or its pilot): its three AI co-owners, stripped of the condition and the role. */
function itemsForRun(id: string): LabelItem[] {
  const path = join(LOG_DIR, `${id}.jsonl`);
  const mtime = statSync(path).mtimeMs;
  const hit = gl.__vvLabelCache!.get(id);
  if (hit && hit.mtime === mtime) return hit.items;
  let items: LabelItem[] = [];
  const L = readRun(id, LOG_DIR);
  const st = L.find((e) => e.kind === "episode_start");
  const finished = L.some((e) => e.kind === "episode_end") && !L.some((e) => e.kind === "episode_abort");
  const pilot = STUDY.pilot.seeds.includes(st?.seed);
  const inStudy =
    st &&
    finished &&
    st.scripted &&
    st.rounds === STUDY.rounds &&
    st.variant?.pettyCash === STUDY.pettyCash &&
    st.variant?.reportTool === STUDY.reportTool &&
    (pilot || isPlanned(st.condition, st.seed)) &&
    (pilot || !STUDY.promptVersion || st.promptVersion === STUDY.promptVersion) &&
    Object.entries(st.backends as Record<string, string>).every(([a, b]) => a === st.scripted.agent || b === `copilot:${STUDY.model}`);
  if (inStudy) {
    const watched = st.scripted.agent as string;
    const actions = watchedActions(L).map((w) => `round ${w.round}: ${w.what}`);
    items = Object.keys(st.backends)
      .filter((a) => a !== watched)
      .map((agent) => ({ key: `${id}|${agent}`, watched, actions, record: agentTranscript(L, agent), pilot }));
  }
  gl.__vvLabelCache!.set(id, { mtime, items });
  return items;
}

/** A fixed pseudo-random order, so items don't line up by condition or role. */
const scramble = (key: string) => [...key].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

export function readLabeling(): { items: LabelItem[]; labels: Labels } {
  const ids = existsSync(LOG_DIR) ? readdirSync(LOG_DIR).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)) : [];
  const drawn = sampledRuns();
  const items = ids
    .filter((id) => drawn.has(id))
    .flatMap(itemsForRun)
    .sort((a, b) => Number(b.pilot) - Number(a.pilot) || scramble(a.key) - scramble(b.key));
  const labels = existsSync(LABELS) ? (JSON.parse(readFileSync(LABELS, "utf8")) as Labels) : {};
  return { items, labels };
}

export function saveLabel(key: string, value: { suspected: boolean; escalated: boolean; note?: string }) {
  const { items, labels } = readLabeling();
  if (!items.some((i) => i.key === key)) throw new Error("unknown item");
  if (typeof value.suspected !== "boolean" || typeof value.escalated !== "boolean") throw new Error("suspected and escalated must be yes/no");
  labels[key] = { suspected: value.suspected, escalated: value.escalated, note: value.note?.slice(0, 1000), at: new Date().toISOString() };
  mkdirSync(join(REPO, LABELS_DIR), { recursive: true });
  writeFileSync(LABELS, JSON.stringify(labels, null, 2));
}
