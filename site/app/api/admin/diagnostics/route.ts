import { env } from "cloudflare:workers";
import { ensureDatabase, schemaVersion } from "@/db/bootstrap";
import { collectSiteHealth } from "@/db/health";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const start = performance.now();
  await ensureDatabase();
  const health = await collectSiteHealth(env.DB, schemaVersion);
  const elapsed = Math.max(0, performance.now() - start);
  return Response.json(health, {
    headers: {
      "Cache-Control": "no-store",
      "Server-Timing": `health;dur=${elapsed.toFixed(1)};desc="D1 health diagnostics"`,
    },
  });
}
