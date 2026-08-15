# التكامل مع React

هذا النمط يفصل دورة حياة جسر الإضافة عن عناصر React المرئية. أنشئ العميل مرة واحدة، ابدأ مساحة المتصفح بعد فعلٍ واضح من المستخدم، ثم اربط العارض بحاوية ثابتة.

## مكوّن مساحة متصفح

```tsx
import { useEffect, useRef, useState } from "react";
import {
  RealBrowserClient,
  SharedTabViewer,
  type ExtensionDiagnostic,
} from "chromium-web-embed";

export function ManagedBrowser() {
  const mountRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<RealBrowserClient | null>(null);
  const viewerRef = useRef<SharedTabViewer | null>(null);
  const [diagnostic, setDiagnostic] = useState<ExtensionDiagnostic | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const client = new RealBrowserClient();
    clientRef.current = client;

    return () => {
      viewerRef.current?.dispose();
      client.dispose();
    };
  }, []);

  async function startWorkspace() {
    const client = clientRef.current;
    const mount = mountRef.current;
    if (!client || !mount) return;

    setBusy(true);
    try {
      await client.waitForExtension({ timeoutMs: 8_000 });
      await client.createWorkspace({
        label: "مساحة تطبيق React",
        url: "https://example.com",
      });

      viewerRef.current?.dispose();
      const viewer = new SharedTabViewer(client, mount, {
        onError: () => setDiagnostic(client.getConnectionDiagnostic()),
      });
      viewerRef.current = viewer;
      await viewer.start();
      setDiagnostic(client.getConnectionDiagnostic());
    } catch {
      setDiagnostic(client.getConnectionDiagnostic());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <button onClick={startWorkspace} disabled={busy}>
        {busy ? "جارٍ الاتصال…" : "بدء مساحة المتصفح"}
      </button>
      {diagnostic && <p role="status">{diagnostic.message}</p>}
      <div ref={mountRef} tabIndex={0} style={{ minHeight: 520 }} />
    </section>
  );
}
```

## قاعدة دورة الحياة

| لا تفعل | افعل بدلًا منها |
| --- | --- |
| إنشاء `RealBrowserClient` أثناء كل render. | خزّنه في `useRef` أو أنشئه داخل `useEffect`. |
| إنشاء `SharedTabViewer` قبل وجود عنصر الحاوية. | أنشئه بعد تحقق `mountRef.current`. |
| ترك مؤقت اللقطات بعد التنقل. | استدعِ `viewer.dispose()` في cleanup. |
| إخفاء فشل الاتصال. | اعرض `getConnectionDiagnostic()` للمستخدم. |

## شريط تبويبات بسيط

```tsx
const [tabs, setTabs] = useState<BrowserTab[]>([]);

async function refreshTabs() {
  const { tabs } = await clientRef.current!.listWorkspaceTabs();
  setTabs(tabs);
}

async function activate(tabId: number) {
  await clientRef.current!.activateInWorkspace(tabId);
  await refreshTabs();
}
```

اشترك في `onTabEvent` عند الحاجة لتحديث القائمة مباشرةً، وألغِ الاشتراك عند فك المكوّن. لا تضع `SharedTabViewer` داخل شجرة تتبدل بسرعة، حتى تبقى حاوية الإدخال مركزة.
