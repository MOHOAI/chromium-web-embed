const verEl = document.getElementById("sp-ver");
const badgeEl = document.getElementById("sp-desktop-badge");
const previewEl = document.getElementById("sp-preview");
const tokenEl = document.getElementById("sp-token");
const connectBtn = document.getElementById("sp-connect");
const newVdBtn = document.getElementById("sp-new-vd");
const killBtn = document.getElementById("sp-kill");
const metaEl = document.getElementById("sp-desktop-meta");
const outputEl = document.getElementById("sp-output");
const tabBadgeEl = document.getElementById("sp-tab-badge");

let connected = false;
let imgEl = null;

try {
  const m = chrome.runtime.getManifest();
  if (m?.version) verEl.textContent = `v${m.version}`;
} catch {}

function sendMsg(action, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ scope: "real-browser-popup", action, ...extra }, (res) =>
      resolve(res || { ok: false })
    );
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.scope === "real-browser-event" && msg.event?.type === "desktop.frame" && msg.event.payload?.dataUrl) {
    if (!imgEl) {
      previewEl.innerHTML = "";
      imgEl = document.createElement("img");
      previewEl.appendChild(imgEl);
    }
    imgEl.src = msg.event.payload.dataUrl;
  }
});

async function refreshDesktop() {
  const res = await sendMsg("desktop-status");
  if (res.ok && res.status?.connected) {
    connected = true;
    badgeEl.textContent = res.status.emergencyStopped ? "متوقف طارئًا" : "متصل";
    badgeEl.className = `badge ${res.status.emergencyStopped ? "err" : "ok"}`;
    connectBtn.textContent = "قطع الاتصال";
    connectBtn.className = "b-slate";
    newVdBtn.disabled = false;
    killBtn.disabled = false;
    metaEl.textContent = `${res.status.os || "Windows 10/11"} | سطح افتراضي: ${res.status.virtualDesktopActive ? "نشط" : "أساسي"}`;
  } else {
    connected = false;
    badgeEl.textContent = "غير متصل";
    badgeEl.className = "badge off";
    connectBtn.textContent = "اتصال + بث";
    connectBtn.className = "b-green";
    newVdBtn.disabled = true;
    killBtn.disabled = true;
    metaEl.textContent = res.error || "شغّل desktop-agent/start_agent.bat ثم اضغط اتصال.";
  }
}

connectBtn.addEventListener("click", async () => {
  if (connected) {
    await sendMsg("desktop-disconnect");
  } else {
    const res = await sendMsg("desktop-connect", { token: tokenEl.value.trim(), startStream: true });
    if (!res.ok) metaEl.textContent = `خطأ: ${res.error || "تعذر الاتصال"}`;
  }
  await refreshDesktop();
});

newVdBtn.addEventListener("click", async () => {
  await sendMsg("desktop-new-vd");
  await refreshDesktop();
});

killBtn.addEventListener("click", async () => {
  await sendMsg("desktop-emergency-stop");
  await refreshDesktop();
});

document.getElementById("sp-refresh-aria").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  tabBadgeEl.textContent = "جاري الفحص...";
  const res = await sendMsg("inspect-aria-active", { tabId: tab.id });
  tabBadgeEl.textContent = res.ok ? "تم" : "خطأ";
  tabBadgeEl.className = `badge ${res.ok ? "ok" : "err"}`;
  outputEl.textContent = res.ok ? (res.snapshot || "(فارغ)") : (res.error || "تعذر استخراج ARIA");
});

document.getElementById("sp-refresh-diag").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const res = await sendMsg("inspect-diagnostics-active", { tabId: tab.id });
  tabBadgeEl.textContent = res.ok ? "تم" : "خطأ";
  tabBadgeEl.className = `badge ${res.ok ? "ok" : "err"}`;
  outputEl.textContent = res.ok ? JSON.stringify(res.diagnostics, null, 2) : (res.error || "تعذر القراءة");
});

void refreshDesktop();
