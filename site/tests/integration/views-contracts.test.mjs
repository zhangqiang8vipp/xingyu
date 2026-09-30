import assert from "node:assert/strict";
import test from "node:test";
import { closeTestHarness, openTestHarness } from "./harness.mjs";
import { cleanupExpiredPostViews, coarseReaderAddress, rateIdentityHash, VIEWS_IDENTITY_SECRET_FALLBACK } from "../../db/view-tracking.ts";

async function viewRequest(harness, slug, { address = "203.0.113.7", visitor = "legacy-client-visitor" } = {}) {
  return harness.dispatch(`/api/views/${slug}`, {
    method: "POST",
    headers: { "cf-connecting-ip": address, "content-type": "application/json" },
    body: JSON.stringify({ visitor }),
  });
}

test("client-supplied forwarding headers cannot mint a new reader identity", () => {
  const request = new Request("https://example.test/api/views/post", {
    headers: { "x-forwarded-for": "198.51.100.99" },
  });
  assert.equal(coarseReaderAddress(request), "local");
});

test("production view tracking refuses a missing identity secret without writing", async () => {
  const harness = await openTestHarness({ vars: { APP_ENV: "production", DB_SCHEMA_MODE: "local-preview-bootstrap" } });
  try {
    await harness.db.prepare(`INSERT INTO posts
      (public_id, title, slug, content, category_id, space_id, status, published_at)
      VALUES ('views-secret', 'Secret guard', 'views-secret', 'body', 1, NULL, 'published', '2026-01-01')`).run();
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
    await harness.db.prepare(`INSERT INTO posts
      (public_id, title, slug, content, category_id, space_id, status, published_at)
      VALUES ('views-public', 'Public views', 'views-public', 'body', 1, NULL, 'published', '2026-01-01')`).run();

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
    const slug = await harness.db.prepare("SELECT slug FROM posts WHERE public_id = 'views-private'").first();

    for (const target of ["views-draft", "views-private", "views-missing"]) {
      const response = await viewRequest(harness, target);
      assert.equal(response.status, 204, `${target} must share the same silent response`);
    }
    assert.equal((await harness.db.prepare("SELECT COUNT(*) AS c FROM post_views").first())?.c, 0,
      "non-public targets must never write view events");
    assert.equal(slug?.slug, "views-private");
  } finally {
    await closeTestHarness(harness);
  }
});

test("abusive bursts are limited without blocking other readers", async () => {
  const harness = await openTestHarness();
  try {
    await harness.db.prepare(`INSERT INTO posts
      (public_id, title, slug, content, category_id, space_id, status, published_at)
      VALUES ('views-limited', 'Views limited', 'views-limited', 'body', 1, NULL, 'published', '2026-01-01')`).run();

    const abusive = await rateIdentityHash(VIEWS_IDENTITY_SECRET_FALLBACK, "203.0.113.99");
    const now = Date.now();
    await harness.db.prepare(`INSERT INTO view_request_limits (identity_hash, attempts, window_started, blocked_until, updated_at)
      VALUES (?, 240, ?, 0, ?)`).bind(abusive, now, now).run();

    const limited = await viewRequest(harness, "views-limited", { address: "203.0.113.99" });
    assert.equal(limited.status, 429, "a reader past the window capacity must be throttled");
    assert.equal(limited.headers.get("retry-after"), "60");

    const blocked = await harness.db.prepare("UPDATE view_request_limits SET blocked_until = ? WHERE identity_hash = ?")
      .bind(now + 60000, abusive).run();
    assert.equal(blocked.meta?.changes, 1);
    const stillLimited = await viewRequest(harness, "views-limited", { address: "203.0.113.99" });
    assert.equal(stillLimited.status, 429, "a blocked reader stays limited until the block expires");

    const innocent = await viewRequest(harness, "views-limited", { address: "203.0.113.100" });
    assert.deepEqual(await innocent.json(), { counted: true },
      "throttling one identity must not affect another");
    const count = await harness.db.prepare("SELECT view_count FROM posts WHERE slug = 'views-limited'").first();
    assert.equal(count?.view_count, 1);
  } finally {
    await closeTestHarness(harness);
  }
});

test("parallel requests cannot exceed the last available rate slot", async () => {
  const harness = await openTestHarness();
  try {
    await harness.db.prepare(`INSERT INTO posts
      (public_id, title, slug, content, category_id, space_id, status, published_at)
      VALUES ('views-parallel', 'Parallel views', 'views-parallel', 'body', 1, NULL, 'published', '2026-01-01')`).run();
    const address = "203.0.113.55";
    const identity = await rateIdentityHash(VIEWS_IDENTITY_SECRET_FALLBACK, address);
    const now = Date.now();
    await harness.db.prepare(`INSERT INTO view_request_limits
      (identity_hash, attempts, window_started, blocked_until, updated_at)
      VALUES (?, 239, ?, 0, ?)`).bind(identity, now, now).run();

    const responses = await Promise.all(Array.from({ length: 8 }, () =>
      viewRequest(harness, "views-parallel", { address })));
    const statuses = responses.map((response) => response.status);
    assert.equal(statuses.filter((status) => status === 200).length, 1,
      "only the last available slot may pass under concurrent requests");
    assert.equal(statuses.filter((status) => status === 429).length, 7);
  } finally {
    await closeTestHarness(harness);
  }
});

test("view event and counter stay atomic when the insert fails", async () => {
  const harness = await openTestHarness();
  try {
    await harness.db.prepare(`INSERT INTO posts
      (public_id, title, slug, content, category_id, space_id, status, published_at)
      VALUES ('views-atomic', 'Views atomic', 'views-atomic', 'body', 1, NULL, 'published', '2026-01-01')`).run();
    await harness.db.prepare(`CREATE TRIGGER reject_test_view_insert BEFORE INSERT ON post_views
      BEGIN SELECT RAISE(FAIL, 'injected view event failure'); END`).run();

    const response = await viewRequest(harness, "views-atomic");
    assert.equal(response.status, 500, "an injected storage failure must not report success");
    const count = await harness.db.prepare("SELECT view_count FROM posts WHERE slug = 'views-atomic'").first();
    assert.equal(count?.view_count, 0, "the counter must not drift when the event insert fails");
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
    await harness.db.prepare(`INSERT INTO posts
      (public_id, title, slug, content, category_id, space_id, status, published_at)
      VALUES ('views-retain', 'Views retain', 'views-retain', 'body', 1, NULL, 'published', '2026-01-01')`).run();
    const post = await harness.db.prepare("SELECT id FROM posts WHERE slug = 'views-retain'").first();
    const today = new Date().toISOString().slice(0, 10);
    await harness.db.prepare(`INSERT INTO post_views (post_id, visitor_hash, viewed_on) VALUES
      (?, 'old-hash', '2026-05-01'), (?, 'fresh-hash', ?)`).bind(post.id, post.id, today).run();
    await harness.db.prepare("UPDATE posts SET view_count = 7 WHERE id = ?").bind(post.id).run();

    const pruned = await cleanupExpiredPostViews(harness.db, 90);
    assert.equal(pruned, 1, "only the raw event past the retention window may be removed");
    const events = (await harness.db.prepare("SELECT visitor_hash FROM post_views").all()).results ?? [];
    assert.deepEqual(events.map(({ visitor_hash }) => visitor_hash), ["fresh-hash"]);
    const count = await harness.db.prepare("SELECT view_count FROM posts WHERE id = ?").bind(post.id).first();
    assert.equal(count?.view_count, 7, "pruning raw events must never touch long-term totals");
  } finally {
    await closeTestHarness(harness);
  }
});
