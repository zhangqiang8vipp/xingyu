import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pbkdf2Sync, scryptSync } from "node:crypto";
import { derivePasswordKey, deriveScryptPasswordKey } from "../server/auth/password-kdf.ts";
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

test("Workers-compatible password derivation matches independent native vectors, including Unicode", async () => {
  const password = "星屿-password-🔐-2026";
  const salt = new Uint8Array(16).fill(23);
  for (const iterations of [210000, 310000, 600000]) {
    const actual = await derivePasswordKey(password, salt, iterations);
    assert.deepEqual(Buffer.from(actual), pbkdf2Sync(password, salt, iterations, 32, "sha256"));
  }
});

test("password derivation rejects unsafe or unbounded work factors before calculation", async () => {
  for (const iterations of [100000, 209999, 1000001, Infinity, NaN, 310000.5]) {
    await assert.rejects(derivePasswordKey("synthetic-password", new Uint8Array(16), iterations), RangeError);
  }
});

test("new credentials use the native OWASP scrypt profile without weakening legacy PBKDF2", () => {
  const password = "星屿-password-🔐-2026";
  const salt = new Uint8Array(16).fill(23);
  assert.deepEqual(Buffer.from(deriveScryptPasswordKey(password, salt)),
    scryptSync(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }));
  assert.match(read("server/auth/identity.ts"), /LEGACY_PBKDF2_ITERATIONS = 310000/);
});
