/**
 * Browser acceptance against a locally built Worker and isolated local D1.
 * Captures the global floating assistant plus full-page /ask, without any
 * production credentials or OpenRouter network calls.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import puppeteer from "puppeteer-core";
import { openTestHarness, closeTestHarness } from "../tests/integration/harness.mjs";

const output = resolve("visual-ask");
const roots = [resolve("dist/client"), resolve("public")];
const mimes = {
  ".js":"text/javascript", ".css":"text/css", ".html":"text/html",
  ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg",
  ".webp":"image/webp", ".woff2":"font/woff2", ".ico":"image/x-icon",
};
mkdirSync(output,{recursive:true});

function asset(path, response) {
  for(const root of roots) {
    let file;
    try { file=resolve(root,"."+decodeURIComponent(path)); } catch { return false; }
    if(!file.startsWith(root+sep)||!existsSync(file)||!statSync(file).isFile())continue;
    const suffix=file.slice(file.lastIndexOf("."));
    response.writeHead(200,{"content-type":mimes[suffix]??"application/octet-stream","cache-control":"no-store"});
    response.end(readFileSync(file));
    return true;
  }
  return false;
}

async function proxyFor(worker) {
  const server=createServer(async(request,response)=>{
    try {
      const url=new URL(request.url??"/","http://"+request.headers.host);
      if(asset(url.pathname,response))return;
      const headers=new Headers();
      for(const [key,value] of Object.entries(request.headers)){
        if(["host","connection","transfer-encoding","keep-alive","upgrade"].includes(key)||value===undefined)continue;
        if(Array.isArray(value))for(const item of value)headers.append(key,item);
        else headers.set(key,value);
      }
      const method=request.method??"GET";
      const chunks=[];
      for await(const chunk of request)chunks.push(Buffer.from(chunk));
      const out=await worker.fetch(url.href,{
        method,headers,...(["GET","HEAD"].includes(method)?{}:{body:Buffer.concat(chunks)}),
      });
      const copied={};
      out.headers.forEach((value,key)=>{if(!["connection","transfer-encoding"].includes(key))copied[key]=value;});
      response.writeHead(out.status,copied);
      response.end(Buffer.from(await out.arrayBuffer()));
    }catch(error){
      console.error("visual test proxy:",error instanceof Error?error.message:String(error));
      response.writeHead(502);response.end("Local Worker error");
    }
  });
  await new Promise((done,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",done);});
  const port=server.address().port;
  return {server,origin:"http://127.0.0.1:"+port};
}

async function check(browser,origin,label,width,height,dark) {
  const page=await browser.newPage();
  const failures=[];
  page.on("pageerror",error=>failures.push(error.message));
  await page.setViewport({width,height,deviceScaleFactor:1});
  await page.emulateMediaFeatures([{name:"prefers-color-scheme",value:dark?"dark":"light"}]);
  try{
    const first=await page.goto(origin+"/",{waitUntil:"networkidle0",timeout:70000});
    assert.equal(first.status(),200,label+" homepage");
    await page.waitForSelector(".xy-ai-launcher",{visible:true,timeout:20000});
    await page.click(".xy-ai-launcher");
    await page.waitForSelector(".xy-ai-panel:not([hidden]) .xy-ai-composer",{visible:true,timeout:25000});
    const dimensions=await page.evaluate(()=>{
      const panel=document.querySelector(".xy-ai-panel").getBoundingClientRect();
      const thread=document.querySelector(".xy-ai-thread").getBoundingClientRect();
      const composer=document.querySelector(".xy-ai-composer").getBoundingClientRect();
      return { panel:{left:panel.left,right:panel.right,top:panel.top,bottom:panel.bottom},
        thread:{top:thread.top,bottom:thread.bottom},
        composer:{top:composer.top,bottom:composer.bottom},
        inner:window.innerWidth,scroll:document.documentElement.scrollWidth };
    });
    assert.ok(dimensions.panel.left>=-1&&dimensions.panel.right<=width+1,label+" panel within viewport");
    assert.ok(dimensions.thread.bottom<=dimensions.composer.top+1,label+" conversation above composer");
    assert.ok(dimensions.composer.bottom<=height+1&&dimensions.composer.bottom>=height-80,label+" composer docked to bottom");
    assert.ok(dimensions.scroll<=width+1,label+" page horizontal overflow");
    if(width<=720)assert.ok(dimensions.panel.left<1,label+" mobile full-screen panel");
    await page.screenshot({path:resolve(output,"ask-floating-"+label+".png"),animations:"disabled"});
    await page.type(".xy-ai-form textarea","温莎");
    await page.click(".xy-ai-only-search");
    await page.waitForFunction(()=>Array.from(document.querySelectorAll(".xy-ai-source-content strong"))
      .some(node=>node.textContent?.includes("温莎技术实践")),{timeout:25000});
    assert.equal(await page.$$eval(".xy-ai-turn-error",nodes=>nodes.length),0,label+" 2-character question accepted");
    await page.screenshot({path:resolve(output,"ask-cited-"+label+".png"),animations:"disabled"});
    await page.click(".xy-ai-close");
    await page.waitForSelector(".xy-ai-launcher",{visible:true,timeout:10000});
    const route=await page.goto(origin+"/ask",{waitUntil:"networkidle0",timeout:70000});
    assert.equal(route.status(),200,label+" full-page /ask");
    await page.waitForSelector(".xy-ai-chat--page .xy-ai-composer",{visible:true,timeout:20000});
    assert.match(await page.$eval(".xy-ask-intro h1",node=>node.textContent),/问问星屿/);
    await page.screenshot({path:resolve(output,"ask-page-"+label+".png"),animations:"disabled"});
    assert.deepEqual(failures,[],label+" browser page errors");
    console.log("PASS assistant visual "+label+", layout+citation+full-page");
  } finally {await page.close();}
}

let harness,proxy,browser;
try{
  harness=await openTestHarness({
    vars:{VIEWS_IDENTITY_SECRET:"visual-qa-hmac-secret-long-enough"},
  });
  const category=await harness.db.prepare("SELECT id FROM categories WHERE workspace_id=1 LIMIT 1").first();
  assert.ok(category);
  await harness.db.prepare(
    "INSERT INTO posts(workspace_id,public_id,title,slug,excerpt,content,category_id,space_id,status,published_at) "+
    "VALUES(1,'visual-windsor','温莎技术实践','visual-windsor','温莎文章示例','# 温莎的公开技术实践',?,NULL,'published',CURRENT_TIMESTAMP)"
  ).bind(category.id).run();
  proxy=await proxyFor(harness.worker);
  const executable=[
    process.env.CHROME_PATH,process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/google-chrome","/usr/bin/google-chrome-stable",
    "/usr/bin/chromium","/usr/bin/chromium-browser",
  ].filter(Boolean).find(path=>existsSync(path));
  assert.ok(executable,"Chrome browser missing");
  browser=await puppeteer.launch({headless:true,executablePath:executable,
    args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});
  await check(browser,proxy.origin,"desktop",1440,900,false);
  await check(browser,proxy.origin,"mobile",390,844,false);
  await check(browser,proxy.origin,"dark",1440,900,true);
}finally{
  if(browser)await browser.close();
  if(proxy)await new Promise(done=>proxy.server.close(done));
  if(harness)await closeTestHarness(harness);
}
