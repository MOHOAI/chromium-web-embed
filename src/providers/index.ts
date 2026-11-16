export * from "./types.js";
export * from "./gemini.js";
export * from "./anthropic.js";
export * from "./openai.js";
export * from "./generic.js";
export * from "./mcp.js";

import { AnthropicComputerUseAdapter } from "./anthropic.js";
import { GeminiComputerUseAdapter } from "./gemini.js";
import { GenericComputerUseAdapter } from "./generic.js";
import { OpenAIComputerUseAdapter } from "./openai.js";
import type { ComputerUseProviderId, ProviderAdapter } from "./types.js";

export function createProviderAdapter(
  provider: ComputerUseProviderId
): ProviderAdapter<any, any> {
  switch (provider) {
    case "gemini":
      return new GeminiComputerUseAdapter();
    case "anthropic":
      return new AnthropicComputerUseAdapter();
    case "openai":
      return new OpenAIComputerUseAdapter();
    case "generic":
      return new GenericComputerUseAdapter();
  }
}
