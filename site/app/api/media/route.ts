import { env } from "cloudflare:workers";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";

const allowedTypes = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
  ["image/gif", "gif"], ["image/avif", "avif"],
]);

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "请选择图片" }, { status: 400 });
  if (!allowedTypes.has(file.type)) return Response.json({ error: "仅支持 JPG、PNG、WebP、GIF 和 AVIF" }, { status: 415 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "图片不能超过 10MB" }, { status: 413 });

  const date = new Date();
  const key = `images/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${allowedTypes.get(file.type)}`;
  await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { originalName: file.name } });
  return Response.json({ key, url: `/api/media/${key}`, name: file.name }, { status: 201 });
}
