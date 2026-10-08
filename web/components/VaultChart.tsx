"use client";
import { useEffect, useRef, useState } from "react";
import type { Step } from "@/lib/steps";

const H = 150;
const PAD = { l: 44, r: 10, t: 10, b: 20 };

/** Vault balance per step. Played part solid, remainder faint; click to seek. */
export function VaultChart({ steps, cursor, onSeek }: { steps: Step[]; cursor: number; onSeek: (i: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (steps.length < 2) return <div ref={wrap} className="chart-wrap muted">Waiting for data…</div>;

  const vals = steps.map((s) => s.vault);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1) {
    lo -= 5;
    hi += 5;
  }
  const padY = (hi - lo) * 0.1;
  lo -= padY;
  hi += padY;
  const x = (i: number) => PAD.l + (i / (steps.length - 1)) * (w - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);

  const path = (from: number, to: number) => {
    let d = `M${x(from)},${y(vals[from])}`;
    for (let i = from + 1; i <= to; i++) d += `H${x(i)}V${y(vals[i])}`;
    return d;
  };
  const ticks = [lo + padY, (lo + hi) / 2, hi - padY];
  const rounds = steps.filter((s) => s.kind === "round");
  const c = Math.min(cursor, steps.length - 1);

  const indexAt = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    const t = (clientX - rect.left - PAD.l) / (w - PAD.l - PAD.r);
    return Math.max(0, Math.min(steps.length - 1, Math.round(t * (steps.length - 1))));
  };

  return (
    <div ref={wrap} className="chart-wrap">
      <svg
        width={w}
        height={H}
        onMouseMove={(e) => setHover(indexAt(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => onSeek(indexAt(e.clientX))}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {rounds.map((r) => (
          <g key={r.i}>
            <line x1={x(r.i)} x2={x(r.i)} y1={PAD.t} y2={H - PAD.b} stroke="var(--grid)" strokeDasharray="2 3" />
            <text x={x(r.i) + 3} y={H - 6} fontSize="10.5" fill="var(--text-muted)">
              R{r.round}
            </text>
          </g>
        ))}
        <path d={path(0, steps.length - 1)} fill="none" stroke="var(--vault)" strokeOpacity="0.25" strokeWidth="2" />
        <path d={path(0, c)} fill="none" stroke="var(--vault)" strokeWidth="2" />
        <line x1={x(c)} x2={x(c)} y1={PAD.t} y2={H - PAD.b} stroke="var(--text-secondary)" strokeWidth="1" />
        <circle cx={x(c)} cy={y(vals[c])} r="4.5" fill="var(--vault)" stroke="var(--surface-1)" strokeWidth="2" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--text-muted)" strokeDasharray="3 3" />}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: Math.min(x(hover) + 10, w - 170), top: 6 }}>
          Step {hover + 1} · Round {steps[hover].round}
          <br />
          <b>Vault {vals[hover].toLocaleString()}</b>
        </div>
      )}
    </div>
  );
}
