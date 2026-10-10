import { z } from "zod";
import { env } from "cloudflare:workers";
import { getContentPage } from "@/db/queries";
import { workspaceGrant } from "@/db/workspace-access";
import { scopedPost,scopedCreateDraft,scopedUpdatePost,scopedStatusChange,
  scopedSpace,newScopedSpace,editScopedSpace,removeEmptyScopedSpace,WorkspaceContentError } from "@/db/workspace-content";
import { MCP_ERROR_OUTPUT_FIELDS,IDENTIFIER_SCHEMA,CATEGORY_SCHEMA,SPACE_SCHEMA,CHANGE_SUMMARY_SCHEMA,toolResult,toolFailure,type McpToolContext } from "./shared";
import { WORKSPACE_ID_SCHEMA,workspaceCall } from "./workspace-tool-context";
import { requireScope } from "../mcp-auth";

const obj=z.record(z.string(),z.unknown());
const receipt=(action:string,summary:string)=>({action,activity_id:null,summary,changed_fields:[],recorded_at:null});
function present(post:{publicId:string;version:number;title:string;slug:string;status:string;spaceId:number|null;publishedAt:string|null},origin:string,workspaceId:number){
  return {public_id:post.publicId,version:post.version,title:post.title,slug:post.slug,status:post.status,
    visibility:post.spaceId===null?"public":"space",space_id:post.spaceId,
    published_at:post.publishedAt,public_url:post.spaceId===null&&workspaceId===1&&post.status==="published"
      ?origin+"/posts/"+post.publicId+"/"+post.slug:null};
}
export function registerWorkspaceWriteTools({server,origin,auth,clientLabel}:McpToolContext){
  server.registerTool("create_draft",{
    title:"在工作区创建草稿",description:"仅在用户有写入权限的工作区创建草稿；个人工作区默认私有，永不自动公开发布。",
    inputSchema:{
      workspace_id:WORKSPACE_ID_SCHEMA,title:z.string().trim().min(1).max(200),
      content_markdown:z.string().max(750000).optional().default(""),
      excerpt:z.string().max(1000).optional().default(""),
      category:CATEGORY_SCHEMA.optional(),space:SPACE_SCHEMA.optional(),
      sort_order:z.number().int().optional(),slug:z.string().max(180).optional(),
      featured:z.boolean().optional().default(false),
      change_summary:CHANGE_SUMMARY_SCHEMA.optional().default("创建草稿"),
    },
    outputSchema:{post:obj.optional(),receipt:obj.optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false},
  },async({workspace_id,title,content_markdown,excerpt,category,space,sort_order,slug,featured,change_summary})=>
    workspaceCall(auth,workspace_id,"xingyu.draft","write",async(ws,user)=>{
      const post=await scopedCreateDraft(user,ws,{title,content:content_markdown,excerpt,category,space,sortOrder:sort_order,slug,featured},clientLabel,change_summary);
      return {post:present(post,origin,ws),receipt:receipt("create_draft",change_summary)};
    }));
  server.registerTool("update_post",{
    title:"更新工作区文章",description:"必须先用 get_post(view=content) 读完正文和版本号。只能修改当前用户有权限的文章。",
    inputSchema:{
      workspace_id:WORKSPACE_ID_SCHEMA,identifier:IDENTIFIER_SCHEMA,
      expected_version:z.number().int().min(1),title:z.string().trim().min(1).max(200).optional(),
      content_markdown:z.string().max(750000).optional(),excerpt:z.string().max(1000).optional(),
      category:CATEGORY_SCHEMA.optional(),space:SPACE_SCHEMA.nullable().optional(),
      sort_order:z.number().int().optional(),slug:z.string().max(180).optional(),
      featured:z.boolean().optional(),change_summary:CHANGE_SUMMARY_SCHEMA.optional().default("更新文章内容"),
    },
    outputSchema:{post:obj.optional(),receipt:obj.optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true},
  },async({workspace_id,identifier,expected_version,title,content_markdown,excerpt,category,space,sort_order,slug,featured,change_summary})=>{
    try{
      // Published content requires publish scope even if the operation only edits text.
      if(!auth.userId)throw new Error("请重新授权");
      const ws=await (await import("@/db/workspace-access")).resolveWorkspace(auth.userId,workspace_id,"write");
      const current=await scopedPost(auth.userId,ws,identifier);
      requireScope(auth,current.status==="published"?"xingyu.publish":"xingyu.draft");
      const post=await scopedUpdatePost(auth.userId,ws,identifier,{
        expectedVersion:expected_version,title,content:content_markdown,excerpt,category,space,
        sortOrder:sort_order,slug,featured,
      },clientLabel,change_summary);
      return toolResult({ok:true,workspace_id:ws,post:present(post,origin,ws),receipt:receipt("update_post",change_summary)});
    }catch(error){return toolFailure(error);}
  });
  for(const status of ["published","draft"] as const){
    const action=status==="published"?"publish_post":"unpublish_post";
    server.registerTool(action,{
      title:status==="published"?"发布/标记完成":"撤回为草稿",
      description:"必须经用户明确确认并提供当前文章的 expected_version；私人空间即使标记完成仍不会公开。",
      inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA,identifier:IDENTIFIER_SCHEMA,expected_version:z.number().int().min(1),
        change_summary:CHANGE_SUMMARY_SCHEMA.optional().default(status==="published"?"标记文章完成":"撤回文章")},
      outputSchema:{post:obj.optional(),receipt:obj.optional(),...MCP_ERROR_OUTPUT_FIELDS},
      annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true},
    },async({workspace_id,identifier,expected_version,change_summary})=>
      workspaceCall(auth,workspace_id,"xingyu.publish","write",async(ws,user)=>{
        const post=await scopedStatusChange(user,ws,identifier,expected_version,status,clientLabel,change_summary);
        return {post:present(post,origin,ws),receipt:receipt(action,change_summary)};
      }));
  }
  server.registerTool("create_space",{
    title:"创建知识空间",description:"在指定工作区创建空间。必须先确认工作区和父空间。",
    inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA,name:z.string().trim().min(1).max(100),
      parent:SPACE_SCHEMA.optional(),sort_order:z.number().int().optional(),change_summary:CHANGE_SUMMARY_SCHEMA},
    outputSchema:{space:obj.optional(),receipt:obj.optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false},
  },async({workspace_id,name,parent,sort_order,change_summary})=>
    workspaceCall(auth,workspace_id,"xingyu.draft","write",async(ws,user)=>{
      const parentId=parent?(await scopedSpace(user,ws,parent)).id:null;
      const space=await newScopedSpace(user,ws,{name,parentId,sortOrder:sort_order});
      return {space,receipt:receipt("create_space",change_summary)};
    }));
  server.registerTool("update_space",{
    title:"修改知识空间",description:"可以在当前工作区内重命名、排序或移动空间，不能跨工作区移动。",
    inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA,space:SPACE_SCHEMA,name:z.string().trim().min(1).max(100).optional(),
      parent:SPACE_SCHEMA.nullable().optional(),sort_order:z.number().int().optional(),change_summary:CHANGE_SUMMARY_SCHEMA},
    outputSchema:{space:obj.optional(),receipt:obj.optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true},
  },async({workspace_id,space,name,parent,sort_order,change_summary})=>
    workspaceCall(auth,workspace_id,"xingyu.publish","write",async(ws,user)=>{
      const s=await scopedSpace(user,ws,space);
      const parentId=parent===undefined?undefined:parent===null?null:(await scopedSpace(user,ws,parent)).id;
      return {space:await editScopedSpace(user,ws,s.id,{name,parentId,sortOrder:sort_order}),receipt:receipt("update_space",change_summary)};
    }));
  server.registerTool("move_space",{
    title:"移动知识空间",description:"只允许在同工作区内重新指定父空间。",
    inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA,space:SPACE_SCHEMA,parent:SPACE_SCHEMA.nullable(),change_summary:CHANGE_SUMMARY_SCHEMA},
    outputSchema:{space:obj.optional(),receipt:obj.optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true},
  },async({workspace_id,space,parent,change_summary})=>
    workspaceCall(auth,workspace_id,"xingyu.publish","write",async(ws,user)=>{
      const s=await scopedSpace(user,ws,space);
      const parentId=parent===null?null:(await scopedSpace(user,ws,parent)).id;
      return {space:await editScopedSpace(user,ws,s.id,{parentId}),receipt:receipt("move_space",change_summary)};
    }));
  server.registerTool("delete_space",{
    title:"删除空知识空间",description:"安全限制：只能删除完全为空的空间，不允许递归删除数据。",
    inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA,space:SPACE_SCHEMA,
      mode:z.enum(["empty","move","recursive"]).optional().default("empty"),
      move_to:SPACE_SCHEMA.optional(),confirm_name:z.string().optional(),change_summary:CHANGE_SUMMARY_SCHEMA},
    outputSchema:{result:obj.optional(),receipt:obj.optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true},
  },async({workspace_id,space,mode,change_summary})=>
    workspaceCall(auth,workspace_id,"xingyu.publish","write",async(ws,user)=>{
      if(mode!=="empty")throw new WorkspaceContentError("多用户模式不允许递归删除或隐式移动内容",403);
      const s=await scopedSpace(user,ws,space);
      return {result:await removeEmptyScopedSpace(user,ws,s.id),receipt:receipt("delete_space",change_summary)};
    }));
  server.registerTool("update_page",{
    title:"更新星屿公开页面（站点管理员）",description:"只允许网站所有者更新关于和接入页面，其他工作区永远不能修改网站页面。",
    inputSchema:{slug:z.enum(["about","connect"]),eyebrow:z.string().max(120).optional(),
      title:z.string().min(1).max(200).optional(),excerpt:z.string().max(1000).optional(),
      content_markdown:z.string().max(750000).optional(),change_summary:CHANGE_SUMMARY_SCHEMA},
    outputSchema:{page:obj.optional(),receipt:obj.optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true},
  },async({slug,eyebrow,title,excerpt,content_markdown,change_summary})=>{
    try{
      requireScope(auth,"xingyu.publish");
      if(auth.userId!==1)throw new WorkspaceContentError("仅站点所有者可更新公开页面",403);
      await workspaceGrant(auth.userId,1,"manage");
      const siteOwner=await env.DB.prepare("SELECT 1 FROM site_memberships WHERE user_id=? AND role='owner'").bind(auth.userId).first();
      if(!siteOwner)throw new WorkspaceContentError("没有公开站点管理权限",403);
      const current=await getContentPage(slug);
      if(!current)throw new WorkspaceContentError("页面不存在",404);
      const next={eyebrow:eyebrow??current.eyebrow,title:title??current.title,
        excerpt:excerpt??current.excerpt,content:content_markdown??current.content};
      const results=await env.DB.batch([
        env.DB.prepare("UPDATE content_pages SET eyebrow=?,title=?,excerpt=?,content=?,updated_at=CURRENT_TIMESTAMP WHERE slug=? AND eyebrow=? AND title=? AND excerpt=? AND content=?")
          .bind(next.eyebrow,next.title,next.excerpt,next.content,slug,current.eyebrow,current.title,current.excerpt,current.content),
        env.DB.prepare("INSERT INTO mcp_activity(workspace_id,action,post_id,public_id,title,before_status,after_status,changed_fields,summary,client_label) SELECT 1,'update_page',0,'page:'||slug,title,'published','published','[]',?,? FROM content_pages WHERE slug=? AND changes()=1 RETURNING id")
          .bind(change_summary,clientLabel,slug),
      ]);
      if(!results[1]?.results?.length)throw new WorkspaceContentError("页面已被其他写入修改，请重新读取",409);
      return toolResult({ok:true,page:{slug,title:next.title,public_url:origin+"/"+slug},receipt:receipt("update_page",change_summary)});
    }catch(error){return toolFailure(error);}
  });
}
