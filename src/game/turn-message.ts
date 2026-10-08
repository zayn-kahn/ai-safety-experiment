/**
 * The message an agent gets at the start of each turn: prompts/agent/turn.md, filled in with the current state.
 * Stateless: everything the agent knows about the game this turn is in this message (plus its system prompt).
 */
import type { VaultState } from "../chain/vault.js";
import { turnMessage } from "../prompts.js";
import type { World } from "./world.js";

const list = (items: string[]) => (items.length ? items.join("\n") : "(none)");

export function buildTurnMessage(o: { world: World; agent: string; rounds: number; vault: VaultState; ownBalance: string }): string {
  const { world, agent, vault } = o;
  const who = (addr: string) => world.label(addr, vault.vault);
  const ops = world.opportunitiesView();

  return turnMessage({
    round: world.round,
    rounds: o.rounds,
    agentId: agent,
    vaultBalance: vault.balance,
    threshold: vault.threshold,
    ownBalance: o.ownBalance,
    directory: Object.entries(vault.directory)
      .map(([id, a]) => `${id}=${a}`)
      .join(", "),

    pendingProposals: list(
      vault.proposals
        .filter((p) => !p.executed)
        .map(
          (p) =>
            `- #${p.id} by ${who(p.proposer)}: ${p.amount} → ${p.to} [${who(p.to)}] "${p.description}" — approvals ${p.approvals}/${vault.threshold} (${p.approvers.map(who).join(", ")})`,
        ),
    ),

    // Where money actually went. Transfers to a co-owner are labelled "<agent>'s own wallet".
    recentTransfers: list(
      world.recentOutflows().map((t) => {
        const to = who(t.to);
        const label = world.agentIds.includes(to) ? `${to}'s own wallet` : to;
        return `- [r${t.round}] ${t.amount} → ${label} (${t.via})`;
      }),
    ),

    openOpportunities: list(
      ops.open.map(
        (x) =>
          `- ${x.id} ${x.vendor} @ ${x.address}: asks ${x.ask}, promises +${x.promisedReturnPct}% after ${x.maturesInRounds} round(s), open through round ${x.openUntilRound}, funded so far ${x.fundedSoFar}. "${x.pitch}"`,
      ),
    ),

    portfolio: list(
      ops.portfolio.map(
        (i) => `- ${i.opportunityId} ${i.vendor}: funded ${i.funded} in round ${i.fundedRound}, ${i.status}${i.payout !== undefined ? `, paid ${i.payout}` : ""}`,
      ),
    ),

    newChat: list(world.unseenChat(agent).map((m) => `[r${m.round}] ${m.from}: ${m.text}`)),
    recentNotes: list(world.recentNotes(agent).map((n) => `[r${n.round}] ${n.text}`)),
  });
}
