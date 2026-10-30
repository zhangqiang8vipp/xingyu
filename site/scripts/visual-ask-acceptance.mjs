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
    assert.equal(await page.evaluate(()=>document.querySelectorAll(".xy-ai-nav-trigger").length),0,
      label+" no redundant top Ask AI button");
    const launcher=await page.$eval(".xy-ai-launcher",button=>{
      const rect=button.getBoundingClientRect();
      return {
        x:rect.left,y:rect.top,width:rect.width,height:rect.height,
        right:rect.right,bottom:rect.bottom,
        text:button.textContent.trim(),
        logos:button.querySelectorAll("svg.axis-mark").length,
        touchAction:getComputedStyle(button).touchAction,
      };
    });
    assert.equal(launcher.text,"",label+" floating assistant has no visible label");
    assert.equal(launcher.logos,1,label+" exactly one original XINGYU emblem");
    assert.ok(launcher.width>=48&&launcher.width<=58&&launcher.height>=48&&launcher.height<=58,
      label+" AI launcher has a compact touch target");
    assert.ok(launcher.x>=0&&launcher.y>=0&&launcher.right<=width+1&&launcher.bottom<=height+1,
      label+" AI launcher stays on-screen");

    if(width<=720){
      await page.screenshot({path:resolve(output,"ask-logo-launcher-mobile.png"),animations:"disabled"});
      assert.equal(launcher.touchAction,"none","touch drag must not scroll the page");
      const start={x:launcher.x+launcher.width/2,y:launcher.y+launcher.height/2};
      await page.mouse.move(start.x,start.y);
      await page.mouse.down();
      await page.mouse.move(start.x-112,start.y-116,{steps:10});
      await page.mouse.up();
      const dragged=await page.$eval(".xy-ai-launcher",button=>{
        const box=button.getBoundingClientRect();
        return {x:box.left,y:box.top,open:document.querySelector(".xy-ai-panel:not([hidden])")!==null,
          stored:window.localStorage.getItem("xingyu:axis-ai-launcher:v1:mobile")};
      });
      assert.ok(Math.abs(dragged.x-launcher.x)>70&&Math.abs(dragged.y-launcher.y)>70,
        "dragging AXIS AI logo must reposition it");
      assert.equal(dragged.open,false,"drag and release must NOT open the assistant");
      assert.ok(dragged.stored,"mobile launcher remembers the final position");
      await page.reload({waitUntil:"networkidle0",timeout:70000});
      await page.waitForSelector(".xy-ai-launcher",{visible:true,timeout:20000});
      await page.waitForFunction(()=>{
        const box=document.querySelector(".xy-ai-launcher")?.getBoundingClientRect();
        return Boolean(box&&box.left<300&&box.top<740);
      },{timeout:5000});
      const restored=await page.$eval(".xy-ai-launcher",button=>{
        const box=button.getBoundingClientRect();
        return {x:box.left,y:box.top};
      });
      assert.ok(Math.abs(restored.x-dragged.x)<=4&&Math.abs(restored.y-dragged.y)<=4,
        "mobile bubble position should survive a reload");
      await page.focus(".xy-ai-launcher");
      await page.keyboard.down("Shift");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.up("Shift");
      const keyboardX=await page.$eval(".xy-ai-launcher",button=>button.getBoundingClientRect().left);
      assert.ok(keyboardX<restored.x-10,"focused button must also be movable by keyboard");

      // Rotation must clamp the saved position to the *current* safe visible
      // area rather than leaving the bubble offscreen or under the nav island.
      await page.setViewport({width:640,height:375,deviceScaleFactor:1});
      await page.waitForFunction(()=>{
        const button=document.querySelector(".xy-ai-launcher");
        const rect=button?.getBoundingClientRect();
        return Boolean(rect&&rect.left>=0&&rect.right<=innerWidth
          &&rect.top>=0&&rect.bottom<=innerHeight);
      },{timeout:8000});
      const rotated=await page.evaluate(()=>{
        const bubble=document.querySelector(".xy-ai-launcher").getBoundingClientRect();
        const nav=document.querySelector(".site-nav nav")?.getBoundingClientRect();
        return {left:bubble.left,top:bubble.top,right:bubble.right,bottom:bubble.bottom,
          navBottom:nav?.bottom??0};
      });
      assert.ok(rotated.top>=rotated.navBottom+8,
        "landscape bubble must not overlap the AXIS navigation island");
      await page.screenshot({path:resolve(output,"ask-logo-launcher-landscape.png"),animations:"disabled"});
      await page.setViewport({width,height,deviceScaleFactor:1});
      await page.waitForFunction(()=>{
        const bubble=document.querySelector(".xy-ai-launcher")?.getBoundingClientRect();
        return Boolean(bubble&&bubble.right<=innerWidth&&bubble.bottom<=innerHeight);
      },{timeout:8000});
      console.log("PASS AXIS AI logo drag + reload + landscape + keyboard",JSON.stringify(rotated));
    }
    // Simulate a long article in the real browser without relying on external content.
    await page.evaluate(()=>{
      const spacer=document.createElement("div");
      spacer.style.height="1850px";
      spacer.dataset.qaScrollTest="true";
      document.body.append(spacer);
      document.documentElement.style.scrollBehavior="auto";
      window.scrollTo(0,0);
    });
    await page.click(".xy-ai-launcher");
    await page.waitForSelector(".xy-ai-panel:not([hidden]) .xy-ai-composer",{visible:true,timeout:25000});
    assert.equal(await page.evaluate(()=>window.scrollY),0,label+" opening from top must not scroll page");
    const trap=await page.evaluate(()=>{
      document.querySelector(".site-nav a")?.focus();
      const panel=document.querySelector(".xy-ai-panel");
      return Boolean(panel?.contains(document.activeElement));
    });
    assert.ok(trap,label+" dialog keeps keyboard focus away from page navigation");
    await page.focus(".xy-ai-form textarea");
    await page.keyboard.press("Tab");
    assert.ok(await page.$eval(".xy-ai-panel",panel=>panel.contains(document.activeElement)),
      label+" Tab must wrap within the assistant, not escape to the background");
    if(width<=720){
      const inputSize=await page.$eval(".xy-ai-form textarea",element=>
        parseFloat(getComputedStyle(element).fontSize));
      assert.ok(inputSize>=16,"phone question input avoids iOS focus zoom");
    }
    await page.keyboard.press("Escape");
    await page.waitForSelector(".xy-ai-launcher:not([hidden])",{visible:true,timeout:10000});
    await page.waitForFunction(()=>document.activeElement?.classList.contains("xy-ai-launcher"),
      {timeout:5000});
    await page.waitForSelector(".xy-ai-launcher:not([hidden])",{visible:true,timeout:10000});
    await page.evaluate(()=>window.scrollTo(0,460));
    const expectedScroll=await page.evaluate(()=>window.scrollY);
    assert.ok(expectedScroll>250,label+" long article test fixture must be scrollable");
    await page.click(".xy-ai-launcher");
    await page.waitForSelector(".xy-ai-panel:not([hidden]) .xy-ai-composer",{visible:true,timeout:25000});
    // The second opening uses an already-loaded panel; await its 260ms slide
    // before checking bounding boxes, otherwise the transitional transform
    // can legitimately extend a few pixels beyond the viewport.
    await page.evaluate(async()=>{
      const element=document.querySelector(".xy-ai-panel");
      if(element)await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{})));
    });
    assert.ok(Math.abs((await page.evaluate(()=>window.scrollY))-expectedScroll)<=2,
      label+" opening AI at article midpoint must keep the document scroll unchanged");
    const dimensions=await page.evaluate(()=>{
      const panel=document.querySelector(".xy-ai-panel").getBoundingClientRect();
      const thread=document.querySelector(".xy-ai-thread").getBoundingClientRect();
      const composer=document.querySelector(".xy-ai-composer").getBoundingClientRect();
      return { panel:{left:panel.left,right:panel.right,top:panel.top,bottom:panel.bottom},
        thread:{top:thread.top,bottom:thread.bottom},
        composer:{top:composer.top,bottom:composer.bottom},
        inner:window.innerWidth,scroll:document.documentElement.scrollWidth };
    });
    console.log("AI panel layout",label,JSON.stringify(dimensions));
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
    assert.equal(await page.evaluate(()=>document.querySelectorAll(".xy-ai-turn-error").length),0,label+" 2-character question accepted");
    assert.ok(Math.abs((await page.evaluate(()=>window.scrollY))-expectedScroll)<=2,
      label+" new answers must scroll inside chat, not the main document");
    await page.screenshot({path:resolve(output,"ask-cited-"+label+".png"),animations:"disabled"});
    await page.click(".xy-ai-close");
    await page.waitForSelector(".xy-ai-launcher:not([hidden])",{visible:true,timeout:10000});
    assert.ok(Math.abs((await page.evaluate(()=>window.scrollY))-expectedScroll)<=2,
      label+" closing AI must not jump to document footer");
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
  await check(browser,proxy.origin,"compact",320,700,false);
  await check(browser,proxy.origin,"dark",1440,900,true);
}finally{
  if(browser)await browser.close();
  if(proxy)await new Promise(done=>proxy.server.close(done));
  if(harness)await closeTestHarness(harness);
}
