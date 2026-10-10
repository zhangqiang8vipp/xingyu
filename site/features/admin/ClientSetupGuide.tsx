"use client";
import { useState } from "react";

const endpoint = "https://zhangwansen.click/mcp";
const clients = {
  codex: {
    name: "Codex",
    format: "~/.codex/config.toml",
    code: "[mcp_servers.xingyu]\nurl = \"" + endpoint + "\"\nbearer_token_env_var = \"XINGYU_PAT\"",
    hint: "先将真实 PAT 安全保存为本机 XINGYU_PAT 环境变量，再启动 Codex。不要把明文提交到仓库。",
  },
  cursor: {
    name: "Cursor",
    format: "MCP · Streamable HTTP",
    code: "MCP URL: " + endpoint + "\nTransport: Streamable HTTP\nAuthorization: Bearer <YOUR_PERSONAL_TOKEN>",
    hint: "在 Cursor 支持的远程 MCP 配置入口填写 URL；如果它支持自定义请求头，添加 Authorization。具体配置文件结构以客户端版本为准。",
  },
  other: {
    name: "其他客户端",
    format: "通用 HTTP MCP",
    code: "MCP URL: " + endpoint + "\nTransport: Streamable HTTP\nAuthorization: Bearer <YOUR_PERSONAL_TOKEN>",
    hint: "对于无法填写远程 HTTP Header 的桌面客户端，可使用安全的本地 MCP 桥接工具；不要将 Token 作为公开参数共享。",
  },
} as const;
type Client = keyof typeof clients;

export default function ClientSetupGuide(){
  const [choice,setChoice]=useState<Client>("codex");
  const client=clients[choice];
  return <section className="editor-section xy-ai-setup-guide" aria-label="接入客户端指引">
    <h2>将星屿连接到 AI 客户端</h2>
    <p>同一个 MCP 地址可以用于 OAuth 自动授权或个人 PAT 手动配置。下面的示例仅作配置参考，不会连接设备。</p>
    <div className="xy-ai-setup-tabs" role="group" aria-label="客户端">
      {(Object.entries(clients) as [Client,typeof clients[Client]][]).map(([key,entry])=>
        <button key={key} type="button" aria-pressed={choice===key} onClick={()=>setChoice(key)}>{entry.name}</button>)}
    </div>
    <p><strong>{client.name}</strong> · {client.format}</p>
    <pre className="xy-ai-setup-code"><code>{client.code}</code></pre>
    <p className="xy-ai-setup-tip">{client.hint}</p>
    <p className="xy-ai-setup-tip">支持 OAuth 的客户端可以只配置服务器 URL，并在星屿授权页登录。OAuth Client ID / 回调地址仍需符合服务端注册策略。</p>
  </section>;
}
