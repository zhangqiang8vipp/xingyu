import Link from "next/link";
import type {ReactNode} from "react";

type Props={eyebrow?:string;title:string;description:string;children:ReactNode};
export default function AuthShell({eyebrow="XINGYU IDENTITY",title,description,children}:Props){
  return <main className="xy-auth">
    <div className="xy-auth-layout">
      <aside className="xy-auth-story">
        <Link href="/" className="xy-auth-brand"><span aria-hidden="true">✦</span> 星屿 <small>XINGYU</small></Link>
        <div className="xy-auth-story-content">
          <span className="xy-auth-story-kicker">A QUIET SPACE FOR IDEAS</span>
          <h2>让每一个想法，<br/>都有安放的地方<span className="xy-auth-story-period">.</span></h2>
          <p>一座属于自己的思考之岛，也是一片可以安心协作的知识空间。</p>
          <div className="xy-auth-story-orbit" aria-hidden="true"><span>✦</span></div>
        </div>
        <span className="xy-auth-story-footer">XINGYU · DESIGN / KNOWLEDGE / LIFE</span>
      </aside>
      <section className="xy-auth-content" aria-labelledby="xy-auth-title">
        <div className="xy-auth-card">
          <div className="xy-auth-symbol" aria-hidden="true">✦</div>
          <span className="xy-auth-eyebrow">{eyebrow}</span>
          <h1 id="xy-auth-title">{title}</h1>
          <p className="xy-auth-description">{description}</p>
          <div className="xy-auth-inner">{children}</div>
        </div>
        <p className="xy-auth-footer">安全登录 · 数据与授权独立管理</p>
      </section>
    </div>
  </main>;
}
