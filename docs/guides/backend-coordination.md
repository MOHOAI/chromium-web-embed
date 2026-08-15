# تنسيق الخادم مع مساحة المتصفح

الجسر و`RealBrowserClient` يعملان داخل متصفح المستخدم. أما الخادم فيمكنه إعداد **نية عمل** أو سياسة أو قائمة عناوين، لكنه لا يجب أن يستورد العميل أو يحاول التحكم في Chrome من Node.js.

## البنية الموصى بها

| الطبقة | المسؤولية |
| --- | --- |
| الخادم | بناء مهام غير منفذة، فحص صلاحيات المنتج، وحفظ سجل موافقة المستخدم. |
| واجهة الويب | عرض المهمة وطلب موافقة المستخدم وإنشاء مساحة Chrome. |
| الإضافة | إنشاء المجموعة، وعزل التبويبات، وتنفيذ الأوامر المسموحة في المساحة فقط. |

## صيغة نية آمنة

```ts
export type BrowserIntent = {
  title: string;
  startUrl: string;
  allowedOrigins: string[];
  actions: Array<"open" | "navigate" | "observe">;
};

// هذه استجابة من API خادمك، لا أمر متصفح مباشر.
const intent: BrowserIntent = await fetch("/api/browser-intent").then((r) => r.json());
```

تحقق من العنوان على العميل قبل تمريره للإضافة:

```ts
const target = new URL(intent.startUrl);
if (!intent.allowedOrigins.includes(target.origin)) {
  throw new Error("عنوان البداية غير مصرح به لهذه المهمة.");
}

const { tab } = await client.createWorkspace({
  label: intent.title,
  url: target.href,
  agentControl: false,
});
```

## أحداث قابلة للتدقيق

سجل على خادمك معلومات قرار المنتج — مثل المستخدم والنية ووقت الموافقة — وليس لقطات الصفحة أو النصوص الحساسة افتراضيًا. اربط كل تنفيذ برقم نية أو Session ID لدى تطبيقك.

```ts
await fetch("/api/audit/browser-consent", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    intentId: "onboarding-42",
    workspaceId: client.getWorkspaceId(),
    approvedAt: new Date().toISOString(),
  }),
});
```

> لا ترسل كلمة مرور أو رمز MFA أو محتوى صفحة حساس إلى الخادم لمجرد أن التطبيق يستطيع رؤية لقطة شاشة. صمم واجهتك بحيث يكمل المستخدم الإدخال الحساس بنفسه.
