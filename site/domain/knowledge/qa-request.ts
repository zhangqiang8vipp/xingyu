/** Read only a capped request body before JSON parsing; avoids buffering a hostile upload. */
export async function readLimitedAskBody(request: Request, maxBytes = 2400): Promise<string | null> {
  const sizeHeader = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(sizeHeader) && sizeHeader > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(item.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
