import { AttachmentError, deleteAttachment, getAttachment } from "@/db/attachments";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { scopedPost, WorkspaceContentError } from "@/db/workspace-content";
import { identityFromRequest } from "@/server/auth/identity-session";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";

export async function DELETE(request: Request, context: { params: Promise<{ publicId: string }> }) {
  if (!(await isAdminRequest(request))) {
    const user=await identityFromRequest(request);
    if(!user||user.userId===1)return unauthorized();
    try{
      const {publicId}=await context.params;
      if(!/^att_[a-f0-9]{32}$/i.test(publicId))return Response.json({error:"附件标识无效"},{status:400,headers:{"Cache-Control":"no-store"}});
      const workspaceId=await ensurePersonalWorkspace(user.userId);
      const attachment=await getAttachment(publicId.toLowerCase());
      if(!attachment||attachment.workspaceId!==workspaceId)return Response.json({error:"附件不存在或已经删除"},{status:404,headers:{"Cache-Control":"no-store"}});
      if(attachment.postId!==null)await scopedPost(user.userId,workspaceId,attachment.postId);
      const payload=await request.json().catch(()=>({})) as Record<string,unknown>;
      const deleted=await deleteAttachment(publicId.toLowerCase(),payload.version as number|undefined,{workspaceId,actorUserId:user.userId});
      return Response.json({deleted:true,version:deleted.version},{headers:{"Cache-Control":"no-store"}});
    }catch(error){
      if(error instanceof AttachmentError)return Response.json({error:error.message},{status:error.status,headers:{"Cache-Control":"no-store"}});
      if(error instanceof WorkspaceContentError)return Response.json({error:error.message},{status:error.status,headers:{"Cache-Control":"no-store"}});
      console.error("personal attachment delete failed",error instanceof Error?error.name:"unknown");
      return Response.json({error:"附件删除失败，请稍后重试"},{status:500,headers:{"Cache-Control":"no-store"}});
    }
  }
  try {
    const { publicId } = await context.params;
    if (!/^att_[a-f0-9]{32}$/i.test(publicId)) {
      return Response.json({ error: "附件标识无效" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
    const deleted = await deleteAttachment(publicId.toLowerCase(), payload.version as number | undefined);
    return Response.json({ deleted: true, version: deleted.version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AttachmentError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("attachment delete failed", error);
    return Response.json({ error: "附件删除失败，请稍后重试" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
