import { READ_ONLY_DEPLOY, readLabeling, readOnlyResponse, saveLabel } from "@/lib/server";

export async function GET(request: Request) {
  if (READ_ONLY_DEPLOY) return readOnlyResponse();
  const l = readLabeling();
  // ?count=1: just the progress numbers (the dashboard polls this).
  if (new URL(request.url).searchParams.has("count")) return Response.json({ total: l.items.length, done: l.items.filter((i) => l.labels[i.key]).length });
  return Response.json(l);
}

export async function POST(request: Request) {
  if (READ_ONLY_DEPLOY) return readOnlyResponse();
  try {
    const b = await request.json();
    saveLabel(String(b.key), b);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
