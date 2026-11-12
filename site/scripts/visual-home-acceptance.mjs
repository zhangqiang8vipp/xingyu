/**
 * Real XINGYU marketing-home AXIS island regression.
 *
 * This deliberately renders the React components from the built Worker
 * against an ephemeral local D1. It must never import or approximate the
 * navigation in a hand-authored HTML preview.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import puppeteer from "puppeteer-core";
import { openTestHarness, closeTestHarness } from "../tests/integration/harness.mjs";

const output = resolve("visual-home");
mkdirSync(output, { recursive: true });
const roots = [resolve("dist/client"), resolve("public")];
const mime = {
  ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff": "font/woff",
  ".woff2": "font/woff2", ".json": "application/json",
};
function asset(path, response) {
  for (const root of roots) {
    let file;
    try { file = resolve(root, "." + decodeURIComponent(path)); } catch { return false; }
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) continue;
    response.writeHead(200, {
      "content-type": mime[file.slice(file.lastIndexOf("."))] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(readFileSync(file));
    return true;
  }
  return false;
}
async function proxy(worker) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://" + request.headers.host);
      if (asset(url.pathname, response)) return;
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (["host","connection","upgrade","keep-alive","transfer-encoding","proxy-connection"].includes(name) || value === undefined) continue;
        if (Array.isArray(value)) for (const part of value) headers.append(name, part);
        else headers.set(name, value);
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const method = request.method || "GET";
      const result = await worker.fetch(url.href, {
        method, headers,
        ...(["GET", "HEAD"].includes(method) ? {} : {body: Buffer.concat(chunks)}),
      });
      const returned = {};
      result.headers.forEach((value, name) => {
        if (!["connection", "transfer-encoding"].includes(name)) returned[name] = value;
      });
      if (typeof result.headers.getSetCookie === "function") {
        const cookies = result.headers.getSetCookie();
        if (cookies.length) returned["set-cookie"] = cookies;
      }
      response.writeHead(result.status, returned);
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      console.error("HOME_PROXY", error instanceof Error ? error.stack : String(error));
      response.writeHead(502);
      response.end("Local Worker failure");
    }
  });
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  return {server, origin: "http://127.0.0.1:" + server.address().port};
}
function browserBinary() {
  const found = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean).find(existsSync);
  assert.ok(found, "Chrome or Chromium required for real AXIS visual acceptance");
  return found;
}
const profiles = [
  { id:"desktop", width:1440, height:900, dark:false },
  { id:"reported", width:1180, height:820, dark:false },
  { id:"compact", width:1024, height:800, dark:false },
  { id:"small-desktop", width:950, height:780, dark:false },
  { id:"mobile", width:390, height:844, dark:false },
  { id:"mobile-dark", width:390, height:844, dark:true },
];

async function metrics(page) {
  return page.evaluate(() => {
    const get = selector => document.querySelector(selector);
    const rect = selector => {
      const node = get(selector);
      if (!node) return null;
      const style = getComputedStyle(node);
      const r = node.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" ||
          Number(style.opacity) < 0.05 || r.width < 2 || r.height < 2) return null;
      return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height };
    };
    return {
      viewport:innerWidth,
      overflow:document.documentElement.scrollWidth-innerWidth,
      nav:rect(".site-nav nav"),
      brand:rect(".site-nav .brand"),
      links:rect(".site-nav .nav-primary"),
      tools:rect(".site-nav .nav-tools"),
      search:rect(".site-nav nav > .island-search .island-search-trigger"),
      field:rect(".site-nav nav > .island-search.active .island-search-field"),
      searchWrapper:rect(".site-nav nav > .island-search.active"),
      results:rect(".site-nav nav > .island-search.active .island-search-results"),
      title:rect(".site-nav nav > .home-nav-title"),
      hero:rect("#home-hero-title"),
      mobile:rect(".site-nav .nav-mobile"),
      marketing:!!get(".xy-mkt"),
      experience:!!get("#experience .xy-mkt-mode-tabs"),
      actualSearch:!!get(".site-nav nav > .island-search"),
      actualNav:!!get(".site-nav nav > .nav-links"),
      staticImpersonation:!!get("#static-search"),
    };
  });
}
function intersects(a,b,gap=3) {
  return Boolean(a && b && a.left < b.right+gap && a.right+gap > b.left &&
    a.top < b.bottom+gap && a.bottom+gap > b.top);
}
function checkChrome(m,label,mode) {
  assert.ok(m.marketing && m.actualSearch && m.actualNav && !m.staticImpersonation,
    label + " must render real AXIS React components: " + JSON.stringify(m));
  assert.ok(m.nav && m.nav.left>=-1 && m.nav.right<=m.viewport+1,
    label + " navigation within viewport " + JSON.stringify(m));
  assert.ok(m.overflow<=2, label + " horizontal overflow " + JSON.stringify(m));
  if(m.links && m.search)assert.ok(!intersects(m.search,m.links),
    label + " search must never cover navigation links " + JSON.stringify(m));
  if(m.tools && m.search)assert.ok(!intersects(m.search,m.tools),
    label + " search must not cover preference controls " + JSON.stringify(m));
  if(mode==="scrolled" && m.title){
    assert.ok(!intersects(m.title,m.search),label + " title and search must have separate slots " + JSON.stringify(m));
    assert.ok(!intersects(m.title,m.links),label + " title must not cover links " + JSON.stringify(m));
    assert.ok(!intersects(m.title,m.tools),label + " title must not cover tools " + JSON.stringify(m));
  }
  if(mode==="expanded"){
    assert.ok(m.field && m.field.width>140,label + " field must be visible " + JSON.stringify(m));
    assert.ok(m.field.left>=5 && m.field.right<=m.viewport-5,
      label + " expanded search FIELD must fit entirely inside the viewport " + JSON.stringify(m));
    if(m.viewport<=800) {
      assert.ok(m.searchWrapper && m.searchWrapper.top>=m.nav.top &&
        m.searchWrapper.bottom<=m.nav.bottom+1,
        label + " mobile search must expand WITHIN the real top island " + JSON.stringify(m));
      assert.ok(m.results && m.results.left>=5 && m.results.right<=m.viewport-5,
        label + " mobile results must not be clipped outside the viewport " + JSON.stringify(m));
      assert.ok(m.results && m.results.top>=m.nav.bottom-3,
        label + " results must open BELOW the island " + JSON.stringify(m));
    }
    assert.ok(!intersects(m.field,m.links),label + " expanded search must not obscure links " + JSON.stringify(m));
    assert.ok(!intersects(m.field,m.tools),label + " expanded search must not obscure tools " + JSON.stringify(m));
  }
}
async function inspect(browser, origin, p) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewport({width:p.width,height:p.height,deviceScaleFactor:1});
  await page.emulateMediaFeatures([{name:"prefers-color-scheme",value:p.dark?"dark":"light"}]);
  try{
    const response = await page.goto(origin + "/", {waitUntil:"networkidle0",timeout:75000});
    assert.equal(response.status(),200,p.id + " home route");
    await page.waitForSelector(".xy-mkt-device", {visible:true,timeout:18000});
    await page.waitForSelector(".site-nav nav > .island-search-trigger, .site-nav nav > .island-search .island-search-trigger", {visible:true,timeout:18000});
    const initial=await metrics(page);
    checkChrome(initial,p.id+" initial","initial");
    assert.ok(initial.hero && initial.hero.top >= initial.nav.bottom+18,
      p.id+" marketing heading must start below floating island " + JSON.stringify(initial));
    await page.screenshot({path:resolve(output,p.id+"-home.png"),animations:"disabled"});

    if(p.width>=931){
      await page.evaluate(()=>window.scrollTo({top:490,behavior:"instant"}));
      await page.waitForFunction(()=>document.querySelector(".home-nav-title")?.classList.contains("visible"),{timeout:6500});
      await new Promise(done=>setTimeout(done,430));
      const scrolled=await metrics(page);
      checkChrome(scrolled,p.id+" scrolled","scrolled");
      await page.screenshot({path:resolve(output,p.id+"-scrolled.png"),animations:"disabled"});
    }
    await page.click(".site-nav nav > .island-search .island-search-trigger");
    await page.waitForSelector(".site-nav nav > .island-search.active input",{visible:true,timeout:7000});
    await new Promise(done=>setTimeout(done,650));
    const open=await metrics(page);
    checkChrome(open,p.id+" search-open","expanded");
    await page.screenshot({path:resolve(output,p.id+"-search.png"),animations:"disabled"});

    await page.keyboard.press("Escape");
    await page.waitForSelector(".site-nav nav > .island-search:not(.active) .island-search-trigger",
      {visible:true,timeout:6000});
    const afterClose=await metrics(page);
    checkChrome(afterClose,p.id+" closed","initial");

    await page.evaluate(()=>document.querySelector("#experience")?.scrollIntoView({block:"center"}));
    // Four distinct, stateful experiences - never a substituted "MCP" tab.
    const modes=await page.$eval('.xy-mkt-mode-tabs [role="tab"]', nodes => nodes.map(node=>node.textContent?.trim()));
    assert.deepEqual(modes.map(label => label?.match(/阅读|问题|考试|AI/)?.[0]), ["阅读","问题","考试","AI"],
      p.id+" must expose the four agreed product experiences");

    await page.click('#xy-mkt-tab-exam');
    await page.waitForSelector('.xy-mkt-stage-exam', {visible:true, timeout:6000});
    await page.click('.xy-mkt-answer-option:nth-child(3)');
    await page.click('.xy-mkt-exam-submit button');
    await page.waitForSelector('.xy-mkt-exam-feedback.is-correct',{visible:true,timeout:5000});

    await page.click('#xy-mkt-tab-questions');
    await page.waitForSelector('.xy-mkt-stage-questions',{visible:true,timeout:5000});
    await page.click('.xy-mkt-question-picker button:nth-child(2)');
    assert.ok((await page.$eval('.xy-mkt-answer-area', el=>el.textContent)).includes('修订'),
      p.id+" switching a question should update its answer");

    await page.click('#xy-mkt-tab-ai');
    await page.waitForSelector('.xy-mkt-stage-ai',{visible:true,timeout:5000});
    await page.click('.xy-mkt-ai-actions button:nth-child(2)');
    assert.ok((await page.$eval('.xy-mkt-ai-response',el=>el.textContent)).includes('风险'),
      p.id+" switching AI task should change example output");

    await page.click('#xy-mkt-tab-reading');
    await page.waitForSelector('.xy-mkt-stage-reader',{visible:true,timeout:5000});
    assert.deepEqual(errors,[],p.id+" JavaScript errors");
    console.log("PASS REAL AXIS HOME",p.id,JSON.stringify({initial,scrolled:p.width>=931,search:open}));
  }finally{
    await context.close();
  }
}
let h,server,browser;
try{
  h=await openTestHarness();
  server=await proxy(h.worker);
  browser=await puppeteer.launch({headless:true,executablePath:browserBinary(),
    args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});
  for(const profile of profiles)await inspect(browser,server.origin,profile);
  console.log("PASS real React AXIS marketing homepage across all desktop/mobile profiles");
}finally{
  if(browser)await browser.close();
  if(server)await new Promise(done=>server.server.close(done));
  if(h)await closeTestHarness(h);
}
