import type { ManagedBrowserWorkspace } from "./protocol";

/**
 * يحصر أوامر الوكيل في مساحة وافق مستخدم التطبيق على تفعيلها.
 * لا تتحقق هذه الدالة من ملكية التبويب؛ يتولاها عامل الإضافة قبل التنفيذ.
 */
export function assertAgentControlEnabled(workspace: Pick<ManagedBrowserWorkspace, "agentControlEnabled">): void {
  if (!workspace.agentControlEnabled) {
    throw new Error("Agent control is disabled for this workspace. The user must enable it first.");
  }
}
