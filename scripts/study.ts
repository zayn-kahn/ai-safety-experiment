/**
 * Run the current study (src/analysis/study-def.ts) through the whole pipeline:
 *
 *   games (4 at once)  →  each run judged the moment it finishes  →  each run shows up on the Label page
 *
 * Nothing waits for anything else: a game slot frees up as soon as its game ends, the judge works through finished
 * runs in its own queue, and you can label any finished run while the rest are still playing.
 *
 *   pnpm study --batch 2 --plan   show one batch's runs, settings and prompt version; run nothing
 *   pnpm study --batch 2          play one batch (needs STUDY.promptVersion frozen; resumes if stopped)
 *   pnpm study --pilot            the 2-run test (one guilty, one innocent), judged; check it on the viewer
 */
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { STUDY } from "../src/analysis/study-def.js";
import { promptVersion } from "../src/prompts.js";

const { values: a } = parseArgs({
  options: { plan: { type: "boolean", default: false }, pilot: { type: "boolean", default: false }, batch: { type: "string" } },
});
const batchNo = Number(a.batch);
if (!a.pilot && !(batchNo >= 1 && batchNo <= STUDY.batches.length)) throw new Error(`--batch must be 1–${STUDY.batches.length} (or use --pilot)`);
const batch = STUDY.batches[batchNo - 1];

const version = promptVersion();
const conditions = a.pilot ? [STUDY.pilot.condition] : batch.conditions;
const seeds = a.pilot ? STUDY.pilot.seeds : batch.seeds;
const runs = conditions.length * seeds.length * STUDY.roles.length;

console.log(`${STUDY.name} — ${a.pilot ? "PILOT" : batch.name}`);
console.log(`  AI co-owners  ${STUDY.model} ×3 · agent-0 scripted (guilty or innocent)`);
console.log(`  judge         ${STUDY.judgeModel} (one call per AI co-owner: ${runs * 3} calls)`);
console.log(`  runs          ${conditions.join(", ")} × seeds ${seeds.join(", ")} × ${STUDY.roles.join("/")} = ${runs}, ${Math.min(STUDY.parallel, runs)} at a time`);
console.log(`  prompts       version ${version}${STUDY.promptVersion ? (STUDY.promptVersion === version ? " (matches the frozen version)" : ` ≠ frozen ${STUDY.promptVersion}`) : " (not frozen yet)"}`);

if (!a.pilot && !a.plan) {
  if (!STUDY.promptVersion)
    throw new Error(`Freeze the prompts first: set promptVersion: "${version}" in src/analysis/study-def.ts (after the pilot looks right).`);
  if (STUDY.promptVersion !== version)
    throw new Error(`prompts/ changed since the study was frozen (${STUDY.promptVersion} → ${version}). Undo the change, or freeze the new version and start over.`);
}

const args = [
  "-s", "exec", "tsx", "scripts/batch.ts",
  "--model", STUDY.model,
  "--conditions", conditions.join(","),
  "--seeds", seeds.join(","),
  "--roles", STUDY.roles.join(","),
  "--rounds", String(STUDY.rounds),
  "--petty-cash", String(STUDY.pettyCash),
  "--parallel", String(Math.min(STUDY.parallel, runs)),
  "--judge",
  "--judge-model", STUDY.judgeModel,
  "--judge-parallel", String(STUDY.judgeParallel),
  ...(STUDY.reportTool ? [] : ["--no-report"]),
  ...(a.plan ? ["--plan"] : []),
];
const r = spawnSync("pnpm", args, { stdio: "inherit" });
if (!a.plan && r.status === 0) console.log(`\nDone. Label the runs at http://localhost:3000/label (they appear as they finish).`);
process.exit(r.status ?? 1);
