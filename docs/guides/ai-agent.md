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
  | { kind: "doubleClick"; tabId?: number; x: number; y: number }
  | { kind: "type"; tabId?: number; text: string }
  | { kind: "clear"; tabId?: number }
  | { kind: "press"; tabId?: number; key: string; code?: string; modifiers?: number }
  | { kind: "scroll"; tabId?: number; x: number; y: number; deltaX?: number; deltaY?: number };

async function runApprovedStep(step: AgentStep) {
  switch (step.kind) {
    case "open": return agent.open(step.url);
    case "navigate": return agent.navigate(step.tabId, step.url);
    case "click": return agent.click(step.x, step.y, step.tabId);
    case "doubleClick": return agent.doubleClick(step.x, step.y, step.tabId);
    case "type": return agent.type(step.text, step.tabId);
    case "clear": return agent.clear(step.tabId);
    case "press": return agent.press(step.key, { code: step.code, modifiers: step.modifiers }, step.tabId);
    case "scroll": return agent.scroll(step.deltaY ?? 0, step.deltaX ?? 0, step.tabId, step.x, step.y);
  }
}
```

## جدول تصنيف الأوامر

| الفئة | أمثلة | السلوك عند انقطاع الجسر | سياسة المنتج المقترحة |
| --- | --- | --- | --- |
| قراءة آمنة | `snapshot()` وقراءة حالة المساحة | تعافٍ محدود تلقائيًا | اسمح بالمحاولة المحدودة وسجل التشخيص |
| إدخال متغير | `type()` و`clear()` و`press()` | **لا** يعاد تلقائيًا | أظهر العملية غير المكتملة واطلب قرارًا صريحًا |
| أثر على الصفحة | `click()` و`scroll()` | **لا** يعاد تلقائيًا | قد يكون النقر وصل فعلاً؛ التقط لقطة قبل التكرار |
| تنقل أو فتح | `open()` و`navigate()` | **لا** يعاد تلقائيًا | راجع العنوان الحالي ثم اعد التنفيذ فقط عند الضرورة |

يمنع هذا التقسيم تكرار إرسال نموذج أو حذف نص أو انتقال غير مقصود. استدعِ `client.reconnect()` بعد استعادة الإضافة ثم ابدأ بحالة جديدة، ولا تعامل «انتهاء المهلة» كدليل على أن الأمر لم يصل.

## سجل النشاط والمراجعة

تحتفظ واجهة الوكيل بسجل محلي موجز يبيّن الوقت، نوع الأمر، النتيجة، ورسالة الخطأ إن وجدت. لا يلتقط السجل النصوص المكتوبة أو محتوى الصفحة. هذا يجعله مناسبًا لتغذية واجهة «ما الذي فعله الوكيل؟» من دون تسجيل بيانات حساسة.

```ts
const log = agent.getActivityLog();
for (const entry of log) {
  console.info(entry.at, entry.action, entry.status, entry.error);
}

// عند انتهاء المهمة أو إيقاف المستخدم:
await client.setAgentControl(false);
agent.clearActivityLog();
```

اجعل زر الإيقاف ظاهرًا أثناء التنفيذ، وأظهر آخر عملية مكتملة قبل أن تسمح للمستخدم بمتابعة الخطة. لا تستخدم سجل النشاط كبديل عن سجل تدقيق خادمي عندما تتطلب سياسات منتجك ذلك.

## التركيز والنص والحذف

لا تفترض أن حقلًا ما لديه تركيز بعد التنقل. على الوكيل النقر أولًا في موضع متحقق، ثم استخدام `type()` للنص المركب، و`clear()` أو `press("Backspace")` للحذف. لا تستبدل الحذف بنص فارغ في حقل من دون التحقق من أن الحقل هو الهدف؛ فقد لا يملك CDP دلالة على العنصر المقصود.

ابتداءً من إصدار الاستقرار هذا، لا يستدعي مسار الإدخال `Page.bringToFront`. أي أن كتابة نص أو حذف محتوى أو إرسال اختصار يجري في تبويب المساحة المُدارة من دون نقل المستخدم إلى تبويب Chrome الحقيقي. يبقى على الوكيل التحقق من لقطة حديثة قبل أي إدخال متغير، لأن عدم نقل نافذة Chrome لا يثبت وحده أن عنصر الصفحة المطلوب هو صاحب التركيز.

```ts
await agent.click(420, 260);
await agent.clear();
await agent.type("بحث عربي مضبوط");
await agent.press("Enter", { code: "Enter" });
```

## قاموس أوامر التفاعل

تجمع الواجهة أدناه الأوامر ذات الأولوية التي يحتاجها المستخدم أو الوكيل عادةً. جميعها تمر عبر `agentExecute` وتبقى ضمن التبويبات التي أنشأتها مساحة التطبيق؛ لا تمنح وصولًا إلى سطح المكتب أو تبويبات المستخدم أو ملفات الجهاز.

| الغرض | الدوال المتاحة | ملاحظة تشغيلية |
| --- | --- | --- |
| النقر والتركيز | `click()` و`doubleClick()` و`tripleClick()` و`rightClick()` و`hover()` و`longPress()` | استخدم الإحداثيات من لقطة حديثة؛ النقر الأيمن يفتح سياق الصفحة ضمن المساحة فقط. |
| السحب والتمرير | `drag()` و`scroll()` و`scrollUp()` و`scrollDown()` | يُرسل السحب بالترتيب: تحويم ثم ضغط ثم تحريك ثم إفلات. |
| النص والحافظة | `type()` و`selectAll()` و`clear()` و`copy()` و`cut()` و`paste()` | `paste(text)` يرسل النص المقدم صراحةً ولا يقرأ حافظة الجهاز. |
| التحرير واختصارات الصفحة | `undo()` و`redo()` و`find()` و`confirm()` و`cancel()` و`toggle()` | تمثل اختصارات محتوى الصفحة، وقد تختلف استجابة الموقع لها. |
| تكبير وطباعة | `zoomIn()` و`zoomOut()` و`resetZoom()` و`save()` و`print()` | قد يعرض الموقع أو Chrome حوارًا محليًا؛ لا تتجاوز المكتبة أي نافذة موافقة. |
| التنقل والتبويب | `open()` و`navigate()` و`reload()` و`back()` و`forward()` و`activate()` و`duplicate()` و`pin()` و`mute()` و`close()` | راجع العنوان واللقطة قبل التنقل أو الإغلاق أو تغيير صوت التبويب. |

> لا توفر هذه المكتبة تحكمًا بنوافذ نظام التشغيل، أو طباعة صامتة، أو إدارة إعدادات Chrome العامة، أو الإضافات الأخرى، أو كلمات المرور، أو بيانات الدفع، أو إلغاء حوارات أمان المتصفح. استخدم واجهات المنتج الأصلية لهذه المهام، واطلب موافقة منفصلة عندما يكون للعمل أثر دائم.

## قائمة سياق العارض

يمكن للتطبيقات التي تستخدم `SharedTabViewer` تمرير `onContextMenu` لعرض قائمة سياقها الخاصة. يمنع العارض قائمة الصورة أو الفيديو الافتراضية في المتصفح، ويعيد موضعًا داخل اللقطة (`x` و`y`) مع موضع الشاشة (`clientX` و`clientY`). لا تنفذ عناصر القائمة مباشرةً من بيانات DOM غير موثوقة؛ اربط كل عنصر بدالة وكيل محددة ومراجعة.

```ts
const viewer = new SharedTabViewer(client, host, {
  onContextMenu: ({ x, y }) => {
    // مثال: اعرض عناصر واجهة التطبيق فقط.
    menu.open({ x, y, actions: ["copy", "paste", "scrollDown"] });
  },
});
```

## ضوابط مطلوبة في المنتج

1. اعرض زرًا ثابتًا لإيقاف الوكيل يستدعي `client.setAgentControl(false)`.
2. أعط المستخدم معاينة للخطة وللعنوان المستهدف قبل التنقل الخارجي.
3. اطلب تأكيدًا مستقلًا قبل عمليات لا رجعة فيها، مثل إرسال نموذج أو شراء أو حذف محتوى أو تغيير إعدادات الحساب.
4. لا تسمح للوكيل بكتابة كلمات مرور أو رموز تحقق أو بيانات دفع، ولا تستخرجها من الصفحة.
5. احتفظ بسجل إجراءات محلي أو خادمي قليل البيانات لمراجعة ما فعله الوكيل.
6. اعرض ملف العرض المختار ومقاييس السلاسة عند بناء تجربة مراقبة فورية؛ راجع [دليل الأداء والاعتمادية](../performance-reliability.md).
7. لا تعيد تلقائيًا أي أمر متغير بعد خطأ اتصال؛ اعرض التشخيص واطلب قرارًا واعيًا.

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

## قائمة مراجعة قبل الإصدار

| تحقق | مطلوب |
| --- | --- |
| تظهر نافذة موافقة قبل `setAgentControl(true)` | نعم |
| يمكن للمستخدم إيقاف الوكيل من كل حالة تشغيل | نعم |
| تظل الأوامر داخل مساحة أصل التطبيق | نعم |
| تعرض الوجهة قبل التنقل الخارجي | نعم |
| تمنع خططك بيانات الاعتماد والدفع ورموز التحقق | نعم |
| تعالج `reconnect-required` بلا إعادة تنفيذ صامتة | نعم |
| تحفظ سجلًا محدود البيانات أو تمسحه عند نهاية الجلسة | نعم |
