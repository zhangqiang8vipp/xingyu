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
  assert.match(read("features/admin/AccountStyleLoader.tsx"),/import "@\/app\/admin\/admin\.css"/);
  assert.match(admin,/import "@\/app\/admin\/admin\.css"/);
  assert.match(frame,/<AdminSidebar/);
  assert.match(frame,/<main className=\{\`admin-shell admin-account-shell/);
  assert.match(frame,/className="admin-main admin-config-main admin-account-main"/);
  assert.match(side,/<ThemeToggle \/>/);
  assert.match(side,/accountArea/);
  assert.match(side,/ACCOUNT_LINKS/);
  assert.match(side,/aria-current=\{accountArea===item\.area\?"page":undefined\}/);
  const wp=read("app/workspace/page.tsx"), org=read("app/organizations/page.tsx");
  assert.match(wp,/<AdminAccountFrame area="workspace"/);
  assert.match(org,/<AdminAccountFrame area="organizations"/);
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
  assert.match(read("features/admin/AccountStyleLoader.tsx"),/import "\.\/account-ui-adapter\.css"/);
  for(const page of ["app/workspace/page.tsx","app/organizations/page.tsx"])
    assert.match(read(page),/<AccountStyleLoader\/>/,page);
  assert.doesNotMatch(css,/--xy-(?:accent|background|text)/,
    "never add a second palette to original authoring CSS");
});
test("all account and invitation routes reuse original admin-signin and ThemeToggle",()=>{
  const panel=read("features/admin/IdentityAdminPanel.tsx");
  assert.match(read("features/admin/ExistingLoginStyleLoader.tsx"),/import "@\/app\/admin\/login\/login\.css"/);
  assert.match(panel,/<ExistingLoginStyleLoader\/>/);
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
  assert.match(read("app/workspace/page.tsx"),/listUserWorkspaces\(user\.userId\)/);
  assert.match(read("app/organizations/page.tsx"),/listMyOrganizations\(user\.userId\)/);
});
