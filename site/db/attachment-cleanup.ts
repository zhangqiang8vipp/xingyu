export type AttachmentCleanupOperation = "upload_rollback" | "delete" | "expired_unbound";

export const UNBOUND_ATTACHMENT_RETENTION_DAYS = 30;

export class AttachmentCleanupRequiredError extends Error {
  readonly publicId: string;
  readonly objectKey: string;

  constructor(publicId: string, objectKey: string, cause: unknown) {
    super(`附件存储清理未完成，请记录附件 ID ${publicId} 并联系管理员`, { cause });
    this.name = "AttachmentCleanupRequiredError";
    this.publicId = publicId;
    this.objectKey = objectKey;
  }
}

function errorLabel(error: unknown) {
  const label = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return label.slice(0, 300);
}

/**
 * Best-effort persistence of a failed R2 cleanup into `attachment_cleanup_queue`.
 * The D1 row owns reachability; the queue gives operators a durable, resolvable
 * record of objects that still need exact-key reclaiming. A queue write failure
 * must never mask the original storage error.
 */
export async function enqueueAttachmentCleanup(
  db: D1Database | null,
  publicId: string,
  objectKey: string,
  operation: AttachmentCleanupOperation,
  error: unknown,
) {
  if (!db) return;
  try {
    await db.prepare(`INSERT INTO attachment_cleanup_queue
        (public_id, object_key, operation, status, attempts, last_error)
        VALUES (?, ?, ?, 'pending', 1, ?)
        ON CONFLICT(object_key) DO UPDATE SET
          status = 'pending', attempts = attempts + 1,
          last_error = excluded.last_error, updated_at = CURRENT_TIMESTAMP`)
      .bind(publicId, objectKey, operation, errorLabel(error)).run();
  } catch (queueError) {
    console.error(JSON.stringify({
      event: "attachment_cleanup_queue_write_failed",
      publicId,
      objectKey,
      operation,
      queueErrorType: queueError instanceof Error ? queueError.name : typeof queueError,
    }));
  }
}

/**
 * Idempotently queues unbound attachments whose unbound age exceeds the
 * retention window. The clock starts at `unbound_at` (reset whenever an
 * article is deleted and detaches its attachment) so recently detached files
 * are never mistaken for stale ones. Nothing is deleted here: operators still
 * verify the R2 object by exact key and resolve the queue entry.
 */
export async function enqueueExpiredUnboundAttachments(
  db: D1Database | null,
  retentionDays = UNBOUND_ATTACHMENT_RETENTION_DAYS,
) {
  if (!db) return 0;
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
    throw new Error(`Invalid unbound attachment retention: ${retentionDays}`);
  }
  const result = await db.prepare(`INSERT INTO attachment_cleanup_queue
      (public_id, object_key, operation, status, attempts, last_error)
      SELECT public_id, object_key, 'expired_unbound', 'pending', 1, 'expired unbound attachment'
      FROM attachments
      WHERE post_id IS NULL
        AND COALESCE(unbound_at, created_at) < datetime('now', '-' || ? || ' days')
      ON CONFLICT(object_key) DO UPDATE SET
        status = 'pending', attempts = attempts + 1,
        last_error = excluded.last_error, updated_at = CURRENT_TIMESTAMP`)
    .bind(retentionDays).run();
  return result.meta.changes ?? 0;
}

export async function cleanupFailedAttachmentUpload(
  store: { delete(key: string): Promise<void> },
  publicId: string,
  objectKey: string,
  writeError: unknown,
  db: D1Database | null = null,
) {
  try {
    await store.delete(objectKey);
  } catch (cleanupError) {
    console.error(JSON.stringify({
      event: "attachment_object_cleanup_required",
      publicId,
      objectKey,
      writeErrorType: writeError instanceof Error ? writeError.name : typeof writeError,
      cleanupErrorType: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
    }));
    await enqueueAttachmentCleanup(db, publicId, objectKey, "upload_rollback", cleanupError);
    throw new AttachmentCleanupRequiredError(publicId, objectKey, writeError);
  }
}