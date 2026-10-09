import { importKnowledgeItems, KnowledgeImportError } from "@/db/knowledge-import";
import { isAdminRequest, unauthorized } from "@/server/auth/admin-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest(request))) return unauthorized();

  try {
    const { id } = await params;
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new KnowledgeImportError("导入请求无法读取，请重新选择文件后重试");
    }
    const report = await importKnowledgeItems(
      Number(id),
      (payload as Record<string, unknown>).items,
    );
    return Response.json(report);
  } catch (error) {
    if (error instanceof KnowledgeImportError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "知识导入失败，请刷新空间后重试" }, { status: 500 });
  }
}
