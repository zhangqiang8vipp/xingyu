import { notFound, permanentRedirect } from "next/navigation";
import { getPostByPublicId } from "@/db/queries";
import { postPath } from "../../../post-path";
import PostPageView from "@/features/reader/PostPageView";

export const dynamic = "force-dynamic";

export default async function StablePostPage({ params }: { params:Promise<{ slug:string; canonicalSlug:string }> }) {
  const { slug:publicId, canonicalSlug } = await params;
  const post = await getPostByPublicId(publicId);
  if (!post) notFound();
  if (canonicalSlug !== post.slug) permanentRedirect(postPath(post));
  return <PostPageView post={post} />;
}
