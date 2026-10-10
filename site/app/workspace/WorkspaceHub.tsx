"use client";

import {useState} from "react";
import AccountSectionTabs from "@/features/admin/AccountSectionTabs";
import WorkspaceClient from "./WorkspaceClient";
import CollaborationPanel from "./CollaborationPanel";
import ConnectionsPanel from "./ConnectionsPanel";

type Workspace = {id:number;name:string;kind:string;role:string};
export type WorkspaceView = "notes" | "collaboration" | "connections";

const tabs = [
  {id:"notes",label:"知识与文档",description:"查找、创建、编辑"},
  {id:"collaboration",label:"共享与成员",description:"邀请、权限与协作"},
  {id:"connections",label:"AI 连接",description:"查看和撤销授权"},
] as const;

export default function WorkspaceHub({workspaces,initialView="notes"}:{
  workspaces:Workspace[];initialView?:WorkspaceView;
}){
  const [view,setView]=useState<WorkspaceView>(initialView);
  const [hasUnsavedChanges,setHasUnsavedChanges]=useState(false);
  function navigate(next:WorkspaceView){
    if(next===view)return;
    if(hasUnsavedChanges&&!window.confirm("当前文档有未保存的修改。确认离开编辑区？"))return;
    setHasUnsavedChanges(false);
    setView(next);
    const url=new URL(window.location.href);
    if(next==="notes")url.searchParams.delete("view");
    else url.searchParams.set("view",next);
    window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
  }
  const shared=workspaces.filter(item=>item.kind!=="personal").length;
  return <div className="account-hub">
    <section className="account-intro">
      <div>
        <span className="account-overline">YOUR WORKSPACE</span>
        <h2>从这里开始写作与协作</h2>
        <p>先选择要做的事，再进入对应工具。私人内容不会因为加入组织而自动公开。</p>
      </div>
      <div className="account-intro-stats" aria-label="工作区概览">
        <span><strong>{workspaces.length}</strong><small>可访问工作区</small></span>
        <span><strong>{shared}</strong><small>共享 / 组织空间</small></span>
      </div>
    </section>
    <AccountSectionTabs label="个人工作区功能" tabs={tabs} active={view} onChange={navigate}/>
    <div className="account-hub-body">
      {view==="notes" ? <WorkspaceClient initialWorkspaces={workspaces} onDirtyChange={setHasUnsavedChanges}/> : null}
      {view==="collaboration" ? <CollaborationPanel workspaces={workspaces}/> : null}
      {view==="connections" ? <ConnectionsPanel/> : null}
    </div>
  </div>;
}
