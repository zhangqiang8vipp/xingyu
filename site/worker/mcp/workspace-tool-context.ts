import { z } from "zod";
import { resolveWorkspace } from "@/db/workspace-access";
import { requireScope, type McpAuth } from "../mcp-auth";
import { toolResult,toolFailure } from "./shared";

export const WORKSPACE_ID_SCHEMA=z.number().int().min(1).optional()
  .describe("目标工作区数字 ID；不填时使用当前个人工作区。先用 list_workspaces 确认可访问的工作区。");

export async function workspaceCall(auth:McpAuth,requested:number|undefined,scope:string,
  operation:"read"|"write",fn:(workspaceId:number,userId:number)=>Promise<Record<string,unknown>>) {
  try {
    requireScope(auth,scope);
    if(!auth.userId)throw new Error("未关联真实星屿账号的 MCP 连接已停用，请重新授权");
    const workspaceId=await resolveWorkspace(auth.userId,requested,operation);
    return toolResult({ok:true,workspace_id:workspaceId,...await fn(workspaceId,auth.userId)});
  } catch(error){return toolFailure(error);}
}
export const toBase64=(bytes:Uint8Array)=>{
  let binary="";
  for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
};
export function attachmentLink(workspaceId:number,attachmentId:string){
  return "/api/workspaces/"+workspaceId+"/attachments/"+attachmentId;
}
