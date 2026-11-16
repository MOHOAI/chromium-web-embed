import {
  RealBrowserClient,
  createManagedBrowserAgent,
  GeminiComputerUseAdapter,
  ComputerUseAgentRunner,
  DEFAULT_COMPUTER_USE_SYSTEM_INSTRUCTION,
} from "../src/index.js";

export async function runGeminiComputerUseExample(genaiClient: any, goal: string) {
  const client = new RealBrowserClient({ label: "Gemini Computer Use" });
  await client.connect();
  await client.createWorkspace({
    url: "https://www.google.com",
    agentControlEnabled: true,
  });

  const agent = createManagedBrowserAgent({
    client,
    safety: {
      blocklist: ["chrome://", "file://"],
    },
  });

  const adapter = new GeminiComputerUseAdapter();
  const runner = new ComputerUseAgentRunner({
    agent,
    adapter,
    turnLimit: 12,
    onSafetyConfirmation: async ({ action, decision }) => {
      console.warn(`[HITL] ${action.type}: ${decision.explanation}`);
      return "CONTINUE" as const;
    },
  });

  return runner.run(goal, async ({ prompt, initialScreenshot, toolResults, previousResponse }) => {
    return genaiClient.interactions.create({
      model: "gemini-4-hydrogen",
      system_instruction: DEFAULT_COMPUTER_USE_SYSTEM_INSTRUCTION,
      previous_interaction_id: previousResponse?.id,
      input: toolResults ?? [
        { type: "text", text: prompt },
        {
          type: "image",
          data: initialScreenshot!.base64,
          mime_type: initialScreenshot!.mimeType,
        },
      ],
      tools: [
        GeminiComputerUseAdapter.buildToolConfig({
          environment: "browser",
          enablePromptInjectionDetection: true,
        }),
      ],
    });
  });
}
