import { notFound, permanentRedirect } from "next/navigation";
import { getPostBySlug, resolvePublicPost } from "@/db/queries";
import type { PageSearchParams } from "../../content-utils";
import { postPath } from "../../post-path";
import PostPageView from "@/features/reader/PostPageView";

export const dynamic = "force-dynamic";

export default async function LegacyPostPage({ params, searchParams }: { params:Promise<{ slug:string }>; searchParams:PageSearchParams }) {
  const { slug } = await params;
  const search = await searchParams;
  const adminPreview = search.adminPreview === "article";
  if (adminPreview) {
    const stored = await getPostBySlug(slug);
    const post = stored ?? { id:-1, publicId:"preview", title:"未命名文章", slug:"preview", excerpt:"文章摘要会显示在这里。", content:"从后台开始写作，正文会在这里实时呈现。", categoryName:"随笔", categorySlug:"notes", categoryColor:"#8E8E93", publishedAt:null, viewCount:0 };
    return <PostPageView post={post} adminPreview />;
  }
  const post = await resolvePublicPost(slug);
  if (!post) notFound();
  permanentRedirect(postPath(post));
}
