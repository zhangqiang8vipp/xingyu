import { createAttachment, AttachmentError, attachmentMarkdown, attachmentUrl } from "@/db/attachments";
import { ensurePersonalWorkspace } from "@/db/workspace-access";
import { scopedPost, WorkspaceContentError } from "@/db/workspace-content";

export type AttachmentUploadAccess = { isAdmin: true; userId?: never } | { isAdmin: false; userId: number };

/** Raw Worker handler for multipart uploads, bypassing Vinext's Server Action classifier. */
export async function handleAttachmentUpload(request: Request, access: AttachmentUploadAccess): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "无效请求来源" }, { status: 403, headers });
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data;")) {
    return Response.json({ error: "请使用 multipart/form-data 上传附件" }, { status: 415, headers });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > 12_000_000) {
    return Response.json({ error: "附件过大" }, { status: 413, headers });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "请选择附件" }, { status: 400, headers });
    if (file.size > 8 * 1024 * 1024) return Response.json({ error: "单文件最大 8 MB" }, { status: 413, headers });

    const postIdValue = form.get("postId");
    if (postIdValue !== null && (typeof postIdValue !== "string"
      || !/^[1-9]\d*$/.test(postIdValue)
      || !Number.isSafeInteger(Number(postIdValue)))) {
      throw new AttachmentError("文章标识无效");
    }
    const postId = postIdValue === null ? null : Number(postIdValue);
    let workspaceId = 1;
    let actorUserId: number | undefined;
    let audit: { summary: string; clientLabel: string } | undefined;

    if (!access.isAdmin) {
      actorUserId = access.userId;
      workspaceId = await ensurePersonalWorkspace(access.userId);
      if (postId !== null) await scopedPost(access.userId, workspaceId, postId);
      audit = { summary: "上传个人文章附件", clientLabel: "web:" + access.userId };
    }

    const record = await createAttachment({
      name: file.name,
      contentType: file.type || fallbackContentType(file.name),
      bytes: new Uint8Array(await file.arrayBuffer()),
      postId,
      ...(access.isAdmin ? {} : { workspaceId, actorUserId, audit }),
    });
    const attachment = {
      id: record.publicId,
      name: record.originalName,
      contentType: record.contentType,
      size: record.size,
      createdAt: record.createdAt,
      url: attachmentUrl(record),
      markdown: attachmentMarkdown(record),
    };
    return Response.json({ ...attachment, attachment }, { status: 201, headers });
  } catch (error) {
    if (error instanceof AttachmentError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof WorkspaceContentError) return Response.json({ error: error.message }, { status: error.status, headers });
    console.error("attachment upload failed", error instanceof Error ? error.name : "unknown");
    return Response.json({ error: "附件存储服务暂时不可用，请稍后重试" }, { status: 503, headers });
  }
}

function fallbackContentType(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return ({
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    log: "text/plain",
    csv: "text/csv",
    json: "application/json",
    zip: "application/zip",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  } as Record<string, string>)[extension || ""] || "application/octet-stream";
}
