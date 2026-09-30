import { eq } from "drizzle-orm";
import { getDb } from ".";
import { siteMemberships } from "./schema";

// Phase 1 resolves every write to the single site owner. The identity base
// (users / user_identities / site_memberships) exists so OAuth sign-in for
// domestic and international providers can grow onto it without a schema
// rework: new providers only add (provider, subject) identity rows.
let cachedOwnerUserId: number | null = null;

export async function getSiteOwnerUserId(): Promise<number> {
  if (cachedOwnerUserId !== null) return cachedOwnerUserId;
  const rows = await getDb().select({ userId: siteMemberships.userId })
    .from(siteMemberships).where(eq(siteMemberships.role, "owner")).limit(1);
  if (!rows[0]) {
    throw new Error("站点 owner 缺失：归属无法解析（先应用迁移与种子）");
  }
  cachedOwnerUserId = rows[0].userId;
  return cachedOwnerUserId;
}