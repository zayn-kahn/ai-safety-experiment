"use client";
import { useEffect, useRef } from "react";
import type { Step } from "@/lib/steps";

const LABEL: Partial<Record<Step["kind"], string>> = {
  opportunity: "Opportunity",
  reasoning: "Reasoning",
  say: "Thinking out loud",
  action: "Action",
  lookup: "Lookup",
  chat: "Chat",
  note: "Private note",
  suspicion: "🚩 Suspicion",
  transfer: "💸 Transfer",
  repaid: "✓ Repaid",
  defaulted: "✕ Defaulted",
  late: "✕ Late funding",
  error: "✕ Error",
  end: "Episode over",
};

/** Everything that has happened up to the cursor. The current step is highlighted and kept in view. */
export function Feed(props: {
  steps: Step[];
  cursor: number;
  visible: (s: Step) => boolean;
  reveal: boolean;
  onSeek: (i: number) => void;
  onShowPrompt: (s: Step) => void;
}) {
  const { steps, cursor, visible, reveal, onSeek, onShowPrompt } = props;
  const curRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Keep the current step in view by scrolling the feed box only, never the page.
  useEffect(() => {
    const el = curRef.current;
    const box = boxRef.current;
    if (!el || !box) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: top - box.clientHeight + el.offsetHeight + 12, behavior: "smooth" });
    }
  }, [cursor, steps.length]);

  const shown = steps.slice(0, cursor + 1).filter(visible);
  // Keep the highlight on the nearest visible step at or before the cursor.
  const hl = shown.length ? shown[shown.length - 1].i : -1;

  return (
    <div className="feed" ref={boxRef}>
      {shown.map((s) => {
        if (s.kind === "round") {
          return (
            <div key={s.i} className="ev round" ref={s.i === hl ? curRef : undefined}>
              {s.title}
            </div>
          );
        }
        const cls = ["ev", s.kind, s.ok === false ? "failed" : "", s.i === hl ? "cur" : ""].join(" ");
        return (
          <div key={s.i} ref={s.i === hl ? curRef : undefined} className={cls} style={s.agent ? { ["--c" as string]: `var(--${s.agent})` } : undefined} onClick={() => onSeek(s.i)}>
            <div className="ev-head">
              {s.agent && <span className="ev-who">{s.agent}</span>}
              {LABEL[s.kind] && <span className="ev-kind">{LABEL[s.kind]}</span>}
              {s.kind === "action" && <span className={`status ${s.ok ? "ok" : "bad"}`}>{s.ok ? "succeeded" : "failed"}</span>}
              {s.kind === "opportunity" && reveal && <span className={`truth ${s.scam ? "scam" : "legit"}`}>{s.scam ? "Scam (hidden from agents)" : "Legit"}</span>}
              {s.kind === "turn" && s.tokens && s.tokens.input + s.tokens.output > 0 && <span>{s.tokens.input.toLocaleString()} in / {s.tokens.output.toLocaleString()} out tokens</span>}
              <span className="muted">step {s.i + 1}</span>
            </div>
            <div className="ev-body">
              {s.kind === "turn" || s.kind === "action" || s.kind === "transfer" || s.kind === "suspicion" ? <b>{s.title}</b> : s.kind === "chat" || s.kind === "note" || s.kind === "reasoning" || s.kind === "say" ? null : s.title}
              {s.body && (s.kind === "chat" || s.kind === "note" || s.kind === "reasoning" || s.kind === "say" ? s.body : `\n${s.body}`)}
              {s.kind === "turn" && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="linkish"
                    onClick={(e) => {
                      e.stopPropagation();
                      onShowPrompt(s);
                    }}
                  >
                    what it saw
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
