# دليل الإصدار `v6.0.0` — سطح المكتب المخفي الحقيقي + الترمنال المعزول + بث المتصفح المستقل

## 1. سطح المكتب المخفي الحقيقي على ويندوز 10 و11 (`HiddenDesktopEngine`)

في `v6.0.0` لم يعد الوسيط يضغط `Win+Ctrl+D` أو يستخدم `SendInput` على مؤشر الماوس الفيزيائي الخاص بك:
- **عزل كامل بـ `CreateDesktopW` + `SetThreadDesktop`:** يُنشئ الوسيط سطح مكتب نواة مخفي باسم `MohoIsolatedDesktop` في الخلفية **دون أن ينقل شاشتك إليه أبدًا**.
- **لا يحرّك ماوسك الحقيقي:** جميع النقرات (يسار، يمين، وسط، مزدوجة، ثلاثية)، والسحب والإفلات، وعجلة التمرير، والكتابة بـ Unicode تُرسل مباشرة عبر `PostMessageW` إلى النافذة المستهدفة داخل سطح المكتب المخفي.
- **بث مباشر حي (`PrintWindow` + `PW_RENDERFULLCONTENT`):** يلتقط الوسيط نوافذ سطح المكتب المخفي ويركبها في صورة حية تُبث مباشرة إلى تطبيق الويب مع مؤشر افتراضي خاص بالوكيل.
- **تشغيل التطبيقات داخل سطح المكتب المخفي:** عبر `CreateProcessW` مع `STARTUPINFOW.lpDesktop = "MohoIsolatedDesktop"` (مثل `notepad.exe`، `cmd.exe`، `calc.exe`، `msedge.exe`).

## 2. الترمنال وتنفيذ الأكواد المعزول (`SandboxTerminalEngine` + `SandboxTerminalClient`)

تتيح هذه الميزة لتطبيقات الويب ووكلاء الذكاء الاصطناعي تشغيل **Python وNode.js وTypeScript وPowerShell وBatch وGo وPHP** المثبتة على ويندوز داخل بيئة معزولة مقيدة بمجلد المشروع:
- **سجن مجلد المشروع (Workspace Jail):** لا يُسمح بتشغيل أي أمر أو ملف خارج مسار المجلد الذي يحدده المستخدم (`terminal_set_workspace`)، ويُمنع أي تجاوز بمسارات مثل `..`.
- **عزل العمليات عبر `Windows Job Objects`:** كل عملية تُربط بـ `CreateJobObjectW` مع `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` وحد ذاكرة افتراضي (`1024 MB`) ومهلة زمنية صارمة (`timeoutSec`)، بحيث يؤدي الإيقاف أو انتهاء المهلة إلى إنهاء شجرة العمليات بالكامل فورًا.
- **بث حي للمخرجات (`terminal.output`):** تصل مخرجات `stdout` و`stderr` سطرًا بسطر إلى تطبيق الويب في الزمن الحقيقي.
- **تكامل كامل مع الذكاء الاصطناعي:** تتوفر الأدوات `terminal_set_workspace` و`terminal_detect_runtimes` و`terminal_exec` و`terminal_run_file` و`terminal_run_code` و`terminal_kill` تلقائيًا لـ **Gemini** و**Claude** و**ChatGPT/OpenAI/MOHO** و**MCP** و**Chrome WebMCP**.

## 3. بث المتصفح المباشر المستقر (`Dedicated Window Mode`)

أصبح أمر `workspaceCreate` يفتح مساحة عمل المتصفح في **نافذة كروم مستقلة غير مسيطرة على التركيز (`focused: false`)** بحيث يظل التبويب نشطًا ومرسومًا باستمرار، مع التقاط فائق السرعة عبر `chrome.tabs.captureVisibleTab` وبديل تلقائي عبر CDP `Page.captureScreenshot({ fromSurface: true })`.
