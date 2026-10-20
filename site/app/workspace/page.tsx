import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** The workspace-management surface is retired; every signed-in account enters /admin. */
export default function WorkspacePage() {
  redirect("/admin");
}
