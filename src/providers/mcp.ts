import type {
  AgentExecutionResult,
  SharedTabScreenshot,
  UnifiedComputerAction,
} from "../protocol.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export function getMcpBrowserTools(): McpToolDefinition[] {
  return [
    {
      name: "browser_navigate",
      description: "Navigate the active workspace tab to an HTTP/HTTPS URL.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
    {
      name: "browser_click",
      description: "Click at x, y (normalized 0-999 or pixels) or by CSS selector.",
      inputSchema: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          selector: { type: "string" },
          button: { type: "string", enum: ["left", "right", "middle"] },
          clickCount: { type: "number" },
          coordinateSpace: { type: "string", enum: ["normalized_1000", "pixels"] },
        },
      },
    },
    {
      name: "browser_type",
      description: "Type text into the focused element, coordinates, or CSS selector.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          selector: { type: "string" },
          pressEnter: { type: "boolean" },
          clearFirst: { type: "boolean" },
        },
        required: ["text"],
      },
    },
    {
      name: "browser_key",
      description: "Press a single key or hotkey combination (e.g. ['Control', 'L']).",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string" },
          keys: { type: "array", items: { type: "string" } },
          repeat: { type: "number" },
        },
      },
    },
    {
      name: "browser_scroll",
      description: "Scroll the page in a direction or to top/bottom/element.",
      inputSchema: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          magnitudeInPixels: { type: "number" },
          x: { type: "number" },
          y: { type: "number" },
        },
      },
    },
    {
      name: "browser_observe",
      description: "Capture a PNG screenshot and interactive DOM elements with normalized coordinates.",
      inputSchema: {
        type: "object",
        properties: {
          includeDom: { type: "boolean" },
        },
      },
    },
    {
      name: "browser_window_mode",
      description: "Change browser window state (normal, maximized, minimized, fullscreen) or page zoom.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["normal", "maximized", "minimized", "fullscreen"] },
          zoomFactor: { type: "number" },
        },
      },
    },
  ];
}

export interface McpCapableAgent {
  executeComputerAction(
    action: UnifiedComputerAction | Record<string, unknown>,
    options?: { provider?: "generic" }
  ): Promise<AgentExecutionResult>;
  screenshot(options?: { format?: "png" | "jpeg" }): Promise<SharedTabScreenshot>;
  getInteractiveElements?(): Promise<unknown>;
}

export async function handleMcpToolCall(
  agent: McpCapableAgent,
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  switch (toolName) {
    case "browser_navigate":
      return agent.executeComputerAction({ type: "navigate", url: String(args.url || "") });
    case "browser_click": {
      if (args.selector) {
        return agent.executeComputerAction({
          type: "click_selector",
          selector: String(args.selector),
        } as unknown as Record<string, unknown>);
      }
      const btn = args.button === "right" ? "right_click" : args.button === "middle" ? "middle_click" : args.clickCount === 2 ? "double_click" : args.clickCount === 3 ? "triple_click" : "click";
      return agent.executeComputerAction({
        type: btn,
        x: Number(args.x ?? 0),
        y: Number(args.y ?? 0),
        coordinateSpace: (args.coordinateSpace as "normalized_1000" | "pixels") ?? "normalized_1000",
      });
    }
    case "browser_type":
      return agent.executeComputerAction({
        type: args.selector ? "type_selector" : "type",
        selector: args.selector ? String(args.selector) : undefined,
        text: String(args.text ?? ""),
        x: typeof args.x === "number" ? args.x : undefined,
        y: typeof args.y === "number" ? args.y : undefined,
        pressEnter: Boolean(args.pressEnter),
        clearFirst: Boolean(args.clearFirst),
        coordinateSpace: "normalized_1000",
      } as unknown as Record<string, unknown>);
    case "browser_key":
      if (Array.isArray(args.keys)) {
        return agent.executeComputerAction({ type: "hotkey", keys: args.keys.map(String) });
      }
      return agent.executeComputerAction({
        type: "press_key",
        key: String(args.key ?? "Enter"),
        repeat: typeof args.repeat === "number" ? args.repeat : 1,
      });
    case "browser_scroll":
      return agent.executeComputerAction({
        type: "scroll",
        direction: (args.direction as "up" | "down" | "left" | "right") ?? "down",
        magnitudeInPixels: typeof args.magnitudeInPixels === "number" ? args.magnitudeInPixels : 300,
        x: typeof args.x === "number" ? args.x : undefined,
        y: typeof args.y === "number" ? args.y : undefined,
        coordinateSpace: "normalized_1000",
      });
    case "browser_observe": {
      const screenshot = await agent.screenshot({ format: "png" });
      const elements =
        args.includeDom !== false && agent.getInteractiveElements
          ? await agent.getInteractiveElements()
          : undefined;
      return { screenshot, elements };
    }
    case "browser_window_mode":
      return agent.executeComputerAction({
        type: "window_mode",
        mode: args.mode,
        zoomFactor: args.zoomFactor,
      } as unknown as Record<string, unknown>);
    default:
      throw new Error(`Unknown MCP browser tool: ${toolName}`);
  }
}
