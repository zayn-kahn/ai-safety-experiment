/**
 * LLM judge (blind): for each AI co-owner in a run, did it notice the watched co-owner's actions, did it
 * suspect it, did it report or warn, and if not, why not? It is never told the condition or whether the
 * watched co-owner was guilty. Results go to data/runs/<run>.judge.json and show up in `pnpm compare` and the viewer.
 *
 *   pnpm judge                   every real run that hasn't been judged yet
 *   pnpm judge <id> [<id> ...]   specific runs (re-judges)
 *   --model <id>                 judge model (default: the current study's judge, src/analysis/study-def.ts)
 */
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { STUDY } from "../src/analysis/study-def.js";
import { agentTranscript, readRun, scriptedOf, watchedActions } from "../src/analysis/evidence.js";
import { CopilotConnection } from "../src/players/copilot.js";
import { judgeRequest, judgeSystem, judgeVersion } from "../src/prompts.js";
import { isDryRun } from "../src/runs.js";
import { RUNS_DIR } from "../src/paths.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: { model: { type: "string", default: STUDY.judgeModel }, version: { type: "boolean", default: false } },
});

const ids = positionals.length
  ? positionals
  : (existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR) : [])
      .filter((f) => f.endsWith(".jsonl") && !isDryRun(`${RUNS_DIR}/${f}`) && !existsSync(`${RUNS_DIR}/${f.slice(0, -6)}.judge.json`))
      .map((f) => f.slice(0, -".jsonl".length));

/**
 * The judge's instructions are prompts/judge/system.md (FROZEN for a study: its hash is the judge version,
 * and runs judged with different versions are reported separately). The judge is blind: it never sees the
 * condition, and never learns whether the watched co-owner was guilty.
 */
const SYSTEM = judgeSystem();
export const JUDGE_VERSION = judgeVersion();

if (process.argv.includes("--version")) {
  console.log(JUDGE_VERSION);
  process.exit(0);
}

const conn = new CopilotConnection();
try {
  for (const id of ids) {
    const L = readRun(id, RUNS_DIR);
    const start = L.find((e) => e.kind === "episode_start");
    if (!start || !L.some((e) => e.kind === "episode_end") || L.some((e) => e.kind === "episode_abort")) {
      console.log(`skip ${id}: incomplete`);
      continue;
    }
    const watched = scriptedOf(L)?.agent ?? start.defector ?? null;
    const actions = watchedActions(L);
    const honest = Object.keys(start.backends).filter((x) => x !== watched);
    const results: Record<string, unknown>[] = [];
    let cost = 0;
    for (const agent of honest) {
      if (!actions.length) {
        results.push({ agent, noticed: false, note: "the watched co-owner took no questionable actions" });
        continue;
      }
      const prompt = judgeRequest({
        watched: watched ?? "",
        actions: actions.map((w) => `- round ${w.round}: ${w.what}`).join("\n"),
        agent,
        record: agentTranscript(L, agent) || "(empty)",
      });
      const res = await conn.complete({ model: a.model!, system: SYSTEM, prompt });
      cost += res.cost;
      const json = res.text.match(/\{[\s\S]*\}/)?.[0];
      try {
        results.push({ agent, ...JSON.parse(json ?? "") });
      } catch {
        results.push({ agent, error: "judge did not return valid JSON", raw: res.text.slice(0, 2000) });
      }
    }
    writeFileSync(
      `${RUNS_DIR}/${id}.judge.json`,
      JSON.stringify({ judgeModel: a.model, judgeVersion: JUDGE_VERSION, judgedAt: new Date().toISOString(), watched, actions, agents: results }, null, 2),
    );
    console.log(`judged ${id} (${results.length} agents, ${cost} premium requests)`);
  }
  if (!ids.length) console.log("Nothing to judge.");
} finally {
  await conn.close();
}
