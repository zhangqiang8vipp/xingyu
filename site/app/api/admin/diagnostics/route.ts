import { env } from "cloudflare:workers";
import { ensureDatabase, schemaVersion } from "@/db/bootstrap";
import { collectSiteHealth } from "@/db/health";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  await ensureDatabase();
  return Response.json(await collectSiteHealth(env.DB, schemaVersion), {
    headers: { "Cache-Control": "no-store" },
  });
}
