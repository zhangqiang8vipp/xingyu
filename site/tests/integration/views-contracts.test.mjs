import assert from "node:assert/strict";
import test from "node:test";
import { closeTestHarness, openTestHarness } from "./harness.mjs";
import {
  checkViewRateLimit,
  cleanupExpiredPostViews,
  coarseReaderAddress,
  trackPostViewRequest,
  VIEWS_IDENTITY_SECRET_FALLBACK,
} from "../../db/view-tracking.ts";

async function viewRequest(harness, slug, { address = "203.0.113.7", visitor } = {}) {
  const headers = { "cf-connecting-ip": address };
  const init = { method: "POST", headers };
  if (visitor !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify({ visitor });
  }
  return harness.dispatch(`/api/views/${slug}`, init);
}

async function seedPublicPost(db, publicId, title = publicId) {
  await db.prepare(`INSERT INTO posts
    (public_id, title, slug, content, category_id, space_id, status, published_at)
    VALUES (?, ?, ?, 'body', 1, NULL, 'published', '2026-01-01')`)
    .bind(publicId, title, publicId).run();
}

test("client-supplied forwarding headers cannot mint a new reader identity", () => {
  const request = new Request("https://example.test/api/views/post", {
    headers: { "x-forwarded-for": "198.51.100.99" },
  });
  assert.equal(coarseReaderAddress(request), "local");
});

test("production rate limiting fails closed when the binding is missing or errors", async () => {
  assert.equal(await checkViewRateLimit(undefined, "reader-hash", "production"), "unavailable");
  assert.equal(await checkViewRateLimit({ limit: async () => { throw new Error("binding down"); } }, "reader-hash", "production"), "unavailable");
  assert.equal(await checkViewRateLimit(undefined, "reader-hash", "development"), "allowed",
    "local development may run without a native limiter but must not fall back to D1");
});

test("production view tracking refuses a missing identity secret without writing", async () => {
  const harness = await openTestHarness({ vars: { APP_ENV: "production", DB_SCHEMA_MODE: "local-preview-bootstrap" } });
  try {
    await seedPublicPost(harness.db, "views-secret", "Secret guard");
    const response = await viewRequest(harness, "views-secret");
    assert.equal(response.status, 503);
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS c FROM post_views").first())?.c, 0);
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS c FROM view_request_limits").first())?.c, 0);
  } finally {
    await closeTestHarness(harness);
  }
});

test("public articles count each server-side reader once per day and ignore forged client identity", async () => {
  const harness = await openTestHarness();
  try {
    await seedPublicPost(harness.db, "views-public", "Public views");

    const first = await viewRequest(harness, "views-public", { visitor: "spoofed-a" });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { counted: true });

    const sameReader = await viewRequest(harness, "views-public", { visitor: "spoofed-b" });
    assert.deepEqual(await sameReader.json(), { counted: false },
      "changing the client-supplied visitor string must not mint a second reader");

    const otherReader = await viewRequest(harness, "views-public", { address: "203.0.113.8" });
    assert.deepEqual(await otherReader.json(), { counted: true });

    const count = await harness.db.prepare("SELECT view_count FROM posts WHERE slug = 'views-public'").first();
    assert.equal(count?.view_count, 2);
    const events = (await harness.db.prepare("SELECT visitor_hash FROM post_views ORDER BY visitor_hash").all()).results ?? [];
    assert.equal(events.length, 2);
    for (const { visitor_hash } of events) {
      assert.ok(!visitor_hash.includes("spoofed"), "raw client identifiers must never reach storage");
    }
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS c FROM view_request_limits").first())?.c, 0,
      "view requests must not write the legacy D1 rate-limit table");
  } finally {
    await closeTestHarness(harness);
  }
});

test("drafts, private articles and missing slugs share a silent 204 without counting", async () => {
  const harness = await openTestHarness();
  try {
    await harness.db.prepare(`INSERT INTO posts
      (public_id, title, slug, content, category_id, space_id, status, published_at)
      VALUES ('views-draft', 'Views draft', 'views-draft', 'body', 1, NULL, 'draft', NULL)`).run();
    await harness.db.prepare(`INSERT INTO posts
      (public_id, title, slug, content, category_id, space_id, status, published_at)
      VALUES ('views-private', 'Views private', 'views-private', 'body', 1, 10, 'published', '2026-01-01')`).run();

    for (const target of ["views-draft", "views-private", "views-missing"]) {
      const response = await viewRequest(harness, target);
      assert.equal(response.status, 204, `${target} must share the same silent response`);
    }
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS c FROM post_views").first())?.c, 0);
  } finally {
    await closeTestHarness(harness);
  }
});

test("a rejected native rate-limit decision never reaches D1 view writes", async () => {
  const harness = await openTestHarness();
  try {
    await seedPublicPost(harness.db, "views-limited", "Views limited");
    const request = new Request("https://example.test/api/views/views-limited", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.99" },
    });
    const result = await trackPostViewRequest(
      harness.db,
      { limit: async () => ({ success: false }) },
      VIEWS_IDENTITY_SECRET_FALLBACK,
      request,
      "views-limited",
      "production",
    );
    assert.equal(result, "limited");

    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS c FROM post_views").first())?.c, 0);
    assert.equal((await harness.db.prepare("SELECT view_count FROM posts WHERE slug = 'views-limited'").first())?.view_count, 0);
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS c FROM view_request_limits").first())?.c, 0);
  } finally {
    await closeTestHarness(harness);
  }
});

test("the configured rate limiter returns 429 and prevents a fresh post from counting", async () => {
  const harness = await openTestHarness();
  try {
    await seedPublicPost(harness.db, "views-rate-fill", "Rate fill");
    await seedPublicPost(harness.db, "views-rate-target", "Rate target");
    const address = "203.0.113.77";
    let limited = null;
    for (let attempt = 0; attempt < 320; attempt += 1) {
      const response = await viewRequest(harness, "views-rate-fill", { address });
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    assert.ok(limited, "the local Cloudflare rate-limit binding should eventually reject the burst");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");

    const target = await viewRequest(harness, "views-rate-target", { address });
    assert.equal(target.status, 429, "a limited identity must be rejected before a fresh article can count");
    assert.equal((await harness.db.prepare("SELECT view_count FROM posts WHERE slug = 'views-rate-target'").first())?.view_count, 0);
    assert.equal((await harness.db.prepare(`SELECT COUNT(*) AS c FROM post_views
      WHERE post_id = (SELECT id FROM posts WHERE slug = 'views-rate-target')`).first())?.c, 0);
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS c FROM view_request_limits").first())?.c, 0);
  } finally {
    await closeTestHarness(harness);
  }
});

test("parallel requests for one server-side viewer add at most one daily event and count", async () => {
  const harness = await openTestHarness();
  try {
    await seedPublicPost(harness.db, "views-parallel", "Parallel views");
    const responses = await Promise.all(Array.from({ length: 12 }, () =>
      viewRequest(harness, "views-parallel", { address: "203.0.113.55" })));
    for (const response of responses) assert.equal(response.status, 200);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.equal(bodies.filter(({ counted }) => counted).length, 1);

    assert.equal((await harness.db.prepare("SELECT view_count FROM posts WHERE slug = 'views-parallel'").first())?.view_count, 1);
    assert.equal((await harness.db.prepare(`SELECT COUNT(*) AS c FROM post_views
      WHERE post_id = (SELECT id FROM posts WHERE slug = 'views-parallel')`).first())?.c, 1);
  } finally {
    await closeTestHarness(harness);
  }
});

test("view event and counter stay atomic when the insert fails", async () => {
  const harness = await openTestHarness();
  try {
    await seedPublicPost(harness.db, "views-atomic", "Views atomic");
    await harness.db.prepare(`CREATE TRIGGER reject_test_view_insert BEFORE INSERT ON post_views
      BEGIN SELECT RAISE(FAIL, 'injected view event failure'); END`).run();

    const response = await viewRequest(harness, "views-atomic");
    assert.equal(response.status, 500, "an injected storage failure must not report success");
    assert.equal((await harness.db.prepare("SELECT view_count FROM posts WHERE slug = 'views-atomic'").first())?.view_count, 0);
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS c FROM post_views").first())?.c, 0);

    await harness.db.prepare("DROP TRIGGER reject_test_view_insert").run();
    const recovered = await viewRequest(harness, "views-atomic");
    assert.deepEqual(await recovered.json(), { counted: true });
  } finally {
    await closeTestHarness(harness);
  }
});

test("expired raw view events are pruned while long-term totals persist", async () => {
  const harness = await openTestHarness();
  try {
    await seedPublicPost(harness.db, "views-retain", "Views retain");
    const post = await harness.db.prepare("SELECT id FROM posts WHERE slug = 'views-retain'").first();
    const today = new Date().toISOString().slice(0, 10);
    await harness.db.prepare(`INSERT INTO post_views (post_id, visitor_hash, viewed_on) VALUES
      (?, 'old-hash', '2026-05-01'), (?, 'fresh-hash', ?)`).bind(post.id, post.id, today).run();
    await harness.db.prepare("UPDATE posts SET view_count = 7 WHERE id = ?").bind(post.id).run();

    const pruned = await cleanupExpiredPostViews(harness.db, 90);
    assert.equal(pruned, 1, "only the raw event past the retention window may be removed");
    const events = (await harness.db.prepare("SELECT visitor_hash FROM post_views").all()).results ?? [];
    assert.deepEqual(events.map(({ visitor_hash }) => visitor_hash), ["fresh-hash"]);
    assert.equal((await harness.db.prepare("SELECT view_count FROM posts WHERE id = ?").bind(post.id).first())?.view_count, 7);
  } finally {
    await closeTestHarness(harness);
  }
});
