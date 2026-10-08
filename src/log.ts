/** The run log: one JSON object per line, appended as things happen (data/runs/<id>.jsonl). */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface LogEvent {
  agent: string;
  /** "tool" for tool calls; later: "message", "thought". */
  kind: string;
  tool?: string;
  args?: unknown;
  /** Tool calls: "ok" | "error" | "blocked". Other kinds may use their own values. */
  status?: string;
  result?: unknown;
  error?: string;
  txHash?: string;
  block?: bigint;
  [extra: string]: unknown;
}

/** Append-only JSONL log. One line per event; bigints serialized as strings. */
export class JsonlLogger {
  constructor(
    readonly path: string,
    readonly runId: string,
  ) {
    mkdirSync(dirname(path), { recursive: true });
  }

  log(event: LogEvent): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), runId: this.runId, ...event }, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    appendFileSync(this.path, line + "\n");
  }
}
