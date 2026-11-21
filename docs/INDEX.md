# فهرس مستندات مشروع `chromium-web-embed` (`v6.2.0`)

مرحبًا بك في الفهرس المنظّم لوثائق التطوير والتشغيل الخاصة بمكتبة وإضافة **Moho Browser Workspace (`chromium-web-embed`)**.

## 1. أدلة الإصدار السادس (`v6.2.0`) — الأحدث
- **[دليل سطح المكتب المخفي والترمنال المعزول (`V6_HIDDEN_DESKTOP_AND_SANDBOX_TERMINAL.md`)](V6_HIDDEN_DESKTOP_AND_SANDBOX_TERMINAL.md)** — شرح معمارية سطح المكتب المخفي (`CreateDesktopW` + `PrintWindow` + `PostMessageW`)، ومحرك الترمنال وتنفيذ الأكواد المعزول (`Windows Job Objects`)، وبث المتصفح المباشر عبر النافذة المستقلة.
- **[دليل الإصدار الخامس (`V5_WINDOWS_DESKTOP_AND_LOCAL_BRAIN.md`)](V5_WINDOWS_DESKTOP_AND_LOCAL_BRAIN.md)** — شرح جسر الملفات الحقيقي (`LocalFolderBrain`)، والتعديل الجراحي، وربط منصات الذكاء الاصطناعي.
- **[دليل وسيط ويندوز (`../desktop-agent/README.md`)](../desktop-agent/README.md)** — خطوات تثبيت وتشغيل `start_agent.bat` على ويندوز 10 و11.

## 2. أدلة المطورين والتكامل
- **[الدليل الشامل للمطورين (`FULL_DEVELOPER_GUIDE.md`)](FULL_DEVELOPER_GUIDE.md)** — المرجع الكامل لبنية المكتبة والـ API.
- **[تكامل وكلاء الذكاء الاصطناعي (`guides/ai-agent.md`)](guides/ai-agent.md)** — استخدام `ComputerUseAgentRunner` و`SafetyPolicyEngine` مع Gemini / Claude / OpenAI / MCP.
- **[التكامل مع JavaScript (`guides/plain-javascript.md`)](guides/plain-javascript.md)**
- **[التكامل مع React (`guides/react.md`)](guides/react.md)**
- **[تضمين التطبيقات (`guides/embedded-apps.md`)](guides/embedded-apps.md)**
- **[تنسيق الخادم الخلفي (`guides/backend-coordination.md`)](guides/backend-coordination.md)**

## 3. المعمارية والأداء واستكشاف الأخطاء
- **[مساحة عمل المتصفح المعزولة (`managed-browser-workspace.md`)](managed-browser-workspace.md)**
- **[سياسة تحكم الوكيل (`agent-control.md`)](agent-control.md)**
- **[الأداء والموثوقية (`performance-reliability.md`)](performance-reliability.md)**
- **[تشخيص نافذة الإضافة (`popup-diagnostics.md`)](popup-diagnostics.md)**
- **[حل المشاكل الشائعة (`troubleshooting.md`)](troubleshooting.md)**
- **[دليل النشر (`../PUBLISHING.md`)](../PUBLISHING.md)**
