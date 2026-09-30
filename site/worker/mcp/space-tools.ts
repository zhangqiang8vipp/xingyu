import { z } from "zod";
import { createSpace, deleteSpace, getSpacePath, resolveSpace, updateSpace } from "@/db/spaces";
import { requireScope } from "../mcp-auth";
import {
  CHANGE_SUMMARY_SCHEMA,
  MCP_ERROR_OUTPUT_FIELDS,
  RECEIPT_OUTPUT_SCHEMA,
  SPACE_SCHEMA,
  activityReceipt,
  toolFailure,
  toolResult,
  type McpToolContext,
} from "./shared";

export function registerSpaceTools({ server, clientLabel, auth }: McpToolContext) {
  server.registerTool("create_space", {
    title: "创建知识空间",
    description: "创建顶级空间或任意空间的子空间。同级空间按 sort_order 从小到大浏览，默认 0。写入前应向用户说明空间名称、父路径与用途。",
    inputSchema: { name: z.string().trim().min(1).max(100), parent: SPACE_SCHEMA.optional(), sort_order: z.number().int().optional(), change_summary: CHANGE_SUMMARY_SCHEMA },
    outputSchema: { space: z.record(z.string(), z.unknown()).optional(), receipt: RECEIPT_OUTPUT_SCHEMA.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ name, parent, sort_order, change_summary }) => {
    try {
      requireScope(auth, "xingyu.draft");
      const parentSpace = parent ? await resolveSpace(parent) : null;
      const created = await createSpace({ name, parentId: parentSpace?.id ?? null, sortOrder: sort_order }, {
        action: "create_space", afterParentId: parentSpace?.id ?? null,
        changedFields: sort_order === undefined ? ["name", "parent"] : ["name", "parent", "sort_order"], summary: change_summary, clientLabel,
      });
      const path = await getSpacePath(created.id);
      const { activity, ...spaceData } = created;
      return toolResult({ ok: true, space: { ...spaceData, display_path: path.map((item) => item.name).join(" / ") }, receipt: activityReceipt("create_space", activity, change_summary, sort_order === undefined ? ["name", "parent"] : ["name", "parent", "sort_order"]) });
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("update_space", {
    title: "修改或移动知识空间",
    description: "重要操作：重命名、移动空间，或设置同级空间的浏览顺序（sort_order 越小越靠前）；移动时所有后代与文章会一起移动。",
    inputSchema: { space: SPACE_SCHEMA, name: z.string().trim().min(1).max(100).optional(), parent: SPACE_SCHEMA.nullable().optional(), sort_order: z.number().int().optional(), change_summary: CHANGE_SUMMARY_SCHEMA },
    outputSchema: { space: z.record(z.string(), z.unknown()).optional(), receipt: RECEIPT_OUTPUT_SCHEMA.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ space, name, parent, sort_order, change_summary }) => {
    try {
      requireScope(auth, "xingyu.publish");
      const current = await resolveSpace(space);
      const parentSpace = typeof parent === "string" ? await resolveSpace(parent) : parent === null ? null : undefined;
      const changedFields = [
        name !== undefined && name.trim() !== current.name ? "name" : null,
        parentSpace !== undefined && (parentSpace?.id ?? null) !== current.parentId ? "parent" : null,
        sort_order !== undefined && sort_order !== current.sortOrder ? "sort_order" : null,
      ].filter((field): field is string => field !== null);
      if (!changedFields.length) {
        const path = await getSpacePath(current.id);
        return toolResult({
          ok: true,
          space: { ...current, display_path: path.map((item) => item.name).join(" / ") },
          receipt: { action: "update_space", activity_id: null, summary: "空间没有变化，未执行写入。", changed_fields: [], recorded_at: null },
        });
      }
      const updated = await updateSpace(current.id, { name, parentId: parentSpace === undefined ? undefined : parentSpace?.id ?? null, sortOrder: sort_order }, {
        action: "update_space", beforeParentId: current.parentId,
        afterParentId: parentSpace === undefined ? current.parentId : parentSpace?.id ?? null,
        changedFields, summary: change_summary, clientLabel,
      });
      const path = await getSpacePath(updated.id);
      const { activity, ...spaceData } = updated;
      return toolResult({ ok: true, space: { ...spaceData, display_path: path.map((item) => item.name).join(" / ") }, receipt: activityReceipt("update_space", activity, change_summary, changedFields) });
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("move_space", {
    title: "移动知识空间",
    description: "重要操作：将空间及其所有后代与文章移动到新的父空间。移动到知识空间根层时 parent 传 null。",
    inputSchema: { space: SPACE_SCHEMA, parent: SPACE_SCHEMA.nullable(), change_summary: CHANGE_SUMMARY_SCHEMA },
    outputSchema: { space: z.record(z.string(), z.unknown()).optional(), receipt: RECEIPT_OUTPUT_SCHEMA.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ space, parent, change_summary }) => {
    try {
      requireScope(auth, "xingyu.publish");
      const current = await resolveSpace(space);
      const parentSpace = parent === null ? null : await resolveSpace(parent);
      if ((parentSpace?.id ?? null) === current.parentId) {
        const path = await getSpacePath(current.id);
        return toolResult({
          ok: true,
          space: { ...current, display_path: path.map((item) => item.name).join(" / ") },
          receipt: { action: "move_space", activity_id: null, summary: "空间已在目标位置，未执行写入。", changed_fields: [], recorded_at: null },
        });
      }
      const updated = await updateSpace(current.id, { parentId: parentSpace?.id ?? null }, {
        action: "move_space", beforeParentId: current.parentId, afterParentId: parentSpace?.id ?? null,
        changedFields: ["parent"], summary: change_summary, clientLabel,
      });
      const path = await getSpacePath(updated.id);
      const { activity, ...spaceData } = updated;
      return toolResult({ ok: true, space: { ...spaceData, display_path: path.map((item) => item.name).join(" / ") }, receipt: activityReceipt("move_space", activity, change_summary, ["parent"]) });
    } catch (error) { return toolFailure(error); }
  });

  server.registerTool("delete_space", {
    title: "删除知识空间",
    description: "高风险操作：可仅删除空空间、将内容移动到另一知识空间后删除，或递归删除全部后代与文章。递归删除必须提供与空间名称完全一致的确认文本。",
    inputSchema: {
      space: SPACE_SCHEMA,
      mode: z.enum(["empty", "move", "recursive"]).default("empty"),
      move_to: SPACE_SCHEMA.optional().describe("mode=move 时必填；接收原空间直属文章和子空间的目标知识空间"),
      confirm_name: z.string().optional().default(""),
      change_summary: CHANGE_SUMMARY_SCHEMA,
    },
    outputSchema: { result: z.record(z.string(), z.unknown()).optional(), receipt: RECEIPT_OUTPUT_SCHEMA.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ space, mode, move_to, confirm_name, change_summary }) => {
    try {
      requireScope(auth, "xingyu.publish");
      const current = await resolveSpace(space);
      const moveTarget = mode === "move" && move_to ? await resolveSpace(move_to) : null;
      if (mode === "move" && !moveTarget) throw new Error("移动内容后删除必须提供 move_to 目标知识空间");
      const changedFields = mode === "recursive"
        ? ["space", "descendants", "articles"]
        : mode === "move"
          ? ["space", "children_parent", "article_space"]
          : ["space"];
      const result = await deleteSpace(current.id, { mode, moveTo: moveTarget?.id, confirmName: confirm_name }, {
        action: "delete_space",
        beforeParentId: current.parentId, changedFields,
        summary: change_summary, clientLabel,
      });
      const { activity, ...resultData } = result;
      return toolResult({ ok: true, result: resultData, receipt: activityReceipt("delete_space", activity, change_summary, changedFields) });
    } catch (error) { return toolFailure(error); }
  });
}
