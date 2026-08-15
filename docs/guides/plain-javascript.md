# التكامل المباشر مع JavaScript

يوضح هذا الدليل أقصر مسار لاستخدام `chromium-web-embed` داخل تطبيق ويب عادي. يعمل العميل داخل نافذة المتصفح فقط، لأن الإضافة تتواصل مع الصفحة عبر جسرٍ محلي؛ لذلك لا تنشئ `RealBrowserClient` في Node.js أو داخل دالة خادم.

| المتطلب | السبب |
| --- | --- |
| Chrome أو Chromium | تعتمد الإضافة على Manifest V3 وChrome DevTools Protocol. |
| الإضافة مفعلة | تضخ الإضافة الجسر في صفحة التطبيق عند فتحها أو تحديثها. |
| صفحة HTTP أو HTTPS | لا تدعم إضافات Chrome صفحات `file:` أو صفحات المتصفح الداخلية. |
| تفاعل صريح من المستخدم | مطلوب لإنشاء مساحة التطبيق وتفعيل تحكم الوكيل. |

## تثبيت المكتبة

```bash
npm install github:MOHOAI/chromium-web-embed
```

بعد تثبيت الإضافة من ملف ZIP، افتح موقع التطبيق أو حدّثه مرة واحدة كي يكتمل حقن الجسر.

## إنشاء مساحة تطبيق وعرضها

المساحة لا تستعرض تبويبات المستخدم الموجودة. تنشئ الإضافة مجموعة Chrome مخصصة لأصل تطبيقك فقط، وتضع التبويبات التي ينشئها التطبيق في هذه المجموعة.

```ts
import {
  RealBrowserClient,
  SharedTabViewer,
} from "chromium-web-embed";

const client = new RealBrowserClient({ timeoutMs: 2_000 });

await client.waitForExtension({ timeoutMs: 8_000 });

const { workspace, tab } = await client.createWorkspace({
  label: "بحث المنتج",
  url: "https://example.com",
});

const viewer = new SharedTabViewer(
  client,
  document.querySelector<HTMLElement>("#browser-frame")!,
  { refreshIntervalMs: 350 },
);

await viewer.start();
console.log(workspace.id, tab.id);
```

يحول `SharedTabViewer` النقر والتمرير والكتابة إلى التبويب النشط في المساحة نفسها. نظّف الموارد عند مغادرة الصفحة:

```ts
window.addEventListener("pagehide", () => {
  viewer.dispose();
  client.dispose();
});
```

## إدارة التبويبات

يوفر العميل عمليات صريحة بدل وصولٍ عام إلى Chrome. جميع الدوال التالية تطبق على `workspaceId` الذي أنشأه العميل، ولا تقبل تبويبًا خارج مساحة التطبيق.

```ts
const { tab: docsTab } = await client.openInWorkspace("https://developer.chrome.com");
await client.pinWorkspaceTab(docsTab.id);

await client.navigateInWorkspace(docsTab.id, "https://developer.chrome.com/docs/extensions/");
await client.reloadInWorkspace(docsTab.id);

const copy = await client.duplicateWorkspaceTab(docsTab.id);
await client.muteWorkspaceTab(copy.tab.id, true);

const snapshot = await client.workspaceSnapshot();
console.table(snapshot.tabs.map(({ id, title, url, active }) => ({ id, title, url, active })));
```

## المراقبة والتشخيص

اعرض للمستخدم السبب الحقيقي عندما لا تتصل الإضافة بدل افتراض أنها غير مثبتة.

```ts
client.onTabEvent((event) => {
  if (event.type === "tabUpdated") {
    console.log("تم تحديث تبويب مساحة التطبيق", event.tabId);
  }
});

try {
  await client.connect();
} catch {
  const diagnostic = client.getConnectionDiagnostic();
  console.warn(diagnostic.code, diagnostic.message);
}
```

| رمز التشخيص | المعنى | الإجراء المقترح |
| --- | --- | --- |
| `bridge-not-detected` | لم تصل الصفحة إلى جسر الإضافة. | تحقق من التثبيت، فعّل الإضافة، ثم حدّث الصفحة. |
| `bridge-ready` | الجسر حاضر وينتظر المصافحة. | أعد `connect()` أو استخدم `waitForExtension()`. |
| `subscribe-failed` | رفضت الإضافة الاشتراك في الأحداث. | افحص أن الصفحة HTTP/HTTPS وأن الإضافة محدّثة. |
| `connected` | العميل جاهز. | أنشئ مساحة أو استعد مساحة قائمة. |

## إغلاق المساحة

إنهاء الجلسة يغلق تبويبات المجموعة التي أنشأها التطبيق فقط:

```ts
await client.closeWorkspace();
client.dispose();
```

> لا تمنح المكتبة تحكمًا بنظام التشغيل أو بسطح المكتب. نطاقها هو تبويبات Chrome التي توجد داخل مساحة التطبيق المنشأة للموقع.
