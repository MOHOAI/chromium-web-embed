import type {
  AgentExecutionResult,
  SafetyDecision,
  SharedTabScreenshot,
  UnifiedComputerAction,
} from "../protocol.js";

export type ComputerUseProviderId = "gemini" | "anthropic" | "openai" | "generic";

export interface ParsedProviderAction {
  callId: string;
  rawName: string;
  action: UnifiedComputerAction;
  safetyDecision?: SafetyDecision;
  rawArguments?: Record<string, unknown>;
}

export interface ExecutedProviderAction {
  parsed: ParsedProviderAction;
  result: AgentExecutionResult;
  skipped?: boolean;
}

export interface ProviderAdapter<TResponse = unknown, TToolResultPayload = unknown> {
  readonly providerId: ComputerUseProviderId;
  parseActions(response: TResponse): ParsedProviderAction[];
  isComplete(response: TResponse): boolean;
  extractFinalText(response: TResponse): string;
  formatResults(
    executed: ExecutedProviderAction[],
    latestScreenshot?: SharedTabScreenshot
  ): TToolResultPayload;
}
