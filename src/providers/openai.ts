import type {
  ModifierKey,
  SafetyDecision,
  SharedTabScreenshot,
  UnifiedComputerAction,
} from "../protocol.js";
import type {
  ExecutedProviderAction,
  ParsedProviderAction,
  ProviderAdapter,
} from "./types.js";

export interface OpenAIPendingSafetyCheck {
  id: string;
  code?: string;
  message?: string;
}

export interface OpenAIComputerActionItem {
  type: string;
  x?: number;
  y?: number;
  button?: "left" | "right" | "wheel" | "middle" | "back" | "forward";
  text?: string;
  keys?: string[];
  scroll_x?: number;
  scroll_y?: number;
  path?: Array<{ x: number; y: number }>;
}

export interface OpenAIResponseOutputItem {
  type: string;
  id?: string;
  call_id?: string;
  action?: OpenAIComputerActionItem;
  actions?: OpenAIComputerActionItem[];
  pending_safety_checks?: OpenAIPendingSafetyCheck[];
  content?: Array<{ type: string; text?: string }>;
}

export interface OpenAIResponsesOutput {
  id?: string;
  output?: OpenAIResponseOutputItem[];
  output_text?: string;
}

export interface OpenAIComputerCallOutput {
  type: "computer_call_output";
  call_id: string;
  acknowledged_safety_checks?: Array<{ id: string; code?: string; message?: string }>;
  output: {
    type: "computer_screenshot" | "input_image";
    image_url: string;
  };
}

function mapOpenAIActionToUnified(
  item: OpenAIComputerActionItem
): UnifiedComputerAction {
  const modifiers = Array.isArray(item.keys)
    ? item.keys
        .map((k) => k.toLowerCase())
        .filter((k): k is ModifierKey =>
          ["shift", "ctrl", "alt", "meta", "super"].includes(k)
        )
    : undefined;

  switch (item.type) {
    case "click": {
      if (item.button === "right") {
        return { type: "right_click", x: item.x, y: item.y, coordinateSpace: "pixels", modifiers };
      }
      if (item.button === "wheel" || item.button === "middle") {
        return { type: "middle_click", x: item.x, y: item.y, coordinateSpace: "pixels", modifiers };
      }
      if (item.button === "back") return { type: "go_back" };
      if (item.button === "forward") return { type: "go_forward" };
      return { type: "click", x: item.x, y: item.y, coordinateSpace: "pixels", modifiers };
    }
    case "double_click":
      return { type: "double_click", x: item.x, y: item.y, coordinateSpace: "pixels", modifiers };
    case "move":
      return { type: "move", x: item.x, y: item.y, coordinateSpace: "pixels", modifiers };
    case "drag": {
      const path = item.path ?? [];
      const first = path[0] ?? { x: 0, y: 0 };
      const last = path[path.length - 1] ?? first;
      return {
        type: "drag_and_drop",
        startX: first.x,
        startY: first.y,
        endX: last.x,
        endY: last.y,
        path,
        coordinateSpace: "pixels",
        modifiers,
      };
    }
    case "scroll":
      return {
        type: "scroll",
        x: item.x,
        y: item.y,
        deltaX: item.scroll_x ?? 0,
        deltaY: item.scroll_y ?? 0,
        coordinateSpace: "pixels",
        modifiers,
      };
    case "keypress": {
      const keys = item.keys ?? [];
      if (keys.length > 1) {
        return { type: "hotkey", keys };
      }
      return { type: "press_key", key: keys[0] ?? "" };
    }
    case "type":
      return { type: "type", text: item.text ?? "", clearFirst: false };
    case "wait":
      return { type: "wait", seconds: 2 };
    case "screenshot":
      return { type: "take_screenshot" };
    default:
      return { type: "wait", seconds: 0, intent: `Unhandled OpenAI action: ${item.type}` };
  }
}

export class OpenAIComputerUseAdapter
  implements ProviderAdapter<OpenAIResponsesOutput, OpenAIComputerCallOutput[]>
{
  readonly providerId = "openai" as const;

  static buildToolConfig(): Record<string, unknown> {
    return { type: "computer" };
  }

  parseActions(response: OpenAIResponsesOutput): ParsedProviderAction[] {
    const output = response.output ?? [];
    const actions: ParsedProviderAction[] = [];

    for (const item of output) {
      if (item.type !== "computer_call") continue;
      const callId = item.call_id ?? item.id ?? `openai_call_${actions.length}`;
      const pending = item.pending_safety_checks ?? [];
      const safetyDecision: SafetyDecision | undefined =
        pending.length > 0
          ? {
              decision: "require_confirmation",
              id: pending[0].id,
              explanation: pending
                .map((c) => c.message ?? c.code ?? c.id)
                .join("; "),
            }
          : undefined;

      const list = Array.isArray(item.actions)
        ? item.actions
        : item.action
          ? [item.action]
          : [];

      for (const act of list) {
        actions.push({
          callId,
          rawName: act.type,
          action: mapOpenAIActionToUnified(act),
          safetyDecision,
          rawArguments: act as unknown as Record<string, unknown>,
        });
      }
    }

    return actions;
  }

  isComplete(response: OpenAIResponsesOutput): boolean {
    return this.parseActions(response).length === 0;
  }

  extractFinalText(response: OpenAIResponsesOutput): string {
    if (response.output_text) return response.output_text.trim();
    const texts: string[] = [];
    for (const item of response.output ?? []) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block.text) texts.push(block.text);
        }
      }
    }
    return texts.join(" ").trim();
  }

  formatResults(
    executed: ExecutedProviderAction[],
    latestScreenshot?: SharedTabScreenshot
  ): OpenAIComputerCallOutput[] {
    const byCallId = new Map<string, ExecutedProviderAction[]>();
    for (const entry of executed) {
      const list = byCallId.get(entry.parsed.callId) ?? [];
      list.push(entry);
      byCallId.set(entry.parsed.callId, list);
    }

    const outputs: OpenAIComputerCallOutput[] = [];
    for (const [callId, group] of byCallId.entries()) {
      const last = group[group.length - 1];
      const shot = last?.result.screenshot ?? latestScreenshot;
      const acknowledged = group
        .filter((g) => g.parsed.safetyDecision?.id && g.result.safetyAcknowledgement)
        .map((g) => ({ id: g.parsed.safetyDecision!.id! }));

      outputs.push({
        type: "computer_call_output",
        call_id: callId,
        ...(acknowledged.length > 0 ? { acknowledged_safety_checks: acknowledged } : {}),
        output: {
          type: "computer_screenshot",
          image_url: shot ? shot.dataUrl : "",
        },
      });
    }
    return outputs;
  }
}
