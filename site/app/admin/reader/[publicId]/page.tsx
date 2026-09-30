import { notFound, redirect } from "next/navigation";
import { getAdminReaderPost } from "@/db/queries";
import { getAdminIdentity } from "@/server/auth/admin-auth";
import PostPageView from "@/features/reader/PostPageView";
import "../../admin-reader.css";
import { normalizeAdminReaderContext, type AdminReaderRange, type AdminReaderSource, type AdminReaderStatus } from "@/domain/reader/admin-reader-context";

export const dynamic="force-dynamic";

export default async function AdminReaderPage({params,searchParams}:{params:Promise<{publicId:string}>;searchParams:Promise<{range?:string;spaceId?:string;descendants?:string;q?:string;category?:string;status?:string;from?:string}>}){
  const admin=await getAdminIdentity();
  if(!admin)redirect("/admin/login");
  const {publicId}=await params;
  const search=await searchParams;
  const readerContext=normalizeAdminReaderContext({range:search.range as AdminReaderRange,spaceId:Number(search.spaceId),includeDescendants:search.descendants==="1",query:search.q,category:search.category,status:search.status as AdminReaderStatus,source:search.from as AdminReaderSource});
  const post=await getAdminReaderPost(publicId);
  if(!post)notFound();
  return <PostPageView post={post} readerScope="admin" adminReaderContext={readerContext}/>;
}
