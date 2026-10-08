"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import { useTutorial } from "./Tutorial";

export interface TourStep {
  /** Value of the data-tour attribute to highlight. Omit for a centered card. */
  target?: string;
  title: string;
  body: React.ReactNode;
  /** Optional button inside the card, e.g. "Start a demo run for me". */
  action?: { label: string; run: () => void | Promise<void> };
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_W = 360;
const GAP = 12;

/** Spotlight + explanation card for the active tour step. The page stays clickable. */
export function Tour({ steps }: { steps: TourStep[] }) {
  const { step, setStep, endTour } = useTutorial();
  const [rect, setRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const current = step !== null ? steps[step] : undefined;

  // Scroll the target into view once per step.
  useEffect(() => {
    if (!current?.target) return;
    const el = document.querySelector(`[data-tour="${current.target}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [current]);

  // Track the target's position (it can move while data loads or the page scrolls).
  useLayoutEffect(() => {
    if (!current?.target) {
      setRect(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${current.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((prev) =>
          prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height },
        );
      } else setRect(null);
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [current]);

  // Esc closes, arrow keys move.
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, endTour]);

  if (step === null || !current) return null;

  const last = step === steps.length - 1;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const narrow = vw < 640;

  // Card placement: below the target if it fits, otherwise above; centered when there's no target.
  let style: React.CSSProperties;
  if (!rect || narrow) {
    style = narrow ? { left: 12, right: 12, bottom: 12 } : { left: (vw - CARD_W) / 2, top: Math.max(80, vh / 2 - 140), width: CARD_W };
  } else if (rect.left + rect.width + GAP + CARD_W < vw - 12 && rect.width < 420) {
    // Narrow target with room on its right (e.g. the sidebar): sit beside it so nearby targets stay visible.
    style = { left: rect.left + rect.width + GAP, top: Math.min(Math.max(12, rect.top), vh - 280), width: CARD_W };
  } else {
    const left = Math.min(Math.max(12, rect.left), vw - CARD_W - 12);
    const below = rect.top + rect.height + GAP;
    style = below + 220 < vh ? { left, top: below, width: CARD_W } : { left, bottom: vh - rect.top + GAP, width: CARD_W };
  }

  return (
    <>
      {rect ? (
        <div className="tour-spot" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" style={style} role="dialog" aria-label={current.title}>
        <div className="tour-progress">
          Step {step + 1} of {steps.length}
        </div>
        <h3>{current.title}</h3>
        <div className="tour-body">{current.body}</div>
        {current.action && (
          <button
            type="button"
            className="primary tour-action"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await current.action!.run();
                setStep(step + 1);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : current.action.label}
          </button>
        )}
        <div className="tour-nav">
          <button type="button" className="linkish" onClick={endTour}>
            Skip tour
          </button>
          <span className="spacer" />
          <button type="button" className="ghost small" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </button>
          <button type="button" className="primary small" onClick={() => (last ? endTour() : setStep(step + 1))}>
            {last ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
