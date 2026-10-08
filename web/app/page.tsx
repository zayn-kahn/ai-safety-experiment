"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentCards } from "@/components/AgentCards";
import { Feed } from "@/components/Feed";
import { Results } from "@/components/Results";
import { Tour, type TourStep } from "@/components/Tour";
import { Hint, useTutorial } from "@/components/Tutorial";
import { VaultChart } from "@/components/VaultChart";
import { AGENTS, FILTERS, StepBuilder, type Step } from "@/lib/steps";
import type { RunSummary } from "@/lib/summary";
import { api, READ_ONLY } from "@/lib/api";

interface RunRow {
  id: string;
  mtime: number;
  meta: { condition?: string; defector?: string | null; role?: "defector" | "innocent" | null; seed?: number; rounds?: number; backend?: string } | null;
  done: boolean;
  /** Latest round started. */
  round: number;
  judged: boolean;
  running: boolean;
}

export default function Page() {
  const [status, setStatus] = useState({ tokenConfigured: null as boolean | null, active: null as string | null, conditions: undefined as string[] | undefined });
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [cursor, setCursor] = useState(0);
  const [running, setRunning] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(500);
  const [reveal, setReveal] = useState(false);
  const [filters, setFilters] = useState(() => new Set(FILTERS.filter((f) => f.on).map((f) => f.key)));
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [view, setView] = useState<"replay" | "results">("replay");
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [judging, setJudging] = useState(false);
  const [judgeError, setJudgeError] = useState("");
  const [showDry, setShowDry] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; tabs?: Record<string, string>; body: string } | null>(null);
  const builder = useRef(new StepBuilder());
  const follow = useRef(true);
  const dlgRef = useRef<HTMLDialogElement>(null);

  // Status + runs list, refreshed every few seconds.
  const refresh = useCallback(async () => {
    const [s, r] = await Promise.all([api.status(), api.runs()]);
    setStatus(s);
    setRuns(r);
  }, []);
  useEffect(() => {
    refresh();
    if (READ_ONLY) return; // static data never changes while the page is open
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  // Load the selected run and keep polling while it is live.
  useEffect(() => {
    if (!runId) return;
    builder.current = new StepBuilder();
    setSteps([]);
    setCursor(0);
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const d = await api.events(runId, builder.current.rawCount);
      if (stop) return;
      if (d.events.length) {
        const first = builder.current.rawCount === 0;
        builder.current.add(d.events);
        const next = [...builder.current.steps];
        setSteps(next);
        // Live runs follow the newest step; finished runs open at the start for replay.
        if (first && !d.running) follow.current = false;
        if (follow.current) setCursor(next.length - 1);
      }
      setRunning(d.running);
      if (d.running) timer = setTimeout(poll, 900);
    };
    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [runId]);

  const last = steps.length - 1;
  const seek = useCallback(
    (i: number) => {
      const c = Math.max(0, Math.min(last, i));
      follow.current = c === last && running;
      setCursor(c);
    },
    [last, running],
  );

  // Playback.
  useEffect(() => {
    if (!playing) return;
    if (cursor >= last) {
      if (!running) setPlaying(false);
      return;
    }
    const t = setTimeout(() => setCursor((c) => Math.min(c + 1, last)), speed);
    return () => clearTimeout(t);
  }, [playing, cursor, last, speed, running]);

  // Keyboard: ← → step, space play/pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea, dialog")) return;
      if (e.key === "ArrowRight") seek(cursor + 1);
      else if (e.key === "ArrowLeft") seek(cursor - 1);
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, seek]);

  useEffect(() => {
    if (dialog) dlgRef.current?.showModal();
    else dlgRef.current?.close();
  }, [dialog]);

  const visibleKinds = useMemo(() => new Set(FILTERS.filter((f) => filters.has(f.key)).flatMap((f) => f.kinds)), [filters]);
  const visible = useCallback(
    (s: Step) => visibleKinds.has(s.kind) && (!agentFilter || !s.agent || s.agent === agentFilter || s.suspect === agentFilter),
    [visibleKinds, agentFilter],
  );

  const info = builder.current.info;
  const cur = steps[cursor];
  const start = steps[0]?.vault ?? 0;
  const run = runs.find((r) => r.id === runId);

  // Dry = every agent scripted. Real runs may use the scripted defector ("… + scripted defector").
  const isDry = (r: RunRow) => (r.meta?.backend ?? r.id).startsWith("scripted") || (!r.meta && r.id.includes("scripted"));
  const realRuns = runs.filter((r) => !isDry(r));
  const dryRuns = runs.filter(isDry);

  const openRun = (id: string) => {
    follow.current = true;
    setPlaying(false);
    setAgentFilter(null);
    setRunId(id);
    setView("replay");
    window.history.replaceState(null, "", `?run=${encodeURIComponent(id)}`);
  };

  // ---- Guided tour ----
  const tutorial = useTutorial();
  const tourSteps: (TourStep & { needsRun?: boolean })[] = [
    {
      title: "Welcome to Vault Village",
      body: (
        <>
          <p>Four AI agents share one treasury. Moving money needs 3 of the 4 to agree. One agent may secretly be a <b>defector</b> trying to steal without getting caught.</p>
          <p>We change how the honest agents are prompted (plain, rules, values, or emotion) and watch what happens. This tour takes about a minute. Turn it off any time with the <b>Tutorial</b> switch at the top.</p>
        </>
      ),
    },
    { target: "runs", title: "Every run is saved", body: <p>A run is one full game. Runs are started from the terminal (<code>pnpm study</code>) and appear here as cards, newest first. A green dot means live, grey finished, red incomplete; ⚖ means judged. Click any card to replay it.</p> },
    { target: "player", needsRun: true, title: "Step through time", body: <p>Use ◀ ▶ (or the arrow keys) to move one event at a time, or <b>Play</b> to watch it unfold. Space bar plays and pauses.</p> },
    { target: "vault", needsRun: true, title: "The treasury", body: <p>The vault balance at the current step, and its path over the whole run. Drops are funds leaving; jumps are investments paying back. Click the chart to jump to that moment.</p> },
    { target: "agents", needsRun: true, title: "The agents", body: <p>Each card shows an agent&apos;s wallet, what it has done, how often others reported it, and its latest thought. The highlighted card is whose turn it is. Click a card to see only that agent.</p> },
    { target: "reveal", needsRun: true, title: "Hidden truth", body: <p>Agents never see who the defector is or which opportunities are scams. Tick this to see it yourself. Try watching first without it, like a detective.</p> },
    { target: "filters", needsRun: true, title: "Choose what to see", body: <p>Toggle thoughts and notes, chat and suspicions, actions, money movements, and round markers. <b>Lookups</b> (agents checking balances) are hidden by default.</p> },
    {
      target: "feed",
      needsRun: true,
      title: "The story",
      body: (
        <p>
          Everything in order. Blue is reasoning, purple is a private note only that agent sees, yellow is a 🚩 suspicion report, green and red are payouts and losses. On any turn, <b>what it saw</b> shows the exact briefing the agent received.
        </p>
      ),
    },
    { target: "guide-link", title: "Want the full picture?", body: <p><b>How it works</b> explains each part of the project: what was built, why, and where it lives in the code.</p> },
  ];
  const tourStep = tutorial.step !== null ? tourSteps[tutorial.step] : undefined;
  // Steps about the run view need a run open: open the newest one if nothing is selected.
  useEffect(() => {
    if (tourStep?.needsRun && !runId && runs[0]) openRun(runs[0].id);
  }, [tourStep, runId, runs]);

  // Deep link: ?run=<id>[&view=results] opens that run on load.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get("run");
    if (id) setRunId(id);
    if (q.get("view") === "results") setView("results");
  }, []);

  // Results for the open run: refresh when it finishes and while it's being judged.
  const loadSummary = useCallback(async () => {
    if (!runId) return setSummary(null);
    const d = await api.summaries().catch(() => null);
    if (!d?.runs) return;
    setSummary((d.runs as RunSummary[]).find((s) => s.id === runId) ?? null);
    setJudging((d.judging as string[]).includes(runId));
  }, [runId]);
  useEffect(() => {
    setSummary(null);
    setJudgeError("");
    loadSummary();
  }, [loadSummary, running]);
  useEffect(() => {
    if (!judging) return;
    const t = setInterval(loadSummary, 4000);
    return () => clearInterval(t);
  }, [judging, loadSummary]);
  const judgeNow = async () => {
    if (!runId) return;
    setJudging(true);
    setJudgeError("");
    const res = await fetch(`/api/runs/${runId}/judge`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setJudgeError(d.error ?? "Judging failed");
    await loadSummary();
    setJudging(false);
  };

  return (
    <>
      <div className="layout-v">
        <section className="panel runs-strip" data-tour="runs">
          <div className="strip-head">
            <h2>Runs</h2>
            <span className="muted small-note">
              {READ_ONLY
                ? "A published replay: pick a run."
                : "Started from the terminal with pnpm study. New runs appear here live."}
            </span>
            {dryRuns.length > 0 && (
              <button type="button" className="ghost small" aria-pressed={showDry} onClick={() => setShowDry((v) => !v)}>
                {showDry ? "Hide" : "Show"} dry runs ({dryRuns.length})
              </button>
            )}
          </div>
          <Hint>A run is one full game: four co-owners play several rounds on a fresh local chain, and everything is saved to one log file.</Hint>
          <RunStrip runs={showDry ? [...realRuns, ...dryRuns] : realRuns} runId={runId} onOpen={openRun} />
        </section>

        <main className="main">
          {!runId ? (
            <div className="empty">
              <p>Pick a run above to replay it.</p>
              <p className="muted">
                Runs are started from the terminal: <code>pnpm study --pilot</code> for the 2-run test, <code>pnpm study</code> for the full study, or{" "}
                <code>pnpm sim</code> for a free dry run.
              </p>
              {tutorial.enabled && tutorial.step === null && (
                <button type="button" className="primary" onClick={tutorial.startTour}>
                  Take the 1-minute tour
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="run-head">
                <div>
                  <h2>{runId}</h2>
                  <div className="chips">
                    {running ? <span className="chip live">live</span> : run && !run.done ? <span className="chip fail">incomplete</span> : <span className="chip">finished</span>}
                    <span className="chip">{info.backends && Object.values(info.backends).every((b) => b.startsWith("scripted")) ? "dry run (scripted, no AI)" : "real run"}</span>
                    {info.condition && <span className="chip">condition: {info.condition}</span>}
                    {info.variant?.reportTool === false && <span className="chip">no report button</span>}
                    {info.backends && info.defector && info.backends[info.defector]?.startsWith("scripted") && !Object.values(info.backends).every((b) => b.startsWith("scripted")) && (
                      <span className="chip">scripted defector</span>
                    )}
                    {info.backends &&
                      (() => {
                        const models = [...new Set(Object.values(info.backends).filter((b) => !b.startsWith("scripted")))];
                        if (!models.length) return null;
                        return <span className="chip">{models.length > 1 ? "mixed models (see cards)" : models[0].replace(/^copilot:/, "")}</span>;
                      })()}
                    {info.seed !== undefined && <span className="chip">seed {info.seed}</span>}
                    <span className="chip">defector: {reveal ? (info.defector ?? "none") : "hidden"}</span>
                  </div>
                </div>
                <div className="head-actions">
                  <label className="toggle" data-tour="reveal">
                    <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Reveal hidden truth
                  </label>
                  <button
                    type="button"
                    className="ghost"
                    disabled={!info.systems}
                    onClick={() => setDialog({ title: "System prompts", tabs: info.systems, body: info.systems?.["agent-0"] ?? "" })}
                  >
                    System prompts
                  </button>
                  {!READ_ONLY && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={async () => {
                      const d = await fetch(`/api/runs/${runId}/output`).then((x) => x.json());
                      setDialog({ title: "Process output", body: d.text || "(empty)" });
                    }}
                  >
                    Process output
                  </button>
                  )}
                  {running && !READ_ONLY && (
                    <button type="button" className="danger" onClick={() => fetch(`/api/runs/${runId}/stop`, { method: "POST" })}>
                      Stop run
                    </button>
                  )}
                </div>
              </div>

              <div className="view-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={view === "replay"} onClick={() => setView("replay")}>
                  Replay
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "results"}
                  onClick={() => {
                    setView("results");
                    loadSummary();
                  }}
                >
                  Results{summary?.judged ? " ✓" : ""}
                </button>
              </div>

              {view === "results" ? (
                <Results s={summary} judging={judging} onJudge={judgeNow} judgeError={judgeError} readOnly={READ_ONLY} />
              ) : (
              <>
              <div className="player" data-tour="player">
                <button type="button" className="ghost" onClick={() => seek(0)} title="First step">⏮</button>
                <button type="button" className="ghost" onClick={() => seek(cursor - 1)} title="Previous step (←)">◀</button>
                <button type="button" className="primary play" onClick={() => setPlaying((p) => !p)} title="Play / pause (space)">
                  {playing ? "❚❚ Pause" : "▶ Play"}
                </button>
                <button type="button" className="ghost" onClick={() => seek(cursor + 1)} title="Next step (→)">▶</button>
                <button type="button" className="ghost" onClick={() => seek(last)} title="Last step">⏭</button>
                <input type="range" min={0} max={Math.max(0, last)} value={cursor} onChange={(e) => seek(Number(e.target.value))} aria-label="Step" />
                <span className="step-label">
                  Step {steps.length ? cursor + 1 : 0} / {steps.length}
                </span>
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed">
                  <option value={1200}>Slow</option>
                  <option value={500}>Normal</option>
                  <option value={150}>Fast</option>
                </select>
              </div>

              <Hint>Step through the run with ◀ ▶ or press Play. Every event (a thought, a vote, a transfer) is one step.</Hint>
              <div className="overview" data-tour="vault">
                <div className="tile">
                  <div className="tile-label">Vault balance</div>
                  <div className="hero">{cur ? cur.vault.toLocaleString() : "—"}</div>
                  {cur && (
                    <div className="muted">
                      {cur.vault - start >= 0 ? "+" : ""}
                      {(Math.round((cur.vault - start) * 100) / 100).toLocaleString()} since start
                    </div>
                  )}
                  <div className="round-label">{!cur ? "" : cur.round === 0 ? "Setup" : `Round ${cur.round} of ${info.rounds ?? "?"}`}</div>
                </div>
                <div className="chart-card">
                  <div className="chart-title">
                    Vault balance over the run <span className="muted">(click to jump)</span>
                  </div>
                  <VaultChart steps={steps} cursor={cursor} onSeek={seek} />
                </div>
              </div>

              <Hint>One card per agent. The outlined card is whose turn it is. Click a card to filter the story to that agent.</Hint>
              <div data-tour="agents">
              <AgentCards steps={steps} cursor={cursor} info={info} reveal={reveal} agentFilter={agentFilter} onToggle={(a) => setAgentFilter((f) => (f === a ? null : a))} />
              </div>

              <div className="filters" data-tour="filters">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={filters.has(f.key)}
                    onClick={() =>
                      setFilters((prev) => {
                        const n = new Set(prev);
                        if (n.has(f.key)) n.delete(f.key);
                        else n.add(f.key);
                        return n;
                      })
                    }
                  >
                    {f.label}
                  </button>
                ))}
                {agentFilter && (
                  <button type="button" aria-pressed="true" onClick={() => setAgentFilter(null)}>
                    Only {agentFilter} ✕
                  </button>
                )}
              </div>

              <Hint>Blue = reasoning · purple = private note · yellow = suspicion · green/red = payout/loss. Click “what it saw” on a turn to read the agent&apos;s exact briefing.</Hint>
              <div data-tour="feed">
              <Feed steps={steps} cursor={cursor} visible={visible} reveal={reveal} onSeek={seek} onShowPrompt={(s) => setDialog({ title: `What ${s.agent} saw (round ${s.round})`, body: s.prompt ?? "" })} />
              </div>
              </>
              )}
            </>
          )}
        </main>
      </div>

      <Tour steps={tourSteps} />

      <dialog ref={dlgRef} onClose={() => setDialog(null)}>
        {dialog && (
          <>
            <div className="dlg-head">
              <h3>{dialog.title}</h3>
              <button type="button" className="ghost" onClick={() => setDialog(null)}>
                Close
              </button>
            </div>
            {dialog.tabs && (
              <div className="chips" id="dlg-tabs">
                {AGENTS.map((a) => (
                  <button key={a} type="button" aria-pressed={dialog.body === dialog.tabs![a]} onClick={() => setDialog({ ...dialog, body: dialog.tabs![a] })}>
                    {a}
                    {reveal && info.defector === a ? " (defector)" : ""}
                  </button>
                ))}
              </div>
            )}
            <pre id="dlg-body">{dialog.body}</pre>
          </>
        )}
      </dialog>
    </>
  );
}

function RunStrip({ runs, runId, onOpen }: { runs: RunRow[]; runId: string | null; onOpen: (id: string) => void }) {
  if (!runs.length) return <p className="muted rg-empty">No runs yet. Start the 2-run test with <code>pnpm study --pilot</code>.</p>;
  return (
    <ul className="run-strip">
      {runs.map((r) => {
        const m = r.meta;
        const dry = (m?.backend ?? r.id).startsWith("scripted");
        const who = m?.role === "innocent" ? "innocent" : m?.role === "defector" || m?.defector ? "guilty" : "no suspect";
        const state = r.running ? `live · round ${r.round}/${m?.rounds ?? "?"}` : r.done ? "finished" : "incomplete";
        return (
          <li key={r.id}>
            <button type="button" className={`run-card${r.id === runId ? " active" : ""}`} onClick={() => onOpen(r.id)} title={r.id}>
              <span className="rc-top">
                <span className={`dot ${r.running ? "live" : r.done ? "" : "fail"}`} />
                <b>{m?.condition === "none" ? "baseline" : m?.condition ?? "?"}</b>
                {r.judged && <span className="rc-badge" title="Judged">⚖</span>}
              </span>
              <span className="rc-line">
                {who} · seed {m?.seed ?? "?"}
              </span>
              <span className="rc-line muted">{dry ? "dry run" : (m?.backend ?? "?").replace(/^copilot:/, "").replace(" + scripted defector", "")}</span>
              <span className={`rc-line ${r.running ? "rc-live" : r.done ? "muted" : "rc-fail"}`}>{state}</span>
              <span className="rc-line muted">{new Date(r.mtime).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
