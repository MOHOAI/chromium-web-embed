const statusElement = document.querySelector("#status");
const bridgeStatusElement = document.querySelector("#bridge-status");
const workspaceStatusElement = document.querySelector("#workspace-status");
const workspaceDetailElement = document.querySelector("#workspace-detail");
const agentStatusElement = document.querySelector("#agent-status");
const closeButton = document.querySelector("#close-workspace");
let activeSiteTabId = null;

function setStatus(message, danger = false) { statusElement.textContent = message; statusElement.style.color = danger ? "#ffb9c2" : "#71d9c2"; }
function setBridgeStatus(message, danger = false) { bridgeStatusElement.textContent = message; bridgeStatusElement.style.borderColor = danger ? "#7f3d4a" : "#2c4359"; }
function setAgentStatus(enabled) {
  if (enabled === true) {
    agentStatusElement.textContent = "صلاحية الوكيل: مفعّلة";
    agentStatusElement.dataset.state = "enabled";
    return;
  }
  agentStatusElement.textContent = enabled === false ? "صلاحية الوكيل: معطّلة" : "صلاحية الوكيل: لا توجد مساحة";
  agentStatusElement.dataset.state = enabled === false ? "disabled" : "unknown";
}

async function activeSiteTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id) || !/^https?:\/\//.test(tab.url || "")) throw new Error("افتح الإضافة من صفحة تطبيق ويب عادية باستخدام HTTP أو HTTPS.");
  activeSiteTabId = tab.id;
  return tab;
}

async function activateBridgeForCurrentPage() {
  const tab = await activeSiteTab();
  const result = await chrome.runtime.sendMessage({ scope: "real-browser-popup", action: "ensure-site-bridge", tabId: tab.id });
  if (!result?.ok) return setBridgeStatus(result?.error || "تعذّر فحص ربط موقع الويب.", true);
  if (!result.supported) return setBridgeStatus("هذه الصفحة خارج النطاق المسموح للإضافة. أضف أصل التطبيق إلى حزمة الإضافة ثم أعد تحميلها.", true);
  if (!result.ready) return setBridgeStatus("حُقن الجسر ولكن لم تظهر إشارة الجاهزية. حدّث صفحة التطبيق ثم أعد الفحص.", true);
  setBridgeStatus("جسر الاتصال جاهز. أنشئ أو افتح مساحة المتصفح من داخل تطبيق الويب.");
}

function renderWorkspace(workspace) {
  if (!workspace) {
    setAgentStatus(null);
    workspaceDetailElement.textContent = "لا توجد مساحة متصفح مُدارة لهذه الصفحة بعد. افتح مساحة من موقع التطبيق أولًا.";
    closeButton.hidden = true;
    return;
  }
  setAgentStatus(workspace.agentControlEnabled);
  workspaceDetailElement.textContent = `${workspace.label}: ${workspace.tabIds.length} تبويبًا تديره هذه المساحة فقط. ${workspace.agentControlEnabled ? "يمكن إيقاف تحكم الوكيل من التطبيق في أي وقت." : "لن تُقبل أوامر الوكيل إلى أن يفعّله المستخدم من التطبيق."}`;
  closeButton.hidden = false;
}

async function loadWorkspace() {
  const tab = await activeSiteTab();
  const result = await chrome.runtime.sendMessage({ scope: "real-browser-popup", action: "workspace-status", tabId: tab.id });
  if (!result?.ok) throw new Error(result?.error || "تعذّر جلب حالة مساحة التطبيق.");
  renderWorkspace(result.workspace);
  setStatus(result.workspace ? "المساحة المتصلة جاهزة." : "بانتظار الموقع لإنشاء مساحة متصفح.");
}

closeButton.addEventListener("click", async () => {
  if (!activeSiteTabId) return;
  closeButton.disabled = true;
  const result = await chrome.runtime.sendMessage({ scope: "real-browser-popup", action: "close-workspace", tabId: activeSiteTabId });
  closeButton.disabled = false;
  if (!result?.ok) return setStatus(result?.error || "تعذّر إغلاق مساحة التطبيق.", true);
  await loadWorkspace();
});

Promise.all([activateBridgeForCurrentPage(), loadWorkspace()]).catch((error) => setStatus(error instanceof Error ? error.message : "حدث خطأ غير متوقع.", true));
