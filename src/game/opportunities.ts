/**
 * The investment feed. Most rounds a vendor asks the vault for money. Legit vendors repay with a modest return;
 * scams promise a lot and never repay. Agents never see which is which (only the pitch and the numbers).
 * Vendor names and pitches: prompts/game/vendors.json. Numbers: OPPORTUNITIES in src/config.ts.
 */
import { getAddress, keccak256, toHex, type Address } from "viem";
import { OPPORTUNITIES } from "../config.js";
import { vendors } from "../prompts.js";
import type { Rng } from "./rng.js";

export interface Opportunity {
  id: string;
  vendor: string;
  address: Address;
  /** Whole tokens requested. */
  ask: number;
  /** Promised return, percent. */
  promisedReturnPct: number;
  /** Rounds after funding until payout. */
  maturesInRounds: number;
  /** Last round in which funding counts. */
  openUntilRound: number;
  pitch: string;
  /** Hidden from agents. */
  scam: boolean;
}

/** What agents are shown. */
export type PublicOpportunity = Omit<Opportunity, "scam">;

/** Roll for this round's opportunity (or none). Same seed, same feed. */
export function maybeNewOpportunity(rng: Rng, round: number, seq: number, seed: number): Opportunity | null {
  if (rng.next() >= OPPORTUNITIES.chancePerRound) return null;
  const scam = rng.next() < OPPORTUNITIES.scamRate;
  const kind = scam ? OPPORTUNITIES.scam : OPPORTUNITIES.legit;
  const { vendor, pitch } = rng.pick(scam ? vendors().scam : vendors().legit);
  const id = `opp-${seq}`;
  const between = ([lo, hi]: readonly [number, number]) => rng.int(lo, hi);
  return {
    id,
    vendor,
    address: getAddress(`0x${keccak256(toHex(`vault-village:${seed}:${id}`)).slice(26)}`),
    ask: between(OPPORTUNITIES.askTens) * 10,
    promisedReturnPct: between(kind.returnPct),
    maturesInRounds: between(kind.maturesInRounds),
    openUntilRound: round + OPPORTUNITIES.openRounds - 1,
    pitch,
    scam,
  };
}

/** Tokens pre-minted to a vendor's wallet, so an empty wallet never gives a scam away. */
export function vendorFloat(opp: Opportunity): number {
  return OPPORTUNITIES.vendorFloatBase + (parseInt(opp.address.slice(-4), 16) % OPPORTUNITIES.vendorFloatSpread);
}

export function toPublic({ scam: _scam, ...rest }: Opportunity): PublicOpportunity {
  return rest;
}
