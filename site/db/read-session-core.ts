export type PublicReadSessionStart =
  | "first-unconstrained"
  | "first-primary"
  | { bookmark: string };

type PublicReadBinding = string | number | null;

type PublicReadDatabase = Pick<D1Database, "withSession">;

type PublicReadExecutor = ReturnType<D1Database["withSession"]>;

export type PublicReadSession = {
  first<T extends Record<string, unknown>>(
    sql: string,
    bindings?: readonly PublicReadBinding[],
  ): Promise<T | null>;
  getBookmark(): string | null;
};

const WRITE_SQL = /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|REINDEX|ATTACH|DETACH|PRAGMA)\b/i;

function assertReadOnlySql(sql: string) {
  const normalized = sql.trim();
  if (!/^(?:SELECT|WITH)\b/i.test(normalized) || WRITE_SQL.test(normalized) || normalized.includes(";")) {
    throw new Error("Public read sessions accept one read-only SELECT statement");
  }
}

function sessionConstraint(start: PublicReadSessionStart) {
  if (typeof start === "string") return start;
  const bookmark = start.bookmark.trim();
  if (!bookmark) throw new Error("Public read session bookmark must not be empty");
  return bookmark;
}

function createReadOnlyAdapter(executor: PublicReadExecutor): PublicReadSession {
  return {
    async first<T extends Record<string, unknown>>(
      sql: string,
      bindings: readonly PublicReadBinding[] = [],
    ) {
      assertReadOnlySql(sql);
      return executor.prepare(sql).bind(...bindings).first<T>();
    },
    getBookmark() {
      return executor.getBookmark();
    },
  };
}

/**
 * Pure/testable core for the public read adapter.
 *
 * Missing Sessions support, session creation errors, and statement errors all
 * propagate. There is deliberately no fallback to plain D1Database.prepare().
 */
export function createPublicReadSessionFromDatabase(
  database: PublicReadDatabase | null | undefined,
  start: PublicReadSessionStart = "first-unconstrained",
): PublicReadSession {
  if (!database || typeof database.withSession !== "function") {
    throw new Error("D1 Sessions API is unavailable");
  }
  return createReadOnlyAdapter(database.withSession(sessionConstraint(start)));
}
