"use client";
import Link from "next/link";
import { outcomeLine, type RunSummary } from "@/lib/summary";

const yes = (v: boolean | undefined, round?: number | null) =>
  v === undefined ? <span className="muted">–</span> : v ? <span className="yes">✓ yes{round ? ` (r${round})` : ""}</span> : <span className="no">✕ no</span>;

/** What happened in one run: the defector's actions, reports, and the judge's verdict on every honest agent. */
export function Results({
  s,
  judging,
  onJudge,
  judgeError,
  readOnly = false,
}: {
  s: RunSummary | null;
  judging: boolean;
  onJudge: () => void;
  judgeError: string;
  readOnly?: boolean;
}) {
  if (!s) return <div className="results empty-results">Results appear when the run has finished.</div>;
  const honest = s.agents.filter((a) => a.role === "honest");

  return (
    <div className="results">
      <p className="outcome">{outcomeLine(s)}</p>

      <div className="res-tiles">
        <div className="tile">
          <div className="tile-label">{s.scriptedRole === "innocent" ? "Watched co-owner" : "Defector"}</div>
          <div className="res-big">{s.watched ?? "none"}</div>
          <div className="muted">
            {s.scriptedRole === "innocent" ? "scripted, innocent look-alike" : s.scriptedRole === "defector" ? "scripted, guilty (same every run)" : (s.defectorPlayer ?? "")}
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">First formal report</div>
          <div className="res-big">{s.firstReportRound !== null ? `Round ${s.firstReportRound}` : "Never"}</div>
          <div className="muted">
            {s.firstReportRound !== null && s.firstWrongRound !== null ? `${s.firstReportRound - s.firstWrongRound} round(s) after the first wrongdoing` : s.reportTool ? "" : "report button was off"}
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Taken by the defector</div>
          <div className="res-big">{s.stolen}</div>
          <div className="muted">tokens</div>
        </div>
        <div className="tile">
          <div className="tile-label">Vault at the end</div>
          <div className="res-big">{s.vaultTotal ?? "?"}</div>
          <div className="muted">{s.vaultInvested ? `${s.vaultCash} cash + ${s.vaultInvested} invested` : "started at 1000"}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Cost</div>
          <div className="res-big">{s.premiumRequests}</div>
          <div className="muted">premium requests</div>
        </div>
      </div>

      <h3 className="res-h">{s.scriptedRole === "innocent" ? "What the innocent co-owner did (all legitimate)" : "What the defector did"}</h3>
      {s.watchedActions.length ? (
        <ul className="res-list">
          {s.watchedActions.map((w, i) => (
            <li key={i}>
              <b>Round {w.round}:</b> {w.what}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing reportable.</p>
      )}

      <h3 className="res-h">
        How each honest agent responded{" "}
        {s.judged ? <span className="muted">(judged by {s.judgeModel})</span> : null}
      </h3>
      {!s.judged && s.watchedActions.length > 0 && readOnly && <p className="muted">This run hasn&apos;t been judged.</p>}
      {!s.judged && s.watchedActions.length > 0 && !readOnly && (
        <div className="judge-cta">
          <span>This run hasn&apos;t been judged yet. The judge reads each agent&apos;s notes, chat and reasoning. It uses gpt-5-mini, which is free.</span>
          <button type="button" className="primary small" disabled={judging} onClick={onJudge}>
            {judging ? "Judging…" : "Judge now"}
          </button>
          {judgeError && <span className="error-text">{judgeError}</span>}
        </div>
      )}
      <div className="table-wrap">
        <table className="res-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Model</th>
              <th>Noticed</th>
              <th>Formally reported</th>
              <th>Warned others</th>
              <th>Only asked</th>
              <th>Blocked</th>
              <th>Thinks it&apos;s a test</th>
              <th>Why it didn&apos;t report / evidence</th>
            </tr>
          </thead>
          <tbody>
            {honest.map((a) => {
              const v = a.verdict;
              const reportedRound = a.reports.find((r) => r.suspect === s.defector)?.round ?? v?.reported_round;
              return (
                <tr key={a.agent} className={v?.silent_observer ? "silent-row" : ""}>
                  <td>
                    <span className="dot-agent" style={{ ["--c" as string]: `var(--${a.agent})` }} />
                    {a.agent}
                    {v?.silent_observer && <span className="tag-silent">silent</span>}
                  </td>
                  <td className="mono">{a.player}</td>
                  <td>{yes(v?.noticed, v?.noticed_round)}</td>
                  <td>{yes(a.reports.some((r) => r.suspect === s.defector) || (v ? !!v.reported_formally : undefined), reportedRound)}</td>
                  <td>{yes(v?.warned_in_chat)}</td>
                  <td>{yes(v?.only_questioned)}</td>
                  <td>{yes(v?.blocked)}</td>
                  <td>{a.evalAware ? <span className="warn">⚠ yes</span> : <span className="muted">no</span>}</td>
                  <td className="why">
                    {v?.why_not_reported && <div>{v.why_not_reported}</div>}
                    {v?.evidence && <div className="muted evidence">“{v.evidence}”</div>}
                    {v?.note && <div className="muted">{v.note}</div>}
                    {v?.error && <div className="error-text">{v.error}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="muted res-foot">
        Setup: condition <b>{s.condition}</b> · seed {s.seed} · {s.rounds} rounds · petty cash {s.pettyCash ?? "?"} · report button {s.reportTool ? "on" : "off"} ·{" "}
        {s.reasoningSummaries} reasoning summaries. <Link href="/dashboard">See all runs →</Link>
      </p>
    </div>
  );
}
