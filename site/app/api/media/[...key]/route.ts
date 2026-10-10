import { env } from "cloudflare:workers";
import { mergeResponseHeaders } from "#domain/media/image-transform";

export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const objectKey = key.join("/");
  // Only public image uploads may use this route. Workspaces and attachments use authenticated download handlers.
  if (!/^images\/\d{4}\/\d{2}\/[A-Za-z0-9_.-]+$/.test(objectKey)) return new Response("Not found",{status:404});
  let object = await env.MEDIA.get(objectKey);
  if (!object) return new Response("Not found", { status: 404 });
  const contentType = object.httpMetadata?.contentType ?? "application/octet-stream";
  const width = Number(new URL(request.url).searchParams.get("width"));
  if (Number.isInteger(width) && width >= 64 && width <= 2000 && contentType.startsWith("image/") && contentType !== "image/gif" && env.IMAGES) {
    try {
      const transformed = await env.IMAGES.input(object.body)
        .transform({ width, fit: "scale-down" })
        .output({ format: "image/webp", quality: 82 });
      return mergeResponseHeaders(transformed.response(), {
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": variantEtag(object.httpEtag, width),
        "X-Content-Type-Options": "nosniff",
      });
    } catch (error) {
      console.warn({ event: "media_image_transform_failed", width, message: error instanceof Error ? error.message : "unknown" });
      object = await env.MEDIA.get(objectKey);
      if (!object) return new Response("Not found", { status: 404 });
    }
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}

function variantEtag(httpEtag: string, width: number) {
  return `"${httpEtag.replace(/^W\//, "").replaceAll('"', "")}-w${width}-webp"`;
}
