import { z } from "zod";
import { listUserWorkspaces } from "@/db/workspace-access";
import { scopedCategories,scopedPosts,scopedPost,scopedSpaces,scopedSpace,scopedActivity } from "@/db/workspace-content";
import { scopedAttachmentList,scopedAttachmentObject } from "@/db/workspace-media";
import { getContentPage } from "@/db/queries";
import { requireScope } from "../mcp-auth";
import { extractMarkdownOutline,postReadHint } from "./post-read";
import { MCP_ERROR_OUTPUT_FIELDS,IDENTIFIER_SCHEMA,SPACE_SCHEMA,toolResult,toolFailure,type McpToolContext } from "./shared";
import { WORKSPACE_ID_SCHEMA,workspaceCall,attachmentLink,toBase64 } from "./workspace-tool-context";

const generic=z.record(z.string(),z.unknown());
export function registerWorkspaceReadTools({server,origin,auth}:McpToolContext) {
  server.registerTool("list_workspaces",{
    title:"列出有权限的工作区",
    description:"列出当前星屿用户可访问的个人或组织工作区；其它用户的工作区不可见。",
    inputSchema:{},outputSchema:{workspaces:z.array(generic).optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:true},
  },async()=>{
    try {
      requireScope(auth,"xingyu.read");
      if(!auth.userId)throw new Error("请重新授权 MCP");
      return toolResult({ok:true,workspaces:await listUserWorkspaces(auth.userId)});
    }catch(error){return toolFailure(error);}
  });
  server.registerTool("list_categories",{
    title:"列出工作区分类",description:"只返回当前工作区的分类。",
    inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA},
    outputSchema:{categories:z.array(generic).optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:true},
  },async({workspace_id})=>workspaceCall(auth,workspace_id,"xingyu.read","read",
    async(ws,user)=>({categories:await scopedCategories(user,ws)})));
  server.registerTool("list_spaces",{
    title:"浏览工作区知识空间",description:"默认显示顶级空间。parent 可以使用同工作区内的空间 ID 或完整路径。",
    inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA,parent:SPACE_SCHEMA.optional(),query:z.string().trim().max(100).optional()},
    outputSchema:{parent:generic.nullable().optional(),spaces:z.array(generic).optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:true},
  },async({workspace_id,parent,query})=>workspaceCall(auth,workspace_id,"xingyu.read","read",async(ws,user)=>{
    const parentSpace=parent?await scopedSpace(user,ws,parent):null;
    const all=query?await scopedSpaces(user,ws,undefined):await scopedSpaces(user,ws,parentSpace?.id??null);
    return {parent:parentSpace,spaces:query?all.filter((s)=>String(s.name??"").includes(query)):all};
  }));
  server.registerTool("get_space",{
    title:"查看知识空间",description:"只读取有权访问的工作区内部空间。",
    inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA,space:SPACE_SCHEMA},
    outputSchema:{space:generic.optional(),...MCP_ERROR_OUTPUT_FIELDS},annotations:{readOnlyHint:true},
  },async({workspace_id,space})=>workspaceCall(auth,workspace_id,"xingyu.read","read",async(ws,user)=>{
    const node=await scopedSpace(user,ws,space);
    return {space:{...node,children:await scopedSpaces(user,ws,node.id)}};
  }));
  server.registerTool("search_posts",{
    title:"搜索工作区文章",description:"在选定工作区搜索文章。默认只返回目录，不读取全文；确认后用 get_post(view=content)。",
    inputSchema:{
      workspace_id:WORKSPACE_ID_SCHEMA,query:z.string().trim().max(200).optional().default(""),
      status:z.enum(["all","draft","published"]).optional().default("all"),
      category:z.string().trim().max(100).optional(),
      space:SPACE_SCHEMA.optional(),include_descendants:z.boolean().optional().default(true),
      detail:z.enum(["minimal","summary"]).optional().default("minimal"),
      page_size:z.number().int().min(1).max(50).optional().default(20),
      cursor:z.string().max(180).optional(),
    },
    outputSchema:{posts:z.array(generic).optional(),next_cursor:z.string().nullable().optional(),hint:z.string().optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:true},
  },async({workspace_id,query,status,space,detail,page_size})=>workspaceCall(auth,workspace_id,"xingyu.read","read",async(ws,user)=>{
    const spaceId=space?(await scopedSpace(user,ws,space)).id:undefined;
    const list=await scopedPosts(user,ws,query,page_size,spaceId);
    const posts=list.filter(row=>status==="all"||row.status===status).map(row=>
      detail==="summary"?{...row,visibility:row.spaceId?"space":"public"}:
      {public_id:row.publicId,title:row.title,status:row.status,version:row.version,visibility:row.spaceId?"space":"public"});
    return {posts,next_cursor:null,hint:"根据 public_id 确认目标后，再用 get_post(view=content) 获取全文。"};
  }));
  server.registerTool("get_post",{
    title:"读取工作区文章",description:"只有 view=content 才返回 Markdown 全文。读取前校验用户对文章所属工作区的权限。",
    inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA,identifier:IDENTIFIER_SCHEMA,view:z.enum(["meta","excerpt","outline","content"]).optional().default("outline")},
    outputSchema:{post:generic.optional(),hint:z.string().optional(),...MCP_ERROR_OUTPUT_FIELDS},annotations:{readOnlyHint:true},
  },async({workspace_id,identifier,view})=>workspaceCall(auth,workspace_id,"xingyu.read","read",async(ws,user)=>{
    const post=await scopedPost(user,ws,identifier);
    const body:Record<string,unknown>={
      public_id:post.publicId,version:post.version,title:post.title,slug:post.slug,status:post.status,
      visibility:post.spaceId===null?"public":"space",space_id:post.spaceId,category_id:post.categoryId,
      published_at:post.publishedAt,updated_at:post.updatedAt,view,
      public_url:post.status==="published"&&post.spaceId===null&&ws===1?origin+"/posts/"+post.publicId+"/"+post.slug:null,
    };
    if(view==="excerpt"||view==="content")body.excerpt=post.excerpt;
    if(view==="outline")body.outline=extractMarkdownOutline(post.content);
    if(view==="content")body.content_markdown=post.content;
    return {post:body,...(view==="content"?{}:{hint:postReadHint(view)})};
  }));
  server.registerTool("get_page",{
    title:"读取公开页面",description:"读取星屿博客公开的关于页或连接页。",
    inputSchema:{slug:z.enum(["about","connect"])},outputSchema:{page:generic.optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:true},
  },async({slug})=>{
    try{requireScope(auth,"xingyu.read");const page=await getContentPage(slug);return toolResult({ok:true,page});}
    catch(e){return toolFailure(e);}
  });
  server.registerTool("list_mcp_activity",{
    title:"查看当前工作区 AI 操作记录",description:"只返回当前用户有权访问的工作区审计记录。",
    inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA,limit:z.number().int().min(1).max(50).optional().default(20)},
    outputSchema:{activities:z.array(generic).optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:true},
  },async({workspace_id,limit})=>workspaceCall(auth,workspace_id,"xingyu.read","read",
    async(ws,user)=>({activities:await scopedActivity(user,ws,limit)})));
  server.registerTool("list_attachments",{
    title:"查看当前工作区文章附件",description:"附件访问必须通过对应文章和工作区授权。",
    inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA,identifier:IDENTIFIER_SCHEMA},
    outputSchema:{attachments:z.array(generic).optional(),...MCP_ERROR_OUTPUT_FIELDS},
    annotations:{readOnlyHint:true},
  },async({workspace_id,identifier})=>workspaceCall(auth,workspace_id,"xingyu.read","read",async(ws,user)=>{
    const rows=await scopedAttachmentList(user,ws,identifier);
    return {attachments:rows.map(a=>({...a,url:origin+attachmentLink(ws,String(a.publicId))}))};
  }));
  server.registerTool("download_attachment",{
    title:"下载私有附件",description:"按工作区权限读取附件。仅返回最多 8 MB 文件的 Base64。",
    inputSchema:{workspace_id:WORKSPACE_ID_SCHEMA,public_id:z.string().regex(/^att_[a-f0-9]{32}$/i)},
    outputSchema:{attachment:generic.optional(),...MCP_ERROR_OUTPUT_FIELDS},annotations:{readOnlyHint:true},
  },async({workspace_id,public_id})=>workspaceCall(auth,workspace_id,"xingyu.read","read",async(ws,user)=>{
    const {meta,object}=await scopedAttachmentObject(user,ws,public_id);
    if(meta.size>8*1024*1024)throw new Error("附件超过 MCP 下载上限 8 MB");
    return {attachment:{
      public_id:meta.publicId,filename:meta.originalName,content_type:meta.contentType,
      size:meta.size,sha256:meta.sha256,content_base64:toBase64(new Uint8Array(await object.arrayBuffer())),
    }};
  }));
}
