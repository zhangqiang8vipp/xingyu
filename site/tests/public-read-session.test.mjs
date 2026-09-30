import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPublicReadSessionFromDatabase } from "../db/read-session-core.ts";

function fakeSession({ first = async () => ({ ok: true }), bookmark = "bookmark-1" } = {}) {
  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            first: () => first(sql, bindings),
          };
        },
      };
    },
    getBookmark() {
      return bookmark;
    },
  };
}

test("public read session defaults to replica-eligible first-unconstrained and exposes no write API", async () => {
  const constraints = [];
  const database = {
    withSession(constraint) {
      constraints.push(constraint);
      return fakeSession({
        first: async (sql, bindings) => ({ sql, bindings }),
        bookmark: "bookmark-2",
      });
    },
  };

  const reader = createPublicReadSessionFromDatabase(database);
  const row = await reader.first("SELECT ? AS value", [7]);

  assert.deepEqual(constraints, ["first-unconstrained"]);
  assert.deepEqual(row, { sql: "SELECT ? AS value", bindings: [7] });
  assert.equal(reader.getBookmark(), "bookmark-2");
  assert.equal("run" in reader, false);
  assert.equal("batch" in reader, false);
});

test("public read session passes bookmarks through and rejects empty bookmarks", () => {
  const constraints = [];
  const database = {
    withSession(constraint) {
      constraints.push(constraint);
      return fakeSession();
    },
  };

  createPublicReadSessionFromDatabase(database, { bookmark: "bookmark-from-request" });
  assert.deepEqual(constraints, ["bookmark-from-request"]);
  assert.throws(
    () => createPublicReadSessionFromDatabase(database, { bookmark: "   " }),
    /bookmark must not be empty/i,
  );
});

test("missing or failing D1 Sessions support fails closed without a plain-DB fallback", () => {
  assert.throws(
    () => createPublicReadSessionFromDatabase({}),
    /Sessions API is unavailable/i,
  );

  const database = {
    withSession() {
      throw new Error("injected session creation failure");
    },
  };
  assert.throws(
    () => createPublicReadSessionFromDatabase(database),
    /injected session creation failure/i,
  );
});

test("public read adapter rejects writes and propagates statement failures", async () => {
  let prepared = 0;
  const database = {
    withSession() {
      return fakeSession({
        first: async () => {
          throw new Error("injected statement failure");
        },
      });
    },
  };
  const reader = createPublicReadSessionFromDatabase({
    withSession() {
      return {
        ...database.withSession(),
        prepare(sql) {
          prepared += 1;
          return database.withSession().prepare(sql);
        },
      };
    },
  });

  await assert.rejects(reader.first("UPDATE posts SET title = 'x'"), /read-only SELECT/i);
  assert.equal(prepared, 0, "write SQL must be rejected before reaching D1");
  await assert.rejects(reader.first("SELECT 1"), /injected statement failure/i);
});

test("public reader route performs previous and next reads sequentially in one session", () => {
  const source = readFileSync(new URL("../app/api/reader/[slug]/route.ts", import.meta.url), "utf8");
  const publicBranch = source.slice(source.indexOf("await ensureDatabase();"));

  const previous = publicBranch.indexOf("await getPreviousPublishedPost");
  const next = publicBranch.indexOf("await getNextPublishedPost");

  assert.ok(previous >= 0, "public reader must await previous post");
  assert.ok(next > previous, "public reader must await next post after previous");
  assert.doesNotMatch(publicBranch, /Promise\.all\s*\(/, "public session reads must not run concurrently");
});
