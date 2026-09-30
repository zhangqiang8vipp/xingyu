import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTestHarness as createWranglerTestHarness } from "wrangler";

const SITE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BRIDGE_NAME = "xingyu-integration-binding-bridge";
const FAULT_R2_NAME = "xingyu-integration-faulting-r2";
const productionConfig = JSON.parse(readFileSync(new URL("../../wrangler.production.jsonc", import.meta.url), "utf8"));

export function createTestHarness({ d1SessionFault = false, d1SessionUnavailable = false, d1SessionRejectConcurrent = false, ...options }) {
  const server = createWranglerTestHarness({
    ...options,
    workers: [
      ...options.workers,
      {
        config: {
          name: BRIDGE_NAME,
          main: "./tests/integration/binding-bridge.mjs",
          compatibility_date: productionConfig.compatibility_date,
          d1_databases: productionConfig.d1_databases,
          r2_buckets: productionConfig.r2_buckets,
        },
      },
    ],
  });
  const originalGetWorker = server.getWorker.bind(server);
  server.getWorker = (name) => {
    const worker = originalGetWorker(name);
    if (name === BRIDGE_NAME) return worker;
    const bridge = originalGetWorker(BRIDGE_NAME);
    return new Proxy(worker, {
      get(target, key) {
        if (key === "getEnv") return async () => bridgeBindings(bridge, { d1SessionFault, d1SessionUnavailable, d1SessionRejectConcurrent });
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return server;
}

function bridgeBindings(bridge, { d1SessionFault = false, d1SessionUnavailable = false, d1SessionRejectConcurrent = false } = {}) {
  const call = async (payload) => {
    const response = await bridge.fetch("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return body.result;
  };
  const prepare = (sql) => {
    const statement = (params) => ({
      bind: (...values) => statement(values),
      run: () => call({ operation: "run", sql, params }),
      all: () => call({ operation: "all", sql, params }),
      first: () => call({ operation: "first", sql, params }),
    });
    return statement([]);
  };
  const DB = {
    prepare,
    ...(d1SessionUnavailable ? {} : {
      withSession() {
        if (d1SessionFault) throw new Error("injected D1 session failure");
        let inFlight = false;
        const sessionPrepare = (sql) => {
          const statement = (params) => ({
            bind: (...values) => statement(values),
            first: async () => {
              if (d1SessionRejectConcurrent && inFlight) {
                throw new Error("concurrent D1 session query");
              }
              inFlight = true;
              try {
                return await call({ operation: "first", sql, params });
              } finally {
                inFlight = false;
              }
            },
          });
          return statement([]);
        };
        return {
          prepare: sessionPrepare,
          getBookmark: () => "integration-session-bookmark",
        };
      },
    }),
  };
  const MEDIA = {
    put: (key, value) => call({ operation: "r2-put", key, value }),
    head: (key) => call({ operation: "r2-head", key }),
    get: (key) => call({ operation: "r2-get", key }),
    delete: (key) => call({ operation: "r2-delete", key }),
    list: (options) => call({ operation: "r2-list", options }),
  };
  return { DB, MEDIA };
}

export const TEST_ADMIN_PASSWORD = "xingyu-test-admin-password-2026";
export const TEST_ADMIN_SESSION_SECRET =
  "xingyu-test-session-secret-only-for-local-integration-2026-very-long";
export const TEST_LEGACY_MCP_TOKEN = "xingyu-test-legacy-mcp-token";

export const ADMIN_SESSION_COOKIE = "xingyu_admin_session";
export const READ_ONLY_SCOPE = "xingyu.read";
export const WRITE_SCOPE = "xingyu.draft";

export const TEST_SLUGS = {
  adminContract: "pr01-admin-contract",
  forbiddenDraft: "pr01-forbidden-mcp-draft",
  publicBoundary: "pr01-public-boundary-contract",
  privateBoundary: "pr01-private-boundary-contract",
  privateSpace: "pr01-private-contract-space",
};

export const TEST_TITLES = {
  adminContract: "PR01 Admin Contract",
  forbiddenDraft: "PR01 Forbidden MCP Draft",
  publicBoundary: "PR01 Public Boundary Contract",
  privateBoundary: "PR01 Private Boundary Contract",
  privateSpace: "PR01 Private Contract Space",
};

/**
 * Starts an isolated local Worker harness against the production build output.
 * Everything runs on the local workerd runtime with its own local D1: the
 * harness has no remote binding support, so production data cannot be reached.
 *
 * One harness per top-level test is deliberate. `db/bootstrap.ts` caches its
 * initialization promise in module scope, so reusing a server across tests and
 * resetting storage underneath it can leave that cache stale.
 */
export async function openTestHarness({ r2DeleteFault = false, d1SessionFault = false, d1SessionUnavailable = false, d1SessionRejectConcurrent = false, vars = {} } = {}) {
  const appWorker = {
    configPath: "./wrangler.production.jsonc",
    vars: { APP_ENV: "development", DB_SCHEMA_MODE: "legacy-bootstrap", ...vars },
    secrets: {
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      ADMIN_SESSION_SECRET: TEST_ADMIN_SESSION_SECRET,
      MCP_WRITE_TOKEN: TEST_LEGACY_MCP_TOKEN,
    },
    ...(r2DeleteFault ? { bindingOverrides: { MEDIA: FAULT_R2_NAME } } : {}),
  };
  const server = createTestHarness({
    d1SessionFault,
    d1SessionUnavailable,
    d1SessionRejectConcurrent,
    root: SITE_ROOT,
    workers: [
      appWorker,
      ...(r2DeleteFault ? [{ config: {
        name: FAULT_R2_NAME,
        main: "./tests/integration/faulting-r2.mjs",
        compatibility_date: productionConfig.compatibility_date,
        r2_buckets: productionConfig.r2_buckets.map((bucket) => ({ ...bucket, binding: "STORAGE" })),
      } }] : []),
    ],
  });

  const { url } = await server.listen();
  const origin = url.origin;
  const worker = server.getWorker();
  const env = await worker.getEnv();

  // Dispatch through the Worker handle rather than `server.fetch()`.
  //
  // What this exercises: the real production Worker `fetch` handler, and the
  // real auth -> domain/db -> local D1 path behind it. It is direct Worker
  // dispatch, so it does NOT go through the test harness's route matching,
  // meaning these tests do not verify the Cloudflare domain route config in
  // wrangler.production.jsonc. The four security contracts here are about
  // auth, scope and read boundaries rather than route matching, so that gap
  // is acceptable and is noted rather than papered over.
  //
  // Why not `server.fetch()`: it proxies each request over a local socket
  // through miniflare's entry worker. When a Worker returns a response
  // without consuming the request body (which `isAdminRequest` does
  // deliberately, rejecting unauthenticated writes before parsing untrusted
  // input), the next request through that proxy fails with "Network
  // connection lost" and only the request after that recovers.
  const dispatch = (path, init) => worker.fetch(path, init);

  // `ensureDatabase()` only runs on a request, so the schema does not exist
  // until something is served. Warm it up once so tests can query D1 directly
  // for side effects without racing schema creation.
  const warmup = await dispatch("/");
  assert.equal(warmup.status, 200, `warmup GET / should succeed, got ${warmup.status}`);

  return { server, origin, worker, db: env.DB, env, dispatch };
}

export async function closeTestHarness(harness) {
  if (!harness?.server) return;
  await harness.server.close();
}

/**
 * Logs in through the real admin login endpoint and returns the session cookie.
 * The session cookie is never forged: `isAdminRequest` and the HMAC-signed
 * session payload are exercised end to end.
 */
export async function loginAdmin({ dispatch, origin }) {
  const response = await dispatch("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
  });

  const text = await response.text();
  assert.equal(
    response.status,
    200,
    `admin login should succeed, got ${response.status} ${text}`,
  );

  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  assert.equal(body?.ok, true, `admin login response should report ok, got ${text}`);

  const cookie = readSessionCookie(response);
  assert.ok(
    cookie,
    `admin login should set the ${ADMIN_SESSION_COOKIE} cookie, got ${describeSetCookie(response)}`,
  );
  return cookie;
}

function describeSetCookie(response) {
  const values = readSetCookieValues(response);
  return values.length ? values.join(" | ") : "(no set-cookie header)";
}

function readSetCookieValues(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie().filter(Boolean);
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function readSessionCookie(response) {
  for (const value of readSetCookieValues(response)) {
    const [pair] = value.split(";");
    if (pair.startsWith(`${ADMIN_SESSION_COOKIE}=`)) return pair.trim();
  }
  return "";
}

/**
 * Sends a JSON request to the harness. `cookie` is forwarded as a Cookie header
 * and `origin` is forwarded as the Origin header, which the app requires to
 * match the request origin for any non-GET method.
 */
export async function jsonRequest(
  { dispatch, origin },
  path,
  { method = "GET", body, cookie, headers = {}, redirect } = {},
) {
  const requestHeaders = { origin, ...headers };
  if (cookie) requestHeaders.cookie = cookie;
  if (body !== undefined) requestHeaders["content-type"] = "application/json";

  return dispatch(path, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(redirect ? { redirect } : {}),
  });
}

export async function countPostsBySlug(db, slug) {
  const row = await db
    .prepare("SELECT COUNT(*) AS value FROM posts WHERE slug = ?")
    .bind(slug)
    .first();
  return Number(row?.value ?? 0);
}

export async function findPostBySlug(db, slug) {
  return db
    .prepare("SELECT public_id, title, slug, status, space_id FROM posts WHERE slug = ?")
    .bind(slug)
    .first();
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Seeds a real OAuth access token with a deliberately narrow scope.
 *
 * `MCP_WRITE_TOKEN` carries every scope, so it cannot prove a scope boundary.
 * This token is inserted the same way the OAuth token endpoint stores one:
 * the SHA-256 hex of the bearer value, bound to the running harness origin so
 * that `mcpResourceFor(origin)` matches.
 */
export async function seedReadOnlyOAuthToken({ db, origin, token }) {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO oauth_access_tokens (token_hash, client_id, subject, resource, scope, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(sha256Hex(token), "chatgpt-xingyu", "xingyu-owner", `${origin}/mcp`, READ_ONLY_SCOPE, now + 3600)
    .run();
  return token;
}

/**
 * Sends a single JSON-RPC message to the MCP endpoint over real HTTP.
 *
 * The official SDK client cannot be used to observe the scope-failure contract:
 * `callTool()` validates `structuredContent` against the tool's declared
 * outputSchema whenever that field is present, even when `isError` is true, and
 * the scope failure payload carries `required_scope`, which is not part of the
 * declared schema. The SDK therefore raises -32602 before the caller can read
 * `insufficient_scope`. Posting JSON-RPC directly observes the real wire bytes
 * and is strictly more faithful, not a weakening of the assertion.
 */
export async function callMcpRaw({ dispatch }, body, { token, sessionId } = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const response = await dispatch("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  return { status: response.status, headers: response.headers, text, payload };
}

export async function initializeMcp(harness, token) {
  const response = await callMcpRaw(
    harness,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "xingyu-pr01-integration", version: "1.0.0" } },
    },
    { token },
  );
  assert.equal(response.status, 200, `MCP initialize should succeed, got ${response.status} ${response.text}`);
  assert.ok(response.payload?.result, `MCP initialize should return a result, got ${response.text}`);
  return response.headers.get("mcp-session-id");
}

/**
 * Runs a callback against a real MCP client built from the official SDK.
 *
 * This is the path a real MCP host uses: it validates tool results against the
 * tool's declared outputSchema, so it proves the error contract is actually
 * readable by clients rather than only being present on the wire.
 */
export async function withMcpClient({ origin, dispatch }, token, run) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (url, init) => dispatch(url, init),
  });
  const client = new Client({ name: "xingyu-pr01-integration", version: "1.0.0" });
  try {
    await client.connect(transport);
    return await run(client);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function callMcpTool(harness, { name, arguments: toolArguments, token, id = 2 }) {
  const response = await callMcpRaw(
    harness,
    { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: toolArguments } },
    { token },
  );
  assert.equal(response.status, 200, `MCP tools/call should return HTTP 200, got ${response.status} ${response.text}`);
  assert.ok(response.payload?.result, `MCP tools/call should return a result, got ${response.text}`);
  return response.payload.result;
}
