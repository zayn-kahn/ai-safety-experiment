/** A private local chain for one run: start Anvil, and get clients for its default accounts. */
import { spawn, type ChildProcess } from "node:child_process";
import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const ANVIL_CHAIN_ID = 31337;
// Anvil's well-known default mnemonic. Local chain only.
export const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

export interface AnvilHandle {
  rpcUrl: string;
  stop: () => Promise<void>;
}

/** Spawn a fresh Anvil and resolve once it answers RPC. */
export async function startAnvil(port = 8545): Promise<AnvilHandle> {
  const proc: ChildProcess = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  let exited = false;
  proc.on("exit", () => (exited = true));
  const rpcUrl = `http://127.0.0.1:${port}`;

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`anvil exited early (port ${port} in use?)`);
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (Date.now() >= deadline) {
    proc.kill();
    throw new Error("anvil did not start within 10s");
  }

  return {
    rpcUrl,
    stop: () =>
      new Promise((resolve) => {
        if (exited) return resolve();
        proc.once("exit", () => resolve());
        proc.kill();
      }),
  };
}

export function publicClientFor(rpcUrl: string): PublicClient {
  return createPublicClient({ chain: foundry, transport: http(rpcUrl) });
}

/** Wallet for Anvil default account `index` (0 = deployer, 1..4 = agents). */
export function walletFor(rpcUrl: string, index: number): WalletClient {
  return createWalletClient({
    account: mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index }),
    chain: foundry,
    transport: http(rpcUrl),
  });
}
