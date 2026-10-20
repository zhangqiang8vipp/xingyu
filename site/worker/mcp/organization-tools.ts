import { z } from "zod";
import {
  changeOrganizationRole,
  createOrganization,
  leaveOrganization,
  listMyOrganizations,
  listOrganizationMembers,
  removeOrganizationMember,
  renameOrganization,
} from "@/db/organization-access";
import {
  addUnitMember,
  createOrganizationUnit,
  deleteOrganizationUnit,
  listOrganizationUnits,
  removeUnitMember,
  updateOrganizationUnit,
} from "@/db/organization-units";
import {
  createOrganizationTeam,
  deleteOrganizationTeam,
  listOrganizationTeams,
  setTeamMember,
  updateOrganizationTeam,
} from "@/db/team-workspaces";
import { requireScope } from "../mcp-auth";
import { MCP_ERROR_OUTPUT_FIELDS, toolFailure, toolResult, type McpToolContext } from "./shared";

const generic = z.record(z.string(), z.unknown());
const id = z.number().int().min(1);
const name = z.string().trim().min(1).max(100);
const manageDescription = "需要用户明确要求执行该组织变更。服务端仍会检查当前用户是否为该组织 Owner/Admin；加入组织不会自动授予任何个人工作区或文章访问权限。";

async function organizationCall(
  auth: McpToolContext["auth"],
  scope: "xingyu.read" | "xingyu.draft",
  operation: (userId: number) => Promise<Record<string, unknown>>,
) {
  try {
    requireScope(auth, scope);
    if (!auth.userId) throw new Error("组织架构 MCP 需要关联真实星屿账号，请重新授权");
    return toolResult({ ok: true, ...await operation(auth.userId) });
  } catch (error) {
    return toolFailure(error);
  }
}

/** Organization/department/team tools. Every data operation is scoped to the authenticated user and existing DB role checks. */
export function registerOrganizationTools({ server, auth }: McpToolContext) {
  server.registerTool("list_organizations", {
    title: "列出我所属的组织",
    description: "只列出当前星屿账号已加入的组织，不会暴露其他组织。需要 xingyu.read。",
    inputSchema: {},
    outputSchema: { organizations: z.array(generic).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async () => organizationCall(auth, "xingyu.read", async (userId) => ({
    organizations: await listMyOrganizations(userId),
  })));

  server.registerTool("create_organization", {
    title: "创建组织",
    description: "为当前账号创建一个组织，创建者成为 Owner。"+manageDescription,
    inputSchema: { name },
    outputSchema: { organization: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ name: orgName }) => organizationCall(auth, "xingyu.draft", async (userId) => ({
    organization: await createOrganization(userId, orgName),
  })));

  server.registerTool("rename_organization", {
    title: "重命名组织",
    description: manageDescription,
    inputSchema: { organization_id: id, name },
    outputSchema: { organization: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ organization_id, name: orgName }) => organizationCall(auth, "xingyu.draft", async (userId) => ({
    organization: await renameOrganization(userId, organization_id, orgName),
  })));

  server.registerTool("list_organization_members", {
    title: "查看组织成员",
    description: "读取当前账号有权访问的组织成员、角色和加入时间。需要 xingyu.read。",
    inputSchema: { organization_id: id },
    outputSchema: { members: z.array(generic).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async ({ organization_id }) => organizationCall(auth, "xingyu.read", async (userId) => ({
    members: await listOrganizationMembers(userId, organization_id),
  })));

  server.registerTool("change_organization_member_role", {
    title: "调整组织成员角色",
    description: "仅 Owner/Admin 可按组织规则调整成员角色；不能降级 Owner，Admin 不能管理其他 Admin。"+manageDescription,
    inputSchema: { organization_id: id, user_id: id, role: z.enum(["admin", "member"]) },
    outputSchema: { result: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ organization_id, user_id, role }) => organizationCall(auth, "xingyu.draft", async (userId) => ({
    result: await changeOrganizationRole(userId, organization_id, user_id, role),
  })));

  server.registerTool("remove_organization_member", {
    title: "移除组织成员",
    description: "按组织角色规则移除成员；不能移除 Owner，Admin 不能移除其他 Admin。"+manageDescription,
    inputSchema: { organization_id: id, user_id: id },
    outputSchema: { removed: z.boolean().optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async ({ organization_id, user_id }) => organizationCall(auth, "xingyu.draft", async (userId) => {
    await removeOrganizationMember(userId, organization_id, user_id);
    return { removed: true };
  }));

  server.registerTool("leave_organization", {
    title: "退出组织",
    description: "当前账号退出一个组织。Owner 不能直接退出，必须先转移所有权。",
    inputSchema: { organization_id: id },
    outputSchema: { left: z.boolean().optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async ({ organization_id }) => organizationCall(auth, "xingyu.draft", async (userId) => {
    await leaveOrganization(userId, organization_id);
    return { left: true };
  }));

  server.registerTool("list_organization_units", {
    title: "查看组织部门树",
    description: "读取有权限的组织的部门树及部门成员关系；组织成员身份不会开放工作区文章。需要 xingyu.read。",
    inputSchema: { organization_id: id },
    outputSchema: { units: z.array(generic).optional(), assignments: z.array(generic).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async ({ organization_id }) => organizationCall(auth, "xingyu.read", async (userId) => ({
    ...await listOrganizationUnits(userId, organization_id),
  })));

  server.registerTool("create_organization_unit", {
    title: "创建组织部门",
    description: "在组织内创建部门，可选择父部门与排序；服务端防止跨组织父级与循环。"+manageDescription,
    inputSchema: { organization_id: id, name, parent_id: id.nullable().optional(), sort_order: z.number().int().min(0).max(100000).optional() },
    outputSchema: { unit: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ organization_id, name: unitName, parent_id, sort_order }) => organizationCall(auth, "xingyu.draft", async (userId) => ({
    unit: await createOrganizationUnit(userId, organization_id, { name: unitName, parentId: parent_id, sortOrder: sort_order }),
  })));

  server.registerTool("update_organization_unit", {
    title: "修改组织部门",
    description: "可修改部门名称、父部门或排序；不能产生循环或跨组织关系。"+manageDescription,
    inputSchema: { organization_id: id, unit_id: id, name: name.optional(), parent_id: id.nullable().optional(), sort_order: z.number().int().min(0).max(100000).optional() },
    outputSchema: { unit: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ organization_id, unit_id, name: unitName, parent_id, sort_order }) => organizationCall(auth, "xingyu.draft", async (userId) => ({
    unit: await updateOrganizationUnit(userId, organization_id, unit_id, { name: unitName, parentId: parent_id, sortOrder: sort_order }),
  })));

  server.registerTool("delete_organization_unit", {
    title: "删除空组织部门",
    description: "仅能删除没有子部门且没有成员的部门；不会递归删除。"+manageDescription,
    inputSchema: { organization_id: id, unit_id: id },
    outputSchema: { deleted: z.boolean().optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async ({ organization_id, unit_id }) => organizationCall(auth, "xingyu.draft", async (userId) => {
    await deleteOrganizationUnit(userId, organization_id, unit_id);
    return { deleted: true };
  }));

  server.registerTool("add_organization_unit_member", {
    title: "将组织成员加入部门",
    description: "目标用户必须是同一组织的有效成员；只有 Owner/Admin 可操作。"+manageDescription,
    inputSchema: { organization_id: id, unit_id: id, user_id: id },
    outputSchema: { added: z.boolean().optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async ({ organization_id, unit_id, user_id }) => organizationCall(auth, "xingyu.draft", async (userId) => {
    await addUnitMember(userId, organization_id, unit_id, user_id);
    return { added: true };
  }));

  server.registerTool("remove_organization_unit_member", {
    title: "将成员移出部门",
    description: "仅调整部门关系，不会将用户移出组织。"+manageDescription,
    inputSchema: { organization_id: id, unit_id: id, user_id: id },
    outputSchema: { removed: z.boolean().optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async ({ organization_id, unit_id, user_id }) => organizationCall(auth, "xingyu.draft", async (userId) => {
    await removeUnitMember(userId, organization_id, unit_id, user_id);
    return { removed: true };
  }));

  server.registerTool("list_organization_teams", {
    title: "查看组织团队",
    description: "列出当前账号可访问组织中的团队及成员关系。需要 xingyu.read。",
    inputSchema: { organization_id: id },
    outputSchema: { teams: z.array(generic).optional(), memberships: z.array(generic).optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: true },
  }, async ({ organization_id }) => organizationCall(auth, "xingyu.read", async (userId) => ({
    ...await listOrganizationTeams(userId, organization_id),
  })));

  server.registerTool("create_organization_team", {
    title: "创建组织团队",
    description: manageDescription,
    inputSchema: { organization_id: id, name },
    outputSchema: { team: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ organization_id, name: teamName }) => organizationCall(auth, "xingyu.draft", async (userId) => ({
    team: await createOrganizationTeam(userId, organization_id, teamName),
  })));

  server.registerTool("update_organization_team", {
    title: "重命名组织团队",
    description: manageDescription,
    inputSchema: { organization_id: id, team_id: id, name },
    outputSchema: { team: generic.optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ organization_id, team_id, name: teamName }) => organizationCall(auth, "xingyu.draft", async (userId) => ({
    team: await updateOrganizationTeam(userId, organization_id, team_id, teamName),
  })));

  server.registerTool("delete_organization_team", {
    title: "删除空组织团队",
    description: "仅当团队没有成员和任何工作区/空间授权时才能删除。"+manageDescription,
    inputSchema: { organization_id: id, team_id: id },
    outputSchema: { deleted: z.boolean().optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async ({ organization_id, team_id }) => organizationCall(auth, "xingyu.draft", async (userId) => {
    await deleteOrganizationTeam(userId, organization_id, team_id);
    return { deleted: true };
  }));

  server.registerTool("set_organization_team_member", {
    title: "设置组织团队成员",
    description: "将同一组织成员加入或移出团队；不改变其组织角色或个人工作区权限。"+manageDescription,
    inputSchema: { organization_id: id, team_id: id, user_id: id, enabled: z.boolean() },
    outputSchema: { updated: z.boolean().optional(), ...MCP_ERROR_OUTPUT_FIELDS },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  }, async ({ organization_id, team_id, user_id, enabled }) => organizationCall(auth, "xingyu.draft", async (userId) => {
    await setTeamMember(userId, organization_id, team_id, user_id, enabled);
    return { updated: true };
  }));
}
