import assert from "node:assert/strict";
import test from "node:test";
import {
  closeTestHarness,
  jsonRequest,
  loginAdmin,
  openTestHarness,
} from "./harness.mjs";

const IDS = {
  newer: "01READSESSIONNEWER",
  current: "01READSESSIONCURRENT",
  older: "01READSESSIONOLDER",
  draft: "01READSESSIONDRAFT",
  private: "01READSESSIONPRIVATE",
};

async function seedReaderFixture(db) {
  await db.prepare(
    "INSERT INTO spaces (id, name, slug, sort_order) VALUES (?, ?, ?, ?)",
  ).bind(901, "Read Session Private", "read-session-private", 0).run();

  const insert = db.prepare(
    `INSERT INTO posts
      (public_id, title, slug, excerpt, content, category_id, space_id, status, published_at, updated_at)
      VALUES (?, ?, ?, '', ?, 1, ?, ?, ?, ?)`,
  );

  await insert.bind(
    IDS.newer, "Reader Newer", "reader-newer", "# newer", null, "published",
    "2026-09-03T00:00:00.000Z", "2026-09-03T00:00:00.000Z",
  ).run();
  await insert.bind(
    IDS.current, "Reader Current", "reader-current", "# current", null, "published",
    "2026-09-02T00:00:00.000Z", "2026-09-02T00:00:00.000Z",
  ).run();
  await insert.bind(
    IDS.older, "Reader Older", "reader-older", "# older", null, "published",
    "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z",
  ).run();
  await insert.bind(
    IDS.draft, "Reader Draft Secret", "reader-draft-secret", "# draft", null, "draft",
    "2026-09-04T00:00:00.000Z", "2026-09-04T00:00:00.000Z",
  ).run();
  await insert.bind(
    IDS.private, "Reader Private Secret", "reader-private-secret", "# private", 901, "published",
    "2026-08-31T00:00:00.000Z", "2026-08-31T00:00:00.000Z",
  ).run();

  const current = await db.prepare("SELECT id FROM posts WHERE public_id = ?").bind(IDS.current).first();
  assert.ok(current?.id);
  await db.prepare(
    "INSERT INTO post_slug_history (post_id, slug) VALUES (?, ?)",
  ).bind(current.id, "reader-current-old-slug").run();
}

test("public reader resolves slug, public ID, history, and public-only neighbors", async () => {
  const harness = await openTestHarness();
  try {
    await seedReaderFixture(harness.db);

    const current = await jsonRequest(harness, "/api/reader/reader-current");
    assert.equal(current.status, 200);
    const body = await current.json();
    assert.equal(body.post.publicId, IDS.current);
    assert.equal(body.previousPost.publicId, IDS.newer);
    assert.equal(body.nextPost.publicId, IDS.older);
    assert.notEqual(body.previousPost.publicId, IDS.draft);
    assert.notEqual(body.nextPost.publicId, IDS.private);

    const byPublicId = await jsonRequest(harness, `/api/reader/${IDS.current}`);
    assert.equal(byPublicId.status, 200);
    assert.equal((await byPublicId.json()).post.slug, "reader-current");

    const byHistory = await jsonRequest(harness, "/api/reader/reader-current-old-slug");
    assert.equal(byHistory.status, 200);
    assert.equal((await byHistory.json()).post.publicId, IDS.current);
  } finally {
    await closeTestHarness(harness);
  }
});

test("public reader keeps draft and private-space posts closed while admin reader remains separate", async () => {
  const harness = await openTestHarness();
  try {
    await seedReaderFixture(harness.db);

    const draft = await jsonRequest(harness, "/api/reader/reader-draft-secret");
    assert.equal(draft.status, 404);

    const privatePost = await jsonRequest(harness, "/api/reader/reader-private-secret");
    assert.equal(privatePost.status, 404);

    const cookie = await loginAdmin(harness);
    const adminDraft = await jsonRequest(
      harness,
      "/api/reader/reader-draft-secret?scope=admin",
      { cookie },
    );
    assert.equal(adminDraft.status, 200);
    assert.equal((await adminDraft.json()).post.publicId, IDS.draft);

    const adminPrivate = await jsonRequest(
      harness,
      "/api/reader/reader-private-secret?scope=admin",
      { cookie },
    );
    assert.equal(adminPrivate.status, 200);
    assert.equal((await adminPrivate.json()).post.publicId, IDS.private);
  } finally {
    await closeTestHarness(harness);
  }
});
