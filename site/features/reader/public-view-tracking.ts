"use client";

const recentPublicViews = new Map<string, number>();
const CLIENT_DEDUPE_MS = 15_000;

export function trackPublicArticleView(publicId: string) {
  const now = Date.now();
  const previous = recentPublicViews.get(publicId);
  if (previous !== undefined && now - previous < CLIENT_DEDUPE_MS) return;

  recentPublicViews.set(publicId, now);
  void fetch(`/api/views/${encodeURIComponent(publicId)}`, {
    method: "POST",
    keepalive: true,
  }).catch(() => {
    recentPublicViews.delete(publicId);
  });
}
