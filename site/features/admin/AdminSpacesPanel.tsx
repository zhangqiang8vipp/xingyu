"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readApiJson } from "@/app/api-response";
import type { AdminReaderContext } from "@/domain/reader/admin-reader-context";
import AdminSpacePicker, { type SpaceChoice } from "./AdminSpacePicker";

type SpaceNode={id:number;parentId:number|null;name:string;slug:string;sortOrder:number;childCount:number;articleCount:number;totalArticleCount?:number;latestActivityAt?:string;childPreview?:string|null;updatedAt:string;path?:PathNode[]};
type PathNode={id:number;parentId:number|null;name:string;slug:string};
type Overview=SpaceNode&{path:PathNode[];children:SpaceNode[];descendantCount:number;articleCount:number};
type SpacePost={id:number;publicId:string;title:string;slug:string;excerpt:string;status:"draft"|"published";categoryName:string;updatedAt:string;spaceId:number;spacePath:string;sortOrder:number};
type DialogState={kind:"create"|"rename"|"sort"|"move"|"delete";target?:SpaceNode};
type DialogImpact={descendantCount:number;articleCount:number}|null;

export default function AdminSpacesPanel({initialSpaceId=null,createOnOpen=false,onLocationChange,onCreateArticle,onEditArticle,onBrowseArticle,onShareArticle}:{initialSpaceId?:number|null;createOnOpen?:boolean;onLocationChange?:(spaceId:number|null)=>void;onCreateArticle:(spaceId:number,spacePath:string)=>void;onEditArticle:(postId:number)=>void;onBrowseArticle:(postId:number,readerContext:AdminReaderContext)=>void;onShareArticle:(post:{id:number;title:string})=>void}){
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
      if(postsResponse?.ok){
        const data=await readApiJson<{rows:SpacePost[];nextCursor:string|null}>(postsResponse);
        setPosts(data.rows??[]);setNextCursor(data.nextCursor??null);
      }else if(articleSearchDisabled){setPosts([]);setNextCursor(null)}
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
      response=await fetch("/api/spaces",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,parentId:currentId,sortOrder:Number(sortOrder)})});
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
  const currentActions=overview?{id:overview.id,parentId:overview.parentId,name:overview.name,slug:overview.slug,sortOrder:overview.sortOrder,childCount:overview.children.length,articleCount:overview.articleCount,updatedAt:overview.updatedAt}:undefined;
  const postGroups:{spaceId:number;path:string;rows:SpacePost[]}[]=[];
  for(const post of posts){
    const last=postGroups.at(-1);
    if(last?.spaceId===post.spaceId)last.rows.push(post);
    else postGroups.push({spaceId:post.spaceId,path:post.spacePath,rows:[post]});
  }
  const openGroupId=expandedGroupId===-1?-1:postGroups.some((group)=>group.spaceId===expandedGroupId)?expandedGroupId:postGroups[0]?.spaceId;
  const renderPost=(post:SpacePost)=><article key={post.id}><div><small>{post.categoryName} · {post.status==="published"?"内容完成":"草稿"} · {new Date(post.updatedAt).toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"})}</small><b>{post.title}</b><p>{post.excerpt||"暂无摘要"}</p></div><div><button onClick={()=>onBrowseArticle(post.id,readerContext)}>浏览</button><button onClick={()=>onShareArticle(post)}>分享</button><button onClick={()=>onEditArticle(post.id)}>编辑 ↗</button></div></article>;

  if(!currentId)return <section className="admin-main spaces-root">
    <header className="admin-header"><div><p>PRIVATE KNOWLEDGE</p><h1>知识空间</h1><span>顶级空间彼此独立，只承载私有知识入口。</span></div><button className="new-button" onClick={()=>beginDialog("create")}>＋ 新建顶级空间</button></header>
    <div className="spaces-root-summary"><span>{rootMeta.rootCount} 个顶级空间 · {rootMeta.articleCount} 篇私有文章</span><i/><span>{rootMeta.spaceCount} 个空间节点</span><i/>空间文章不会进入首页或公开归档</div>
    <div className="space-domain-grid">{roots.map((space)=><article className="space-domain-card" key={space.id} onClick={()=>selectSpace(space.id)}>
      <div><i/><span>{space.childCount} 个子空间</span><SpaceActions space={space} onAction={beginDialog}/></div>
      <h2>{space.name}</h2><p>{space.childPreview||"尚未创建子空间"} · {space.totalArticleCount??space.articleCount} 篇知识文章</p><footer><span>最近更新 {new Date(space.latestActivityAt??space.updatedAt).toLocaleDateString("zh-CN")}</span><b>进入空间 ↗</b></footer>
    </article>)}</div>
    {!roots.length&&!loading&&<div className="space-empty"><i>◇</i><h2>建立第一个知识空间</h2><p>空间只在后台与 MCP 中可见，不会改变公开博客。</p><button onClick={()=>beginDialog("create")}>新建顶级空间</button></div>}
    {dialog&&<SpaceDialog dialog={dialog} impact={dialogImpact} name={name} setName={setName} sortOrder={sortOrder} setSortOrder={setSortOrder} moveTarget={moveTarget} setMoveTarget={setMoveTarget} deleteMode={deleteMode} setDeleteMode={setDeleteMode} confirmName={confirmName} setConfirmName={setConfirmName} message={message} onClose={()=>setDialog(null)} onSubmit={submitDialog}/>}
  </section>;

  return <section className="admin-main spaces-page">
    <header className="admin-header space-page-header"><div><button className="space-back" onClick={()=>selectSpace(overview?.parentId??null)}>←</button><p>PRIVATE KNOWLEDGE</p><h1>{overview?.name??"知识空间"}</h1><SpaceBreadcrumb path={overview?.path??[]} onSelect={selectSpace}/></div><div className="space-header-actions"><button className="space-mobile-tree-toggle" onClick={()=>setTreeOpen(true)}>☰ 空间路径</button><button onClick={()=>beginDialog("create")}>＋ 子空间</button><button className="new-button" onClick={()=>overview&&onCreateArticle(overview.id,pathLabel)}>＋ 新建文章</button>{currentActions&&<SpaceActions space={currentActions} onAction={beginDialog}/>}</div></header>
    <div className="space-workbench">
      {treeOpen&&<button className="space-tree-mobile-backdrop" aria-label="关闭空间树" onClick={()=>setTreeOpen(false)}/>}
      <aside className={`space-tree-panel ${treeOpen?"mobile-open":""}`}><div><b>知识空间</b><button onClick={()=>{selectSpace(null);setTreeOpen(false)}}>全部</button></div><label><span>⌕</span><input value={query} onChange={(event)=>{setQuery(event.target.value);setExpandedGroupId(null)}} placeholder="搜索空间或文章"/></label><div className="space-search-kind"><button className={searchKind==="all"?"active":""} onClick={()=>setSearchKind("all")}>全部</button><button className={searchKind==="spaces"?"active":""} onClick={()=>setSearchKind("spaces")}>空间</button><button className={searchKind==="articles"?"active":""} onClick={()=>setSearchKind("articles")}>正文</button></div><nav>{query&&spaceMatches.length>0&&<div className="space-tree-search-results"><small>空间</small>{spaceMatches.map((space)=><button key={space.id} onClick={()=>{selectSpace(space.id);setQuery("");setTreeOpen(false)}}><b>{space.name}</b><span>{space.path?.map((item)=>item.name).join(" / ")}</span></button>)}<small>空间树</small></div>}{roots.map((space)=><SpaceTreeNode key={`${space.id}-${treeVersion}`} node={space} currentId={currentId} activePathIds={overview?.path.map((item)=>item.id)??[]} onSelect={(id)=>{selectSpace(id);setTreeOpen(false)}}/>)}</nav></aside>
      <div className="space-content">
        <div className="space-content-intro"><div><span>{overview?.children.length??0} 个直属子空间 · {overview?.articleCount??0} 篇文章（含下级）</span><p>{pathLabel}</p></div><div className="space-scope"><button className={scope==="descendants"?"active":""} onClick={()=>{setScope("descendants");setExpandedGroupId(null)}}>包含子空间</button><button className={scope==="current"?"active":""} onClick={()=>{setScope("current");setExpandedGroupId(null)}}>仅当前空间</button><button className={scope==="all"?"active":""} onClick={()=>{setScope("all");setExpandedGroupId(null)}}>全部空间</button></div></div>
        {!!overview?.children.length&&<><div className="space-section-heading"><b>子空间</b><span>按浏览顺序排列</span></div><div className="space-child-grid">{overview.children.map((space)=><article key={space.id} onClick={()=>selectSpace(space.id)}><div><i/><SpaceActions space={space} onAction={beginDialog}/></div><h3>{space.name}</h3><p>{pathLabel} / {space.name}</p><footer>{space.childCount} 个子空间 · {space.totalArticleCount??space.articleCount} 篇文章 <b>↗</b></footer></article>)}</div></>}
        <div className="space-section-heading"><b>{scope==="current"?"直属文章":scope==="descendants"?"空间内文章":"全部私有文章"}</b><span>{query?`搜索“${query}” · `:""}按空间分组，点击展开文章</span></div>
        <div className={scope==="current"?"space-article-list":"space-article-groups"}>{loading?<p className="space-loading">正在读取空间内容…</p>:scope==="current"?posts.map(renderPost):postGroups.map((group,index)=>{
          const expanded=openGroupId===group.spaceId;
          const pathParts=group.path.split(" / ");
          return <section className="space-article-group-card" key={group.spaceId}>
            <button className="space-article-group-toggle" type="button" aria-expanded={expanded} aria-controls={`space-articles-${group.spaceId}`} onClick={()=>setExpandedGroupId(expanded?-1:group.spaceId)}>
              <span className="space-article-group-index">{String(index+1).padStart(2,"0")}</span><span className="space-article-group-title"><small>{group.spaceId===currentId?"当前空间":group.path}</small><strong>{pathParts.at(-1)||group.path}</strong></span><span className="space-article-group-count">{group.rows.length}{nextCursor&&index===postGroups.length-1?"+":""} 篇文章 <i>{expanded?"收起 ↑":"展开 ↓"}</i></span>
            </button>
            <div className="space-article-list" id={`space-articles-${group.spaceId}`} hidden={!expanded}>{group.rows.map(renderPost)}</div>
          </section>;
        })}{!loading&&!posts.length&&<div className="space-empty compact"><h3>{query&&searchKind==="spaces"?"正在按空间名称搜索":"这个空间还很安静"}</h3><p>{query?(searchKind==="spaces"?"匹配空间显示在左侧，正文列表保持隐藏。":"没有找到匹配文章"):"可以创建子空间，或从这里开始写第一篇知识文章。"}</p></div>}{!loading&&nextCursor&&<button className="space-load-more" onClick={()=>void loadMore()} disabled={loadingMore}>{loadingMore?"正在加载…":"继续加载"}</button>}</div>
      </div>
    </div>
    {dialog&&<SpaceDialog dialog={dialog} impact={dialogImpact} name={name} setName={setName} sortOrder={sortOrder} setSortOrder={setSortOrder} moveTarget={moveTarget} setMoveTarget={setMoveTarget} deleteMode={deleteMode} setDeleteMode={setDeleteMode} confirmName={confirmName} setConfirmName={setConfirmName} message={message} onClose={()=>setDialog(null)} onSubmit={submitDialog}/>}
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
  return <div className="space-tree-node"><button className={currentId===node.id?"current":""} onClick={()=>onSelect(node.id)} title={node.name}><i onClick={toggle}>{node.childCount?(open?"⌄":"›"):"·"}</i><span>{node.name}</span><small>{node.totalArticleCount??node.articleCount}</small></button>{open&&<div>{children.map((child)=><SpaceTreeNode key={child.id} node={child} currentId={currentId} activePathIds={activePathIds} onSelect={onSelect}/>)}</div>}</div>;
}

function SpaceActions({space,onAction}:{space:SpaceNode;onAction:(kind:DialogState["kind"],target?:SpaceNode)=>void}){
  const [open,setOpen]=useState(false);
  const rootRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(!rootRef.current?.contains(event.target as Node))setOpen(false)};
    document.addEventListener("pointerdown",close);
    return()=>document.removeEventListener("pointerdown",close);
  },[open]);
  return <div className="space-card-actions" ref={rootRef} onClick={(event)=>event.stopPropagation()}><button type="button" aria-label={`${space.name}操作`} aria-expanded={open} onClick={()=>setOpen((value)=>!value)}>···</button>{open&&<div role="menu"><button role="menuitem" onClick={()=>{setOpen(false);onAction("rename",space)}}>重命名</button><button role="menuitem" onClick={()=>{setOpen(false);onAction("sort",space)}}>设置浏览顺序</button><button role="menuitem" onClick={()=>{setOpen(false);onAction("move",space)}}>移动空间</button><button role="menuitem" className="danger" onClick={()=>{setOpen(false);onAction("delete",space)}}>删除空间</button></div>}</div>;
}

function SpaceDialog({dialog,impact,name,setName,sortOrder,setSortOrder,moveTarget,setMoveTarget,deleteMode,setDeleteMode,confirmName,setConfirmName,message,onClose,onSubmit}:{dialog:DialogState;impact:DialogImpact;name:string;setName:(value:string)=>void;sortOrder:string;setSortOrder:(value:string)=>void;moveTarget:SpaceChoice|null;setMoveTarget:(value:SpaceChoice|null)=>void;deleteMode:"empty"|"move"|"recursive";setDeleteMode:(value:"empty"|"move"|"recursive")=>void;confirmName:string;setConfirmName:(value:string)=>void;message:string;onClose:()=>void;onSubmit:()=>void}){
  const title=dialog.kind==="create"?"新建知识空间":dialog.kind==="rename"?"重命名空间":dialog.kind==="sort"?"设置浏览顺序":dialog.kind==="move"?"移动空间":"删除空间";
  const invalidSort=(dialog.kind==="create"||dialog.kind==="sort")&&(!sortOrder.trim()||!Number.isSafeInteger(Number(sortOrder)));
  return <div className="space-dialog-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}><div className="space-dialog"><header><div><small>SPACE MANAGEMENT</small><h2>{title}</h2></div><button onClick={onClose}>×</button></header>
    {(dialog.kind==="create"||dialog.kind==="rename")&&<label>空间名称<input autoFocus value={name} onChange={(event)=>setName(event.target.value)} placeholder="例如：QSG、技术知识、个人项目"/></label>}
    {(dialog.kind==="create"||dialog.kind==="sort")&&<label>浏览顺序（整数，越小越靠前）<input type="number" step="1" value={sortOrder} onChange={(event)=>setSortOrder(event.target.value)}/></label>}
    {dialog.kind==="move"&&<><p>将同时移动 {impact?.descendantCount??0} 个后代空间和 {impact?.articleCount??0} 篇文章。</p><AdminSpacePicker value={moveTarget?.id??null} path={moveTarget?.id===0?"知识空间根层":moveTarget?.path?.map((item)=>item.name).join(" / ")} onChange={setMoveTarget} allowPublic={false} allowRoot excludeBranchId={dialog.target?.id} label="选择目标"/></>}
    {dialog.kind==="delete"&&<><p>此空间包含 {impact?.descendantCount??0} 个后代空间和 {impact?.articleCount??0} 篇文章，请明确选择处理方式。</p><div className="space-delete-options"><button className={deleteMode==="empty"?"selected":""} onClick={()=>setDeleteMode("empty")}><b>仅空空间删除</b><small>有内容时拒绝操作</small></button><button className={deleteMode==="move"?"selected":""} onClick={()=>setDeleteMode("move")}><b>移动内容后删除</b><small>保留文章和子空间</small></button><button className={deleteMode==="recursive"?"selected danger":""} onClick={()=>setDeleteMode("recursive")}><b>递归删除</b><small>删除所有后代与文章</small></button></div>{deleteMode==="move"&&<AdminSpacePicker value={moveTarget?.id??null} path={moveTarget?.path?.map((item)=>item.name).join(" / ")} onChange={setMoveTarget} allowPublic={false} excludeBranchId={dialog.target?.id} label="选择接收空间"/>}{deleteMode==="recursive"&&<label>输入“{dialog.target?.name}”确认<input value={confirmName} onChange={(event)=>setConfirmName(event.target.value)}/></label>}</>}
    {message&&<p className="space-dialog-message">{message}</p>}<footer><button onClick={onClose}>取消</button><button className={dialog.kind==="delete"&&deleteMode==="recursive"?"danger":""} onClick={()=>void onSubmit()} disabled={invalidSort||((dialog.kind==="create"||dialog.kind==="rename")&&!name.trim())||(dialog.kind==="move"&&!moveTarget)||(dialog.kind==="delete"&&deleteMode==="move"&&!moveTarget)||(dialog.kind==="delete"&&deleteMode==="recursive"&&confirmName!==dialog.target?.name)}>确认</button></footer>
  </div></div>;
}
