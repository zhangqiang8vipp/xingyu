/**
 * Short-lived, isolated public demo of the actual built AXIS Workspace Worker.
 * Never deploys or connects to production D1/R2. Intended for one ephemeral CI run.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { openTestHarness, closeTestHarness, jsonRequest } from "../tests/integration/harness.mjs";
import { makeActiveUser } from "../tests/integration/identity-fixtures.mjs";

const PORT = 8789;
const roots = [resolve("dist/client"), resolve("public")];
const mime = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ico": "image/x-icon",
  ".html": "text/html; charset=utf-8"
};
function asset(path, res) {
  for (const root of roots) {
    let file;
    try { file = resolve(root, "." + decodeURIComponent(path)); } catch { return false; }
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) continue;
    res.writeHead(200, {"content-type": mime[extname(file)] ?? "application/octet-stream", "cache-control": "no-store"});
    res.end(readFileSync(file));
    return true;
  }
  return false;
}
let harness;
let server;
async function main() {
  harness = await openTestHarness({
    vars: {
      PUBLIC_SITE_URL: "http://127.0.0.1:8789",
      REGISTRATION_ENABLED: "false"
    }
  });
  const owner = await makeActiveUser(harness, "axis-preview-owner");
  // This grants owner access only to the disposable in-memory/local D1 fixture.
  await harness.db.prepare("INSERT INTO site_memberships(user_id, role) VALUES(?,'owner')")
    .bind(owner.id).run();

  const root = await harness.db.prepare(
    "SELECT id FROM spaces WHERE workspace_id=? AND parent_id IS NULL ORDER BY id LIMIT 1"
  ).bind(owner.workspaceId).first();
  if (!root?.id) throw new Error("isolated preview space missing");
  const examples = [
    ["01 AXIS · 设计方向", "# 01 AXIS · 设计方向\n\n让交互回归内容，保留苹果式玻璃岛与清晰的知识结构。\n\n## 本次预览\n\n- 真实后台导航\n- 知识空间与权限\n- 编辑器：源码 / 分屏 / 阅读\n- AI 连接与协作\n"],
    ["多人共创 · 产品设计", "# 多人共创\n\n成员、空间、AI Agent 和历史版本使用统一的权限体系。\n\n> 这是隔离测试数据，不影响线上文档。\n"],
    ["版本差异存储 · 方案", "# 版本存储方案\n\n未来采用 **定期快照 + 文本增量**，先完成一致性与恢复验证。\n\n该功能尚未迁移到生产。\n"]
  ];
  for (const [title, content] of examples) {
    const response = await jsonRequest(harness, "/api/space-collaboration/" + root.id, {
      cookie: owner.cookie, method: "POST",
      body: {action: "create_document", title, content}
    });
    if (response.status !== 201) throw new Error("demo seed failed " + response.status + " " + await response.text());
  }

  server = createServer(async (req, res) => {
    try {
      const host = String(req.headers.host ?? "127.0.0.1:" + PORT);
      const proto = host.endsWith(":" + PORT) ? "http" : "https";
      const url = new URL(req.url ?? "/", proto + "://" + host);
      if (asset(url.pathname, res)) return;
      const headers = new Headers();
      const skip = new Set(["host","connection","transfer-encoding","upgrade","keep-alive","proxy-connection","cookie"]);
      for (const [key, value] of Object.entries(req.headers)) {
        if (skip.has(key) || value === undefined) continue;
        if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
        else headers.set(key, value);
      }
      // Real, HMAC-signed fixture session from local identity API; never a production credential.
      headers.set("cookie", owner.cookie);
      const buffers = [];
      for await (const part of req) buffers.push(Buffer.from(part));
      const method = req.method ?? "GET";
      const response = await harness.worker.fetch(url.href, {
        method, headers,
        ...(["GET","HEAD"].includes(method) ? {} : {body: Buffer.concat(buffers)})
      });
      const outgoing = {};
      response.headers.forEach((value, name) => {
        if (name !== "connection" && name !== "transfer-encoding") outgoing[name] = value;
      });
      if (typeof response.headers.getSetCookie === "function") {
        const cookies = response.headers.getSetCookie();
        if (cookies.length) outgoing["set-cookie"] = cookies;
      }
      outgoing["cache-control"] = "no-store";
      res.writeHead(response.status, outgoing);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      console.error("Preview request error:", e?.message ?? String(e));
      res.writeHead(502, {"content-type":"text/plain"}); res.end("Preview worker unavailable");
    }
  });
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(PORT, "127.0.0.1", ok);
  });
  console.log("AXIS_PREVIEW_READY http://127.0.0.1:" + PORT);
}
async function shutdown() {
  if (server) await new Promise(done => server.close(done));
  if (harness) await closeTestHarness(harness);
}
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
main().catch(e => {console.error(e?.stack ?? String(e));process.exitCode=1;});
