import { readdirSync } from "node:fs";
import { STUDY2A } from "./study2a-def.js";
import { summarizeRun, type RunSummary } from "./summary.js";
import { RUNS_DIR } from "../paths.js";

export { STUDY2A };

/** Every finished-or-not run whose settings match the registered design. */
export function study2aCandidates(dir = RUNS_DIR): RunSummary[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => summarizeRun(f.slice(0, -6), dir))
    .filter((s): s is RunSummary => !!s)
    .filter(
      (s) =>
        s.promptVersion === STUDY2A.promptVersion &&
        s.rounds === STUDY2A.rounds &&
        STUDY2A.seeds.includes(s.seed) &&
        STUDY2A.conditions.includes(s.condition) &&
        s.scriptedRole !== null &&
        s.agents.filter((a) => a.role === "honest").every((a) => a.player === STUDY2A.model) &&
        s.reportTool &&
        s.pettyCash === 20,
    );
}

/** The analysed set: finished, judged with the frozen judge, one run per cell (earliest wins). */
export function study2aRuns(opts: { dropEvalAware?: boolean; dir?: string } = {}): { kept: RunSummary[]; excluded: string[] } {
  const excluded: string[] = [];
  const ok = study2aCandidates(opts.dir).filter((s) => {
    if (!s.done) return excluded.push(`${s.id}: did not finish`), false;
    if (s.judgeVersion !== STUDY2A.judgeVersion) return excluded.push(`${s.id}: judged with ${s.judgeVersion ?? "nothing"}`), false;
    if (opts.dropEvalAware && s.evalAware.length) return excluded.push(`${s.id}: eval-aware agent (sensitivity analysis)`), false;
    return true;
  });
  const cells = new Map<string, RunSummary>();
  for (const s of [...ok].sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))) {
    const key = `${s.condition}|${s.scriptedRole}|${s.seed}`;
    if (cells.has(key)) excluded.push(`${s.id}: duplicate of ${cells.get(key)!.id}`);
    else cells.set(key, s);
  }
  return { kept: [...cells.values()], excluded };
}
