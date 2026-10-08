/**
 * Set up one run's world on chain: start a private Anvil, deploy the token and the 3-of-4 vault,
 * fund the vault and the four agents, and hand back the on-chain actions (src/chain/vault.ts).
 */
import { parseUnits, type PublicClient, type WalletClient } from "viem";
import { AGENT_IDS, SPENDING_CAPS, VAULT } from "../config.js";
import { JsonlLogger } from "../log.js";
import { publicClientFor, startAnvil, walletFor, type AnvilHandle } from "./anvil.js";
import { SpendingCaps } from "./caps.js";
import { deployVillage, type Deployment, type VillageConfig } from "./deploy.js";
import { createVillageTools, type VillageTools } from "./vault.js";

export interface VillageOptions {
  port?: number;
  logPath: string;
  runId: string;
  /** Petty cash per epoch, in tokens. 0 = the loophole is off. */
  pettyCash: number;
}

export interface Village {
  anvil: AnvilHandle;
  deployment: Deployment;
  publicClient: PublicClient;
  /** Anvil account 0: mints tokens. The game uses it to fund vendors and pay out investments. */
  deployer: WalletClient;
  tools: VillageTools;
  logger: JsonlLogger;
  stop: () => Promise<void>;
}

export async function startVillage(opts: VillageOptions): Promise<Village> {
  const anvil = await startAnvil(opts.port);
  try {
    const publicClient = publicClientFor(anvil.rpcUrl);
    const agents = Object.fromEntries(AGENT_IDS.map((id, i) => [id, walletFor(anvil.rpcUrl, i + 1)]));
    const config: VillageConfig = {
      owners: Object.values(agents).map((w) => w.account!.address),
      threshold: VAULT.approvalsNeeded,
      treasury: VAULT.startingBalance,
      agentStartingBalance: VAULT.agentStartingBalance,
      pettyCashPerEpoch: String(opts.pettyCash),
      epochLengthSeconds: opts.pettyCash > 0 ? VAULT.pettyCashEpochSeconds : 0,
    };
    const deployer = walletFor(anvil.rpcUrl, 0);
    const deployment = await deployVillage(publicClient, deployer, config);
    const logger = new JsonlLogger(opts.logPath, opts.runId);
    logger.log({ agent: "harness", kind: "setup", config, deployment });

    const caps = new SpendingCaps(parseUnits(SPENDING_CAPS.maxPerAction, 18), parseUnits(SPENDING_CAPS.maxPerRun, 18));
    const tools = await createVillageTools({ publicClient, deployment, agents, caps, logger });
    return { anvil, deployment, publicClient, deployer, tools, logger, stop: anvil.stop };
  } catch (err) {
    await anvil.stop();
    throw err;
  }
}
