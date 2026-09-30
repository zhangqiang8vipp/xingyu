import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
  const post = await getAdminReaderPost(grant.postPublicId);
  if (!post) notFound();
  return <PostPageView post={post} readerScope="preview" previewToken={token} previewExpiresAt={grant.expiresAt} />;
}
