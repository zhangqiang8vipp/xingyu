"use client";

import { useEffect } from "react";
import { trackPublicArticleView } from "./public-view-tracking";

export default function PostViewTracker({ publicId }: { publicId: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      trackPublicArticleView(publicId);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [publicId]);
  return null;
}
