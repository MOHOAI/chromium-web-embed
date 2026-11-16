import {
  AnthropicComputerUseAdapter,
  OpenAIComputerUseAdapter,
  GenericComputerUseAdapter,
  createProviderAdapter,
} from "../src/providers/index.js";

// 1. Anthropic Claude (computer_toolset_20260801)
export const anthropicTool = AnthropicComputerUseAdapter.buildToolConfig({
  cacheControl: { type: "ephemeral" },
});

// 2. OpenAI Responses API (computer)
export const openaiTool = OpenAIComputerUseAdapter.buildToolConfig();

// 3. Factory helper for dynamic provider switching
export function getAdapterForModel(provider: "gemini" | "anthropic" | "openai" | "generic") {
  return createProviderAdapter(provider);
}

export { GenericComputerUseAdapter };
