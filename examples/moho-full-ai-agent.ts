/**
 * Moho AI Full-Stack Agent Example (v5.0.0)
 * -----------------------------------------
 * Connects:
 *  1. Browser Workspace (Chrome MV3 extension)
 *  2. Windows 10/11 Virtual Desktop Agent + Live Preview Viewer
 *  3. Local Folder Brain (File System Access API with Direct Apply + Undo)
 *  4. Unified AI Tool Executor for Gemini, Claude, ChatGPT/OpenAI, and MCP
 */
import {
  RealBrowserClient,
  createManagedBrowserAgent,
  createWindowsDesktopAgent,
  DesktopLiveViewer,
  createLocalFolderBrain,
  createUnifiedAIToolExecutor,
  toGeminiFunctionDeclarations,
  toAnthropicTools,
  toOpenAITools,
  toMcpTools,
} from "chromium-web-embed";

export async function startMohoFullAgent(previewContainer: HTMLElement) {
  // 1. Connect to the Moho Browser Workspace Chrome Extension
  const client = new RealBrowserClient({ label: "Moho AI Workspace" });
  await client.connect();
  await client.createWorkspace({ url: "https://github.com/MOHOAI", agentControlEnabled: true });
  const browserAgent = createManagedBrowserAgent(client);

  // 2. Connect to the Windows 10/11 Desktop Agent via the Extension Bridge
  const desktopAgent = createWindowsDesktopAgent({
    bridge: client,
    mode: "extension",
    token: "PASTE_YOUR_AGENT_TOKEN_HERE",
  });
  await desktopAgent.connect();

  // Open a fresh, empty Windows 10/11 Virtual Desktop for the AI
  await desktopAgent.createVirtualDesktop();

  // Start Live Screen Preview inside the web app container
  const viewer = new DesktopLiveViewer({
    agent: desktopAgent,
    container: previewContainer,
    interactive: true,
    streamOptions: { fps: 10, quality: 72, format: "jpeg", maxWidth: 1280 },
  });
  await viewer.start();

  // 3. Connect Local Folder Brain (File System Access API)
  const folderBrain = createLocalFolderBrain({
    onConfirmDirectEdit: async (proposal) => {
      console.log("Proposed Diff:\n", proposal.unifiedDiff);
      return window.confirm(
        `تطبيق مباشر على الملف ${proposal.path}؟\n(+${proposal.addedLines} / -${proposal.removedLines})\nالسبب: ${proposal.reason ?? ""}`
      );
    },
    onStatusChange: (status) => {
      void client.syncFolderBrainStatus(status).catch(() => {});
    },
  });

  // Triggered from a user button click:
  // await folderBrain.pickFolder({ mode: "readwrite" });

  // 4. Export ready-to-use tool schemas for any AI provider
  const geminiTools = [{ functionDeclarations: toGeminiFunctionDeclarations() }];
  const claudeTools = toAnthropicTools();
  const openaiTools = toOpenAITools();
  const mcpTools = toMcpTools();

  // 5. Execute tool calls from ANY AI model through a single unified router
  const executor = createUnifiedAIToolExecutor({
    browserAgent,
    desktopAgent,
    folderBrain,
  });

  return {
    client,
    browserAgent,
    desktopAgent,
    viewer,
    folderBrain,
    executor,
    schemas: { geminiTools, claudeTools, openaiTools, mcpTools },
  };
}
