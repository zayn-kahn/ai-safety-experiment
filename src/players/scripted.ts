/** A player driven by a hand-written script instead of a model: free and deterministic. */
import type { AgentBackend, TurnRequest, TurnResult } from "./types.js";

/** Calls a tool by name, as a model would. Returns the parsed JSON result. */
export type CallTool = (name: string, args?: Record<string, unknown>) => Promise<any>;
export type Policy = (req: TurnRequest, call: CallTool) => Promise<string>;

/** Deterministic, free backend: a hand-written policy per agent drives the tools. */
export class ScriptedBackend implements AgentBackend {
  readonly name = "scripted";

  constructor(
    private readonly policies: Record<string, Policy>,
    readonly model = "policy-v1",
  ) {}

  async runTurn(req: TurnRequest, onEvent: (e: unknown) => void): Promise<TurnResult> {
    const policy = this.policies[req.agentId];
    if (!policy) throw new Error(`no scripted policy for ${req.agentId}`);
    const call: CallTool = async (name, args = {}) => {
      const tool = req.tools.find((t) => t.name === name);
      if (!tool) throw new Error(`policy called unknown tool ${name}`);
      onEvent({ type: "tool_call", name, args });
      const out = await tool.handler(args as never);
      onEvent({ type: "tool_result", name, out });
      return JSON.parse(out);
    };
    const finalText = await policy(req, call);
    return { finalText, reasoning: [], usage: { inputTokens: 0, outputTokens: 0 } };
  }

  async close(): Promise<void> {}
}
