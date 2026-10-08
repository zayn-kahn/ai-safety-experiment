import { listModels, READ_ONLY_DEPLOY, readOnlyResponse } from "@/lib/server";

export async function GET() {
  if (READ_ONLY_DEPLOY) return readOnlyResponse();
  return Response.json(await listModels());
}
