import type {
  ComputerUseEnvironment,
  SafetyDecision,
  SafetyPolicyCategory,
  SharedTabScreenshot,
  UnifiedComputerAction,
} from "../protocol.js";
import type {
  ExecutedProviderAction,
  ParsedProviderAction,
  ProviderAdapter,
} from "./types.js";

export interface GeminiComputerUseToolOptions {
  environment?: ComputerUseEnvironment;
  enablePromptInjectionDetection?: boolean;
  disabledSafetyPolicies?: Array<Lowercase<SafetyPolicyCategory> | SafetyPolicyCategory>;
  excludedPredefinedFunctions?: string[];
}

export interface GeminiInteractionStep {
  type: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
}

export interface GeminiInteractionResponse {
  id?: string;
  steps?: GeminiInteractionStep[];
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: {
          id?: string;
          name: string;
          args?: Record<string, unknown>;
        };
      }>;
    };
  }>;
}

export interface GeminiFunctionResultStep {
  type: "function_result";
  name: string;
  call_id: string;
  result: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mime_type: "image/png" | "image/jpeg" }
  >;
}

function mapGeminiCallToUnified(
  name: string,
  args: Record<string, unknown>
): UnifiedComputerAction {
  const intent = typeof args.intent === "string" ? args.intent : undefined;
  const x = typeof args.x === "number" ? args.x : undefined;
  const y = typeof args.y === "number" ? args.y : undefined;

  switch (name) {
    case "click":
    case "double_click":
    case "triple_click":
    case "middle_click":
    case "right_click":
    case "mouse_down":
    case "mouse_up":
    case "move":
      return {
        type: name,
        x,
        y,
        coordinateSpace: "normalized_1000",
        intent,
      };
    case "long_press":
      return {
        type: "long_press",
        x: x ?? 500,
        y: y ?? 500,
        seconds: typeof args.seconds === "number" ? args.seconds : 2,
        coordinateSpace: "normalized_1000",
        intent,
      };
    case "type":
      return {
        type: "type",
        text: String(args.text ?? ""),
        x,
        y,
        coordinateSpace: "normalized_1000",
        pressEnter: Boolean(args.press_enter),
        clearFirst: args.clear_first !== undefined ? Boolean(args.clear_first) : true,
        intent,
      };
    case "drag_and_drop":
      return {
        type: "drag_and_drop",
        startX: Number(args.start_x ?? 0),
        startY: Number(args.start_y ?? 0),
        endX: Number(args.end_x ?? 0),
        endY: Number(args.end_y ?? 0),
        coordinateSpace: "normalized_1000",
        intent,
      };
    case "press_key":
    case "key_down":
    case "key_up":
      return {
        type: name,
        key: String(args.key ?? ""),
        intent,
      };
    case "hotkey":
      return {
        type: "hotkey",
        keys: Array.isArray(args.keys) ? args.keys.map(String) : [],
        intent,
      };
    case "scroll":
      return {
        type: "scroll",
        x,
        y,
        direction: (args.direction as "up" | "down" | "left" | "right") ?? "down",
        magnitudeInPixels:
          typeof args.magnitude_in_pixels === "number" ? args.magnitude_in_pixels : 300,
        coordinateSpace: "normalized_1000",
        intent,
      };
    case "navigate":
      return {
        type: "navigate",
        url: String(args.url ?? ""),
        intent,
      };
    case "go_back":
    case "go_forward":
    case "take_screenshot":
      return { type: name, intent };
    case "wait":
      return {
        type: "wait",
        seconds: typeof args.seconds === "number" ? args.seconds : 1,
        intent,
      };
    default:
      return { type: "wait", seconds: 0, intent: intent ?? `Unhandled Gemini action: ${name}` };
  }
}

export class GeminiComputerUseAdapter
  implements ProviderAdapter<GeminiInteractionResponse, GeminiFunctionResultStep[]>
{
  readonly providerId = "gemini" as const;

  static buildToolConfig(options: GeminiComputerUseToolOptions = {}): Record<string, unknown> {
    const config: Record<string, unknown> = {
      type: "computer_use",
      environment: options.environment ?? "browser",
    };
    if (options.enablePromptInjectionDetection !== undefined) {
      config.enable_prompt_injection_detection = options.enablePromptInjectionDetection;
    }
    if (options.disabledSafetyPolicies?.length) {
      config.disabled_safety_policies = options.disabledSafetyPolicies.map((p) =>
        p.toLowerCase()
      );
    }
    if (options.excludedPredefinedFunctions?.length) {
      config.excluded_predefined_functions = options.excludedPredefinedFunctions;
    }
    return config;
  }

  parseActions(response: GeminiInteractionResponse): ParsedProviderAction[] {
    const actions: ParsedProviderAction[] = [];

    if (Array.isArray(response.steps)) {
      for (let i = 0; i < response.steps.length; i++) {
        const step = response.steps[i];
        if (step.type !== "function_call" || !step.name) continue;
        const args = step.arguments ?? {};
        const rawSafety = args.safety_decision as Record<string, unknown> | undefined;
        const safetyDecision: SafetyDecision | undefined = rawSafety
          ? {
              decision:
                (rawSafety.decision as SafetyDecision["decision"]) ??
                "require_confirmation",
              explanation:
                typeof rawSafety.explanation === "string"
                  ? rawSafety.explanation
                  : undefined,
            }
          : undefined;

        actions.push({
          callId: step.id ?? `gemini_call_${i}`,
          rawName: step.name,
          action: mapGeminiCallToUnified(step.name, args),
          safetyDecision,
          rawArguments: args,
        });
      }
      return actions;
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (let i = 0; i < parts.length; i++) {
      const fc = parts[i].functionCall;
      if (!fc) continue;
      const args = fc.args ?? {};
      actions.push({
        callId: fc.id ?? `gemini_fc_${i}`,
        rawName: fc.name,
        action: mapGeminiCallToUnified(fc.name, args),
        rawArguments: args,
      });
    }

    return actions;
  }

  isComplete(response: GeminiInteractionResponse): boolean {
    return this.parseActions(response).length === 0;
  }

  extractFinalText(response: GeminiInteractionResponse): string {
    if (Array.isArray(response.steps)) {
      const texts: string[] = [];
      for (const step of response.steps) {
        if (step.type === "model_output" && Array.isArray(step.content)) {
          for (const block of step.content) {
            if (block.type === "text" && block.text) {
              texts.push(block.text);
            }
          }
        }
      }
      return texts.join(" ").trim();
    }

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    return parts
      .map((p) => p.text ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  formatResults(
    executed: ExecutedProviderAction[],
    latestScreenshot?: SharedTabScreenshot
  ): GeminiFunctionResultStep[] {
    return executed.map(({ parsed, result }) => {
      const screenshot = result.screenshot ?? latestScreenshot;
      const meta: Record<string, unknown> = {
        url: result.url,
      };
      if (result.error) {
        meta.error = result.error;
      }
      if (result.safetyAcknowledgement) {
        meta.safety_acknowledgement = true;
      }

      const content: GeminiFunctionResultStep["result"] = [
        { type: "text", text: JSON.stringify(meta) },
      ];
      if (screenshot) {
        content.push({
          type: "image",
          data: screenshot.base64,
          mime_type: screenshot.mimeType,
        });
      }

      return {
        type: "function_result",
        name: parsed.rawName,
        call_id: parsed.callId,
        result: content,
      };
    });
  }
}
