import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Organization management remains available through authorized APIs/MCP, not the personal home UI. */
export default function OrganizationsPage() {
  redirect("/admin");
}
