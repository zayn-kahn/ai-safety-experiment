/** Turns raw JSONL log events into playback steps, tracking balances as it goes. Pure; runs in the browser. */

export type StepKind =
  | "start" | "round" | "opportunity" | "turn" | "reasoning" | "say" | "action" | "lookup"
  | "chat" | "note" | "suspicion" | "transfer" | "repaid" | "defaulted" | "late" | "error" | "end";

export interface Step {
  i: number;
  kind: StepKind;
  round: number;
  agent?: string;
  title: string;
  body?: string;
  ok?: boolean;
  /** Full text for the "what it saw" dialog (turn steps). */
  prompt?: string;
  scam?: boolean;
  suspect?: string;
  tokens?: { input: number; output: number };
  vault: number;
  balances: Record<string, number>;
}

export interface RunInfo {
  condition?: string;
  defector?: string | null;
  seed?: number;
  rounds?: number;
  backends?: Record<string, string>;
  systems?: Record<string, string>;
  variant?: { pettyCash?: number; reportTool?: boolean };
}

type Raw = Record<string, any>;

export const AGENTS = ["agent-0", "agent-1", "agent-2", "agent-3"];

export class StepBuilder {
  steps: Step[] = [];
  info: RunInfo = {};
  rawCount = 0;
  private round = 0;
  private vault = 0;
  private balances: Record<string, number> = {};
  private names = new Map<string, string>();
  private turnStep = new Map<string, number>();

  add(events: Raw[]): void {
    for (const e of events) this.one(e);
    this.rawCount += events.length;
  }

  private name(addr?: string): string {
    if (!addr) return "?";
    return this.names.get(addr.toLowerCase()) ?? `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  }

  private push(s: Omit<Step, "i" | "round" | "vault" | "balances">) {
    this.steps.push({ ...s, i: this.steps.length, round: this.round, vault: this.vault, balances: { ...this.balances } });
  }

  private one(e: Raw): void {
    switch (e.kind) {
      case "setup": {
        this.vault = Number(e.config.treasury);
        e.config.owners.forEach((a: string, i: number) => {
          this.names.set(a.toLowerCase(), AGENTS[i]);
          this.balances[AGENTS[i]] = Number(e.config.agentStartingBalance);
        });
        this.names.set(e.deployment.vault.toLowerCase(), "vault");
        return;
      }
      case "episode_start":
        this.info = { condition: e.condition, defector: e.defector, seed: e.seed, rounds: e.rounds, backends: e.backends, systems: e.systems, variant: e.variant };
        return this.push({ kind: "start", title: `Episode started · condition "${e.condition}" · ${e.rounds} rounds · seed ${e.seed}` });
      case "round_start":
        this.round = e.round;
        return this.push({ kind: "round", title: `Round ${e.round}` });
      case "opportunity":
        this.names.set(String(e.address).toLowerCase(), `${e.id} ${e.vendor}`);
        return this.push({
          kind: "opportunity",
          title: `New opportunity ${e.id}: ${e.vendor}`,
          body: `Asks ${e.ask} · promises +${e.promisedReturnPct}% after ${e.maturesInRounds} round(s) · open through round ${e.openUntilRound}\n“${e.pitch}”`,
          scam: e.scam,
        });
      case "turn_start":
        this.turnStep.set(e.agent, this.steps.length);
        return this.push({ kind: "turn", agent: e.agent, title: `${e.agent}'s turn`, prompt: e.prompt });
      case "turn_end": {
        const idx = this.turnStep.get(e.agent);
        if (idx !== undefined && e.usage) this.steps[idx].tokens = { input: e.usage.inputTokens ?? 0, output: e.usage.outputTokens ?? 0 };
        return;
      }
      case "turn_error":
        return this.push({ kind: "error", agent: e.agent, title: "Turn failed", body: e.error });
      case "llm_event":
        return this.llm(e.agent, e.event ?? {});
      case "tool":
        return this.tool(e);
      case "chat":
        return this.push({ kind: "chat", agent: e.agent, title: "Group chat", body: e.text });
      case "note":
        return this.push({ kind: "note", agent: e.agent, title: "Private note", body: e.text });
      case "suspicion":
        return this.push({
          kind: "suspicion",
          agent: e.agent,
          suspect: e.suspect,
          title: `Reports ${e.suspect} as acting against the group (confidence ${e.confidence})`,
          body: e.reason,
        });
      case "token_transfer": {
        const amount = Number(e.amount);
        const move = (who: string, delta: number) => {
          if (who === "vault") this.vault += delta;
          else if (who in this.balances) this.balances[who] += delta;
        };
        move(e.from, -amount);
        move(e.to, amount);
        this.vault = Math.round(this.vault * 1e6) / 1e6;
        const from = /^0x0+$/.test(e.from) ? "new tokens (payout)" : e.from;
        return this.push({ kind: "transfer", title: `${amount} tokens: ${from} → ${e.to}` });
      }
      case "investment_repaid":
        return this.push({ kind: "repaid", title: `${e.opportunityId} repaid ${e.payout} (funded ${e.funded})` });
      case "investment_defaulted":
        return this.push({ kind: "defaulted", title: `${e.opportunityId} defaulted: ${e.funded} tokens lost` });
      case "late_funding":
        return this.push({ kind: "late", title: `${e.amount} sent to ${e.opportunityId} after it closed. Lost.` });
      case "episode_abort":
        return this.push({ kind: "error", title: `Run aborted: ${e.reason}. Check the turn errors above.` });
      case "episode_end":
        return this.push({
          kind: "end",
          title: `Episode over · vault ${e.vaultStart} → ${e.vaultEnd}`,
          body: `Suspicion reports: ${(e.suspicions ?? []).map((s: Raw) => `${s.from}→${s.suspect} (r${s.round})`).join(", ") || "none"}`,
        });
    }
  }

  private llm(agent: string, ev: Raw) {
    const d = ev.data ?? {};
    if (ev.type === "assistant.reasoning" && d.content) return this.push({ kind: "reasoning", agent, title: "Reasoning", body: d.content });
    if (ev.type === "assistant.message" && typeof d.content === "string" && d.content.trim())
      return this.push({ kind: "say", agent, title: "Thinking out loud (not shared)", body: d.content });
    if (ev.type === "session.error") return this.push({ kind: "error", agent, title: "Model error", body: d.message ?? JSON.stringify(d) });
    if (ev.type === "permission_rejected") return this.push({ kind: "error", agent, title: "Blocked a non-sandbox tool request", body: JSON.stringify(ev.request) });
  }

  private tool(e: Raw) {
    if (e.agent === "harness") return;
    const a = e.args ?? {};
    const r = e.result ?? {};
    const ok = e.status === "ok";
    const fail = ok ? "" : `: ${e.status === "blocked" ? "BLOCKED by spending cap. " : ""}${e.error}`;
    const id = a.proposalId ?? a.proposal_id;
    let title: string;
    let kind: StepKind = "action";
    switch (e.tool) {
      case "propose":
        title = ok ? `Proposed #${r.proposalId}: ${a.amount} → ${this.name(a.to)}` : `Tried to propose ${a.amount} → ${this.name(a.to)}${fail}`;
        return this.push({ kind, agent: e.agent, ok, title, body: a.description ? `“${a.description}”` : undefined });
      case "vote":
        title = ok ? `Voted for #${id} (${r.approvals} approvals)` : `Tried to vote for #${id}${fail}`;
        break;
      case "revokeVote":
        title = ok ? `Revoked vote on #${id}` : `Tried to revoke vote on #${id}${fail}`;
        break;
      case "execute":
        title = ok ? `Executed #${id}: ${r.amount} → ${this.name(r.to)}` : `Tried to execute #${id}${fail}`;
        break;
      case "pettyWithdraw":
        title = ok ? `Petty-cash withdrawal ${a.amount} → ${this.name(a.to)}` : `Tried petty-cash ${a.amount} → ${this.name(a.to)}${fail}`;
        break;
      case "transfer":
        title = ok ? `Sent own tokens ${a.amount} → ${this.name(a.to)}` : `Tried to send ${a.amount} → ${this.name(a.to)}${fail}`;
        break;
      case "getVaultState":
      case "getBalance":
        kind = "lookup";
        title = e.tool === "getBalance" ? `Checked balance of ${a.address ? this.name(a.address) : "own wallet"}` : "Checked vault state";
        break;
      default:
        title = ok ? `${e.tool}` : `${e.tool} failed${fail}`;
    }
    this.push({ kind, agent: e.agent, ok, title });
  }
}

export const FILTERS: { key: string; label: string; kinds: StepKind[]; on: boolean }[] = [
  { key: "thoughts", label: "Thoughts & notes", kinds: ["reasoning", "say", "note"], on: true },
  { key: "chat", label: "Chat & suspicions", kinds: ["chat", "suspicion"], on: true },
  { key: "actions", label: "Actions", kinds: ["action", "error"], on: true },
  { key: "money", label: "Transfers & payouts", kinds: ["transfer", "repaid", "defaulted", "late"], on: true },
  { key: "world", label: "Rounds, turns & opportunities", kinds: ["start", "round", "turn", "opportunity", "end"], on: true },
  { key: "lookups", label: "Lookups", kinds: ["lookup"], on: false },
];
