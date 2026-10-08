/**
 * The tools an agent can call during its turn. Descriptions come from prompts/agent/tools.md.
 * Every call is validated, counts against the turn's tool budget, and returns JSON text to the model.
 */
import { z } from "zod";
import type { ToolResult, VillageTools } from "../chain/vault.js";
import type { JsonlLogger } from "../log.js";
import type { ToolDef } from "../players/types.js";
import { announcements, fill, toolDescriptions } from "../prompts.js";
import type { World } from "./world.js";

export interface AgentToolsOptions {
  agent: string;
  world: World;
  tools: VillageTools;
  logger: JsonlLogger;
  maxToolCalls: number;
  pettyCashEnabled: boolean;
  /** Include report_suspicion (false = the "no report button" variant). */
  reportTool: boolean;
}

function def<S extends z.ZodObject>(t: ToolDef<S>): ToolDef {
  return t as unknown as ToolDef;
}

const show = (r: ToolResult) => JSON.stringify(r.ok ? { ok: true, result: r.result } : r);

export function buildAgentTools(o: AgentToolsOptions): ToolDef[] {
  const { agent, world, tools, logger } = o;
  const describe = toolDescriptions();
  const text = (name: string) => {
    if (!describe[name]) throw new Error(`prompts/agent/tools.md has no "## ${name}" section`);
    return describe[name];
  };
  const amount = z.string().regex(/^\d+(\.\d+)?$/).describe(text("param:amount"));
  const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe(text("param:address"));
  const proposalId = z.number().int().min(0);

  // Order matters: this is the order the model sees the tools in.
  const list: ToolDef[] = [
    def({
      name: "get_vault_state",
      description: text("get_vault_state"),
      parameters: z.object({}),
      handler: async () => show(await tools.getVaultState(agent, {})),
    }),
    def({
      name: "get_opportunities",
      description: text("get_opportunities"),
      parameters: z.object({}),
      handler: async () => JSON.stringify(world.opportunitiesView()),
    }),
    def({
      name: "get_balance",
      description: text("get_balance"),
      parameters: z.object({ address: address.optional() }),
      handler: async (a) => show(await tools.getBalance(agent, a)),
    }),
    def({
      name: "propose_transfer",
      description: text("propose_transfer"),
      parameters: z.object({ to: address, amount, description: z.string().max(500) }),
      handler: async (a) => show(await tools.propose(agent, a)),
    }),
    def({
      name: "vote",
      description: text("vote"),
      parameters: z.object({ proposal_id: proposalId }),
      handler: async (a) => show(await tools.vote(agent, { proposalId: a.proposal_id })),
    }),
    def({
      name: "revoke_vote",
      description: text("revoke_vote"),
      parameters: z.object({ proposal_id: proposalId }),
      handler: async (a) => show(await tools.revokeVote(agent, { proposalId: a.proposal_id })),
    }),
    def({
      name: "execute_proposal",
      description: text("execute_proposal"),
      parameters: z.object({ proposal_id: proposalId }),
      handler: async (a) => show(await tools.execute(agent, { proposalId: a.proposal_id })),
    }),
    ...(o.pettyCashEnabled
      ? [
          def({
            name: "petty_withdraw",
            description: text("petty_withdraw"),
            parameters: z.object({ to: address, amount }),
            handler: async (a) => show(await tools.pettyWithdraw(agent, a)),
          }),
        ]
      : []),
    def({
      name: "transfer_own_tokens",
      description: text("transfer_own_tokens"),
      parameters: z.object({ to: address, amount }),
      handler: async (a) => show(await tools.transfer(agent, a)),
    }),
    def({
      name: "send_message",
      description: text("send_message"),
      parameters: z.object({ text: z.string().min(1).max(1000) }),
      handler: async (a) => {
        const msg = world.post(agent, a.text);
        logger.log({ agent, kind: "chat", round: world.round, seq: msg.seq, text: a.text });
        return JSON.stringify({ ok: true });
      },
    }),
    def({
      name: "private_note",
      description: text("private_note"),
      parameters: z.object({ text: z.string().min(1).max(1000) }),
      handler: async (a) => {
        world.addNote(agent, a.text);
        logger.log({ agent, kind: "note", round: world.round, text: a.text });
        return JSON.stringify({ ok: true });
      },
    }),
    ...(o.reportTool
      ? [
          def({
            name: "report_suspicion",
            description: text("report_suspicion"),
            parameters: z.object({
              suspect: z.enum(world.agentIds as [string, ...string[]]),
              confidence: z.number().min(0).max(1),
              reason: z.string().min(1).max(500),
            }),
            handler: async (a) => {
              const s = { round: world.round, from: agent, ...a };
              world.suspicions.push(s);
              world.post(agent, fill(announcements().suspicionPosted, a));
              logger.log({ agent, kind: "suspicion", ...s });
              return JSON.stringify({ ok: true });
            },
          }),
        ]
      : []),
    def({
      name: "end_turn",
      description: text("end_turn"),
      parameters: z.object({}),
      handler: async () => JSON.stringify({ ok: true }),
      terminal: true,
    }),
  ];

  // Every call: check the turn's tool budget, validate the arguments, then run the tool.
  let calls = 0;
  return list.map((t) => ({
    ...t,
    handler: async (raw: unknown) => {
      const reject = (error: string) => {
        logger.log({ agent, kind: "tool", tool: t.name, args: raw, status: "error", error });
        return JSON.stringify({ ok: false, error });
      };
      if (!t.terminal && calls >= o.maxToolCalls) {
        return reject(`tool-call budget of ${o.maxToolCalls} for this turn is used up; call end_turn`);
      }
      calls++;
      const parsed = t.parameters.safeParse(raw ?? {});
      if (!parsed.success) return reject(`invalid arguments: ${parsed.error.message}`);
      return t.handler(parsed.data);
    },
  }));
}
