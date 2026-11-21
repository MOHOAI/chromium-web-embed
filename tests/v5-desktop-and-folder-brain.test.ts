import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_CHANNEL,
  BRIDGE_VERSION,
  isBridgeCommand,
} from "../src/protocol.js";
import {
  LocalFolderBrain,
  computeUnifiedDiff,
} from "../src/local-folder-brain.js";
import {
  toAnthropicTools,
  toGeminiFunctionDeclarations,
  toMcpTools,
  toOpenAITools,
  UnifiedAIToolExecutor,
  toUniversalSystemPrompt,
  parseUniversalToolCalls,
} from "../src/providers/ai-toolkit.js";
import { isWebMCPSupported } from "../src/webmcp.js";

function createMockDirectory(files: Record<string, string>, name = "moho-project") {
  const store = new Map<string, string>(Object.entries(files));

  function makeFileHandle(relPath: string) {
    return {
      kind: "file" as const,
      name: relPath.split("/").pop()!,
      async getFile() {
        const text = store.get(relPath) ?? "";
        return {
          size: text.length,
          lastModified: Date.now(),
          async text() {
            return text;
          },
        };
      },
      async createWritable() {
        let buf = "";
        return {
          async write(data: string) {
            buf = data;
          },
          async close() {
            store.set(relPath, buf);
          },
        };
      },
    };
  }

  function makeDirHandle(prefix: string): any {
    return {
      kind: "directory" as const,
      name: prefix ? prefix.split("/").pop()! : name,
      async *entries() {
        const seenDirs = new Set<string>();
        for (const fullPath of store.keys()) {
          if (prefix && !fullPath.startsWith(prefix + "/")) continue;
          const rest = prefix ? fullPath.slice(prefix.length + 1) : fullPath;
          const parts = rest.split("/");
          if (parts.length === 1) {
            yield [parts[0], makeFileHandle(fullPath)];
          } else if (!seenDirs.has(parts[0])) {
            seenDirs.add(parts[0]);
            const subPrefix = prefix ? `${prefix}/${parts[0]}` : parts[0];
            yield [parts[0], makeDirHandle(subPrefix)];
          }
        }
      },
      async getDirectoryHandle(seg: string) {
        return makeDirHandle(prefix ? `${prefix}/${seg}` : seg);
      },
      async getFileHandle(seg: string, opts?: { create?: boolean }) {
        const full = prefix ? `${prefix}/${seg}` : seg;
        if (!store.has(full) && !opts?.create) {
          throw new Error(`File not found: ${full}`);
        }
        if (!store.has(full) && opts?.create) store.set(full, "");
        return makeFileHandle(full);
      },
      async removeEntry(seg: string) {
        const full = prefix ? `${prefix}/${seg}` : seg;
        store.delete(full);
      },
    };
  }

  return { handle: makeDirHandle(""), store };
}

describe("v5.1 protocol, extension & desktop assets", () => {
  it("uses v5 bridge channel, supports v5.1 actions, and accepts v4/v3 legacy channels", () => {
    expect(BRIDGE_CHANNEL).toBe("real-browser-web/v5");
    expect(BRIDGE_VERSION).toBe(5);
    expect(isBridgeCommand({ channel: "real-browser-web/v5", id: "1", action: "desktopConnect" })).toBe(true);
    expect(isBridgeCommand({ channel: "real-browser-web/v5", id: "2", action: "workspaceAriaSnapshot" })).toBe(true);
    expect(isBridgeCommand({ channel: "real-browser-web/v5", id: "3", action: "workspaceAnnotatedScreenshot" })).toBe(true);
    expect(isBridgeCommand({ channel: "real-browser-web/v5", id: "4", action: "workspaceDiagnostics" })).toBe(true);
    expect(isBridgeCommand({ channel: "real-browser-web/v4", id: "5", action: "status" })).toBe(true);
    expect(isBridgeCommand({ channel: "real-browser-web/v3", id: "6", action: "workspaceCreate" })).toBe(true);
    expect(isBridgeCommand({ channel: "real-browser-web/v5", id: "7", action: "unknownAction" })).toBe(false);
  });

  it("ships Windows 10/11 Desktop Agent and Chrome Side Panel assets", () => {
    const root = resolve(import.meta.dirname, "..");
    expect(existsSync(resolve(root, "desktop-agent/moho_desktop_agent.py"))).toBe(true);
    expect(existsSync(resolve(root, "desktop-agent/install_windows.ps1"))).toBe(true);
    expect(existsSync(resolve(root, "desktop-agent/start_agent.bat"))).toBe(true);
    expect(existsSync(resolve(root, "extension/sidepanel.html"))).toBe(true);
    expect(existsSync(resolve(root, "extension/sidepanel.js"))).toBe(true);
    expect(existsSync(resolve(root, "docs/INDEX.md"))).toBe(true);
    expect(existsSync(resolve(root, "docs/V6_HIDDEN_DESKTOP_AND_SANDBOX_TERMINAL.md"))).toBe(true);
    expect(typeof isWebMCPSupported()).toBe("boolean");
  });
});

describe("LocalFolderBrain v5.1 (.gitignore, Surgical Search-Replace, Direct Apply, Undo)", () => {
  it("respects .gitignore, applies surgical search-replace patch, and rolls back", async () => {
    const mock = createMockDirectory({
      ".gitignore": "secret-cache/\n*.log\n",
      "src/app.ts": "export const version = 1;\nexport const greeting = 'hello';\n",
      "debug.log": "noisy log\n",
      "node_modules/pkg/index.js": "module.exports = {};\n",
    });

    const brain = new LocalFolderBrain({
      onConfirmDirectEdit: () => true,
    });

    await brain.attachDirectoryHandle(mock.handle);
    const tree = await brain.scanTree();
    expect(tree.some((e) => e.path === "src/app.ts")).toBe(true);
    expect(tree.some((e) => e.path === "debug.log")).toBe(false);
    expect(tree.some((e) => e.path.includes("node_modules"))).toBe(false);

    const patch = await brain.applySearchReplacePatch(
      "src/app.ts",
      "greeting = 'hello'",
      "greeting = 'مرحبا موهو'"
    );
    expect(patch.applied).toBe(true);
    expect(patch.replacements).toBe(1);
    expect(mock.store.get("src/app.ts")).toContain("export const version = 1;");
    expect(mock.store.get("src/app.ts")).toContain("مرحبا موهو");

    const undone = await brain.undoLastEdit();
    expect(undone.undone).toBe(true);
    expect(mock.store.get("src/app.ts")).toContain("greeting = 'hello'");
  });

  it("computes unified diff and blocks path traversal", async () => {
    const diff = computeUnifiedDiff("a.ts", "line1\nline2", "line1\nline2_fixed");
    expect(diff.addedLines).toBe(1);
    expect(diff.removedLines).toBe(1);
    expect(diff.unifiedDiff).toContain("-line2");
    expect(diff.unifiedDiff).toContain("+line2_fixed");

    const mock = createMockDirectory({ "safe.txt": "ok" });
    const brain = new LocalFolderBrain();
    await brain.attachDirectoryHandle(mock.handle);
    await expect(brain.readFile("../secret.txt")).rejects.toThrow(/traversal/i);
  });
});

describe("Unified AI Platform Toolkit v5.1 (Gemini / Claude / OpenAI / MCP / WebMCP)", () => {
  it("exports v5.1 schemas for all 4 AI platforms and routes fs_search_replace_patch", async () => {
    const gemini = toGeminiFunctionDeclarations();
    const claude = toAnthropicTools();
    const openai = toOpenAITools();
    const mcp = toMcpTools();

    expect(gemini.some((t) => t.name === "browser_aria_snapshot")).toBe(true);
    expect(claude.some((t) => t.name === "browser_annotated_screenshot")).toBe(true);
    expect(openai.some((t) => t.function.name === "desktop_inspect_controls")).toBe(true);
    expect(mcp.some((t) => t.name === "fs_search_replace_patch")).toBe(true);
    expect(gemini.some((t) => t.name === "terminal_exec")).toBe(true);
    expect(claude.some((t) => t.name === "terminal_run_code")).toBe(true);
    expect(openai.some((t) => t.function.name === "terminal_run_file")).toBe(true);

    const mock = createMockDirectory({ "index.ts": "const x = 1;\n" });
    const brain = new LocalFolderBrain();
    await brain.attachDirectoryHandle(mock.handle);

    const executor = new UnifiedAIToolExecutor({ folderBrain: brain });
    const res = (await executor.execute("fs_search_replace_patch", {
      path: "index.ts",
      searchBlock: "const x = 1;",
      replaceBlock: "const x = 42;",
    })) as { applied: boolean };
    expect(res.applied).toBe(true);
    expect(mock.store.get("index.ts")).toBe("const x = 42;\n");
  });
});

describe("Universal AI Agent Support (v6.2.0 custom/unsupported models)", () => {
  it("generates universal system prompt and parses <tool_call> blocks cleanly", () => {
    const prompt = toUniversalSystemPrompt();
    expect(prompt).toContain("desktop_open_start_menu");
    expect(prompt).toContain("terminal_run_code");
    const parsed = parseUniversalToolCalls(
      'Thinking... <tool_call>{"name": "desktop_open_start_menu", "arguments": {}}</tool_call>'
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("desktop_open_start_menu");
  });
});
