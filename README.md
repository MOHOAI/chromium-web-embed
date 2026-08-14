# chromium-web-embed

مكتبة TypeScript لعرض جلسة Chromium تعمل على خادم والتحكم بها من تطبيق ويب. توفر المكتبة جزأين متكاملين: عميل متصفح ينشئ عارضًا تفاعليًا داخل عنصر DOM، وخادم Node.js يربط هذا العارض بصفحة Chromium عبر `playwright-core`.

> هذه المكتبة لا تضع Chromium داخل عملية المتصفح الخاصة بالمستخدم مباشرة. بدلًا من ذلك، تعمل جلسة Chromium على خادم وتُرسل لقطات JPEG دورية إلى الواجهة، بينما تُرسل أحداث لوحة المفاتيح والفأرة إلى الخادم.

## المتطلبات

يتطلب الخادم Node.js 20 أو أحدث، ومتصفح Chromium مثبتًا في البيئة التي تشغّل Playwright. يتطلب تطبيق الويب متصفحًا حديثًا يدعم `fetch` و`URL.createObjectURL`. يجب تثبيت `playwright-core` في التطبيق الذي يستخدم نقطة التصدير `/server`.

## التثبيت

```bash
npm install chromium-web-embed playwright-core
```

ثبّت Chromium بالطريقة المناسبة لبيئتك، ثم استخدم Playwright لفتح المتصفح. لا تقوم هذه الحزمة بتنزيل متصفح تلقائيًا.

## تشغيل الخادم

```ts
import { chromium } from 'playwright-core';
import { createChromiumControlServer } from 'chromium-web-embed/server';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH
});

const controlServer = createChromiumControlServer({
  browser,
  token: process.env.CHROMIUM_VIEWER_TOKEN,
  corsOrigin: 'https://app.example.com'
});

const address = await controlServer.listen({ host: '127.0.0.1', port: 8787 });
console.log(`Chromium control server: ${address.url}`);
```

يمكن تمرير `page` جاهزة بدلًا من إنشاء صفحة جديدة تلقائيًا:

```ts
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const controlServer = createChromiumControlServer({ browser, page });
```

## الاستخدام داخل تطبيق الويب

```ts
import { createChromiumViewer } from 'chromium-web-embed';

const viewer = createChromiumViewer(
  document.querySelector('#browser')!,
  {
    endpoint: 'https://browser-api.example.com',
    token: viewerToken,
    refreshInterval: 250,
    autoFocus: true
  },
  {
    onError: (error) => console.error('Chromium viewer error', error),
    onScreenshot: (image) => console.debug('Screenshot bytes', image.size)
  }
);

await viewer.start();
await viewer.navigate('https://example.com');
const title = await viewer.evaluate<string>({ expression: 'document.title' });
console.log(title);

// عند إزالة المكوّن من الصفحة:
viewer.stop();
```

لا تصدّر النسخة الحالية ملف CSS منفصلًا؛ الأنماط الأساسية تُطبّق تلقائيًا على العنصر. يمكن ضبط الحجم باستخدام CSS:

```css
#browser {
  width: 100%;
  height: 720px;
}
```

## الواجهة العامة

| التصدير | الوظيفة |
| --- | --- |
| `ChromiumViewer` | إنشاء عارض، بدء/إيقاف التحديث، التنقل، تنفيذ JavaScript، وإرسال الإدخال. |
| `createChromiumViewer` | إنشاء العارض وإضافته إلى عنصر DOM في خطوة واحدة. |
| `ChromiumControlServer` | خادم HTTP يربط العارض بصفحة Playwright. |
| `createChromiumControlServer` | دالة مصنع لإنشاء الخادم. |

يدعم الخادم المسارات الداخلية التالية: `GET /health`، و`GET /screenshot`، و`POST /navigate`، و`POST /evaluate`، و`POST /input`. عند تمرير `token` يجب على العميل إرسال ترويسة `Authorization: Bearer <token>`.

## الأمان والتشغيل الإنتاجي

لا تعرض الخادم مباشرة على الإنترنت دون مصادقة قوية وتشفير TLS وطبقة proxy مناسبة. استخدم `token` طويلًا عشوائيًا، واضبط `corsOrigin` على أصل الواجهة الفعلي بدل `*`. لا تسمح للمستخدمين غير الموثوقين باستدعاء `evaluate` أو `navigate`؛ فهاتان الوظيفتان تمنحان تحكمًا واسعًا في جلسة المتصفح. يفضّل تشغيل Chromium داخل حاوية معزولة وبحساب نظام محدود الصلاحيات، كما يفضّل استخدام خادم تحكم لكل جلسة أو لكل مستخدم عند الحاجة إلى العزل.

## القيود الحالية

يستخدم العارض لقطات JPEG دورية، ولذلك فهو مناسب لأدوات الإدارة والاختبارات والتصفح التفاعلي الخفيف، وليس بديلًا كاملًا لبث فيديو منخفض التأخير. لا تتضمن النسخة الحالية الصوت أو مشاركة الحافظة أو رفع الملفات أو تبويبات متعددة أو WebRTC. يمكن إضافة هذه القدرات لاحقًا عبر طبقة بث مخصصة وواجهات جلسات أوسع.

## التطوير المحلي

```bash
npm install
npm run typecheck
npm test
npm run build
npm run pack:check
```

الحزمة قابلة للنشر بعد نجاح الفحوص، لكن إنشاء مستودع GitHub عام أو نشرها في npm يتطلب موافقة صريحة منفصلة.

## الترخيص

مرخصة بموجب MIT. راجع ملف `LICENSE`.

## مراجع

- [Playwright Browser API](https://playwright.dev/docs/api/class-browser)
- [Playwright Page API](https://playwright.dev/docs/api/class-page)
- [npm package.json exports](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)

