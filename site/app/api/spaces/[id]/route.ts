import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { deleteSpace, getSpaceOverview, SpaceWriteError, updateSpace } from "@/db/spaces";

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!(await isAdminRequest(request)))return unauthorized();
  const {id}=await params;
  const space=await getSpaceOverview(Number(id));
  return space?Response.json({space}):Response.json({error:"空间不存在"},{status:404});
}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!(await isAdminRequest(request)))return unauthorized();
  try{
    const {id}=await params;
    const payload=await request.json() as Record<string,unknown>;
    const space=await updateSpace(Number(id),{
      name:payload.name===undefined?undefined:String(payload.name),
      slug:payload.slug===undefined?undefined:String(payload.slug),
      parentId:payload.parentId===undefined?undefined:Number(payload.parentId)>0?Number(payload.parentId):null,
      sortOrder:payload.sortOrder===undefined?undefined:Number(payload.sortOrder),
    });
    return Response.json({space});
  }catch(error){
    if(error instanceof SpaceWriteError)return Response.json({error:error.message},{status:error.status});
    return Response.json({error:"空间更新失败"},{status:500});
  }
}

export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!(await isAdminRequest(request)))return unauthorized();
  try{
    const {id}=await params;
    const payload=await request.json().catch(()=>({})) as Record<string,unknown>;
    const mode=payload.mode==="move"||payload.mode==="recursive"?payload.mode:"empty";
    return Response.json(await deleteSpace(Number(id),{
      mode,
      moveTo:Number(payload.moveTo)>0?Number(payload.moveTo):null,
      confirmName:payload.confirmName?String(payload.confirmName):undefined,
    }));
  }catch(error){
    if(error instanceof SpaceWriteError)return Response.json({error:error.message},{status:error.status});
    return Response.json({error:"空间删除失败"},{status:500});
  }
}
