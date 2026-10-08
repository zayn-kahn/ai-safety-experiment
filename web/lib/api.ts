/**
 * Where the viewer gets its data.
 *   live   (your laptop, `pnpm web`): the local API, which can start and judge runs.
 *   replay (Vercel):                  static files exported by `pnpm export` into public/data. Read-only.
 */
export const READ_ONLY = process.env.NEXT_PUBLIC_VV_MODE === "replay";

const json = (r: Response) => {
  if (!r.ok) throw new Error(`${r.url}: ${r.status}`);
  return r.json();
};

// Replay: each run's events are one static file; fetch once and reuse.
const eventCache = new Map<string, Promise<Record<string, any>[]>>();
const runEvents = (id: string) => {
  if (!eventCache.has(id)) eventCache.set(id, fetch(`/data/runs/${encodeURIComponent(id)}.json`).then(json));
  return eventCache.get(id)!;
};

export const api = {
  status: (): Promise<{ tokenConfigured: boolean | null; active: string | null; conditions: string[] | undefined }> =>
    READ_ONLY ? Promise.resolve({ tokenConfigured: null, active: null, conditions: undefined }) : fetch("/api/status").then(json),

  runs: () => (READ_ONLY ? fetch("/data/runs.json") : fetch("/api/runs")).then(json),

  events: async (id: string, from: number): Promise<{ events: Record<string, any>[]; total: number; running: boolean }> => {
    if (!READ_ONLY) return fetch(`/api/runs/${id}/events?from=${from}`).then(json);
    const all = await runEvents(id);
    return { events: all.slice(from), total: all.length, running: false };
  },

  summaries: (): Promise<{ runs: unknown[]; judging: string[] }> =>
    READ_ONLY
      ? fetch("/data/summaries.json")
          .then(json)
          .then((runs) => ({ runs, judging: [] }))
      : fetch("/api/summaries").then(json),
};
