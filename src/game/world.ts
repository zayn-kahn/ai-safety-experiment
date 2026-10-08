/**
 * Everything in a run that is not on chain: the round number, group chat, private notes, suspicion reports,
 * opportunities, investments, and a list of every transfer out of the vault.
 */
import type { Address } from "viem";
import { TURN_MESSAGE } from "../config.js";
import { toPublic, type Opportunity, type PublicOpportunity } from "./opportunities.js";

export interface ChatMessage {
  seq: number;
  round: number;
  from: string;
  text: string;
}

export interface Note {
  round: number;
  text: string;
}

export interface Suspicion {
  round: number;
  from: string;
  suspect: string;
  confidence: number;
  reason: string;
}

export interface Outflow {
  round: number;
  amount: number;
  to: Address;
  /** e.g. "proposal #2, executed by agent-1" or "petty cash, withdrawn by agent-0". */
  via: string;
}

export interface Investment {
  opportunityId: string;
  /** Whole tokens received by the vendor inside the funding window. */
  funded: number;
  fundedRound: number;
  status: "active" | "repaid" | "defaulted";
  payout?: number;
}

/** Off-chain episode state: chat, notes, suspicions, opportunities, investments. */
export class World {
  round = 0;
  readonly chat: ChatMessage[] = [];
  readonly notes = new Map<string, Note[]>();
  readonly suspicions: Suspicion[] = [];
  readonly opportunities: Opportunity[] = [];
  readonly investments: Investment[] = [];
  readonly outflows: Outflow[] = [];
  private lastSeenChat = new Map<string, number>();

  constructor(
    readonly agentIds: readonly string[],
    readonly addresses: Record<string, Address>,
  ) {}

  post(from: string, text: string): ChatMessage {
    const msg = { seq: this.chat.length, round: this.round, from, text };
    this.chat.push(msg);
    return msg;
  }

  /** Chat messages the agent hasn't been shown yet (capped), and mark them seen. */
  unseenChat(agent: string, max = TURN_MESSAGE.maxChatMessages): ChatMessage[] {
    const from = this.lastSeenChat.get(agent) ?? 0;
    this.lastSeenChat.set(agent, this.chat.length);
    return this.chat.slice(Math.max(from, this.chat.length - max));
  }

  addNote(agent: string, text: string): void {
    const list = this.notes.get(agent) ?? [];
    list.push({ round: this.round, text });
    this.notes.set(agent, list);
  }

  recentNotes(agent: string, n = TURN_MESSAGE.recentNotes): Note[] {
    return (this.notes.get(agent) ?? []).slice(-n);
  }

  openOpportunities(): Opportunity[] {
    return this.opportunities.filter((o) => this.round <= o.openUntilRound);
  }

  opportunityByAddress(address: string): Opportunity | undefined {
    return this.opportunities.find((o) => o.address.toLowerCase() === address.toLowerCase());
  }

  investmentFor(opportunityId: string): Investment | undefined {
    return this.investments.find((i) => i.opportunityId === opportunityId);
  }

  /** Agent-facing view of opportunities: open ones plus the portfolio. Never reveals `scam`. */
  opportunitiesView(): {
    open: (PublicOpportunity & { fundedSoFar: number })[];
    portfolio: (Investment & { vendor: string })[];
  } {
    return {
      open: this.openOpportunities().map((o) => ({ ...toPublic(o), fundedSoFar: this.investmentFor(o.id)?.funded ?? 0 })),
      portfolio: this.investments.map((i) => ({
        ...i,
        vendor: this.opportunities.find((o) => o.id === i.opportunityId)!.vendor,
      })),
    };
  }

  /** Transfers out of the vault in this round and the previous one. */
  recentOutflows(): Outflow[] {
    return this.outflows.filter((o) => o.round >= this.round - 1);
  }

  /** Name for an address: agent id, opportunity vendor, "vault", or the raw address. */
  label(address: string, vault: Address): string {
    if (address.toLowerCase() === vault.toLowerCase()) return "vault";
    const agent = this.agentIds.find((id) => this.addresses[id].toLowerCase() === address.toLowerCase());
    if (agent) return agent;
    const opp = this.opportunityByAddress(address);
    return opp ? `${opp.id} (${opp.vendor})` : address;
  }
}
