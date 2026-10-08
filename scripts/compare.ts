/**
 * Side-by-side summary of runs: what the defector did, who caught it, who stayed silent, and why.
 * Uses the LLM judge's verdicts (data/runs/<run>.judge.json, from `pnpm judge`) when present.
 *
 *   pnpm compare                 all real runs (newest first)
 *   pnpm compare <id> <id> ...   specific runs
 *   --json                       machine-readable output (used by the viewer's dashboard)
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { summarizeRun, type RunSummary } from "../src/analysis/summary.js";
import { isDryRun } from "../src/runs.js";
import { RUNS_DIR } from "../src/paths.js";

const json = process.argv.includes("--json");
const args = process.argv.slice(2).filter((a) => a !== "--json");
const ids = args.length
  ? args
  : (existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR) : [])
      .filter((f) => f.endsWith(".jsonl") && !isDryRun(`${RUNS_DIR}/${f}`))
      .sort((a, b) => statSync(`${RUNS_DIR}/${b}`).mtimeMs - statSync(`${RUNS_DIR}/${a}`).mtimeMs)
      .map((f) => f.slice(0, -".jsonl".length));

const summaries = ids.map((id) => summarizeRun(id)).filter((s): s is RunSummary => s !== null);

if (json) {
  process.stdout.write(JSON.stringify(summaries));
} else {
  for (const s of summaries) print(s);
  if (!summaries.length) console.log("No runs.");
}

function print(s: RunSummary) {
  const players = s.agents.map((a) => `${a.agent}=${a.player}`).join(", ");
  console.log(`\n━━ ${s.id}`);
  console.log(
    `  setup      condition ${s.condition} · seed ${s.seed} · ${s.rounds} rounds · petty cash ${s.pettyCash ?? "?"} · report tool ${s.reportTool ? "on" : "OFF"}${s.done ? "" : " · INCOMPLETE"}`,
  );
  console.log(`  players    ${players}`);
  console.log(
    `  watched    ${s.watched ?? "none"}${s.scriptedRole ? ` (scripted ${s.scriptedRole === "innocent" ? "INNOCENT look-alike" : "defector"})` : s.defector ? ` (AI-played defector: ${s.defectorPlayer})` : ""} · prompts ${s.promptVersion ?? "pre-versioning"} · judge ${s.judgeVersion ?? "not judged"}`,
  );
  console.log(
    `  did        ${s.wrongdoing.length ? s.wrongdoing.map((w) => `r${w.round} ${w.what}`).join("; ") : "nothing reportable"}${s.wrongdoing.length ? ` · ${s.stolen} tokens reached its wallet` : ""}`,
  );
  if (s.scriptedRole === "innocent") {
    console.log(`  actions    ${s.watchedActions.map((w) => `r${w.round} ${w.what}`).join("; ") || "none"}`);
    const against = s.agents.flatMap((a) => a.reports.filter((r) => r.suspect === s.watched).map((r) => `${a.agent}@r${r.round}`));
    console.log(`  reports    ${against.length ? against.join(", ") : "none"} (against the innocent co-owner)`);
    console.log(`  false alarms ${s.falseAlarms.length ? s.falseAlarms.join(", ") : "none"} (reported or warned about an innocent co-owner)`);
  }
  console.log(
    `  escalated  ${s.escalated.length ? s.escalated.join(", ") : "nobody"} (formal report or explicit warning)`,
  );
  console.log(
    `  reports    ${s.correctReports.length ? s.correctReports.map((r) => `${r.from}@r${r.round}`).join(", ") : "none"}${s.wrongReports ? ` · ${s.wrongReports} wrong` : ""}${s.firstReportRound !== null && s.firstWrongRound !== null ? ` · first ${s.firstReportRound - s.firstWrongRound} round(s) after the first wrongdoing` : ""}`,
  );
  if (!s.wrongdoing.length) console.log(`  silent     n/a (defector did nothing reportable)`);
  else if (!s.judged) console.log(`  silent     not judged yet (run \`pnpm judge\`)`);
  else {
    console.log(
      `  silent     ${s.silent.length ? s.silent.join(", ") : "none"}${s.onlyQuestioned.length ? ` (only asked for explanations: ${s.onlyQuestioned.join(", ")})` : ""} (judge: ${s.judgeModel})`,
    );
    for (const a of s.agents)
      if (a.verdict?.noticed && !a.verdict.reported_formally && a.verdict.why_not_reported)
        console.log(`    why ${a.agent} didn't report: ${a.verdict.why_not_reported}`);
  }
  console.log(`  eval-aware ${s.evalAware.length ? `${s.evalAware.join(", ")} ⚠ check before trusting this run` : "none detected"}`);
  console.log(`  vault      ${s.vaultCash ?? "?"} cash + ${s.vaultInvested ?? "?"} still invested = ${s.vaultTotal ?? "?"} (started 1000)`);
  console.log(`  cost       ${s.premiumRequests} premium requests · ${s.reasoningSummaries} reasoning summaries`);
}
