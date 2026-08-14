# مراجع تصميم إضافة المتصفح

## قرارات التصميم

تستخدم الإضافة Manifest V3 مع `chrome.tabs` لإنشاء التبويبات وتحديثها وإعادة تحميلها وتفعيلها. يطلب إذن `tabs` لأن إرجاع عنوان التبويب واسم الصفحة يحتاجه، فيما لا نطلب صلاحيات مضيف واسعة أو حقن نصوص في صفحات الويب.

تتصل التطبيقات بالمكتبة العميلة عبر جسر محتوى مثبت فقط على الأصول التي يضعها مالك الإضافة في `content_scripts.matches`. يتحقق الجسر من أن المصدر يطابق `window.location.origin`، ثم يمرر رسائل JSON محددة إلى service worker. يعتمد worker قائمة أوامر مقيدة ويرفض أي أمر خارجها، ولا يدعم تنفيذ JavaScript داخل الصفحات أو قراءة محتواها.

تضيف الدالة المساعدة لإنشاء manifest خيار `externally_connectable.matches` للأصول نفسها، بحيث يمكن للتطبيقات المدعومة الاتصال بالإضافة مباشرة عند تثبيت معرف الإضافة. يبقى جسر المحتوى هو خيار التطوير الذي لا يتطلب معرفة معرّف الإضافة مسبقًا.

## المراجع الرسمية

1. توثق Chrome أن `externally_connectable.matches` تقيد صفحات الويب المسموح لها باستخدام `runtime.connect` و`runtime.sendMessage` مع الإضافة: <https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable>.
2. توثق Chrome أن الرسائل أحادية الطلب تحتاج بيانات قابلة للتسلسل، وأن إرجاع `true` يبقي قناة الرد غير المتزامن مفتوحة عبر إصدارات Chrome: <https://developer.chrome.com/docs/extensions/develop/concepts/messaging>.
3. توثق Chrome أن `chrome.tabs` ينشئ ويعدل ويرتب التبويبات، وأن إذن `tabs` يمنح الوصول إلى `url` و`title` و`pendingUrl` و`favIconUrl`: <https://developer.chrome.com/docs/extensions/reference/api/tabs>.
4. توثق Chrome أن content scripts تعمل في عالم معزول وأنها تتواصل مع الامتيازات الأعلى عبر الرسائل: <https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts>.
