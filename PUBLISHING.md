# دليل نشر وتوزيع chromium-web-embed (v4.1.0)

يوضح هذا الدليل الخطوات العملية الكاملة لرفع التحديثات إلى GitHub، ونشر الحزمة على **npm**، ونشر إضافة المتصفح على **Chrome Web Store** أو استخدامها محليًا.

---

## 1. التحقق والبناء محليًا قبل النشر

داخل مجلد المشروع `chromium-web-embed`:

```bash
npm install
npm run typecheck
npm test
npm run build
npm run pack:check
```

سيقوم أمر `npm run build` بما يلي تلقائيًا:
1. تجميع المكتبة في `dist/` (بصيغتي ESM وCJS مع ملفات `.d.ts`).
2. مزامنة رقم الإصدار في `extension/manifest.json`.
3. إنشاء أرشيف الإضافة الجاهز `extension-download/real-browser-web-bridge-extension.zip`.

---

## 2. رفع التحديثات وإنشاء إصدار (Release) على GitHub

```bash
git status
git add .
git commit -m "feat(v4.1.0): full local browser actions, MCP tools, and multi-provider Computer Use"
git tag v4.1.0
git push origin main --tags
```

### إنشاء GitHub Release:
1. افتح مستودعك `https://github.com/MOHOAI/chromium-web-embed/releases/new`.
2. اختر الوسم `v4.1.0`.
3. أرفق الملف `extension-download/real-browser-web-bridge-extension.zip` في قسم **Attach binaries**.
4. انشر الإصدار (Publish release).

---

## 3. النشر على npm (للاستخدام عبر `npm install chromium-web-embed`)

1. سجّل الدخول إلى حسابك في npm:
   ```bash
   npm login
   ```
2. تأكد من أن اسم الحزمة متاح (أو استخدم نطاقك `@mohoai/chromium-web-embed` في `package.json` إذا كان الاسم محجوزًا).
3. انشر الحزمة:
   ```bash
   npm publish --access public
   ```

---

## 4. نشر إضافة المتصفح على Chrome Web Store

1. انتقل إلى [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. اضغط **New Item** وارفع الملف `extension-download/real-browser-web-bridge-extension.zip`.
3. املأ بيانات المتجر (الوصف، الأيقونات `extension/icons/icon-128.png`، لقطات الشاشة).
4. في قسم **Privacy practices / Permission justifications**، استخدم التبريرات التالية:
   - `tabs` & `tabGroups`: لإنشاء وإدارة مساحات عمل معزولة لكل تطبيق ويب.
   - `debugger`: لتنفيذ نقرات الماوس ولوحة المفاتيح والتقاط لقطات الشاشة وطباعة PDF عبر Chrome DevTools Protocol بناءً على طلب المستخدم أو وكيل الذكاء الاصطناعي المصرّح له.
   - `scripting`: لحقن جسر التواصل واستخراج العناصر التفاعلية من الصفحة.
   - `storage`: لحفظ حالة مساحات العمل في `chrome.storage.session`.
5. أرسل الإضافة للمراجعة (Submit for review).

---

## 5. التثبيت المحلي السريع للمطورين (Load Unpacked)

1. افتح `chrome://extensions` في Chrome أو Edge أو Brave.
2. فعّل **Developer mode**.
3. اضغط **Load unpacked** واختر مجلد `extension/`.
