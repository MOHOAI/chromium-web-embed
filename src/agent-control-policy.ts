import type { ManagedBrowserWorkspace } from "./protocol.js";

export class AgentControlDisabledError extends Error {
  constructor(workspaceId: string) {
    super(
      `Agent control is disabled for workspace "${workspaceId}". Enable it via setAgentControl(true) or the extension popup before executing AI actions.`
    );
    this.name = "AgentControlDisabledError";
  }
}

export function assertAgentControlEnabled(workspace: ManagedBrowserWorkspace): void {
  if (!workspace.agentControlEnabled) {
    throw new AgentControlDisabledError(workspace.id);
  }
}
