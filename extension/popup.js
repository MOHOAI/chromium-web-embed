const versionEl = document.getElementById("ext-version");
const bridgeEl = document.getElementById("bridge-status");
const wsEl = document.getElementById("workspace-status");
const detailEl = document.getElementById("workspace-detail");
const agentEl = document.getElementById("agent-status");
const toggleAgentBtn = document.getElementById("toggle-agent");
const closeBtn = document.getElementById("close-workspace");

const desktopStatusEl = document.getElementById("desktop-status");
const desktopDetailEl = document.getElementById("desktop-detail");
const desktopTokenInput = document.getElementById("desktop-token");
const desktopConnectBtn = document.getElementById("desktop-connect");
const desktopNewVdBtn = document.getElementById("desktop-new-vd");
const desktopStopBtn = document.getElementById("desktop-stop");

const folderStatusEl = document.getElementById("folder-status");
const folderDetailEl = document.getElementById("folder-detail");

let currentTab = null;
let currentWorkspace = null;
let desktopConnected = false;

try {
  const manifest = chrome.runtime.getManifest();
  if (manifest?.version && versionEl) {
    versionEl.textContent = `v${manifest.version}`;
  }
} catch {}

function setBadge(el, text, kind) {
  el.textContent = text;
  el.className = `badge ${kind}`;
}

function sendPopupMessage(action, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { scope: "real-browser-popup", action, tabId: currentTab?.id, url: currentTab?.url, ...extra },
      (res) => resolve(res || { ok: false })
    );
  });
}

async function refreshDesktop() {
  const dRes = await sendPopupMessage("desktop-status");
  if (dRes.ok && dRes.status?.connected) {
    desktopConnected = true;
    const st = dRes.status;
    setBadge(desktopStatusEl, st.emergencyStopped ? "متوقف طارئًا" : "متصل", st.emergencyStopped ? "badge-err" : "badge-ok");
    desktopDetailEl.textContent = `${st.os || "Windows 10/11"} — سطح المكتب الافتراضي: ${st.virtualDesktopActive ? "نشط" : "افتراضي"} — البث: ${st.streaming ? "مباشر" : "متوقف"}`;
    desktopConnectBtn.textContent = "قطع الاتصال";
    desktopConnectBtn.className = "btn-muted";
    desktopNewVdBtn.disabled = false;
    desktopStopBtn.disabled = false;
  } else {
    desktopConnected = false;
    setBadge(desktopStatusEl, "غير متصل", "badge-off");
    desktopDetailEl.textContent = dRes.error || "شغّل desktop-agent/start_agent.bat على ويندوز 10/11 ثم اضغط اتصال.";
    desktopConnectBtn.textContent = "اتصال بالوسيط";
    desktopConnectBtn.className = "btn-success";
    desktopNewVdBtn.disabled = true;
    desktopStopBtn.disabled = true;
  }
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;

  await refreshDesktop();

  if (!currentTab?.url || !/^https?:\/\//i.test(currentTab.url)) {
    setBadge(bridgeEl, "غير مدعوم هنا", "badge-off");
    setBadge(wsEl, "لا توجد مساحة", "badge-off");
    setBadge(agentEl, "غير متاح", "badge-off");
    detailEl.textContent = "افتح صفحة HTTP/HTTPS لتفعيل جسر المتصفح.";
    toggleAgentBtn.disabled = true;
    closeBtn.disabled = true;
    return;
  }

  const bridgeRes = await sendPopupMessage("ensure-site-bridge");
  setBadge(
    bridgeEl,
    bridgeRes.ok ? "متصل ونشط" : "غير متصل",
    bridgeRes.ok ? "badge-ok" : "badge-warn"
  );

  const statusRes = await sendPopupMessage("workspace-status");
  if (statusRes.ok && statusRes.workspace) {
    currentWorkspace = statusRes.workspace;
    setBadge(wsEl, "نشطة", "badge-ok");
    detailEl.textContent = `${currentWorkspace.label} (${currentWorkspace.tabIds.length} تبويبات) — ${currentWorkspace.origin}`;
    const enabled = Boolean(currentWorkspace.agentControlEnabled);
    setBadge(agentEl, enabled ? "مفعّل (enabled)" : "معطّل (disabled)", enabled ? "badge-ok" : "badge-warn");
    toggleAgentBtn.disabled = false;
    closeBtn.disabled = false;
  } else {
    currentWorkspace = null;
    setBadge(wsEl, "غير متصلة", "badge-off");
    setBadge(agentEl, "غير معروف", "badge-off");
    detailEl.textContent = "لا توجد مساحة عمل مرتبطة بهذا الأصل حاليًا.";
    toggleAgentBtn.disabled = true;
    closeBtn.disabled = true;
  }

  if (statusRes.folderBrain && statusRes.folderBrain.connected) {
    setBadge(folderStatusEl, "مرتبط (قراءة/كتابة)", "badge-ok");
    folderDetailEl.textContent = `المجلد: ${statusRes.folderBrain.folderName} (${statusRes.folderBrain.indexedFileCount || 0} ملف)`;
  } else {
    setBadge(folderStatusEl, "غير مرتبط", "badge-off");
    folderDetailEl.textContent = "اختر مجلد مشروعك من تطبيق الويب (File System Access API) لتمكين التعديل المباشر.";
  }
}

toggleAgentBtn.addEventListener("click", async () => {
  if (!currentWorkspace) return;
  await sendPopupMessage("toggle-agent-control", {
    workspaceId: currentWorkspace.id,
    enabled: !currentWorkspace.agentControlEnabled,
  });
  await refresh();
});

closeBtn.addEventListener("click", async () => {
  if (!currentWorkspace) return;
  await sendPopupMessage("close-workspace", { workspaceId: currentWorkspace.id });
  await refresh();
});

desktopConnectBtn.addEventListener("click", async () => {
  if (desktopConnected) {
    await sendPopupMessage("desktop-disconnect");
  } else {
    const token = desktopTokenInput.value.trim();
    const res = await sendPopupMessage("desktop-connect", { token });
    if (!res.ok) {
      desktopDetailEl.textContent = `تعذر الاتصال: ${res.error || "تأكد من تشغيل الوسيط"}`;
      return;
    }
  }
  await refreshDesktop();
});

desktopNewVdBtn.addEventListener("click", async () => {
  await sendPopupMessage("desktop-new-vd");
  await refreshDesktop();
});

desktopStopBtn.addEventListener("click", async () => {
  await sendPopupMessage("desktop-emergency-stop");
  await refreshDesktop();
});

void refresh();
