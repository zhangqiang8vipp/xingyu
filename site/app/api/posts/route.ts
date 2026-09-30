import { listAdminPosts } from "@/db/queries";
import { createPostRecord, PostWriteError } from "@/db/post-write";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { parsePostPayload } from "@/domain/posts/post-input";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");
  return Response.json(await listAdminPosts({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: Number(url.searchParams.get("pageSize")) || 20,
    query: url.searchParams.get("q") ?? "",
    category: url.searchParams.get("category") ?? "all",
    status: (url.searchParams.get("status") as "draft" | "published" | "all") ?? "all",
    space: scope === "all" ? "all" : scope === "private" ? "private" : "public",
  }));
}

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const payload = await request.json() as Record<string, unknown>;
  const input = parsePostPayload(payload);
  try {
    const post = await createPostRecord(input);
    return Response.json({ post }, { status: 201 });
  } catch (error) {
    if (error instanceof PostWriteError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "文章创建失败" }, { status: 500 });
  }
}
