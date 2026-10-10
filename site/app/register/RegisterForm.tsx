"use client";
import { useState, type FormEvent } from "react";
export default function RegisterForm() {
  const [name,setName]=useState(""); const [email,setEmail]=useState("");
  const [password,setPassword]=useState(""); const [message,setMessage]=useState("");
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  async function send(event:FormEvent){
    event.preventDefault();setBusy(true);setError("");setMessage("");
    try {
      const response=await fetch("/api/identity/register",{
        method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",
        body:JSON.stringify({name,email,password}),
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)setError(data.error||"注册失败");
      else {setPassword("");setMessage(data.message||"请查收验证邮件");}
    } catch {setError("网络错误，请重试");}
    finally {setBusy(false);}
  }
  async function resend(){
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch("/api/identity/resend",{method:"POST",
        headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({email})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)setError(data.error||"操作失败");
      else setMessage(data.message||"请检查邮箱");
    }catch{setError("网络错误");} finally{setBusy(false);}
  }
  return <form onSubmit={send} style={{display:"grid",gap:12}}>
    <label htmlFor="join-name">昵称</label>
    <input id="join-name" required minLength={1} maxLength={64} value={name} onChange={e=>setName(e.target.value)} autoComplete="nickname"/>
    <label htmlFor="join-email">邮箱</label>
    <input id="join-email" type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/>
    <label htmlFor="join-password">密码（至少 12 位）</label>
    <input id="join-password" type="password" required minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password"/>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <button type="submit" disabled={busy}>{busy?"处理中…":"注册并发送验证邮件"}</button>
    <button type="button" disabled={busy||!email} onClick={resend}>重发验证邮件</button>
  </form>;
}
