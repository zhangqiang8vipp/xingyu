import {redirect} from "next/navigation";

export const dynamic="force-dynamic";

/** Compatibility link only: collaboration lives in the existing knowledge-space workbench. */
export default async function CollaborationPage({searchParams}:{
  searchParams:Promise<{spaceId?:string}>;
}){
  const value=Number((await searchParams).spaceId??0);
  const spaceId=Number.isSafeInteger(value)&&value>0?"&spaceId="+value:"";
  redirect("/admin?section=spaces"+spaceId);
}
