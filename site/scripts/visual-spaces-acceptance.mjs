/** Isolated real-Chromium acceptance: knowledge-space preview, permissions and sharing. */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import puppeteer from "puppeteer-core";
import { openTestHarness, closeTestHarness, jsonRequest } from "../tests/integration/harness.mjs";
import { makeActiveUser } from "../tests/integration/identity-fixtures.mjs";

const dir=resolve("visual-spaces");
mkdirSync(dir,{recursive:true});
const roots=[resolve("dist/client"),resolve("public")];
const mime={".js":"text/javascript",".css":"text/css",".html":"text/html",".svg":"image/svg+xml",
  ".png":"image/png",".jpg":"image/jpeg",".webp":"image/webp",".woff2":"font/woff2"};
const title="星屿共创浏览器验收";
const marker="XINGYU-COAUTHOR-BROWSER-REGRESSION";
const secret="SIBLING-ISOLATION-PRIVATE";
const fence=String.fromCharCode(96).repeat(3);
const content="# 星屿共创正文\n\n**"+marker+"**\n\n"+fence+"js\nconst shared = true;\n"+fence+"\n\n## 页面排版\n\n与普通文章同一预览。";
const digest=value=>createHash("sha256").update(value).digest("hex");

function staticFile(path,res){
  for(const root of roots){
    let file;try{file=resolve(root,"."+decodeURIComponent(path))}catch{return false;}
    if(!file.startsWith(root+sep)||!existsSync(file)||!statSync(file).isFile())continue;
    res.writeHead(200,{"content-type":mime[file.slice(file.lastIndexOf("."))]??"application/octet-stream",
      "cache-control":"no-store"});
    res.end(readFileSync(file));return true;
  }
  return false;
}
async function startProxy(worker){
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url??"/","http://"+req.headers.host);
      if(staticFile(url.pathname,res))return;
      const headers=new Headers();
      for(const [k,v] of Object.entries(req.headers)){
        if(["host","connection","transfer-encoding","keep-alive","upgrade","proxy-connection"].includes(k)||v===undefined)continue;
        if(Array.isArray(v))v.forEach(value=>headers.append(k,value));
        else headers.set(k,v);
      }
      const parts=[];for await(const part of req)parts.push(Buffer.from(part));
      const method=req.method??"GET";
      const result=await worker.fetch(url.href,{method,headers,
        ...(["GET","HEAD"].includes(method)?{}:{body:Buffer.concat(parts)})});
      const h={};result.headers.forEach((v,k)=>{if(k!=="connection"&&k!=="transfer-encoding")h[k]=v});
      if(typeof result.headers.getSetCookie==="function"){
        const cookies=result.headers.getSetCookie();if(cookies.length)h["set-cookie"]=cookies;
      }
      res.writeHead(result.status,h);res.end(Buffer.from(await result.arrayBuffer()));
    }catch(error){
      console.error("Local browser test proxy:",error instanceof Error?error.message:String(error));
      res.writeHead(502);res.end("Worker unavailable");
    }
  });
  await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok)});
  return {server,origin:"http://127.0.0.1:"+server.address().port};
}
function chromePath(){
  const path=[process.env.CHROME_PATH,process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium",
    "/usr/bin/chromium-browser"].filter(Boolean).find(existsSync);
  assert.ok(path,"Chrome is required for space browser regression");return path;
}
async function api(h,path,cookie,method="GET",body){
  const res=await jsonRequest(h,path,{cookie,method,body});
  return {status:res.status,json:await res.json().catch(()=>({}))};
}
async function grant(h,space,workspace,owner,invitee,role){
  const raw=randomBytes(32).toString("base64url");
  await h.db.prepare("INSERT INTO space_collaboration_invites(space_id,workspace_id,email,role,token_hash,invited_by,expires_at) VALUES(?,?,?,?,?,?,?)")
    .bind(space,workspace,invitee.email,role,digest(raw),owner.id,Math.floor(Date.now()/1000)+3600).run();
  const accepted=await api(h,"/api/space-invitations",invitee.cookie,"POST",{token:raw});
  assert.equal(accepted.status,200,"fixture invitation must be accepted");
}
async function actor(browser,origin,user,width,height,dark){
  const context=await browser.createBrowserContext();
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("response",r=>{
    const path=new URL(r.url()).pathname;
    if((path.startsWith("/assets/")||path.startsWith("/_next/"))&&r.status()>=400)
      errors.push("Missing asset "+r.status()+" "+path);
  });
  await page.setViewport({width,height,deviceScaleFactor:1});
  await page.emulateMediaFeatures([{name:"prefers-color-scheme",value:dark?"dark":"light"}]);
  if(user){const [name,value]=user.cookie.split("=");await page.setCookie({name,value,url:origin})}
  return {page,context,assertClean:()=>assert.deepEqual(errors,[],"no browser errors")};
}
async function openKnowledgeSpace(page,origin,id){
  const res=await page.goto(origin+"/admin?section=spaces&spaceId="+id,
    {waitUntil:"networkidle0",timeout:70000});
  assert.equal(res.status(),200,"real authenticated admin");
  await page.waitForSelector(".space-scope button",{timeout:30000});
  await page.evaluate(()=>{
    const scope=Array.from(document.querySelectorAll(".space-scope button"))
      .find(b=>b.textContent.trim()==="仅当前空间");
    if(!scope)throw Error("Current space view missing");
    scope.click();
  });
  await page.waitForFunction(expected=>Array.from(document.querySelectorAll(".space-article-list > article"))
    .some(el=>el.querySelector("b")?.textContent?.trim()===expected),{timeout:30000},title);
}
async function rowButtons(page){
  return page.evaluate(expected=>{
    const row=Array.from(document.querySelectorAll(".space-article-list > article"))
      .find(el=>el.querySelector("b")?.textContent?.trim()===expected);
    if(!row)throw Error("Fixture document missing");
    return Array.from(row.querySelectorAll("button")).map(button=>button.textContent.trim());
  },title);
}
async function clickRow(page,name){
  await page.evaluate(({title,name})=>{
    const row=Array.from(document.querySelectorAll(".space-article-list > article"))
      .find(el=>el.querySelector("b")?.textContent?.trim()===title);
    const button=Array.from(row?.querySelectorAll("button")??[])
      .find(el=>el.textContent.trim()===name);
    if(!button)throw Error("Missing document action: "+name);
    button.click();
  },{title,name});
}
async function checkFrontstage(page,dark,expectedTitle=title){
  await page.waitForSelector(".space-document-frontstage .writing-frontstage-frame",{timeout:30000});
  await page.waitForFunction(({title,marker})=>{
    const frame=document.querySelector(".space-document-frontstage .writing-frontstage-frame");
    const doc=frame?.contentDocument;
    return doc?.querySelector(".post-hero h1")?.textContent?.trim()===title &&
      doc?.querySelector("article.prose.markdown-body")?.textContent?.includes(marker) &&
      !!doc?.querySelector("article.prose pre code");
  },{timeout:35000},{title:expectedTitle,marker});
  const result=await page.evaluate(()=>{
    const overlay=document.querySelector(".space-document-frontstage");
    const frame=overlay.querySelector("iframe");
    const doc=frame.contentDocument;
    const hero=doc.querySelector(".post-hero h1");
    return {route:new URL(frame.src).pathname,theme:doc.documentElement.dataset.theme,
      heading:hero.textContent.trim(),font:getComputedStyle(hero).fontFamily,
      content:doc.querySelector("article.prose").textContent,
      width:overlay.getBoundingClientRect().width,screen:window.innerWidth,
      overflow:doc.documentElement.scrollWidth-doc.documentElement.clientWidth,
      duplicated:!!overlay.querySelector(".space-coauthor-live-preview")};
  });
  assert.equal(result.route,"/admin/article-preview","same real article preview URL");
  assert.equal(result.heading,expectedTitle);
  assert.equal(result.theme,dark?"dark":"light","dark/light parity");
  assert.ok(result.font.length>2,"production article typography loaded");
  assert.ok(result.width<=result.screen+2,"preview fits screen");
  assert.ok(result.overflow<=2,"preview content fits frame");
  assert.equal(result.duplicated,false,"no parallel Markdown preview");
  assert.ok(!result.content.includes(secret),"private sibling never shown");
}
async function closePreview(page){
  await page.click(".space-document-frontstage .writing-studio-actions button");
  await page.waitForFunction(()=>!document.querySelector(".space-document-frontstage"),{timeout:12000});
}
async function checkEditor(browser,origin,user,root){
  const x=await actor(browser,origin,user,1440,900,false),page=x.page;
  try{
    await openKnowledgeSpace(page,origin,root);
    const buttons=await rowButtons(page);
    for(const name of ["预览","分享","共创编辑"])assert.ok(buttons.includes(name),"editor can "+name);
    assert.ok(!buttons.includes("删除"),"editors cannot delete");
    await clickRow(page,"预览");
    await checkFrontstage(page,false);
    await page.screenshot({path:resolve(dir,"editor-preview-desktop.png"),animations:"disabled"});
    await closePreview(page);
    await clickRow(page,"共创编辑");
    await page.waitForSelector(".space-coauthor-dialog");
    const actions=await page.$$eval(".space-coauthor-dialog footer button",
      nodes=>nodes.map(n=>n.textContent.trim()));
    assert.ok(!actions.includes("删除"),"editor dialog cannot delete");
    assert.ok(actions.some(text=>text.includes("保存并合并")),"editor may write");
    await page.evaluate(()=>{
      const b=Array.from(document.querySelectorAll(".space-coauthor-dialog .space-collab-section-heading button"))
        .find(b=>b.textContent.includes("真实前台预览"));
      if(!b)throw Error("Editor preview missing");
      b.click();
    });
    await checkFrontstage(page,false);
    await page.screenshot({path:resolve(dir,"editor-live-preview.png"),animations:"disabled"});
    await closePreview(page);
    // Revisions must open the same frontstage, never a raw <pre> Markdown pane.
    await page.click(".space-coauthor-revisions summary");
    await page.evaluate(()=>{
      const button=Array.from(document.querySelectorAll(".space-coauthor-revisions .space-collab-member button"))
        .find(b=>b.textContent.trim()==="预览");
      if(!button)throw Error("Revision preview missing");
      button.click();
    });
    await checkFrontstage(page,false,title+" · V1");
    await closePreview(page);
    await page.click(".space-coauthor-dialog>header button");
    await page.waitForFunction(()=>!document.querySelector(".space-coauthor-dialog"),{timeout:12000});
    await clickRow(page,"分享");
    await page.waitForSelector(".preview-share-dialog");
    assert.match(await page.$eval(".preview-share-security",node=>node.textContent),/单篇、只读、可撤销/);
    await page.click(".preview-share-dialog footer button");
    x.assertClean();
    console.log("PASS editor: list preview, live preview, edit/share, delete hidden");
  }finally{await x.context.close()}
}
async function checkViewer(browser,origin,user,root){
  const x=await actor(browser,origin,user,390,844,true),page=x.page;
  try{
    await openKnowledgeSpace(page,origin,root);
    const buttons=await rowButtons(page);
    assert.ok(buttons.includes("预览")&&buttons.includes("阅读"),"viewer read and preview");
    for(const name of ["分享","删除","共创编辑","编辑 ↗"])
      assert.ok(!buttons.includes(name),"viewer cannot "+name);
    await clickRow(page,"预览");
    await checkFrontstage(page,true);
    await page.screenshot({path:resolve(dir,"viewer-mobile-dark.png"),animations:"disabled"});
    await closePreview(page);
    await clickRow(page,"阅读");
    await checkFrontstage(page,true);
    await closePreview(page);
    x.assertClean();
    console.log("PASS viewer: mobile/dark, view-only, identical preview");
  }finally{await x.context.close()}
}
async function checkOwner(browser,origin,user,root){
  const x=await actor(browser,origin,user,1365,900,false),page=x.page;
  try{
    await openKnowledgeSpace(page,origin,root);
    const buttons=await rowButtons(page);
    assert.ok(buttons.includes("删除"),"only manager can delete");
    await clickRow(page,"预览");await checkFrontstage(page,false);
    await page.screenshot({path:resolve(dir,"owner-preview.png"),animations:"disabled"});
    await closePreview(page);
    page.once("dialog",dialog=>void dialog.dismiss());
    await clickRow(page,"删除");
    assert.ok((await rowButtons(page)).includes("删除"),"cancelling deletion preserves document");
    x.assertClean();
    console.log("PASS owner: delete requires explicit title confirmation");
  }finally{await x.context.close()}
}
async function checkShare(browser,h,origin,editor,documentId){
  const url="/api/space-collaboration/documents/"+documentId+"/preview-links";
  const created=await api(h,url,editor.cookie,"POST",{lifetimeSeconds:86400});
  assert.equal(created.status,201,"editor may generate single-doc link");
  const tokenPath=new URL(created.json.url).pathname;
  assert.match(tokenPath,/^\/preview\/pv_[A-Za-z0-9_-]+$/,"scoped token URL");
  const browserUrl=origin+tokenPath;
  const x=await actor(browser,origin,null,1280,800,false);
  try{
    const first=await x.page.goto(browserUrl,{waitUntil:"networkidle0",timeout:70000});
    assert.equal(first.status(),200,"anonymous shared preview");
    await x.page.waitForSelector(".shared-preview-notice");
    const body=await x.page.$eval("article.prose",node=>node.textContent);
    assert.ok(body.includes(marker)&&!body.includes(secret),"read-only one-document content");
    assert.equal(await x.page.$(".admin-shell"),null,"link never grants admin UI");
    await x.page.screenshot({path:resolve(dir,"shared-readonly.png"),animations:"disabled"});
    const revoked=await api(h,url,editor.cookie,"DELETE",{previewId:created.json.link.id});
    assert.equal(revoked.status,200,"editor can revoke link");
    const afterwards=await x.page.goto(browserUrl,{waitUntil:"networkidle0",timeout:70000});
    assert.equal(afterwards.status(),404,"revoked link immediately stops working");
    x.assertClean();
    console.log("PASS link: anonymous read-only preview, no sibling access, revoke");
  }finally{await x.context.close()}
}
let h,proxy,browser;
try{
  h=await openTestHarness();
  const owner=await makeActiveUser(h,"visual-space-owner");
  const editor=await makeActiveUser(h,"visual-space-editor");
  const viewer=await makeActiveUser(h,"visual-space-viewer");
  const outsider=await makeActiveUser(h,"visual-space-outsider");
  const root=await h.db.prepare("SELECT id FROM spaces WHERE workspace_id=? AND parent_id IS NULL ORDER BY id LIMIT 1")
    .bind(owner.workspaceId).first();
  assert.ok(root?.id,"owner root space exists");
  const sibling=await h.db.prepare("INSERT INTO spaces(workspace_id,parent_id,name,slug) VALUES(?,NULL,?,?) RETURNING id")
    .bind(owner.workspaceId,"Uninvited sibling","visual-secret-"+randomBytes(4).toString("hex")).first();
  assert.equal((await api(h,"/api/space-collaboration/"+sibling.id,owner.cookie,"POST",
    {action:"create_document",title:"Private sibling",content:secret})).status,201);
  const created=await api(h,"/api/space-collaboration/"+root.id,owner.cookie,"POST",
    {action:"create_document",title,content});
  assert.equal(created.status,201,JSON.stringify(created.json));
  const documentId=created.json.result?.publicId;
  assert.ok(documentId);
  await grant(h,root.id,owner.workspaceId,owner,editor,"editor");
  await grant(h,root.id,owner.workspaceId,owner,viewer,"viewer");
  assert.equal((await api(h,"/api/space-collaboration/documents/"+documentId,outsider.cookie)).status,404);
  assert.equal((await api(h,"/api/space-collaboration/documents/"+documentId,viewer.cookie)).status,200);
  proxy=await startProxy(h.worker);
  browser=await puppeteer.launch({headless:true,executablePath:chromePath(),
    args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});
  await checkEditor(browser,proxy.origin,editor,root.id);
  await checkViewer(browser,proxy.origin,viewer,root.id);
  await checkOwner(browser,proxy.origin,owner,root.id);
  await checkShare(browser,h,proxy.origin,editor,documentId);
  console.log("PASS all isolated knowledge-space Chromium checks; screenshots in "+dir);
}finally{
  if(browser)await browser.close();
  if(proxy)await new Promise(done=>proxy.server.close(done));
  if(h)await closeTestHarness(h);
}
