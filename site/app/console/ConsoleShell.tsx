import Link from "next/link";
import type {ReactNode} from "react";

type Area="workspace"|"organizations";
type Props={area:Area;userName:string;isLegacyAdmin?:boolean;children:ReactNode};

const entries=[
  {href:"/workspace",title:"我的知识空间",subtitle:"文章 · 工作区",icon:"◈",area:"workspace"},
  {href:"/organizations",title:"组织与团队",subtitle:"成员 · 授权",icon:"◎",area:"organizations"},
] as const;

export default function ConsoleShell({area,userName,isLegacyAdmin=false,children}:Props){
  const organization=area==="organizations";
  return <div className="xy-console">
    <div className="xy-console-layout">
      <aside className="xy-console-rail" aria-label="控制台导航">
        <Link className="xy-console-brand" href="/" aria-label="星屿首页">
          <span className="xy-console-brand-mark" aria-hidden="true">✦</span>
          <span className="xy-console-brand-title">星屿 <small>XINGYU</small></span>
        </Link>
        <div className="xy-console-rail-caption">WORKSPACE / CONTROL</div>
        <nav className="xy-console-sidebar-links" aria-label="主要功能">
          {entries.map(entry=><Link key={entry.href} href={entry.href}
            className={"xy-console-nav-item"+(entry.area===area?" is-active":"")}
            aria-current={entry.area===area?"page":undefined}>
            <span className="xy-console-nav-icon" aria-hidden="true">{entry.icon}</span>
            <span className="xy-console-nav-label"><strong>{entry.title}</strong><small>{entry.subtitle}</small></span>
          </Link>)}
          {isLegacyAdmin?<Link href="/admin" className="xy-console-nav-item">
            <span className="xy-console-nav-icon" aria-hidden="true">◇</span>
            <span className="xy-console-nav-label"><strong>原写作后台</strong><small>站点管理</small></span>
          </Link>:null}
        </nav>
        <div className="xy-console-rail-bottom">
          <div className="xy-console-privacy"><span aria-hidden="true">●</span> 权限与数据隔离已启用</div>
          <div className="xy-console-profile">
            <span className="xy-console-avatar" aria-hidden="true">{userName.trim().slice(0,1)||"星"}</span>
            <span><strong>{userName}</strong><small>已登录的星屿账号</small></span>
          </div>
        </div>
      </aside>
      <div className="xy-console-main">
        <header className="xy-console-topbar">
          <div className="xy-console-breadcrumb">星屿 / 控制台 / <strong>{organization?"组织与团队":"我的知识空间"}</strong></div>
          <Link href="/" className="xy-console-exit">返回博客 <span aria-hidden="true">↗</span></Link>
        </header>
        <div className="xy-console-body">
          <div className="xy-console-heading">
            <div>
              <span className="xy-console-eyebrow">{organization?"ORGANIZATION CENTER":"PERSONAL WORKSPACE"}</span>
              <h1>{organization?"组织与团队":"我的知识空间"}<span className="xy-console-heading-spark" aria-hidden="true">✦</span></h1>
              <p>{organization
                ?"管理组织、部门、团队与知识空间的访问权限，协作有序且安全。"
                :"在自己的空间里记录思考，管理文章、协作项目和 AI 连接。"}</p>
            </div>
            <span className="xy-console-heading-pill">{organization?"组织管理":"私人及共享空间"}</span>
          </div>
          <main id="xy-console-content" className="xy-console-content">{children}</main>
          <footer className="xy-console-footer">
            <span>星屿 · 在喧嚣之外，留一座思考的岛</span>
            <span>Access is always permission-aware</span>
          </footer>
        </div>
      </div>
    </div>
  </div>;
}
