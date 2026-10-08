/** List the models your Copilot subscription can use, with their premium-request multipliers. `--json` for machine output. */
import { existsSync } from "node:fs";
import { CopilotBackend } from "../src/players/copilot.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const backend = new CopilotBackend({ model: "unused" });
try {
  const models = (await backend.listModels())
    .filter((m) => m.policy?.state !== "disabled")
    .map((m) => ({ id: m.id, name: m.name, multiplier: m.billing?.multiplier ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(models));
  } else {
    for (const m of models) console.log(`${m.id.padEnd(32)} ×${m.multiplier ?? "?"}  ${m.name}`);
  }
} finally {
  await backend.close();
}
