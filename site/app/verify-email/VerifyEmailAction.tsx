"use client";
import { useState } from "react";
export default function VerifyEmailAction({token}:{token:string}){
  const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);const [done,setDone]=useState(false);
  async function verify(){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/identity/verify",{method:"POST",
        headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({token})});
      const data=await response.json().catch(()=>({}));
      setDone(response.ok);setMessage(response.ok?"验证成功，现在可以登录星屿。":data.error||"验证失败");
    }catch{setMessage("网络错误，请重试");}finally{setBusy(false);}
  }
  return <section>
    <button type="button" disabled={busy||done||!/^[A-Za-z0-9_-]{40,60}$/.test(token)} onClick={verify}>
      {busy?"验证中…":"确认验证邮箱"}
    </button>
    {message&&<p role="status">{message}</p>}
  </section>;
}
