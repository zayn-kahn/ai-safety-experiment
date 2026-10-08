/**
 * A player driven by a model through GitHub Copilot. Each turn is a fresh, locked-down session: our system prompt
 * only, our tools only, no memory. Copilot adds one line we don't control: a <current_datetime> tag on every turn
 * message (see docs/what-agents-see.md).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { CopilotClient, defineTool, type ModelInfo, type SessionEvent } from "@github/copilot-sdk";
import { COPILOT } from "../config.js";
import type { AgentBackend, TurnRequest, TurnResult } from "./types.js";

export interface CopilotConnectionOptions {
  /** Defaults to COPILOT_GITHUB_TOKEN. */
  gitHubToken?: string;
  /** Copilot runtime data (sessions, logs). Kept inside the repo. */
  homeDir?: string;
}

/** One Copilot runtime process, shared by every agent's backend in a run. */
export class CopilotConnection {
  readonly client: CopilotClient;
  private starting: Promise<void> | null = null;
  private models: Promise<ModelInfo[]> | null = null;

  constructor(opts: CopilotConnectionOptions = {}) {
    const token = opts.gitHubToken ?? process.env.COPILOT_GITHUB_TOKEN;
    if (!token) throw new Error("COPILOT_GITHUB_TOKEN is not set (add it to .env)");
    const home = resolve(opts.homeDir ?? ".copilot");
    const workDir = resolve(".tmp/copilot-work");
    mkdirSync(home, { recursive: true });
    mkdirSync(workDir, { recursive: true });
    this.client = new CopilotClient({
      mode: "empty",
      baseDirectory: home,
      workingDirectory: workDir,
      gitHubToken: token,
      useLoggedInUser: false,
      logLevel: "error",
    });
  }

  start(): Promise<void> {
    this.starting ??= this.client.start();
    return this.starting;
  }

  /** Models the subscription can use (cached). */
  listModels(): Promise<ModelInfo[]> {
    this.models ??= this.start().then(() => this.client.listModels());
    return this.models;
  }

  /** Real model ids agents can play with ("auto" is a router, not a model). */
  async playableModelIds(): Promise<string[]> {
    return (await this.listModels()).filter((m) => m.id !== "auto" && m.policy?.state !== "disabled").map((m) => m.id);
  }

  /** One tool-free completion (used by the judge). Returns the assistant's text and premium-request cost. */
  async complete(o: { model: string; system: string; prompt: string; timeoutMs?: number }): Promise<{ text: string; cost: number }> {
    await this.start();
    const session = await this.client.createSession({
      model: o.model,
      systemMessage: { mode: "replace", content: o.system },
      availableTools: [],
      infiniteSessions: { enabled: false },
      memory: { enabled: false },
      disabledMcpServers: ["github-mcp-server"],
      onPermissionRequest: () => ({ kind: "reject", feedback: "No tools." }),
    });
    const texts: string[] = [];
    let cost = 0;
    const off = session.on((event: SessionEvent) => {
      const data = (event as { data?: Record<string, any> }).data ?? {};
      if (event.type === "assistant.message" && typeof data.content === "string") texts.push(data.content);
      if (event.type === "assistant.usage") cost += data.cost ?? 0;
    });
    try {
      await session.sendAndWait({ prompt: o.prompt }, o.timeoutMs ?? 180_000);
    } finally {
      off();
      await session.disconnect().catch(() => {});
      await this.client.deleteSession(session.sessionId).catch(() => {});
    }
    return { text: texts.join("\n"), cost };
  }

  async close(): Promise<void> {
    if (this.starting) await this.client.stop();
  }
}

export interface CopilotBackendOptions {
  model: string;
  /** Share one runtime across agents. If omitted, the backend owns a private connection. */
  connection?: CopilotConnection;
  gitHubToken?: string;
  turnTimeoutMs?: number;
}

/**
 * Runs each agent turn as a fresh, locked-down Copilot session:
 * our system prompt only (replace mode), our tools only, no memory, no compaction.
 * Anything else the runtime asks permission for is rejected.
 * Requests a detailed reasoning summary from models that support it.
 */
export class CopilotBackend implements AgentBackend {
  readonly name = "copilot";
  readonly model: string;
  private readonly conn: CopilotConnection;
  private readonly ownsConnection: boolean;

  constructor(private readonly opts: CopilotBackendOptions) {
    this.model = opts.model;
    this.ownsConnection = !opts.connection;
    this.conn = opts.connection ?? new CopilotConnection({ gitHubToken: opts.gitHubToken });
  }

  listModels() {
    return this.conn.listModels();
  }

  async runTurn(req: TurnRequest, onEvent: (e: unknown) => void): Promise<TurnResult> {
    await this.conn.start();
    const info = (await this.conn.listModels()).find((m) => m.id === this.model);
    const tools = req.tools.map((t) =>
      defineTool(t.name, {
        description: t.description,
        parameters: t.parameters.toJSONSchema() as Record<string, unknown>,
        handler: (args: unknown) => t.handler(args as never),
        skipPermission: true,
        defer: "never",
        isTerminal: t.terminal,
      }),
    );
    const session = await this.conn.client.createSession({
      model: this.model,
      // Turn thinking on (medium effort) and ask for a detailed summary of it, where the model allows.
      ...(info?.capabilities.supports.reasoningEffort
        ? {
            reasoningEffort: info.supportedReasoningEfforts?.includes(COPILOT.reasoningEffort as never) ? (COPILOT.reasoningEffort as "medium") : info.supportedReasoningEfforts?.find((e) => (e as string) !== "none"),
            reasoningSummary: "detailed" as const,
          }
        : {}),
      systemMessage: { mode: "replace", content: req.system },
      tools,
      availableTools: req.tools.map((t) => `custom:${t.name}`),
      infiniteSessions: { enabled: false },
      memory: { enabled: false },
      // Copilot starts its built-in GitHub MCP server otherwise. Our tool list already hides it; this stops it starting.
      disabledMcpServers: ["github-mcp-server"],
      onPermissionRequest: (request) => {
        onEvent({ type: "permission_rejected", request });
        return { kind: "reject", feedback: "Not permitted in this environment." };
      },
    });

    const reasoning: string[] = [];
    const texts: string[] = [];
    const usage = { inputTokens: 0, outputTokens: 0, cost: 0 };
    const unsubscribe = session.on((event: SessionEvent) => {
      if (event.type.endsWith("_delta")) return; // skip streaming fragments; full messages are logged
      onEvent(event);
      const data = (event as { data?: Record<string, any> }).data ?? {};
      if (event.type === "assistant.reasoning" && typeof data.content === "string") reasoning.push(data.content);
      if (event.type === "assistant.message" && typeof data.content === "string" && data.content) texts.push(data.content);
      if (event.type === "assistant.usage") {
        usage.inputTokens += data.inputTokens ?? 0;
        usage.outputTokens += data.outputTokens ?? 0;
        usage.cost += data.cost ?? 0;
      }
    });

    try {
      await session.sendAndWait({ prompt: req.prompt }, this.opts.turnTimeoutMs ?? COPILOT.turnTimeoutMs);
    } finally {
      unsubscribe();
      await session.disconnect().catch(() => {});
      await this.conn.client.deleteSession(session.sessionId).catch(() => {});
    }
    return { finalText: texts.join("\n"), reasoning, usage };
  }

  async close(): Promise<void> {
    if (this.ownsConnection) await this.conn.close();
  }
}
