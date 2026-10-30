"use client";

import { useEffect, useState, type FormEvent } from "react";
import { readApiJson } from "@/app/api-response";
import { useUnsavedAdminForm } from "./useUnsavedAdminForm";

type QaModelConfig = {
  model:string;
  reasoningEffort:"default"|"low"|"medium"|"high";
  maxTokens:number;
  timeoutMs:number;
};
type ProbeResponse = {
  ok?:boolean; cited?:boolean; model?:string;
  answerPreview?:string; warning?:string|null;
  diagnostic?:{code:string;status:number|null;incidentId:string};
  error?:string;
};
const INITIAL:QaModelConfig={
  model:"openrouter/free",reasoningEffort:"default",maxTokens:2048,timeoutMs:35000,
};

export default function AdminAskModelPanel() {
  const [settings,setSettings]=useState<QaModelConfig>(INITIAL);
  const [saved,setSaved]=useState<QaModelConfig>(INITIAL);
  const dirty=JSON.stringify(settings)!==JSON.stringify(saved);
  useUnsavedAdminForm(dirty);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [testing,setTesting]=useState(false);
  const [message,setMessage]=useState("");
  const [testResult,setTestResult]=useState<ProbeResponse|null>(null);
  const update=<K extends keyof QaModelConfig>(key:K,value:QaModelConfig[K])=>
    setSettings(previous=>({...previous,[key]:value}));

  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      try{
        const response=await fetch("/api/admin/ask-config",{cache:"no-store",signal:controller.signal});
        const data=await readApiJson<{config:QaModelConfig}>(response);
        if(controller.signal.aborted)return;
        if(!response.ok||!data.config)throw new Error(data.error??"无法加载模型设置");
        setSettings(data.config);
        setSaved(data.config);
      }catch(error){
        if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"无法读取模型设置");
      }finally{if(!controller.signal.aborted)setLoading(false);}
    })();
    return()=>controller.abort();
  },[]);

  async function save(event:FormEvent){
    event.preventDefault();
    if(loading||saving||testing||!dirty)return;
    setSaving(true);setMessage("");setTestResult(null);
    try {
      const response=await fetch("/api/admin/ask-config",{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(settings),
      });
      const data=await readApiJson<{config:QaModelConfig}>(response);
      if(!response.ok||!data.config)throw new Error(data.error??"模型设置保存失败");
      setSettings(data.config);
      setSaved(data.config);
      setMessage("已保存。下一次 AI 回答将立即使用新模型，无需重新部署。");
    }catch(error){setMessage(error instanceof Error?error.message:"模型设置保存失败");}
    finally{setSaving(false);}
  }

  async function testConnection(){
    setTesting(true);setMessage("");setTestResult(null);
    try{
      const response=await fetch("/api/admin/ask-config",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(settings),
      });
      const result=await readApiJson<ProbeResponse>(response);
      if(!response.ok)throw new Error(result.error??"测试请求失败");
      setTestResult(result);
      setMessage(result.ok
        ?"测试成功：模型返回了可引用的回答。此操作不自动保存当前设置。"
        :"模型测试没有产生带引用的有效回答，可切换其他免费模型。");
    }catch(error){setMessage(error instanceof Error?error.message:"模型测试失败");}
    finally{setTesting(false);}
  }

  return <section className="editor-section" aria-label="站内知识问答模型配置">
    <div className="editor-section-title"><span>AI</span><div>
      <b>站内知识问答模型</b>
      <small>模型设置保存在 D1 中，更换免费模型不需要改源码或重新部署</small>
    </div></div>
    <form onSubmit={event=>void save(event)}>
      <fieldset disabled={loading||saving||testing} style={{border:0,padding:0,margin:0,minWidth:0}}>
        <label>OpenRouter 模型 ID
          <input value={settings.model} list="xy-free-qa-models"
            maxLength={130} spellCheck={false}
            onChange={event=>update("model",event.target.value)}
            placeholder="minimax/minimax-m3.1-flash:free" />
        </label>
        <datalist id="xy-free-qa-models">
          <option value="openrouter/free" label="随机免费路由"/>
          <option value="minimax/minimax-m3.1-flash:free" label="MiniMax M3.1 Flash（已通过真实知识问答测试）"/>
        </datalist>
        <p style={{fontSize:12,opacity:.7,margin:"8px 0 16px"}}>
          仅允许免费的 <code>openrouter/free</code> 或以 <code>:free</code> 结尾的模型。
          选择具体模型可以避免随机路由落到安全分类模型。
          密钥仍由 Cloudflare Secret 管理，不会显示或保存在这里。
        </p>
        <div className="form-row">
          <label>推理强度
            <select value={settings.reasoningEffort}
              onChange={event=>update("reasoningEffort",event.target.value as QaModelConfig["reasoningEffort"])}>
              <option value="default">模型默认</option>
              <option value="low">低 · 优先输出正文</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
          <label>最大生成 Tokens
            <input type="number" min="512" max="8192" step="256" value={settings.maxTokens}
              onChange={event=>update("maxTokens",Number(event.target.value))}/>
          </label>
        </div>
        <div className="form-row">
          <label>最长等待（秒）
            <input type="number" min="10" max="60" step="1"
              value={settings.timeoutMs/1000}
              onChange={event=>update("timeoutMs",Number(event.target.value)*1000)}/>
          </label>
        </div>
      </fieldset>
      <div className="config-footer" style={{marginTop:16}}>
        <span role="status">{loading?"正在读取当前设置…":message||(dirty?"有未保存的模型参数修改 · 测试不会自动保存":"模型设置已同步 · 测试只使用公开模拟问题，不含私人文章")}</span>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className="activation-refresh" type="button"
            disabled={loading||saving||testing} onClick={()=>void testConnection()}>
            {testing?"正在测试…":"测试当前模型"}
          </button>
          <button className="save-button" type="submit" disabled={loading||saving||testing||!dirty} aria-busy={saving}>
            {saving?"正在保存…":"保存模型设置"}<i>→</i>
          </button>
        </div>
      </div>
    </form>
    {testResult&&<div className="integration-card" aria-live="polite">
      <div>
        <small>{testResult.ok?"连接成功 · 引用验证通过":"模型输出异常"}</small>
        <b>{testResult.model??settings.model}</b>
        {testResult.answerPreview&&<span>测试回答：{testResult.answerPreview}</span>}
        {testResult.warning&&<span>{testResult.warning}</span>}
        {testResult.diagnostic&&<span>
          错误：{testResult.diagnostic.code}
          {testResult.diagnostic.status!==null?" · HTTP "+testResult.diagnostic.status:""}
          {" · 诊断编号："+testResult.diagnostic.incidentId}
        </span>}
      </div>
    </div>}
  </section>;
}
