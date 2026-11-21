# Troubleshooting & Common Errors (v7.0.0)

Quick solutions for the most common issues encountered by end users, developers, and AI agents.

## 1. Windows Sandbox Issues

### `WindowsSandbox.exe was not found`
- **Cause:** Windows Sandbox is not enabled yet, or you are on **Windows 10/11 Home** (which does not support [Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/)).
- **Fix (Pro / Enterprise / Education):** Open **Command Prompt (`cmd`) as Administrator** and run:
  ```cmd
  dism /online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All
  ```
  Restart Windows, then run `start_sandbox.bat`.
- **Fix (Windows Home):** Use `start_agent.bat` for Browser Workspace + Local Folder Brain + Jailed Sandbox Terminal, or run `moho_desktop_agent.py --mode real-input --host 0.0.0.0` inside VirtualBox.

### Live Stream Freezes or Turns Black Inside Windows Sandbox
- **Cause:** Minimizing the Windows Sandbox RDP window pauses Windows DWM rendering.
- **Fix:** Restore the Windows Sandbox window and leave it open **behind** Chrome instead of minimizing it.

### `Windows Sandbox is still booting` / `Cannot reach Windows Sandbox`
- **Cause:** You clicked Connect before Sandbox finished booting (~8–15 seconds), or a third-party firewall blocked host-to-sandbox TCP on port `47892`.
- **Fix:** Wait until the console displays `[READY] Host Relay active on ws://127.0.0.1:47892`, then click Connect again.

### Files Disappeared After Closing Windows Sandbox
- **Cause:** Files were saved to the temporary Sandbox Desktop/Documents instead of `C:\MohoPersistent\Workspace`.
- **Fix:** Always save files inside **`C:\MohoPersistent\Workspace`** (or the Desktop shortcut **Moho Persistent Workspace**) and browse with **Edge (Saved Login & Profile)** so all files and logins stay permanently in `%USERPROFILE%\MohoSandboxData`.

## 2. One-Click Web Launch (`moho-agent://`) Issues

### Browser Says "No app registered" or Nothing Happens When Clicking Launch
- **Cause:** `setup_one_click.bat` has not been run yet on this PC.
- **Fix:** Unzip [moho-desktop-agent-windows.zip](https://raw.githubusercontent.com/MOHOAI/chromium-web-embed/main/desktop-agent-download/moho-desktop-agent-windows.zip) and double-click **`setup_one_click.bat`** once. When Chrome asks *"Open Moho Desktop Agent Protocol?"*, check *"Always allow"* and click **Open**.

## 3. Chrome Extension & Bridge Issues

### `Bridge error` or Timeout When Clicking Actions
- **Cause:** Extension is outdated, not reloaded after an update, or the web page was opened before reloading the extension.
- **Fix:** Open `chrome://extensions`, click the **Reload** icon on **Moho Browser Workspace (v7.0.0)**, then refresh (`F5`) your web app tab.

### `Unauthorized: invalid desktop agent token`
- **Cause:** The Auth Token changes every time you restart `start_sandbox.bat` or `start_agent.bat`.
- **Fix:** Copy the new Auth Token printed in the agent console window and paste it into your web app's token field.

### Browser Workspace Live Stream Is Blank
- **Cause:** Restricted internal URLs (`chrome://`, `chrome-extension://`, Chrome Web Store) cannot be captured by Chrome extensions.
- **Fix:** Navigate the workspace to a standard `https://` website.

## 4. Hidden Desktop Mode (`start_agent.bat`) Limitations
- If Start Menu, Taskbar, or modern Windows 11 drag-and-drop do not respond when using `start_agent.bat`, this is a Windows OS limitation of inactive Win32 desktops (`CreateDesktopW` — [Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/winstation/desktops)). Switch to **`start_sandbox.bat`** (Windows Sandbox Real-Desktop Mode) for 100% full interactive control.
