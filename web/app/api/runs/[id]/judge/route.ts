import { judgeRun, READ_ONLY_DEPLOY, readOnlyResponse } from "@/lib/server";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (READ_ONLY_DEPLOY) return readOnlyResponse();
  try {
    await judgeRun((await ctx.params).id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
