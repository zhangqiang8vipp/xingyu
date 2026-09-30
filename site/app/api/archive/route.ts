import { listArchivePosts } from "@/db/queries";
import { CONTENT_LIMITS } from "@/domain/site/config";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = await listArchivePosts({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: Math.min(CONTENT_LIMITS.apiMaximum, Math.max(1, Number(url.searchParams.get("limit")) || CONTENT_LIMITS.archiveBatch)),
    query: url.searchParams.get("q") ?? "",
    category: url.searchParams.get("category") ?? "all",
  });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
