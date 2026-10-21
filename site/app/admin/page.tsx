import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/server/auth/admin-auth";
import { currentIdentity } from "@/server/auth/identity";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { scopedCategories, scopedPost } from "@/db/workspace-content";
import { listMcpConnections } from "@/db/integrations";
import { getBetaActivationSignal } from "@/db/activation";
import { getAdminStats, getCategories, getContentPage, getSiteSettings } from "@/db/queries";
import AdminClient from "@/features/admin/AdminClient";
import { getAdminPost } from "@/db/queries";
import { parseAdminLocation } from "@/domain/admin/location";

export const dynamic = "force-dynamic";

export default async function AdminPage({searchParams}:{searchParams:Promise<{edit?:string;section?:string;visibility?:string;q?:string;category?:string;status?:string;spaceId?:string}>}) {
  const user = await currentIdentity();
  const admin = await getAdminIdentity(user);
  if (!admin) {
    if (!user) redirect("/login?return_to=%2Fadmin");
    if (user.userId === 1) redirect("/admin/login");
    const search = await searchParams;
    const params = new URLSearchParams();
    Object.entries(search).forEach(([key,value])=>{if(value!==undefined)params.set(key,value)});
    const parsedLocation = parseAdminLocation(params);
    const initialLocation = parsedLocation;
    const workspaceId = await ensurePersonalWorkspace(user.userId);
    const [personalCategories, publicCategories, settings, connectPage, aboutPage] = await Promise.all([
      scopedCategories(user.userId, workspaceId),
      getCategories(),
      getSiteSettings(),
      getContentPage("connect"),
      getContentPage("about"),
    ]);
    const categories = [...personalCategories, ...publicCategories.filter((item) => !personalCategories.some((own) => own.id === item.id))];
    let initialArticle = null;
    const editId = Number(search.edit);
    if (Number.isInteger(editId) && editId > 0) {
      try {
        const post = await scopedPost(user.userId, workspaceId, editId);
        initialArticle = {
          id: post.id, publicId: post.publicId, version: post.version, title: post.title, slug: post.slug,
          excerpt: post.excerpt, content: post.content, categoryId: post.categoryId, spaceId: post.spaceId,
          spacePath: "个人知识空间", status: "draft" as const, featured: false, publishedAt: null,
          visibility: "personal" as const,
        };
      } catch { initialArticle = null; }
    }
    return <AdminClient
      categories={categories as Awaited<ReturnType<typeof getCategories>>}
      settings={settings}
      connectPage={connectPage!}
      aboutPage={aboutPage!}
      stats={{total:0,published:0,drafts:0,views:0,privateArticles:0}}
      connections={[]}
      activation={{stage:"needs-knowledge",activated:false,knowledgeCount:0,connected:false,connectionNames:[],privateWrite:null}}
      initialArticle={initialArticle}
      initialLocation={initialLocation}
      userName={user.displayName}
      signOutPath="/api/identity/logout"
      isPersonalAccount
    />;
  }
  const search=await searchParams;
  const editId=Number(search.edit);
  const params=new URLSearchParams();
  Object.entries(search).forEach(([key,value])=>{if(value!==undefined)params.set(key,value)});
  const initialLocation=parseAdminLocation(params);
  const [categories, settings, connectPage, aboutPage, stats, connections, initialArticle] = await Promise.all([getCategories(), getSiteSettings(), getContentPage("connect"), getContentPage("about"), getAdminStats(), listMcpConnections(),Number.isInteger(editId)&&editId>0?getAdminPost(editId):Promise.resolve(null)]);
  const activation = await getBetaActivationSignal(connections);
  return <AdminClient categories={categories} settings={settings} connectPage={connectPage!} aboutPage={aboutPage!} stats={stats} connections={connections} activation={activation} initialArticle={initialArticle} initialLocation={initialLocation} userName={admin.displayName} signOutPath="/api/admin/logout" />;
}
