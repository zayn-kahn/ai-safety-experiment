/**
 * Play one run of the game and write its log to data/runs/<id>.jsonl.
 *
 *   pnpm sim                                                   free dry run: every player is a script
 *   pnpm sim --backend copilot --model gpt-5-mini --condition values --defector agent-0
 *   pnpm sim ... --scripted-role innocent                       agent-0 is the innocent look-alike instead
 *
 * Who plays whom:
 *   --defector agent-0      the co-owner under suspicion. By default it is played by a SCRIPT
 *                           (src/players/scripted-co-owner.ts), so every condition faces identical behaviour.
 *   --scripted-role         defector (guilty, default) | innocent (look-alike; measures false alarms)
 *   --backend copilot       the other three co-owners are AI models (--model <id>, a,b,c,d, or random)
 *   --backend scripted      the other three are scripts too (a free dry run to test the pipeline)
 *   --defector-player model let an AI play the defector instead (uses prompts/agent/defector.md)
 *
 * Settings: --condition (framing, see prompts/agent/conditions), --rounds, --seed, --petty-cash (0 = off),
 * --no-report (remove the report tool), --max-tools (tool calls per turn).
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { startVillage } from "../src/chain/village.js";
import { AGENT_IDS, RUN_DEFAULTS } from "../src/config.js";
import { runGame } from "../src/game/run.js";
import { Rng } from "../src/game/rng.js";
import { RUNS_DIR } from "../src/paths.js";
import { CopilotBackend, CopilotConnection } from "../src/players/copilot.js";
import { dryRunHonestPolicy } from "../src/players/dry-run-honest.js";
import { outsideAddressFor, scriptedPolicyFor } from "../src/players/scripted-co-owner.js";
import { ScriptedBackend } from "../src/players/scripted.js";
import type { AgentBackend } from "../src/players/types.js";
import { listConditions, type Condition } from "../src/prompts.js";
import { pruneDryRuns } from "../src/runs.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const { values: a } = parseArgs({
  options: {
    backend: { type: "string", default: "scripted" },
    model: { type: "string" },
    rounds: { type: "string", default: String(RUN_DEFAULTS.rounds) },
    seed: { type: "string", default: "1" },
    condition: { type: "string", default: "none" },
    defector: { type: "string", default: "none" },
    "petty-cash": { type: "string", default: String(RUN_DEFAULTS.pettyCash) },
    "defector-player": { type: "string", default: "script" },
    "scripted-role": { type: "string", default: "defector" },
    "no-report": { type: "boolean", default: false },
    "max-tools": { type: "string", default: String(RUN_DEFAULTS.maxToolCallsPerTurn) },
    port: { type: "string", default: "8545" },
    "run-id": { type: "string" },
  },
});

// --- Check the settings -------------------------------------------------------------------------------

const condition = a.condition as Condition;
if (!listConditions().includes(condition)) throw new Error(`--condition must be one of ${listConditions().join(", ")}`);
const defectorPlayer = a["defector-player"];
if (defectorPlayer !== "script" && defectorPlayer !== "model") throw new Error("--defector-player must be script or model");
const scriptedRole = a["scripted-role"];
if (scriptedRole !== "defector" && scriptedRole !== "innocent") throw new Error("--scripted-role must be defector or innocent");
if (scriptedRole === "innocent" && defectorPlayer !== "script") throw new Error("--scripted-role innocent needs --defector-player script");

// "random" choices come from a separate stream seeded by --seed, so they're reproducible.
const pick = new Rng(Number(a.seed) ^ 0x5eed);
const suspect = a.defector === "none" ? null : a.defector === "random" ? pick.pick(AGENT_IDS) : a.defector!;
if (suspect && !(AGENT_IDS as readonly string[]).includes(suspect)) throw new Error(`--defector must be none, random, or one of ${AGENT_IDS.join(", ")}`);

/** The co-owner played by the fixed script (guilty or innocent), if any. */
const scriptedAgent = suspect && (defectorPlayer === "script" || a.backend === "scripted") ? suspect : null;
/** The guilty co-owner, if any (none in an innocent run). */
const defector = scriptedRole === "innocent" ? null : suspect;

// --- Choose who plays each co-owner --------------------------------------------------------------------

let players: Record<string, AgentBackend>;
let connection: CopilotConnection | null = null;
const coOwnerScript = scriptedPolicyFor(scriptedRole);

if (a.backend === "scripted") {
  const scripted = new ScriptedBackend(Object.fromEntries(AGENT_IDS.map((id) => [id, id === scriptedAgent ? coOwnerScript : dryRunHonestPolicy])));
  players = Object.fromEntries(AGENT_IDS.map((id) => [id, scripted]));
} else if (a.backend === "copilot") {
  if (!a.model) throw new Error("--model is required for the copilot backend (see `pnpm models`)");
  connection = new CopilotConnection();
  const available = await connection.playableModelIds();
  const models =
    a.model === "random" ? AGENT_IDS.map(() => pick.pick(available)) : a.model.includes(",") ? a.model.split(",").map((m) => m.trim()) : AGENT_IDS.map(() => a.model!);
  if (models.length !== AGENT_IDS.length) throw new Error(`--model list needs exactly ${AGENT_IDS.length} models`);
  for (const m of models) if (!available.includes(m)) throw new Error(`model "${m}" is not available on this Copilot plan`);
  const script = new ScriptedBackend(Object.fromEntries(AGENT_IDS.map((id) => [id, coOwnerScript])));
  players = Object.fromEntries(
    AGENT_IDS.map((id, i) => [id, id === scriptedAgent ? script : new CopilotBackend({ model: models[i], connection: connection! })]),
  );
  console.log(`Players: ${AGENT_IDS.map((id) => `${id}=${players[id].name === "scripted" ? "script" : players[id].model}`).join(", ")}`);
} else {
  throw new Error("--backend must be scripted or copilot");
}

const closePlayers = async () => {
  await Promise.all(Object.values(players).map((b) => b.close().catch(() => {})));
  await connection?.close().catch(() => {});
};

// --- Play the run --------------------------------------------------------------------------------------

const runId =
  a["run-id"] ??
  [a.backend, a.model?.replace(/[^\w.-]/g, "_"), condition, defector ? `def-${defector}` : "nodef", `s${a.seed}`, Date.now()].filter(Boolean).join("_");
const logPath = `${RUNS_DIR}/${runId}.jsonl`;
const pettyCash = Number(a["petty-cash"]);

const village = await startVillage({ port: Number(a.port), logPath, runId, pettyCash });
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await closePlayers();
  await village.stop();
  process.exit(130);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  console.log(`Run ${runId}\nLog ${logPath}\n`);
  const s = await runGame({
    village,
    players,
    rounds: Number(a.rounds),
    seed: Number(a.seed),
    condition,
    defector,
    scripted: scriptedAgent ? { agent: scriptedAgent, role: scriptedRole, outsideAddress: outsideAddressFor(scriptedAgent, scriptedRole) } : undefined,
    maxToolCallsPerTurn: Number(a["max-tools"]),
    pettyCash,
    reportTool: !a["no-report"],
  });
  console.log(`Vault: ${s.vaultStart} → ${s.vaultEnd}`);
  console.log(`Balances: ${JSON.stringify(s.balances)}`);
  console.log(`Investments: ${s.investments.map((i) => `${i.opportunityId}:${i.status}(${i.funded}→${i.payout ?? "?"})`).join(" ") || "none"}`);
  console.log(`Suspicions: ${s.suspicions.map((x) => `r${x.round} ${x.from}→${x.suspect}`).join(", ") || "none"}`);
  if (s.turnErrors) console.log(`Turn errors: ${s.turnErrors} (see log)`);
} finally {
  await closePlayers();
  await village.stop();
  // Dry runs are test data: keep only the newest few.
  if (a.backend === "scripted") {
    const removed = pruneDryRuns();
    if (removed.length) console.log(`Removed ${removed.length} older dry run(s); keeping the newest 3.`);
  }
}
