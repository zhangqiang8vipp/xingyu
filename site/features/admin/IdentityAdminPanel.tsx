import type {ReactNode} from "react";
import {getSiteSettings} from "@/db/queries";
import ThemeToggle from "@/features/navigation/ThemeToggle";
import "@/app/admin/login/login.css";

/** Same sign-in chrome and CSS used by the original XingYu admin login. */
export default async function IdentityAdminPanel({
  title,description,eyebrow="XINGYU IDENTITY",children,
}:{
  title:string;description:string;eyebrow?:string;children:ReactNode;
}){
  const settings=await getSiteSettings();
  return <main className="signin admin-signin">
    <div className="admin-login-theme"><ThemeToggle/></div>
    <div>
      <span className="admin-mark">{settings.brandName.slice(0,1)}</span>
      <small>{eyebrow}</small>
      <h1>{title}</h1>
      <p>{description}</p>
      <div className="admin-login-form">{children}</div>
    </div>
  </main>;
}
