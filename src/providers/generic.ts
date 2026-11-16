import type {
  SharedTabScreenshot,
  UnifiedComputerAction,
} from "../protocol.js";
import type {
  ExecutedProviderAction,
  ParsedProviderAction,
  ProviderAdapter,
} from "./types.js";

export interface GenericAgentResponse {
  done?: boolean;
  message?: string;
  actions?: UnifiedComputerAction[];
}

export interface GenericAgentToolResult {
  results: Array<{
    callId: string;
    ok: boolean;
    url: string;
    error?: string;
    cursorPosition?: { x: number; y: number };
  }>;
  screenshot?: {
    mimeType: string;
    base64: string;
    width: number;
    height: number;
    url: string;
  };
}

export class GenericComputerUseAdapter
  implements ProviderAdapter<GenericAgentResponse, GenericAgentToolResult>
{
  readonly providerId = "generic" as const;

  parseActions(response: GenericAgentResponse): ParsedProviderAction[] {
    return (response.actions ?? []).map((action, idx) => ({
      callId: `generic_${idx}`,
      rawName: action.type,
      action,
    }));
  }

  isComplete(response: GenericAgentResponse): boolean {
    return Boolean(response.done) || (response.actions?.length ?? 0) === 0;
  }

  extractFinalText(response: GenericAgentResponse): string {
    return (response.message ?? "").trim();
  }

  formatResults(
    executed: ExecutedProviderAction[],
    latestScreenshot?: SharedTabScreenshot
  ): GenericAgentToolResult {
    return {
      results: executed.map(({ parsed, result }) => ({
        callId: parsed.callId,
        ok: result.ok,
        url: result.url,
        error: result.error,
        cursorPosition: result.cursorPosition,
      })),
      screenshot: latestScreenshot
        ? {
            mimeType: latestScreenshot.mimeType,
            base64: latestScreenshot.base64,
            width: latestScreenshot.width,
            height: latestScreenshot.height,
            url: latestScreenshot.url,
          }
        : undefined,
    };
  }
}
