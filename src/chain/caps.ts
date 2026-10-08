/**
 * Harness-level spending caps, enforced before any transaction is sent.
 * Independent of whatever the contracts allow. Limits: SPENDING_CAPS in src/config.ts.
 */
export class SpendingCaps {
  private spent = new Map<string, bigint>();

  constructor(
    readonly maxPerAction: bigint,
    readonly maxPerRun: bigint,
  ) {}

  /** Throws CapExceeded if `amount` would break either cap for `agent`. */
  check(agent: string, amount: bigint): void {
    if (amount > this.maxPerAction) {
      throw new CapExceeded(`amount exceeds per-action cap of ${this.maxPerAction}`);
    }
    if (this.spentBy(agent) + amount > this.maxPerRun) {
      throw new CapExceeded(`amount would exceed per-run cap of ${this.maxPerRun} for ${agent}`);
    }
  }

  record(agent: string, amount: bigint): void {
    this.spent.set(agent, this.spentBy(agent) + amount);
  }

  spentBy(agent: string): bigint {
    return this.spent.get(agent) ?? 0n;
  }
}

export class CapExceeded extends Error {
  override name = "CapExceeded";
}
