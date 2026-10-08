import { activeRun, readLog, READ_ONLY_DEPLOY, readOnlyResponse } from "@/lib/server";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (READ_ONLY_DEPLOY) return readOnlyResponse();
  const { id } = await ctx.params;
  const from = Number(new URL(request.url).searchParams.get("from") ?? 0) || 0;
  const all = readLog(id);
  return Response.json({ events: all.slice(from), total: all.length, running: activeRun()?.id === id });
}
