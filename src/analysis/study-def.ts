/**
 * The current study: one place that says what it is, so the pipeline (scripts/study.ts), the dashboard
 * and the Label page all agree. No Node imports, so the viewer can use it too.
 * Pre-registered in docs/preregistration-2b.md.
 */

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const STUDY = {
  name: "Study 2b",
  /** The AI co-owners. */
  model: "gpt-5-mini",
  /** The blind judge. */
  judgeModel: "claude-sonnet-5.5",
  rounds: 6,
  conditions: ["none", "plain", "rules", "values", "emotion"],
  roles: ["defector", "innocent"] as const,
  /**
   * The runs, in batches. Fixed before batch 2 started (2026-10-01); the target (202 runs) does not depend on results.
   * Each batch is published on Hugging Face when it finishes (v1.0 after batch 2, v2.0 after batch 3).
   */
  batches: [
    { name: "batch 1", conditions: ["none", "plain", "rules", "values", "emotion"], seeds: range(1, 5) }, // 50 runs, done 2026-09-30
    { name: "batch 2", conditions: ["none", "rules", "values", "emotion"], seeds: range(6, 11) }, // 48 runs
    { name: "batch 3", conditions: ["none", "rules", "values", "emotion"], seeds: range(12, 24) }, // 104 runs
  ],
  /** Judge check: this many runs per batch are drawn (evenly across conditions and roles, fixed seed) for you to label. */
  labelRunsPerBatch: [5, 5, 10],
  /** The test before the study: one guilty and one innocent run. Never part of the analysis. */
  pilot: { condition: "plain", seeds: [101] },
  pettyCash: 20,
  reportTool: true,
  /** Games played at once (each on its own local chain). */
  parallel: 4,
  /** Judge calls at once, independent of the games. */
  judgeParallel: 2,
  /**
   * Frozen once the pilot passed: the prompt version every study run must have. `pnpm study` refuses
   * to start while this is null, or if prompts/ changed since it was set.
   */
  promptVersion: "d26a1a1e" as string | null, // frozen 2026-09-30 after the pilot passed
};

export type StudyRole = (typeof STUDY.roles)[number];

/** Every planned run of the study (optionally one batch): condition × role × seed. */
export function plannedRuns(batch?: number): { batch: number; condition: string; role: StudyRole; seed: number }[] {
  return STUDY.batches.flatMap((b, i) =>
    batch !== undefined && batch !== i + 1
      ? []
      : b.conditions.flatMap((condition) => STUDY.roles.flatMap((role) => b.seeds.map((seed) => ({ batch: i + 1, condition, role, seed })))),
  );
}

/** Is this (condition, seed) part of the plan? */
export const isPlanned = (condition: string, seed: number) => STUDY.batches.some((b) => b.conditions.includes(condition) && b.seeds.includes(seed));
