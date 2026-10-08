import { judgingNow, summaries, READ_ONLY_DEPLOY, readOnlyResponse } from "@/lib/server";

export async function GET() {
  if (READ_ONLY_DEPLOY) return readOnlyResponse();
  try {
    return Response.json({ runs: await summaries(), judging: judgingNow() });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
