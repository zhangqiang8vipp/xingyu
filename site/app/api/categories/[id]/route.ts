import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";
import { CategoryServiceError, deleteCategory, updateCategory } from "@/db/categories";

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!(await isAdminRequest(request)))return unauthorized();
  const {id}=await params; const payload=await request.json() as {name?:string;slug?:string;color?:string};
  try{return Response.json({category:await updateCategory(Number(id),payload)});}
  catch(error){
    if(error instanceof CategoryServiceError)return Response.json({error:error.message},{status:error.status});
    return Response.json({error:"分类保存失败"},{status:500});
  }
}

export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!(await isAdminRequest(request)))return unauthorized(); const {id}=await params;
  try{await deleteCategory(Number(id));return Response.json({ok:true});}
  catch(error){
    if(error instanceof CategoryServiceError)return Response.json({error:error.message},{status:error.status});
    return Response.json({error:"分类删除失败"},{status:500});
  }
}
