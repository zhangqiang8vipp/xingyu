"use client";
import {useCallback,useEffect,useMemo,useState,type FormEvent} from "react";
import TeamWorkspacePanel from "./TeamWorkspacePanel";
import AccountSectionTabs from "@/features/admin/AccountSectionTabs";

type Role="owner"|"admin"|"member";
type Org={id:number;name:string;slug:string;ownerUserId:number;role:Role};
type Member={userId:number;name:string;email:string|null;role:Role;joinedAt:string};
type Unit={id:number;organizationId:number;parentId:number|null;name:string;sortOrder:number};
type Assignment={unitId:number;userId:number};
type Invitation={id:number;email:string;role:"admin"|"member";expiresAt:number};
type Reply={error?:string;organization?:Org;organizations?:Org[];members?:Member[];units?:Unit[];
  assignments?:Assignment[];invitations?:Invitation[];unit?:Unit;ok?:boolean};
const edge="1px solid var(--admin-line)";
async function call(path:string,method="GET",body?:object):Promise<Reply>{
  const res=await fetch(path,{method,credentials:"same-origin",cache:"no-store",
    ...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})});
  const data=await res.json().catch(()=>({})) as Reply;
  if(!res.ok)throw new Error(data.error??"操作失败");
  return data;
}
function flatten(units:Unit[]){
  const sorted=[...units].sort((a,b)=>a.sortOrder-b.sortOrder||a.id-b.id);
  const found=new Set<number>();
  const rows:{unit:Unit;depth:number}[]=[];
  function visit(parentId:number|null,depth:number) {
    if(depth>25)return;
    for(const u of sorted)if(u.parentId===parentId&&!found.has(u.id)){
      found.add(u.id);rows.push({unit:u,depth});visit(u.id,depth+1);
    }
  }
  visit(null,0);
  for(const u of sorted)if(!found.has(u.id))rows.push({unit:u,depth:0});
  return rows;
}
function illegalParent(parentId:number,unitId:number,units:Unit[]) {
  let id:number|null=parentId;
  const visited=new Set<number>();
  while(id!==null&&!visited.has(id)){
    if(id===unitId)return true;
    visited.add(id);id=units.find(x=>x.id===id)?.parentId??null;
  }
  return false;
}
const opt={padding:"8px 10px",maxWidth:"100%",color:"var(--admin-ink)",background:"var(--admin-control)"} as const;
export default function OrganizationsClient({initialOrganizations}:{initialOrganizations:Org[]}){
  const [organizations,setOrganizations]=useState(initialOrganizations);
  const [selectedId,setSelectedId]=useState(initialOrganizations[0]?.id??0);
  const selected=organizations.find(o=>o.id===selectedId);
  const canManage=selected?.role==="owner"||selected?.role==="admin";
  const root="/api/organizations/"+selectedId;
  const [createName,setCreateName]=useState("");
  const [memberEmail,setMemberEmail]=useState("");
  const [inviteRole,setInviteRole]=useState<"admin"|"member">("member");
  const [newUnitName,setNewUnitName]=useState("");
  const [newUnitParent,setNewUnitParent]=useState(0);
  const [members,setMembers]=useState<Member[]>([]);
  const [units,setUnits]=useState<Unit[]>([]);
  const [assignments,setAssignments]=useState<Assignment[]>([]);
  const [invitations,setInvitations]=useState<Invitation[]>([]);
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [section,setSection]=useState<"overview"|"members"|"teams"|"units">("overview");
  const ordered=useMemo(()=>flatten(units),[units]);
  const refresh=useCallback(async()=>{
    if(!selectedId)return;
    const [a,b,c]=await Promise.all([
      call("/api/organizations/"+selectedId+"/members"),
      call("/api/organizations/"+selectedId+"/units"),
      ...(canManage?[call("/api/organizations/"+selectedId+"/invitations")]:[]),
    ]);
    setMembers(a.members??[]);setUnits(b.units??[]);setAssignments(b.assignments??[]);
    setInvitations(c?.invitations??[]);
  },[selectedId,canManage]);
  useEffect(()=>{
    if(!selectedId)return;
    let active=true;
    void Promise.all([
      call("/api/organizations/"+selectedId+"/members"),
      call("/api/organizations/"+selectedId+"/units"),
      ...(canManage?[call("/api/organizations/"+selectedId+"/invitations")]:[]),
    ]).then(([a,b,c])=>{
      if(!active)return;
      setMembers(a.members??[]);setUnits(b.units??[]);setAssignments(b.assignments??[]);
      setInvitations(c?.invitations??[]);
    }).catch(e=>{if(active)setNotice(e instanceof Error?e.message:"无法载入组织");});
    return()=>{active=false;};
  },[selectedId,canManage]);
  async function run(fn:()=>Promise<unknown>,message:string,refreshOrg=true){
    setBusy(true);setNotice("");
    try{await fn();if(refreshOrg)await refresh();setNotice(message);}
    catch(e){setNotice(e instanceof Error?e.message:"操作失败");}
    finally{setBusy(false);}
  }
  async function create(event:FormEvent){
    event.preventDefault();
    await run(async()=>{
      const r=await call("/api/organizations","POST",{name:createName});
      if(!r.organization)throw new Error("创建组织未返回结果");
      setOrganizations(old=>[...old,r.organization!]);
      setSelectedId(r.organization.id);
      setNewUnitParent(0);setInviteRole("member");
      setCreateName("");
    },"组织已创建",false);
  }
  function sendInvitation(event:FormEvent){
    event.preventDefault();
    void run(async()=>{
      await call(root+"/invitations","POST",{email:memberEmail,role:inviteRole});
      setMemberEmail("");
    },"邀请邮件已发送");
  }
  function createUnit(event:FormEvent){
    event.preventDefault();
    void run(async()=>{
      await call(root+"/units","POST",{name:newUnitName,parentId:newUnitParent||null});
      setNewUnitName("");
    },"部门已创建");
  }
  function renameOrg(){
    const name=window.prompt("组织新名称",selected?.name??"");
    if(name===null)return;
    void run(async()=>{
      const result=await call(root,"PATCH",{name});
      if(result.organization)setOrganizations(old=>old.map(o=>o.id===selectedId?result.organization!:o));
    },"组织已更名");
  }
  function renameUnit(unit:Unit){
    const name=window.prompt("部门新名称",unit.name);
    if(name===null)return;
    void run(()=>call(root+"/units/"+unit.id,"PATCH",{name}),"部门已更名");
  }
  function moveUnit(unit:Unit,parentId:number|null){
    if(parentId===unit.parentId)return;
    void run(()=>call(root+"/units/"+unit.id,"PATCH",{parentId}),"部门已移动");
  }
  function deleteUnit(unit:Unit){
    if(!window.confirm("删除空部门「"+unit.name+"」？含子部门或成员的部门不可删除。"))return;
    void run(()=>call(root+"/units/"+unit.id,"DELETE"),"部门已删除");
  }
  function changeMember(member:Member,role:"admin"|"member"){
    if(!window.confirm("把 "+member.name+" 调整为 "+role+"？"))return;
    void run(()=>call(root+"/members/"+member.userId,"PATCH",{role}),"成员角色已更新");
  }
  function removeMember(member:Member){
    if(!window.confirm("移除 "+member.name+"？该用户会失去组织及部门成员资格，但个人工作区保持不变。"))return;
    void run(()=>call(root+"/members/"+member.userId,"DELETE"),"成员已移除");
  }
  function leave(){
    if(!window.confirm("退出组织？不会删除你的个人工作区或其他组织身份。"))return;
    void run(async()=>{
      await call(root+"/members/leave","POST");
      const remaining=organizations.filter(o=>o.id!==selectedId);
      setOrganizations(remaining);setSelectedId(remaining[0]?.id??0);
      setNewUnitParent(0);setInviteRole("member");
      setMembers([]);setUnits([]);setAssignments([]);
    },"已退出组织",false);
  }
  const noShareNotice="组织成员与部门分组本身不授予工作区阅读权限。需要共享内容，请到工作区单独邀请成员。";
  return <section className="organization-dashboard">
    <section className="editor-section">
      <h2>我的组织</h2>
      <form onSubmit={e=>void create(e)} style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"end"}}>
        <label>创建新组织
          <input required maxLength={100} value={createName} onChange={e=>setCreateName(e.target.value)}
            placeholder="例如：星屿科技" style={{...opt,display:"block",marginTop:6}}/>
        </label>
        <button className="new-button" type="submit" disabled={busy}>创建</button>
      </form>
      {organizations.length>0?<div style={{marginTop:16,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <label htmlFor="org-picker">当前组织</label>
        <select id="org-picker" value={selectedId} style={opt}
          onChange={e=>{setSelectedId(Number(e.target.value));setNotice("");setNewUnitParent(0);setInviteRole("member");setMembers([]);setUnits([]);setAssignments([]);setInvitations([]);}}>
          {organizations.map(o=><option key={o.id} value={o.id}>{o.name} · {o.role}</option>)}
        </select>
        {canManage?<button disabled={busy} type="button" onClick={renameOrg}>更改组织名称</button>:null}
        {selected?.role!=="owner"?<button type="button" disabled={busy} onClick={leave}>退出组织</button>:null}
      </div>:<p>尚未加入组织，先创建一个组织即可开始管理成员和部门。</p>}
      {notice?<p role="status">{notice}</p>:null}
    </section>
    {selected?<><section className="organization-page-section"><AccountSectionTabs label="组织功能" active={section} onChange={setSection} tabs={[{id:"overview",label:"总览"},{id:"members",label:"组织成员"},{id:"teams",label:"团队与知识库"},{id:"units",label:"部门架构"}]}/>
    <p style={{margin:0,fontSize:13,opacity:0.8}}>{noShareNotice}</p>
    {section==="overview"?<section className="editor-section"><h2>{selected.name}</h2><p>组织管理集中在上方四个入口。成员决定组织身份，团队负责协作，知识库授权单独控制。</p><div className="account-intro-stats"><span><strong>{members.length}</strong><small>组织成员</small></span><span><strong>{units.length}</strong><small>部门</small></span></div><p>选择「组织成员」发送邀请；选择「团队与知识库」设置共享权限；选择「部门架构」安排组织结构。</p></section>:null}
    {section==="members"?<section className="editor-section">
      <h2>组织成员</h2>
      <div style={{display:"grid",gap:8}}>
        {members.map(member=><div className="integration-card" key={member.userId} style={{display:"flex",gap:12,justifyContent:"space-between",alignItems:"center",flexWrap:"wrap"}}>
          <div><strong>{member.name}</strong><div style={{fontSize:12}}>{member.email??"邮箱未展示"} · {member.role}</div></div>
          {canManage&&member.role!=="owner"&&(selected.role==="owner"||member.role==="member")?
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <select style={opt} value={member.role} disabled={busy} aria-label={"修改 "+member.name+" 的组织角色"}
              onChange={e=>changeMember(member,e.target.value as "admin"|"member")}>
              {selected.role==="owner"?<option value="admin">Admin</option>:null}
              <option value="member">Member</option>
            </select>
            <button className="admin-account-danger" type="button" disabled={busy} onClick={()=>removeMember(member)}>移除</button>
          </div>:null}
        </div>)}
      </div>
      {canManage?<><h3 style={{marginTop:24}}>邮件邀请</h3>
        <form onSubmit={sendInvitation} style={{display:"flex",alignItems:"end",gap:8,flexWrap:"wrap"}}>
          <label>受邀邮箱
            <input type="email" required maxLength={254} value={memberEmail}
              onChange={e=>setMemberEmail(e.target.value)} style={{...opt,display:"block"}}/>
          </label>
          <label>角色
            <select value={inviteRole} style={{...opt,display:"block"}}
              onChange={e=>setInviteRole(e.target.value as "admin"|"member")}>
              {selected.role==="owner"?<option value="admin">Admin</option>:null}
              <option value="member">Member</option>
            </select>
          </label>
          <button className="new-button" type="submit" disabled={busy}>发送邀请</button>
        </form>
        <h3 style={{marginTop:20}}>待接受邀请</h3>
        {invitations.length===0?<p>没有待接受邀请。</p>:
          <ul>{invitations.map(i=><li key={i.id} style={{marginBottom:8}}>
            {i.email} · {i.role}
            <button className="admin-account-danger" style={{marginLeft:10}} disabled={busy} onClick={()=>
              void run(()=>call(root+"/invitations/"+i.id,"DELETE"),"邀请已撤销")}>撤销邀请</button>
          </li>)}</ul>}
      </>:null}
    </section>:null}
    {section==="teams"?<TeamWorkspacePanel key={selected.id} organization={selected} members={members}/>:null}
    {section==="units"?<section className="editor-section">
      <h2>部门架构</h2>
      <p>部门可多级嵌套；成员可以同时属于多个部门。移动部门不会改变任何工作区访问权限。</p>
      {canManage?<form onSubmit={createUnit} style={{display:"flex",gap:8,alignItems:"end",flexWrap:"wrap"}}>
        <label>部门名称
          <input required maxLength={80} value={newUnitName}
            onChange={e=>setNewUnitName(e.target.value)} style={{...opt,display:"block"}}/>
        </label>
        <label>上级部门
          <select value={newUnitParent} onChange={e=>setNewUnitParent(Number(e.target.value))} style={{...opt,display:"block"}}>
            <option value={0}>组织直属</option>
            {ordered.map(({unit,depth})=><option key={unit.id} value={unit.id}>{"　".repeat(Math.min(depth,10))}{unit.name}</option>)}
          </select>
        </label>
        <button className="new-button" type="submit" disabled={busy}>创建部门</button>
      </form>:null}
      <div style={{display:"grid",gap:9,marginTop:18}}>
        {ordered.length===0?<p>暂无部门。可以先创建技术部、产品部、运营部等。</p>:null}
        {ordered.map(({unit,depth})=>{
          const assigned=assignments.filter(a=>a.unitId===unit.id);
          return <div className="integration-card" key={unit.id} style={{marginLeft:Math.min(depth,10)*16}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",justifyContent:"space-between"}}>
              <strong>{depth>0?"└ ":""}{unit.name}</strong>
              {canManage?<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <button type="button" disabled={busy} onClick={()=>renameUnit(unit)}>更名</button>
                <label style={{fontSize:12}}>上级
                  <select value={unit.parentId??0} disabled={busy} style={{...opt,marginLeft:4}}
                    onChange={e=>moveUnit(unit,Number(e.target.value)||null)}>
                    <option value={0}>组织直属</option>
                    {units.filter(u=>u.id!==unit.id&&!illegalParent(u.id,unit.id,units))
                      .map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </label>
                <button className="admin-account-danger" type="button" disabled={busy} onClick={()=>deleteUnit(unit)}>删除</button>
              </div>:null}
            </div>
            <div style={{marginTop:8,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              {assigned.length===0?<small>暂无部门成员</small>:
                assigned.map(a=>{
                  const m=members.find(item=>item.userId===a.userId);
                  return <span key={a.userId} style={{fontSize:12,border:edge,borderRadius:16,padding:"3px 8px"}}>
                    {m?.name??"已退出成员"}
                    {canManage?<button type="button" disabled={busy} title="移出此部门" style={{marginLeft:6}}
                      onClick={()=>void run(()=>call(root+"/units/"+unit.id+"/members","DELETE",{userId:a.userId}),"已从部门移除")}>×</button>:null}
                  </span>;
                })}
              {canManage?<select value="" disabled={busy} aria-label={"向 "+unit.name+" 添加成员"} style={opt}
                onChange={e=>{const id=Number(e.target.value);
                  if(id)void run(()=>call(root+"/units/"+unit.id+"/members","POST",{userId:id}),"部门成员已添加");}}>
                <option value="">+ 添加成员</option>
                {members.filter(m=>!assigned.some(a=>a.userId===m.userId))
                  .map(m=><option key={m.userId} value={m.userId}>{m.name}</option>)}
              </select>:null}
            </div>
          </div>;
        })}
      </div>
    </section>:null}</section></>:null}
  </section>;
}
