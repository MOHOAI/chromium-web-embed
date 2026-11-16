# الدليل الشامل لتطوير واستخدام `chromium-web-embed` (v4.2.0)

يغطي هذا الدليل البنية المعمارية الكاملة، وجميع واجهات البرمجة (APIs)، وتكامل وكلاء الذكاء الاصطناعي متعددي المزودين، والوضع الهجين (Vision + DOM)، وأدوات MCP، واستكشاف الأخطاء الشائعة.

---

## 1. المعمارية ونموذج العزل (Architecture & Isolation)

تتكون المكتبة من ثلاث طبقات متكاملة:
1. **عميل التطبيق (`RealBrowserClient` / `createEmbeddedBrowserClient`)**: يعمل داخل صفحة الويب أو داخل `iframe` ويتواصل عبر `window.postMessage` على القناة `real-browser-web/v4` (مع توافق خلفي لـ `v3`).
2. **جسر المحتوى (`extension/bridge.js`)**: يُحقن عند `document_start` في جميع الإطارات (`all_frames: true`) ويمرر الأوامر إلى عامل الخدمة.
3. **عامل الخدمة (`extension/service-worker.js`)**: يدير مساحات العمل المعزولة حسب `origin` باستخدام `chrome.tabs` و`chrome.tabGroups` و`chrome.storage.session`، وينفذ أوامر الإدخال والتقاط الشاشة وطباعة PDF عبر `chrome.debugger` (Chrome DevTools Protocol).

---

## 2. واجهات الوكيل المتقدمة (`ManagedBrowserAgent`)

### أ. الرؤية الهجينة (Vision + DOM): `observeRich()`
بدلًا من الاعتماد على البكسلات فقط، يمكنك تزويد النموذج باللقطة + قائمة العناصر التفاعلية مع إحداثياتها المعيارية (`0-999`):

```ts
const { screenshot, elements, pageText } = await agent.observeRich();
console.log("Interactive buttons/inputs:", elements.slice(0, 10));
```

### ب. التنفيذ الدفعي المحلي (`executeBatch`) والانتظار (`waitForSelector`)
```ts
await agent.navigate("https://example.com/login");
const waitRes = await agent.waitForSelector("#email", { timeoutMs: 8000 });
if (waitRes.found) {
  await agent.executeBatch([
    { type: "type_selector", selector: "#email", text: "user@example.com", clearFirst: true },
    { type: "type_selector", selector: "#password", text: "secret", pressEnter: true },
  ]);
}
```

### ج. أنماط النافذة والتكبير وطباعة PDF والتخزين
```ts
await agent.windowMode("maximized");
await agent.setZoom(1.25);
await agent.setStorage("theme", "dark", { storageType: "local" });
const pdf = await agent.printPdf(); // { base64, mimeType: "application/pdf" }
```

---

## 3. تكامل وكلاء الذكاء الاصطناعي (Multi-Provider Computer Use)

### أ. Gemini 4 & 3.x (`GeminiComputerUseAdapter`)
يدعم نموذج Interactions API مع الإحداثيات المعيارية `0-999`، وحقل `intent`، وقرارات الأمان `safety_decision`، واكتشاف حقن الأوامر `enable_prompt_injection_detection`:
- راجع المثال الكامل في `examples/gemini-computer-use.ts`.

### ب. Anthropic Claude (`AnthropicComputerUseAdapter`)
يدعم `computer_toolset_20260801` (جميع الأدوات الـ 17 بما فيها `zoom` لقص منطقة بدقة كاملة، و`cursor_position`، و`hold_key`)، مع تطبيق سياسة التوقف الفوري (`fail-fast`) وإرجاع `is_error: true` لبقية الدفعة عند فشل أي خطوة.

### ج. OpenAI Responses API (`OpenAIComputerUseAdapter`)
يدعم `type: "computer"` و`computer_call` مع `actions[]` المجمّعة و`pending_safety_checks` / `acknowledged_safety_checks`.

### د. خادم وأدوات MCP (`getMcpBrowserTools` & `handleMcpToolCall`)
```ts
import { getMcpBrowserTools, handleMcpToolCall } from "chromium-web-embed/providers";

const tools = getMcpBrowserTools();
const output = await handleMcpToolCall(agent, "browser_observe", { includeDom: true });
```

---

## 4. الأمان والـ HITL (`SafetyPolicyEngine`)

```ts
import { SafetyPolicyEngine } from "chromium-web-embed/safety";

const safety = new SafetyPolicyEngine({
  allowlist: ["aistudio.google.com", "*.google.com"],
  blocklist: ["evil.example.com"],
  disabledSafetyPolicies: ["USER_CONSENT_MANAGEMENT"],
  requireConfirmationForNavigation: false,
});
```

---

## 5. إصلاح المشاكل الشائعة (Troubleshooting)

- **`AgentControlDisabledError`**: يجب تفعيل التحكم بالوكيل عند إنشاء مساحة العمل (`agentControlEnabled: true`) أو عبر `await client.setAgentControl(true)` أو من نافذة الإضافة (`popup.html`).
- **انقطاع `chrome.debugger` أو نوم Service Worker**: يقوم الإصدار `4.2.0` باستعادة مساحات العمل من `chrome.storage.session` وإعادة ربط المصحح تلقائيًا عند حدوث خطأ `-32000`.
- **تضمين داخل `iframe`**: استخدم `sandbox="allow-scripts allow-same-origin"` و`allow="clipboard-read; clipboard-write"`، وتحقق من `await client.getConnectionDiagnostic()`.
- **خطأ `403` عند `git push`**: احذف بيانات الاعتماد المخزنة للحساب الخطأ في Windows عبر `cmdkey /delete:git:https://github.com` ثم أعد الدفع بالحساب المالك لـ `MOHOAI`.
