"use client";
import { AGENTS, type RunInfo, type Step } from "@/lib/steps";

/** One card per agent: balance, activity so far, latest thought. Role hidden unless revealed. */
export function AgentCards(props: {
  steps: Step[];
  cursor: number;
  info: RunInfo;
  reveal: boolean;
  agentFilter: string | null;
  onToggle: (a: string) => void;
}) {
  const { steps, cursor, info, reveal, agentFilter, onToggle } = props;
  const upTo = steps.slice(0, cursor + 1);
  const cur = steps[cursor];
  let currentTurn: string | undefined;
  for (let i = cursor; i >= 0; i--) {
    if (steps[i]?.kind === "turn") {
      currentTurn = steps[i].agent;
      break;
    }
    if (steps[i]?.kind === "round") break;
  }

  return (
    <div className="agents">
      {AGENTS.map((a) => {
        const mine = upTo.filter((s) => s.agent === a);
        const count = (pred: (s: Step) => boolean) => mine.filter(pred).length;
        const flaggedBy = upTo.filter((s) => s.kind === "suspicion" && s.suspect === a).length;
        const last = [...mine].reverse().find((s) => ["reasoning", "say", "note", "chat"].includes(s.kind));
        const isDefector = info.defector === a;
        return (
          <button
            type="button"
            key={a}
            className={`agent${currentTurn === a ? " current" : ""}${agentFilter === a ? " filtered" : ""}`}
            style={{ ["--c" as string]: `var(--${a})` }}
            onClick={() => onToggle(a)}
            title="Click to show only this agent in the feed"
          >
            <div className="agent-name">
              <span>{a}</span>
              {reveal && <span className={`role ${isDefector ? "defector" : "honest"}`}>{isDefector ? "Defector" : "Honest"}</span>}
            </div>
            {info.backends?.[a] && <div className="agent-model">{info.backends[a].replace(/^copilot:/, "").replace(/^scripted:.*/, "scripted")}</div>}
            <div className="agent-bal">{(cur?.balances[a] ?? 0).toLocaleString()} <span className="muted" style={{ fontSize: 12 }}>tokens</span></div>
            <div className="agent-stats">
              {count((s) => s.kind === "action" && s.title.startsWith("Proposed"))} proposals · {count((s) => s.kind === "action" && s.title.startsWith("Voted"))} votes ·{" "}
              {count((s) => s.kind === "action" && s.title.startsWith("Executed"))} executed
              <br />
              {count((s) => s.kind === "suspicion")} reports made · {flaggedBy > 0 ? <span className="flags">⚑ reported {flaggedBy}×</span> : "not reported"}
            </div>
            {last && <div className="agent-last">“{last.body}”</div>}
          </button>
        );
      })}
    </div>
  );
}
