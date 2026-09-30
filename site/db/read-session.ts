import { env } from "cloudflare:workers";
import {
  createPublicReadSessionFromDatabase,
  type PublicReadSession,
  type PublicReadSessionStart,
} from "./read-session-core";

export type { PublicReadSession, PublicReadSessionStart } from "./read-session-core";

/**
 * Creates a D1 session for public read paths.
 *
 * The default is first-unconstrained so D1 may route the first read to a replica.
 * Use first-primary only when a caller explicitly requires the latest primary state.
 * A bookmark continues a previous session from at least the version it observed.
 */
export function createPublicReadSession(
  start: PublicReadSessionStart = "first-unconstrained",
): PublicReadSession {
  return createPublicReadSessionFromDatabase(env.DB, start);
}

/** Runs one public request inside a single D1 consistency context. */
export function withPublicReadSession<T>(
  read: (session: PublicReadSession) => Promise<T>,
  start: PublicReadSessionStart = "first-unconstrained",
) {
  return read(createPublicReadSession(start));
}
