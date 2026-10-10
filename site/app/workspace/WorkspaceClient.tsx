"use client";
import { useCallback,useEffect,useState,type CSSProperties,type FormEvent } from "react";
type Workspace={id:number;name:string;kind:string;role:string};
type Space={id:number;name:string;parentId:number|null;slug:string};
type PostItem={id:number;publicId:string;title:string;status:string;version:number;spaceId:number|null;updatedAt:string};
type PostDetail=PostItem&{content:string;excerpt:string};
const input:CSSProperties={width:"100%",minWidth:0,padding:10,borderRadius:10,border:"1px solid var(--admin-line)",background:"var(--admin-control)",color:"var(--admin-ink)"};
type ApiEnvelope={error?:string;spaces?:Space[];posts?:PostItem[];post?:PostDetail;
  attachment?:{content_type:string;filename:string;url:string}};
async function api(path:string,init?:RequestInit):Promise<ApiEnvelope>{
  const res=await fetch(path,{credentials:"same-origin",cache:"no-store",...init});
  const data=await res.json().catch(()=>({})) as ApiEnvelope;
  if(!res.ok)throw new Error(data.error||"请求失败");
  return data;
}
export default function WorkspaceClient({initialWorkspaces,onDirtyChange}:{initialWorkspaces:Workspace[];onDirtyChange?:(dirty:boolean)=>void}){
  const [workspaceId,setWorkspaceId]=useState(initialWorkspaces[0]?.id??0);
  const [spaces,setSpaces]=useState<Space[]>([]);
  const [posts,setPosts]=useState<PostItem[]>([]);
  const [selected,setSelected]=useState<PostDetail|null>(null);
  const [title,setTitle]=useState("");
  const [content,setContent]=useState("");
  const [name,setName]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [query,setQuery]=useState("");
  const [filterSpace,setFilterSpace]=useState("all");
  const [draftSpace,setDraftSpace]=useState("");
  const [savedContent,setSavedContent]=useState("");
  const [createMode,setCreateMode]=useState(false);
  const currentWorkspace=initialWorkspaces.find(w=>w.id===workspaceId);
  const readOnly=currentWorkspace?.role==="viewer";
  const dirty=!readOnly&&(selected?content!==savedContent:(content!==""||title!==""));
  const root="/api/workspaces/"+workspaceId;
  useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};
    window.addEventListener("beforeunload",warn);
    return()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);
  const refresh=useCallback(async()=>{
    if(!workspaceId)return;
    const [spaceData,postData]=await Promise.all([
      api("/api/workspaces/"+workspaceId+"/spaces?parent_id=all"),
      api("/api/workspaces/"+workspaceId+"/posts?limit=50"),
    ]);
    setSpaces(spaceData.spaces||[]);setPosts(postData.posts||[]);
  },[workspaceId]);
  useEffect(()=>{
    if(!workspaceId)return;
    let active=true;
    void Promise.all([
      api("/api/workspaces/"+workspaceId+"/spaces?parent_id=all"),
      api("/api/workspaces/"+workspaceId+"/posts?limit=50"),
    ]).then(([spaceData,postData])=>{
      if(!active)return;
      setSpaces(spaceData.spaces||[]);
      setPosts(postData.posts||[]);
    }).catch(error=>{if(active)setNotice(error instanceof Error?error.message:"加载失败");});
    return ()=>{active=false;};
  },[workspaceId]);
  async function createNote(e:FormEvent){
    e.preventDefault();if(!title.trim())return;setBusy(true);setNotice("");
    try{
      const data=await api(root+"/posts",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({title,content_markdown:content,...(draftSpace?{space:String(draftSpace)}:{})})});
      if(!data.post)throw new Error("创建草稿未返回文章");
      setTitle("");setCreateMode(false);setSavedContent("");await refresh();await openPost(data.post.publicId);setNotice("草稿已创建");
    }catch(e){setNotice(e instanceof Error?e.message:"创建失败");}finally{setBusy(false);}
  }
  async function openPost(id:string){
    try{const data=await api(root+"/posts/"+encodeURIComponent(id));
      if(!data.post)throw new Error("未找到文章");setSelected(data.post);setContent(data.post.content??"");setSavedContent(data.post.content??"");}
    catch(e){setNotice(e instanceof Error?e.message:"读取失败");}
  }
  async function savePost(){
    if(!selected)return;setBusy(true);setNotice("");
    try{
      const data=await api(root+"/posts/"+selected.publicId,{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({expected_version:selected.version,content_markdown:content})});
      if(!data.post)throw new Error("保存未返回文章");
      setSelected(data.post);setContent(data.post.content||"");setSavedContent(data.post.content||"");await refresh();setNotice("已保存 · 版本 "+data.post.version);
    }catch(e){setNotice(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}
  }
  async function setStatus(next:"draft"|"published"){
    if(!selected)return;setBusy(true);setNotice("");
    try{
      const data=await api(root+"/posts/"+selected.publicId+"/status",{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({expected_version:selected.version,status:next})});
      if(!data.post)throw new Error("状态更新未返回文章");
      setSelected(data.post);setContent(data.post.content??"");setSavedContent(data.post.content??"");await refresh();setNotice(next==="published"?"已标记完成（私人空间仍然私密）":"已退回草稿");
    }catch(e){setNotice(e instanceof Error?e.message:"操作失败");}finally{setBusy(false);}
  }
  async function createSpace(e:FormEvent){
    e.preventDefault();if(!name.trim())return;setBusy(true);setNotice("");
    try{await api(root+"/spaces",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});setName("");await refresh();setNotice("空间已创建");}
    catch(e){setNotice(e instanceof Error?e.message:"创建失败");}finally{setBusy(false);}
  }
  async function upload(file:File){
    if(!selected)return;setBusy(true);setNotice("");
    try{
      const data=new FormData();data.set("file",file);data.set("post_identifier",selected.publicId);
      const result=await api(root+"/attachments",{method:"POST",body:data});
      const a=result.attachment;
      if(!a)throw new Error("附件上传未返回信息");
      const snippet=a.content_type.startsWith("image/")?"!["+a.filename+"]("+a.url+")":"["+a.filename+"]("+a.url+")";
      setContent(previous=>previous+(previous.endsWith("\n")?"":"\n")+"\n"+snippet+"\n");
      setNotice("附件已上传；请保存正文以插入链接。");
    }catch(e){setNotice(e instanceof Error?e.message:"上传失败");}finally{setBusy(false);}
  }
  function canLeave(){return !dirty||window.confirm("有尚未保存的修改，继续将丢失当前编辑内容。确定继续吗？");}
  const available=posts.filter(p=>p.title.toLowerCase().includes(query.toLowerCase()) && (filterSpace==="all"||(filterSpace==="root"?p.spaceId===null:p.spaceId===Number(filterSpace))));
  function resetDraft(){if(!canLeave())return;setSelected(null);setTitle("");setContent("");setSavedContent("");setSavedTitle("");setCreateMode(true);}
  return <div className="workspace-editor" style={{display:"grid",gap:18}}>
    <section className="editor-section admin-account-switcher" style={{display:"flex",gap:12,justifyContent:"space-between",flexWrap:"wrap",alignItems:"center"}}>
      <label>当前工作区：
        <select value={workspaceId} onChange={e=>{if(!canLeave())return;setSelected(null);setContent("");setTitle("");setSavedContent("");setWorkspaceId(Number(e.target.value));setFilterSpace("all");setDraftSpace("");}} style={{...input,width:"auto",marginLeft:8}}>
          {initialWorkspaces.map(w=><option key={w.id} value={w.id}>{w.name}（{w.role}）</option>)}
        </select>
      </label>
    </section>
    {notice?<p role="status" className="admin-account-notice">{notice}</p>:null}
    {dirty?<p className="account-unsaved" role="status">● 尚未保存的修改</p>:null}
    <div className="admin-account-columns" style={{display:"grid",gap:16}}>
      <aside className="editor-section" style={{display:"grid",alignContent:"start",gap:18}}>
        <div><h2>知识空间</h2><p>按空间筛选文章，点击「全部文档」返回。</p><div className="workspace-folder-list"><button type="button" aria-pressed={filterSpace==="all"} onClick={()=>setFilterSpace("all")}>▤ 全部文档 <small>{posts.length}</small></button>{spaces.map(sp=><button key={sp.id} type="button" aria-pressed={filterSpace===String(sp.id)} onClick={()=>setFilterSpace(String(sp.id))}>◇ {sp.name}</button>)}</div></div>
        {!readOnly?<form onSubmit={createSpace} style={{display:"grid",gap:8}}>
          <label htmlFor="space-name">创建顶级空间</label>
          <input id="space-name" style={input} value={name} onChange={e=>setName(e.target.value)} maxLength={100}/>
          <button type="submit" disabled={busy}>添加空间</button>
        </form>:null}
        <div className="admin-account-article-list"><div className="account-list-title"><h2>文章</h2>{!readOnly?<button type="button" onClick={resetDraft}>＋ 新建</button>:null}</div>
          <input aria-label="筛选文章标题" style={input} value={query} onChange={e=>setQuery(e.target.value)} placeholder="筛选标题"/>
          {available.length===0?<p>这个筛选下暂无文档。</p>:null}
          {available.map(p=>
            <button className="admin-account-article" aria-pressed={selected?.publicId===p.publicId} type="button" key={p.publicId} onClick={()=>{if(canLeave())void openPost(p.publicId);}} style={{display:"block",padding:"10px 0",width:"100%",textAlign:"left",border:0,background:"transparent",cursor:"pointer"}}>
              {p.title} <small>· {p.status==="draft"?"草稿":"已完成"}</small>
            </button>)}
        </div>
      </aside>
      <section className="editor-section" style={{display:"grid",gap:14,alignContent:"start"}}>
        {selected?<><h2>编辑：{selected.title}</h2>
          <p>版本 {selected.version} · {selected.status==="draft"?"草稿":"已完成"} · 私人空间数据只对授权成员开放</p>
          <label htmlFor="edit-markdown">Markdown 正文</label>
          <textarea disabled={readOnly} id="edit-markdown" value={content} onChange={e=>setContent(e.target.value)} rows={18} style={{...input,resize:"vertical",fontFamily:"monospace"}}/>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {!readOnly?<button className="new-button" type="button" disabled={busy||!dirty} onClick={savePost}>保存修改</button>:null}
            {!readOnly?<button type="button" disabled={busy} onClick={()=>setStatus(selected.status==="draft"?"published":"draft")}>{selected.status==="draft"?"标记完成":"退回草稿"}</button>:null}
            {!readOnly?<label>上传附件 <input type="file" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)upload(file);e.target.value="";}}/></label>:null}
            {!readOnly?<button type="button" onClick={resetDraft}>新建草稿</button>:null}
          </div>
        </>:readOnly?<div className="account-empty"><h2>选择一篇文章</h2><p>你有此工作区的阅读权限。选择左侧文章即可查看正文。</p></div>:<form onSubmit={createNote} style={{display:"grid",gap:12}}>
          <h2>{createMode?"新建草稿":"开始写作"}</h2><p>写下标题和正文，再保存到当前工作区。</p><label htmlFor="new-title">标题</label>
          <input id="new-title" style={input} value={title} onChange={e=>setTitle(e.target.value)} maxLength={200} required/>
          <label htmlFor="new-space">保存到知识空间</label><select id="new-space" style={input} value={draftSpace} onChange={e=>setDraftSpace(e.target.value)}><option value="">默认知识空间</option>{spaces.map(sp=><option key={sp.id} value={sp.id}>{sp.name}</option>)}</select>
          <label htmlFor="new-content">Markdown 正文</label>
          <textarea id="new-content" style={{...input,resize:"vertical",fontFamily:"monospace"}} value={content} onChange={e=>setContent(e.target.value)} rows={16}/>
          <button className="new-button" type="submit" disabled={busy}>创建草稿</button>
        </form>}
      </section>
    </div>
  </div>;
}
