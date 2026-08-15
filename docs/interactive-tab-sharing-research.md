# نموذج مشاركة التبويب التفاعلية

## القرار المعماري

تستخدم الإضافة واجهة `chrome.debugger` بعد أن يختار المستخدم التبويب بنفسه ويؤكد مشاركته داخل صفحة الإضافة. يستقبل تطبيق الويب لقطات شاشة دورية للتبويب عبر `Page.captureScreenshot`، ويرسل أحداث المؤشر ولوحة المفاتيح والتنقل إلى أوامر `Input` و`Page` ضمن Chrome DevTools Protocol. لا تُنشئ المكتبة خادمًا خارجيًا ولا ترسل محتوى التبويب إلى طرف ثالث.

## الحدود المقصودة

| الحد | السبب |
| --- | --- |
| لا تضمين iframe لموقع آخر | سياسات المصدر نفسه وإطارات الحماية تمنع العرض التفاعلي المباشر للنطاقات الخارجية. |
| لا مشاركة من دون اختيار المستخدم | ربط مصحح Chrome بتبويب يتطلب إذن `debugger` وموافقة صريحة عبر واجهة الإضافة. |
| لا تنفيذ JavaScript عام ولا قراءة كلمات المرور أو ملفات تعريف الارتباط | تقصر واجهة المكتبة أوامر DevTools على اللقطات والإدخال والتنقل وسجل الصفحة. |
| لا تثبيت مباشر من رابط الموقع | يتطلب Chrome متجر الويب لمعظم عمليات التثبيت العادية؛ يوفر المشروع رابط تنزيل ZIP وتحميلًا يدويًا للتطوير. |

## المراجع الرسمية

1. https://developer.chrome.com/docs/extensions/reference/api/debugger
2. https://developer.chrome.com/docs/extensions/reference/api/tabCapture
3. https://developer.chrome.com/docs/extensions/reference/api/tabs
4. https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions
