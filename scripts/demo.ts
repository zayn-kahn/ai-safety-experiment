/**
 * Day 1–2 milestone: spin up the village, move treasury funds through a 3-of-4 vote,
 * and show the balances + JSONL log. Run with `pnpm demo`.
 */
import { startVillage } from "../src/chain/village.js";
import type { ToolResult } from "../src/chain/vault.js";
import { RUNS_DIR } from "../src/paths.js";

const runId = `demo-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const logPath = `${RUNS_DIR}/${runId}.jsonl`;

function must<T>(label: string, r: ToolResult<T>): T {
  if (!r.ok) throw new Error(`${label} failed: ${r.error}`);
  console.log(`  ✓ ${label}${r.txHash ? `  (tx ${r.txHash.slice(0, 10)}…)` : ""}`);
  return r.result;
}

const village = await startVillage({ logPath, runId, pettyCash: 0 });
try {
  const { tools } = village;
  const recipient = tools.directory["agent-3"];
  const vaultBalance = async () => must("read vault", await tools.getVaultState("agent-0", {})).balance;
  const recipientBalance = async () => must("read agent-3", await tools.getBalance("agent-3", {})).balance;

  console.log(`\nVault ${village.deployment.vault}  token ${village.deployment.token}`);
  const before = { vault: await vaultBalance(), agent3: await recipientBalance() };

  console.log("\nProposal: send 100 VLG from the vault to agent-3");
  const { proposalId } = must(
    "agent-0 proposes (auto-approves)",
    await tools.propose("agent-0", { to: recipient, amount: "100", description: "Seed agent-3's trading budget" }),
  );
  must("agent-1 votes", await tools.vote("agent-1", { proposalId }));

  const early = await tools.execute("agent-0", { proposalId });
  console.log(`  ✗ execute with 2/4 votes rejected as expected: ${early.ok ? "UNEXPECTEDLY SUCCEEDED" : early.error}`);
  if (early.ok) throw new Error("threshold not enforced");

  must("agent-2 votes (3/4)", await tools.vote("agent-2", { proposalId }));
  must("agent-3 executes", await tools.execute("agent-3", { proposalId }));

  const after = { vault: await vaultBalance(), agent3: await recipientBalance() };
  console.log("\n            before    after");
  console.log(`  vault     ${before.vault.padEnd(9)} ${after.vault}`);
  console.log(`  agent-3   ${before.agent3.padEnd(9)} ${after.agent3}`);

  if (after.vault !== "900" || after.agent3 !== "110") throw new Error("unexpected balances");
  console.log(`\nOK — transfer verified. Log: ${logPath}\n`);
} finally {
  await village.stop();
}
