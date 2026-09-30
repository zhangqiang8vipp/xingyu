/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleBlogMcpRequest, isBlogMcpPath } from "./blog-mcp";
import { handleOAuthRequest, isOAuthPath } from "./oauth";
import { enqueueExpiredUnboundAttachments, UNBOUND_ATTACHMENT_RETENTION_DAYS } from "@/db/attachment-cleanup";
import { cleanupExpiredPostViews, POST_VIEWS_RETENTION_DAYS } from "@/db/view-tracking";
import { schemaVersion } from "@/db/bootstrap";
import { collectSiteHealth } from "@/db/health";
import { cspHeaderFor, cspModeLabel, summarizeCspReport, CSP_REPORT_PATH } from "@/domain/security/csp";
import { hasRequestIdentity, isHtmlDocumentRequest, isPublicDocumentRequest, publicDocumentCacheControl, publicDocumentCacheKey, publicDocumentCategory, publicDocumentStorageCacheControl, readPublicContentRevision, responseAllowsPublicStorage } from "./public-document-cache";
import { normalizeImageOutputFormat } from "@/domain/media/image-transform";

const edgeCache = (caches as CacheStorage & { default: Cache }).default;

function addSecurityHeaders(response: Response, url: URL, publicDocument: boolean, revision: string | null, identityBearing: boolean, htmlDocument: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  if (identityBearing || url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/admin") || url.pathname.startsWith("/preview")) {
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  } else if (htmlDocument) {
    headers.set("Cache-Control",publicDocument&&response.ok?publicDocumentCacheControl(revision):"no-store");
  }
  if(htmlDocument)headers.set("CDN-Cache-Control","no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

function applyCsp(headers: Headers, env: Env, htmlDocument: boolean) {
  if (!htmlDocument) return;
  const header = cspHeaderFor(cspModeLabel(env.CSP_MODE));
  if (header) headers.set(header.name, header.value);
}

async function readCspReport(request: Request, limit = 8192): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/csp-report" || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestStartedAt = performance.now();
    const url = new URL(request.url);
    const identityBearing=hasRequestIdentity(request);
    if (url.pathname === CSP_REPORT_PATH && request.method === "POST") {
      if (cspModeLabel(env.CSP_MODE) !== "off") {
        const summary = summarizeCspReport(await readCspReport(request).catch(() => null));
        if (summary) console.error(JSON.stringify({ event: "csp_violation", at: new Date().toISOString(), ...summary }));
      }
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/" && request.method === "POST") {
      return addSecurityHeaders(new Response(null, {
        status: 405,
        headers: { "Allow": "GET, HEAD", "Cache-Control": "no-store" },
      }), url, false, null, identityBearing, false);
    }
    const htmlDocument=isHtmlDocumentRequest(request);
    const cacheable = isPublicDocumentRequest(request, url);
    const revisionStartedAt=performance.now();
    const category=cacheable?publicDocumentCategory(url):undefined;
    const revision=cacheable?await readPublicContentRevision(env.DB,category??undefined):null;
    const revisionDuration=performance.now()-revisionStartedAt;
    const cacheKey=cacheable&&revision!==null?publicDocumentCacheKey(url,revision):null;

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format:normalizeImageOutputFormat(format), quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (isOAuthPath(url.pathname)) {
      return handleOAuthRequest(request);
    }

    if (isBlogMcpPath(url.pathname)) {
      return handleBlogMcpRequest(request, env, ctx);
    }

    if (cacheKey) {
      const cached = await edgeCache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        applyCsp(headers, env, htmlDocument);
        headers.set("X-Xingyu-Cache", "HIT");
        headers.set("Cache-Control",publicDocumentCacheControl(revision));
        headers.set("CDN-Cache-Control","no-store");
        headers.set("Server-Timing", `cache-revision;dur=${revisionDuration.toFixed(1)}, edge-cache;dur=${(performance.now() - requestStartedAt).toFixed(1)}`);
        return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers,
        });
      }
    }

    const appResponse=await handler.fetch(request, env, ctx);
    const publicStorageAllowed=cacheable&&responseAllowsPublicStorage(appResponse);
    const response = addSecurityHeaders(appResponse, url, publicStorageAllowed,revision,identityBearing,htmlDocument);
    applyCsp(response.headers, env, htmlDocument);
    response.headers.set("Server-Timing", `${cacheable?`cache-revision;dur=${revisionDuration.toFixed(1)}, `:""}app;dur=${(performance.now() - requestStartedAt).toFixed(1)}`);
    if (cacheKey && publicStorageAllowed) {
      const cachedResponse = response.clone();
      cachedResponse.headers.set("Cache-Control",publicDocumentStorageCacheControl());
      cachedResponse.headers.delete("CDN-Cache-Control");
      cachedResponse.headers.set("X-Xingyu-Cache", "HIT");
      ctx.waitUntil(edgeCache.put(cacheKey, cachedResponse));
      response.headers.set("X-Xingyu-Cache", "MISS");
    }
    return response;
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      try {
        const enqueued = await enqueueExpiredUnboundAttachments(env.DB, UNBOUND_ATTACHMENT_RETENTION_DAYS);
        const pruned = await cleanupExpiredPostViews(env.DB, POST_VIEWS_RETENTION_DAYS);
        console.log(JSON.stringify({ event: "attachment_expiry_scan", enqueued, prunedViews: pruned }));
      } catch (error) {
        console.error(JSON.stringify({
          event: "attachment_expiry_scan_failed",
          errorType: error instanceof Error ? error.name : typeof error,
        }));
      }
      try {
        const health = await collectSiteHealth(env.DB, schemaVersion);
        const anomalies = Object.entries(health.audit)
          .filter(([, count]) => count !== 0)
          .map(([name, count]) => ({ name, count }));
        if (!health.ownerPresent) anomalies.push({ name: "owner_missing", count: 1 });
        if (anomalies.length > 0) {
          console.error(JSON.stringify({
            event: "site_health_anomaly",
            anomalyCount: anomalies.length,
            anomalies,
            generatedAt: health.generatedAt,
          }));
        }
      } catch (error) {
        console.error(JSON.stringify({
          event: "site_health_check_failed",
          errorType: error instanceof Error ? error.name : typeof error,
        }));
      }
    })());
  },
} satisfies ExportedHandler<Env>;

export default worker;
