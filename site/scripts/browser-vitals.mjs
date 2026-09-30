// Browser-level Core Web Vitals measurement for the local dev site.
// Usage: node scripts/browser-vitals.mjs <url...>
// Falls back to Edge or Chrome already installed on the machine.
import puppeteer from "puppeteer-core";

const candidates = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

import { existsSync } from "node:fs";
const executablePath = candidates.find((path) => existsSync(path));
if (!executablePath) {
  console.error("No Edge/Chrome executable found; pass one via --executable <path>");
  process.exit(1);
}

const urls = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!urls.length) {
  console.error("usage: node scripts/browser-vitals.mjs <url> [url...]");
  process.exit(1);
}

async function collect(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const result = { lcp: null, largest: [] };
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "largest-contentful-paint") result.lcp = entry.startTime;
        }
      });
      observer.observe({ type: "largest-contentful-paint", buffered: true });
      const navigation = performance.getEntriesByType("navigation")[0];
      const paints = Object.fromEntries(
        performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]),
      );
      const clsEntries = performance.getEntriesByType("layout-shift");
      const largest = performance.getEntriesByType("resource")
        .map((entry) => ({ name: entry.name.split("/").pop(), size: entry.transferSize || 0 }))
        .sort((a, b) => b.size - a.size)
        .slice(0, 8);
      resolve({
        ...result,
        largest,
        ttfb: navigation ? navigation.responseStart : null,
        fcp: paints["first-contentful-paint"] ?? null,
        cls: Number(clsEntries.reduce((total, entry) => total + (entry.hadRecentInput ? 0 : entry.value), 0).toFixed(4)),
        transferSize: performance.getEntriesByType("resource")
          .reduce((total, entry) => total + (entry.transferSize || 0), 0),
        resourceCount: performance.getEntriesByType("resource").length,
      });
    } catch (error) {
      resolve({ ...result, error: String(error) });
    }
  }));
}

async function measure(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const metrics = [];
  for (const label of ["cold", "warm"]) {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
    metrics.push({ label, ...(await collect(page)) });
  }
  await page.close();
  return { url, metrics };
}

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const results = [];
try {
  for (const url of urls) {
    results.push(await measure(browser, url));
  }
} finally {
  await browser.close();
}

for (const { url, metrics } of results) {
  console.log(`\n${url}`);
  for (const { label, ttfb, fcp, lcp, cls, transferSize, resourceCount, largest } of metrics) {
    console.log(
      `  ${label.padEnd(5)} TTFB=${ttfb?.toFixed(0)}ms FCP=${fcp?.toFixed(0)}ms LCP=${lcp ? lcp.toFixed(0) : "n/a"}ms ` +
      `CLS=${cls} transfer=${(transferSize / 1024).toFixed(0)}KB resources=${resourceCount}`,
    );
    if ((label === "cold" && transferSize > 500 * 1024) || label === "warm") {
      for (const { name, size } of largest) console.log(`         ${(size / 1024).toFixed(0).padStart(6)}KB ${name}`);
    }
  }
}