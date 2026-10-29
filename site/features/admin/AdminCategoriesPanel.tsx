"use client";

import React, { useState, type FormEvent } from "react";
import { readApiJson } from "@/app/api-response";
import { useUnsavedAdminForm } from "./useUnsavedAdminForm";

export type EditableCategory={id:number;name:string;slug:string;color:string};

export default function AdminCategoriesPanel({
  initial,onChange,readOnly=false,
}:{
  initial:EditableCategory[];
  onChange:(items:EditableCategory[])=>void;
  readOnly?:boolean;
}){
  const [items,setItems]=useState(initial);
  const [saved,setSaved]=useState(initial);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState<string|null>(null);
  const [creating,setCreating]=useState(false);
  const [newName,setNewName]=useState("");

  const dirty=items.some(item=>{
    const baseline=saved.find(previous=>previous.id===item.id);
    return !baseline||item.name!==baseline.name||item.slug!==baseline.slug||item.color!==baseline.color;
  });
  useUnsavedAdminForm(dirty);

  const commit=(next:EditableCategory[])=>{setItems(next);onChange(next)};
  const update=(id:number,key:keyof EditableCategory,value:string)=>
    commit(items.map(item=>item.id===id?{...item,[key]:value}:item));

  async function save(item:EditableCategory){
    if(readOnly||busy||!item.name.trim()||!item.slug.trim())return;
    setBusy("save:"+item.id);
    setMessage("");
    try{
      const response=await fetch(`/api/categories/${item.id}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(item),
      });
      const data=await readApiJson<{category:EditableCategory}>(response);
      if(!response.ok||!data.category){
        setMessage(data.error??"保存失败，更改仍保留在页面中");
        return;
      }
      const next=items.map(current=>current.id===item.id?data.category:current);
      commit(next);
      setSaved(previous=>previous.map(current=>current.id===item.id?data.category:current));
      setMessage(`“${data.category.name}”已保存`);
    }catch{
      setMessage("网络异常，修改仍保留在页面中，请重试");
    }finally{
      setBusy(null);
    }
  }

  async function remove(item:EditableCategory){
    if(readOnly||busy)return;
    if(!window.confirm(`确定删除“${item.name}”吗？仅空分类可以删除。`))return;
    setBusy("delete:"+item.id);
    setMessage("");
    try{
      const response=await fetch(`/api/categories/${item.id}`,{method:"DELETE"});
      const data=await readApiJson<Record<string,never>>(response);
      if(!response.ok){setMessage(data.error??"删除失败，请检查分类是否仍有文章");return;}
      commit(items.filter(current=>current.id!==item.id));
      setSaved(previous=>previous.filter(current=>current.id!==item.id));
      setMessage("分类已删除");
    }catch{
      setMessage("网络异常，删除状态未确认，请重试");
    }finally{
      setBusy(null);
    }
  }

  async function create(event:FormEvent){
    event.preventDefault();
    const name=newName.trim();
    if(readOnly||busy||!name)return;
    setBusy("create");
    setMessage("");
    try{
      const response=await fetch("/api/categories",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name}),
      });
      const data=await readApiJson<{category:EditableCategory}>(response);
      if(!response.ok||!data.category){setMessage(data.error??"创建失败，请重试");return;}
      commit([...items,data.category]);
      setSaved(previous=>[...previous,data.category]);
      setCreating(false);
      setNewName("");
      setMessage(`“${data.category.name}”已创建`);
    }catch{
      setMessage("网络异常，分类名称已保留，请重试");
    }finally{
      setBusy(null);
    }
  }

  return <section className="admin-main admin-config-main">
    <header className="admin-header">
      <div><p>CONTENT TAXONOMY</p><h1>分类管理</h1>
        <span>名称、链接标识和强调色会同步到首页、归档和关于页。</span></div>
      <button className="new-button" type="button" onClick={()=>setCreating(value=>!value)}
        aria-expanded={creating} aria-controls="axis-create-category" disabled={readOnly||Boolean(busy)}>
        {creating?"取消新增":"＋ 新增分类"}
      </button>
    </header>
    {readOnly&&<p className="form-message" role="status">分类仅管理员可以修改；这里展示原后台使用的公开分类。</p>}
    {creating&&!readOnly&&<form id="axis-create-category" className="axis-category-create" onSubmit={event=>void create(event)}>
      <label htmlFor="axis-new-category-name">新分类名称</label>
      <input id="axis-new-category-name" autoFocus value={newName} maxLength={80}
        placeholder="例如：技术随笔" onChange={event=>setNewName(event.target.value)}/>
      <button type="submit" className="new-button" disabled={!newName.trim()||Boolean(busy)}>
        {busy==="create"?"创建中…":"创建分类"}
      </button>
    </form>}
    <fieldset disabled={readOnly} className="axis-category-fieldset">
      <div className="category-manager">{items.map((item,index)=>{
        const baseline=saved.find(previous=>previous.id===item.id);
        const changed=!baseline||item.name!==baseline.name||item.slug!==baseline.slug||item.color!==baseline.color;
        const working=busy==="save:"+item.id||busy==="delete:"+item.id;
        return <article key={item.id} style={{"--category-color":item.color} as React.CSSProperties}>
          <header><i/><span>{String(index+1).padStart(2,"0")}</span><b>{item.name}</b>
            {changed&&<small className="axis-category-dirty" role="status">未保存</small>}
          </header>
          <div>
            <label>名称<input value={item.name} maxLength={80} onChange={event=>update(item.id,"name",event.target.value)}/></label>
            <label>Slug<input value={item.slug} onChange={event=>update(item.id,"slug",event.target.value)}/></label>
            <label>颜色<input type="color" value={item.color} aria-label={item.name+"的分类颜色"}
              onChange={event=>update(item.id,"color",event.target.value)}/></label>
          </div>
          <footer>
            <button type="button" className="axis-category-remove" disabled={Boolean(busy)}
              onClick={()=>void remove(item)}>删除</button>
            {changed&&<button type="button" disabled={Boolean(busy)} onClick={()=>{
              if(!baseline)return;
              commit(items.map(current=>current.id===item.id?baseline:current));
            }}>撤销更改</button>}
            <button type="button" disabled={Boolean(busy)||!changed||!item.name.trim()||!item.slug.trim()}
              aria-busy={working} onClick={()=>void save(item)}>{busy==="save:"+item.id?"保存中…":"保存更改"}</button>
          </footer>
        </article>;
      })}</div>
      {!items.length&&<p className="axis-category-empty">还没有分类，使用右上角「新增分类」开始整理内容。</p>}
    </fieldset>
    <div className="category-manager-message" role="status" aria-live="polite">
      {message||(readOnly?`${items.length} 个分类 · 只读查看`:dirty?"有未保存的分类修改 · 请保存后离开":`${items.length} 个分类 · 仅空分类可以删除`)}
    </div>
  </section>;
}
