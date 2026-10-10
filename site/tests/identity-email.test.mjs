import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
test("identity has separate session, no implicit admin grant, and no direct MCP bearer", () => {
  const auth = read("server/auth/identity.ts");
  const schema = read("db/schema.ts");
  const migration = read("drizzle/0018_identity_email_login.sql");
  assert.match(auth, /user_sessions/);
  assert.match(auth, /PBKDF2/);
  assert.match(auth, /legacy_admin === 1 && row.id === 1/);
  assert.match(migration, /VALUES \(1, 'email'/);
  assert.match(schema, /userCredentials = sqliteTable/);
  assert.doesNotMatch(read("worker/mcp-auth.ts"), /IDENTITY_COOKIE/);
});
