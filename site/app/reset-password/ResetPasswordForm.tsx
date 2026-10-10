"use client";
import {useState,type FormEvent} from "react";
export default function ResetPasswordForm({token}:{token:string}){
  const [password,setPassword]=useState("");const [again,setAgain]=useState("");
  const [message,setMessage]=useState("");const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);const [done,setDone]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault();setMessage("");setError("");
    if(password!==again){setError("两次密码不一致");return;}
    setBusy(true);
    try{
      const response=await fetch("/api/identity/reset-password",{
        method:"POST",headers:{"Content-Type":"application/json"},
        credentials:"same-origin",body:JSON.stringify({token,password}),
      });
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok)setError(body.error||"链接无效或已过期");
      else{setDone(true);setPassword("");setAgain("");setMessage("密码已重置。请使用新密码重新登录。");}
    }catch{setError("网络错误，请重试");}finally{setBusy(false);}
  }
  return <form onSubmit={submit} style={{display:"grid",gap:12}}>
    <label htmlFor="reset-password">新密码（至少 12 位）</label>
    <input id="reset-password" type="password" autoComplete="new-password" required
      minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/>
    <label htmlFor="reset-confirm">再次输入新密码</label>
    <input id="reset-confirm" type="password" autoComplete="new-password" required
      minLength={12} maxLength={128} value={again} onChange={e=>setAgain(e.target.value)}/>
    {error?<p role="alert">{error}</p>:null}
    {message?<p role="status">{message}</p>:null}
    <button type="submit" disabled={busy||done||!/^[A-Za-z0-9_-]{40,60}$/.test(token)}>
      {busy?"重置中…":"确认重置密码"}
    </button>
  </form>;
}
