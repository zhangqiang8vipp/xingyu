// Browser-level acceptance for core interactions, run against a local dev server.
// Usage: node scripts/browser-e2e.mjs [baseUrl]
// Requires the dev server (npm run dev) and reads the local admin password from
// site/.env.local (never committed).
import puppeteer from "puppeteer-core";
import { existsSync, readFileSync } from "node:fs";

const candidates = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];
const executablePath = candidates.find((path) => existsSync(path));
if (!executablePath) throw new Error("No Edge/Chrome executable found");

const base = process.argv[2] ?? "http://127.0.0.1:3000";
const envLocal = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const adminPassword = envLocal.match(/^ADMIN_PASSWORD=(.+)$/m)?.[1]?.trim();
if (!adminPassword) throw new Error("ADMIN_PASSWORD not found in site/.env.local");

const results = [];
function report(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok" : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function api(page, path, { method = "GET", body } = {}) {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const text = await response.text();
    return { status: response.status, location: response.headers.get("location"), text };
  }, { url: `${base}${path}`, method, body });
}

const stamp = Date.now().toString(36).slice(-6);
const slugAlpha = `e2e-slug-alpha-${stamp}`;
const slugBeta = `e2e-slug-beta-${stamp}`;

try {
  // 1. Password login contract.
  {
    const page = await browser.newPage();
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    report("未登录后台跳转登录页", page.url().includes("/admin/login"), page.url());

    const bad = await api(page, "/api/admin/login", { method: "POST", body: { password: "wrong-password" } });
    report("错误密码被拒绝", bad.status === 401 || bad.status === 429, String(bad.status));

    const good = await api(page, "/api/admin/login", { method: "POST", body: { password: adminPassword } });
    report("正确密码登录成功", good.status === 200 && JSON.parse(good.text).ok === true, String(good.status));

    await page.goto(`${base}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
    const sidebar = await page.$(".admin-sidebar");
    report("登录后后台可访问", Boolean(sidebar), page.url());
    await page.close();
  }

  // 2. Slug history redirect (create via admin API, rename, check old slug).
  let draftId = null;
  let draftVersion = 1;
  {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await api(page, "/api/admin/login", { method: "POST", body: { password: adminPassword } });
    const created = await api(page, "/api/posts", {
      method: "POST",
      body: {
        title: "E2E Slug 样本",
        slug: slugAlpha,
        excerpt: "e2e",
        content: "# E2E\n本机浏览器验收用文章。",
        categoryId: 1,
        spaceId: null,
        status: "draft",
        featured: false,
        publishedAt: null,
      },
    });
    report("后台创建草稿", created.status === 201, String(created.status));
    const createdPost = JSON.parse(created.text).post;
    draftId = createdPost.id;
    draftVersion = createdPost.version;

    const published = await api(page, `/api/posts/${draftId}`, {
      method: "PATCH",
      body: { title: "E2E Slug 样本", slug: slugBeta, excerpt: "e2e", content: "# E2E\n本机浏览器验收用文章。", status: "published", version: draftVersion },
    });
    report("发布并修改 Slug 成功", published.status === 200, String(published.status));
    const publishedPost = JSON.parse(published.text).post;
    draftVersion = publishedPost.version;

    await page.goto(`${base}/posts/${slugAlpha}`, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(
      (fragment) => location.pathname.includes(fragment),
      { timeout: 30000 },
      `${createdPost.publicId}/${slugBeta}`,
    );
    report(
      "旧 Slug 永久重定向到新地址",
      page.url().includes(createdPost.publicId) && page.url().includes(slugBeta),
      page.url(),
    );
    await page.close();
  }

  // 3. Reading mode switch and modal reader.
  {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector(".reading-mode-button", { timeout: 30000 });
    const beforeMode = await page.evaluate(() => document.documentElement.dataset.readingMode);
    const modeButton = await page.$(".reading-mode-button");
    await modeButton.evaluate((element) => element.click());
    const afterMode = await page.evaluate(() => document.documentElement.dataset.readingMode);
    report("阅读方式切换按钮生效", beforeMode !== afterMode, `${beforeMode} -> ${afterMode}`);

    await modeButton.evaluate((element) => element.click());
    const restoredMode = await page.evaluate(() => document.documentElement.dataset.readingMode);
    if (restoredMode !== beforeMode) await modeButton.evaluate((element) => element.click());

    const firstLink = await page.$('a[href*="give-time-back-to-yourself"]');
    if (!firstLink) {
      report("弹窗阅读打开且不离开首页", false, "首页未找到已知文章链接");
    } else {
      const linkText = await firstLink.evaluate((element) => element.textContent.trim());
      const homeUrl = page.url();
      await firstLink.evaluate((element) => element.click());
      const readerAppeared = await page.waitForFunction(() => {
        const reader = document.querySelector(".reader-layout");
        return reader && reader.offsetParent !== null && reader.textContent.trim().length > 0;
      }, { timeout: 30000 }).then(() => true).catch(() => false);
      let largeEnough = false;
      if (readerAppeared) {
        largeEnough = !linkText.includes("如何把时间重新还给自己")
          || await page.waitForFunction(() => document.querySelector(".reader-layout")?.textContent.includes("如何把时间重新还给自己"), { timeout: 15000 }).then(() => true).catch(() => false);
      }
      report(
        "弹窗阅读打开且不离开首页",
        readerAppeared && largeEnough && page.url() === homeUrl,
        `reader=${readerAppeared} content=${largeEnough} url=${page.url()}`,
      );
    }
    await page.close();
  }

  // 4. Draft preview: typing into the writer updates the live preview without saving.
  {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await api(page, "/api/admin/login", { method: "POST", body: { password: adminPassword } });
    const created = await api(page, "/api/posts", {
      method: "POST",
      body: {
        title: "E2E 预览样本",
        slug: `e2e-preview-${stamp}`,
        excerpt: "e2e",
        content: "初始内容。",
        categoryId: 1,
        spaceId: null,
        status: "draft",
        featured: false,
        publishedAt: null,
      },
    });
    const previewPost = JSON.parse(created.text).post;

    await page.goto(`${base}/admin?section=articles`, { waitUntil: "networkidle2", timeout: 60000 });
    const clicked = await page.evaluate(async (title) => {
      const row = [...document.querySelectorAll("tr")].find((element) => element.textContent.includes(title));
      const edit = row ? [...row.querySelectorAll("button")].find((button) => button.textContent.trim() === "编辑") : null;
      if (!edit) return false;
      edit.click();
      return true;
    }, "E2E 预览样本");
    report("文章列表打开写作工作台", clicked, "row click");
    await page.waitForSelector(".article-editor-workspace", { timeout: 30000 });
    await page.evaluate(() => document.querySelector(".article-editor-workspace")?.scrollIntoView({ block: "center" }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    const workspace = await page.evaluate(() => {
      const { x, y, width, height } = document.querySelector(".article-editor-workspace").getBoundingClientRect();
      return { x, y, width, height };
    });
    // The Vditor IR surface reports a zero rect; click inside the workspace's
    // editor column to engage CodeMirror, then type through CDP.
    await page.mouse.click(workspace.x + workspace.width * 0.22, workspace.y + Math.min(workspace.height - 10, 150));
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.keyboard.type("\nE2E-UNSAVED-词", { delay: 15 });
    const previewShows = await page.waitForFunction(() => {
      const frame = document.querySelector(".article-editor-preview iframe, .writing-frontstage-frame");
      return frame?.contentDocument?.body?.innerText?.includes("E2E-UNSAVED-词") ?? false;
    }, { timeout: 40000 }).then(() => true).catch(() => false);
    report("即时预览显示未保存内容", previewShows);

    const stored = await api(page, `/api/posts/${previewPost.id}`);
    const storedPost = JSON.parse(stored.text).post;
    report("未保存内容不写入 D1", !storedPost.content.includes("E2E-UNSAVED-词"));

    await api(page, `/api/posts/${previewPost.id}`, { method: "DELETE", body: { version: previewPost.version } });
    await page.close();
  }

  // Cleanup: remove the slug-history draft.
  {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await api(page, "/api/admin/login", { method: "POST", body: { password: adminPassword } });
    if (draftId) {
      const removed = await api(page, `/api/posts/${draftId}`, { method: "DELETE", body: { version: draftVersion } });
      report("清理 Slug 样本草稿", removed.status === 200, String(removed.status));
    }
    await page.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter(({ ok }) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);