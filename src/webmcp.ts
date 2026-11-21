/**
 * Chrome WebMCP Integration (v5.1.0)
 * ----------------------------------
 * Bridges `chromium-web-embed` with Chrome's WebMCP API (`document.modelContext.registerTool`)
 * following Chrome's official Modern Web Guidance:
 *  - Uses `AbortController` / `AbortSignal` for clean tool unregistration
 *  - Marks read-only tools with `annotations: { readOnlyHint: true }`
 *  - Supports discovering declarative `<form toolname="...">` tools on web pages
 */

import {
  getUnifiedToolSpecs,
  type UnifiedAIToolExecutor,
  type UnifiedToolkitSelection,
} from "./providers/ai-toolkit.js";

const READ_ONLY_TOOLS = new Set([
  "browser_observe",
  "browser_aria_snapshot",
  "browser_annotated_screenshot",
  "browser_diagnostics",
  "desktop_screenshot",
  "desktop_list_windows",
  "desktop_inspect_controls",
  "fs_list_project_files",
  "fs_read_file",
  "fs_search_project",
]);

export interface WebMCPRegistrationHandle {
  supported: boolean;
  registeredCount: number;
  toolNames: string[];
  dispose: () => void;
}

export interface DiscoveredWebMCPForm {
  toolName: string;
  toolDescription: string;
  selector: string;
  fields: Array<{ name: string; type: string; required: boolean; placeholder?: string }>;
}

export function isWebMCPSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof (document as any).modelContext?.registerTool === "function"
  );
}

/**
 * Registers `chromium-web-embed` tools (Browser, Windows Desktop, Local Folder Brain)
 * into Chrome's native `document.modelContext` (WebMCP) with `AbortSignal` cleanup.
 */
export function registerWithChromeWebMCP(
  executor: UnifiedAIToolExecutor,
  selection?: UnifiedToolkitSelection
): WebMCPRegistrationHandle {
  if (!isWebMCPSupported()) {
    return {
      supported: false,
      registeredCount: 0,
      toolNames: [],
      dispose: () => {},
    };
  }

  const controller = new AbortController();
  const specs = getUnifiedToolSpecs(selection);
  const registered: string[] = [];
  const modelContext = (document as any).modelContext;

  for (const spec of specs) {
    try {
      modelContext.registerTool(
        {
          name: spec.name,
          description: spec.description,
          inputSchema: spec.parameters,
          execute: async (input: Record<string, unknown>) => {
            const result = await executor.execute(spec.name, input ?? {});
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
            };
          },
          annotations: {
            readOnlyHint: READ_ONLY_TOOLS.has(spec.name),
          },
        },
        { signal: controller.signal }
      );
      registered.push(spec.name);
    } catch {
      // skip if a tool name is already registered or rejected by host browser
    }
  }

  return {
    supported: true,
    registeredCount: registered.length,
    toolNames: registered,
    dispose: () => controller.abort(),
  };
}

/**
 * Scans the current document for declarative WebMCP `<form toolname="...">` elements.
 */
export function discoverDeclarativeWebMCPForms(root: ParentNode = document): DiscoveredWebMCPForm[] {
  if (typeof root?.querySelectorAll !== "function") return [];
  const forms = Array.from(root.querySelectorAll("form[toolname]"));
  return forms.map((form, idx) => {
    const toolName = form.getAttribute("toolname") || `form_tool_${idx}`;
    const toolDescription = form.getAttribute("tooldescription") || "";
    const id = form.getAttribute("id");
    const selector = id ? `#${id}` : `form[toolname="${toolName}"]`;
    const inputs = Array.from(form.querySelectorAll("input, select, textarea"));
    const fields = inputs
      .map((el) => ({
        name: el.getAttribute("name") || el.getAttribute("id") || "",
        type: el.getAttribute("type") || el.tagName.toLowerCase(),
        required: el.hasAttribute("required"),
        placeholder: el.getAttribute("placeholder") || undefined,
      }))
      .filter((f) => Boolean(f.name));

    return { toolName, toolDescription, selector, fields };
  });
}
