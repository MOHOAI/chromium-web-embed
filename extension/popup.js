const bridgeEl = document.getElementById("bridge-status");
const wsEl = document.getElementById("workspace-status");
const detailEl = document.getElementById("workspace-detail");
const agentEl = document.getElementById("agent-status");
const toggleAgentBtn = document.getElementById("toggle-agent");
const closeBtn = document.getElementById("close-workspace");

let currentTab = null;
let currentWorkspace = null;

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

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab || null;

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

void refresh();
