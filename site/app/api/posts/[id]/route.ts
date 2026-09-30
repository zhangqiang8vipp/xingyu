import { getWritablePost, PostWriteError, updatePostRecord } from "@/db/post-write";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { parsePostPayload } from "@/domain/posts/post-input";
import { getAdminPost } from "@/db/queries";
import { deleteAdminPost } from "@/db/post-write";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const { id } = await params;
  const post = await getAdminPost(Number(id));
  return post ? Response.json({ post }) : Response.json({ error: "文章不存在" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const { id } = await params; const payload = await request.json() as Record<string, unknown>;
  try {
    // Space membership is a privacy boundary. A partial/older admin client that
    // omits spaceId must never move a private article into the public blog.
    const current=await getWritablePost(Number(id));
    if(!current)throw new PostWriteError("文章不存在",404);
    const input = parsePostPayload({
      ...payload,
      spaceId:Object.prototype.hasOwnProperty.call(payload,"spaceId")?payload.spaceId:current.spaceId,
    });
    const post = await updatePostRecord(Number(id), input, payload.version as number);
    return Response.json({ post });
  } catch (error) {
    if (error instanceof PostWriteError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "文章保存失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const { id } = await params;
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    await deleteAdminPost(Number(id), payload.version as number);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof PostWriteError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "文章删除失败，数据未修改" }, { status: 500 });
  }
}
