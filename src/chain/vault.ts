/**
 * The on-chain actions an agent can take (read the vault, propose, vote, execute, petty cash, transfer).
 * Every action checks the spending caps first, never throws, and logs exactly one event.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  formatUnits,
  getAddress,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { ANVIL_CHAIN_ID } from "./anvil.js";
import { tokenArtifact, vaultArtifact, type Deployment } from "./deploy.js";
import { CapExceeded, type SpendingCaps } from "./caps.js";
import type { JsonlLogger } from "../log.js";

const DECIMALS = 18;
const tokenAbi = tokenArtifact.abi;
const vaultAbi = vaultArtifact.abi;

export type ToolResult<T = unknown> =
  | { ok: true; result: T; txHash?: Hash }
  | { ok: false; error: string; blocked?: boolean };

export interface ProposalView {
  id: number;
  proposer: Address;
  to: Address;
  amount: string;
  description: string;
  approvals: number;
  approvers: Address[];
  executed: boolean;
}

export interface VaultState {
  vault: Address;
  token: Address;
  balance: string;
  threshold: number;
  owners: Address[];
  directory: Record<string, Address>;
  proposals: ProposalView[];
}

interface RawProposal {
  proposer: Address;
  to: Address;
  amount: bigint;
  description: string;
  approvals: bigint;
  executed: boolean;
}

export interface ToolsOptions {
  publicClient: PublicClient;
  deployment: Deployment;
  /** agentId -> wallet. */
  agents: Record<string, WalletClient>;
  caps: SpendingCaps;
  logger: JsonlLogger;
}

/** Amounts in and out are whole-token decimal strings (e.g. "12.5"), never wei. */
export async function createVillageTools(opts: ToolsOptions) {
  const { publicClient, deployment, agents, caps, logger } = opts;
  const chainId = await publicClient.getChainId();
  if (chainId !== ANVIL_CHAIN_ID) throw new Error(`refusing to run on chainId ${chainId}; local Anvil only`);

  const directory = Object.fromEntries(Object.entries(agents).map(([id, w]) => [id, w.account!.address]));

  const wallet = (agent: string) => {
    const w = agents[agent];
    if (!w) throw new Error(`unknown agent ${agent}`);
    return w;
  };

  const readVault = <T>(functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address: deployment.vault, abi: vaultAbi, functionName, args }) as Promise<T>;

  /** Simulate (for a readable revert reason), send, and wait. Returns the receipt. */
  const send = async (agent: string, address: Address, abi: typeof vaultAbi, functionName: string, args: unknown[]) => {
    const w = wallet(agent);
    const { request } = await publicClient.simulateContract({ address, abi, functionName, args, account: w.account! });
    const hash = await w.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
    return receipt;
  };

  /** Uniform wrapper: never throws, logs exactly one event per call. */
  const tool = <A, R>(name: string, fn: (agent: string, args: A) => Promise<{ result: R; txHash?: Hash; block?: bigint }>) =>
    async (agent: string, args: A): Promise<ToolResult<R>> => {
      try {
        const { result, txHash, block } = await fn(agent, args);
        logger.log({ agent, kind: "tool", tool: name, args, status: "ok", result, txHash, block });
        return { ok: true, result, txHash };
      } catch (err) {
        const blocked = err instanceof CapExceeded;
        const error = describeError(err);
        logger.log({ agent, kind: "tool", tool: name, args, status: blocked ? "blocked" : "error", error });
        return { ok: false, error, ...(blocked ? { blocked } : {}) };
      }
    };

  const getProposal = async (id: number): Promise<ProposalView> => {
    const p = await readVault<RawProposal>("getProposal", [BigInt(id)]);
    const owners = await readVault<Address[]>("owners");
    const approved = await Promise.all(owners.map((o) => readVault<boolean>("hasApproved", [BigInt(id), o])));
    return {
      id,
      proposer: p.proposer,
      to: p.to,
      amount: formatUnits(p.amount, DECIMALS),
      description: p.description,
      approvals: Number(p.approvals),
      approvers: owners.filter((_, i) => approved[i]),
      executed: p.executed,
    };
  };

  return {
    directory,

    getBalance: tool("getBalance", async (agent, args: { address?: string }) => {
      const address = getAddress(args.address ?? wallet(agent).account!.address);
      const bal = (await publicClient.readContract({
        address: deployment.token,
        abi: tokenAbi,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      return { result: { address, balance: formatUnits(bal, DECIMALS) } };
    }),

    getVaultState: tool("getVaultState", async (_agent, _args: Record<string, never>) => {
      const [balance, threshold, owners, count] = await Promise.all([
        publicClient.readContract({
          address: deployment.token,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [deployment.vault],
        }) as Promise<bigint>,
        readVault<bigint>("threshold"),
        readVault<Address[]>("owners"),
        readVault<bigint>("proposalCount"),
      ]);
      const proposals = await Promise.all(Array.from({ length: Number(count) }, (_, i) => getProposal(i)));
      const state: VaultState = {
        vault: deployment.vault,
        token: deployment.token,
        balance: formatUnits(balance, DECIMALS),
        threshold: Number(threshold),
        owners,
        directory,
        proposals,
      };
      return { result: state };
    }),

    propose: tool("propose", async (agent, args: { to: string; amount: string; description: string }) => {
      const amount = parseUnits(args.amount, DECIMALS);
      caps.check(agent, amount);
      const receipt = await send(agent, deployment.vault, vaultAbi, "propose", [
        getAddress(args.to),
        amount,
        args.description,
      ]);
      const [ev] = parseEventLogs({ abi: vaultAbi, logs: receipt.logs, eventName: "Proposed" });
      const proposalId = Number((ev as unknown as { args: { id: bigint } }).args.id);
      return { result: { proposalId }, txHash: receipt.transactionHash, block: receipt.blockNumber };
    }),

    vote: tool("vote", async (agent, args: { proposalId: number }) => {
      const receipt = await send(agent, deployment.vault, vaultAbi, "approve", [BigInt(args.proposalId)]);
      const p = await getProposal(args.proposalId);
      return { result: { proposalId: p.id, approvals: p.approvals }, txHash: receipt.transactionHash, block: receipt.blockNumber };
    }),

    revokeVote: tool("revokeVote", async (agent, args: { proposalId: number }) => {
      const receipt = await send(agent, deployment.vault, vaultAbi, "revoke", [BigInt(args.proposalId)]);
      const p = await getProposal(args.proposalId);
      return { result: { proposalId: p.id, approvals: p.approvals }, txHash: receipt.transactionHash, block: receipt.blockNumber };
    }),

    execute: tool("execute", async (agent, args: { proposalId: number }) => {
      const raw = await readVault<RawProposal>("getProposal", [BigInt(args.proposalId)]);
      caps.check(agent, raw.amount);
      const receipt = await send(agent, deployment.vault, vaultAbi, "execute", [BigInt(args.proposalId)]);
      caps.record(agent, raw.amount);
      return {
        result: { proposalId: args.proposalId, to: raw.to, amount: formatUnits(raw.amount, DECIMALS) },
        txHash: receipt.transactionHash,
        block: receipt.blockNumber,
      };
    }),

    pettyWithdraw: tool("pettyWithdraw", async (agent, args: { to: string; amount: string }) => {
      const amount = parseUnits(args.amount, DECIMALS);
      caps.check(agent, amount);
      const receipt = await send(agent, deployment.vault, vaultAbi, "pettyWithdraw", [getAddress(args.to), amount]);
      caps.record(agent, amount);
      return { result: { to: args.to, amount: args.amount }, txHash: receipt.transactionHash, block: receipt.blockNumber };
    }),

    transfer: tool("transfer", async (agent, args: { to: string; amount: string }) => {
      const amount = parseUnits(args.amount, DECIMALS);
      caps.check(agent, amount);
      const receipt = await send(agent, deployment.token, tokenAbi, "transfer", [getAddress(args.to), amount]);
      caps.record(agent, amount);
      return { result: { to: args.to, amount: args.amount }, txHash: receipt.transactionHash, block: receipt.blockNumber };
    }),
  };
}

export type VillageTools = Awaited<ReturnType<typeof createVillageTools>>;

function describeError(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.reason) return `reverted: ${revert.reason}`;
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}
