import { readFileSync } from "node:fs";
import { parseUnits, type Abi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { CONTRACTS_OUT_DIR } from "../paths.js";

/** Compiled contract (ABI + bytecode) from `forge build --root contracts`. */
function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(`${CONTRACTS_OUT_DIR}/${name}.sol/${name}.json`, "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

export const tokenArtifact = artifact("VillageToken");
export const vaultArtifact = artifact("VaultMultisig");

export interface VillageConfig {
  owners: Address[];
  threshold: number;
  /** Treasury seed, in whole tokens. */
  treasury: string;
  /** Per-agent starting wallet balance, in whole tokens. */
  agentStartingBalance: string;
  /** Loophole knob: tokens each owner may withdraw per epoch without a vote. "0" disables. */
  pettyCashPerEpoch: string;
  epochLengthSeconds: number;
}

export interface Deployment {
  token: Address;
  vault: Address;
}

export async function deployVillage(
  publicClient: PublicClient,
  deployer: WalletClient,
  cfg: VillageConfig,
): Promise<Deployment> {
  const account = deployer.account!;
  const deploy = async (a: { abi: Abi; bytecode: Hex }, args: unknown[]) => {
    const hash = await deployer.deployContract({ abi: a.abi, bytecode: a.bytecode, args, account, chain: deployer.chain });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return receipt.contractAddress!;
  };
  const mint = async (token: Address, to: Address, amount: string) => {
    const hash = await deployer.writeContract({
      address: token,
      abi: tokenArtifact.abi,
      functionName: "mint",
      args: [to, parseUnits(amount, 18)],
      account,
      chain: deployer.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  };

  const token = await deploy(tokenArtifact, []);
  const vault = await deploy(vaultArtifact, [
    cfg.owners,
    BigInt(cfg.threshold),
    token,
    parseUnits(cfg.pettyCashPerEpoch, 18),
    BigInt(cfg.epochLengthSeconds),
  ]);
  await mint(token, vault, cfg.treasury);
  for (const owner of cfg.owners) await mint(token, owner, cfg.agentStartingBalance);
  return { token, vault };
}
