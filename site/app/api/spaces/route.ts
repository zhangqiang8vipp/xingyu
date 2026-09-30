import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { createSpace, getSpaceRootStats, listSpaceChildren, searchSpaces, SpaceWriteError } from "@/db/spaces";

export async function GET(request:Request){
  if(!(await isAdminRequest(request)))return unauthorized();
  const url=new URL(request.url);
  const query=url.searchParams.get("q")?.trim()??"";
  if(query){
    const rootId=Number(url.searchParams.get("root"));
    const rawScope=url.searchParams.get("scope");
    const scope=rawScope==="current"||rawScope==="descendants"?rawScope:"all";
    return Response.json({spaces:await searchSpaces(query,20,{rootId:rootId>0?rootId:undefined,scope})});
  }
  const rawParent=url.searchParams.get("parent");
  const parentId=rawParent&&rawParent!=="root"?Number(rawParent):null;
  const spaces=await listSpaceChildren(Number.isInteger(parentId)?parentId:null);
  return Response.json({spaces,...(parentId===null?{meta:await getSpaceRootStats()}:{})});
}

export async function POST(request:Request){
  if(!(await isAdminRequest(request)))return unauthorized();
  try{
    const payload=await request.json() as Record<string,unknown>;
    const space=await createSpace({
      name:String(payload.name??""),
      slug:payload.slug?String(payload.slug):undefined,
      parentId:Number(payload.parentId)>0?Number(payload.parentId):null,
      sortOrder:payload.sortOrder===undefined?0:Number(payload.sortOrder),
    });
    return Response.json({space},{status:201});
  }catch(error){
    if(error instanceof SpaceWriteError)return Response.json({error:error.message},{status:error.status});
    return Response.json({error:"空间创建失败"},{status:500});
  }
}
