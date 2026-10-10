import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCspReport } from "../../domain/security/csp.ts";
import {
  callMcpTool,
  closeTestHarness,
  countPostsBySlug,
  findPostBySlug,
  initializeMcp,
  jsonRequest,
  loginAdmin,
  openTestHarness,
  seedReadOnlyOAuthToken,
  TEST_SLUGS,
  TEST_TITLES,
  withMcpClient,
  WRITE_SCOPE,
} from "./harness.mjs";

const READ_ONLY_TOKEN = "xy_at_pr01_read_only_contract_token";
const INVALID_TOKEN = "definitely-invalid-token";

const draftPayload = (overrides = {}) => ({
  title: TEST_TITLES.adminContract,
  slug: TEST_SLUGS.adminContract,
  excerpt: "integration contract",
  content: "# Admin Contract",
  categoryId: 1,
  spaceId: null,
  status: "draft",
  featured: false,
  publishedAt: null,
  ...overrides,
});

test("homepage rejects unsupported server action posts without a 500", async () => {
  const harness = await openTestHarness();
  try {
    const form = new FormData();
    form.append("0", "invalid-action-payload");
    const response = await harness.dispatch("/", {
      method: "POST",
      headers: { "Next-Action": "invalid-action-id" },
      body: form,
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  } finally {
    await closeTestHarness(harness);
  }
});

test("anonymous cannot create posts, authenticated admin can persist a post", async () => {
  const harness = await openTestHarness();
  try {
    const anonymous = await jsonRequest(harness, "/api/posts", {
      method: "POST",
      body: draftPayload(),
    });
    assert.equal(
      anonymous.status,
      401,
      `anonymous POST /api/posts must be rejected, got ${anonymous.status}`,
    );

    assert.equal(
      await countPostsBySlug(harness.db, TEST_SLUGS.adminContract),
      0,
      "a rejected anonymous POST must not write a post row",
    );

    const cookie = await loginAdmin(harness);

    const authorized = await jsonRequest(harness, "/api/posts", {
      method: "POST",
      cookie,
      body: draftPayload(),
    });
    const authorizedText = await authorized.text();
    assert.equal(
      authorized.status,
      201,
      `authenticated POST /api/posts must succeed, got ${authorized.status} ${authorizedText}`,
    );

    const body = JSON.parse(authorizedText);
    assert.ok(body?.post, "the create response must include the post");
    assert.ok(body.post.publicId, "the created post must have a stable publicId");
    assert.equal(body.post.slug, TEST_SLUGS.adminContract);
    assert.equal(body.post.status, "draft");

    const row = await findPostBySlug(harness.db, TEST_SLUGS.adminContract);
    assert.ok(row, "the post must actually be persisted in D1");
    assert.equal(row.title, TEST_TITLES.adminContract);
    assert.equal(row.slug, TEST_SLUGS.adminContract);
    assert.equal(row.status, "draft");
    assert.equal(row.space_id, null, "a public post must not belong to a space");
    assert.ok(row.public_id, "the persisted row must carry a public_id");
  } finally {
    await closeTestHarness(harness);
  }
});

test("MCP rejects invalid bearer tokens and read-only tokens cannot call write tools", async () => {
  const harness = await openTestHarness();
  try {
    const invalid = await jsonRequest(harness, "/mcp", {
      method: "POST",
      body: {},
      headers: { authorization: `Bearer ${INVALID_TOKEN}` },
    });
    assert.equal(invalid.status, 401, `an invalid MCP bearer must be rejected, got ${invalid.status}`);
    const challenge = invalid.headers.get("www-authenticate") ?? "";
    assert.match(challenge, /Bearer/i, "a rejected MCP request must carry a Bearer challenge");

    await seedReadOnlyOAuthToken({ db: harness.db, origin: harness.origin, token: READ_ONLY_TOKEN });

    // The read-only token must genuinely authenticate, otherwise the write
    // rejection below would prove nothing.
    await initializeMcp(harness, READ_ONLY_TOKEN);

    const result = await callMcpTool(harness, {
      name: "create_draft",
      token: READ_ONLY_TOKEN,
      id: 3,
      arguments: {
        title: TEST_TITLES.forbiddenDraft,
        slug: TEST_SLUGS.forbiddenDraft,
        content_markdown: "# This must never be written",
        change_summary: "PR01 integration contract",
      },
    });

    assert.equal(result.isError, true, "a read-only token must not be able to call create_draft");
    assert.equal(
      result.structuredContent?.error,
      "insufficient_scope",
      `the rejection must report insufficient_scope, got ${JSON.stringify(result.structuredContent)}`,
    );
    assert.equal(
      result.structuredContent?.required_scope,
      WRITE_SCOPE,
      "the rejection must name the scope that was required",
    );

    // The official SDK client path. It validates the tool result against the
    // tool's declared outputSchema, so this proves a real MCP host can read
    // the permission error instead of tripping over schema validation.
    const sdkResult = await withMcpClient(harness, READ_ONLY_TOKEN, (client) =>
      client.callTool({
        name: "create_draft",
        arguments: {
          title: TEST_TITLES.forbiddenDraft,
          slug: TEST_SLUGS.forbiddenDraft,
          content_markdown: "# This must never be written",
          change_summary: "PR01 integration contract",
        },
      }),
    );

    assert.equal(
      sdkResult.isError,
      true,
      "an official SDK client must receive the rejection as a tool error",
    );
    assert.equal(
      sdkResult.structuredContent?.error,
      "insufficient_scope",
      `the SDK client must be able to read insufficient_scope, got ${JSON.stringify(sdkResult.structuredContent)}`,
    );
    assert.equal(
      sdkResult.structuredContent?.required_scope,
      WRITE_SCOPE,
      "the SDK client must be able to read the required scope",
    );

    assert.equal(
      await countPostsBySlug(harness.db, TEST_SLUGS.forbiddenDraft),
      0,
      "a scope-rejected MCP write must not write a post row",
    );
  } finally {
    await closeTestHarness(harness);
  }
});

test("MCP read results pass output schema validation in the official client", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);
    const created = await jsonRequest(harness, "/api/posts", {
      method: "POST",
      cookie,
      body: draftPayload(),
    });
    assert.equal(created.status, 201);
    const { post } = await created.json();
    await seedReadOnlyOAuthToken({ db: harness.db, origin: harness.origin, token: READ_ONLY_TOKEN });

    await withMcpClient(harness, READ_ONLY_TOKEN, async (client) => {
      const spaces = await client.callTool({ name: "list_spaces", arguments: {} });
      assert.equal(spaces.structuredContent?.ok, true);
      assert.equal(spaces.structuredContent?.parent, null);

      const search = await client.callTool({ name: "search_posts", arguments: {} });
      assert.equal(search.structuredContent?.ok, true);
      assert.equal(search.structuredContent?.detail, "minimal");
      assert.equal(typeof search.structuredContent?.hint, "string");
      assert.ok(search.structuredContent?.posts?.some((item) => item.public_id === post.publicId));

      const outline = await client.callTool({
        name: "get_post",
        arguments: { identifier: post.publicId, view: "outline" },
      });
      assert.equal(outline.structuredContent?.ok, true);
      assert.equal(outline.structuredContent?.post?.public_id, post.publicId);
      assert.equal(typeof outline.structuredContent?.hint, "string");
    });
  } finally {
    await closeTestHarness(harness);
  }
});

test("anonymous admin page requests redirect to the admin login page", async () => {
  const harness = await openTestHarness();
  try {
    const response = await jsonRequest(harness, "/admin", { redirect: "manual" });

    assert.notEqual(response.status, 200, "an anonymous /admin request must not be served");
    assert.ok(
      response.status >= 300 && response.status <= 399,
      `an anonymous /admin request must redirect, got ${response.status}`,
    );

    const location = response.headers.get("location");
    assert.ok(location, "the redirect must carry a Location header");
    assert.equal(
      new URL(location, harness.origin).pathname,
      "/admin/login",
      "the redirect target must be the admin login page",
    );
  } finally {
    await closeTestHarness(harness);
  }
});

test("published public posts are readable while published space posts stay private", async () => {
  const harness = await openTestHarness();
  try {
    const cookie = await loginAdmin(harness);

    const publicPost = await jsonRequest(harness, "/api/posts", {
      method: "POST",
      cookie,
      body: draftPayload({
        title: TEST_TITLES.publicBoundary,
        slug: TEST_SLUGS.publicBoundary,
        excerpt: "",
        content: "# PUBLIC CONTRACT",
        status: "published",
      }),
    });
    const publicText = await publicPost.text();
    assert.equal(
      publicPost.status,
      201,
      `publishing a public post must succeed, got ${publicPost.status} ${publicText}`,
    );
    const publicBody = JSON.parse(publicText);
    const publicId = publicBody?.post?.publicId;
    assert.ok(publicId, "the published public post must have a publicId");

    const publicUrl = `/posts/${publicId}/${TEST_SLUGS.publicBoundary}`;
    const publicRead = await jsonRequest(harness, publicUrl);
    const publicHtml = await publicRead.text();
    assert.equal(
      publicRead.status,
      200,
      `a published public post must be readable at ${publicUrl}, got ${publicRead.status}`,
    );
    assert.ok(
      publicHtml.includes(TEST_TITLES.publicBoundary),
      "the public page must render the article title",
    );

    const space = await jsonRequest(harness, "/api/spaces", {
      method: "POST",
      cookie,
      body: { name: TEST_TITLES.privateSpace, slug: TEST_SLUGS.privateSpace, parentId: null, sortOrder: 0 },
    });
    const spaceText = await space.text();
    assert.equal(
      space.status,
      201,
      `creating a private space must succeed, got ${space.status} ${spaceText}`,
    );
    const spaceBody = JSON.parse(spaceText);
    const spaceId = spaceBody?.space?.id;
    assert.ok(spaceId, "the created space must have an id");

    const privatePost = await jsonRequest(harness, "/api/posts", {
      method: "POST",
      cookie,
      body: draftPayload({
        title: TEST_TITLES.privateBoundary,
        slug: TEST_SLUGS.privateBoundary,
        excerpt: "",
        content: "# PRIVATE CONTRACT",
        spaceId,
        status: "published",
      }),
    });
    const privateText = await privatePost.text();
    assert.equal(
      privatePost.status,
      201,
      `publishing a space post must succeed, got ${privatePost.status} ${privateText}`,
    );
    const privateBody = JSON.parse(privateText);
    const privateId = privateBody?.post?.publicId;
    assert.ok(privateId, "the published space post must have a publicId");

    // Prove the space post really exists as published before asserting that the
    // public URL hides it: otherwise a 404 could just mean creation failed.
    const privateRow = await findPostBySlug(harness.db, TEST_SLUGS.privateBoundary);
    assert.ok(privateRow, "the space post must actually be persisted in D1");
    assert.equal(privateRow.status, "published");
    assert.equal(privateRow.space_id, spaceId, "the space post must belong to the private space");

    const privateUrl = `/posts/${privateId}/${TEST_SLUGS.privateBoundary}`;
    const privateRead = await jsonRequest(harness, privateUrl);
    assert.equal(
      privateRead.status,
      404,
      `a published post inside a space must not be publicly readable at ${privateUrl}`,
    );
    const privateHtml = await privateRead.text();
    assert.ok(
      !privateHtml.includes(TEST_TITLES.privateBoundary),
      "the public response must not leak the private article title",
    );
  } finally {
    await closeTestHarness(harness);
  }
});

test("public HTML carries the report-only CSP while APIs and reports stay clear", async () => {
  const harness = await openTestHarness({ vars: { CSP_MODE: "report-only" } });
  try {
    const home = await harness.dispatch("/", { headers: { accept: "text/html" } });
    const policy = home.headers.get("content-security-policy-report-only");
    assert.ok(policy, "report-only mode must attach the CSP header to public HTML");
    assert.match(policy, /default-src 'self'/);
    assert.match(policy, /report-uri \/\.well-known\/csp-report/);
    assert.equal(home.headers.get("content-security-policy"), null, "report-only must not enforce");

    const about = await harness.dispatch("/about", { headers: { accept: "text/html" } });
    assert.ok(about.headers.get("content-security-policy-report-only"),
      "every public document page must carry the same policy");

    const api = await harness.dispatch("/api/posts?scope=all");
    assert.equal(api.headers.get("content-security-policy-report-only"), null,
      "JSON APIs must not carry a document CSP");

    const report = await harness.dispatch("/.well-known/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify({ "csp-report": { "document-uri": "http://127.0.0.1/", "violated-directive": "script-src" } }),
    });
    assert.equal(report.status, 204, "the violation endpoint accepts reports without echoing them");
    assert.equal(report.headers.get("cache-control"), "no-store");

    const oversized = await harness.dispatch("/.well-known/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: "x".repeat(9000),
    });
    assert.equal(oversized.status, 204);
    assert.equal(oversized.headers.get("cache-control"), "no-store");
  } finally {
    await closeTestHarness(harness);
  }
});

test("CSP report summary omits document paths, queries, and untrusted fields", () => {
  const summary = summarizeCspReport({ "csp-report": {
    "document-uri": "https://example.com/private?token=private-token",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://cdn.example.com/path?key=private-key",
    "source-file": "https://example.com/private?secret=private-secret",
    "status-code": 200,
  } });
  assert.deepEqual(summary, { directive: "script-src-elem", blockedOrigin: "https://cdn.example.com", statusCode: 200 });
  assert.equal(summarizeCspReport({ "csp-report": { "effective-directive": "bogus;private-data" } }), null);
});

test("CSP enforcement switches the header and the default stays off", async () => {
  const enforced = await openTestHarness({ vars: { CSP_MODE: "enforce" } });
  try {
    const home = await enforced.dispatch("/", { headers: { accept: "text/html" } });
    assert.ok(home.headers.get("content-security-policy"), "enforce mode must emit the enforced header");
    assert.equal(home.headers.get("content-security-policy-report-only"), null);
  } finally {
    await closeTestHarness(enforced);
  }
  const off = await openTestHarness({ vars: { CSP_MODE: "off" } });
  try {
    const home = await off.dispatch("/", { headers: { accept: "text/html" } });
    assert.equal(home.headers.get("content-security-policy"), null);
    assert.equal(home.headers.get("content-security-policy-report-only"), null,
      "CSP stays opt-in until a mode is configured");
  } finally {
    await closeTestHarness(off);
  }
});

test("admin diagnostics is admin-only and reports a healthy site with the full audit", async () => {
  const harness = await openTestHarness();
  try {
    const anonymous = await jsonRequest(harness, "/api/admin/diagnostics");
    assert.equal(
      anonymous.status,
      401,
      `anonymous GET /api/admin/diagnostics must be rejected, got ${anonymous.status}`,
    );

    const cookie = await loginAdmin(harness);
    const authorized = await jsonRequest(harness, "/api/admin/diagnostics", { cookie });
    assert.equal(authorized.status, 200, `authenticated diagnostics must succeed, got ${authorized.status}`);
    assert.equal(authorized.headers.get("cache-control"), "no-store", "diagnostics must never be cached");

    const body = JSON.parse(await authorized.text());
    assert.equal(body.schema.code, "21", "the report must name the expected schema version");
    assert.equal(body.schema.database, "21", "the local D1 must report the same schema version");
    assert.equal(body.schema.environment, "development");
    assert.equal(body.migrations, null, "a legacy-bootstrap harness has no d1_migrations table");
    assert.equal(body.ownerPresent, true, "the site owner membership must be present");
    assert.equal(body.queue.pendingCleanup, 0);

    const auditKeys = Object.keys(body.audit).sort();
    assert.equal(auditKeys.length, 16, `diagnostics must report all 16 audit counters, got ${auditKeys.length}`);
    for (const key of auditKeys) {
      assert.equal(body.audit[key], 0, `audit counter ${key} must start at zero`);
    }
    assert.equal(typeof body.counts.posts, "number");
    assert.equal(typeof body.generatedAt, "string");
  } finally {
    await closeTestHarness(harness);
  }
});

test("diagnostics surfaces orphaned core relations and recovers after cleanup", async () => {
  const harness = await openTestHarness();
  try {
    await harness.db
      .prepare("INSERT OR IGNORE INTO post_views (post_id, visitor_hash, viewed_on) VALUES (999999, 'orphan-probe', '2026-01-01')")
      .run();

    const cookie = await loginAdmin(harness);
    const dirty = await jsonRequest(harness, "/api/admin/diagnostics", { cookie });
    assert.equal(dirty.status, 200);
    const dirtyBody = JSON.parse(await dirty.text());
    assert.equal(
      dirtyBody.audit.views_missing_post,
      1,
      `an orphaned post_views row must surface as views_missing_post=1, got ${dirtyBody.audit.views_missing_post}`,
    );

    await harness.db
      .prepare("DELETE FROM post_views WHERE post_id = 999999 AND visitor_hash = 'orphan-probe'")
      .run();

    const clean = await jsonRequest(harness, "/api/admin/diagnostics", { cookie });
    const cleanBody = JSON.parse(await clean.text());
    assert.equal(cleanBody.audit.views_missing_post, 0, "the audit must recover to zero after the orphan is removed");
  } finally {
    await closeTestHarness(harness);
  }
});
