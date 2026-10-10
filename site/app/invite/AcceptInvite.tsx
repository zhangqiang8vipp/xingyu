"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
type Invitation={workspaceId:number;workspaceName:string;email:string;role:string};
export default function AcceptInvite({token}:{token:string}){
  const [invitation,setInvitation]=useState<Invitation|null>(null);
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    void fetch("/api/invitations?token="+encodeURIComponent(token),{credentials:"same-origin",cache:"no-store"})
      .then(async response=>{
        const data=await response.json().catch(()=>({})) as {invitation?:Invitation;error?:string};
        if(!response.ok)throw new Error(data.error??"邀请已失效");
        return data.invitation??null;
      }).then(info=>{if(active)setInvitation(info);})
      .catch(error=>{if(active)setNotice(error instanceof Error?error.message:"邀请验证失败");});
    return ()=>{active=false;};
  },[token]);
  async function accept(){
    setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/invitations",{method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
      const info=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)throw new Error(info.error??"加入失败");
      window.location.replace("/workspace");
    }catch(error){setNotice(error instanceof Error?error.message:"加入失败");}
    finally{setBusy(false);}
  }
  return <section>
    {invitation?<><p>工作区：<strong>{invitation.workspaceName}</strong></p>
      <p>受邀邮箱：{invitation.email}</p><p>受邀角色：{invitation.role}</p>
      <button type="button" disabled={busy} onClick={()=>void accept()}>{busy?"加入中…":"接受邀请并加入"}</button>
    </>:null}
    {notice?<p role="alert">{notice}</p>:null}
    <p><Link href="/workspace">返回工作区</Link></p>
  </section>;
}
