# 预发验收步骤

在 RC 分支部署到**新的**隔离 Worker、D1、R2 上执行。数据库按 `MIGRATION.md` 走到 Schema 24。`REGISTRATION_ENABLED` 只在发信域名验证通过后打开。

每一项记录：执行人、时间、结果、证据链接。失败则停止后续上线步骤。

## A. 普通用户

1. 注册新邮箱。预期：接口返回已受理，邮箱收到验证信，用户状态为 `pending`。
2. 打开验证链接。预期：状态变为 `active`，出现个人工作区。同一链接再次打开失败。
3. 登录、创建草稿、上传仅属于该草稿的附件、退出、再用同一密码登录。
4. 用另一个账号访问该工作区、附件 URL 和搜索。预期：拒绝，且响应里没有正文。

Schema 21 预发已经覆盖过注册、验证、个人草稿隔离和退出。附件上传和 Schema 24 上的重复，仍要在本 RC 预发再做一次。

## B. 共享工作区

用户 A 创建共享工作区，邀请 B 为 Editor、C 为 Viewer。

- B 可以改文章，C 的写入接口被拒绝。
- A 可以移除成员。移除后 B、C 的网页和 MCP 立即不能再读该工作区。

自动化覆盖：`site/tests/integration/workspace-collaboration.test.mjs`。这不等于预发已验收。

## C. 两个组织

A 创建两个组织。B 加入两个，C 只加入一个。C 不能列出或修改只属于另一组织的部门、成员和团队。

自动化覆盖：`site/tests/integration/organization-members-units.test.mjs`。

## D. 部门与团队

建立技术中心 → 研发部 → AI 项目组。确认不能把部门的父级设成自己的后代，不能把另一个组织的用户加进团队。用户退出组织后，部门关系和团队成员被去掉。

## E. 组织工作区

组织工作区给团队 A Viewer、团队 B Editor。降级、撤销和把成员移出团队后，权限立即变化。Viewer 不能写。Editor 不能改 Owner。

## F. 空间 ACL

在组织工作区建立多层空间，把内层标成 restricted。无授权用户的搜索、目录、正文和附件都失败。只授子空间、不授受限父空间时仍然失败。空间 Editor 不能让工作区 Viewer 获得写权限。

自动化覆盖：`site/tests/integration/team-workspace-acl.test.mjs`。

## G. MCP

两个用户各走一次 OAuth（PKCE）。分别列出工作区、搜索、读取、创建草稿。撤销成员或空间授权后，旧 access token 的下一次工具调用被拒绝。授权码和旧刷新令牌不能再用。

Schema 21 预发已经做过两个用户的授权、刷新和撤销。组织与 ACL 的 MCP 撤权要在 Schema 24 预发再做。

## H. 旧博客

在迁移后的库上打开原首页、一篇旧文的 canonical URL、旧 slug 跳转和一张历史图片。文章行数、`public_id` 与冻结清单一致。管理员用 `zhangqiang8vip@gmail.com` 和原密码登录后仍能管理原站，且只填密码的旧入口被拒绝。

未迁移的现网首页只能证明现网还没被这次 RC 改动，不能代替本项。
