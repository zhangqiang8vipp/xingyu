import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/server/auth/admin-auth";
import PostPageView from "@/features/reader/PostPageView";

export const dynamic="force-dynamic";

/** A stable, private shell for every draft preview. It never leaks another article. */
export default async function ArticlePreviewEntry(){
  if(!await getAdminIdentity())redirect("/admin/login");
  return <PostPageView adminPreview post={{
    id:-1, publicId:"admin-preview", slug:"admin-preview", title:"正在预览草稿",
    excerpt:"未保存的标题、摘要和正文会实时显示在这里。", content:"从左侧开始写作，正文会在这里实时呈现。",
    publishedAt:null, viewCount:0, categoryName:"草稿预览", categorySlug:"draft-preview", categoryColor:"#0A84FF",
  }} />;
}
