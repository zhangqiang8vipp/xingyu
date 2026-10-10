"use client";
import {useEffect,useState,type FormEvent} from "react";
type Role="owner"|"admin"|"member";
type Member={userId:number;name:string;email:string|null;role:Role};
type Org={id:number;name:string;role:Role};
type Team={id:number;organizationId:number;name:string;slug:string};
type MemberLink={teamId:number;userId:number};
type Workspace={id:number;name:string;kind:string};
type Grant={teamId:number;teamName:string;role:"editor"|"viewer"};
type Space={id:number;name:string;parentId:number|null};
type Principal={principalType:"user"|"team";principalId:number;role:"editor"|"viewer"};
type ResponseData={error?:string;teams?:Team[];memberships?:MemberLink[];workspaces?:Workspace[];
  grants?:Grant[];spaces?:Space[];access?:{restricted:boolean;grants:Principal[]}};
async function req(url:string,method="GET",body?:object):Promise<ResponseData>{
  const res=await fetch(url,{method,credentials:"same-origin",cache:"no-store",
    ...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
  const data=await res.json().catch(()=>({})) as ResponseData;
  if(!res.ok)throw new Error(data.error??"操作失败");
  return data;
}
const border="1px solid var(--admin-line)";
const input={padding:8,maxWidth:"100%"} as const;
export default function TeamWorkspacePanel({organization,members}:{organization:Org;members:Member[]}){
  const root="/api/organizations/"+organization.id;
  const manager=organization.role==="owner"||organization.role==="admin";
  const [teams,setTeams]=useState<Team[]>([]);
  const [teamMembers,setTeamMembers]=useState<MemberLink[]>([]);
  const [workspaces,setWorkspaces]=useState<Workspace[]>([]);
  const [selectedWorkspace,setSelectedWorkspace]=useState(0);
  const [grants,setGrants]=useState<Grant[]>([]);
  const [spaces,setSpaces]=useState<Space[]>([]);
  const [selectedSpace,setSelectedSpace]=useState(0);
  const [acl,setAcl]=useState<{restricted:boolean;grants:Principal[]}|null>(null);
  const [teamName,setTeamName]=useState("");
  const [workspaceName,setWorkspaceName]=useState("");
  const [grantTeam,setGrantTeam]=useState(0);
  const [grantRole,setGrantRole]=useState<"viewer"|"editor">("viewer");
  const [principalType,setPrincipalType]=useState<"user"|"team">("team");
  const [principalId,setPrincipalId]=useState(0);
  const [principalRole,setPrincipalRole]=useState<"viewer"|"editor">("viewer");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  const refresh=async()=>{
    const [a,b]=await Promise.all([req(root+"/teams"),req(root+"/workspaces")]);
    setTeams(a.teams??[]);setTeamMembers(a.memberships??[]);setWorkspaces(b.workspaces??[]);
  };
  useEffect(()=>{
    let alive=true;
    void Promise.all([req(root+"/teams"),req(root+"/workspaces")]).then(([a,b])=>{
      if(!alive)return;
      setTeams(a.teams??[]);setTeamMembers(a.memberships??[]);setWorkspaces(b.workspaces??[]);
    }).catch(error=>{if(alive)setNotice(error instanceof Error?error.message:"无法加载团队");});
    return()=>{alive=false;};
  },[root]);
  useEffect(()=>{
    if(!selectedWorkspace)return;
    let alive=true;
    void Promise.all([
      req(root+"/workspaces/"+selectedWorkspace+"/grants"),
      req("/api/workspaces/"+selectedWorkspace+"/spaces?parent_id=all"),
    ]).then(([a,b])=>{
      if(!alive)return;
      setGrants(a.grants??[]);setSpaces(b.spaces??[]);
    }).catch(error=>{
      if(alive){setGrants([]);setSpaces([]);setNotice(error instanceof Error?error.message:"没有此工作区的管理权限");}
    });
    return()=>{alive=false;};
  },[root,selectedWorkspace]);
  useEffect(()=>{
    if(!selectedWorkspace||!selectedSpace)return;
    let alive=true;
    void req("/api/workspaces/"+selectedWorkspace+"/spaces/"+selectedSpace+"/access")
      .then(data=>{if(alive)setAcl(data.access??null);})
      .catch(error=>{if(alive){setAcl(null);setNotice(error instanceof Error?error.message:"无法读取空间授权");}});
    return()=>{alive=false;};
  },[selectedWorkspace,selectedSpace]);
  async function run(fn:()=>Promise<unknown>,message:string){
    setBusy(true);setNotice("");
    try{await fn();await refresh();setNotice(message);}
    catch(error){setNotice(error instanceof Error?error.message:"操作失败");}
    finally{setBusy(false);}
  }
  async function refreshWorkspace(){
    if(!selectedWorkspace)return;
    const [a,b]=await Promise.all([req(root+"/workspaces/"+selectedWorkspace+"/grants"),
      req("/api/workspaces/"+selectedWorkspace+"/spaces?parent_id=all")]);
    setGrants(a.grants??[]);setSpaces(b.spaces??[]);
  }
  async function refreshAcl(){
    if(!selectedSpace||!selectedWorkspace)return;
    const data=await req("/api/workspaces/"+selectedWorkspace+"/spaces/"+selectedSpace+"/access");
    setAcl(data.access??null);
  }
  const spaceApi="/api/workspaces/"+selectedWorkspace+"/spaces/"+selectedSpace+"/access";
  function createTeam(e:FormEvent){e.preventDefault();
    void run(async()=>{await req(root+"/teams","POST",{name:teamName});setTeamName("");},"团队已创建");}
  function createWorkspace(e:FormEvent){e.preventDefault();
    void run(async()=>{await req(root+"/workspaces","POST",{name:workspaceName});setWorkspaceName("");},"组织工作区已创建");}
  return <section className="editor-section">
    <h2>团队与组织知识库</h2>
    <p>团队可跨部门。组织成员不会自动访问知识库，只有获工作区授权的团队成员才有读写资格。</p>
    {notice?<p role="status">{notice}</p>:null}
    {manager?<form onSubmit={createTeam} style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"end"}}>
      <label>创建团队 <input value={teamName} maxLength={80} required onChange={e=>setTeamName(e.target.value)} style={{...input,display:"block"}}/></label>
      <button className="new-button" type="submit" disabled={busy}>添加团队</button>
    </form>:null}
    <div style={{display:"grid",gap:8,marginTop:14}}>
      {teams.length===0?<p>暂无团队。</p>:null}
      {teams.map(t=>{
        const assigned=teamMembers.filter(m=>m.teamId===t.id);
        return <div className="integration-card" key={t.id}>
          <div style={{display:"flex",gap:10,justifyContent:"space-between",flexWrap:"wrap"}}>
            <strong>{t.name}</strong>
            {manager?<div style={{display:"flex",gap:7}}>
              <button disabled={busy} type="button" onClick={()=>{
                const name=window.prompt("团队名称",t.name);if(name===null)return;
                void run(()=>req(root+"/teams/"+t.id,"PATCH",{name}),"团队已更新");
              }}>更名</button>
              <button className="admin-account-danger" disabled={busy} type="button" onClick={()=>{
                if(!window.confirm("只允许删除无成员且无授权的团队。继续？"))return;
                void run(()=>req(root+"/teams/"+t.id,"DELETE"),"团队已删除");
              }}>删除</button>
            </div>:null}
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginTop:10}}>
            {assigned.map(assignment=>{
              const member=members.find(m=>m.userId===assignment.userId);
              return <span key={assignment.userId} style={{border,borderRadius:18,padding:"4px 8px",fontSize:12}}>
                {member?.name??"其他成员"}
                {manager?<button type="button" disabled={busy} style={{marginLeft:5}}
                  onClick={()=>void run(()=>req(root+"/teams/"+t.id+"/members","DELETE",{userId:assignment.userId}),
                    "成员已从团队移除，工作区权限立即变化")}>×</button>:null}
              </span>;
            })}
            {manager?<select style={input} aria-label={"添加 "+t.name+" 的成员"} value=""
              disabled={busy} onChange={e=>{const id=Number(e.target.value);if(id)void run(
                ()=>req(root+"/teams/"+t.id+"/members","POST",{userId:id}),"成员已加入团队");}}>
              <option value="">+ 添加组织成员</option>
              {members.filter(m=>!assigned.some(a=>a.userId===m.userId)).map(m=>
                <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </select>:null}
          </div>
        </div>;
      })}
    </div>
    <hr style={{borderTop:border,borderBottom:0,margin:"22px 0"}}/>
    <h3>组织工作区</h3>
    {organization.role==="owner"?<form onSubmit={createWorkspace} style={{display:"flex",gap:8,alignItems:"end",flexWrap:"wrap"}}>
      <label>工作区名称 <input value={workspaceName} maxLength={80} required onChange={e=>setWorkspaceName(e.target.value)}
        style={{...input,display:"block"}}/></label>
      <button className="new-button" type="submit" disabled={busy}>创建组织工作区</button>
    </form>:null}
    {workspaces.length===0?<p>尚无组织工作区。</p>:
      <label style={{display:"block",marginTop:12}}>选择组织工作区
        <select style={{...input,display:"block"}} value={selectedWorkspace} onChange={e=>{
          setSelectedWorkspace(Number(e.target.value));setSelectedSpace(0);setAcl(null);setGrants([]);setSpaces([]);
        }}>
          <option value={0}>请选择</option>
          {workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </label>}
    {selectedWorkspace&&manager?<section className="integration-card" style={{marginTop:18}}>
      <h4>团队工作区授权</h4>
      <p>仅具有该工作区管理权限的成员可以授予团队 Viewer 或 Editor；组织管理员身份不能自动越过工作区权限。</p>
      <div style={{display:"grid",gap:7}}>
        {grants.map(g=><div key={g.teamId} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
          <span>{g.teamName} · {g.role}</span>
          <button className="admin-account-danger" disabled={busy} type="button" onClick={()=>void run(async()=>{
            await req(root+"/workspaces/"+selectedWorkspace+"/grants/"+g.teamId,"DELETE");
            await refreshWorkspace();
          },"团队工作区授权已撤销")}>撤销</button>
        </div>)}
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"end",marginTop:12}}>
        <label>团队
          <select style={{...input,display:"block"}} value={grantTeam} onChange={e=>setGrantTeam(Number(e.target.value))}>
            <option value={0}>选择团队</option>
            {teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>角色 <select style={{...input,display:"block"}} value={grantRole}
          onChange={e=>setGrantRole(e.target.value as "viewer"|"editor")}>
          <option value="viewer">Viewer</option><option value="editor">Editor</option>
        </select></label>
        <button disabled={busy||!grantTeam} type="button" onClick={()=>void run(async()=>{
          await req(root+"/workspaces/"+selectedWorkspace+"/grants","POST",{teamId:grantTeam,role:grantRole});
          await refreshWorkspace();
        },"团队权限已更新")}>保存授权</button>
      </div>
      {spaces.length>0?<section className="integration-card" style={{marginTop:20}}>
        <h4>知识空间细粒度 ACL</h4>
        <p>受限空间要求同时获得本空间及受限上级空间的授权；授权不会提升原有工作区权限。</p>
        <label>选择知识空间
          <select value={selectedSpace} style={{...input,display:"block"}}
            onChange={e=>{setSelectedSpace(Number(e.target.value));setAcl(null);}}>
            <option value={0}>请选择</option>
            {spaces.map(s=><option key={s.id} value={s.id}>{s.name}（#{s.id}）</option>)}
          </select>
        </label>
        {selectedSpace&&acl?<div className="integration-card" style={{marginTop:12}}>
          <label style={{display:"flex",gap:10,alignItems:"center"}}>
            <input type="checkbox" checked={acl.restricted} disabled={busy}
              onChange={e=>void run(async()=>{
                const res=await req(spaceApi,"PUT",{restricted:e.target.checked});
                setAcl(res.access??null);
              },"空间权限策略已更新")}/>
            启用受限策略
          </label>
          {acl.restricted?<><h5>允许访问的主体</h5>
            {acl.grants.map(g=><div key={g.principalType+g.principalId}
              style={{display:"flex",gap:8,justifyContent:"space-between",marginBottom:8}}>
              <span>{g.principalType==="team"?"团队："+(teams.find(t=>t.id===g.principalId)?.name??g.principalId):
                "用户："+(members.find(m=>m.userId===g.principalId)?.name??g.principalId)} · {g.role}</span>
              <button className="admin-account-danger" type="button" disabled={busy} onClick={()=>void run(async()=>{
                const res=await req(spaceApi+"/grants","DELETE",{principalType:g.principalType,principalId:g.principalId});
                setAcl(res.access??null);
              },"空间主体授权已移除")}>撤销</button>
            </div>)}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"end"}}>
              <label>主体类型
                <select style={{...input,display:"block"}} value={principalType} onChange={e=>{
                  setPrincipalType(e.target.value as "user"|"team");setPrincipalId(0);
                }}>
                  <option value="team">团队</option><option value="user">用户</option>
                </select>
              </label>
              <label>主体
                <select style={{...input,display:"block"}} value={principalId}
                  onChange={e=>setPrincipalId(Number(e.target.value))}>
                  <option value={0}>请选择</option>
                  {principalType==="team"
                    ?teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)
                    :members.map(m=><option key={m.userId} value={m.userId}>{m.name}</option>)}
                </select>
              </label>
              <label>权限
                <select style={{...input,display:"block"}} value={principalRole}
                  onChange={e=>setPrincipalRole(e.target.value as "viewer"|"editor")}>
                  <option value="viewer">Viewer</option><option value="editor">Editor</option>
                </select>
              </label>
              <button type="button" disabled={busy||!principalId} onClick={()=>void run(async()=>{
                const res=await req(spaceApi+"/grants","POST",{principalType,principalId,role:principalRole});
                setAcl(res.access??null);
              },"知识空间授权已更新")}>设置权限</button>
            </div>
          </>:<p>此空间未启用额外限制，遵循工作区权限和上级空间的限制。</p>}
        </div>:null}
      </section>:null}
    </section>:null}
  </section>;
}
