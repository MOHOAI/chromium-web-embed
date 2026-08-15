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

let { workspace } = await client.workspace();
if (!workspace) {
  ({ workspace } = await client.createWorkspace({
    label: "بحث المنتج",
    url: "https://example.com",
  }));
}

const viewer = new SharedTabViewer(
  client,
  document.querySelector<HTMLElement>("#browser-frame")!,
  {
    // responsive للمراقبة السريعة، balanced للاستخدام العام، sharp للنصوص الدقيقة.
    renderProfile: "balanced",
    pauseWhenHidden: true,
  },
);

await viewer.start();
console.log(workspace.id, viewer.getMetrics());
```

يعيد `workspace()` القيمة `null` عند التشغيل الأول بدل رمي خطأ. لا تستدعِ `listWorkspaceTabs()` قبل اكتمال هذا المسار؛ فالقائمة تخص مساحة موجودة فقط.

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
| `reconnect-required` | انقطع الجسر أثناء أمر يغيّر الحالة. | أعد الاتصال، راجع حالة التبويب، ثم دع المستخدم أو منطقك يقرر إعادة الأمر. |

## سياسة الانقطاع

تتعافى قراءات الحالة تلقائيًا بعد عدد محدود من المحاولات. أما النقر والكتابة والتمرير والتنقل وفتح التبويب فلا تتكرر تلقائيًا؛ إذ قد تكون نفذت جزئيًا قبل انقطاع الرسالة. لا تجعل `catch` يعيد استدعاء الأمر المتغير في حلقة صامتة.

```ts
try {
  await client.navigateInWorkspace(tabId, "https://example.com/results");
} catch (error) {
  const diagnostic = client.getConnectionDiagnostic();
  if (diagnostic.code === "reconnect-required") {
    await client.reconnect();
    // استعلم عن الحالة الحالية واعرض قرار إعادة المحاولة في واجهتك.
  }
  throw error;
}
```

## اختيار جودة العرض ومراجعة القياس

```ts
const metrics = viewer.getMetrics();
console.table({
  frames: metrics.framesRendered,
  captureMs: metrics.averageCaptureLatencyMs,
  intervalMs: metrics.averageRefreshIntervalMs,
  fps: metrics.effectiveFps,
  queued: metrics.queuedRefreshes,
});
```

انتقل إلى `responsive` إذا أصبح `queuedRefreshes` أكبر من صفر بصورة متكررة أو ارتفع متوسط زمن الالتقاط. انتقل إلى `sharp` فقط عندما تحتاج إلى حواف نص دقيقة؛ فقد يرفع حجم الإطار وزمن الالتقاط. راجع [الأداء والاعتمادية](../performance-reliability.md) وحدد قياسًا مرجعيًا على الأجهزة والصفحات التي يدعمها منتجك.

## إغلاق المساحة

إنهاء الجلسة يغلق تبويبات المجموعة التي أنشأها التطبيق فقط:

```ts
await client.closeWorkspace();
client.dispose();
```

> لا تمنح المكتبة تحكمًا بنظام التشغيل أو بسطح المكتب. نطاقها هو تبويبات Chrome التي توجد داخل مساحة التطبيق المنشأة للموقع.
