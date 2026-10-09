import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const relativeLuminance = (hex) => {
  const rgb = hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16) / 255);
  const channels = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrastRatio = (a, b) => {
  const top = Math.max(relativeLuminance(a), relativeLuminance(b));
  const bottom = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (top + 0.05) / (bottom + 0.05);
};

test("Quiet Island CSS only enters actual article and immersive reader modules", async () => {
  const [root, page, modal, css] = await Promise.all([
    source("app/layout.tsx"),
    source("features/reader/PostPageView.tsx"),
    source("features/reader/ModalPostReader.tsx"),
    source("features/reader/quiet-island.css"),
  ]);
  assert.doesNotMatch(root, /quiet-island\.css/);
  assert.match(page, /import "\.\/quiet-island\.css";/);
  assert.match(modal, /import "\.\/quiet-island\.css";/);
  assert.match(page, /className="prose markdown-body"/);
  assert.match(modal, /className="reader-prose markdown-body"/);
  assert.match(css, /\.post-page \.prose\.markdown-body/);
  assert.match(css, /\.reader-prose\.markdown-body/);
  assert.doesNotMatch(css, /^\s*(?:body|html|main|p|h1|h2|h3|button)\s*\{/m);
});

test("Quiet Island has responsive focus and independently legible light/dark surfaces", async () => {
  const css = await source("features/reader/quiet-island.css");
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /focus-visible/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /--qi-accent: #4a7870/);
  assert.match(css, /--qi-accent: #91bdb0/);

  const contrastCases = [
    ["light ink on paper", "#26302f", "#faf9f6"],
    ["light body link on paper", "#4a7870", "#faf9f6"],
    ["light muted copy on paper", "#697572", "#faf9f6"],
    ["dark ink on charcoal", "#e1e8e4", "#151b1c"],
    ["dark body link on charcoal", "#91bdb0", "#151b1c"],
    ["dark muted copy on charcoal", "#b4bfb9", "#151b1c"],
  ];
  for (const [label, foreground, background] of contrastCases) {
    assert.ok(contrastRatio(foreground, background) >= 4.5,
      `${label}: ${contrastRatio(foreground, background).toFixed(2)}:1 contrast is below AA`);
  }
});

test("code highlight colors remain legible on both code panel themes", async () => {
  const css = await source("features/reader/quiet-island.css");
  assert.match(css, /\.hljs-keyword/);
  assert.match(css, /\.hljs-comment/);
  const lightForegrounds = ["#62736c", "#8d3d6e", "#24634c", "#315b88", "#805c20", "#56655e"];
  const darkForegrounds = ["#a9bdb3", "#edb2d0", "#b5ddc3", "#aacdec", "#ecd19d", "#c3d5ca"];
  for (const color of lightForegrounds) {
    assert.ok(contrastRatio(color, "#f4f6f3") >= 4.5, `light code token ${color} insufficient contrast`);
  }
  for (const color of darkForegrounds) {
    assert.ok(contrastRatio(color, "#1a2522") >= 4.5, `dark code token ${color} insufficient contrast`);
  }
});

test("visual refresh preserves sanitized Markdown Plus and scoped attachments", async () => {
  const markdown = await source("features/markdown/MarkdownRenderer.tsx");
  assert.match(markdown, /rehypeSanitize/);
  assert.match(markdown, /rehypeKatex/);
  assert.match(markdown, /MarkdownMermaid/);
  assert.match(markdown, /MarkdownCodeCopyButton/);
  assert.match(markdown, /previewAuthorizedUrl/);
  assert.match(markdown, /markdownSchema/);
});
