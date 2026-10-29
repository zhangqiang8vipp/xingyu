/**
 * Whole-backstage real Chromium regression.
 *
 * Run after npm run build. Every route is served by the built Worker with
 * disposable local D1 and a test-only owner session, never production data.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import puppeteer from "puppeteer-core";
import { openTestHarness, closeTestHarness } from "../tests/integration/harness.mjs";
import { makeActiveUser } from "../tests/integration/identity-fixtures.mjs";

const dir=resolve("visual-backstage");
mkdirSync(dir,{recursive:true});
const roots=[resolve("dist/client"),resolve("public")];
const mime={".js":"text/javascript",".css":"text/css",".html":"text/html",
  ".svg":"image/svg+xml",".png":"image/png",".jpeg":"image/jpeg",
  ".jpg":"image/jpeg",".webp":"image/webp",".woff":"font/woff",
  ".woff2":"font/woff2",".json":"application/json"};

function asset(path,response){
  for(const root of roots){
    let file;
    try{file=resolve(root,"."+decodeURIComponent(path));}catch{return false;}
    if(!file.startsWith(root+sep)||!existsSync(file)||!statSync(file).isFile())continue;
    response.writeHead(200,{"content-type":mime[file.slice(file.lastIndexOf("."))]??"application/octet-stream",
      "cache-control":"no-store"});
    response.end(readFileSync(file));return true;
  }
  return false;
}
async function proxy(worker){
  const server=createServer(async(request,response)=>{
    try{
      const url=new URL(request.url??"/","http://"+request.headers.host);
      if(asset(url.pathname,response))return;
      const headers=new Headers();
      for(const [name,value] of Object.entries(request.headers)){
        if(["host","connection","upgrade","keep-alive","transfer-encoding","proxy-connection"].includes(name)
          ||value===undefined)continue;
        if(Array.isArray(value))for(const part of value)headers.append(name,part);
        else headers.set(name,value);
      }
      const chunks=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
      const method=request.method??"GET";
      const result=await worker.fetch(url.href,{method,headers,
        ...(["GET","HEAD"].includes(method)?{}:{body:Buffer.concat(chunks)})});
      const sent={};
      result.headers.forEach((value,name)=>{
        if(!["transfer-encoding","connection"].includes(name))sent[name]=value;
      });
      if(typeof result.headers.getSetCookie==="function"){
        const cookies=result.headers.getSetCookie();
        if(cookies.length)sent["set-cookie"]=cookies;
      }
      response.writeHead(result.status,sent);
      response.end(Buffer.from(await result.arrayBuffer()));
    }catch(error){
      console.error("BACKSTAGE_PROXY",error instanceof Error?error.stack:String(error));
      response.writeHead(502);response.end("Local test Worker failure");
    }
  });
  await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok);});
  return {server,origin:"http://127.0.0.1:"+server.address().port};
}
function browserBinary(){
  const found=[process.env.CHROME_PATH,process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
    "/usr/bin/chromium","/usr/bin/chromium-browser"].filter(Boolean).find(existsSync);
  assert.ok(found,"Chrome/Chromium required for the full-backstage visual regression");
  return found;
}
const sections=[
  ["browse",".admin-browser-context"],
  ["articles",".admin-real-stats"],
  ["spaces",".spaces-root"],
  ["files",".axis-file-utilities"],
  ["home",".config-form .brand-preview"],
  ["about",".page-config-form .about-admin-preview"],
  ["connect",".page-config-form .about-admin-preview"],
  ["categories",".category-manager"],
  ["integrations",".activation-config"],
];
const profiles=[
  {id:"desktop",width:1440,height:900,dark:false},
  {id:"tablet",width:900,height:1100,dark:false},
  {id:"phone",width:390,height:844,dark:false},
  {id:"phone-dark",width:390,height:844,dark:true},
];

async function open(page,origin,section,selector){
  const response=await page.goto(origin+"/admin?section="+section,{
    waitUntil:"networkidle0",timeout:70000,
  });
  assert.equal(response.status(),200,section+" real Worker route");
  await page.waitForSelector(selector,{timeout:30000,visible:true});
  await page.waitForFunction(expected=>
    document.querySelector(".admin-workspace")?.getAttribute("data-axis-section")===expected,
    {timeout:10000},section);
}

async function verifyPage(page,profile,section){
  const m=await page.evaluate(section=>{
    const root=document.querySelector(".admin-shell");
    const content=document.querySelector(".admin-workspace");
    const search=document.querySelector(".admin-workspace-bar .admin-article-search-trigger");
    const dock=document.querySelector(".admin-more .admin-dock");
    const heading=document.querySelector(".admin-main > .admin-header h1");
    const top=search?.getBoundingClientRect();
    const nav=dock?.getBoundingClientRect();
    const h=heading?.getBoundingClientRect();
    const get=el=>el?getComputedStyle(el):null;
    const buttons=[...document.querySelectorAll(".admin-main > .admin-header .new-button")];
    const field=document.querySelector(".admin-config-main .config-form input:not([type=color])");
    return {
      section,heading:heading?.textContent??"",
      root:!!root,search:!!search,logo:!!root?.querySelector(".admin-brand-axis"),
      xOverflow:document.documentElement.scrollWidth-innerWidth,
      viewport:innerWidth,nav:{top:nav?.top??-1,bottom:nav?.bottom??-1,width:nav?.width??0},
      searchBottom:top?.bottom??0,headingTop:h?.top??null,
      hSize:heading?parseFloat(get(heading).fontSize):null,
      lead:heading?.parentElement?.querySelector("span")?.textContent??"",
      leadDisplay:heading?.parentElement?.querySelector("span")?
        get(heading.parentElement.querySelector("span")).display:null,
      buttons:buttons.map(el=>({height:el.getBoundingClientRect().height})),
      inputSize:field?parseFloat(get(field).fontSize):null,
    };
  },section);
  assert.ok(m.root&&m.logo&&m.search,profile.id+" "+section+" must preserve AXIS brand and search island");
  assert.ok(m.xOverflow<=2,profile.id+" "+section+" horizontal overflow: "+JSON.stringify(m));
  if(section!=="browse"){
    assert.ok(m.heading.length>0&&m.hSize>=24,
      profile.id+" "+section+" readable heading: "+JSON.stringify(m));
    assert.ok(m.leadDisplay!=="none",profile.id+" "+section+" heading description visible");
  }
  if(profile.width<=800){
    assert.ok(m.nav.bottom<=profile.height+2&&m.nav.width>150,
      profile.id+" "+section+" bottom AXIS navigation must remain on screen");
    if(m.headingTop!==null)assert.ok(m.headingTop>=m.searchBottom+6,
      profile.id+" "+section+" search island overlaps page heading: "+JSON.stringify(m));
    assert.ok(m.buttons.every(button=>button.height>=40),
      profile.id+" "+section+" top actions are touch friendly");
    if(m.inputSize!==null)assert.ok(m.inputSize>=16,
      profile.id+" "+section+" forms must not trigger Safari zoom");
  }
  return m;
}

async function verifyUnsavedNavigation(page,origin){
  await open(page,origin,"home",".config-form .brand-preview");
  const selector='.config-form input';
  await page.focus(selector);
  await page.keyboard.type("X");
  await page.waitForFunction(()=>
    document.querySelector(".config-footer [role=status]")?.textContent?.includes("未保存"),
    {timeout:7000});
  page.once("dialog",dialog=>void dialog.dismiss());
  await page.evaluate(()=>{
    const article=[...document.querySelectorAll(".admin-nav-desktop button")]
      .find(button=>button.title==="文章");
    if(!article)throw Error("article navigation unavailable");
    article.click();
  });
  await page.waitForFunction(()=>
    document.querySelector(".admin-workspace")?.getAttribute("data-axis-section")==="home",
    {timeout:4000});
  assert.ok(await page.$eval(".config-footer [role=status]",element=>
    element.textContent.includes("未保存")),"cancelled navigation retains unsaved Home changes");

  page.once("dialog",dialog=>void dialog.accept());
  await page.evaluate(()=>{
    const article=[...document.querySelectorAll(".admin-nav-desktop button")]
      .find(button=>button.title==="文章");
    article.click();
  });
  await page.waitForFunction(()=>
    document.querySelector(".admin-workspace")?.getAttribute("data-axis-section")==="articles",
    {timeout:7000});
  await page.waitForSelector(".admin-real-stats");
  console.log("PASS desktop navigation: unsaved Home cannot be silently lost");
}

async function verifyEditor(page,origin,profile){
  await open(page,origin,"articles",".admin-real-stats");
  await page.click(".admin-main > .admin-header .new-button");
  await page.waitForSelector(".editor-panel",{visible:true,timeout:12000});
  const modes=await page.$$eval(".axis-writing-view-modes button",buttons=>
    buttons.map(button=>button.textContent.trim()));
  assert.equal(modes.length,3,"writing retains source / split / reading");
  assert.ok(modes.join(" ").includes("源码")&&modes.join(" ").includes("分屏")
    &&modes.join(" ").includes("阅读"),"all original editing modes present");
  await page.screenshot({path:resolve(dir,"axis-editor-"+profile.id+".png"),animations:"disabled"});
  await page.focus(".editor-panel .title-field input");
  await page.keyboard.type("Chromium 未保存草稿检查");
  const dirty=await page.$eval(".axis-editor-save-state",el=>el.textContent);
  assert.match(dirty,/未保存/);
  page.once("dialog",dialog=>void dialog.dismiss());
  await page.click(".editor-panel .editor-footer button[type=button]");
  assert.ok(await page.$(".editor-panel"),"cancel close preserves draft");
  page.once("dialog",dialog=>void dialog.accept());
  await page.click(".editor-panel .editor-footer button[type=button]");
  await page.waitForSelector(".editor-panel",{hidden:true,timeout:7000});
  console.log("PASS "+profile.id+" editor: three views, dirty badge and safe discard");
}

async function checkProfile(browser,origin,cookie,profile){
  const context=await browser.createBrowserContext();
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.setViewport({width:profile.width,height:profile.height,deviceScaleFactor:1});
  await page.emulateMediaFeatures([{name:"prefers-color-scheme",value:profile.dark?"dark":"light"}]);
  const [name,value]=cookie.split("=");
  await page.setCookie({name,value,url:origin});
  try{
    for(const [section,selector] of sections){
      await open(page,origin,section,selector);
      const metrics=await verifyPage(page,profile,section);
      console.log("BACKSTAGE",profile.id,section,JSON.stringify(metrics));
      await page.screenshot({path:resolve(dir,"axis-"+profile.id+"-"+section+".png"),
        animations:"disabled"});
    }
    if(profile.id==="desktop")await verifyUnsavedNavigation(page,origin);
    if(profile.id==="desktop"||profile.id==="phone")await verifyEditor(page,origin,profile);
    assert.deepEqual(errors,[],profile.id+" browser JavaScript errors");
    console.log("PASS whole AXIS backstage",profile.id,sections.length+" real sections");
  }finally{await context.close();}
}
let h,server,browser;
try{
  h=await openTestHarness();
  const owner=await makeActiveUser(h,"axis-full-backstage-owner");
  await h.db.prepare("INSERT INTO site_memberships(user_id,role) VALUES(?,'owner')")
    .bind(owner.id).run();
  server=await proxy(h.worker);
  browser=await puppeteer.launch({headless:true,executablePath:browserBinary(),
    args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});
  for(const profile of profiles)await checkProfile(browser,server.origin,owner.cookie,profile);
  console.log("PASS full-backstage visual and interaction regression");
}finally{
  if(browser)await browser.close();
  if(server)await new Promise(done=>server.server.close(done));
  if(h)await closeTestHarness(h);
}
