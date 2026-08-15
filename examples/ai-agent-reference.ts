import {
  createManagedBrowserAgent,
  createRealBrowserClient,
  type ManagedWorkspaceSnapshot,
} from "../src";

// عند نسخ المثال إلى تطبيقك، استبدل "../src" بـ "chromium-web-embed".

/**
 * هذا المثال يعمل في واجهة الويب بعد أن يوافق المستخدم صراحة على تحكم الوكيل.
 * لا يستدعي نموذجًا لغويًا؛ تستبدل getApprovedPlan بطبقة تخطيطك المهيكلة.
 */
type ApprovedStep =
  | { kind: "open"; url: string }
  | { kind: "navigate"; tabId: number; url: string }
  | { kind: "click"; tabId?: number; x: number; y: number }
  | { kind: "type"; tabId?: number; text: string };

type ApprovedPlan = {
  summary: string;
  steps: ApprovedStep[];
  requiresConfirmation: boolean;
};

function assertSafeHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("لا يسمح المثال إلا بعناوين HTTP أو HTTPS.");
  }
  return url.href;
}

function getApprovedPlan(snapshot: ManagedWorkspaceSnapshot): ApprovedPlan {
  // في تطبيق حقيقي: حوّل مخرجات النموذج إلى هذا النوع، ثم اعرضها للمستخدم للموافقة.
  // لا تنفذ النص الحر الصادر من النموذج مباشرةً.
  return {
    summary: `فتح مرجع Chrome من مساحة تحتوي على ${snapshot.tabs.length} تبويبًا.`,
    requiresConfirmation: false,
    steps: [{ kind: "open", url: "https://developer.chrome.com/docs/extensions/" }],
  };
}

export async function runReferenceAgentExample(): Promise<void> {
  const client = createRealBrowserClient();
  const agent = createManagedBrowserAgent({ client });

  try {
    await client.waitForExtension({ timeoutMs: 8_000 });

    // اربط هذه الموافقة بزر أو مربع حوار واضح في تطبيقك.
    const userApprovedAgentControl = window.confirm(
      "هل تسمح للوكيل بالتحكم في مساحة متصفح هذا التطبيق فقط؟",
    );
    if (!userApprovedAgentControl) return;

    await client.createWorkspace({
      label: "مهمة وكيل مرجعية",
      url: "https://example.com",
      agentControl: true,
    });

    // observe → plan → user-confirm (when required) → act → observe
    const before = await agent.snapshot();
    const plan = getApprovedPlan(before);
    if (plan.requiresConfirmation && !window.confirm(plan.summary)) return;

    for (const step of plan.steps) {
      switch (step.kind) {
        case "open":
          await agent.open(assertSafeHttpUrl(step.url));
          break;
        case "navigate":
          await agent.navigate(step.tabId, assertSafeHttpUrl(step.url));
          break;
        case "click":
          await agent.click(step.x, step.y, step.tabId);
          break;
        case "type":
          await agent.type(step.text, step.tabId);
          break;
      }
      console.info("لقطة الحالة بعد خطوة الوكيل", await agent.snapshot());
    }
  } finally {
    // أوقف التحكم فور انتهاء المهمة؛ لا تغلق المساحة تلقائيًا إن كان المستخدم ما زال يحتاجها.
    try { await client.setAgentControl(false); } catch { /* لا توجد مساحة بعد. */ }
    client.dispose();
  }
}
