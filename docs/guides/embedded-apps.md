# دمج chromium-web-embed في تطبيق مضمّن

## الغرض

يوضح هذا الدليل الطريقة المدعومة في الإصدار **3.0.0** لتمكين تطبيق ويب يعمل داخل `iframe` من إنشاء مساحة Chrome مُدارة خاصة به. لا يستخدم هذا التكامل قناة تفويض بين التطبيق المضمّن والصفحة الحاوية، ولا ينقل امتيازات أصل إلى أصل آخر.

> التطبيق داخل الإطار يتصل بالإضافة بصفته **تطبيقًا مستقلاً**. مساحة العمل، الاشتراك بالأحداث، وسياسة تحكم الوكيل ترتبط بأصل الإطار فقط.

## نموذج العزل

| عنصر | مصدر الحقيقة | لا يُسمح به |
| --- | --- | --- |
| هوية مساحة العمل | `sender.url` للمستند الذي أرسل الأمر من الإطار | استعمال عنوان تبويب الأب لتحديد الملكية |
| استلام التحديثات | زوج `tabId` و`frameId` للإطار المشترك | إرسال أحداث الإطار إلى الإطار الرئيسي أو إطار آخر |
| القناة المحلية | `window.postMessage` داخل نافذة الإطار نفسها وبـ `targetOrigin` للإطار | تمرير عميل أو أوامر عبر `window.parent` |
| الصلاحيات | أصول HTTP(S) المطابقة لـ Manifest | الأصول المبهمة أو صفحات `chrome:` أو `file:` |

تُثبت الإضافة جسرها في كل إطار مؤهل عبر `all_frames: true`. يتلقى `RealBrowserClient` أو `createEmbeddedBrowserClient()` إشارة الجسر من نافذته فقط، ثم ترسل الإضافة الأمر إلى عامل الخدمة. عند وجود إطارين من أصلين مختلفين في التبويب نفسه، يبقى لكل منهما مساحة عمل مستقلة ولا تصل الأحداث بينهما.

## إعداد الصفحة الحاوية

يكفي أن يحمّل الأب تطبيقك عبر `src` آمن. لا يتطلب الأب استيراد المكتبة أو الحصول على إذن للوصول إلى مساحة التطبيق المضمّن.

```html
<iframe
  src="https://widget.example/browser"
  title="لوحة تحكم المتصفح"
  sandbox="allow-scripts allow-same-origin"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>
```

إذا استخدمت `sandbox`، فوجود `allow-same-origin` ضروري لهذا التكامل. بدونه يتحول أصل الإطار إلى أصل مبهم (`opaque origin`) وترفض الإضافة الطلب؛ وهذا سلوك أمني مقصود.

## إعداد التطبيق المضمّن

ثبت المكتبة داخل مشروع التطبيق المضمّن ثم أنشئ العميل من كود الإطار:

```ts
import {
  createEmbeddedBrowserClient,
  getEmbeddedApplicationContext,
  SharedTabViewer,
} from "chromium-web-embed";

const { embedded, origin } = getEmbeddedApplicationContext();
if (!embedded) console.warn("يمكن تشغيل هذا التطبيق كصفحة مستقلة أيضًا.");

const browser = createEmbeddedBrowserClient({ timeoutMs: 2_000 });
await browser.waitForExtension();

const { tab } = await browser.createWorkspace({
  label: `مساحة ${new URL(origin).hostname}`,
  agentControl: false,
});

const mount = document.querySelector<HTMLElement>("#browser-view")!;
const viewer = new SharedTabViewer(browser, mount, { renderProfile: "balanced" });
await viewer.start();

window.addEventListener("pagehide", () => {
  viewer.dispose();
  browser.dispose();
}, { once: true });
```

## React

```tsx
import { useEffect, useRef } from "react";
import {
  createEmbeddedBrowserClient,
  SharedTabViewer,
} from "chromium-web-embed";

export function EmbeddedBrowserPanel() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const browser = createEmbeddedBrowserClient();
    let viewer: SharedTabViewer | undefined;

    void (async () => {
      await browser.waitForExtension();
      await browser.createWorkspace({ label: "تطبيق مضمّن" });
      viewer = new SharedTabViewer(browser, mountRef.current!, { renderProfile: "balanced" });
      await viewer.start();
    })();

    return () => {
      viewer?.dispose();
      browser.dispose();
    };
  }, []);

  return <div ref={mountRef} aria-label="عرض مساحة المتصفح" />;
}
```

## توصيات الأمان

يجب أن تكون قائمة `allowedOrigins` في Manifest محددة قدر الإمكان في إصدارك الموزع. لا تعطِ الأب كائن `RealBrowserClient` ولا تقبل أوامر تحكم واردة من `window.parent` من دون بروتوكول موافقة خاص بتطبيقك. إذا بنيت قناة اتصال بين الأب والإطار لأغراض واجهة المستخدم، فاجعلها منفصلة تمامًا عن أوامر الإضافة، وتحقق من `event.origin` و`event.source` في تطبيقك.

يجب أن يبقى تفعيل الوكيل مرئيًا ومقصودًا: اعرض زرًا واضحًا يطلب موافقة المستخدم قبل `setAgentControl(true)`، وسجل العمليات عبر `getActivityLog()`. لا تكرر النقرات أو الكتابة أو التنقل تلقائيًا بعد انقطاع الاتصال؛ استخدم `reconnect()` ثم أعد تقييم العملية.

## التشخيص

| العرض | السبب المحتمل | الإجراء |
| --- | --- | --- |
| لا تصل استجابة من الإضافة | الإضافة غير مثبتة أو الإطار غير HTTP(S) | ثبّت الإضافة، وتحقق من `src` وغياب أصل مبهم. |
| خطأ في إطار sandbox | غياب `allow-same-origin` | أضف `allow-same-origin` أو أزل sandbox إذا لم تكن بحاجة إليه. |
| لا تظهر أحداث مساحة العمل | جسر قديم قبل 3.0.0 أو إطار لم يُعد تحميله | حدّث الإضافة وأعِد تحميل الصفحة الحاوية والإطار. |
| يرى الأب مساحة فارغة | هذا متوقع | الأب لا يملك مساحة الإطار. استخدم كود المكتبة داخل الإطار. |

## حدود مقصودة

هذا التكامل لا يحول الإضافة إلى واجهة تحكم عامة في الحاسوب ولا يسمح بتجاوز عزل المتصفحات بين الأصول. يمكن للتطبيق المضمّن إدارة التبويبات التي أنشأها في مساحته فقط، ولا يمكنه الوصول إلى تبويبات المستخدم القائمة أو بيانات تسجيل الدخول أو محتوى DOM.
