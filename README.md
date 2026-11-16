# chromium-web-embed (v4.0.0)

مكتبة TypeScript وإضافة متصفح Chrome/Chromium (Manifest V3) لإنشاء مساحات عمل معزولة داخل المتصفح الحقيقي وتشغيل **وكلاء الذكاء الاصطناعي (AI Agents)** وميزة **التحكم في المتصفح / استخدام الحاسوب (Computer Use)** عبر جميع المزودين:

- **Google Gemini 4 & 3.x** (`gemini-4-carbon`, `gemini-4-argon`, `gemini-4-hydrogen`, `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-3-flash-preview`) عبر [Gemini Interactions API](https://aistudio.google.com/docs/computer-use)
- **Anthropic Claude** (`computer_toolset_20260801`) عبر [Claude Computer Use Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- **OpenAI CUA / Responses API** (`type: "computer"`) عبر [OpenAI Computer Use Guide](https://developers.openai.com/api/docs/guides/tools-computer-use)
- **أي مزود مخصص أو VLM محلي** عبر `GenericComputerUseAdapter` و`UnifiedComputerAction`

## التثبيت

```bash
npm install github:MOHOAI/chromium-web-embed
```

## الميزات الجديدة في الإصدار 4.0.0

1. **تغطية كاملة لـ 22+ إجراء متصفح عبر Chrome DevTools Protocol (`chrome.debugger`)**:
   - النقرات والمؤشر: `click`, `double_click`, `triple_click`, `middle_click`, `right_click`, `mouse_down`, `mouse_up`, `move`, `long_press`, `cursor_position`
   - السحب والإفلات: `drag_and_drop` (يدعم نقطتي البداية/النهاية أو مسار `path` متعدد النقاط)
   - لوحة المفاتيح: `type` (مع مسح الحقل والضغط على Enter اختياريًا)، `press_key` (مع `repeat`)، `key_down`، `key_up`، `hold_key`، `hotkey`
   - التمرير والتنقل: `scroll` (بالاتجاه والمسافة أو `deltaX/deltaY`)، `navigate`، `go_back`، `go_forward`، `reload`، `wait`
   - الرؤية: `take_screenshot` و`zoom` (التقاط منطقة محددة بدقة كاملة لـ Anthropic)
2. **معالجة تلقائية للإحداثيات**: تحويل الإحداثيات المعيارية (`0-999` في Gemini) أو إحداثيات البكسل إلى أبعاد Viewport الحقيقية تلقائيًا.
3. **محرك الأمان والـ HITL (`SafetyPolicyEngine`)**:
   - دعم قرارات الأمان (`safety_decision` في Gemini و`pending_safety_checks` في OpenAI) مع طلب موافقة المستخدم (`onSafetyConfirmation`) وإرجاع `safety_acknowledgement`.
   - قوائم السماح والحظر (`allowlist` / `blocklist`) للروابط، وتجاوزات السياسات (`disabledSafetyPolicies`)، وسجل التدقيق (`AgentAuditEntry`).

## مثال سريع: Gemini 4 Computer Use

```ts
import { GoogleGenAI } from "@google/genai";
import {
  RealBrowserClient,
  createManagedBrowserAgent,
  GeminiComputerUseAdapter,
  ComputerUseAgentRunner,
  DEFAULT_COMPUTER_USE_SYSTEM_INSTRUCTION,
} from "chromium-web-embed";

const ai = new GoogleGenAI();
const client = new RealBrowserClient();
await client.connect();
await client.createWorkspace({ url: "https://aistudio.google.com/docs", agentControlEnabled: true });

const agent = createManagedBrowserAgent({
  client,
  safety: { allowlist: ["aistudio.google.com", "google.com"] },
});

const runner = new ComputerUseAgentRunner({
  agent,
  adapter: new GeminiComputerUseAdapter(),
  turnLimit: 10,
  onSafetyConfirmation: async ({ decision }) => {
    return confirm(`تأكيد أمني مطلوب: ${decision.explanation}`) ? "CONTINUE" : "TERMINATE";
  },
});

const result = await runner.run("ابحث عن تسعير Gemini API", async ({ prompt, initialScreenshot, toolResults, previousResponse }) => {
  return ai.interactions.create({
    model: "gemini-4-hydrogen",
    system_instruction: DEFAULT_COMPUTER_USE_SYSTEM_INSTRUCTION,
    previous_interaction_id: previousResponse?.id,
    input: toolResults ?? [
      { type: "text", text: prompt! },
      { type: "image", data: initialScreenshot!.base64, mime_type: initialScreenshot!.mimeType },
    ],
    tools: [
      GeminiComputerUseAdapter.buildToolConfig({
        environment: "browser",
        enablePromptInjectionDetection: true,
      }),
    ],
  });
});

console.log(result.finalText);
```
