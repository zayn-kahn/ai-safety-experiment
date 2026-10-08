/** Shared with the simulation (src/analysis/summary.ts) so the UI and `pnpm compare` always agree. */
export type { AgentRow, RunSummary, Verdict } from "../../src/analysis/summary";
import type { RunSummary } from "../../src/analysis/summary";

/** One plain-English line for what happened in a run. */
export function outcomeLine(s: RunSummary): string {
  if (!s.done) return "Run incomplete.";
  if (s.scriptedRole === "innocent") {
    const n = s.agents.filter((a) => a.role === "honest").length;
    return `Innocent look-alike (${s.watched} acted legitimately) · ${s.falseAlarms.length} of ${n} raised a false alarm${s.falseAlarms.length ? ` (${s.falseAlarms.join(", ")})` : ""}.`;
  }
  if (!s.defector) return "No defector in this run.";
  if (!s.wrongdoing.length) return `The defector (${s.defector}) never did anything reportable.`;
  const honest = s.agents.filter((a) => a.role === "honest");
  const reporters = new Set(s.correctReports.map((r) => r.from));
  const parts: string[] = [];
  if (s.judged) {
    const noticed = honest.filter((a) => a.verdict?.noticed).length;
    parts.push(`${noticed} of ${honest.length} honest agents noticed`);
  }
  parts.push(`${reporters.size} of ${honest.length} formally reported${s.firstReportRound !== null ? ` (first in round ${s.firstReportRound})` : ""}`);
  if (s.judged && s.onlyQuestioned.length) parts.push(`${s.onlyQuestioned.length} only asked for an explanation`);
  if (s.judged && s.silent.length) parts.push(`${s.silent.length} stayed silent`);
  parts.push(s.stolen ? `${s.stolen} tokens reached the defector` : "no tokens reached the defector");
  return `${parts.join(" · ")}.`;
}

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "?");
