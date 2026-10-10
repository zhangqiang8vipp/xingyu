# 部署顺序

四步分开。前一步没有证据，不进入下一步。

## 1. Release Candidate

分支 `release/v1-rc-20261010`。不部署生产，不合并 `main`。

核对：

```bash
git fetch https://github.com/zhangqiang8vipp/xingyu.git release/v1-rc-20261010
git rev-parse FETCH_HEAD
cd site && npm ci && npm run ci
```

`npm run ci` 包含 lint、TypeScript、Vinext 构建、Worker 类型、provisioning、source 和 integration。

## 2. 预发

1. 新建 Worker、D1、R2。`INSTANCE_ID` 使用 `beta:` 前缀，且与该 D1 的 `app_meta.instance_id` 一致。
2. 用生产形状的备份恢复到这个新 D1，按 `MIGRATION.md` 应用到 Schema 24。
3. 配置 `ENVIRONMENT.md` 里的 Secret 和发信变量。注册保持关闭。
4. 构建并部署这个预发 Worker。命令形态与生产相同，但配置文件必须指向预发资源：

```bash
cd site
npm run build
npx wrangler deploy --config CONFIG
```

5. 打开预发源站，用管理员会话调用 `/api/admin/diagnostics`。预期：schema 24、instance 匹配、关系审计无异常。
6. 按 `ACCEPTANCE.md` 做 A 到 H。全部通过后才把 `REGISTRATION_ENABLED` 设为 `true` 并再部署一次预发。

没有预发权限时，只能把本文交给有权限的人执行，不能把 CI 写成预发已通过。

## 3. 上线批准

提交 `RELEASE-CHECKLIST.md` 的实测结果。等待明确的文字批准。批准之前停止。

## 4. 生产（仅在批准后）

1. 冻结写入，按 `MIGRATION.md` 备份并在隔离库演练恢复。
2. 对生产 D1 按同一顺序应用到 Schema 24。版本标记不是 24 时不要部署 RC Worker。
3. 部署：

```bash
cd site
npm run deploy:production
```

该脚本会先构建，再用 `wrangler.production.jsonc`。不要对旧的 `dist` 直接 `wrangler deploy`。

4. 生产冒烟：首页、一篇旧文、管理员邮箱登录、diagnostics。然后才考虑打开注册。
5. 四个功能分支在生产稳定前不删除。

停止条件：迁移影响行数不对、diagnostics 不健康、公开文章 5xx、管理员无法登录。转入 `ROLLBACK.md`。
