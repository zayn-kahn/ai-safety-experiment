/**
 * Run a grid of games (conditions × seeds × guilty/innocent), several at once. With --judge, each run is judged
 * the moment it finishes, in its own queue, so games never wait for the judge (and the judge never waits for the batch).
 *
 *   pnpm batch --model gpt-5-mini --seeds 1,2 --parallel 4 --judge --judge-model claude-sonnet-5.5
 *   pnpm batch --conditions rules,emotion --seeds 8 --no-report
 *   pnpm batch ... --plan          print the runs and cost estimate, run nothing
 *   --parallel 4                   run several games at once (each on its own local chain)
 *   --judge-parallel 2             judge calls at once (separate from the games)
 * Resumes: runs already finished with the same settings and prompt version are skipped.
 *   --roles defector,innocent      scripted co-owner roles to run (default both: guilty runs + innocent look-alikes)
 *
 * Defaults: every condition in prompts/agent/conditions + baseline, seed 8, 5 rounds, defector agent-0
 * played by the fixed script, petty cash 20, report tool on.
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { readRun } from "../src/analysis/evidence.js";
import { listConditions, promptVersion } from "../src/prompts.js";
import { RUNS_DIR } from "../src/paths.js";

const { values: a } = parseArgs({
  options: {
    model: { type: "string", default: "claude-sonnet-5.5" },
    conditions: { type: "string" },
    seeds: { type: "string", default: "8" },
    rounds: { type: "string", default: "5" },
    defector: { type: "string", default: "agent-0" },
    "defector-player": { type: "string", default: "script" },
    roles: { type: "string", default: "defector,innocent" },
    "petty-cash": { type: "string", default: "20" },
    "no-report": { type: "boolean", default: false },
    judge: { type: "boolean", default: false },
    "judge-model": { type: "string", default: "gpt-5-mini" },
    plan: { type: "boolean", default: false },
    parallel: { type: "string", default: "1" },
    "judge-parallel": { type: "string", default: "2" },
  },
});

const conditions = a.conditions ? a.conditions.split(",").map((c) => c.trim()) : listConditions();
for (const c of conditions) if (!listConditions().includes(c)) throw new Error(`unknown condition ${c}`);
const seeds = a.seeds!.split(",").map((s) => Number(s.trim()));
const rounds = Number(a.rounds);
const parallel = Math.max(1, Number(a.parallel));
const roles = a["defector-player"] === "script" ? a.roles!.split(",").map((r) => r.trim()) : ["defector"];
for (const r of roles) if (r !== "defector" && r !== "innocent") throw new Error(`unknown role ${r}`);

// Estimate cost from past runs: average premium requests per turn for this model.
const perTurn = (() => {
  const costs: number[] = [];
  if (existsSync(RUNS_DIR))
    for (const f of readdirSync(RUNS_DIR).filter((f) => f.endsWith(".jsonl"))) {
      const L = readRun(f.slice(0, -6), RUNS_DIR);
      const s = L.find((e) => e.kind === "episode_start");
      if (!s) continue;
      for (const e of L) if (e.kind === "turn_end" && s.backends[e.agent] === `copilot:${a.model}`) costs.push(e.usage?.cost ?? 0);
    }
  return costs.length ? costs.reduce((x, y) => x + y, 0) / costs.length : null;
})();
const aiAgents = a.defector !== "none" && a["defector-player"] === "script" ? 3 : 4;
const turns = conditions.length * seeds.length * roles.length * rounds * aiAgents;

console.log(
  `Plan: ${conditions.length} condition(s) [${conditions.join(", ")}] × ${seeds.length} seed(s) [${seeds.join(", ")}] × ${roles.length} role(s) [${roles.join(", ")}] × ${rounds} rounds = ${conditions.length * seeds.length * roles.length} runs`,
);
console.log(`      model ${a.model}, defector ${a.defector} (${a["defector-player"]}), petty cash ${a["petty-cash"]}, report tool ${a["no-report"] ? "OFF" : "on"}`);
console.log(
  `      ${turns} AI turns · estimated ${perTurn !== null ? `~${Math.round(turns * perTurn)} premium requests (${perTurn.toFixed(2)}/turn from past runs)` : "unknown cost (no past runs on this model)"}${a.judge ? ` + judge on ${a["judge-model"]}` : ""}`,
);
if (a.plan) process.exit(0);

// Resume: a job is already done if a finished run exists with the same settings and prompt version.
const version = promptVersion();
const finished = new Map<string, string>();
if (existsSync(RUNS_DIR))
  for (const f of readdirSync(RUNS_DIR).filter((f) => f.endsWith(".jsonl"))) {
    const L = readRun(f.slice(0, -6), RUNS_DIR);
    const st = L.find((e) => e.kind === "episode_start");
    if (!st || !L.some((e) => e.kind === "episode_end") || L.some((e) => e.kind === "episode_abort") || st.promptVersion !== version) continue;
    const models = Object.entries(st.backends as Record<string, string>).filter(([id]) => id !== st.scripted?.agent).map(([, b]) => b);
    if (!models.every((b) => b === `copilot:${a.model}`)) continue;
    if (st.rounds !== rounds || st.variant?.pettyCash !== Number(a["petty-cash"]) || st.variant?.reportTool === !!a["no-report"]) continue;
    finished.set(`${st.condition}|${st.scripted?.role ?? "defector"}|${st.seed}`, f.slice(0, -6));
  }

interface Job {
  condition: string;
  role: string;
  seed: number;
}
const jobs: Job[] = [];
const ids: string[] = [];
for (const seed of seeds)
  for (const role of roles)
    for (const condition of conditions) {
      const done = finished.get(`${condition}|${role}|${seed}`);
      if (done) ids.push(done);
      else jobs.push({ condition, role, seed });
    }
console.log(`\n${ids.length} already done (prompt version ${version}), ${jobs.length} to run, ${parallel} at a time.`);

const runJob = (job: Job, port: number) =>
  new Promise<{ id: string; ok: boolean }>((done) => {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
    const who = a.defector === "none" ? "nodef" : job.role === "innocent" ? `innocent-${a.defector}` : `def-${a.defector}`;
    const id = [stamp, "copilot", a.model!.replace(/[^\w.-]/g, "_"), job.condition, who, `s${job.seed}`].join("_");
    console.log(`▶ start  ${job.condition} · ${job.role} · seed ${job.seed}  (${id})`);
    mkdirSync(RUNS_DIR, { recursive: true });
    const out = createWriteStream(`${RUNS_DIR}/${id}.out.txt`);
    const proc = spawn(
      "pnpm",
      [
        "-s", "exec", "tsx", "scripts/sim.ts",
        "--backend", "copilot",
        "--model", a.model!,
        "--condition", job.condition,
        "--seed", String(job.seed),
        "--rounds", String(rounds),
        "--defector", a.defector!,
        "--defector-player", a["defector-player"]!,
        "--scripted-role", job.role,
        "--petty-cash", a["petty-cash"]!,
        "--port", String(port),
        "--run-id", id,
        ...(a["no-report"] ? ["--no-report"] : []),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    proc.stdout.pipe(out);
    proc.stderr.pipe(out);
    proc.on("exit", (code) => {
      console.log(`${code === 0 ? "✓ done " : `✗ failed (exit ${code})`} ${job.condition} · ${job.role} · seed ${job.seed}  (${jobs.length} queued)`);
      done({ id, ok: code === 0 });
    });
  });

// The judge queue: runs join it as they finish; at most --judge-parallel are judged at once.
const judgeParallel = Math.max(1, Number(a["judge-parallel"]));
const judging: Promise<void>[] = [];
let freeJudgeSlots = judgeParallel;
const waitingForJudge: (() => void)[] = [];
const judgeRun = (id: string) =>
  judging.push(
    (async () => {
      if (freeJudgeSlots > 0) freeJudgeSlots--;
      else await new Promise<void>((r) => waitingForJudge.push(r));
      try {
        console.log(`⚖ judging ${id}`);
        const code = await new Promise<number | null>((r) =>
          spawn("pnpm", ["-s", "exec", "tsx", "scripts/judge.ts", "--model", a["judge-model"]!, id], { stdio: "inherit" }).on("exit", r),
        );
        if (code !== 0) console.log(`✗ judge failed (exit ${code}) for ${id}; rerun with: pnpm judge ${id}`);
      } finally {
        const next = waitingForJudge.shift();
        if (next) next();
        else freeJudgeSlots++;
      }
    })(),
  );
// Finished earlier but never judged (e.g. the batch was stopped): judge them now too.
if (a.judge) for (const id of ids) if (!existsSync(`${RUNS_DIR}/${id}.judge.json`)) judgeRun(id);

// A pool of workers, each with its own local chain port.
await Promise.all(
  Array.from({ length: Math.min(parallel, jobs.length) }, async (_, w) => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const { id, ok } = await runJob(job, 8560 + w);
      ids.push(id);
      if (ok && a.judge) judgeRun(id); // don't wait: the next game starts right away
    }
  }),
);
await Promise.all(judging);
spawnSync("pnpm", ["-s", "exec", "tsx", "scripts/compare.ts", ...ids], { stdio: "inherit" });
