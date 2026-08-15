const tabsElement = document.querySelector("#tabs");
const statusElement = document.querySelector("#status");
const stopButton = document.querySelector("#stop");

function setStatus(message, danger = false) { statusElement.textContent = message; statusElement.style.color = danger ? "#ffb9c2" : "#71d9c2"; }

async function loadTabs() {
  const result = await chrome.runtime.sendMessage({ scope: "real-browser-popup", action: "list-tabs" });
  if (!result?.ok) throw new Error(result?.error || "تعذّر جلب التبويبات.");
  tabsElement.replaceChildren();
  for (const tab of result.tabs.filter((tab) => /^https?:\/\//.test(tab.url))) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<strong>${tab.title || "تبويب بلا عنوان"}</strong><span>${tab.url}</span>`;
    button.addEventListener("click", async () => {
      setStatus("يجري بدء المشاركة…");
      const response = await chrome.runtime.sendMessage({ scope: "real-browser-popup", action: "share", tabId: tab.id });
      if (!response?.ok) return setStatus(response?.error || "تعذّرت المشاركة.", true);
      setStatus("تمت مشاركة التبويب. يمكنك العودة إلى تطبيق الويب.");
      stopButton.hidden = false;
    });
    tabsElement.append(button);
  }
  if (result.sharedTabId) { setStatus("هناك تبويب مشترك حاليًا."); stopButton.hidden = false; }
  else setStatus("اختر تبويبًا للمشاركة.");
}

stopButton.addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ scope: "real-browser-popup", action: "stop-share" });
  if (!result?.ok) return setStatus(result?.error || "تعذّر إيقاف المشاركة.", true);
  stopButton.hidden = true;
  await loadTabs();
});

loadTabs().catch((error) => setStatus(error instanceof Error ? error.message : "حدث خطأ غير متوقع.", true));
