import { env } from "cloudflare:workers";
import { attachmentCacheControl, attachmentEtagMatches } from "#domain/attachments/http-cache";
import { mergeResponseHeaders } from "#domain/media/image-transform";
import { getAttachment } from "@/db/attachments";
import { previewTokenCanReadPost } from "@/db/post-preview-tokens";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";

const MAX_IMAGE_TRANSFORM_BYTES = 20 * 1024 * 1024;

export async function GET(request: Request, { params }: { params: Promise<{ publicId: string; name: string[] }> }) {
  const { publicId } = await params;
  const attachment = await getAttachment(publicId);
  if (!attachment) return new Response("Not found", { status: 404 });

  const isPublic = attachment.postStatus === "published" && attachment.postSpaceId === null;
  const previewToken = new URL(request.url).searchParams.get("preview") ?? "";
  const canReadPreview = Boolean(attachment.postId && previewToken && await previewTokenCanReadPost(previewToken, attachment.postId));
  if (!isPublic && !canReadPreview && !(await isAdminRequest(request))) return unauthorized();

  let object = await env.MEDIA.get(attachment.objectKey);
  if (!object) return new Response("Not found", { status: 404 });
  const width = requestedImageWidth(new URL(request.url));
  if (width && attachment.size <= MAX_IMAGE_TRANSFORM_BYTES && canResize(attachment.contentType) && env.IMAGES) {
    const etag = variantEtag(object.httpEtag, width);
    if (attachmentEtagMatches(request.headers.get("If-None-Match"), etag)) {
      return new Response(null, { status: 304, headers: imageHeaders({
        cacheControl: attachmentCacheControl(isPublic),
        contentDisposition: `inline; filename*=UTF-8''${encodeRfc5987(webpFilename(attachment.originalName))}`,
        etag,
      }) });
    }
    try {
      const transformed = await env.IMAGES.input(object.body)
        .transform({ width, fit: "scale-down" })
        .output({ format: "image/webp", quality: 82 });
      return mergeResponseHeaders(transformed.response(), imageHeaders({
        // Article visibility can change after this response is reused. Force
        // revalidation so every request re-enters the permission check above.
        cacheControl: attachmentCacheControl(isPublic),
        contentDisposition: `inline; filename*=UTF-8''${encodeRfc5987(webpFilename(attachment.originalName))}`,
        etag,
      }));
    } catch (error) {
      console.warn({
        event: "attachment_image_transform_failed",
        attachmentId: attachment.publicId,
        width,
        message: error instanceof Error ? error.message : "unknown",
      });
      object = await env.MEDIA.get(attachment.objectKey);
      if (!object) return new Response("Not found", { status: 404 });
    }
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", attachment.contentType);
  headers.set("Content-Length", String(attachment.size));
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", `${canPreview(attachment.contentType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeRfc5987(attachment.originalName)}`);
  // Visibility can change when an article is withdrawn or moved into a private
  // space. Public bytes may be stored, but every reuse must re-enter this route
  // and re-check the article before a 304 is returned.
  headers.set("Cache-Control", attachmentCacheControl(isPublic));
  if (attachmentEtagMatches(request.headers.get("If-None-Match"), object.httpEtag)) {
    headers.delete("Content-Length");
    return new Response(null, { status: 304, headers });
  }
  return new Response(object.body, { headers });
}

function requestedImageWidth(url: URL) {
  const width = Number(url.searchParams.get("width"));
  if (!Number.isInteger(width) || width < 64 || width > 2000) return null;
  return width;
}

function canResize(contentType: string) {
  return contentType.startsWith("image/") && contentType !== "image/gif";
}

function imageHeaders(input: { cacheControl: string; contentDisposition: string; etag: string }) {
  return {
    "Cache-Control": input.cacheControl,
    "Content-Disposition": input.contentDisposition,
    "ETag": input.etag,
    "X-Content-Type-Options": "nosniff",
  };
}

function variantEtag(httpEtag: string, width: number) {
  return `"${httpEtag.replace(/^W\//, "").replaceAll('"', "")}-w${width}-webp"`;
}

function webpFilename(filename: string) {
  return /\.[^.]+$/.test(filename) ? filename.replace(/\.[^.]+$/, ".webp") : `${filename}.webp`;
}

function encodeRfc5987(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canPreview(contentType: string) {
  return contentType.startsWith("image/")
    || contentType === "application/pdf"
    || contentType.startsWith("text/")
    || contentType === "application/json";
}
