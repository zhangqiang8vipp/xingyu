import { env } from "cloudflare:workers";
import { ensureDatabase } from "./bootstrap";

export type PublicReadSessionStart =
  | "first-unconstrained"
  | "first-primary"
  | { bookmark: string };

type PublicReadBinding = string | number | null;

type PublicReadExecutor = Pick<D1Database, "prepare">;

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

function createReadOnlyAdapter(executor: PublicReadExecutor, getBookmark: () => string | null): PublicReadSession {
  return {
    async first<T extends Record<string, unknown>>(
      sql: string,
      bindings: readonly PublicReadBinding[] = [],
    ) {
      assertReadOnlySql(sql);
      return executor.prepare(sql).bind(...bindings).first<T>();
    },
    getBookmark,
  };
}

/**
 * Creates a D1 session for public read paths.
 *
 * The default is first-unconstrained so D1 may route the first read to a replica.
 * Use first-primary only when a caller explicitly requires the latest primary state.
 * A bookmark continues a previous session from at least the version it observed.
 *
 * This wrapper intentionally exposes only read execution plus getBookmark(); it does
 * not expose run(), batch(), or the underlying D1DatabaseSession, so public callers
 * cannot accidentally send writes through this abstraction.
 */
export function createPublicReadSession(
  start: PublicReadSessionStart = "first-unconstrained",
): PublicReadSession {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");

  // Some local/test adapters predate the Sessions API. Absence is compatible;
  // an actual withSession() failure is not and must propagate to the caller.
  if (typeof env.DB.withSession !== "function") {
    return createReadOnlyAdapter(env.DB, () => null);
  }

  const session = env.DB.withSession(sessionConstraint(start));
  return createReadOnlyAdapter(session, () => session.getBookmark());
}


/** Runs one public request inside a single D1 consistency context. */
export async function withPublicReadSession<T>(
  read: (session: PublicReadSession) => Promise<T>,
  start: PublicReadSessionStart = "first-unconstrained",
) {
  await ensureDatabase();
  return read(createPublicReadSession(start));
}
