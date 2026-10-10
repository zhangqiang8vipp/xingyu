"use client";
import {useState,type FormEvent} from "react";
export default function ForgotPasswordForm(){
  const [email,setEmail]=useState("");const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setMessage("");setError("");
    try{
      const response=await fetch("/api/identity/forgot-password",{
        method:"POST",headers:{"Content-Type":"application/json"},
        credentials:"same-origin",body:JSON.stringify({email}),
      });
      const body=await response.json().catch(()=>({})) as {error?:string;message?:string};
      if(!response.ok)setError(body.error||"暂时无法处理");
      else setMessage(body.message||"请检查邮箱");
    }catch{setError("网络错误，请重试");}finally{setBusy(false);}
  }
  return <form onSubmit={submit} style={{display:"grid",gap:12}}>
    <label htmlFor="recover-email">账号邮箱</label>
    <input id="recover-email" type="email" autoComplete="email" value={email}
      onChange={e=>setEmail(e.target.value)} required maxLength={254}/>
    {error?<p role="alert">{error}</p>:null}
    {message?<p role="status">{message}</p>:null}
    <button disabled={busy} type="submit">{busy?"发送中…":"发送重置邮件"}</button>
  </form>;
}
