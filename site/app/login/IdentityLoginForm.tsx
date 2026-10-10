"use client";
import { useState, type FormEvent } from "react";
export default function IdentityLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await fetch("/api/identity/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }), credentials: "same-origin" });
      if (!result.ok) {
        const data = await result.json().catch(() => ({}));
        setError(data.error || "登录失败");
      } else {
        window.location.replace("/");
      }
    } catch { setError("网络错误，请重试"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
    <label htmlFor="identity-email">邮箱</label>
    <input id="identity-email" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} />
    <label htmlFor="identity-password">密码</label>
    <input id="identity-password" type="password" autoComplete="current-password" minLength={12} required value={password} onChange={e=>setPassword(e.target.value)} />
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? "登录中…" : "登录"}</button>
  </form>;
}
