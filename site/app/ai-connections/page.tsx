import { redirect } from "next/navigation";
import { currentIdentity } from "@/server/auth/identity";
import { getSiteSettings } from "@/db/queries";
import AccountStyleLoader from "@/features/admin/AccountStyleLoader";
import AdminAccountFrame from "@/features/admin/AdminAccountFrame";
import PersonalTokensPanel from "@/features/admin/PersonalTokensPanel";
import ClientSetupGuide from "@/features/admin/ClientSetupGuide";
import ConnectionsPanel from "@/app/workspace/ConnectionsPanel";

export const dynamic = "force-dynamic";

export default async function AiConnectionsPage() {
  const user = await currentIdentity();
  if (!user) redirect("/login?return_to=%2Fai-connections");
  const settings = await getSiteSettings();
  return <><AccountStyleLoader/><AdminAccountFrame area="ai-connections"
    brandName={settings.brandName} userName={user.displayName} isLegacyAdmin={user.userId === 1}>
    <PersonalTokensPanel />
    <ClientSetupGuide />
    <ConnectionsPanel />
  </AdminAccountFrame></>;
}
