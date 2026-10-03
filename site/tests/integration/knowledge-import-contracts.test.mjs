import assert from "node:assert/strict";
import test from "node:test";
import {
  closeTestHarness,
  jsonRequest,
  loginAdmin,
  openTestHarness,
} from "./harness.mjs";

test("private knowledge import is stable, non-publishing, and never overwrites", async () => {
  const harness = await openTestHarness();
  try {
    const anonymous = await jsonRequest(harness, "/api/spaces/1/import", {
      method: "POST",
      body: { items: [{ name: "anonymous.md", content: "secret" }] },
    });
    assert.equal(anonymous.status, 401);

    const cookie = await loginAdmin(harness);
    const createdSpace = await jsonRequest(harness, "/api/spaces", {
      method: "POST",
      cookie,
      body: { name: "Imported knowledge" },
    });
    assert.equal(createdSpace.status, 201);
    const spaceId = (await createdSpace.json()).space.id;

    const exactText = "\nplain text\nline 2\n";
    const overlongName = `${"x".repeat(201)}.md`;
    const first = await jsonRequest(harness, `/api/spaces/${spaceId}/import`, {
      method: "POST",
      cookie,
      body: {
        items: [
          { name: "Alpha Note.md", content: "# Alpha\nBody\n" },
          { name: "plain.txt", content: exactText },
          { name: "empty.markdown", content: "  \n\t" },
          { name: "binary.pdf", content: "not supported" },
          { name: overlongName, content: "valid body" },
        ],
      },
    });
    assert.equal(first.status, 200);
    const report = await first.json();
    assert.deepEqual(report.summary, { total: 5, imported: 2, failed: 3 });
    assert.equal(report.results[0].status, "imported");
    assert.equal(report.results[1].status, "imported");
    assert.equal(report.results[2].error.code, "invalid");
    assert.match(report.results[2].error.message, /空文件/);
    assert.equal(report.results[3].error.code, "invalid");
    assert.match(report.results[3].error.message, /\.md、\.markdown 或 \.txt/);
    assert.equal(report.results[4].error.code, "invalid");
    assert.match(report.results[4].error.message, /200/);

    const stored = await harness.db.prepare(`SELECT title, slug, content, status, space_id, featured, published_at
      FROM posts WHERE space_id = ? ORDER BY id ASC`).bind(spaceId).all();
    assert.equal(stored.results.length, 2);
    assert.deepEqual(stored.results[0], {
      title: "Alpha Note",
      slug: `knowledge-${spaceId}-alpha-note`,
      content: "# Alpha\nBody\n",
      status: "draft",
      space_id: spaceId,
      featured: 0,
      published_at: null,
    });
    assert.deepEqual(stored.results[1], {
      title: "plain",
      slug: `knowledge-${spaceId}-plain`,
      content: exactText,
      status: "draft",
      space_id: spaceId,
      featured: 0,
      published_at: null,
    });

    const duplicate = await jsonRequest(harness, `/api/spaces/${spaceId}/import`, {
      method: "POST",
      cookie,
      body: { items: [{ name: "Alpha Note.md", content: "# CHANGED" }] },
    });
    assert.equal(duplicate.status, 200);
    const duplicateReport = await duplicate.json();
    assert.deepEqual(duplicateReport.summary, { total: 1, imported: 0, failed: 1 });
    assert.equal(duplicateReport.results[0].error.code, "duplicate");
    const retained = await harness.db.prepare("SELECT content FROM posts WHERE slug = ?")
      .bind(`knowledge-${spaceId}-alpha-note`).first();
    assert.equal(retained.content, "# Alpha\nBody\n");

    const hundredItems = Array.from({ length: 100 }, (_, index) => ({
      name: `bulk-${String(index).padStart(3, "0")}.md`,
      content: `# Bulk ${index}\n`,
    }));
    const hundred = await jsonRequest(harness, `/api/spaces/${spaceId}/import`, {
      method: "POST",
      cookie,
      body: { items: hundredItems },
    });
    assert.equal(hundred.status, 200);
    assert.deepEqual((await hundred.json()).summary, { total: 100, imported: 100, failed: 0 });

    const tooMany = await jsonRequest(harness, `/api/spaces/${spaceId}/import`, {
      method: "POST",
      cookie,
      body: {
        items: Array.from({ length: 101 }, (_, index) => ({
          name: `too-many-${index}.txt`,
          content: "x",
        })),
      },
    });
    assert.equal(tooMany.status, 400);
    assert.match((await tooMany.json()).error, /100/);

    const missingSpace = await jsonRequest(harness, "/api/spaces/999999/import", {
      method: "POST",
      cookie,
      body: { items: [{ name: "orphan.md", content: "x" }] },
    });
    assert.equal(missingSpace.status, 404);

    const privacy = await harness.db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS drafts,
      SUM(CASE WHEN published_at IS NULL THEN 1 ELSE 0 END) AS unpublished,
      SUM(CASE WHEN featured = 0 THEN 1 ELSE 0 END) AS unfeatured
      FROM posts WHERE space_id = ?`).bind(spaceId).first();
    assert.deepEqual(privacy, {
      total: 102,
      drafts: 102,
      unpublished: 102,
      unfeatured: 102,
    });
  } finally {
    await closeTestHarness(harness);
  }
});
