import type { McpToolContext } from "./shared";
import { registerWorkspaceReadTools } from "./workspace-read-tools";
import { registerWorkspaceWriteTools } from "./workspace-write-tools";
import { registerWorkspaceMediaTools } from "./workspace-media-tools";

/** Only identity-bound OAuth connections receive these tenant-aware tools. */
export function registerWorkspaceTools(context:McpToolContext){
  registerWorkspaceWriteTools(context);
  registerWorkspaceReadTools(context);
  registerWorkspaceMediaTools(context);
}
