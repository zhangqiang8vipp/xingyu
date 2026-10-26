"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
type SpaceInvite={spaceId:number;spaceName:string;email:string;role:string;expiresAt:number};
export default function AcceptSpaceInvitation({token}:{token:string}){
  const [invite,setInvite]=useState<SpaceInvite|null>(null);
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;
    void fetch("/api/space-invitations?token="+encodeURIComponent(token),{credentials:"same-origin",cache:"no-store"})
      .then(async response=>{
        const data=await response.json().catch(()=>({})) as {invitation?:SpaceInvite;error?:string};
        if(!response.ok)throw new Error(data.error??"邀请不可用");
        return data.invitation??null;
      }).then(i=>{if(active)setInvite(i);})
      .catch(e=>{if(active)setNotice(e instanceof Error?e.message:"邀请不可用");});
    return()=>{active=false;};
  },[token]);
  async function accept(){
    setBusy(true);setNotice("");
    try{
      const response=await fetch("/api/space-invitations",{method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
      const body=await response.json().catch(()=>({})) as {error?:string;result?:{spaceId:number}};
      if(!response.ok)throw new Error(body.error??"无法接受邀请");
      window.location.replace("/collaboration?spaceId="+String(body.result?.spaceId??""));
    }catch(e){setNotice(e instanceof Error?e.message:"接受邀请失败");}
    finally{setBusy(false);}
  }
  return <section>
    {invite?<><p>空间：<strong>{invite.spaceName}</strong></p>
      <p>受邀邮箱：{invite.email}</p><p>角色：{invite.role}</p>
      <p>仅授予此空间及其未限制继承的子空间，不会开放任何其他私人文章。</p>
      <button type="button" disabled={busy} onClick={()=>void accept()}>{busy?"处理中…":"确认加入"}</button>
    </>:null}
    {notice?<p role="alert">{notice}</p>:null}
    <p><Link href="/collaboration">返回协作空间</Link></p>
  </section>;
}
