# 架构与权限流向

单实例。身份、内容和授权都在同一个 Worker、同一个 D1、同一个 R2。

## 对象

- **User**：内部整数 ID。邮箱不是主键。
- **Identity**：`user_identities`。邮箱登录的 provider 是 `email`，subject 是规范化邮箱。未经验证的相同邮箱不会合并账号。
- **Credential**：`user_credentials.password_hash`。新密码格式为 `scrypt-v2`（N=32768，r=8，p=3）。旧的 `pbkdf2-sha256` 只用于读取已经写好的哈希；线上 Web Crypto 不能计算 31 万次 PBKDF2。
- **Organization / Department**：组织成员与多级部门。部门只描述组织结构，不授予工作区阅读权。
- **Team**：必须属于一个组织，成员必须是该组织的有效成员。团队不能跨组织加人，也不能给其他组织的工作区授权。
- **Workspace**：`personal`（仅所有者）、`shared`（显式成员）、`organization`（组织工作区）。加入组织本身不获得该组织工作区的权限。
- **Space / Post / Attachment**：文章和附件挂在工作区上。公开博客只读取 `workspace_id=1` 且已发布、无空间归属的文章。
- **MCP OAuth**：令牌 subject 为 `user:<id>`。网页会话和 MCP 都读取同一套 `workspace_effective_grants` 与空间 ACL。

## 有效工作区权限

视图 `workspace_effective_grants` 在 `site/drizzle/0022_teams_workspace_grants_space_acl.sql` 创建，由两类行组成：

1. 直接成员：`workspace_memberships`，且用户、工作区为有效状态。个人工作区还要求成员就是所有者。组织工作区还要求该用户是对应组织的有效成员。
2. 团队授权：`workspace_team_grants` 只作用在组织工作区。团队、组织、组织成员和用户都必须仍然有效。角色只有 Viewer / Editor，不能通过团队授权变成 Owner 或 Admin。

这是实时计算，不写影子成员。撤权后下一次请求就看不到授权。

## 空间 ACL

默认空间继承工作区角色。空间标成 restricted 之后，访问者必须对该空间以及每一个受限祖先空间持有主体授权。空间 ACL 的 Editor 不能把工作区 Viewer 提升成写权限。跨组织的用户或团队不能写入 ACL。搜索、目录、附件和活动记录走同一套判断。

## 管理员迁移

`users.id=1` 保留，邮箱身份为 `zhangqiang8vip@gmail.com`。首次在 `/login` 使用现有管理员密码时，用现有 `ADMIN_PASSWORD_HASH` 校验，再把凭据写成 `scrypt-v2`，并关闭只填密码的旧后台入口。密码明文和哈希都不进日志、不进本文档。
