/**
 * Browser acceptance of the real built Worker pages. Never connects to
 * production and never screenshots an unmasked personal access token.
 *
 * Run after "npm run build": node scripts/visual-connect-acceptance.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { openTestHarness, closeTestHarness, jsonRequest } from "../tests/integration/harness.mjs";
import { makeActiveUser } from "../tests/integration/identity-fixtures.mjs";

const outputDir = resolve(".visual-connect");
mkdirSync(outputDir, { recursive: true });

function chromeExecutable() {
  const locations = [
    process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  ].filter(Boolean);
  const found = locations.find(path => existsSync(path));
  assert.ok(found, "Chrome/Chromium is needed for visual acceptance");
  return found;
}

async function startBrowserProxy(worker) {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const base = "http://" + incoming.headers.host;
      const target = new URL(incoming.url ?? "/", base);
      const headers = new Headers();
      const removed = new Set(["connection","host","keep-alive","transfer-encoding","upgrade","proxy-connection"]);
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (removed.has(name) || value === undefined) continue;
        if (Array.isArray(value)) for (const part of value) headers.append(name, part);
        else headers.set(name, value);
      }
      const method = incoming.method ?? "GET";
      const chunks = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      // Wrangler's Worker handle accepts URL + init, not a Node Request object.
      const response = await worker.fetch(target.href, {
        method, headers,
        ...(["GET", "HEAD"].includes(method) ? {} : { body: Buffer.concat(chunks) }),
      });
      const sentHeaders = {};
      response.headers.forEach((value, name) => {
        if (name !== "transfer-encoding" && name !== "connection") sentHeaders[name] = value;
      });
      if (typeof response.headers.getSetCookie === "function") {
        const cookies = response.headers.getSetCookie();
        if (cookies.length) sentHeaders["set-cookie"] = cookies;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      outgoing.writeHead(response.status, sentHeaders);
      outgoing.end(bytes);
    } catch (error) {
      console.error("visual proxy failure:", error instanceof Error ? error.message : String(error));
      outgoing.writeHead(502, { "content-type": "text/plain" });
      outgoing.end("Visual test proxy failed");
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const { port } = server.address();
  return { server, origin: "http://127.0.0.1:" + port };
}

async function closeProxy(server) {
  if (server) await new Promise(resolveClose => server.close(resolveClose));
}

function watchErrors(page, name) {
  const failures = [];
  page.on("pageerror", e => failures.push("pageerror: " + e.message));
  page.on("response", r => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/_next/") && r.status() >= 400) {
      failures.push("asset HTTP " + r.status() + " " + url.pathname);
    }
  });
  return () => assert.deepEqual(failures, [], name + " browser errors");
}

async function checkPublicPage(browser, base, name, width, height, dark) {
  const page = await browser.newPage();
  const errors = watchErrors(page, name);
  const tokenCalls = [];
  page.on("request", r => {
    if (/\/api\/identity\/(?:tokens|connections)/.test(r.url())) tokenCalls.push(r.url());
  });
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }]);
    const response = await page.goto(base + "/connect", { waitUntil: "networkidle0", timeout: 70000 });
    assert.equal(response.status(), 200, name + " HTTP status");
    await page.waitForSelector(".xy-market-guide-grid .xy-market-guide-card", { timeout: 20000 });
    const measure = await page.evaluate(() => {
      const main = document.querySelector(".xy-marketing-page");
      const hero = document.querySelector(".xy-market-hero");
      const endpoint = document.querySelector(".xy-market-endpoint");
      return {
        theme: document.documentElement.dataset.theme,
        width: document.documentElement.scrollWidth,
        screen: window.innerWidth,
        hero: !!hero,
        faq: !!document.querySelector(".xy-market-faq-list details"),
        methods: document.querySelectorAll(".xy-market-method").length,
        permissions: document.querySelectorAll(".xy-market-permission-grid article").length,
        style: endpoint ? getComputedStyle(endpoint).backgroundColor : "",
        pageText: main?.innerText ?? "",
      };
    });
    assert.equal(measure.methods, 2, name + " auth options");
    assert.equal(measure.permissions, 3, name + " permission levels");
    assert.ok(measure.hero && measure.faq, name + " sections");
    assert.ok(measure.style && measure.style !== "rgba(0, 0, 0, 0)", name + " landing style loaded");
    assert.ok(measure.width <= measure.screen + 1, name + " horizontal overflow: " + JSON.stringify(measure));
    assert.equal(measure.theme, dark ? "dark" : "light", name + " appearance");
    assert.deepEqual(tokenCalls, [], name + " public page must not call credential APIs");
    assert.ok(!measure.pageText.includes("撤销此连接"), name + " public page must not expose credential controls");
    await page.screenshot({ path: resolve(outputDir, "connect-" + name + ".png"), fullPage: true, animations: "disabled" });
    errors();
    console.log("ok: " + name + " marketing visual " + width + "px");
  } finally { await page.close(); }
}

async function checkAuthenticatedManager(browser, origin, cookie) {
  const page = await browser.newPage();
  const errors = watchErrors(page, "AI connection manager");
  try {
    await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 });
    const [cookieName, cookieValue] = cookie.split("=");
    await page.setCookie({ name: cookieName, value: cookieValue, url: origin });
    const response = await page.goto(origin + "/ai-connections", { waitUntil: "networkidle0", timeout: 70000 });
    assert.equal(response.status(), 200, "authenticated AI connection page");
    await page.waitForSelector(".xy-pat-manager .xy-pat-list .xy-pat-item", { timeout: 20000 });
    const heading = await page.$eval("h1", element => element.textContent);
    assert.match(heading, /AI 连接/);
    assert.equal(await page.$$eval(".xy-pat-item", elements => elements.length), 2);
    const safePreview = await page.$eval(".xy-pat-list", el => el.innerText);
    assert.match(safePreview, /xy_pat_.*••/);
    assert.ok(!(safePreview.includes("xy_pat_") && /xy_pat_[0-9a-f]{64}/.test(safePreview)), "never render complete Token in list");

    await page.screenshot({ path: resolve(outputDir, "ai-connections-desktop.png"), fullPage: true, animations: "disabled" });
    await page.click(".xy-pat-header .xy-pat-create-btn");
    await page.waitForSelector(".xy-pat-form");
    await page.select(".xy-pat-form select", "never");
    await page.screenshot({ path: resolve(outputDir, "ai-connections-create.png"), fullPage: true, animations: "disabled" });
    await page.type(".xy-pat-form input[type=text]", "Visual test PAT");
    await page.click(".xy-pat-form button[type=submit]");
    await page.waitForSelector(".xy-pat-reveal code", { timeout: 20000 });
    const secret = await page.$eval(".xy-pat-reveal code", el => el.textContent ?? "");
    assert.match(secret, /^xy_pat_[a-f0-9]{64}$/);
    await page.click(".xy-pat-reveal button:last-child");
    await page.waitForFunction(() => document.querySelectorAll(".xy-pat-item").length === 3, { timeout: 20000 });
    assert.equal(await page.$(".xy-pat-reveal"), null, "secret dismissed");
    assert.ok(!await page.evaluate(s => document.body.innerText.includes(s), secret), "secret must no longer be shown");
    errors();
    console.log("ok: authenticated AI connection screenshot + permanent PAT creation");
  } finally { await page.close(); }
}

let harness, proxy, browser;
try {
  harness = await openTestHarness();
  const alice = await makeActiveUser(harness, "visual-owner");
  for (const input of [
    { name: "Cursor · MacBook", scopes: ["xingyu.read","xingyu.draft"], lifetime: "never" },
    { name: "本地开发", scopes: ["xingyu.read"], lifetime: 90 },
  ]) {
    const res = await jsonRequest(harness, "/api/identity/tokens", { method: "POST", cookie: alice.cookie, body: input });
    assert.equal(res.status, 201, "seed visual PAT: " + (await res.clone().text()));
    await res.body?.cancel();
  }
  proxy = await startBrowserProxy(harness.worker);
  browser = await puppeteer.launch({
    headless: true, executablePath: chromeExecutable(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  await checkPublicPage(browser, proxy.origin, "desktop", 1440, 900, false);
  await checkPublicPage(browser, proxy.origin, "mobile", 390, 844, false);
  await checkPublicPage(browser, proxy.origin, "dark", 1440, 900, true);
  await checkAuthenticatedManager(browser, proxy.origin, alice.cookie);
  console.log("All real-page browser acceptance checks passed. Screenshots: " + outputDir);
} finally {
  if (browser) await browser.close();
  if (proxy) await closeProxy(proxy.server);
  if (harness) await closeTestHarness(harness);
}
