import { env } from "cloudflare:workers";
import { ensureDatabase } from "@/db/bootstrap";
import { trackPostView, VIEWS_IDENTITY_SECRET_FALLBACK } from "@/db/view-tracking";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await ensureDatabase();
  const noStore = { "Cache-Control": "no-store" };
  const configuredSecret = env.VIEWS_IDENTITY_SECRET?.trim();
  if (env.APP_ENV === "production" && !configuredSecret) {
    return Response.json({ counted: false }, { status: 503, headers: noStore });
  }
  const result = await trackPostView(env.DB, configuredSecret || VIEWS_IDENTITY_SECRET_FALLBACK, request, slug);
  if (result === "unknown") {
    // Drafts, private-space articles and missing identifiers share one
    // response so the endpoint never leaks whether content exists.
    return new Response(null, { status: 204, headers: noStore });
  }
  if (result === "limited") {
    return Response.json({ counted: false }, { status: 429, headers: { ...noStore, "Retry-After": "60" } });
  }
  if (result instanceof Error) {
    return Response.json({ counted: false }, { status: 500, headers: noStore });
  }
  return Response.json({ counted: result }, { headers: noStore });
}
