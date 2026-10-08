import { stopRun, READ_ONLY_DEPLOY, readOnlyResponse } from "@/lib/server";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (READ_ONLY_DEPLOY) return readOnlyResponse();
  stopRun((await ctx.params).id);
  return Response.json({ ok: true });
}
