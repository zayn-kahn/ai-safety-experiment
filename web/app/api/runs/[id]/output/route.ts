import { readOutput, READ_ONLY_DEPLOY, readOnlyResponse } from "@/lib/server";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (READ_ONLY_DEPLOY) return readOnlyResponse();
  return Response.json({ text: readOutput((await ctx.params).id) });
}
