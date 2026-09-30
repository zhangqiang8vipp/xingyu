import { getAdminStats } from "@/db/queries";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return unauthorized();
  return Response.json({ stats: await getAdminStats() }, { headers: { "Cache-Control": "no-store" } });
}
