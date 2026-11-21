# دليل الإصدار v5.0.0 — التحكم بحاسوب ويندوز 10/11 وجسر الملفات الحقيقي (Local Folder Brain)

## 1) التحكم بالحاسوب (ويندوز 10 و11 فقط) — Windows Virtual Desktop Agent

تتيح هذه الميزة لتطبيقات الويب (وخاصة منصات الذكاء الاصطناعي مثل **MOHO AI** و **Gemini** و **Claude** و **ChatGPT**) التحكم الكامل بحاسوب **Windows 10 / Windows 11** عبر وسيط محلي خفيف يتصل مباشرةً بإضافة المتصفح (`Moho Browser Workspace`).

### آلية العمل
1. **تشغيل الوسيط على ويندوز 10/11**:
   - افتح مجلد `desktop-agent/` وشغّل `start_agent.bat` (أو `powershell -ExecutionPolicy Bypass -File install_windows.ps1`).
   - يتحقق الوسيط تلقائيًا من أن النظام هو Windows 10 (بناء 10240 فأحدث) أو Windows 11، ويعمل محليًا فقط على `ws://127.0.0.1:47892` مع **توكن مصادقة عشوائي (Auth Token)**.
2. **الاتصال عبر إضافة المتصفح**:
   - من نافذة الإضافة (Popup) أو برمجيًا عبر `WindowsDesktopAgentClient`، أدخل التوكن واضغط **اتصال بالوسيط**.
3. **فتح سطح مكتب افتراضي جديد وفارغ**:
   - استدعِ `await desktopAgent.createVirtualDesktop()` (أو زر **سطح مكتب فارغ** في الإضافة) لإنشاء سطح مكتب افتراضي نظيف ومعزول في ويندوز 10/11 يبدأ فيه الذكاء الاصطناعي عمله دون إزعاج سطح مكتبك الأساسي.
4. **معاينة البث المباشر للشاشة (Live Screen Preview)**:
   - استخدم المكون الجاهز `DesktopLiveViewer` لعرض بث حي للشاشة المتحكم فيها (حتى 30 FPS مع ضبط الجودة والدقة)، مع دعم التفاعل المباشر بالماوس ولوحة المفاتيح أو المراقبة فقط.
5. **دعم جميع أنواع النقرات والسحب والاختصارات (Win32 `SendInput`)**:
   - `click`, `doubleClick`, `tripleClick`, `rightClick`, `middleClick`, `mouseDown`, `mouseUp`, `move` (سلس/فوري), `longPress`
   - `dragAndDrop` (مع دعم مسار متعدد النقاط ومفاتيح التعديل Shift/Ctrl/Alt)
   - `scroll` (عمودي وأفقي)
   - `type` بـ Unicode كامل (يدعم العربية والإنجليزية والرموز البرمجية بدقة)
   - `pressKey`, `keyDown`, `keyUp`, `holdKey`, `hotkey`, `listWindows`, `focusWindow`, `launchApp`, `clipboardGet`, `clipboardSet`
   - **زر الإيقاف الطارئ (Emergency Kill Switch)**: `emergencyStop()` يوقف الوسيط والبث فورًا.

---

## 2) جسر الملفات الحقيقي (Local Folder Brain 📂💻)

بدلاً من رفع الملفات واحدًا تلو الآخر ونسخ الأكواد ولصقها يدويًا، يستخدم `LocalFolderBrain` واجهة **File System Access API** (بموافقة المستخدم الصريحة) للوصول المباشر إلى مجلد مشروعك الحقيقي على القرص الصلب من صفحة HTML:

- `pickFolder({ mode: "readwrite" })`: اختيار مجلد المشروع وحفظ المقبض في `IndexedDB`.
- `scanTree()`: قراءة شجرة الملفات بالكامل مع تجاهل `node_modules` و `.git` و `dist` تلقائيًا.
- `readFile(path)` و `searchInFiles(query)`: القراءة والبحث النصي أو بـ Regex داخل المشروع.
- `buildProjectContext({ maxTotalChars })`: بناء سياق Markdown مضغوط ومهيأ للذكاء الاصطناعي.
- `previewEdit(path, newContent)` و `applyDirectEdit(path, newContent)`: عرض الفروقات (Unified Diff) ثم **تطبيق مباشر** على القرص الصلب مع حفظ نسخة احتياطية فورية في الذاكرة للتراجع بنقرة واحدة عبر `undoLastEdit()`.

---

## 3) دعم منصات الذكاء الاصطناعي (Gemini / Claude / ChatGPT / MCP / MOHO)

يوفر `src/providers/ai-toolkit.ts` محولات جاهزة تحول جميع أدوات المتصفح + سطح مكتب ويندوز + جسر الملفات إلى الصيغة الرسمية لكل منصة:
- `toGeminiFunctionDeclarations()` — لـ Google Gemini
- `toAnthropicTools()` — لـ Anthropic Claude
- `toOpenAITools()` — لـ OpenAI / ChatGPT وواجهات OpenAI-compatible (مثل MOHO / DeepSeek / Ollama)
- `toMcpTools()` — لبروتوكول MCP
- `UnifiedAIToolExecutor` — منفذ موحد يستقبل استدعاء أي أداة وينفذها تلقائيًا.
