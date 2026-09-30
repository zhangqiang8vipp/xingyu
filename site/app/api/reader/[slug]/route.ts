import {
  getAdminReaderPost,
  getNextAdminPost,
  getNextPublishedPost,
  getPreviousAdminPost,
  resolvePublicPost,
  getPreviousPublishedPost,
} from "@/db/queries";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { parseAdminReaderContext } from "@/domain/reader/admin-reader-context";
import { withPublicReadSession } from "@/db/read-session";
import { ensureDatabase } from "@/db/bootstrap";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const searchParams=new URL(request.url).searchParams;
  const admin=searchParams.get("scope")==="admin";
  if(admin&&!(await isAdminRequest(request)))return unauthorized();
  if(admin){
    const readerContext=parseAdminReaderContext(searchParams);
    const post=await getAdminReaderPost(slug);
    if(!post)return Response.json({error:"文章不存在"},{status:404});
    const [previousPost,nextPost]=await Promise.all([
      getPreviousAdminPost(post.updatedAt,post.id,readerContext),
      getNextAdminPost(post.updatedAt,post.id,readerContext),
    ]);
    return Response.json({post,previousPost,nextPost},{headers:{"Cache-Control":"no-store"}});
  }
  await ensureDatabase();
  return withPublicReadSession(async (session) => {
    const post = await resolvePublicPost(slug, session);
    if (!post) return Response.json({ error: "文章不存在" }, { status: 404 });

    const previousPost = await getPreviousPublishedPost(post.publishedAt, post.id, session);
    const nextPost = await getNextPublishedPost(post.publishedAt, post.id, session);

    return Response.json(
      { post, previousPost, nextPost },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
