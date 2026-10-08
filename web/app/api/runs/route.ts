import { listRuns, startRun, READ_ONLY_DEPLOY, readOnlyResponse } from "@/lib/server";

export async function GET() {
  if (READ_ONLY_DEPLOY) return readOnlyResponse();
  return Response.json(listRuns());
}

export async function POST(request: Request) {
  if (READ_ONLY_DEPLOY) return readOnlyResponse();
  try {
    return Response.json({ id: startRun(await request.json()) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
