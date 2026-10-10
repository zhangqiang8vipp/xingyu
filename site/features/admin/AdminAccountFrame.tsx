"use client";

import {useEffect,useState,type ReactNode} from "react";
import AdminSidebar from "./AdminSidebar";

type AccountArea="workspace"|"organizations";
type Props={
  area:AccountArea;
  brandName:string;
  userName:string;
  isLegacyAdmin:boolean;
  children:ReactNode;
};

/** Reuses the existing admin shell/sidebar/typography; only switches authorized account routes. */
export default function AdminAccountFrame({area,brandName,userName,isLegacyAdmin,children}:Props){
  const [collapsed,setCollapsed]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    const frame=window.requestAnimationFrame(()=>
      setCollapsed(window.localStorage.getItem("xingyu:admin-sidebar")==="collapsed"));
    return ()=>window.cancelAnimationFrame(frame);
  },[]);
  function toggleSidebar(){
    setCollapsed(old=>{
      const next=!old;
      window.localStorage.setItem("xingyu:admin-sidebar",next?"collapsed":"expanded");
      return next;
    });
  }
  async function signOut(){
    setError("");
    try {
      const response=await fetch("/api/identity/logout",{method:"POST",credentials:"same-origin"});
      if(!response.ok)throw new Error("退出失败，请重试");
      window.location.replace("/login");
    }catch{setError("退出失败，请检查网络连接后重试");}
  }
  const organization=area==="organizations";
  return <main className={`admin-shell admin-account-shell${collapsed?" sidebar-collapsed":""}`}>
    <AdminSidebar brandName={brandName} avatarUrl="" authorName="" userName={userName}
      accountArea={area} isLegacyAdmin={isLegacyAdmin}
      collapsed={collapsed} onToggle={toggleSidebar} onSignOut={()=>void signOut()}/>
    <div className="admin-workspace">
      <section className="admin-main admin-config-main admin-account-main">
        <header className="admin-header">
          <div>
            <p>{organization?"ORGANIZATION / COLLABORATION":"PERSONAL / KNOWLEDGE"}</p>
            <h1>{organization?"组织与团队":"我的知识空间"}</h1>
            <span>{organization
              ?"管理部门、团队和组织授权；组织成员身份不会自动开放私人内容。"
              :"管理个人与共享空间，内容仅向获得授权的成员开放。"}</span>
          </div>
        </header>
        {error?<p role="alert">{error}</p>:null}
        <div className="admin-account-content">{children}</div>
      </section>
    </div>
  </main>;
}
