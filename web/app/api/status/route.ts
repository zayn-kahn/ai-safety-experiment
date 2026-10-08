import { activeRun, listConditions, tokenConfigured, READ_ONLY_DEPLOY, readOnlyResponse } from "@/lib/server";

export async function GET() {
  if (READ_ONLY_DEPLOY) return readOnlyResponse();
  return Response.json({ tokenConfigured: tokenConfigured(), active: activeRun()?.id ?? null, conditions: listConditions() });
}
