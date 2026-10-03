import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/server/auth/admin-auth";
import { listMcpConnections } from "@/db/integrations";
import { getBetaActivationSignal } from "@/db/activation";
import { getAdminStats, getCategories, getContentPage, getSiteSettings } from "@/db/queries";
import AdminClient from "@/features/admin/AdminClient";
import { getAdminPost } from "@/db/queries";
import { parseAdminLocation } from "@/domain/admin/location";

export const dynamic = "force-dynamic";

export default async function AdminPage({searchParams}:{searchParams:Promise<{edit?:string;section?:string;visibility?:string;q?:string;category?:string;status?:string;spaceId?:string}>}) {
  const admin = await getAdminIdentity();
  if (!admin) redirect("/admin/login");
  const search=await searchParams;
  const editId=Number(search.edit);
  const params=new URLSearchParams();
  Object.entries(search).forEach(([key,value])=>{if(value!==undefined)params.set(key,value)});
  const initialLocation=parseAdminLocation(params);
  const [categories, settings, connectPage, aboutPage, stats, connections, initialArticle] = await Promise.all([getCategories(), getSiteSettings(), getContentPage("connect"), getContentPage("about"), getAdminStats(), listMcpConnections(),Number.isInteger(editId)&&editId>0?getAdminPost(editId):Promise.resolve(null)]);
  const activation = await getBetaActivationSignal(connections);
  return <AdminClient categories={categories} settings={settings} connectPage={connectPage!} aboutPage={aboutPage!} stats={stats} connections={connections} activation={activation} initialArticle={initialArticle} initialLocation={initialLocation} userName={admin.displayName} signOutPath="/api/admin/logout" />;
}
