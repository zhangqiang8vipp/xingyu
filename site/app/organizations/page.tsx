import {redirect} from "next/navigation";
import {currentIdentity} from "@/server/auth/identity";
import {getSiteSettings} from "@/db/queries";
import {listMyOrganizations} from "@/db/organization-access";
import AdminAccountFrame from "@/features/admin/AdminAccountFrame";
import AccountStyleLoader from "@/features/admin/AccountStyleLoader";
import OrganizationsClient from "./OrganizationsClient";

export const dynamic="force-dynamic";
export default async function OrganizationsPage(){
  const user=await currentIdentity();
  if(!user)redirect("/login");
  const [settings,organizations]=await Promise.all([
    getSiteSettings(),listMyOrganizations(user.userId),
  ]);
  return <><AccountStyleLoader/><AdminAccountFrame area="organizations" brandName={settings.brandName}
    userName={user.displayName} isLegacyAdmin={user.userId===1}>
    <OrganizationsClient initialOrganizations={organizations}/>
  </AdminAccountFrame></>;
}
