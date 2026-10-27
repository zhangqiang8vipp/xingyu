import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "cloudflare:workers";
import { getAdminReaderPost } from "@/db/queries";
import { resolvePostPreviewToken } from "@/db/post-preview-tokens";
import PostPageView from "@/features/reader/PostPageView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "受邀预览",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function SharedPostPreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const grant = await resolvePostPreviewToken(token, true);
  if (!grant) notFound();
  if(grant.workspaceId!==1){
    // A valid scoped token grants read-only access to exactly one private document.
    const row=await env.DB.prepare("SELECT public_id AS publicId,title,slug,excerpt,content FROM posts WHERE id=? AND workspace_id=? AND public_id=? AND space_id IS NOT NULL")
      .bind(grant.postId,grant.workspaceId,grant.postPublicId)
      .first<{publicId:string;title:string;slug:string;excerpt:string;content:string}>();
    if(!row)notFound();
    return <PostPageView readerScope="preview" previewToken={token} previewExpiresAt={grant.expiresAt}
      post={{...row,id:-1,publishedAt:null,viewCount:0,categoryName:"知识空间文档",categorySlug:null,categoryColor:"#0A84FF"}}/>;
  }
  const post = await getAdminReaderPost(grant.postPublicId);
  if (!post) notFound();
  return <PostPageView post={post} readerScope="preview" previewToken={token} previewExpiresAt={grant.expiresAt} />;
}
