import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const clientManifest = async () => JSON.parse(await source("dist/client/.vite/manifest.json"));
const clientStyles = async () => {
  const candidates = ["dist/client/assets/", "dist/client/_next/static/css/"];
  for (const path of candidates) {
    const directory = new URL(`../${path}`, import.meta.url);
    try {
      return { directory, files: await readdir(directory) };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  assert.fail("client stylesheet directory is missing");
};
const mcpSource = async () => (await Promise.all([
  source("worker/blog-mcp.ts"),
  source("worker/mcp/read-tools.ts"),
  source("worker/mcp/space-tools.ts"),
  source("worker/mcp/draft-tools.ts"),
  source("worker/mcp/publish-tools.ts"),
])).join("\n");
const generatedMigration = async () => {
  const directory = new URL("../drizzle/", import.meta.url);
  const candidates = (await readdir(directory))
    .filter((name) => /^0005_.+\.sql$/.test(name));
  assert.equal(candidates.length, 1, "expected exactly one generated 0005 migration");
  return readFile(new URL(candidates[0], directory), "utf8");
};

test("content, settings and view data are persisted in D1", async () => {
  const [schema, bootstrap, settingsRoute, pageRoute, viewRoute, viewTracking] = await Promise.all([
    source("db/schema.ts"), source("db/bootstrap.ts"), source("app/api/settings/route.ts"),
    source("app/api/pages/[slug]/route.ts"), source("app/api/views/[slug]/route.ts"),
    source("db/view-tracking.ts"),
  ]);
  assert.match(schema, /siteSettings = sqliteTable\("site_settings"/);
  assert.match(schema, /contentPages = sqliteTable\("content_pages"/);
  assert.match(schema, /postViews = sqliteTable\("post_views"/);
  assert.match(schema, /viewRequestLimits = sqliteTable\("view_request_limits"/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS site_settings/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS content_pages/);
  assert.doesNotMatch(bootstrap, /archiveSeeds|seedContent|headingShowcaseContent/);
  assert.match(settingsRoute, /isAdminRequest/);
  assert.match(pageRoute, /isAdminRequest/);
  assert.match(viewTracking, /INSERT OR IGNORE INTO post_views/);
  assert.match(viewTracking, /view_count = view_count \+ 1/);
  assert.match(viewTracking, /cf-connecting-ip/);
  assert.match(viewTracking, /POST_VIEWS_RETENTION_DAYS = 90/);
  assert.match(viewRoute, /status: 204/);
  assert.match(viewRoute, /status: 429/);
});

test("development and production content stay on isolated databases", async () => {
  const [viteConfig, bootstrap, packageJson] = await Promise.all([
    source("vite.config.ts"), source("db/bootstrap.ts"), source("package.json"),
  ]);
  assert.match(viteConfig, /APP_ENV: appEnvironment/);
  assert.match(viteConfig, /xingyu-development/);
  assert.match(viteConfig, /xingyu-production-preview/);
  assert.match(viteConfig, /DB_SCHEMA_MODE: "migration-only"/);
  assert.match(bootstrap, /app_environment/);
  assert.doesNotMatch(bootstrap, /INSERT(?:\s+OR\s+\w+)?\s+INTO\s+posts\s*\(/i);
  assert.match(packageJson, /dev:production/);
});

test("article routes use stable public ids and retain historical slugs", async () => {
  const [schema, bootstrap, createRoute, updateRoute, postWrite, legacyPage, stablePage, pathHelper] = await Promise.all([
    source("db/schema.ts"), source("db/bootstrap.ts"), source("app/api/posts/route.ts"),
    source("app/api/posts/[id]/route.ts"), source("db/post-write.ts"), source("app/posts/[slug]/page.tsx"),
    source("app/posts/[slug]/[canonicalSlug]/page.tsx"), source("app/post-path.ts"),
  ]);
  assert.match(schema, /publicId: text\("public_id"\)/);
  assert.match(schema, /postSlugHistory/);
  assert.match(bootstrap, /postsWithoutPublicId/);
  assert.match(createRoute, /createPostRecord/);
  assert.match(updateRoute, /updatePostRecord/);
  assert.match(postWrite, /createPostPublicId\(\)/);
  assert.match(postWrite, /INSERT OR IGNORE INTO post_slug_history/);
  assert.match(postWrite, /const statements = \[history, update, changeCount\]/);
  assert.match(postWrite, /if \(attachment\) statements\.push\(attachment\)/);
  assert.match(postWrite, /env\.DB\.batch\(statements\)/);
  assert.match(legacyPage, /permanentRedirect\(postPath\(post\)\)/);
  assert.match(stablePage, /canonicalSlug !== post\.slug/);
  assert.match(pathHelper, /post\.publicId/);
});

test("public pages consume editable settings and shared presentation helpers", async () => {
  const [home, homeExperience, about, post, layout, admin, navigation, contentUtils, queries] = await Promise.all([
    source("app/page.tsx"), source("features/home/BlogHomeExperience.tsx"), source("app/about/page.tsx"), source("features/reader/PostPageView.tsx"),
    source("app/layout.tsx"), source("features/admin/AdminClient.tsx"), source("features/navigation/SiteNavigation.tsx"),
    source("app/content-utils.ts"), source("db/queries.ts"),
  ]);
  assert.match(home, /getSiteSettings/);
  assert.match(home, /settings\.homePostLimit/);
  assert.match(home, /<BlogHomeExperience/);
  assert.match(homeExperience, /estimateReadingMinutesFromLength\(post\.contentLength\)/);
  const homeQuery=queries.slice(queries.indexOf("export async function listHomePosts"),queries.indexOf("export const getSiteSettings"));
  assert.match(homeQuery, /contentLength:\s*sql<number>`length\(\$\{posts\.content\}\)`/);
  assert.doesNotMatch(homeQuery, /content:\s*posts\.content/);
  assert.match(contentUtils, /const longDateFormatter = new Intl\.DateTimeFormat/);
  assert.match(contentUtils, /export function estimateReadingMinutes/);
  assert.match(home, /<SiteNavigation/);
  assert.match(about, /<SiteNavigation/);
  assert.match(post, /<SiteNavigation/);
  assert.match(navigation, /<DesktopIslandNav/);
  assert.match(navigation, /<MobileIslandMenu/);
  assert.doesNotMatch(navigation, /nav-primary/);
  assert.match(about, /getContentPage\("about"\)/);
  assert.match(about, /MarkdownRenderer/);
  assert.match(post, /PostViewTracker/);
  assert.match(layout, /generateMetadata/);
  assert.match(admin, /AdminPageEditor/);
  assert.match(admin, /AdminSettingsPanel/);
  assert.match(admin, /AdminCategoriesPanel/);
  assert.doesNotMatch(admin, /数据模式<\/span><b>海量|<b>∞<\/b>/);
});

test("public island navigation keeps desktop and phone trees apart", async () => {
  const [navigation, desktop, mobile, tools, destinations, css] = await Promise.all([
    source("features/navigation/SiteNavigation.tsx"),
    source("features/navigation/nav/DesktopIslandNav.tsx"),
    source("features/navigation/nav/MobileIslandMenu.tsx"),
    source("features/navigation/nav/NavTools.tsx"),
    source("features/navigation/nav/nav-destinations.ts"),
    source("app/globals.css"),
  ]);
  assert.match(navigation, /<DesktopIslandNav/);
  assert.match(navigation, /<MobileIslandMenu/);
  assert.doesNotMatch(navigation, /nav-primary|ReadingModeToggle/);
  assert.match(desktop, /className="nav-links nav-desktop"/);
  assert.match(mobile, /className=\{`nav-mobile/);
  assert.match(mobile, /nav-mobile-trigger/);
  assert.doesNotMatch(mobile, /nav-primary/);
  assert.match(tools, /<ReadingModeToggle \/>/);
  assert.match(tools, /<MotionModeToggle \/>/);
  assert.match(tools, /<ThemeToggle \/>/);
  assert.match(destinations, /label: "首页"/);
  assert.match(css, /\.nav-desktop\{display:none!important\}/);
  assert.match(css, /\.nav-mobile-sheet\{/);
});

test("published article edits preserve their publication date", async () => {
  const postWrite = await source("db/post-write.ts");
  assert.match(postWrite, /current\[0\]\.publishedAt/);
  assert.match(postWrite, /input\.publishedAt \?\? current\[0\]\.publishedAt \?\? new Date\(\)\.toISOString\(\)/);
});

test("remote MCP separates read approvals from important writes and records receipts", async () => {
  const [mcp, schema, bootstrap, activity] = await Promise.all([
    mcpSource(), source("db/schema.ts"), source("db/bootstrap.ts"),
    source("db/mcp-activity.ts"),
  ]);
  assert.match(mcp, /server\.registerTool\("list_mcp_activity"/);
  assert.match(mcp, /activityReceipt\("upload_attachment"/);
  assert.match(mcp, /server\.registerTool\("get_page"/);
  assert.match(mcp, /server\.registerTool\("update_page"/);
  assert.match(mcp, /change_summary: CHANGE_SUMMARY_SCHEMA/);
  assert.match(mcp, /destructiveHint: true, idempotentHint: true, openWorldHint: true/);
  assert.match(mcp, /activityReceipt\("publish_post"/);
  assert.match(mcp, /没有检测到内容变化，未执行写入/);
  assert.match(schema, /mcpActivity = sqliteTable\("mcp_activity"/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS mcp_activity/);
  assert.match(activity, /preparePostWriteActivity/);
  assert.match(mcp, /INSERT INTO mcp_activity/);
  assert.match(activity, /listMcpActivity/);
});

test("editor assets and post parsing stay scoped to their owners", async () => {
  const [rootLayout, adminLayout, postRoute, postInput, categoriesRoute, editor, transitions] = await Promise.all([
    source("app/layout.tsx"), source("app/admin/layout.tsx"), source("app/api/posts/route.ts"),
    source("domain/posts/post-input.ts"), source("db/categories.ts"),
    source("features/admin/VditorEditor.tsx"), source("app/RouteTransition.tsx"),
  ]);
  assert.doesNotMatch(rootLayout, /vditor\/index\.css/);
  assert.doesNotMatch(adminLayout, /vditor\/dist\/index\.css/);
  assert.match(editor, /import "vditor\/dist\/index\.css"/);
  assert.match(postRoute, /parsePostPayload/);
  assert.match(postInput, /export function slugify/);
  assert.match(categoriesRoute, /domain\/posts\/post-input/);
  assert.match(editor, /await import\("vditor"\)/);
  assert.match(transitions, /const HTMLFlipBook = lazy\(loadFlipBook\)/);
});

test("public entry keeps rich reading assets behind interaction boundaries", async () => {
  const [manifest, viteConfig] = await Promise.all([clientManifest(), source("vite.config.ts")]);
  const modalLink = manifest["features/reader/ModalPostLink.tsx"];
  const katexEntry = Object.values(manifest).find((entry) => entry.name === "MarkdownKatexStyles");
  const { directory: stylesDirectory, files: styleFiles } = await clientStyles();
  const mainCss = styleFiles.find((name) => /^index[.-].+\.css$/.test(name));

  assert.ok(modalLink, "ModalPostLink client chunk is missing");
  assert.deepEqual(modalLink.dynamicImports, ["features/reader/ModalPostReader.tsx"]);
  assert.ok(modalLink.imports.every((name) => !name.includes("MarkdownRenderer") && !name.includes("mermaid")));
  assert.ok(katexEntry?.css?.some((name) => name.includes("MarkdownKatexStyles")), "KaTeX CSS must remain a separate asset");
  assert.match(viteConfig, /xingyu-katex-font-display/);
  assert.match(viteConfig, /replaceAll\("font-display:block", "font-display:swap"\)/);
  assert.ok(mainCss, "main public stylesheet is missing");
  const mainCssSize = (await stat(new URL(mainCss, stylesDirectory))).size;
  assert.ok(mainCssSize <= 270_000, `main public stylesheet exceeded 270 KB: ${mainCssSize} bytes`);
});

test("admin write routes delegate business rules to db modules", async () => {
  const [postRoute, categoryRoute, categoryItemRoute, settingsRoute, pageRoute, postService, categoryService, siteService] = await Promise.all([
    source("app/api/posts/[id]/route.ts"), source("app/api/categories/route.ts"),
    source("app/api/categories/[id]/route.ts"), source("app/api/settings/route.ts"),
    source("app/api/pages/[slug]/route.ts"), source("db/post-write.ts"),
    source("db/categories.ts"), source("db/site-content.ts"),
  ]);
  assert.match(postRoute, /getAdminPost/);
  assert.match(postRoute, /deleteAdminPost/);
  assert.match(categoryRoute, /createCategory/);
  assert.match(categoryItemRoute, /updateCategory/);
  assert.match(categoryItemRoute, /deleteCategory/);
  assert.match(settingsRoute, /updateSiteSettings/);
  assert.match(pageRoute, /upsertContentPage/);
  for (const route of [postRoute, categoryRoute, categoryItemRoute, settingsRoute, pageRoute]) {
    assert.doesNotMatch(route, /drizzle-orm|from\([a-zA-Z]+\)|\.insert\(|\.update\(|\.delete\(/);
  }
  assert.match(postService, /post_slug_history/);
  assert.match(postService, /env\.DB\.batch\(statements\)/);
  assert.match(categoryService, /CategoryServiceError/);
  assert.match(siteService, /CONTENT_LIMITS/);
});

test("admin search cancels stale work and avoids refetching stable stats", async () => {
  const admin = await source("features/admin/AdminClient.tsx");
  assert.match(admin, /const controller = new AbortController\(\)/);
  assert.match(admin, /load\(controller\.signal\)/);
  assert.match(admin, /const loadStats = useCallback/);
  assert.match(admin, /Promise\.all\(\[load\(\), loadStats\(\)\]\)/);
});

test("admin previews unsaved content through the real public pages", async () => {
  const [admin, sidebar, articles, articleEditor, homeSettings, aboutEditor, studio, previewEntry, vditor, livePreview, bridge, postPage] = await Promise.all([
    source("features/admin/AdminClient.tsx"), source("features/admin/AdminSidebar.tsx"),
    source("features/admin/AdminArticlesPanel.tsx"), source("features/admin/AdminArticleEditor.tsx"),
    source("features/admin/AdminSettingsPanel.tsx"),
    source("features/admin/AdminPageEditor.tsx"), source("features/admin/ArticleWritingStudio.tsx"),
    source("app/admin/article-preview/page.tsx"), source("features/admin/VditorEditor.tsx"), source("features/admin/AdminLivePreview.tsx"),
    source("app/AdminPreviewBridge.tsx"), source("features/reader/PostPageView.tsx"),
  ]);
  assert.ok(sidebar.indexOf('label: "浏览"') < sidebar.indexOf('label: "文章"'));
  assert.ok(sidebar.indexOf('label: "文章"') < sidebar.indexOf('label: "知识空间"'));
  assert.ok(sidebar.indexOf('label: "知识空间"') < sidebar.indexOf('label: "首页"'));
  assert.ok(sidebar.indexOf('label: "首页"') < sidebar.indexOf('label: "关于"'));
  assert.ok(sidebar.indexOf('label: "关于"') < sidebar.indexOf('label: "分类"'));
  assert.ok(sidebar.indexOf('label: "分类"') < sidebar.indexOf('label: "接入"'));
  assert.ok(sidebar.indexOf('label: "接入"') < sidebar.indexOf('label: "AI 连接"'));
  assert.match(sidebar, /label: "内容"/);
  assert.match(sidebar, /更多/);
  assert.match(admin, /admin-workspace-bar/);
  assert.match(homeSettings, /HomeLivePreview settings=\{form\}/);
  assert.match(aboutEditor, /ContentPageLivePreview page=\{form\}/);
  assert.match(articleEditor, /onOpenStudio\("reading"\)/);
  assert.match(articleEditor, /ArticleFrontstage/);
  assert.match(admin, /useSplitScrollSync/);
  assert.match(admin, /articleEditorPreviewRef/);
  assert.match(articleEditor, /previewMode="editor"/);
  assert.match(articles, /onBrowse\(post\.id\)/);
  assert.match(articleEditor, /onOpenStudio\("split"\)/);
  assert.match(studio, /type Mode="code"\|"split"\|"reading"/);
  assert.match(studio, /writing-frontstage-frame/);
  assert.match(studio, /export function ArticleFrontstage/);
  assert.match(studio, /article-preview\?draft=/);
  assert.match(studio, /key=\{draft\.publicId \?\? draft\.id/);
  assert.match(studio, /onSourceScroll/);
  assert.match(studio, /onFrameScroll/);
  assert.match(studio, /autoFocus/);
  assert.match(vditor, /preventScroll:true/);
  assert.match(previewEntry, /id:-1/);
  assert.match(previewEntry, /正在预览草稿/);
  assert.doesNotMatch(previewEntry, /listHomePosts/);
  assert.match(livePreview, /src="\/\?adminPreview=home"/);
  assert.match(livePreview, /kind==="about"/);
  assert.match(livePreview, /kind:\s*"about"\|"connect"/);
  assert.match(bridge, /createPortal/);
  assert.match(bridge, /MarkdownRenderer/);
  assert.match(postPage, /AdminPreviewBridge kind="article"/);
  assert.match(vditor, /previewMode="both"/);
});

test("first modal open uses one stable entrance during lazy chunk replacement", async () => {
  const [link, reader, css] = await Promise.all([
    source("features/reader/ModalPostLink.tsx"),
    source("features/reader/ModalPostReader.tsx"),
    source("app/globals.css"),
  ]);
  // Preserve initial lazy loading and the existing full-featured reader.
  assert.match(link, /lazy\(\(\) => import\("\.\/ModalPostReader"\)\)/);
  assert.match(link, /className="reader-open-once"/);
  assert.match(link, /<Suspense fallback=\{<ReaderChunkFallback/);
  assert.match(link, /readerScope=\{readerScope\}/);
  assert.match(link, /key=\{`\$\{activePublicId\}/);
  assert.match(reader, /className="reader-modal"/);
  assert.match(reader, /className="reader-panel"/);

  // The Suspense boundary may swap the fallback panel for the real panel,
  // but entry animation belongs only to the persistent parent.
  assert.match(css, /\.reader-open-once\s*\{[^}]*animation:\s*reader-backdrop-in/s);
  assert.match(css, /\.reader-open-once \.reader-modal,\s*\.reader-open-once \.reader-panel\s*\{\s*animation:\s*none/s);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.reader-open-once\s*\{\s*animation:\s*none/);
});

test("Markdown Plus is rendered through one safe, shared pipeline", async () => {
  const [renderer, mermaid, katexStyles, rootLayout, post, modal, bridge, packageJson] = await Promise.all([
    source("features/markdown/MarkdownRenderer.tsx"), source("features/markdown/MarkdownMermaid.tsx"),
    source("features/markdown/MarkdownKatexStyles.tsx"), source("app/layout.tsx"),
    source("features/reader/PostPageView.tsx"), source("features/reader/ModalPostReader.tsx"), source("app/AdminPreviewBridge.tsx"),
    source("package.json"),
  ]);
  assert.match(renderer, /remarkMath/);
  assert.match(renderer, /remarkDirective/);
  assert.match(renderer, /rehypeRaw/);
  assert.match(renderer, /rehypeSanitize/);
  assert.match(renderer, /rehypeKatex/);
  assert.match(renderer, /hasMath/);
  assert.match(renderer, /<MarkdownKatexStyles\s*\/>/);
  assert.match(katexStyles, /katex\/dist\/katex\.min\.css/);
  assert.doesNotMatch(rootLayout, /katex\/dist\/katex\.min\.css/);
  assert.match(renderer, /MarkdownMermaid/);
  assert.match(renderer, /memo\(function MarkdownRenderer/);
  assert.match(mermaid, /import\("mermaid"\)/);
  assert.doesNotMatch(mermaid, /cdn\.jsdelivr/);
  assert.match(mermaid, /mermaidAppearance/);
  assert.match(mermaid, /showModal\(\)/);
  assert.match(mermaid, /拖动或 Shift \+ 滚轮查看全图/);
  assert.match(mermaid, /setPointerCapture/);
  assert.match(mermaid, /passive: false/);
  assert.match(mermaid, /container\.scrollLeft/);
  assert.match(post, /MarkdownRenderer/);
  assert.match(modal, /MarkdownRenderer/);
  assert.match(bridge, /MarkdownRenderer/);
  assert.match(packageJson, /"deploy:production": "npm run build && wrangler deploy --config wrangler\.production\.jsonc"/);
});

test("admin and markdown editor share the site theme palette", async () => {
  const [publicStyles,adminStyles,editor,toggle,mermaidTheme]=await Promise.all([
    source("app/globals.css"),source("app/admin/admin.css"),source("features/admin/VditorEditor.tsx"),source("features/navigation/ThemeToggle.tsx"),source("features/markdown/mermaid-theme.ts"),
  ]);
  const styles=`${publicStyles}\n${adminStyles}`;
  assert.match(styles,/--admin-canvas:/);
  assert.match(styles,/--admin-panel:/);
  assert.match(styles,/\.vditor-host\.vditor\{/);
  assert.match(styles,/--panel-background-color:var\(--admin-panel\)/);
  assert.match(styles,/The admin navigation belongs to the active appearance/);
  assert.match(styles,/html\[data-theme="dark"\] \.admin-sidebar/);
  assert.match(adminStyles,/\.editor-backdrop \{ position:fixed; z-index:110/);
  assert.match(adminStyles,/\.editor-panel\{height:100dvh\}/);
  assert.match(publicStyles,/\.reader-layout,\.reader-layout \.reader-panel\{height:100dvh;min-height:100dvh\}/);
  assert.match(publicStyles,/\.island-search-results\{max-height:min\(430px,calc\(100dvh - 84px\)\)\}/);
  assert.match(editor,/vditor--dark/);
  assert.match(editor,/MutationObserver/);
  assert.match(editor,/vditorMermaidScript/);
  assert.match(editor,/mermaidAppearance/);
  assert.match(mermaidTheme,/clusterBkg/);
  assert.match(mermaidTheme,/clusterBorder/);
  assert.match(mermaidTheme,/wrappingWidth: 220/);
  assert.match(publicStyles,/\.mermaid-dialog-canvas/);
  assert.match(toggle,/xingyu:theme-change/);
});

test("CSP ships report-only with a strict draft and a bounded violation endpoint", async () => {
  const [csp, worker, wranglerConfig] = await Promise.all([
    source("domain/security/csp.ts"), source("worker/index.ts"),
    source("wrangler.production.jsonc"),
  ]);
  assert.match(csp,/default-src 'self'/);
  assert.match(csp,/script-src 'self'/);
  assert.match(csp,/object-src 'none'/);
  assert.match(csp,/frame-ancestors 'self'/);
  assert.match(csp,/Content-Security-Policy-Report-Only/);
  assert.match(csp,/report-uri/);
  const policyBody = csp.slice(csp.indexOf("CSP_POLICY"));
  assert.doesNotMatch(policyBody,/unsafe-eval/);
  assert.match(policyBody,/style-src 'self' 'unsafe-inline'/);
  assert.match(worker,/applyCsp/);
  assert.match(worker,/CSP_REPORT_PATH/);
  assert.match(worker,/csp_violation/);
  assert.match(wranglerConfig,/"CSP_MODE": "report-only"/);
});

test("unbound attachments expire into the admin queue via cron and are never auto-deleted", async () => {
  const [cleanup, worker, wranglerConfig, postWrite, oneZeroOneFour] = await Promise.all([
    source("db/attachment-cleanup.ts"), source("worker/index.ts"),
    source("wrangler.production.jsonc"), source("db/post-write.ts"),
    source("drizzle/0014_hot_the_stranger.sql"),
  ]);
  assert.match(cleanup,/UNBOUND_ATTACHMENT_RETENTION_DAYS = 30/);
  assert.match(cleanup,/expired_unbound/);
  assert.match(cleanup,/ON CONFLICT\(object_key\) DO UPDATE/);
  assert.match(cleanup,/datetime\('now', '-' \|\| \? \|\| ' days'\)/);
  assert.match(worker,/enqueueExpiredUnboundAttachments/);
  assert.match(worker,/async scheduled/);
  assert.match(wranglerConfig,/"crons": \["17 3 \* \* \*"\]/);
  assert.match(postWrite,/unbound_at = CURRENT_TIMESTAMP/);
  assert.match(oneZeroOneFour,/ALTER TABLE `attachments` ADD `unbound_at` text/);
  assert.match(oneZeroOneFour,/UPDATE `attachments`/);
});

test("knowledge spaces are durable, arbitrarily nested and isolated from the public blog", async () => {
  const [
    schema, bootstrap, migration, queries, spaces, postInput, postWrite,
    admin, articleEditor, sidebar, spacePanel, spacePicker, postsRoute, postRoute, viewsRoute, viewTracking,
  ] = await Promise.all([
    source("db/schema.ts"), source("db/bootstrap.ts"), generatedMigration(),
    source("db/queries.ts"), source("db/spaces.ts"), source("domain/posts/post-input.ts"),
    source("db/post-write.ts"), source("features/admin/AdminClient.tsx"), source("features/admin/AdminArticleEditor.tsx"),
    source("features/admin/AdminSidebar.tsx"),
    source("features/admin/AdminSpacesPanel.tsx"), source("features/admin/AdminSpacePicker.tsx"),
    source("app/api/posts/route.ts"), source("app/api/posts/[id]/route.ts"),
    source("app/api/views/[slug]/route.ts"), source("db/view-tracking.ts"),
  ]);
  assert.match(schema,/spaces = sqliteTable\("spaces"/);
  assert.match(schema,/parentId: integer\("parent_id"\)/);
  assert.match(schema,/spaceId: integer\("space_id"\)/);
  assert.match(bootstrap,/schemaVersion = "19"/);
  assert.match(bootstrap,/CREATE TABLE IF NOT EXISTS spaces/);
  assert.match(bootstrap,/ALTER TABLE posts ADD COLUMN space_id/);
  assert.match(migration,/CREATE TABLE `spaces`/);
  assert.match(migration,/spaces_root_slug_uidx/);
  assert.match(migration,/ALTER TABLE `posts` ADD `space_id`/);
  assert.match(spaces,/WITH RECURSIVE ancestors/);
  assert.match(spaces,/WITH RECURSIVE descendants/);
  assert.match(spaces,/空间不能移动到自己的下级空间/);
  assert.match(spaces,/空间文章不能移动到知识空间根层/);
  assert.match(spaces,/nextCursor/);
  assert.match(postInput,/spaceId/);
  assert.match(postInput,/spaceId===null&&Boolean\(payload\.featured\)/);
  assert.match(postWrite,/validateSpace/);
  assert.match(queries,/eq\(posts\.status, "published"\),isNull\(posts\.spaceId\)/);
  assert.match(queries,/p\.space_id IS NULL/);
  assert.match(postsRoute,/scope === "all" \? "all" : scope === "private" \? "private" : "public"/);
  assert.match(postRoute,/hasOwnProperty\.call\(payload,"spaceId"\)\?payload\.spaceId:current\.spaceId/);
  assert.match(viewTracking,/space_id IS NULL/);
  assert.match(viewsRoute,/trackPostView/);
  assert.match(sidebar,/文章[\s\S]*知识空间[\s\S]*接入/);
  assert.match(articleEditor,/私有知识文章 · 仅管理员与 MCP 可检索/);
  assert.match(admin,/确认移出知识空间吗/);
  assert.match(spacePanel,/顶级空间彼此独立/);
  assert.match(spacePanel,/useState<"current"\|"descendants"\|"all">\("descendants"\)/);
  assert.match(spacePanel,/space-article-group/);
  assert.match(spacePanel,/仅当前空间/);
  assert.match(spacePanel,/包含子空间/);
  assert.match(spacePanel,/继续加载/);
  assert.match(spacePanel,/space-tree-mobile-backdrop/);
  assert.match(spacePicker,/SpacePickerNode/);
});

test("knowledge-space APIs and MCP expose scoped search with auditable writes", async () => {
  const [spacesApi, spaceApi, postsApi, mcp, activity] = await Promise.all([
    source("app/api/spaces/route.ts"), source("app/api/spaces/[id]/route.ts"),
    source("app/api/spaces/[id]/posts/route.ts"), mcpSource(),
    source("db/mcp-activity.ts"),
  ]);
  assert.match(spacesApi,/isAdminRequest/);
  assert.match(spaceApi,/isAdminRequest/);
  assert.match(postsApi,/isAdminRequest/);
  for (const tool of ["list_spaces","get_space","create_space","update_space","move_space","delete_space"]) {
    assert.ok(mcp.includes(`server.registerTool("${tool}"`),`missing MCP tool ${tool}`);
  }
  assert.match(mcp,/include_descendants/);
  assert.match(mcp,/visibility: ?post\.spaceId ?\? ?"space" ?: ?"public"/);
  assert.match(mcp,/public_url: post\.status === "published" ?&& ?!post\.spaceId/);
  assert.match(activity,/prepareSpaceWriteActivity/);
  assert.match(mcp,/activityReceipt\("create_space"/);
  assert.match(mcp,/activityReceipt\("move_space"/);
  assert.match(mcp,/activityReceipt\("delete_space"/);
  assert.match(activity,/changes\(\) >= 1/);
  assert.match(activity,/row\.publicId\.startsWith\("space:"\)/);
});

test("admin global search covers every article through the shared authenticated reader", async () => {
  const [admin, search, postsApi, modalLink, modalReader, browse, homeExperience, readerApi, readerPage, postView] = await Promise.all([
    source("features/admin/AdminClient.tsx"),
    source("features/admin/AdminArticleSearch.tsx"),
    source("app/api/posts/route.ts"),
    source("features/reader/ModalPostLink.tsx"),
    source("features/reader/ModalPostReader.tsx"),
    source("features/admin/AdminBrowsePanel.tsx"),
    source("features/home/BlogHomeExperience.tsx"),
    source("app/api/reader/[slug]/route.ts"),
    source("app/admin/reader/[publicId]/page.tsx"),
    source("features/reader/PostPageView.tsx"),
  ]);
  assert.match(search,/scope:"all"/);
  assert.match(search,/metaKey\|\|event\.ctrlKey/);
  assert.match(search,/ArrowDown/);
  assert.match(search,/ArrowUp/);
  assert.match(search,/onBrowse\(postId\)/);
  assert.match(postsApi,/scope === "all" \? "all"/);
  assert.match(admin,/xingyu:admin-reader-open/);
  assert.match(admin,/controllerOnly readerScope="admin"/);
  assert.match(admin,/disabled=\{Boolean\(form\|\|studio\)\}/);
  assert.doesNotMatch(admin,/setForm\(data\.post\);setStudio\("reading"\)/);
  assert.match(browse,/<BlogHomeExperience/);
  assert.match(homeExperience,/readerScope=\{admin\?"admin":"public"\}/);
  assert.match(modalReader,/adminReaderSearchParams\(activeAdminReaderContext\)/);
  assert.match(modalReader,/adminReaderHref\(post\.publicId,activeAdminReaderContext\)/);
  assert.match(modalReader,/setActiveAdminReaderContext\(DEFAULT_ADMIN_READER_CONTEXT\)/);
  assert.match(modalReader,/onEdit\(post\.id,\{publicId:post\.publicId,adminReaderContext:activeAdminReaderContext\}\)/);
  assert.match(modalLink,/xingyu:admin-reader-open/);
  assert.match(modalReader,/管理阅读/);
  assert.match(modalReader,/独立阅读/);
  assert.match(modalReader,/event\.key\.toLocaleLowerCase\(\) === "e"/);
  assert.match(readerApi,/isAdminRequest/);
  assert.match(readerApi,/getAdminReaderPost/);
  assert.match(readerApi,/parseAdminReaderContext/);
  assert.match(readerApi,/getPreviousAdminPost\([^;]+readerContext\)/);
  assert.match(readerApi,/getNextAdminPost\([^;]+readerContext\)/);
  assert.match(readerPage,/getAdminIdentity/);
  assert.match(readerPage,/readerScope="admin"/);
  assert.match(postView,/getPreviousAdminPost/);
  assert.match(postView,/getNextAdminPost/);
  assert.match(admin,/readerReturnRef/);
  assert.match(admin,/if\(returnTarget\)openAdminReader\(returnTarget\)/);
  assert.match(admin,/window\.scrollTo\(0,0\)/);
  assert.match(admin,/addEventListener\("popstate",restoreLocation\)/);
  assert.match(admin,/adminLocationHref\(next\)/);
});

test("attachments inherit article visibility and are available to editors and MCP", async () => {
  const [schema, bootstrap, attachments, attachmentCache, uploadRoute, manageRoute, downloadRoute, mediaRoute, renderer, editor, mcp, wrangler] = await Promise.all([
    source("db/schema.ts"),
    source("db/bootstrap.ts"),
    source("db/attachments.ts"),
    source("domain/attachments/http-cache.ts"),
    source("app/api/attachments/route.ts"),
    source("app/api/attachments/[publicId]/route.ts"),
    source("app/api/attachments/[publicId]/[...name]/route.ts"),
    source("app/api/media/[...key]/route.ts"),
    source("features/markdown/MarkdownRenderer.tsx"),
    source("features/admin/VditorEditor.tsx"),
    mcpSource(),
    source("wrangler.production.jsonc"),
  ]);
  assert.match(schema, /attachments = sqliteTable\("attachments"/);
  assert.match(bootstrap, /CREATE TABLE IF NOT EXISTS attachments/);
  assert.match(attachments, /prepareMarkdownAttachmentBinding/);
  assert.match(attachments, /deleteAttachment/);
  assert.match(attachments, /version = version \+ 1/);
  assert.match(editor, /onPostVersionChange\?\.\(payload\.version\)/);
  assert.match(attachments, /MAX_ATTACHMENT_BYTES = 25 \* 1024 \* 1024/);
  assert.match(uploadRoute, /isAdminRequest/);
  assert.match(uploadRoute, /export async function GET/);
  assert.match(manageRoute, /export async function DELETE/);
  assert.match(downloadRoute, /postStatus === "published" && attachment\.postSpaceId === null/);
  assert.match(downloadRoute, /env\.IMAGES/);
  assert.match(attachmentCache, /private, no-store/);
  assert.match(attachmentCache, /public, max-age=0, must-revalidate/);
  assert.match(downloadRoute, /attachmentEtagMatches\(request\.headers\.get\("If-None-Match"\)/);
  assert.doesNotMatch(`${attachmentCache}\n${downloadRoute}`, /s-maxage=60/);
  assert.match(mediaRoute, /output\(\{ format: "image\/webp", quality: 82 \}\)/);
  assert.match(renderer, /srcSet/);
  assert.match(renderer, /responsiveImageWidths/);
  assert.match(wrangler, /"r2_buckets"[\s\S]*"binding"\s*:\s*"MEDIA"[\s\S]*"bucket_name"\s*:\s*"xingyu-production-media"/);
  assert.match(wrangler, /"images"\s*:\s*\{\s*"binding"\s*:\s*"IMAGES"/);
  assert.match(wrangler, /"cache"\s*:\s*\{\s*"enabled"\s*:\s*true/);
  assert.match(renderer, /md-attachment-card/);
  assert.match(editor, /attachment-manager/);
  assert.match(editor, /role=\{notice\.kind==="error"\?"alert":"status"\}/);
  assert.match(editor, /uploadErrorDetail/);
  for (const tool of ["upload_attachment", "list_attachments", "download_attachment"]) {
    assert.ok(mcp.includes(`server.registerTool("${tool}"`), `missing MCP attachment tool ${tool}`);
  }
});

test("private article preview links are scoped, expiring, revocable and never publicly cached", async () => {
  const [schema, bootstrap, tokens, api, page, postView, renderer, attachmentRoute, admin, articles, spaces, worker] = await Promise.all([
    source("db/schema.ts"),
    source("db/bootstrap.ts"),
    source("db/post-preview-tokens.ts"),
    source("app/api/posts/[id]/preview-links/route.ts"),
    source("app/preview/[token]/page.tsx"),
    source("features/reader/PostPageView.tsx"),
    source("features/markdown/MarkdownRenderer.tsx"),
    source("app/api/attachments/[publicId]/[...name]/route.ts"),
    source("features/admin/AdminClient.tsx"),
    source("features/admin/AdminArticlesPanel.tsx"),
    source("features/admin/AdminSpacesPanel.tsx"),
    source("worker/index.ts"),
  ]);
  assert.match(schema,/postPreviewTokens = sqliteTable\("post_preview_tokens"/);
  assert.match(bootstrap,/CREATE TABLE IF NOT EXISTS post_preview_tokens/);
  assert.match(tokens,/crypto\.subtle\.digest\("SHA-256"/);
  assert.match(tokens,/revoked_at IS NULL AND t\.expires_at > \?/);
  assert.doesNotMatch(schema,/token: text\("token"\)/);
  assert.doesNotMatch(tokens,/\(post_id, token, expires_at\)/);
  assert.match(api,/isAdminRequest/);
  assert.match(api,/ALLOWED_LIFETIMES/);
  assert.match(page,/robots: \{ index: false/);
  assert.match(page,/readerScope="preview"/);
  assert.match(postView,/仅当前文章/);
  assert.match(postView,/!sharedPreview&&<PostSideNavigation/);
  assert.match(renderer,/previewAuthorizedUrl/);
  assert.match(attachmentRoute,/previewTokenCanReadPost/);
  assert.match(admin,/AdminPreviewShareDialog/);
  assert.match(articles,/分享预览/);
  assert.match(spaces,/onShareArticle/);
  assert.match(worker,/pathname\.startsWith\("\/preview"\)/);
  assert.match(worker,/headers\.set\("Cache-Control",\s*"no-store"\)/);
});

test("admin diagnostics endpoint and cron health gate cover the core-relations audit", async () => {
  const [health, diagnosticsRoute, workerEntry, bootstrap] = await Promise.all([
    source("db/health.ts"),
    source("app/api/admin/diagnostics/route.ts"),
    source("worker/index.ts"),
    source("db/bootstrap.ts"),
  ]);
  assert.match(bootstrap,/export const schemaVersion = "19"/);
  assert.match(health,/export async function collectSiteHealth/);
  for (const key of [
    "posts_missing_category", "posts_missing_space", "spaces_missing_parent",
    "spaces_unreachable_from_root", "history_missing_post", "history_conflicts_current_slug",
    "attachments_missing_post", "preview_tokens_missing_post", "views_missing_post",
    "codes_missing_oauth_client", "access_tokens_missing_oauth_client", "refresh_tokens_missing_oauth_client",
    "consents_missing_oauth_client", "posts_missing_author", "identities_missing_user",
    "memberships_missing_user",
  ]) {
    assert.match(health, new RegExp(`"${key}"`), `missing health audit key ${key}`);
  }
  assert.match(health,/d1_migrations/);
  assert.match(health,/attachment_cleanup_queue WHERE status = 'pending'/);
  assert.match(health,/site_memberships WHERE role = 'owner'/);
  assert.match(diagnosticsRoute,/isAdminRequest/);
  assert.match(diagnosticsRoute,/ensureDatabase\(\)/);
  assert.match(diagnosticsRoute,/collectSiteHealth\(env\.DB, schemaVersion\)/);
  assert.match(workerEntry,/import \{ schemaVersion \} from "@\/db\/bootstrap"/);
  assert.match(workerEntry,/site_health_anomaly/);
  assert.match(workerEntry,/site_health_check_failed/);
});

test("P2 consistency cleanup: services merged, auth relocated, imports aliased, prototypes removed", async () => {
  const [categoriesRoute, settingsRoute, postsRoute, adminPage, queries, postWrite, categories, siteContent, adminAuth, workerEntry, diagnosticsRoute, blogHome] = await Promise.all([
    source("app/api/categories/route.ts"), source("app/api/settings/route.ts"),
    source("app/api/posts/[id]/route.ts"), source("app/admin/page.tsx"),
    source("db/queries.ts"), source("db/post-write.ts"),
    source("db/categories.ts"), source("db/site-content.ts"),
    source("server/auth/admin-auth.ts"), source("worker/index.ts"),
    source("app/api/admin/diagnostics/route.ts"), source("features/home/BlogHomeExperience.tsx"),
  ]);
  // C1: server/services 半吊子分层的逻辑并入对应 db 模块
  assert.match(categoriesRoute, /from "@\/db\/categories"/);
  assert.match(settingsRoute, /from "@\/db\/site-content"/);
  assert.match(postsRoute, /from "@\/db\/queries"/);
  assert.match(postsRoute, /from "@\/db\/post-write"/);
  assert.match(queries, /export async function getAdminPost/);
  assert.match(postWrite, /export async function deleteAdminPost/);
  assert.match(categories, /CategoryServiceError/);
  assert.match(siteContent, /upsertContentPage/);
  assert.doesNotMatch(
    [categoriesRoute, settingsRoute, postsRoute, adminPage, queries, postWrite, categories, siteContent].join("\n"),
    /server\/services/,
    "no application module may reference the removed server/services layer",
  );
  // C2: 共享鉴权库迁至 server/auth，跨边界导入统一走 @/ alias
  assert.match(adminAuth, /from "@\/db\/bootstrap"/);
  assert.match(adminAuth, /from "@\/db\/admin-session"/);
  assert.match(postsRoute, /from "@\/server\/auth\/admin-auth"/);
  assert.match(diagnosticsRoute, /from "@\/server\/auth\/admin-auth"/);
  assert.match(workerEntry, /from "@\/db\/(bootstrap|health|attachment-cleanup|view-tracking)"/);
  assert.doesNotMatch(blogHome, /from "@\/features\//, "feature modules must import siblings via relative paths");
  // C3: 根目录静态原型与 services 目录不复存在
  const missingFile = async (relative) => {
    try { await stat(new URL(relative, import.meta.url)); return false; }
    catch (error) { if (error?.code === "ENOENT") return true; throw error; }
  };
  assert.ok(await missingFile("../../index.html"), "root prototype index.html must be removed");
  assert.ok(await missingFile("../../article.html"), "root prototype article.html must be removed");
  assert.ok(await missingFile("../server/services/categories.ts"), "server/services directory must be removed");
});
