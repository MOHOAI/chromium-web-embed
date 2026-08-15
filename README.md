# chromium-web-embed

`chromium-web-embed` هو مكتبة TypeScript مع إضافة Chrome من نوع Manifest V3 تتيح لتطبيق ويب موثوق **عرض تبويب Chrome يختاره المستخدم بنفسه والتفاعل معه**. لا يوجد خادم متصفح بعيد، ولا رمز جلسة، ولا تتجاوز الإضافة موافقة المستخدم: يختار المستخدم تبويب HTTP أو HTTPS عبر نافذة الإضافة قبل أن يصبح متاحًا للعرض والتحكم.

> لا يمكن للويب تضمين محتوى أي نطاق داخل `iframe` بحرية. بدلًا من ذلك، تعرض `SharedTabViewer` لقطات دورية للتبويب المُشارك داخل عنصر التطبيق، وترسل إليه أحداث النقر والتمرير ولوحة المفاتيح عبر واجهة Chrome DevTools المقيّدة.

## الإمكانات

| الإمكانية | الحالة |
| --- | --- |
| فتح تبويب Chrome حقيقي وإدارته | متاح |
| اختيار تبويب قائم لمشاركته صراحةً | متاح من نافذة الإضافة |
| عرض التبويب المشترك داخل تطبيق الويب | متاح عبر لقطات دورية |
| النقر والتمرير والكتابة داخل التبويب المشترك | متاح بعد اختيار المستخدم للتبويب |
| التنقل والتحديث والرجوع والتقدم | متاح للتبويب المشترك أو المُدار |
| قراءة DOM أو كلمات المرور أو ملفات تعريف الارتباط | غير متاح |
| تنفيذ JavaScript اعتباطي في الصفحة | غير متاح |
| اختيار أو مشاركة تبويب دون موافقة المستخدم | غير متاح |

## تنزيل الإضافة وتثبيتها

نزّل حزمة الإضافة مباشرةً من الرابط التالي:

**[تنزيل إضافة Real Browser Web Bridge](https://github.com/MOHOAI/chromium-web-embed/raw/refs/heads/main/extension-download/real-browser-web-bridge-extension.zip)**

1. فك ضغط الملف في مجلد ثابت على جهازك.
2. افتح `chrome://extensions` في Chrome.
3. فعّل **وضع المطور**.
4. اختر **تحميل بدون حزمة**، ثم حدد المجلد الذي فككت ضغطه.
5. اضبط أصول تطبيقات الويب الموثوقة في `manifest.json` قبل الاستخدام الإنتاجي، ثم أعد تحميل الإضافة.
6. اضغط أيقونة الإضافة واختر تبويبًا واحدًا لمشاركته مع التطبيق.

لا يسمح Chrome بتثبيت إضافة غير منشورة في متجر Chrome مباشرةً من رابط ويب، ولذلك ينزّل الرابط ملف ZIP للتثبيت اليدوي. هذا قيد من Chrome، وليس قيدًا من المكتبة.

## التثبيت البرمجي

```bash
npm install github:MOHOAI/chromium-web-embed
```

## الاستعمال داخل تطبيق ويب

```ts
import { createRealBrowserClient, SharedTabViewer } from "chromium-web-embed";

const browser = createRealBrowserClient();
await browser.connect();

// يظهر null إلى أن يختار المستخدم تبويبًا من نافذة الإضافة.
const { tab } = await browser.shared();
if (!tab) {
  throw new Error("اطلب من المستخدم اختيار تبويب عبر أيقونة الإضافة.");
}

const viewer = new SharedTabViewer(browser, document.querySelector("#shared-tab")!, {
  refreshIntervalMs: 350,
  onError: console.error,
});
await viewer.start();

// عند إلغاء تركيب المكوّن:
viewer.dispose();
browser.dispose();
```

يمنح `SharedTabViewer` الحاوية تركيزًا عند النقر. ويمكن بعد ذلك تمرير النقر والحركة والتمرير ومفاتيح لوحة المفاتيح إلى التبويب المُشارك فقط.

## إعداد المصدر الموثوق

استبدل الأصول التجريبية في `extension/manifest.json` بأصل تطبيقك الدقيق في كل من `content_scripts.matches` و`externally_connectable.matches`:

```json
{
  "content_scripts": [{
    "matches": ["https://app.example.com/*"],
    "js": ["bridge.js"]
  }],
  "externally_connectable": {
    "matches": ["https://app.example.com/*"]
  }
}
```

لا تستخدم النمط الواسع `https://*/*`. كل أصل وارد في هذه القائمة يستطيع طلب أوامر التحكم للتبويب الذي اختاره المستخدم.

## واجهة API

| التصدير | الغرض |
| --- | --- |
| `RealBrowserClient` | عميل الموقع لاتصال الإضافة المحلية |
| `SharedTabViewer` | عارض تفاعلي للقطات التبويب المُشارك وتمرير الإدخال إليه |
| `createRealBrowserClient()` | إنشاء عميل الرسائل المقيّدة بالأصل |
| `BrowserTab` | بيانات آمنة عن التبويب، مثل العنوان والرابط والحالة |
| `SharedTabScreenshot` | لقطة JPEG/PNG مُرمّزة للتبويب الذي اختاره المستخدم |
| `SharedTabInput` | أحداث المؤشر والتمرير ولوحة المفاتيح المُرسلة للتبويب المُشارك |
| `createRealBrowserExtensionManifest()` | توليد Manifest مقيّد بأصول تطبيق محددة |

يوفر العميل الأوامر: `connect`، و`status`، و`open`، و`list`، و`navigate`، و`reload`، و`back`، و`forward`، و`close`، و`pin`، و`mute`، و`shared`، و`screenshot`، و`input`، و`stopSharing`.

## نموذج الأمان

تعتمد الإضافة صلاحيات `tabs` و`debugger` فقط. تلتقط اللقطات وترسل الإدخال إلى **تبويب واحد اختاره المستخدم من نافذة الإضافة**، وتوقف المشاركة عند الإغلاق أو الطلب الصريح. تتحقق قناة الرسائل من الأصل، وإصدار البروتوكول، ومجموعة أوامر مغلقة، وروابط HTTP/HTTPS فقط. ولا تمنح المكتبة إمكانية قراءة DOM أو بيانات الاعتماد أو ملفات تعريف الارتباط، أو تنفيذ نصوص داخل الصفحة.

## التطوير والتحقق

```bash
npm install
npm run typecheck
npm test
npm run build
npm run pack:check
```

ينشئ `npm run build` مجلد `extension/` وملف التنزيل `extension-download/real-browser-web-bridge-extension.zip`.

## مراجع Chrome

- [Chrome Debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome externally_connectable](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)

## الترخيص

MIT. راجع [LICENSE](LICENSE).
