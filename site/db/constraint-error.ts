export function isUniqueConstraintError(error: unknown, columns: string) {
  let cause = error;
  while (cause instanceof Error) {
    if (cause.message.includes(`UNIQUE constraint failed: ${columns}`)) return true;
    cause = cause.cause;
  }
  return false;
}
