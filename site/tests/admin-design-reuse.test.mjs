import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync,existsSync} from "node:fs";
const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("withdrawn console redesign is removed, without loading public page CSS",()=>{
  for(const file of [
    "app/console/ConsoleShell.tsx","app/console/AuthShell.tsx",
    "app/console/ConsoleStyleLoader.tsx","app/console/console.css",
    "tests/console-design-contracts.test.mjs",
  ])assert.equal(existsSync(new URL("../"+file,import.meta.url)),false,file);
  const layout=read("app/layout.tsx");
  assert.doesNotMatch(layout,/admin\/admin\.css|console\/console\.css/);
});
test("account workspaces reuse the existing AdminSidebar instead of introducing another shell",()=>{
  const frame=read("features/admin/AdminAccountFrame.tsx");
  const side=read("features/admin/AdminSidebar.tsx");
  const admin=read("features/admin/AdminClient.tsx");
  assert.doesNotMatch(frame,/import "@\/app\/admin\/admin\.css"/);
  assert.match(read("features/admin/AccountStyleLoader.tsx"),/href="\/account-admin\.css"/);
  assert.match(read("scripts/stage-account-styles.mjs"),/app\/admin\/admin\.css/);
  assert.match(admin,/import "@\/app\/admin\/admin\.css"/);
  assert.match(frame,/<AdminSidebar/);
  assert.match(frame,/<main className=\{\`admin-shell admin-account-shell/);
  assert.match(frame,/className="admin-main admin-config-main admin-account-main"/);
  assert.match(side,/<ThemeToggle \/>/);
  assert.match(side,/accountArea/);
  assert.match(side,/ACCOUNT_LINKS/);
  assert.match(side,/aria-current=\{accountArea===item\.area\?"page":undefined\}/);
  const wp=read("app/workspace/page.tsx"), org=read("app/organizations/page.tsx");
  assert.match(wp,/redirect\("\/admin"\)/);
  assert.match(org,/redirect\("\/admin"\)/);
  assert.match(read("app/admin/page.tsx"),/AdminClient/);
  assert.match(read("app/admin/page.tsx"),/isPersonalAccount/);
  assert.doesNotMatch(read("app/admin/page.tsx"),/PersonalKnowledgeClient/);
  assert.match(frame,/api\/identity\/logout/);
});
test("collaboration forms and organization management use original admin cards and controls",()=>{
  for(const path of [
    "app/workspace/WorkspaceClient.tsx","app/workspace/CollaborationPanel.tsx",
    "app/workspace/ConnectionsPanel.tsx","app/organizations/OrganizationsClient.tsx",
    "app/organizations/TeamWorkspacePanel.tsx",
  ])assert.match(read(path),/className="editor-section/,path);
  assert.match(read("app/organizations/OrganizationsClient.tsx"),/className="integration-card"/);
  assert.match(read("app/organizations/TeamWorkspacePanel.tsx"),/className="integration-card"/);
  const css=read("features/admin/account-ui-adapter.css");
  assert.match(css,/\.admin-account-main/);
  assert.match(css,/--admin-panel/);
  assert.match(read("scripts/stage-account-styles.mjs"),/account-ui-adapter\.css/);
  for(const page of ["app/workspace/page.tsx","app/organizations/page.tsx"])
    assert.match(read(page),/redirect\("\/admin"\)/,page);
  assert.doesNotMatch(css,/--xy-(?:accent|background|text)/,
    "never add a second palette to original authoring CSS");
});
test("all account and invitation routes reuse original admin-signin and ThemeToggle",()=>{
  const panel=read("features/admin/IdentityAdminPanel.tsx");
  assert.match(read("features/admin/ExistingLoginStyleLoader.tsx"),/import "@\/app\/admin\/login\/login\.css"/);
  assert.match(panel,/<ExistingLoginStyleLoader\/>/);
  const legacyLogin=read("app/admin/login/page.tsx");
  assert.match(legacyLogin,/<ExistingLoginStyleLoader\/>/);
  assert.doesNotMatch(legacyLogin,/import "\.\/login\.css"/);
  assert.doesNotMatch(panel,/import "@\/app\/admin\/login\/login\.css"/);
  assert.match(panel,/<main className="signin admin-signin">/);
  assert.match(panel,/<ThemeToggle\/>/);
  assert.match(panel,/className="admin-login-form"/);
  for(const path of [
    "app/login/page.tsx","app/register/page.tsx",
    "app/forgot-password/page.tsx","app/reset-password/page.tsx",
    "app/verify-email/page.tsx","app/invite/page.tsx",
    "app/organization-invite/page.tsx",
  ])assert.match(read(path),/IdentityAdminPanel/,path);
});
test("existing identity redirects, invitation privacy and workspace authorization remain unchanged",()=>{
  const login=read("app/login/page.tsx");
  const invite=read("app/invite/page.tsx");
  const orgInvite=read("app/organization-invite/page.tsx");
  assert.match(login,/requested\.startsWith\("\/oauth\/authorize\?"\)/);
  assert.match(login,/!requested\.startsWith\("\/\/"\)/);
  for(const source of [invite,orgInvite]){
    assert.match(source,/robots:\{index:false,follow:false\}/);
    assert.match(source,/referrer:"no-referrer"/);
    assert.match(source,/redirect\("\/login\?return_to="/);
  }
  assert.match(read("app/workspace/page.tsx"),/redirect\("\/admin"\)/);
  assert.match(read("app/organizations/page.tsx"),/redirect\("\/admin"\)/);
  assert.match(read("app/admin/page.tsx"),/AdminClient/);
  assert.doesNotMatch(read("app/admin/page.tsx"),/PersonalKnowledgeClient/);
});


test("personal accounts use the same original admin console with only data and permissions scoped",()=>{
  const page=read("app/admin/page.tsx");
  const client=read("features/admin/AdminClient.tsx");
  const sidebar=read("features/admin/AdminSidebar.tsx");
  assert.match(page,/return <AdminClient/);
  assert.match(page,/isPersonalAccount/);
  assert.doesNotMatch(page,/PersonalKnowledgeClient/);
  assert.match(client,/import "@\/app\/admin\/admin\.css"/);
  for(const panel of ["AdminBrowsePanel","AdminArticlesPanel","AdminSpacesPanel","AdminFilesPanel","AdminSettingsPanel","AdminPageEditor","AdminCategoriesPanel","AdminIntegrationsPanel"])
    assert.ok(client.includes(panel),"the shared AdminClient must retain "+panel);
  assert.match(sidebar,/const visibleGroups = isPersonalAccount \? NAV_GROUPS\.filter\(\(group\) => group\.id !== "site"\) : NAV_GROUPS;/,"personal accounts use the original sidebar without site management");
  assert.match(client,/readOnly=\{isPersonalAccount\}/,"site-only controls are read-only for personal accounts");
  assert.match(client,/type: "all", limit: String\(CONTENT_LIMITS\.adminBatch\)/,
    "the personal console should request the server-side unified page");
  assert.match(client,/setNextCursor\(data\.nextCursor \?\? null\)/,
    "the browser must continue with the server's opaque cursor");
  assert.doesNotMatch(client,/mineResponse, publicResponse/,
    "do not concatenate and truncate two fixed-size lists in the browser");
});


test("knowledge-space invitations and AI coauthoring reuse product cards, menus, editors and theme",()=>{
  const sidebar=read("features/admin/AdminSidebar.tsx");
  const spaces=read("features/admin/AdminSpacesPanel.tsx");
  const manager=read("features/admin/AdminSpaceCollaborationDialog.tsx");
  const writer=read("features/admin/AdminSpaceCoauthorDialog.tsx");
  const oldRoute=read("app/collaboration/page.tsx");
  const css=read("app/admin/admin.css");
  assert.doesNotMatch(sidebar,/href="\/collaboration"/,"do not add a parallel collaboration tab");
  assert.match(oldRoute,/redirect\("\/admin\?section=spaces"/);
  assert.equal(existsSync(new URL("../app/collaboration/CollaborationClient.tsx",import.meta.url)),false);
  assert.match(spaces,/<SpaceActions space=\{space\}/);
  assert.match(spaces,/onCollaborate=\{setCollabTarget\}/);
  assert.match(spaces,/<AdminSpaceCollaborationDialog/);
  assert.match(spaces,/<AdminSpaceCoauthorDialog/);
  assert.match(manager,/className="space-dialog space-collab-dialog"/);
  assert.match(writer,/<VditorEditor/,"use the product's original Markdown editor");
  assert.match(css,/\.space-card-actions/);
  assert.match(css,/\.space-collab-dialog/);
  assert.match(css,/\.space-coauthor-dialog/);
  assert.match(css,/var\(--admin-panel\)/,"retain original dark/light theme tokens");
  assert.doesNotMatch(css,/--xy-(?:accent|background|text)/,
    "do not introduce a demo palette");
});

test("mobile AXIS admin chrome is one four-action island with safe account destinations",()=>{
  const side=read("features/admin/AdminSidebar.tsx");
  const style=read("app/admin/admin.css");
  assert.equal((side.match(/dock: true/g)||[]).length,3,
    "the dock has Browse, Articles, Spaces + More, never a fifth wrapped item");
  assert.match(side,/const MORE_SECTIONS = new Set<AdminSection>\(\["files",/);
  assert.match(side,/href:"\/admin\?section=spaces"/);
  assert.doesNotMatch(side,/href:"\/workspace"|href:"\/organizations"/,
    "account navigation must not advertise redirect-only pages");
  assert.match(side,/aria-label="手机快捷导航"/);
  assert.match(side,/return <><aside className="admin-sidebar">/);
  assert.match(side,/<\/aside>\s*<div className="admin-more"/,"dock must not be a descendant of the frosted header");
  assert.match(side,/aria-controls=\{moreOpen \? moreSheetId : undefined\}/);
  assert.match(side,/closeWithEscape/);
  assert.match(style,/\.admin-sidebar\{position:fixed;z-index:80;top:calc\(8px \+ env\(safe-area-inset-top\)\)/);
  assert.match(style,/\.admin-sidebar::before\{content:"";position:absolute;/);
  assert.match(style,/border-radius:18px;background:transparent;[^\n]*backdrop-filter:none;/,
    "the frosted visual must not trap the nested position:fixed dock");
  assert.match(style,/\.admin-more \.admin-dock\{width:min\(480px,100%\);height:66px/);
  assert.match(style,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(style,/\.admin-more \.admin-dock :is\(button,a\)::before/);
  assert.match(style,/\.admin-more-sheet\{width:min\(480px,100%\);max-height:/);
  assert.match(style,/\.admin-header span\{display:block/);
  assert.match(style,/\.admin-shell:has\(input:focus,textarea:focus/);
});


test("mobile spaces, editing and AI account navigation reuse one accessible AXIS system",()=>{
  const adminCss=read("app/admin/admin.css");
  const adapter=read("features/admin/account-ui-adapter.css");
  const spaces=read("features/admin/AdminSpacesPanel.tsx");
  const browser=read("scripts/visual-spaces-acceptance.mjs");
  assert.doesNotMatch(adapter,/\.admin-account-shell \.admin-dock\{grid-template-columns:repeat\(3/,
    "account adapter must not force four links into three columns");
  assert.doesNotMatch(adapter,/\.admin-account-shell \.admin-dock a\{/,
    "account links inherit shared mobile island hit targets and colors");
  assert.match(adapter,/font-size:16px!important/,"account inputs avoid mobile Safari focus zoom");
  assert.match(adminCss,/Mobile AXIS, Phase B:/);
  assert.match(adminCss,/\.space-domain-card h2\{margin:23px 0 7px;font-size:clamp\(21px/);
  assert.match(adminCss,/\.space-article-list article button\{height:auto;min-height:44px/);
  assert.match(adminCss,/\.space-scope button\{min-width:0;min-height:44px/);
  assert.match(adminCss,/\.space-card-actions>div\[role="menu"\]\{/);
  assert.match(adminCss,/\.space-card-actions>\.space-card-actions-dismiss\{/);
  assert.match(adminCss,/\.editor-panel \.editor-section :is\(input:not\(\[type="checkbox"\]\),select,textarea\)\{font-size:16px\}/);
  assert.match(adminCss,/\.writing-mode-switch button\{height:44px/);
  assert.match(spaces,/className="space-card-actions-dismiss"/);
  assert.match(spaces,/aria-haspopup="menu"/);
  assert.match(spaces,/const escape=\(event:KeyboardEvent\)/);
  assert.match(browser,/checkMobileProductSurfaces/);
  assert.match(browser,/MOBILE_ACCOUNT_LAYOUT/);
  assert.match(browser,/MOBILE_SPACE_SHEET/);
});
