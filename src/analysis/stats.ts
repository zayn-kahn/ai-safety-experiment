/** Small, dependency-free statistics used by the pre-registered analysis (and safe to import in the viewer). */

export interface Interval {
  lo: number;
  hi: number;
}

/** Wilson score interval for k successes out of n (95% by default). */
export function wilson(k: number, n: number, z = 1.96): Interval {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/** Inverse of the standard normal CDF (Acklam's approximation, |error| < 1.2e-9). */
export function probit(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Signal detection with the log-linear correction (add 0.5 to counts, 1 to totals), so rates of 0 or 1 stay finite.
 * d′ = discrimination (higher = better at telling guilty from innocent); c = threshold (lower = quicker to accuse).
 */
export function sdt(hits: number, nSignal: number, fas: number, nNoise: number): { dPrime: number; c: number } {
  const H = (hits + 0.5) / (nSignal + 1);
  const F = (fas + 0.5) / (nNoise + 1);
  const zH = probit(H);
  const zF = probit(F);
  return { dPrime: zH - zF, c: -(zH + zF) / 2 };
}

/** Deterministic PRNG so bootstrap intervals are reproducible. */
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A run's agent-level result: how many of its honest agents escalated, out of how many. */
export interface RunCount {
  k: number;
  n: number;
}

const rate = (runs: RunCount[]) => {
  const n = runs.reduce((s, r) => s + r.n, 0);
  return n ? runs.reduce((s, r) => s + r.k, 0) / n : NaN;
};

const percentile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
};

/** Run-level bootstrap interval for an agent-level rate (agents in the same run are resampled together). */
export function bootstrapRate(runs: RunCount[], reps = 4000, seed = 1): Interval {
  if (!runs.length) return { lo: NaN, hi: NaN };
  const rnd = mulberry32(seed);
  const xs: number[] = [];
  for (let i = 0; i < reps; i++) xs.push(rate(runs.map(() => runs[Math.floor(rnd() * runs.length)])));
  return { lo: percentile(xs, 0.025), hi: percentile(xs, 0.975) };
}

/** Run-level bootstrap interval for the difference of two rates (a − b). */
export function bootstrapDiff(a: RunCount[], b: RunCount[], reps = 4000, seed = 2): Interval & { est: number } {
  const rnd = mulberry32(seed);
  const xs: number[] = [];
  for (let i = 0; i < reps; i++) {
    const ra = a.map(() => a[Math.floor(rnd() * a.length)]);
    const rb = b.map(() => b[Math.floor(rnd() * b.length)]);
    xs.push(rate(ra) - rate(rb));
  }
  return { est: rate(a) - rate(b), lo: percentile(xs, 0.025), hi: percentile(xs, 0.975) };
}

export const pct = (x: number) => (Number.isNaN(x) ? "–" : `${Math.round(x * 100)}%`);

/** Cohen's κ for two raters' yes/no labels (pairs of [rater A, rater B]). */
export function cohenKappa(pairs: [boolean, boolean][]): number {
  const n = pairs.length;
  if (!n) return NaN;
  const agree = pairs.filter(([a, b]) => a === b).length / n;
  const pa = pairs.filter(([a]) => a).length / n;
  const pb = pairs.filter(([, b]) => b).length / n;
  const chance = pa * pb + (1 - pa) * (1 - pb);
  return chance === 1 ? 1 : (agree - chance) / (1 - chance);
}
