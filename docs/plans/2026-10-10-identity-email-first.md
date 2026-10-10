# Identity: first email/password delivery (2026-10-10)

This change migrates the existing site owner's identity (`users.id=1`) to the email `zhangqiang8vip@gmail.com`. The existing admin password is **not copied**. On first successful identity login the server checks the existing configured admin password hash and derives a separate PBKDF2-SHA256 credential in D1. It does not reset the original admin password.

Routes: `/login`, `POST /api/identity/login`, `POST /api/identity/logout`, `GET /api/identity/me`.

Important boundaries: new identity cookies cannot access the existing admin API or MCP. Existing admin authentication and MCP OAuth are intentionally untouched; they still require the legacy administrator session/token and cannot be publicly opened until workspace ACL and OAuth subject binding are complete.

Public self-registration is **not enabled** because the email verification and tenant ownership model are not ready. Users table and identity providers remain extensible to WeChat/Google/Alipay. Run the schema 20 migration and validation against an isolated D1 before production, and confirm schema/instance identity gates and rollback plan. **Do not deploy or merge on this change without CI and migration verification.**
