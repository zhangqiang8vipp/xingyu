# 星屿 V1 Release Candidate（2026-10-10）

本目录是交给运维的 V1 集成说明。它不授权合并 `main`、不授权改生产 D1/R2、不授权部署生产 Worker。

## 范围

一个 Cloudflare Worker、一个 D1、一个 R2。用户、组织、团队、工作区和 MCP 共用同一套内部用户 ID 与权限计算，不为每个用户或组织单独开实例。

包含四批已开发功能：

| PR | 分支 | 纳入 RC 时的 HEAD | Schema 标记 |
| --- | --- | --- | --- |
| [#15](https://github.com/zhangqiang8vipp/xingyu/pull/15) | `feature/identity-email-password-20261010` | `0843922d055734e8226f77e914f5c269b321bab0` | 21 |
| [#16](https://github.com/zhangqiang8vipp/xingyu/pull/16) | `feature/workspace-sharing-invites-rbac-20261010` | `b8c4771c11b94c933d286c13113242d59564ece4` | 22 |
| [#17](https://github.com/zhangqiang8vipp/xingyu/pull/17) | `feature/organization-members-units-20261010` | `263fb9b8f0ce962793e84009f33ff90d68389918` | 23 |
| [#18](https://github.com/zhangqiang8vipp/xingyu/pull/18) | `feature/teams-org-workspaces-space-acl-20261010` | `da1504c4916bcff5036bcb2dfe54fb43f6a193be` | 24 |

RC 分支：`release/v1-rc-20261010`。

集成方式：以 PR #18 的 `da1504c` 为父提交，再带上密码计算修复 `0c24c8d`（把 #15 的 `0843922` 应用到 #18 树上）。交接文档在其后的提交里。部署时记录 `git rev-parse HEAD`，不要用上表里的旧 HEAD 代替 RC 尖端。

`main` 在审计时为 `6a99e695393d1865f68fcd79d2a90710cf4162d3`（PR #14）。RC 没有合并进 `main`。

## 必须知道的断点

2026-10-10 实时比较：#17 包含 #16，#18 包含 #17。#16 相对当时的 #15 **分叉**：落后 1 个提交，也就是 Cloudflare 上可用的 scrypt 密码修复。只合并 #18 会把注册和登录退回 31 万次 PBKDF2，线上 Worker 会拒绝这次计算。

因此：

- 预发和生产都以本 RC 分支为准。
- 四个功能 PR 保持打开，本次不合并、不删除。
- 不要另开一个把四条分支再合并进 `main` 的发布 PR，否则会和 RC 重复。

## 已在预发证明的部分

独立预发 Worker `xingyu-beta-identity-qa-20261010` 只跑过 Schema 21 的身份与个人工作区：注册、验证信、A/B 隔离、管理员首次邮箱登录、验收 B 的密码重置、MCP 授权码与刷新令牌。该库不是 Schema 24，不能当作组织、团队和空间 ACL 的预发结论。

## 发布限制

当前结论见 `RELEASE-CHECKLIST.md`。在运维完成隔离库的 19→24 迁移演练之前，状态不是生产可批准。
