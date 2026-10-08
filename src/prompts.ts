/**
 * Loads the text in prompts/ and fills in its {{placeholders}}. This is the only code that reads prompts/,
 * so everything a model sees starts there. Files are read fresh on every call: edits apply to the next run.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { PROMPTS_DIR } from "./paths.js";

const read = (rel: string) => readFileSync(`${PROMPTS_DIR}/${rel}`, "utf8").trim();
const readJson = (rel: string) => JSON.parse(read(rel));

/** Replace {{name}} placeholders. An unknown placeholder is an error, so nothing is ever sent half-filled. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, key: string) => {
    if (!(key in vars)) throw new Error(`unknown prompt placeholder ${m}`);
    return String(vars[key]);
  });
}

// ---------------------------------------------------------------------------------------------
// The agent's system prompt: agent/base.md + one condition file (honest) or agent/defector.md.

export type Condition = string;

/** "none" (baseline: nothing added) plus every prompts/agent/conditions/<name>.md. */
export function listConditions(): Condition[] {
  const dir = `${PROMPTS_DIR}/agent/conditions`;
  const names = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.slice(0, -3))
        .sort()
    : [];
  return ["none", ...names];
}

export interface SystemPromptInput {
  agentId: string;
  address: string;
  others: string[];
  rounds: number;
  threshold: number;
  /** Petty-cash allowance per epoch in tokens; 0 = no petty cash. */
  pettyCash: number;
  /** Whether the agent has the report_suspicion tool. */
  reportTool: boolean;
  condition: Condition;
  /** Only when the defector is played by a model (not in the main studies). */
  isDefector: boolean;
}

export function systemPrompt(p: SystemPromptInput): string {
  if (!listConditions().includes(p.condition)) throw new Error(`unknown condition "${p.condition}" (no prompts/agent/conditions/${p.condition}.md)`);
  const vars = {
    agentId: p.agentId,
    address: p.address,
    others: p.others.join(", "),
    rounds: p.rounds,
    threshold: p.threshold,
    pettyCashRule: p.pettyCash > 0 ? `\n${fill(read("agent/petty-cash-line.md"), { pettyCash: p.pettyCash })}` : "",
    reportingLine: p.reportTool ? `\n${read("agent/report-line.md")}` : "",
  };
  const parts = [fill(read("agent/base.md"), vars)];
  if (p.isDefector) parts.push(fill(read("agent/defector.md"), vars));
  else if (p.condition !== "none") parts.push(fill(read(`agent/conditions/${p.condition}.md`), vars));
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------------------------
// The agent's turn message (agent/turn.md) and tool descriptions (agent/tools.md).

export function turnMessage(vars: Record<string, string | number>): string {
  return fill(read("agent/turn.md"), vars);
}

/** Tool and parameter descriptions from agent/tools.md: `## name` followed by the description. */
export function toolDescriptions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const section of read("agent/tools.md").split(/^## /m).slice(1)) {
    const [name, ...rest] = section.split("\n");
    out[name.trim()] = rest.join("\n").trim();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Text that appears inside the game: announcements, vendors, the scripted co-owner's lines.

export interface Announcements {
  author: string;
  newOpportunity: string;
  investmentRepaid: string;
  investmentDefaulted: string;
  suspicionPosted: string;
}
export const announcements = (): Announcements => readJson("game/announcements.json");

export interface Vendor {
  vendor: string;
  pitch: string;
}
export const vendors = (): { legit: Vendor[]; scam: Vendor[] } => readJson("game/vendors.json");

export const scriptedCoOwnerLines = (): { defector: Record<string, string>; innocent: Record<string, string> } =>
  readJson("game/scripted-co-owner.json");

// ---------------------------------------------------------------------------------------------
// The judge (judge/system.md is frozen for a study: its hash is the judge version).

export const judgeSystem = () => read("judge/system.md");
export const judgeRequest = (vars: Record<string, string>) => fill(read("judge/request.md"), vars);
export const judgeVersion = () => createHash("sha256").update(judgeSystem()).digest("hex").slice(0, 8);

// ---------------------------------------------------------------------------------------------

/**
 * Short hash of every file the AI co-owners can read (agent/ and game/). Recorded with each run so results
 * from different prompt versions are never mixed. Any edit to any of those files changes it.
 */
export function promptVersion(): string {
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(`${PROMPTS_DIR}/${rel}`, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(`${rel}/${e.name}`);
      else files.push(`${rel}/${e.name}`);
    }
  };
  walk("agent");
  walk("game");
  const h = createHash("sha256");
  for (const f of files) h.update(`${f}\n${readFileSync(`${PROMPTS_DIR}/${f}`, "utf8")}\n`);
  return h.digest("hex").slice(0, 8);
}
