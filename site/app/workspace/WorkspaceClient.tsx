"use client";
import { useCallback,useEffect,useState,type FormEvent } from "react";
type Workspace={id:number;name:string;kind:string;role:string};
type Space={id:number;name:string;parentId:number|null;slug:string};
type PostItem={id:number;publicId:string;title:string;status:string;version:number;spaceId:number|null;updatedAt:string};
type PostDetail=PostItem&{content:string;excerpt:string};
const panel:React.CSSProperties={border:"1px solid var(--border-color,#c6c8ca)",borderRadius:14,padding:20};
const input:React.CSSProperties={width:"100%",minWidth:0,padding:10,borderRadius:8,border:"1px solid #aaa"};
async function api(path:string,init?:RequestInit){
  const res=await fetch(path,{credentials:"same-origin",cache:"no-store",...init});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||"请求失败");
  return data;
}
export default function WorkspaceClient({initialWorkspaces}:{initialWorkspaces:Workspace[]}){
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
  const root="/api/workspaces/"+workspaceId;
  const refresh=useCallback(async()=>{
    if(!workspaceId)return;
    const [spaceData,postData]=await Promise.all([
      api("/api/workspaces/"+workspaceId+"/spaces?parent_id=all"),
      api("/api/workspaces/"+workspaceId+"/posts?limit=50"),
    ]);
    setSpaces(spaceData.spaces||[]);setPosts(postData.posts||[]);
  },[workspaceId]);
  useEffect(()=>{setSelected(null);setContent("");refresh().catch(e=>setNotice(e.message));},[refresh]);
  async function createNote(e:FormEvent){
    e.preventDefault();if(!title.trim())return;setBusy(true);setNotice("");
    try{
      const data=await api(root+"/posts",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({title,content_markdown:content})});
      setTitle("");await refresh();await openPost(data.post.publicId);setNotice("草稿已创建");
    }catch(e){setNotice(e instanceof Error?e.message:"创建失败");}finally{setBusy(false);}
  }
  async function openPost(id:string){
    try{const data=await api(root+"/posts/"+encodeURIComponent(id));setSelected(data.post);setContent(data.post.content??"");}
    catch(e){setNotice(e instanceof Error?e.message:"读取失败");}
  }
  async function savePost(){
    if(!selected)return;setBusy(true);setNotice("");
    try{
      const data=await api(root+"/posts/"+selected.publicId,{method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({expected_version:selected.version,content_markdown:content})});
      setSelected(data.post);setContent(data.post.content||"");await refresh();setNotice("已保存 · 版本 "+data.post.version);
    }catch(e){setNotice(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}
  }
  async function setStatus(next:"draft"|"published"){
    if(!selected)return;setBusy(true);setNotice("");
    try{
      const data=await api(root+"/posts/"+selected.publicId+"/status",{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({expected_version:selected.version,status:next})});
      setSelected(data.post);await refresh();setNotice(next==="published"?"已标记完成（私人空间仍然私密）":"已退回草稿");
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
      const snippet=a.content_type.startsWith("image/")?"!["+a.filename+"]("+a.url+")":"["+a.filename+"]("+a.url+")";
      setContent(previous=>previous+(previous.endsWith("\n")?"":"\n")+"\n"+snippet+"\n");
      setNotice("附件已上传；请保存正文以插入链接。");
    }catch(e){setNotice(e instanceof Error?e.message:"上传失败");}finally{setBusy(false);}
  }
  async function logout(){
    await fetch("/api/identity/logout",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin"});
    window.location.replace("/login");
  }
  return <div style={{display:"grid",gap:18}}>
    <section style={{...panel,display:"flex",gap:12,justifyContent:"space-between",flexWrap:"wrap",alignItems:"center"}}>
      <label>当前工作区：
        <select value={workspaceId} onChange={e=>setWorkspaceId(Number(e.target.value))} style={{...input,width:"auto",marginLeft:8}}>
          {initialWorkspaces.map(w=><option key={w.id} value={w.id}>{w.name}（{w.role}）</option>)}
        </select>
      </label>
      <button type="button" onClick={logout}>退出登录</button>
    </section>
    {notice?<p role="status" style={{padding:12,...panel}}>{notice}</p>:null}
    <div style={{display:"grid",gridTemplateColumns:"minmax(210px,1fr) minmax(0,2fr)",gap:16}}>
      <aside style={{...panel,display:"grid",alignContent:"start",gap:18}}>
        <div><h2>知识空间</h2>{spaces.length?spaces.map(s=><p key={s.id} style={{margin:"8px 0"}}>📁 {s.name}</p>):<p>暂无空间</p>}</div>
        <form onSubmit={createSpace} style={{display:"grid",gap:8}}>
          <label htmlFor="space-name">创建顶级空间</label>
          <input id="space-name" style={input} value={name} onChange={e=>setName(e.target.value)} maxLength={100}/>
          <button type="submit" disabled={busy}>添加空间</button>
        </form>
        <div><h2>文章</h2>
          <input style={input} value={query} onChange={e=>setQuery(e.target.value)} placeholder="筛选标题"/>
          {posts.filter(p=>p.title.toLowerCase().includes(query.toLowerCase())).map(p=>
            <button type="button" key={p.publicId} onClick={()=>openPost(p.publicId)} style={{display:"block",padding:"10px 0",width:"100%",textAlign:"left",border:0,background:"transparent",cursor:"pointer"}}>
              {p.title} <small>· {p.status==="draft"?"草稿":"已完成"}</small>
            </button>)}
        </div>
      </aside>
      <section style={{...panel,display:"grid",gap:14,alignContent:"start"}}>
        {selected?<><h2>编辑：{selected.title}</h2>
          <p>版本 {selected.version} · {selected.status==="draft"?"草稿":"已完成"} · 私人空间数据只对授权成员开放</p>
          <label htmlFor="edit-markdown">Markdown 正文</label>
          <textarea id="edit-markdown" value={content} onChange={e=>setContent(e.target.value)} rows={18} style={{...input,resize:"vertical",fontFamily:"monospace"}}/>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button type="button" disabled={busy} onClick={savePost}>保存修改</button>
            <button type="button" disabled={busy} onClick={()=>setStatus(selected.status==="draft"?"published":"draft")}>{selected.status==="draft"?"标记完成":"退回草稿"}</button>
            <label>上传附件 <input type="file" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)upload(file);e.target.value="";}}/></label>
            <button type="button" onClick={()=>{setSelected(null);setContent("");}}>新建草稿</button>
          </div>
        </>:<form onSubmit={createNote} style={{display:"grid",gap:12}}>
          <h2>新建草稿</h2><label htmlFor="new-title">标题</label>
          <input id="new-title" style={input} value={title} onChange={e=>setTitle(e.target.value)} maxLength={200} required/>
          <label htmlFor="new-content">Markdown 正文</label>
          <textarea id="new-content" style={{...input,resize:"vertical",fontFamily:"monospace"}} value={content} onChange={e=>setContent(e.target.value)} rows={16}/>
          <button type="submit" disabled={busy}>创建草稿</button>
        </form>}
      </section>
    </div>
  </div>;
}
