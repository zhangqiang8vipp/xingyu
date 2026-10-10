"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
type Invite={organizationId:number;organizationName:string;email:string;role:string;expiresAt:number};
export default function AcceptOrganizationInvitation({token}:{token:string}){
  const [invite,setInvite]=useState<Invite|null>(null);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    void fetch("/api/organization-invitations?token="+encodeURIComponent(token),{credentials:"same-origin",cache:"no-store"})
      .then(async response=>{
        const data=await response.json().catch(()=>({})) as {invitation?:Invite;error?:string};
        if(!response.ok)throw new Error(data.error??"邀请不可用");
        return data.invitation??null;
      }).then(i=>{if(active)setInvite(i);})
      .catch(e=>{if(active)setMessage(e instanceof Error?e.message:"邀请不可用");});
    return()=>{active=false;};
  },[token]);
  async function accept(){
    setBusy(true);setMessage("");
    try{
      const res=await fetch("/api/organization-invitations",{method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
      const data=await res.json().catch(()=>({})) as {error?:string};
      if(!res.ok)throw new Error(data.error??"无法接受邀请");
      window.location.replace("/organizations");
    }catch(e){setMessage(e instanceof Error?e.message:"无法接受邀请");}
    finally{setBusy(false);}
  }
  return <section>
    {invite?<><p>组织：<strong>{invite.organizationName}</strong></p>
      <p>邮箱：{invite.email}</p><p>角色：{invite.role}</p>
      <p>接受组织邀请不会让组织成员自动看到你的私人知识库。</p>
      <button type="button" disabled={busy} onClick={()=>void accept()}>{busy?"处理中…":"确认加入组织"}</button>
    </>:null}
    {message?<p role="alert">{message}</p>:null}
    <p><Link href="/organizations">返回我的组织</Link></p>
  </section>;
}
