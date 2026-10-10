import { redirect } from "next/navigation";
import { currentIdentity } from "@/server/auth/identity";
import { listMyOrganizations } from "@/db/organization-access";
import ConsoleShell from "@/app/console/ConsoleShell";
import OrganizationsClient from "./OrganizationsClient";
export const dynamic="force-dynamic";
export default async function OrganizationsPage() {
  const user=await currentIdentity();
  if(!user)redirect("/login");
  const organizations=await listMyOrganizations(user.userId);
  return <ConsoleShell area="organizations" userName={user.displayName} isLegacyAdmin={user.userId===1}>
    <OrganizationsClient initialOrganizations={organizations}/>
  </ConsoleShell>;
}
