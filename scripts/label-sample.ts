/**
 * Draw the runs you hand-label to check the judge (docs/preregistration-2b.md, "Judge validation").
 * For one finished batch: STUDY.labelRunsPerBatch runs, spread evenly over conditions and guilty/innocent,
 * with a fixed seed. Every AI co-owner in a drawn run is labeled (3 per run). A batch is drawn once, never redrawn.
 *
 *   pnpm label:sample --batch 1
 *
 * Writes labels/study2b-sample.json; the Label page then shows only the drawn runs.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { readRun } from "../src/analysis/evidence.js";
import { plannedRuns, STUDY } from "../src/analysis/study-def.js";
import { LABELS_DIR, RUNS_DIR } from "../src/paths.js";

const { values: a } = parseArgs({ options: { batch: { type: "string" } } });
const batchNo = Number(a.batch);
if (!(batchNo >= 1 && batchNo <= STUDY.batches.length)) throw new Error(`--batch must be 1–${STUDY.batches.length}`);

const OUT = `${LABELS_DIR}/${STUDY.name.toLowerCase().replace(/\s+/g, "")}-sample.json`;
const sample: { study: string; batches: Record<string, { drawnAt: string; runs: string[] }> } = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, "utf8"))
  : { study: STUDY.name, batches: {} };
if (sample.batches[batchNo]) throw new Error(`batch ${batchNo} was already drawn on ${sample.batches[batchNo].drawnAt}; a sample is never redrawn.`);

// The finished study runs of this batch, one per planned cell (earliest wins).
const cells = plannedRuns(batchNo);
const finished = new Map<string, string>();
for (const f of readdirSync(RUNS_DIR).filter((f) => f.endsWith(".jsonl")).sort()) {
  const id = f.slice(0, -6);
  const L = readRun(id, RUNS_DIR);
  const st = L.find((e) => e.kind === "episode_start");
  if (!st?.scripted || st.promptVersion !== STUDY.promptVersion || !L.some((e) => e.kind === "episode_end") || L.some((e) => e.kind === "episode_abort")) continue;
  const key = `${st.condition}|${st.scripted.role}|${st.seed}`;
  if (!finished.has(key)) finished.set(key, id);
}
const missing = cells.filter((c) => !finished.has(`${c.condition}|${c.role}|${c.seed}`));
if (missing.length) throw new Error(`batch ${batchNo} isn't finished: ${missing.length} run(s) missing. Draw after it finishes.`);

// Seeded shuffle (the seed is part of the registered procedure: 20261001 + batch).
let state = 20261001 + batchNo;
const rnd = () => ((state = (state * 1103515245 + 12345) % 2147483648), state / 2147483648);
const shuffle = <T,>(xs: T[]) => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// Spread evenly: cycle through the conditions (in shuffled order), alternating guilty/innocent so a condition
// drawn twice gets one of each; within a condition × role, pick a random seed.
const k = STUDY.labelRunsPerBatch[batchNo - 1];
const conditions = shuffle(STUDY.batches[batchNo - 1].conditions);
const firstRole = rnd() < 0.5 ? 0 : 1;
const runs: string[] = [];
for (let i = 0; i < k; i++) {
  const condition = conditions[i % conditions.length];
  const role = STUDY.roles[(firstRole + i + Math.floor(i / conditions.length)) % 2];
  const options = shuffle(cells.filter((c) => c.condition === condition && c.role === role).map((c) => finished.get(`${c.condition}|${c.role}|${c.seed}`)!));
  runs.push(options.find((id) => !runs.includes(id))!);
}

sample.batches[batchNo] = { drawnAt: new Date().toISOString(), runs };
mkdirSync(LABELS_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(sample, null, 2));
console.log(`Drew ${runs.length} runs from batch ${batchNo} (${runs.length * 3} agents to label) into ${OUT}.`);
