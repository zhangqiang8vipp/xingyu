import { getSiteSettings } from "@/db/queries";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { updateSiteSettings } from "@/db/site-content";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  return Response.json({ settings: await getSiteSettings() }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  const payload = await request.json() as Record<string, unknown>;
  return Response.json({ settings: await updateSiteSettings(payload) });
}
