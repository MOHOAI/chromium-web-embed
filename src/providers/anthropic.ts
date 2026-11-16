import type {
  ModifierKey,
  SharedTabScreenshot,
  UnifiedComputerAction,
} from "../protocol.js";
import type {
  ExecutedProviderAction,
  ParsedProviderAction,
  ProviderAdapter,
} from "./types.js";

export interface AnthropicToolUseBlock {
  type: "tool_use" | "text";
  id?: string;
  name?: string;
  toolset_name?: string;
  input?: Record<string, unknown>;
  text?: string;
}

export interface AnthropicMessageResponse {
  id?: string;
  stop_reason?: string;
  content?: AnthropicToolUseBlock[];
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  toolset_name: "computer";
  is_error?: boolean;
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | {
            type: "image";
            source: {
              type: "base64";
              media_type: "image/png" | "image/jpeg";
              data: string;
            };
          }
      >;
}

function parseModifiers(text?: unknown): ModifierKey[] | undefined {
  if (typeof text !== "string" || !text.trim()) return undefined;
  return text
    .split("+")
    .map((m) => m.trim().toLowerCase())
    .filter((m): m is ModifierKey =>
      ["shift", "ctrl", "alt", "meta", "super"].includes(m)
    );
}

function mapAnthropicMemberToUnified(
  name: string,
  input: Record<string, unknown>
): UnifiedComputerAction {
  const coord = Array.isArray(input.coordinate) ? input.coordinate : undefined;
  const x = coord && typeof coord[0] === "number" ? coord[0] : undefined;
  const y = coord && typeof coord[1] === "number" ? coord[1] : undefined;
  const modifiers = parseModifiers(input.text);

  switch (name) {
    case "screenshot":
      return { type: "take_screenshot" };
    case "zoom": {
      const region = Array.isArray(input.region)
        ? (input.region.slice(0, 4).map(Number) as [number, number, number, number])
        : ([0, 0, 100, 100] as [number, number, number, number]);
      return { type: "zoom", region, coordinateSpace: "pixels" };
    }
    case "left_click":
      return { type: "click", x, y, coordinateSpace: "pixels", modifiers };
    case "right_click":
      return { type: "right_click", x, y, coordinateSpace: "pixels", modifiers };
    case "middle_click":
      return { type: "middle_click", x, y, coordinateSpace: "pixels", modifiers };
    case "double_click":
      return { type: "double_click", x, y, coordinateSpace: "pixels", modifiers };
    case "triple_click":
      return { type: "triple_click", x, y, coordinateSpace: "pixels", modifiers };
    case "mouse_move":
      return { type: "move", x, y, coordinateSpace: "pixels" };
    case "left_mouse_down":
      return { type: "mouse_down", coordinateSpace: "pixels" };
    case "left_mouse_up":
      return { type: "mouse_up", coordinateSpace: "pixels" };
    case "cursor_position":
      return { type: "cursor_position" };
    case "left_click_drag": {
      const start = Array.isArray(input.start_coordinate)
        ? input.start_coordinate
        : [0, 0];
      const end = Array.isArray(input.coordinate) ? input.coordinate : [0, 0];
      return {
        type: "drag_and_drop",
        startX: Number(start[0] ?? 0),
        startY: Number(start[1] ?? 0),
        endX: Number(end[0] ?? 0),
        endY: Number(end[1] ?? 0),
        coordinateSpace: "pixels",
        modifiers,
      };
    }
    case "scroll":
      return {
        type: "scroll",
        x,
        y,
        direction:
          (input.scroll_direction as "up" | "down" | "left" | "right") ?? "down",
        magnitudeInPixels: Number(input.scroll_amount ?? 3) * 100,
        coordinateSpace: "pixels",
        modifiers,
      };
    case "type":
      return {
        type: "type",
        text: String(input.text ?? ""),
        clearFirst: false,
      };
    case "key": {
      const keyStr = String(input.text ?? "");
      if (keyStr.includes("+")) {
        return { type: "hotkey", keys: keyStr.split("+").map((k) => k.trim()) };
      }
      return {
        type: "press_key",
        key: keyStr,
        repeat: typeof input.repeat === "number" ? input.repeat : 1,
      };
    }
    case "hold_key":
      return {
        type: "hold_key",
        key: String(input.text ?? ""),
        seconds: Number(input.duration ?? 1),
      };
    case "wait":
      return {
        type: "wait",
        seconds: Number(input.duration ?? 1),
      };
    default:
      return { type: "wait", seconds: 0, intent: `Unhandled Anthropic action: ${name}` };
  }
}

export class AnthropicComputerUseAdapter
  implements ProviderAdapter<AnthropicMessageResponse, AnthropicToolResultBlock[]>
{
  readonly providerId = "anthropic" as const;

  static buildToolConfig(options?: {
    configs?: Record<string, { enabled?: boolean; defer_loading?: boolean }>;
    cacheControl?: { type: "ephemeral" };
  }): Record<string, unknown> {
    const tool: Record<string, unknown> = {
      type: "computer_toolset_20260801",
    };
    if (options?.configs) tool.configs = options.configs;
    if (options?.cacheControl) tool.cache_control = options.cacheControl;
    return tool;
  }

  parseActions(response: AnthropicMessageResponse): ParsedProviderAction[] {
    const blocks = response.content ?? [];
    const actions: ParsedProviderAction[] = [];

    for (const block of blocks) {
      if (
        block.type === "tool_use" &&
        block.toolset_name === "computer" &&
        block.name
      ) {
        const input = block.input ?? {};
        actions.push({
          callId: block.id ?? `anthropic_${actions.length}`,
          rawName: block.name,
          action: mapAnthropicMemberToUnified(block.name, input),
          rawArguments: input,
        });
      }
    }
    return actions;
  }

  isComplete(response: AnthropicMessageResponse): boolean {
    return this.parseActions(response).length === 0;
  }

  extractFinalText(response: AnthropicMessageResponse): string {
    return (response.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join(" ")
      .trim();
  }

  formatResults(
    executed: ExecutedProviderAction[],
    latestScreenshot?: SharedTabScreenshot
  ): AnthropicToolResultBlock[] {
    return executed.map(({ parsed, result, skipped }, idx) => {
      if (skipped) {
        return {
          type: "tool_result",
          tool_use_id: parsed.callId,
          toolset_name: "computer",
          is_error: true,
          content: "Not executed: an earlier computer action in this turn failed.",
        };
      }

      if (!result.ok) {
        return {
          type: "tool_result",
          tool_use_id: parsed.callId,
          toolset_name: "computer",
          is_error: true,
          content: result.error ?? "Action failed",
        };
      }

      if (parsed.rawName === "screenshot" || parsed.rawName === "zoom") {
        const shot = result.screenshot ?? latestScreenshot;
        if (shot) {
          return {
            type: "tool_result",
            tool_use_id: parsed.callId,
            toolset_name: "computer",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: shot.mimeType,
                  data: shot.base64,
                },
              },
            ],
          };
        }
      }

      if (parsed.rawName === "cursor_position" && result.cursorPosition) {
        return {
          type: "tool_result",
          tool_use_id: parsed.callId,
          toolset_name: "computer",
          content: [
            {
              type: "text",
              text: `X=${result.cursorPosition.x}, Y=${result.cursorPosition.y}`,
            },
          ],
        };
      }

      const isLast = idx === executed.length - 1;
      const content: AnthropicToolResultBlock["content"] = [
        { type: "text", text: "OK" },
      ];
      if (isLast && latestScreenshot) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: latestScreenshot.mimeType,
            data: latestScreenshot.base64,
          },
        });
      }

      return {
        type: "tool_result",
        tool_use_id: parsed.callId,
        toolset_name: "computer",
        content,
      };
    });
  }
}
