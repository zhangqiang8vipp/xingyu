import { currentIdentity } from "@/server/auth/identity";
export async function GET() {
  return Response.json({ user: await currentIdentity() }, { headers: { "Cache-Control": "no-store" } });
}
