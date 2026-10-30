import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("AXIS evolution keeps the existing search, sidebar and mobile floating islands", () => {
  const sidebar = read("features/admin/AdminSidebar.tsx");
  const client = read("features/admin/AdminClient.tsx");
  const css = read("app/admin/admin.css");
  assert.match(client, /<AdminArticleSearch/);
  assert.match(sidebar, /<AxisMark/);
  assert.match(sidebar, /className="admin-sidebar"/);
  assert.match(sidebar, /className="admin-more"/);
  assert.match(sidebar, /className="admin-dock"/);
  assert.equal((sidebar.match(/dock: true/g) ?? []).length, 3, "exactly three top-level dock actions plus More");
  assert.match(css, /Mobile AXIS, Phase B:/, "do not remove the original mobile AXIS implementation");
  assert.match(css, /\.admin-more \.admin-dock\{width:min\(480px,100%\);height:66px/);
  assert.match(css, /\.admin-sidebar\{position:fixed;z-index:80;top:calc\(8px \+ env\(safe-area-inset-top\)\)/);
});

test("global search supports accessible scope switching and one permission-scoped list", () => {
  const src = read("features/admin/AdminArticleSearch.tsx");
  assert.match(src, /event\.key\.toLowerCase\(\)==="k"/);
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(src, /aria-pressed=\{scope===key\}/);
  assert.match(src, /setRetryKey/);
  assert.match(src, /requestAnimationFrame\(\(\)=>triggerRef\.current\?\.focus\(\)\)/);
  assert.match(src, /\/api\/knowledge\/posts\?/);
  assert.match(src, /type=scope==="public"\?"public":scope==="private"\?"mine":"all"/);
  assert.doesNotMatch(src, /mineResponse, publicResponse/, "search must not merge two 50-item result lists");
});

test("writing modes use the same real preview and protect unsaved drafts", () => {
  const client = read("features/admin/AdminClient.tsx");
  const editor = read("features/admin/AdminArticleEditor.tsx");
  const studio = read("features/admin/ArticleWritingStudio.tsx");
  assert.match(client, /editorSnapshot/);
  assert.match(client, /editorBaseline/);
  assert.match(client, /editorDirty&&!window\.confirm/);
  assert.match(client, /addEventListener\("beforeunload"/);
  assert.match(client, /saveInFlightRef\.current/);
  assert.match(client, /网络异常，修改仍保留在编辑器里/);
  for (const mode of ["code", "split", "reading"])
    assert.ok(editor.includes('onOpenStudio("' + mode + '")'), "editor one-click mode " + mode);
  assert.match(client, /dirty=\{editorDirty\}/);
  assert.match(editor, /aria-busy=\{saving\}/);
  assert.match(studio, /<ArticleFrontstage/);
  assert.match(studio, /aria-pressed=\{mode==="reading"\}/);
  assert.match(studio, /返回编辑/);
});

test("knowledge cards are keyboard reachable without relaxing permissions", () => {
  const spaces = read("features/admin/AdminSpacesPanel.tsx");
  assert.match(spaces, /enterSpaceWithKeyboard/);
  assert.match(spaces, /event\.target!==event\.currentTarget/);
  assert.match(spaces, /aria-current=\{currentId===node\.id\?"page":undefined\}/);
  assert.match(spaces, /<AdminSpaceCollaborationDialog/);
  assert.match(spaces, /<AdminSpaceCoauthorDialog/);
  assert.match(spaces, /mayDelete\?<button/, "only existing authorized users can delete");
  assert.match(spaces, /onClick=\{event=>event\.stopPropagation\(\)\}/);
});

test("ergonomic CSS extends existing product tokens, never adds another UI theme", () => {
  const css = read("app/admin/axis-evolution.css");
  const admin = read("features/admin/AdminClient.tsx");
  const stage = read("scripts/stage-account-styles.mjs");
  const browse = read("features/admin/AdminBrowsePanel.tsx");
  assert.match(css, /var\(--admin-/);
  assert.doesNotMatch(css, /--xy-(?:accent|background|text)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.axis-search-scopes/);
  assert.match(css, /\.axis-writing-view-modes/);
  assert.match(admin, /import "@\/app\/admin\/admin\.css"/);
  assert.match(admin, /import "@\/app\/admin\/axis-evolution\.css"/);
  assert.match(stage, /app\/admin\/axis-evolution\.css/);
  assert.match(browse, /<BlogHomeExperience/);
  assert.match(browse, /<details className="admin-runtime-summary axis-runtime-disclosure"/);
});


test("AI launcher is one movable XINGYU AXIS logo, never a text CTA or dock item",()=>{
  const parent=read("features/ask/GlobalAskAssistant.tsx");
  const bubble=read("features/ask/DraggableAxisLauncher.tsx");
  const globalStyle=read("app/globals.css");
  const panelStyle=read("public/assistant.css");
  const layout=read("app/layout.tsx");
  assert.match(layout, /<GlobalAskAssistant/);
  assert.match(parent, /<DraggableAxisLauncher/);
  assert.doesNotMatch(parent, /询问 AI|xy-ai-launcher-spark/);
  assert.match(bubble, /<AxisMark className="xy-ai-launcher-mark"/);
  assert.match(bubble, /onPointerDown=\{onPointerDown\}/);
  assert.match(bubble, /onPointerMove=\{onPointerMove\}/);
  assert.match(bubble, /onPointerUp=\{endDrag\}/);
  assert.match(bubble, /onPointerCancel=\{cancelDrag\}/);
  assert.match(bubble, /onLostPointerCapture=\{cancelDrag\}/);
  assert.doesNotMatch(bubble, /window\.setTimeout\(\(\) => \{ ignoreClickRef/);
  assert.match(bubble, /event\.detail !== 0 && ignoreClickRef\.current/);
  assert.match(bubble, /window\.localStorage\.setItem/);
  assert.match(bubble, /setPointerCapture/);
  assert.match(bubble, /getBounds/);
  assert.match(bubble, /getBoundingClientRect\(\)\.top - SIZE - 12/);
  assert.match(globalStyle, /\.xy-ai-launcher \.axis-mark/);
  assert.match(globalStyle, /touch-action:none/);
  assert.match(globalStyle, /body:has\(\.admin-shell\) \.xy-ai-launcher/);
  assert.match(globalStyle, /\.xy-ai-launcher\[hidden\]\{display:none\}/);
  assert.match(parent, /keepTabInside/);
  assert.match(parent, /keepFocusInside/);
  assert.match(panelStyle, /\.xy-ai-form textarea\{font-size:16px/);
  assert.doesNotMatch(panelStyle, /\.xy-ai-launcher-spark/);
});


test("all nine backstage sections share existing AXIS patterns without replacing floating islands",()=>{
  const admin=read("features/admin/AdminClient.tsx");
  const sidebar=read("features/admin/AdminSidebar.tsx");
  const css=read("app/admin/axis-evolution.css");
  const visual=read("scripts/visual-backstage-acceptance.mjs");
  for(const name of ["browse","articles","spaces","files","home","about","connect","categories","integrations"]){
    assert.match(visual,new RegExp('\\["'+name+'",'),name+" must be reviewed in real Chromium");
  }
  for(const mode of ["desktop","tablet","phone","phone-dark"])
    assert.ok(visual.includes('id:"'+mode+'"'),"must include "+mode+" viewport");
  assert.match(admin,/<AdminArticleSearch/);
  assert.match(admin,/data-axis-section=\{section\}/);
  assert.match(sidebar,/className="admin-dock"/);
  assert.match(css,/\.admin-shell \.admin-main:not\(\.admin-public-browser\)/);
  assert.match(css,/--admin-/);
  assert.doesNotMatch(css,/\.admin-dock\s*\{\s*display:none/);
});

test("config screens preserve unsaved content and never block the writing surface with sticky save",()=>{
  const hook=read("features/admin/useUnsavedAdminForm.ts");
  const client=read("features/admin/AdminClient.tsx");
  const settings=read("features/admin/AdminSettingsPanel.tsx");
  const page=read("features/admin/AdminPageEditor.tsx");
  const categories=read("features/admin/AdminCategoriesPanel.tsx");
  const ai=read("features/admin/AdminAskModelPanel.tsx");
  const css=read("app/admin/axis-evolution.css");
  assert.match(hook,/addEventListener\("beforeunload"/);
  assert.match(hook,/xingyu:admin-before-section-change/);
  assert.match(client,/dispatchEvent\(new Event\("xingyu:admin-before-section-change"/);
  for(const component of [settings,page,categories,ai]){
    assert.match(component,/useUnsavedAdminForm\(dirty\)/);
  }
  for(const component of [settings,page]){
    assert.match(component,/axis-config-quick-save/);
    assert.match(component,/requestSubmit\(\)/);
    assert.match(component,/data-axis-save-state/);
    assert.match(component,/setSaved\(/);
  }
  assert.match(css,/\.admin-shell \.admin-config-main \.config-footer\s*\{\s*position:static;/);
  assert.match(css,/\.axis-config-quick-save/);
  assert.match(read("scripts/visual-backstage-acceptance.mjs"),/save footer must not cover form content/);
});

test("list surfaces offer reversible, contextual operations without inventing more dashboards",()=>{
  const articles=read("features/admin/AdminArticlesPanel.tsx");
  const client=read("features/admin/AdminClient.tsx");
  const files=read("features/admin/AdminFilesPanel.tsx");
  const categories=read("features/admin/AdminCategoriesPanel.tsx");
  assert.match(articles,/onResetFilters/);
  assert.match(client,/function resetArticleFilters/);
  assert.match(client,/currentLocation\(\{query:"",category:"all",status:"all"\}\)/);
  assert.match(articles,/axis-filter-clear/);
  assert.match(files,/axis-file-utilities/);
  assert.match(files,/清除搜索/);
  assert.match(files,/setRevision/);
  assert.match(categories,/axis-category-create/);
  assert.match(categories,/撤销更改/);
  assert.doesNotMatch(categories,/prompt\(/);
  assert.match(categories,/网络异常/);
});


test("global search is the original fixed AXIS island, never a sticky toolbar or collapsed grid",()=>{
  const client=read("features/admin/AdminClient.tsx");
  const css=read("app/admin/axis-evolution.css");
  const visual=read("scripts/visual-backstage-acceptance.mjs");
  assert.match(client, /className="admin-search-island"/);
  assert.doesNotMatch(client, /className="admin-workspace-bar"/);
  assert.match(css, /grid-template-rows:50px auto 27px minmax\(0,1fr\) 38px/);
  assert.match(css, /\.admin-article-search-results\s*\{\s*min-height:0/);
  assert.match(visual, /axis-search-open-/);
  assert.match(visual, /async function verifyFloatingSearch/);
});
