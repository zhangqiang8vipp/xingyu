import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const css=read("app/console/console.css");
const layout=read("app/layout.tsx");

test("new account console styles are loaded and scoped away from public blog and legacy admin",()=>{
  assert.doesNotMatch(layout,/console\/console\.css/,
    "public root must not bundle console styles into index CSS");
  const loader=read("app/console/ConsoleStyleLoader.tsx");
  assert.match(loader,/"use client"/);
  assert.match(loader,/import "\.\/console\.css"/);
  assert.match(read("app/console/ConsoleShell.tsx"),/<ConsoleStyleLoader\/>/);
  assert.match(read("app/console/AuthShell.tsx"),/<ConsoleStyleLoader\/>/);
  assert.match(css,/\.xy-console/);
  assert.match(css,/\.xy-auth/);
  assert.match(css,/html\[data-theme="dark"\]/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/:focus-visible/);
  assert.doesNotMatch(css,/(?:^|\n)\s*(?:body|html|button|input|select|textarea)\s*\{/,
    "new styles must not change the global blog/admin appearance");
});
test("both workspace and organizations reuse the shared accessible console shell",()=>{
  const shell=read("app/console/ConsoleShell.tsx");
  assert.match(shell,/<nav .*aria-label="主要功能"/);
  assert.match(shell,/aria-current=\{entry\.area===area\?"page":undefined\}/);
  assert.match(shell,/<main id="xy-console-content"/);
  assert.match(read("app/workspace/page.tsx"),/<ConsoleShell area="workspace"/);
  assert.match(read("app/organizations/page.tsx"),/<ConsoleShell area="organizations"/);
});
test("user identity and invitation flows reuse one responsive auth presentation",()=>{
  const shell=read("app/console/AuthShell.tsx");
  assert.match(shell,/<main className="xy-auth">/);
  for(const path of [
    "app/login/page.tsx","app/register/page.tsx","app/forgot-password/page.tsx",
    "app/reset-password/page.tsx","app/verify-email/page.tsx",
    "app/invite/page.tsx","app/organization-invite/page.tsx",
  ])assert.match(read(path),/AuthShell/,path);
});
test("sensitive collaboration controls remain accessible and visibly distinguished",()=>{
  const workspace=read("app/workspace/WorkspaceClient.tsx");
  const collaboration=read("app/workspace/CollaborationPanel.tsx");
  const org=read("app/organizations/OrganizationsClient.tsx");
  const team=read("app/organizations/TeamWorkspacePanel.tsx");
  assert.match(workspace,/aria-pressed=\{selected\?\.publicId===p\.publicId\}/);
  assert.match(workspace,/className="xy-workspace-grid"/);
  assert.match(collaboration,/className="xy-danger"/);
  assert.match(org,/className="xy-member-row"/);
  assert.match(team,/className="xy-subcard"/);
  assert.match(team,/className="xy-danger"/);
});
