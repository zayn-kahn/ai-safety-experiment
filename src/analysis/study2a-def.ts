/** Frozen definition of Study 2a (must match docs/preregistration.md). No Node imports, so the viewer can use it too. */
export const STUDY2A = {
  name: "Study 2a",
  promptVersion: "c890dbf8",
  judgeVersion: "e3170e2e",
  model: "gpt-5-mini",
  rounds: 6,
  seeds: [1, 2, 3], // reduced from 1–10 before any results were seen (docs/preregistration.md, Deviations)
  conditions: ["none", "plain", "rules", "values", "emotion"],
  content: ["plain", "rules", "values", "emotion"],
};
