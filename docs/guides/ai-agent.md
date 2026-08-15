# تكامل وكلاء الذكاء الاصطناعي

`ManagedBrowserAgent` واجهة متعمدة الضيق. تقتصر على مساحة Chrome التي أنشأها التطبيق، وترفض الإضافة تنفيذ أوامر الوكيل حتى يفعّل المستخدم `agentControl` في المساحة. وهي **ليست** وصولًا إلى سطح المكتب أو الملفات المحلية أو تبويبات المستخدم الأخرى.

## مسار تشغيل آمن

| المرحلة | ما يحدث | قرار المستخدم |
| --- | --- | --- |
| التخطيط | ينشئ النموذج خطة قابلة للعرض، لا أوامر تنفيذ. | يراجع نطاق المواقع والخطوات. |
| الموافقة | يبدأ التطبيق مساحة خاصة ويعرض مفتاح تحكم الوكيل. | يوافق أو يرفض التحكم. |
| التنفيذ المحدود | ينفذ الوكيل داخل المجموعة فقط. | يستطيع الإيقاف في أي وقت. |
| التحقق | تعرض الواجهة لقطة وحالة التبويبات وخلاصة ما حدث. | يقرر المتابعة أو الإغلاق. |

## بدء وكيل بعد موافقة صريحة

```ts
import {
  RealBrowserClient,
  createManagedBrowserAgent,
} from "chromium-web-embed";

const client = new RealBrowserClient();
await client.waitForExtension();

// استدعِ هذا فقط من حدث UI يثبت موافقة المستخدم.
await client.createWorkspace({
  label: "بحث مساعد الذكاء الاصطناعي",
  url: "https://example.com",
  agentControl: true,
});

const agent = createManagedBrowserAgent({ client });
const before = await agent.snapshot();

await agent.open("https://developer.chrome.com/docs/extensions/");
const after = await agent.snapshot();
console.log({ before, after });
```

## حلقة تنفيذ موصى بها

لا تمرر مخرجات نموذج اللغة مباشرة إلى `execute()`. طبّعها وفق schema ثابت، اعرض الأوامر ذات الأثر للمستخدم، ثم نفذها خطوة خطوة.

```ts
type AgentStep =
  | { kind: "open"; url: string }
  | { kind: "navigate"; tabId: number; url: string }
  | { kind: "click"; tabId?: number; x: number; y: number }
  | { kind: "type"; tabId?: number; text: string };

async function runApprovedStep(step: AgentStep) {
  switch (step.kind) {
    case "open": return agent.open(step.url);
    case "navigate": return agent.navigate(step.tabId, step.url);
    case "click": return agent.click(step.x, step.y, step.tabId);
    case "type": return agent.type(step.text, step.tabId);
  }
}
```

## ضوابط مطلوبة في المنتج

1. اعرض زرًا ثابتًا لإيقاف الوكيل يستدعي `client.setAgentControl(false)`.
2. أعط المستخدم معاينة للخطة وللعنوان المستهدف قبل التنقل الخارجي.
3. اطلب تأكيدًا مستقلًا قبل عمليات لا رجعة فيها، مثل إرسال نموذج أو شراء أو حذف محتوى أو تغيير إعدادات الحساب.
4. لا تسمح للوكيل بكتابة كلمات مرور أو رموز تحقق أو بيانات دفع، ولا تستخرجها من الصفحة.
5. احتفظ بسجل إجراءات محلي أو خادمي قليل البيانات لمراجعة ما فعله الوكيل.

```ts
async function emergencyStop() {
  await client.setAgentControl(false);
  // لا يملك الوكيل بعد ذلك القدرة على تنفيذ agentExecute.
}
```

## نموذج مخرجات للنموذج اللغوي

استخدم مخرجات مهيكلة، ثم تحقق من العنوان والقيم قبل التنفيذ:

```json
{
  "summary": "فتح وثائق الإضافة وقراءة صفحة البدء",
  "steps": [
    { "kind": "open", "url": "https://developer.chrome.com/docs/extensions/" }
  ],
  "requiresConfirmation": false
}
```

إذا تضمنت الخطة إرسال نموذج أو تسجيل دخول أو دفعًا أو تغييرًا دائمًا، اجعل `requiresConfirmation` مساويًا لـ`true` وتوقف حتى يؤكد المستخدم داخل واجهة تطبيقك.
