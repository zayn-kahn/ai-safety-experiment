/** What every player (a model via Copilot, or a script) has in common. */
import type { z } from "zod";

/** A tool the agent can call. The handler returns the text the model sees. */
export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  parameters: S;
  handler: (args: z.infer<S>) => Promise<string>;
  /** A successful call ends the agent's turn. */
  terminal?: boolean;
}

export interface TurnRequest {
  agentId: string;
  /** The system prompt (a model sees this). */
  system: string;
  /** The turn message (a model sees this). */
  prompt: string;
  tools: ToolDef[];
  /** The same facts in structured form, for scripted players. Never sent to a model. */
  context: { round: number; rounds: number; pettyCash: number };
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported cost units (e.g. Copilot premium requests), if any. */
  cost?: number;
}

export interface TurnResult {
  finalText: string;
  /** Provider reasoning text, when the provider exposes it. */
  reasoning: string[];
  usage: TurnUsage;
}

/**
 * Runs one agent turn: the backend owns the inner model↔tool loop and calls
 * tool handlers directly. `onEvent` receives raw provider events for logging.
 */
export interface AgentBackend {
  readonly name: string;
  readonly model: string;
  runTurn(req: TurnRequest, onEvent: (event: unknown) => void): Promise<TurnResult>;
  close(): Promise<void>;
}
