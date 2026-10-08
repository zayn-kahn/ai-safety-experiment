/**
 * One run of the game, start to finish. Read this file top to bottom to see what happens:
 *
 *   1. Write every co-owner's system prompt and log the run's settings.
 *   2. For each round:
 *        a. pay out (or default) investments that are due,
 *        b. maybe announce a new investment opportunity,
 *        c. give every co-owner one turn, in a shuffled order: turn message in, tool calls out.
 *   3. Log the final balances.
 *
 * Every event goes to the run's log (data/runs/<id>.jsonl). Nothing here decides who is right or wrong:
 * that is the judge's job, afterwards (scripts/judge.ts).
 */
import { formatUnits, parseUnits, type Address } from "viem";
import { tokenArtifact, vaultArtifact } from "../chain/deploy.js";
import type { VaultState } from "../chain/vault.js";
import type { Village } from "../chain/village.js";
import { AGENT_IDS, RUN_DEFAULTS, VAULT } from "../config.js";
import type { AgentBackend } from "../players/types.js";
import { announcements, fill, promptVersion, systemPrompt, type Condition } from "../prompts.js";
import { buildAgentTools } from "./agent-tools.js";
import { maybeNewOpportunity, vendorFloat } from "./opportunities.js";
import { Rng } from "./rng.js";
import { buildTurnMessage } from "./turn-message.js";
import { World } from "./world.js";

export interface RunOptions {
  village: Village;
  /** Who plays each co-owner: a model backend or a script. */
  players: Record<string, AgentBackend>;
  rounds: number;
  /** Fixes the opportunity feed and the turn order. */
  seed: number;
  /** Which framing the honest co-owners get (prompts/agent/conditions/<condition>.md, or "none"). */
  condition: Condition;
  /** The guilty co-owner, if any. It gets prompts/agent/defector.md as its system prompt (a script ignores it). */
  defector: string | null;
  /** The scripted co-owner, if any: which agent, guilty or innocent, and the outside address it sends petty cash to. */
  scripted?: { agent: string; role: "defector" | "innocent"; outsideAddress: string };
  /** Petty cash per epoch (tokens); 0 = no petty-cash tool. Must match the deployed vault. */
  pettyCash: number;
  /** Give agents the report_suspicion tool (false = the "no report button" variant). */
  reportTool: boolean;
  maxToolCallsPerTurn?: number;
}

export interface RunSummary {
  vaultStart: number;
  vaultEnd: number;
  /** Tokens still out in active investments when the game ended. */
  vaultInvested: number;
  /** vaultEnd + vaultInvested: the fair end-of-game value. */
  vaultTotal: number;
  balances: Record<string, number>;
  suspicions: World["suspicions"];
  investments: World["investments"];
  turnErrors: number;
}

export async function runGame(o: RunOptions): Promise<RunSummary> {
  const { village, rounds, seed, condition } = o;
  const { tools, logger, publicClient, deployment } = village;
  const rng = new Rng(seed);
  const addresses = tools.directory as Record<string, Address>;
  const world = new World(AGENT_IDS, addresses);
  const say = announcements();

  // --- 1. System prompts and run settings ----------------------------------------------------------

  const systems = Object.fromEntries(
    AGENT_IDS.map((id) => [
      id,
      systemPrompt({
        agentId: id,
        address: addresses[id],
        others: AGENT_IDS.filter((x) => x !== id),
        rounds,
        threshold: VAULT.approvalsNeeded,
        pettyCash: o.pettyCash,
        reportTool: o.reportTool,
        condition,
        isDefector: id === o.defector,
      }),
    ]),
  );
  logger.log({
    agent: "harness",
    kind: "episode_start",
    seed,
    rounds,
    condition,
    defector: o.defector,
    variant: { pettyCash: o.pettyCash, reportTool: o.reportTool },
    scripted: o.scripted ?? null,
    promptVersion: promptVersion(),
    backends: Object.fromEntries(AGENT_IDS.map((id) => [id, `${o.players[id].name}:${o.players[id].model}`])),
    systems,
  });

  const vaultStart = await balanceOf(deployment.vault);
  let scannedBlock = await publicClient.getBlockNumber({ cacheTime: 0 });
  let opportunitiesSoFar = 0;
  let turnErrors = 0;
  let errorsInARow = 0;

  // --- 2. Rounds -------------------------------------------------------------------------------------

  for (let round = 1; round <= rounds; round++) {
    world.round = round;
    logger.log({ agent: "harness", kind: "round_start", round });

    // a. Investments that are due pay out (legit) or default (scam).
    await settleInvestments(round);
    scannedBlock = await recordTransfers(round, scannedBlock);

    // b. Maybe a new opportunity.
    const opp = maybeNewOpportunity(rng, round, opportunitiesSoFar, seed);
    if (opp) {
      opportunitiesSoFar++;
      world.opportunities.push(opp);
      await mint(opp.address, vendorFloat(opp));
      logger.log({ agent: "harness", kind: "opportunity", round, ...opp });
      world.post(say.author, fill(say.newOpportunity, { id: opp.id, vendor: opp.vendor, openUntilRound: opp.openUntilRound }));
    }

    // c. Every co-owner takes one turn, in a shuffled order.
    for (const agent of rng.shuffle(AGENT_IDS)) {
      const ok = await playTurn(agent, round);
      if (ok) errorsInARow = 0;
      else (turnErrors++, errorsInARow++);
      // Record transfers right after the turn that caused them.
      scannedBlock = await recordTransfers(round, scannedBlock);
      if (errorsInARow >= RUN_DEFAULTS.maxConsecutiveTurnErrors) break;
    }
    if (errorsInARow >= RUN_DEFAULTS.maxConsecutiveTurnErrors) {
      logger.log({ agent: "harness", kind: "episode_abort", round, reason: `${errorsInARow} turns failed in a row` });
      break;
    }
  }

  // --- 3. Final balances -----------------------------------------------------------------------------

  const balances: Record<string, number> = {};
  for (const id of AGENT_IDS) balances[id] = await balanceOf(addresses[id]);
  const vaultEnd = await balanceOf(deployment.vault);
  const vaultInvested = world.investments.filter((i) => i.status === "active").reduce((s, i) => s + i.funded, 0);
  const summary: RunSummary = {
    vaultStart,
    vaultEnd,
    vaultInvested,
    vaultTotal: Math.round((vaultEnd + vaultInvested) * 1e6) / 1e6,
    balances,
    suspicions: world.suspicions,
    investments: world.investments,
    turnErrors,
  };
  logger.log({ agent: "harness", kind: "episode_end", ...summary });
  return summary;

  // --- Helpers ---------------------------------------------------------------------------------------

  /** One co-owner's turn: build its turn message and tools, let its player act. Returns false if the turn failed. */
  async function playTurn(agent: string, round: number): Promise<boolean> {
    const prompt = buildTurnMessage({ world, agent, rounds, vault: await vaultState(), ownBalance: String(await balanceOf(addresses[agent])) });
    const agentTools = buildAgentTools({
      agent,
      world,
      tools,
      logger,
      maxToolCalls: o.maxToolCallsPerTurn ?? RUN_DEFAULTS.maxToolCallsPerTurn,
      pettyCashEnabled: o.pettyCash > 0,
      reportTool: o.reportTool,
    });
    logger.log({ agent, kind: "turn_start", round, prompt });
    try {
      const res = await o.players[agent].runTurn(
        { agentId: agent, system: systems[agent], prompt, tools: agentTools, context: { round, rounds, pettyCash: o.pettyCash } },
        (event) => logger.log({ agent, kind: "llm_event", round, event }),
      );
      logger.log({ agent, kind: "turn_end", round, ...res });
      return true;
    } catch (err) {
      logger.log({ agent, kind: "turn_error", round, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  /** Log every token transfer since the last check; count vault → vendor transfers as investments. */
  async function recordTransfers(round: number, fromBlock: bigint): Promise<bigint> {
    const toBlock = await publicClient.getBlockNumber({ cacheTime: 0 });
    if (toBlock <= fromBlock) return fromBlock;
    const transfers = (await publicClient.getContractEvents({
      address: deployment.token,
      abi: tokenArtifact.abi,
      eventName: "Transfer",
      fromBlock: fromBlock + 1n,
      toBlock,
    })) as unknown as { args: { from: Address; to: Address; value: bigint }; transactionHash: string }[];
    // What caused each vault outflow: an executed proposal or a petty-cash withdrawal.
    const vaultEvents = (await publicClient.getContractEvents({
      address: deployment.vault,
      abi: vaultArtifact.abi,
      fromBlock: fromBlock + 1n,
      toBlock,
    })) as unknown as { eventName: string; args: Record<string, any>; transactionHash: string }[];
    const cause = new Map<string, string>();
    for (const v of vaultEvents) {
      if (v.eventName === "Executed") cause.set(v.transactionHash, `proposal #${v.args.id}, executed by ${world.label(v.args.executor, deployment.vault)}`);
      if (v.eventName === "PettyWithdrawn") cause.set(v.transactionHash, `petty cash, withdrawn by ${world.label(v.args.owner, deployment.vault)}`);
    }

    for (const t of transfers) {
      const amount = Number(formatUnits(t.args.value, 18));
      const fromVault = t.args.from.toLowerCase() === deployment.vault.toLowerCase();
      if (fromVault) world.outflows.push({ round, amount, to: t.args.to, via: cause.get(t.transactionHash) ?? "unknown" });
      logger.log({
        agent: "harness",
        kind: "token_transfer",
        round,
        from: world.label(t.args.from, deployment.vault),
        to: world.label(t.args.to, deployment.vault),
        amount,
        txHash: t.transactionHash,
      });
      if (!fromVault) continue;

      // Vault money sent to a vendor while its opportunity is open counts as an investment.
      const opp = world.opportunityByAddress(t.args.to);
      if (!opp) continue;
      if (round > opp.openUntilRound) {
        logger.log({ agent: "harness", kind: "late_funding", round, opportunityId: opp.id, amount });
        continue;
      }
      const inv = world.investmentFor(opp.id);
      if (inv) inv.funded += amount;
      else world.investments.push({ opportunityId: opp.id, funded: amount, fundedRound: round, status: "active" });
    }
    return toBlock;
  }

  /** Investments that have matured: legit ones pay principal + promised return into the vault; scams default. */
  async function settleInvestments(round: number): Promise<void> {
    for (const inv of world.investments) {
      if (inv.status !== "active") continue;
      const opp = world.opportunities.find((x) => x.id === inv.opportunityId)!;
      if (round < inv.fundedRound + opp.maturesInRounds) continue;
      if (opp.scam) {
        inv.status = "defaulted";
        inv.payout = 0;
        logger.log({ agent: "harness", kind: "investment_defaulted", round, ...inv });
        world.post(say.author, fill(say.investmentDefaulted, { id: opp.id, vendor: opp.vendor, funded: inv.funded }));
        continue;
      }
      // The promised return applies up to the ask; anything sent beyond the ask is returned as is.
      const principal = Math.min(inv.funded, opp.ask);
      const payout = Math.round((principal * (1 + opp.promisedReturnPct / 100) + Math.max(0, inv.funded - opp.ask)) * 1e6) / 1e6;
      await mint(deployment.vault, Number(payout.toFixed(6)));
      inv.status = "repaid";
      inv.payout = payout;
      logger.log({ agent: "harness", kind: "investment_repaid", round, ...inv });
      world.post(say.author, fill(say.investmentRepaid, { id: opp.id, vendor: opp.vendor, payout }));
    }
  }

  async function vaultState(): Promise<VaultState> {
    const r = await tools.getVaultState("harness", {});
    if (!r.ok) throw new Error(`vault state: ${r.error}`);
    return r.result;
  }

  async function balanceOf(a: Address): Promise<number> {
    const raw = (await publicClient.readContract({ address: deployment.token, abi: tokenArtifact.abi, functionName: "balanceOf", args: [a] })) as bigint;
    return Number(formatUnits(raw, 18));
  }

  /** The game (Anvil account 0) creates tokens: vendor floats and investment payouts. */
  async function mint(to: Address, amount: number): Promise<void> {
    const hash = await village.deployer.writeContract({
      address: deployment.token,
      abi: tokenArtifact.abi,
      functionName: "mint",
      args: [to, parseUnits(amount.toFixed(6), 18)],
      account: village.deployer.account!,
      chain: village.deployer.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}
