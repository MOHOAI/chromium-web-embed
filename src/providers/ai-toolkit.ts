/**
 * Unified AI Platform Toolkit (v5.0.0)
 * ------------------------------------
 * Provides ready-to-use tool schemas and a unified executor for:
 *  - Google Gemini (functionDeclarations)
 *  - Anthropic Claude (tools with input_schema)
 *  - OpenAI / ChatGPT / MOHO / OpenAI-compatible APIs (tools type: "function")
 *  - Model Context Protocol (MCP)
 *
 * Bridges all 3 domains seamlessly:
 *  1. Browser Workspace Automation (`browser_*`)
 *  2. Windows 10/11 Virtual Desktop Computer Use (`desktop_*`)
 *  3. Local Folder Brain (`fs_*`)
 */

import type { WindowsDesktopAgentClient } from "../desktop-agent.js";
import type { LocalFolderBrain } from "../local-folder-brain.js";
import type { SandboxTerminalClient } from "../sandbox-terminal.js";
import { getMcpBrowserTools, handleMcpToolCall, type McpCapableAgent, type McpToolDefinition } from "./mcp.js";

export interface UnifiedToolSpec {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export function getDesktopToolSpecs(): UnifiedToolSpec[] {
  return [
    {
      name: "desktop_create_virtual_desktop",
      description:
        "Create and switch to a fresh, empty Windows 10/11 Virtual Desktop so the AI agent can work cleanly without disturbing the user's primary desktop.",
      parameters: {
        type: "object",
        properties: {
          launchApp: { type: "string", description: "Optional executable or app name to launch inside the new desktop." },
          launchArgs: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "desktop_switch_virtual_desktop",
      description: "Switch between Windows 10/11 Virtual Desktops (left or right).",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["left", "right"] },
        },
        required: ["direction"],
      },
    },
    {
      name: "desktop_close_virtual_desktop",
      description: "Close the current Windows 10/11 Virtual Desktop and return to the user's original desktop.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "desktop_screenshot",
      description: "Capture a screenshot of the active Windows virtual desktop screen.",
      parameters: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["png", "jpeg"] },
          maxWidth: { type: "number" },
        },
      },
    },
    {
      name: "desktop_mouse_action",
      description:
        "Perform any mouse action on Windows 10/11: click, double_click, triple_click, right_click, middle_click, move, mouse_down, mouse_up, long_press, or drag_and_drop.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "click",
              "double_click",
              "triple_click",
              "right_click",
              "middle_click",
              "move",
              "mouse_down",
              "mouse_up",
              "long_press",
              "drag_and_drop",
            ],
          },
          x: { type: "number" },
          y: { type: "number" },
          startX: { type: "number" },
          startY: { type: "number" },
          endX: { type: "number" },
          endY: { type: "number" },
          button: { type: "string", enum: ["left", "right", "middle", "x1", "x2"] },
          seconds: { type: "number" },
          modifiers: { type: "array", items: { type: "string" } },
          coordinateSpace: { type: "string", enum: ["normalized_1000", "pixels"] },
        },
        required: ["action"],
      },
    },
    {
      name: "desktop_scroll",
      description: "Scroll vertically or horizontally on the Windows desktop.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          magnitudeInPixels: { type: "number" },
          x: { type: "number" },
          y: { type: "number" },
          coordinateSpace: { type: "string", enum: ["normalized_1000", "pixels"] },
        },
      },
    },
    {
      name: "desktop_type",
      description: "Type Unicode text (supports Arabic, English, code symbols) on the Windows desktop.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          pressEnter: { type: "boolean" },
          clearFirst: { type: "boolean" },
          coordinateSpace: { type: "string", enum: ["normalized_1000", "pixels"] },
        },
        required: ["text"],
      },
    },
    {
      name: "desktop_hotkey",
      description: "Press a key or keyboard shortcut on Windows (e.g. ['win', 'r'] or ['ctrl', 's']).",
      parameters: {
        type: "object",
        properties: {
          keys: { type: "array", items: { type: "string" } },
        },
        required: ["keys"],
      },
    },
    {
      name: "desktop_list_windows",
      description: "List currently visible windows on the Windows desktop.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "desktop_focus_window",
      description: "Bring a Windows application window to the foreground by partial title or hwnd.",
      parameters: {
        type: "object",
        properties: {
          titleContains: { type: "string" },
          hwnd: { type: "number" },
        },
      },
    },
    {
      name: "desktop_inspect_controls",
      description: "Inspect real Win32 child UI controls (buttons, inputs, labels with coordinates) of the active or target Windows 10/11 window.",
      parameters: {
        type: "object",
        properties: {
          hwnd: { type: "number" },
          maxControls: { type: "number" },
        },
      },
    },
  ];
}

export function getLocalFolderBrainToolSpecs(): UnifiedToolSpec[] {
  return [
    {
      name: "fs_list_project_files",
      description: "List all files and directories inside the user's connected local project folder (Local Folder Brain).",
      parameters: {
        type: "object",
        properties: {
          maxFiles: { type: "number" },
        },
      },
    },
    {
      name: "fs_read_file",
      description: "Read the exact UTF-8 content of a file inside the user's connected local project folder.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path inside the project folder (e.g. src/index.ts)." },
        },
        required: ["path"],
      },
    },
    {
      name: "fs_search_project",
      description: "Search for a text or regex pattern across all text files in the user's local project folder.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          isRegex: { type: "boolean" },
          extensions: { type: "array", items: { type: "string" } },
          maxMatches: { type: "number" },
        },
        required: ["query"],
      },
    },
    {
      name: "fs_apply_direct_edit",
      description:
        "Propose and directly save an updated file to the user's real hard drive (after user confirmation if configured). Automatically stores an undo backup.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file to update or create." },
          newContent: { type: "string", description: "Complete updated file contents." },
          reason: { type: "string", description: "Short summary of the bug fix or change." },
        },
        required: ["path", "newContent"],
      },
    },
    {
      name: "fs_search_replace_patch",
      description: "Surgically replace an exact code snippet inside a real local file without rewriting the whole file (faster and safer).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          searchBlock: { type: "string", description: "Exact existing snippet to locate." },
          replaceBlock: { type: "string", description: "Replacement snippet." },
          reason: { type: "string" },
          replaceAll: { type: "boolean" },
        },
        required: ["path", "searchBlock", "replaceBlock"],
      },
    },
    {
      name: "fs_undo_last_edit",
      description: "Roll back the most recent direct file edit applied by the AI.",
      parameters: { type: "object", properties: {} },
    },
  ];
}

export function getSandboxTerminalToolSpecs(): UnifiedToolSpec[] {
  return [
    {
      name: "terminal_set_workspace",
      description: "Bind the isolated Windows Sandbox Terminal jail strictly to a local project folder path.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute Windows path to the project folder." } },
        required: ["path"],
      },
    },
    {
      name: "terminal_detect_runtimes",
      description: "Detect installed programming runtimes on Windows (python, node, npm, npx, git, tsc, powershell, gcc, go, rustc, java, php).",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "terminal_exec",
      description: "Execute a shell command strictly inside the jailed project folder with Windows Job Object memory/process isolation and timeout.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string", description: "Optional relative subdirectory inside the project folder." },
          timeoutSec: { type: "number" },
        },
        required: ["command"],
      },
    },
    {
      name: "terminal_run_file",
      description: "Run a source file (.py, .js, .mjs, .ts, .ps1, .bat, .go, .php) directly inside the jailed project folder.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          timeoutSec: { type: "number" },
        },
        required: ["path"],
      },
    },
    {
      name: "terminal_run_code",
      description: "Execute an inline code snippet in Python, Node.js/JavaScript, TypeScript, PowerShell, Batch, Go, or PHP inside the jailed project sandbox.",
      parameters: {
        type: "object",
        properties: {
          language: { type: "string" },
          code: { type: "string" },
          timeoutSec: { type: "number" },
        },
        required: ["language", "code"],
      },
    },
    {
      name: "terminal_kill",
      description: "Terminate a running sandbox terminal job and its entire Windows Job Object process tree.",
      parameters: {
        type: "object",
        properties: { jobId: { type: "string" } },
        required: ["jobId"],
      },
    },
  ];
}

export interface UnifiedToolkitSelection {
  browser?: boolean;
  desktop?: boolean;
  localFolder?: boolean;
  terminal?: boolean;
}

export function getUnifiedToolSpecs(selection: UnifiedToolkitSelection = { browser: true, desktop: true, localFolder: true }): UnifiedToolSpec[] {
  const specs: UnifiedToolSpec[] = [];
  if (selection.browser !== false) {
    for (const t of getMcpBrowserTools()) {
      specs.push({ name: t.name, description: t.description, parameters: t.inputSchema });
    }
  
    specs.push(
      {
        name: "browser_aria_snapshot",
        description: "Capture a compact Playwright-MCP-style YAML ARIA accessibility tree with element refs (e0, e1...) for fast, low-token LLM automation.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "browser_annotated_screenshot",
        description: "Capture a Set-of-Mark (SoM) PNG screenshot with numbered bounding boxes overlaid on interactive elements.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "browser_diagnostics",
        description: "Retrieve live browser JavaScript console errors, uncaught exceptions, and failed HTTP network requests (>=400).",
        parameters: { type: "object", properties: {} },
      }
    );
  }
  if (selection.desktop !== false) {
    specs.push(...getDesktopToolSpecs());
  }
  if (selection.localFolder !== false) {
    specs.push(...getLocalFolderBrainToolSpecs());
  }
  if (selection.terminal !== false) {
    specs.push(...getSandboxTerminalToolSpecs());
  }
  return specs;
}

/** Convert unified tools into Google Gemini `functionDeclarations` format */
export function toGeminiFunctionDeclarations(selection?: UnifiedToolkitSelection) {
  return getUnifiedToolSpecs(selection).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/** Convert unified tools into Anthropic Claude `tools` format */
export function toAnthropicTools(selection?: UnifiedToolkitSelection) {
  return getUnifiedToolSpecs(selection).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/** Convert unified tools into OpenAI / ChatGPT / MOHO compatible `tools` format */
export function toOpenAITools(selection?: UnifiedToolkitSelection) {
  return getUnifiedToolSpecs(selection).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Convert unified tools into Model Context Protocol (MCP) tool definitions */
export function toMcpTools(selection?: UnifiedToolkitSelection): McpToolDefinition[] {
  return getUnifiedToolSpecs(selection).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
  }));
}

export interface UnifiedAIToolExecutorOptions {
  browserAgent?: McpCapableAgent;
  desktopAgent?: WindowsDesktopAgentClient;
  folderBrain?: LocalFolderBrain;
  terminal?: SandboxTerminalClient;
}

/**
 * Single router that executes tool calls from Gemini, Claude, ChatGPT/OpenAI, or MCP
 * across Browser Workspace, Windows Virtual Desktop, and Local Folder Brain.
 */
export class UnifiedAIToolExecutor {
  private readonly browserAgent?: McpCapableAgent;
  private readonly desktopAgent?: WindowsDesktopAgentClient;
  private readonly folderBrain?: LocalFolderBrain;
  private readonly terminal?: SandboxTerminalClient;

  constructor(options: UnifiedAIToolExecutorOptions) {
    this.browserAgent = options.browserAgent;
    this.desktopAgent = options.desktopAgent;
    this.folderBrain = options.folderBrain;
    this.terminal = options.terminal;
  }

  async execute(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (toolName.startsWith("browser_")) {
      if (!this.browserAgent) throw new Error("Browser agent is not configured.");
      const extAgent = this.browserAgent as any;
      if (toolName === "browser_aria_snapshot" && typeof extAgent.getAriaSnapshot === "function") {
        return extAgent.getAriaSnapshot();
      }
      if (toolName === "browser_annotated_screenshot" && typeof extAgent.captureAnnotatedScreenshot === "function") {
        return extAgent.captureAnnotatedScreenshot();
      }
      if (toolName === "browser_diagnostics" && typeof extAgent.getDiagnostics === "function") {
        return extAgent.getDiagnostics();
      }
      return handleMcpToolCall(this.browserAgent, toolName, args);
    }

    if (toolName.startsWith("desktop_")) {
      if (!this.desktopAgent) throw new Error("Windows Desktop Agent is not configured.");
      switch (toolName) {
        case "desktop_create_virtual_desktop":
          return this.desktopAgent.createVirtualDesktop({
            launchApp: args.launchApp ? String(args.launchApp) : undefined,
            launchArgs: Array.isArray(args.launchArgs) ? args.launchArgs.map(String) : undefined,
          });
        case "desktop_switch_virtual_desktop":
          return this.desktopAgent.switchVirtualDesktop(args.direction === "left" ? "left" : "right");
        case "desktop_close_virtual_desktop":
          return this.desktopAgent.closeVirtualDesktop();
        case "desktop_screenshot":
          return this.desktopAgent.screenshot({
            format: args.format === "jpeg" ? "jpeg" : "png",
            maxWidth: typeof args.maxWidth === "number" ? args.maxWidth : undefined,
          });
        case "desktop_mouse_action": {
          const act = String(args.action || "click");
          return this.desktopAgent.executeComputerAction({
            type: act,
            x: typeof args.x === "number" ? args.x : undefined,
            y: typeof args.y === "number" ? args.y : undefined,
            startX: typeof args.startX === "number" ? args.startX : undefined,
            startY: typeof args.startY === "number" ? args.startY : undefined,
            endX: typeof args.endX === "number" ? args.endX : undefined,
            endY: typeof args.endY === "number" ? args.endY : undefined,
            button: args.button,
            seconds: typeof args.seconds === "number" ? args.seconds : undefined,
            modifiers: Array.isArray(args.modifiers) ? args.modifiers.map(String) : undefined,
            coordinateSpace: args.coordinateSpace === "pixels" ? "pixels" : "normalized_1000",
          });
        }
        case "desktop_scroll":
          return this.desktopAgent.scroll({
            direction: (args.direction as "up" | "down" | "left" | "right") ?? "down",
            magnitudeInPixels: typeof args.magnitudeInPixels === "number" ? args.magnitudeInPixels : 360,
            x: typeof args.x === "number" ? args.x : undefined,
            y: typeof args.y === "number" ? args.y : undefined,
            coordinateSpace: args.coordinateSpace === "pixels" ? "pixels" : "normalized_1000",
          });
        case "desktop_type":
          return this.desktopAgent.type(String(args.text ?? ""), {
            x: typeof args.x === "number" ? args.x : undefined,
            y: typeof args.y === "number" ? args.y : undefined,
            pressEnter: Boolean(args.pressEnter),
            clearFirst: Boolean(args.clearFirst),
            coordinateSpace: args.coordinateSpace === "pixels" ? "pixels" : "normalized_1000",
          });
        case "desktop_hotkey":
          return this.desktopAgent.hotkey(Array.isArray(args.keys) ? args.keys.map(String) : []);
        case "desktop_list_windows":
          return this.desktopAgent.listWindows();
        case "desktop_inspect_controls":
          return this.desktopAgent.inspectWindowControls({
            hwnd: typeof args.hwnd === "number" ? args.hwnd : undefined,
            maxControls: typeof args.maxControls === "number" ? args.maxControls : undefined,
          });
        case "desktop_focus_window":
          return this.desktopAgent.focusWindow({
            titleContains: args.titleContains ? String(args.titleContains) : undefined,
            hwnd: typeof args.hwnd === "number" ? args.hwnd : undefined,
          });
        default:
          throw new Error(`Unknown desktop tool: ${toolName}`);
      }
    }

    if (toolName.startsWith("fs_")) {
      if (!this.folderBrain) throw new Error("LocalFolderBrain is not configured.");
      switch (toolName) {
        case "fs_list_project_files":
          return this.folderBrain.scanTree({
            maxFiles: typeof args.maxFiles === "number" ? args.maxFiles : undefined,
          });
        case "fs_read_file":
          return this.folderBrain.readFile(String(args.path ?? ""));
        case "fs_search_project":
          return this.folderBrain.searchInFiles(String(args.query ?? ""), {
            isRegex: Boolean(args.isRegex),
            extensions: Array.isArray(args.extensions) ? args.extensions.map(String) : undefined,
            maxMatches: typeof args.maxMatches === "number" ? args.maxMatches : undefined,
          });
        case "fs_apply_direct_edit":
          return this.folderBrain.applyDirectEdit(String(args.path ?? ""), String(args.newContent ?? ""), {
            reason: args.reason ? String(args.reason) : undefined,
          });
        case "fs_search_replace_patch":
          return this.folderBrain.applySearchReplacePatch(
            String(args.path ?? ""),
            String(args.searchBlock ?? ""),
            String(args.replaceBlock ?? ""),
            { reason: args.reason ? String(args.reason) : undefined, replaceAll: Boolean(args.replaceAll) }
          );
        case "fs_undo_last_edit":
          return this.folderBrain.undoLastEdit();
        default:
          throw new Error(`Unknown local folder tool: ${toolName}`);
      }
    }

    if (toolName.startsWith("terminal_")) {
      if (!this.terminal) throw new Error("SandboxTerminalClient is not configured.");
      switch (toolName) {
        case "terminal_set_workspace":
          return this.terminal.setWorkspace(String(args.path ?? ""));
        case "terminal_detect_runtimes":
          return this.terminal.detectRuntimes();
        case "terminal_exec":
          return this.terminal.exec(String(args.command ?? ""), {
            cwd: args.cwd ? String(args.cwd) : undefined,
            timeoutSec: typeof args.timeoutSec === "number" ? args.timeoutSec : undefined,
          });
        case "terminal_run_file":
          return this.terminal.runFile(String(args.path ?? ""), {
            args: Array.isArray(args.args) ? args.args.map(String) : undefined,
            timeoutSec: typeof args.timeoutSec === "number" ? args.timeoutSec : undefined,
          });
        case "terminal_run_code":
          return this.terminal.runCode(String(args.language ?? "python"), String(args.code ?? ""), {
            timeoutSec: typeof args.timeoutSec === "number" ? args.timeoutSec : undefined,
          });
        case "terminal_kill":
          return this.terminal.kill(String(args.jobId ?? ""));
        default:
          throw new Error(`Unknown terminal tool: ${toolName}`);
      }
    }

    throw new Error(`Unknown AI tool: ${toolName}`);
  }
}

export function createUnifiedAIToolExecutor(
  options: UnifiedAIToolExecutorOptions
): UnifiedAIToolExecutor {
  return new UnifiedAIToolExecutor(options);
}
