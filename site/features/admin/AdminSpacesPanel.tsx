"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readApiJson } from "@/app/api-response";
import type { AdminReaderContext } from "@/domain/reader/admin-reader-context";
import AdminSpacePicker, { type SpaceChoice } from "./AdminSpacePicker";
import AdminKnowledgeImport from "./AdminKnowledgeImport";
import AdminSpaceCollaborationDialog from "./AdminSpaceCollaborationDialog";
import AdminSpaceCoauthorDialog from "./AdminSpaceCoauthorDialog";
import AdminPreviewShareDialog from "./AdminPreviewShareDialog";
import AdminDocumentPreviewDialog from "./AdminDocumentPreviewDialog";

type SpaceNode={id:number;parentId:number|null;name:string;slug:string;sortOrder:number;childCount:number;articleCount:number;totalArticleCount?:number;latestActivityAt?:string;childPreview?:string|null;updatedAt:string;path?:PathNode[];isInvited?:boolean;ancestorOnly?:boolean;canRead?:boolean;canWrite?:boolean;canManage?:boolean;role?:string|null};
type PathNode={id:number;parentId:number|null;name:string;slug:string};
type Overview=SpaceNode&{path:PathNode[];children:SpaceNode[];descendantCount:number;articleCount:number};
type SpacePost={id:number;publicId:string;title:string;slug:string;excerpt:string;status:"draft"|"published";categoryName:string;updatedAt:string;spaceId:number;spacePath:string;sortOrder:number;canWrite?:boolean;canManage?:boolean};
type DialogState={kind:"create"|"rename"|"sort"|"move"|"delete";target?:SpaceNode};
type DialogImpact={descendantCount:number;articleCount:number}|null;

export default function AdminSpacesPanel({initialSpaceId=null,createOnOpen=false,onLocationChange,onCreateArticle,onEditArticle,onBrowseArticle,onShareArticle,isPersonalAccount=false,authorName,avatarUrl}:{initialSpaceId?:number|null;createOnOpen?:boolean;onLocationChange?:(spaceId:number|null)=>void;onCreateArticle:(spaceId:number,spacePath:string)=>void;onEditArticle:(postId:number)=>void;onBrowseArticle:(postId:number,readerContext:AdminReaderContext)=>void;onShareArticle:(post:{id:number;title:string})=>void;isPersonalAccount?:boolean;authorName:string;avatarUrl:string}){
  const [roots,setRoots]=useState<SpaceNode[]>([]);
  const [rootMeta,setRootMeta]=useState({rootCount:0,spaceCount:0,articleCount:0});
  const currentId=initialSpaceId;
  const [overview,setOverview]=useState<Overview|null>(null);
  const [posts,setPosts]=useState<SpacePost[]>([]);
  const [spaceMatches,setSpaceMatches]=useState<SpaceNode[]>([]);
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [loadingMore,setLoadingMore]=useState(false);
  const [query,setQuery]=useState("");
  const [searchKind,setSearchKind]=useState<"all"|"spaces"|"articles">("all");
  const [scope,setScope]=useState<"current"|"descendants"|"all">("descendants");
  const [dialog,setDialog]=useState<DialogState|null>(createOnOpen?{kind:"create"}:null);
  const [name,setName]=useState("");
  const [sortOrder,setSortOrder]=useState("0");
  const [moveTarget,setMoveTarget]=useState<SpaceChoice|null>(null);
  const [deleteMode,setDeleteMode]=useState<"empty"|"move"|"recursive">("empty");
  const [confirmName,setConfirmName]=useState("");
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(true);
  const [treeOpen,setTreeOpen]=useState(false);
  const [treeVersion,setTreeVersion]=useState(0);
  const [expandedGroupId,setExpandedGroupId]=useState<number|null>(null);
  const [dialogImpact,setDialogImpact]=useState<DialogImpact>(null);
  const [collabTarget,setCollabTarget]=useState<SpaceNode|null>(null);
  const [coauthor,setCoauthor]=useState<{publicId?:string;spaceId:number;name:string;canWrite:boolean}|null>(null);
  const [previewTarget,setPreviewTarget]=useState<SpacePost|null>(null);
  const [shareTarget,setShareTarget]=useState<{id:number;publicId:string;title:string}|null>(null);
  const loadRequest=useRef(0);

  const selectSpace=(spaceId:number|null)=>{
    if(spaceId!==currentId){
      setScope("descendants");
      setQuery("");
      setExpandedGroupId(null);
    }
    onLocationChange?.(spaceId);
  };

  const loadRoots=useCallback(async()=>{
    setLoading(true);
    try{
      const response=await fetch("/api/spaces?parent=root");
      const data=await readApiJson<{spaces:SpaceNode[];meta?:{rootCount:number;spaceCount:number;articleCount:number}}>(response);
      setRoots(data.spaces??[]);
      if(data.meta)setRootMeta(data.meta);
    }finally{
      if(!currentId)setLoading(false);
    }
  },[currentId]);
  const loadCurrent=useCallback(async()=>{
    const requestId=++loadRequest.current;
    if(!currentId){setOverview(null);setPosts([]);setSpaceMatches([]);setNextCursor(null);return}
    setLoading(true);
    try{
      const articleSearchDisabled=Boolean(query.trim()&&searchKind==="spaces");
      const params=new URLSearchParams({scope,q:query});
      const [spaceResponse,postsResponse,matchesResponse]=await Promise.all([
        fetch(`/api/spaces/${currentId}`),
        articleSearchDisabled?Promise.resolve(null):fetch(`/api/spaces/${currentId}/posts?${params}`),
        query.trim()&&searchKind!=="articles"?fetch(`/api/spaces?q=${encodeURIComponent(query.trim())}&root=${currentId}&scope=${scope}`):Promise.resolve(null),
      ]);
      if(requestId!==loadRequest.current)return;
      if(spaceResponse.ok)setOverview((await readApiJson<{space:Overview}>(spaceResponse)).space);
      else setOverview(null);
      if(postsResponse?.ok){
        const data=await readApiJson<{rows:SpacePost[];nextCursor:string|null}>(postsResponse);
        setPosts(data.rows??[]);setNextCursor(data.nextCursor??null);
      }else {setPosts([]);setNextCursor(null)}
      if(matchesResponse?.ok)setSpaceMatches((await readApiJson<{spaces:SpaceNode[]}>(matchesResponse)).spaces??[]);
      else setSpaceMatches([]);
    }finally{if(requestId===loadRequest.current)setLoading(false)}
  },[currentId,query,scope,searchKind]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>void loadRoots(),0);
    return()=>window.clearTimeout(timer);
  },[loadRoots]);
  useEffect(()=>{
    const timer=window.setTimeout(()=>void loadCurrent(),query?160:0);
    return()=>window.clearTimeout(timer);
  },[loadCurrent,query]);
  useEffect(()=>{
    const refresh=()=>{void Promise.all([loadRoots(),loadCurrent()])};
    window.addEventListener("xingyu:spaces-changed",refresh);
    return()=>window.removeEventListener("xingyu:spaces-changed",refresh);
  },[loadRoots,loadCurrent]);

  const pathLabel=overview?.path.map((item)=>item.name).join(" / ")??"";
  const readerContext:AdminReaderContext=scope==="all"?{range:"private",source:"spaces"}:{range:"space",spaceId:currentId!,includeDescendants:scope==="descendants",source:"spaces"};
  const loadMore=async()=>{
    if(!currentId||!nextCursor||loadingMore)return;
    setLoadingMore(true);
    try{
      const params=new URLSearchParams({scope,q:query,cursor:nextCursor});
      const response=await fetch(`/api/spaces/${currentId}/posts?${params}`);
      if(response.ok){
        const data=await readApiJson<{rows:SpacePost[];nextCursor:string|null}>(response);
        setPosts((current)=>[...current,...(data.rows??[])]);
        setNextCursor(data.nextCursor??null);
      }
    }finally{setLoadingMore(false)}
  };
  const beginDialog=(kind:DialogState["kind"],target?:SpaceNode)=>{
    if(isPersonalAccount&&kind==="delete")setDeleteMode("empty");
    setDialog({kind,target});
    setName(kind==="rename"&&target?target.name:"");
    setSortOrder(String(target?.sortOrder??0));
    setMoveTarget(null);setDeleteMode("empty");setConfirmName("");setMessage("");
    setDialogImpact(target?{descendantCount:target.childCount,articleCount:target.articleCount}:null);
    if(target&&(kind==="move"||kind==="delete")){
      void fetch(`/api/spaces/${target.id}`).then(async(response)=>{
        if(!response.ok)return;
        const data=await readApiJson<{space:Overview}>(response);
        setDialogImpact({descendantCount:data.space.descendantCount,articleCount:data.space.articleCount});
      });
    }
  };
  const submitDialog=async()=>{
    if(!dialog)return;
    const target=dialog.target;
    let response:Response;
    if(dialog.kind==="create"){
      response=currentId&&overview?.isInvited
        ?await fetch("/api/space-collaboration/"+currentId,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create_child",name})})
        :await fetch("/api/spaces",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,parentId:currentId,sortOrder:Number(sortOrder)})});
    }else if(dialog.kind==="rename"&&target){
      response=await fetch(`/api/spaces/${target.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
    }else if(dialog.kind==="sort"&&target){
      response=await fetch(`/api/spaces/${target.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({sortOrder:Number(sortOrder)})});
    }else if(dialog.kind==="move"&&target){
      response=await fetch(`/api/spaces/${target.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({parentId:moveTarget?.id??null})});
    }else if(dialog.kind==="delete"&&target){
      response=await fetch(`/api/spaces/${target.id}`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:deleteMode,moveTo:moveTarget?.id??target.parentId,confirmName})});
    }else return;
    const data=await readApiJson<{error?:string}>(response);
    if(!response.ok){setMessage(data.error??"操作失败");return}
    if(dialog.kind==="delete"&&target?.id===currentId)selectSpace(target.parentId);
    setDialog(null);setMessage("");
    await Promise.all([loadRoots(),loadCurrent()]);
    setTreeVersion((version)=>version+1);
  };
  const deleteInvitedEmptySpace=async(target:SpaceNode)=>{
    if(!target.isInvited||target.canManage!==true||target.ancestorOnly||target.parentId===null)return;
    if(!window.confirm("仅能删除完全空白的子空间「"+target.name+"」，确定继续？"))return;
    setMessage("");
    try{
      const response=await fetch("/api/space-collaboration/"+target.id,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"delete_empty"}),
      });
      const data=await readApiJson<{error?:string}>(response);
      if(!response.ok){setMessage(data.error??"删除失败");return;}
      if(target.id===currentId)selectSpace(target.parentId);
      await Promise.all([loadRoots(),loadCurrent()]);
      setTreeVersion(v=>v+1);setMessage("空子空间已删除");
    }catch(e){setMessage(e instanceof Error?e.message:"删除失败");}
  };
  const currentActions=overview?{id:overview.id,parentId:overview.parentId,name:overview.name,slug:overview.slug,sortOrder:overview.sortOrder,
    childCount:overview.children.length,articleCount:overview.articleCount,updatedAt:overview.updatedAt,
    isInvited:overview.isInvited,ancestorOnly:overview.ancestorOnly,canManage:overview.canManage,canWrite:overview.canWrite,role:overview.role}:undefined;
  const canRead=Boolean(overview&&!overview.ancestorOnly&&overview.canRead!==false);
  const canWrite=Boolean(canRead&&overview?.canWrite!==false);
  const canManage=Boolean(canRead&&overview?.canManage!==false);
  const sharedRole=overview?.role==="viewer"?"只读":overview?.role==="editor"?"可编辑":overview?.role==="admin"?"管理员":"所有者";
  const postGroups:{spaceId:number;path:string;rows:SpacePost[]}[]=[];
  for(const post of posts){
    const last=postGroups.at(-1);
    if(last?.spaceId===post.spaceId)last.rows.push(post);
    else postGroups.push({spaceId:post.spaceId,path:post.spacePath,rows:[post]});
  }
  const openGroupId=expandedGroupId===-1?-1:postGroups.some((group)=>group.spaceId===expandedGroupId)?expandedGroupId:postGroups[0]?.spaceId;
  const deletePost=async(post:SpacePost)=>{
    const typed=window.prompt("删除后不可恢复。请输入文档标题「"+post.title+"」确认删除：");
    if(typed===null)return;
    if(typed!==post.title){setMessage("文档名称不匹配，已取消删除");return;}
    try{
      const path="/api/space-collaboration/documents/"+encodeURIComponent(post.publicId);
      const current=await fetch(path,{cache:"no-store"});
      const loaded=await readApiJson<{document?:{title:string;version:number};error?:string}>(current);
      if(!current.ok||!loaded.document){setMessage(loaded.error??"无法读取最新文档版本");return;}
      if(loaded.document.title!==typed){setMessage("标题已经发生变化，请刷新页面后确认");return;}
      const response=await fetch(path,{method:"DELETE",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({expectedVersion:loaded.document.version,confirmTitle:typed})});
      const data=await readApiJson<{error?:string}>(response);
      if(!response.ok){setMessage(data.error??"删除失败");return;}
      setCoauthor(null);setShareTarget(null);
      setMessage("文档已删除，相关预览链接已失效");
      await Promise.all([loadRoots(),loadCurrent()]);
      setTreeVersion(v=>v+1);
    }catch(e){setMessage(e instanceof Error?e.message:"删除失败");}
  };
  const renderPost=(post:SpacePost)=>{
    const mayWrite=post.canWrite??canWrite;
    const mayDelete=post.canManage??canManage;
    const openDocument=()=>setCoauthor({
      publicId:post.publicId,spaceId:post.spaceId,name:overview?.name??"知识空间",
      canWrite:mayWrite,
    });
    return <article key={post.id}><div><small>{post.categoryName} · {post.status==="published"?"内容完成":"草稿"} · {new Date(post.updatedAt).toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"})}</small><b>{post.title}</b><p>{post.excerpt||"暂无摘要"}</p></div><div>
      {overview?.isInvited?<><button onClick={()=>setPreviewTarget(post)}>预览</button>
        {mayWrite?<button onClick={()=>setShareTarget(post)}>分享</button>:null}
        <button onClick={()=>mayWrite?openDocument():setPreviewTarget(post)}>{mayWrite?"共创编辑":"阅读"}</button>
      </>:<>
        <button onClick={()=>onBrowseArticle(post.id,readerContext)}>浏览</button>
        <button onClick={()=>setPreviewTarget(post)}>预览</button>
        {mayWrite?(!isPersonalAccount?<button onClick={()=>onShareArticle(post)}>分享</button>
          :<button onClick={()=>setShareTarget(post)}>分享</button>):null}
        {mayWrite?<button onClick={()=>onEditArticle(post.id)}>编辑 ↗</button>:null}
        <button onClick={()=>openDocument()}>版本共创</button>
      </>}
      {mayDelete?<button className="space-document-delete" onClick={()=>void deletePost(post)}>删除</button>:null}
    </div></article>;
  };

  if(!currentId)return <section className="admin-main spaces-root">
    <header className="admin-header"><div><p>KNOWLEDGE SPACES</p><h1>知识空间</h1><span>顶级空间彼此独立；个人空间与受邀共创空间集中管理，权限互不混淆。</span></div><button className="new-button" onClick={()=>beginDialog("create")}>＋ 新建顶级空间</button></header>
    {message&&!dialog?<p className="space-collab-notice" role="status">{message}</p>:null}
    <div className="spaces-root-summary"><span>{rootMeta.rootCount} 个顶级入口 · {rootMeta.articleCount} 篇可访问文章</span><i/><span>{rootMeta.spaceCount} 个可见空间节点</span><i/>只展示已授权空间及必要的上级路径</div>
    <div className="space-domain-grid">{roots.map((space)=><article className="space-domain-card" key={space.id} onClick={()=>selectSpace(space.id)}>
      <div><i/><span>{space.ancestorOnly?"上级路径 · 仅导航":space.isInvited?"受邀空间":space.childCount+" 个子空间"}</span><SpaceActions space={space} onAction={beginDialog} onCollaborate={setCollabTarget} onDeleteEmpty={deleteInvitedEmptySpace}/></div>
      <h2>{space.name}</h2><p>{space.ancestorOnly?"仅可查看上级目录名称":(space.childPreview||"尚未创建子空间")+" · "+(space.totalArticleCount??space.articleCount)+" 篇知识文章"}</p><footer><span>{space.ancestorOnly?"路径导航":space.isInvited?"按授权范围访问":"最近更新 "+new Date(space.latestActivityAt??space.updatedAt).toLocaleDateString("zh-CN")}</span><b>进入空间 ↗</b></footer>
    </article>)}</div>
    {!roots.length&&!loading&&<div className="space-empty"><i>◇</i><h2>从第一个知识空间开始</h2><p>先建立一个私有空间，再添加知识文章；需要合作时，可从空间操作里邀请共创。空间内容默认不会出现在公开博客。</p><button onClick={()=>beginDialog("create")}>创建我的第一个空间 →</button></div>}
    {collabTarget&&<AdminSpaceCollaborationDialog spaceId={collabTarget.id} spaceName={collabTarget.name} onClose={()=>setCollabTarget(null)} onUpdated={()=>window.dispatchEvent(new Event("xingyu:spaces-changed"))}/>}
    {dialog&&<SpaceDialog dialog={dialog} impact={dialogImpact} isPersonalAccount={isPersonalAccount} name={name} setName={setName} sortOrder={sortOrder} setSortOrder={setSortOrder} moveTarget={moveTarget} setMoveTarget={setMoveTarget} deleteMode={deleteMode} setDeleteMode={setDeleteMode} confirmName={confirmName} setConfirmName={setConfirmName} message={message} onClose={()=>setDialog(null)} onSubmit={submitDialog}/>}
  </section>;

  return <section className="admin-main spaces-page">
    <header className="admin-header space-page-header"><div><button className="space-back" onClick={()=>selectSpace(overview?.parentId??null)}>←</button>
      <p>{overview?.ancestorOnly?"NAVIGATION ONLY":overview?.isInvited?"SHARED KNOWLEDGE":"PRIVATE KNOWLEDGE"}</p>
      <h1>{overview?.name??"知识空间"}</h1>
      <SpaceBreadcrumb path={overview?.path??[]} onSelect={selectSpace}/>
      {overview?.isInvited?<span className="space-shared-access">{overview.ancestorOnly?"上级路径 · 仅可查看名称":"受邀协作 · "+sharedRole}</span>:null}
    </div><div className="space-header-actions">
      <button className="space-mobile-tree-toggle" onClick={()=>setTreeOpen(true)}>☰ 空间路径</button>
      {canWrite?<button onClick={()=>beginDialog("create")}>＋ 子空间</button>:null}
      {overview&&!isPersonalAccount&&canManage?<AdminKnowledgeImport spaceId={overview.id} spaceName={overview.name}/>:null}
      {canWrite?<button className="new-button" onClick={()=>{
        if(!overview)return;
        if(overview.isInvited)setCoauthor({spaceId:overview.id,name:overview.name,canWrite:true});
        else onCreateArticle(overview.id,pathLabel);
      }}>＋ 新建文章</button>:null}
      {currentActions?<SpaceActions space={currentActions} onAction={beginDialog} onCollaborate={setCollabTarget} onDeleteEmpty={deleteInvitedEmptySpace}/>:null}
    </div></header>
    {message&&!dialog?<p className="space-collab-notice" role="status">{message}</p>:null}
    <div className="space-workbench">
      {treeOpen&&<button className="space-tree-mobile-backdrop" aria-label="关闭空间树" onClick={()=>setTreeOpen(false)}/>}
      <aside className={`space-tree-panel ${treeOpen?"mobile-open":""}`}><div><b>知识空间</b><button onClick={()=>{selectSpace(null);setTreeOpen(false)}}>全部</button></div><label><span>⌕</span><input value={query} onChange={(event)=>{setQuery(event.target.value);setExpandedGroupId(null)}} placeholder="搜索空间或文章"/></label><div className="space-search-kind"><button className={searchKind==="all"?"active":""} onClick={()=>setSearchKind("all")}>全部</button><button className={searchKind==="spaces"?"active":""} onClick={()=>setSearchKind("spaces")}>空间</button><button className={searchKind==="articles"?"active":""} onClick={()=>setSearchKind("articles")}>正文</button></div><nav>{query&&spaceMatches.length>0&&<div className="space-tree-search-results"><small>空间</small>{spaceMatches.map((space)=><button key={space.id} onClick={()=>{selectSpace(space.id);setQuery("");setTreeOpen(false)}}><b>{space.name}</b><span>{space.path?.map((item)=>item.name).join(" / ")}</span></button>)}<small>空间树</small></div>}{roots.map((space)=><SpaceTreeNode key={`${space.id}-${treeVersion}`} node={space} currentId={currentId} activePathIds={overview?.path.map((item)=>item.id)??[]} onSelect={(id)=>{selectSpace(id);setTreeOpen(false)}}/>)}</nav></aside>
      <div className="space-content">
        <div className="space-content-intro"><div><span>{overview?.children.length??0} 个直属子空间 · {overview?.ancestorOnly?0:overview?.articleCount??0} 篇可访问文章（含下级）</span><p>{pathLabel}</p></div>
      {!overview?.ancestorOnly?<div className="space-scope">
        <button className={scope==="descendants"?"active":""} onClick={()=>{setScope("descendants");setExpandedGroupId(null)}}>包含子空间</button>
        <button className={scope==="current"?"active":""} onClick={()=>{setScope("current");setExpandedGroupId(null)}}>仅当前空间</button>
        {!overview?.isInvited?<button className={scope==="all"?"active":""} onClick={()=>{setScope("all");setExpandedGroupId(null)}}>全部空间</button>:null}
      </div>:null}</div>
        {!!overview?.children.length&&<><div className="space-section-heading"><b>子空间</b><span>按浏览顺序排列</span></div><div className="space-child-grid">{overview.children.map((space)=><article key={space.id} onClick={()=>selectSpace(space.id)}><div><i/><SpaceActions space={space} onAction={beginDialog} onCollaborate={setCollabTarget} onDeleteEmpty={deleteInvitedEmptySpace}/></div><h3>{space.name}</h3><p>{pathLabel} / {space.name}</p><footer>{space.ancestorOnly?"上级路径 · 仅显示目录名称":space.childCount+" 个子空间 · "+(space.totalArticleCount??space.articleCount)+" 篇文章"} <b>↗</b></footer></article>)}</div></>}
        {overview?.ancestorOnly?<div className="space-shared-ancestor-note">你可以通过目录导航进入获邀空间。上级目录仅提供位置关系，不允许查看其文章、成员或其他子空间。</div>:null}
        {!overview?.ancestorOnly?<div className="space-section-heading"><b>{scope==="current"?"直属文章":scope==="descendants"?"空间内文章":"全部私有文章"}</b><span>{query?`搜索“${query}” · `:""}按空间分组，点击展开文章</span>
        {canWrite?<button className="space-collab-inline-action" onClick={()=>overview&&setCoauthor({spaceId:overview.id,name:overview.name,canWrite:true})}>＋ 共创文档</button>:null}
        </div>:null}
        {!overview?.ancestorOnly?<div className={scope==="current"?"space-article-list":"space-article-groups"}>{loading?<p className="space-loading">正在读取空间内容…</p>:scope==="current"?posts.map(renderPost):postGroups.map((group,index)=>{
          const expanded=openGroupId===group.spaceId;
          const pathParts=group.path.split(" / ");
          return <section className="space-article-group-card" key={group.spaceId}>
            <button className="space-article-group-toggle" type="button" aria-expanded={expanded} aria-controls={`space-articles-${group.spaceId}`} onClick={()=>setExpandedGroupId(expanded?-1:group.spaceId)}>
              <span className="space-article-group-index">{String(index+1).padStart(2,"0")}</span><span className="space-article-group-title"><small>{group.spaceId===currentId?"当前空间":group.path}</small><strong>{pathParts.at(-1)||group.path}</strong></span><span className="space-article-group-count">{group.rows.length}{nextCursor&&index===postGroups.length-1?"+":""} 篇文章 <i>{expanded?"收起 ↑":"展开 ↓"}</i></span>
            </button>
            <div className="space-article-list" id={`space-articles-${group.spaceId}`} hidden={!expanded}>{group.rows.map(renderPost)}</div>
          </section>;
        })}{!loading&&!posts.length&&<div className="space-empty compact"><h3>{query&&searchKind==="spaces"?"正在按空间名称搜索":"这个空间还很安静"}</h3><p>{query?(searchKind==="spaces"?"匹配空间显示在左侧，正文列表保持隐藏。":"没有找到匹配文章"):canWrite?"从第一篇文章开始整理知识，也可以先创建子空间分类。":"这个空间目前没有可读文章。你仍可浏览有权限访问的空间目录。"}</p>{!query&&canWrite&&overview?<div className="space-empty-actions"><button type="button" onClick={()=>overview.isInvited?setCoauthor({spaceId:overview.id,name:overview.name,canWrite:true}):onCreateArticle(overview.id,pathLabel)}>写第一篇文章 →</button><button type="button" onClick={()=>beginDialog("create")}>创建子空间</button></div>:null}</div>}{!loading&&nextCursor&&<button className="space-load-more" onClick={()=>void loadMore()} disabled={loadingMore}>{loadingMore?"正在加载…":"继续加载"}</button>}</div>:null}
      </div>
    </div>
    {collabTarget&&<AdminSpaceCollaborationDialog spaceId={collabTarget.id} spaceName={collabTarget.name} onClose={()=>setCollabTarget(null)}
      onUpdated={()=>window.dispatchEvent(new Event("xingyu:spaces-changed"))}/>}
    {coauthor&&<AdminSpaceCoauthorDialog key={coauthor.publicId??"new-"+coauthor.spaceId} spaceId={coauthor.spaceId}
      spaceName={coauthor.name} publicId={coauthor.publicId} canWrite={coauthor.canWrite}
      authorName={authorName} avatarUrl={avatarUrl}
      onShare={coauthor.publicId?()=>{const target=posts.find(row=>row.publicId===coauthor.publicId);
        if(target){setCoauthor(null);setShareTarget(target);}}:undefined}
      onClose={()=>setCoauthor(null)} onUpdated={()=>window.dispatchEvent(new Event("xingyu:spaces-changed"))}/>}
    {shareTarget&&<AdminPreviewShareDialog post={shareTarget}
      apiPath={"/api/space-collaboration/documents/"+encodeURIComponent(shareTarget.publicId)+"/preview-links"}
      onClose={()=>setShareTarget(null)}/>}
    {previewTarget&&<AdminDocumentPreviewDialog key={previewTarget.publicId}
      publicId={previewTarget.publicId} spaceName={previewTarget.spacePath||overview?.name||"知识空间"}
      initialExcerpt={previewTarget.excerpt} initialCategoryName={previewTarget.categoryName}
      authorName={authorName} avatarUrl={avatarUrl} onClose={()=>setPreviewTarget(null)}/>}
    {dialog&&<SpaceDialog dialog={dialog} impact={dialogImpact} isInvited={overview?.isInvited} isPersonalAccount={isPersonalAccount} name={name} setName={setName} sortOrder={sortOrder} setSortOrder={setSortOrder} moveTarget={moveTarget} setMoveTarget={setMoveTarget} deleteMode={deleteMode} setDeleteMode={setDeleteMode} confirmName={confirmName} setConfirmName={setConfirmName} message={message} onClose={()=>setDialog(null)} onSubmit={submitDialog}/>}
  </section>;
}

function SpaceBreadcrumb({path,onSelect}:{path:PathNode[];onSelect:(id:number|null)=>void}){
  const [expanded,setExpanded]=useState(false);
  const visible=!expanded&&path.length>4?[path[0],null,...path.slice(-2)]:path;
  return <div className="space-breadcrumb"><button onClick={()=>onSelect(null)}>知识空间</button>{visible.map((item,index)=>item?<span key={item.id}><i>/</i><button onClick={()=>onSelect(item.id)}>{item.name}</button></span>:<span key={`ellipsis-${index}`}><i>/</i><button className="space-breadcrumb-ellipsis" title={path.map((part)=>part.name).join(" / ")} onClick={()=>setExpanded(true)}>…</button></span>)}</div>;
}

function SpaceTreeNode({node,currentId,activePathIds,onSelect}:{node:SpaceNode;currentId:number|null;activePathIds:number[];onSelect:(id:number)=>void}){
  const [open,setOpen]=useState(false);
  const [children,setChildren]=useState<SpaceNode[]>([]);
  const loadChildren=useCallback(async()=>{
    if(children.length||!node.childCount)return;
    const response=await fetch(`/api/spaces?parent=${node.id}`);
    if(response.ok)setChildren((await readApiJson<{spaces:SpaceNode[]}>(response)).spaces??[]);
  },[children.length,node.childCount,node.id]);
  useEffect(()=>{
    if(activePathIds.includes(node.id)&&node.id!==currentId&&node.childCount){
      const timer=window.setTimeout(()=>{
        setOpen(true);
        void loadChildren();
      },0);
      return()=>window.clearTimeout(timer);
    }
  },[activePathIds,currentId,loadChildren,node.childCount,node.id]);
  const toggle=async(event:React.MouseEvent)=>{
    event.stopPropagation();
    if(!open)await loadChildren();
    setOpen((value)=>!value);
  };
  return <div className="space-tree-node"><button className={currentId===node.id?"current":""} onClick={()=>onSelect(node.id)} title={node.name}><i onClick={toggle}>{node.childCount?(open?"⌄":"›"):"·"}</i><span>{node.name}</span><small>{node.ancestorOnly?"路径":node.totalArticleCount??node.articleCount}</small></button>{open&&<div>{children.map((child)=><SpaceTreeNode key={child.id} node={child} currentId={currentId} activePathIds={activePathIds} onSelect={onSelect}/>)}</div>}</div>;
}

function SpaceActions({space,onAction,onCollaborate,onDeleteEmpty}:{
  space:SpaceNode;onAction:(kind:DialogState["kind"],target?:SpaceNode)=>void;
  onCollaborate:(target:SpaceNode)=>void;
  onDeleteEmpty:(target:SpaceNode)=>void;
}){
  const [open,setOpen]=useState(false);
  const rootRef=useRef<HTMLDivElement>(null);
  const isOwnerSpace=!space.isInvited;
  const mayManage=space.canManage!==false&&!space.ancestorOnly;
  const mayEditLegacy=isOwnerSpace&&!space.ancestorOnly;
  const mayDeleteEmpty=Boolean(space.isInvited&&space.canManage===true&&space.parentId!==null&&!space.ancestorOnly);
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(!rootRef.current?.contains(event.target as Node))setOpen(false)};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false)};
    document.addEventListener("pointerdown",close);
    document.addEventListener("keydown",escape);
    return()=>{
      document.removeEventListener("pointerdown",close);
      document.removeEventListener("keydown",escape);
    };
  },[open]);
  if(!mayManage&&!mayEditLegacy&&!mayDeleteEmpty)return null;
  return <div className="space-card-actions" ref={rootRef} onClick={event=>event.stopPropagation()}>
    <button type="button" aria-label={space.name+"操作"} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>···</button>
    {open?<><button type="button" className="space-card-actions-dismiss" aria-label="关闭空间操作" onClick={()=>setOpen(false)}/>
    <div role="menu" aria-label={space.name+"操作菜单"}>
      <p className="space-actions-sheet-title">{space.name} · 空间操作</p>
      {mayManage?<button role="menuitem" onClick={()=>{setOpen(false);onCollaborate(space)}}>邀请与协作成员</button>:null}
      {mayDeleteEmpty?<button role="menuitem" className="danger" onClick={()=>{setOpen(false);onDeleteEmpty(space)}}>删除空子空间</button>:null}
      {mayEditLegacy?<><button role="menuitem" onClick={()=>{setOpen(false);onAction("rename",space)}}>重命名</button>
        <button role="menuitem" onClick={()=>{setOpen(false);onAction("sort",space)}}>设置浏览顺序</button>
        <button role="menuitem" onClick={()=>{setOpen(false);onAction("move",space)}}>移动空间</button>
        <button role="menuitem" className="danger" onClick={()=>{setOpen(false);onAction("delete",space)}}>删除空间</button>
      </>:null}
    </div></>:null}
  </div>;
}

function SpaceDialog({dialog,impact,isPersonalAccount=false,isInvited=false,name,setName,sortOrder,setSortOrder,moveTarget,setMoveTarget,deleteMode,setDeleteMode,confirmName,setConfirmName,message,onClose,onSubmit}:{dialog:DialogState;impact:DialogImpact;isPersonalAccount?:boolean;isInvited?:boolean;name:string;setName:(value:string)=>void;sortOrder:string;setSortOrder:(value:string)=>void;moveTarget:SpaceChoice|null;setMoveTarget:(value:SpaceChoice|null)=>void;deleteMode:"empty"|"move"|"recursive";setDeleteMode:(value:"empty"|"move"|"recursive")=>void;confirmName:string;setConfirmName:(value:string)=>void;message:string;onClose:()=>void;onSubmit:()=>void}){
  const title=dialog.kind==="create"?"新建知识空间":dialog.kind==="rename"?"重命名空间":dialog.kind==="sort"?"设置浏览顺序":dialog.kind==="move"?"移动空间":"删除空间";
  const invalidSort=(dialog.kind==="create"||dialog.kind==="sort")&&(!sortOrder.trim()||!Number.isSafeInteger(Number(sortOrder)));
  return <div className="space-dialog-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}><div className="space-dialog"><header><div><small>SPACE MANAGEMENT</small><h2>{title}</h2></div><button onClick={onClose}>×</button></header>
    {(dialog.kind==="create"||dialog.kind==="rename")&&<label>空间名称<input autoFocus value={name} onChange={(event)=>setName(event.target.value)} placeholder="例如：QSG、技术知识、个人项目"/></label>}
    {(dialog.kind==="sort"||dialog.kind==="create"&&!isInvited)&&<label>浏览顺序（整数，越小越靠前）<input type="number" step="1" value={sortOrder} onChange={(event)=>setSortOrder(event.target.value)}/></label>}
    {dialog.kind==="move"&&<><p>将同时移动 {impact?.descendantCount??0} 个后代空间和 {impact?.articleCount??0} 篇文章。</p><AdminSpacePicker value={moveTarget?.id??null} path={moveTarget?.id===0?"知识空间根层":moveTarget?.path?.map((item)=>item.name).join(" / ")} onChange={setMoveTarget} allowPublic={false} allowRoot excludeBranchId={dialog.target?.id} label="选择目标"/></>}
    {dialog.kind==="delete"&&(isPersonalAccount?<p>个人知识空间只允许删除空空间。此空间包含 {impact?.descendantCount??0} 个后代空间和 {impact?.articleCount??0} 篇文章；如有内容，请先移动文章或子空间。</p>:<><p>此空间包含 {impact?.descendantCount??0} 个后代空间和 {impact?.articleCount??0} 篇文章，请明确选择处理方式。</p><div className="space-delete-options"><button className={deleteMode==="empty"?"selected":""} onClick={()=>setDeleteMode("empty")}><b>仅空空间删除</b><small>有内容时拒绝操作</small></button><button className={deleteMode==="move"?"selected":""} onClick={()=>setDeleteMode("move")}><b>移动内容后删除</b><small>保留文章和子空间</small></button><button className={deleteMode==="recursive"?"selected danger":""} onClick={()=>setDeleteMode("recursive")}><b>递归删除</b><small>删除所有后代与文章</small></button></div>{deleteMode==="move"&&<AdminSpacePicker value={moveTarget?.id??null} path={moveTarget?.path?.map((item)=>item.name).join(" / ")} onChange={setMoveTarget} allowPublic={false} excludeBranchId={dialog.target?.id} label="选择接收空间"/>}{deleteMode==="recursive"&&<label>输入“{dialog.target?.name}”确认<input value={confirmName} onChange={(event)=>setConfirmName(event.target.value)}/></label>}</>)}
    {message&&<p className="space-dialog-message">{message}</p>}<footer><button onClick={onClose}>取消</button><button className={dialog.kind==="delete"&&deleteMode==="recursive"?"danger":""} onClick={()=>void onSubmit()} disabled={invalidSort||((dialog.kind==="create"||dialog.kind==="rename")&&!name.trim())||(dialog.kind==="move"&&!moveTarget)||(dialog.kind==="delete"&&deleteMode==="move"&&!moveTarget)||(dialog.kind==="delete"&&deleteMode==="recursive"&&confirmName!==dialog.target?.name)}>确认</button></footer>
  </div></div>;
}
