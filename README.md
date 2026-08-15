# chromium-web-embed

`chromium-web-embed` مكتبة TypeScript مع إضافة Chrome من نوع Manifest V3 تمنح تطبيق الويب **مساحة متصفح مُدارة** داخل Chrome المحلي للمستخدم. بعد تثبيت الإضافة واتصال التطبيق بها، تنشئ المكتبة مجموعة تبويبات جديدة تحمل اسم التطبيق وتعرض التبويب النشط فيها داخل واجهة الويب مع إمكانية فتح التبويبات والتنقل والنقر والتمرير والكتابة.

> لا يمكن لموقع ويب تضمين صفحات الويب الأخرى بحرية عبر `iframe`. يعرض `SharedTabViewer` لقطات دورية من تبويب مجموعة التطبيق ويرسل أحداث الإدخال إليه محليًا عبر Chrome DevTools Protocol. لا تمر الجلسة عبر خادم وسيط.

## ما الذي تغيّر في الإصدار 2.0

لا تختار الإضافة تبويبًا قائمًا من تبويبات المستخدم، ولا تعرض قائمته. بدلًا من ذلك، ينشئ التطبيق مساحة جديدة معزولة بحسب أصله، وتضم المجموعة التبويبات التي فتحها التطبيق فقط. إغلاق المساحة يغلق تبويباتها ويوقف كل تحكم صادر منها.

| الإمكانية | الحالة |
| --- | --- |
| إنشاء مجموعة تبويبات خاصة بالتطبيق | متاح تلقائيًا بعد الاتصال |
| فتح وإدارة تبويبات المجموعة من التطبيق | متاح |
| عرض التبويب النشط والنقر والتمرير والكتابة فيه | متاح داخل المجموعة فقط |
| تحويل المجموعة إلى مساحة لوكيل ذكاء اصطناعي | متاح بعد تفعيل صريح من المستخدم |
| عرض تبويبات المستخدم الموجودة أو إدارتها | غير متاح |
| الوصول إلى سطح المكتب أو تطبيقات النظام الأصلية | غير متاح |
| قراءة DOM أو كلمات المرور أو ملفات تعريف الارتباط | غير متاح |
| تنفيذ JavaScript اعتباطي داخل المواقع | غير متاح |

## تنزيل الإضافة وتثبيتها

**[تنزيل إضافة Real Browser Web Bridge](https://github.com/MOHOAI/chromium-web-embed/raw/refs/heads/main/extension-download/real-browser-web-bridge-extension.zip)**

1. فك ضغط الملف في مجلد ثابت على جهازك.
2. افتح `chrome://extensions` في Chrome.
3. فعّل **وضع المطور**.
4. اختر **تحميل بدون حزمة** ثم حدد المجلد الناتج عن فك الضغط.
5. تأكد من تفعيل الإضافة وأعد تحميل موقع تطبيقك.
6. يبدأ تطبيقك مساحة المتصفح الخاصة به عبر `createWorkspace()`؛ لا يتطلب ذلك فتح نافذة الإضافة أو اختيار تبويب.

لا يسمح Chrome بتثبيت إضافة غير منشورة في متجر Chrome مباشرةً من رابط ويب، لذلك يقدّم الرابط ملف ZIP للتثبيت اليدوي.

## التثبيت البرمجي

```bash
npm install github:MOHOAI/chromium-web-embed
```

## الاستخدام داخل تطبيق ويب

```ts
import { createRealBrowserClient, SharedTabViewer } from "chromium-web-embed";

const browser = createRealBrowserClient();
await browser.waitForExtension();

// تنشئ المجموعة وتفتح أول تبويب فيها.
const { workspace, tab } = await browser.createWorkspace({
  label: "تطبيقي",
  url: "https://example.com",
  agentControl: false,
});

// افتح تبويبًا جديدًا أو انتقل بالتبويب الحالي داخل هذه المجموعة فقط.
await browser.openInWorkspace("https://www.wikipedia.org", { active: true });
await browser.navigateInWorkspace(tab.id, "https://example.com/docs");

const viewer = new SharedTabViewer(browser, document.querySelector("#managed-tab")!, {
  refreshIntervalMs: 350,
  onError: console.error,
});
await viewer.start();

// عند إلغاء تركيب المكوّن أو إنهاء الجلسة:
viewer.dispose();
await browser.closeWorkspace();
browser.dispose();
```

## واجهة وكيل الذكاء الاصطناعي

يمكن لتطبيقك تفعيل وصول وكيل إلى مساحة التطبيق بعد موافقة المستخدم الواضحة:

```ts
await browser.setAgentControl(true);

await browser.agent.execute({ type: "open", url: "https://example.com" });
await browser.agent.execute({ type: "click", x: 420, y: 260 });
await browser.agent.execute({ type: "type", text: "بحث تجريبي" });

// يوقف المستخدم أو التطبيق هذه القدرة فورًا.
await browser.setAgentControl(false);
```

ينفّذ الوكيل أوامره في **المجموعة التي أنشأها التطبيق فقط**. هذه المكتبة تقدم تحكمًا في صفحات Chrome ضمن تلك المجموعة، وليست أداة تحكم عام في الحاسوب أو سطح المكتب. التحكم في نظام التشغيل أو التطبيقات الأصلية يتطلب مكوّنًا محليًا بصلاحيات مختلفة وغير مشمول في هذه الإضافة.

## الأمان والنطاقات

تستخدم الإضافة جسر محتوى يعمل مع تطبيقات HTTP وHTTPS حتى يمكن تضمين المكتبة في مواقع مختلفة. تعزل الإضافة كل مساحة وفق `window.origin` للتطبيق الذي أنشأها، ولا تقبل الأوامر إلا عبر البروتوكول المعرّف للمكتبة. يجب أن يقدّم التطبيق نفسه واجهة مرئية لتفعيل وإيقاف تحكم الوكيل، وألا يفعّله تلقائيًا.

لشرح رسائل نافذة الإضافة وخطوات معالجة اتصال الجسر، راجع [دليل تشخيص نافذة الإضافة](docs/popup-diagnostics.md).

تحتاج الإضافة إلى صلاحيات `tabs` و`tabGroups` و`debugger` لكي تنشئ المجموعة وتلتقط لقطاتها وترسل أحداث الإدخال إليها. لا تمنح هذه الصلاحيات الوصول إلى كلمات المرور أو ملفات تعريف الارتباط أو محتوى DOM.

## واجهة API المختصرة

| التصدير أو الأمر | الغرض |
| --- | --- |
| `RealBrowserClient` | عميل اتصال تطبيق الويب بالإضافة المحلية |
| `createWorkspace()` | إنشاء مجموعة تبويبات جديدة ومنعزلة للتطبيق |
| `openInWorkspace()` / `navigateInWorkspace()` | فتح تبويبات المجموعة أو التنقل فيها |
| `listWorkspaceTabs()` / `activateInWorkspace()` | عرض تبويبات المجموعة والتبديل بينها |
| `closeWorkspace()` | إغلاق تبويبات المجموعة وإيقاف المساحة |
| `SharedTabViewer` | عرض لقطة التبويب النشط وتمرير الإدخال إليه |
| `setAgentControl()` و`browser.agent.execute()` | تمكين وتنفيذ أوامر الوكيل داخل المجموعة بعد الموافقة |
| `getConnectionDiagnostic()` | تشخيص حالة الجسر المحلي والاتصال |

## التطوير والتحقق

```bash
npm install
npm run type
npm test
npm run build
npm run pack:check
```

ينشئ `npm run build` مجلد `extension/` وملف التنزيل `extension-download/real-browser-web-bridge-extension.zip`.

## مراجع Chrome

- [Chrome Debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome Tab Groups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups)
- [Chrome message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)

## الترخيص

MIT. راجع [LICENSE](LICENSE).
