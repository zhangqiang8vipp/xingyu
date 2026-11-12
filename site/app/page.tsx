import { getCategories, getSiteSettings, listHomePosts } from "@/db/queries";
import { type PageSearchParams } from "./content-utils";
import NavTitleChrome from "@/features/navigation/NavTitleChrome";
import IslandSearch from "@/features/navigation/IslandSearch";
import AdminPreviewBridge from "./AdminPreviewBridge";
import SiteNavigation from "@/features/navigation/SiteNavigation";
import BlogHomeExperience from "@/features/home/BlogHomeExperience";
import XingyuMarketingHome from "@/features/home/XingyuMarketingHome";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: PageSearchParams }) {
  const search = await searchParams;
  const category = typeof search.category === "string" ? search.category : "all";
  const settings = await getSiteSettings();
  const [categories, rows] = await Promise.all([
    getCategories(),
    listHomePosts(category, settings.homePostLimit),
  ]);
  const adminPreview = search.adminPreview === "home";

  return (
    <main>
      <SiteNavigation brandName={settings.brandName} current="home">
        <NavTitleChrome targetId="home-hero-title" lead={adminPreview ? settings.heroLead : "知识"} tail={adminPreview ? settings.heroTail : "共同创造"} returnLabel="返回首页顶部" />
        <IslandSearch initialText={`${settings.heroLead}${settings.heroTail}`} />
      </SiteNavigation>

      {adminPreview
        ? <BlogHomeExperience settings={settings} categories={categories} posts={rows} selectedCategory={category}/>
        : <XingyuMarketingHome brandName={settings.brandName} posts={rows}/> }
      {adminPreview && <AdminPreviewBridge kind="home" />}
    </main>
  );
}
