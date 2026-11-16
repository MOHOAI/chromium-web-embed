import { describe, it, expect } from "vitest";
import {
  GeminiComputerUseAdapter,
  AnthropicComputerUseAdapter,
  OpenAIComputerUseAdapter,
  SafetyPolicyEngine,
} from "../src/index.js";

describe("Multi-provider Computer Use Adapters", () => {
  it("parses Gemini 4 function_call with normalized coordinates and safety_decision", () => {
    const adapter = new GeminiComputerUseAdapter();
    const actions = adapter.parseActions({
      id: "int_1",
      steps: [
        {
          type: "function_call",
          id: "call_1",
          name: "click",
          arguments: {
            x: 450,
            y: 120,
            intent: "Click search input",
            safety_decision: {
              decision: "require_confirmation",
              explanation: "Confirm form click",
            },
          },
        },
      ],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].action.type).toBe("click");
    expect(actions[0].safetyDecision?.decision).toBe("require_confirmation");
  });

  it("enforces Anthropic fail-fast batch error semantics", () => {
    const adapter = new AnthropicComputerUseAdapter();
    const parsed = adapter.parseActions({
      content: [
        { type: "tool_use", id: "t1", name: "left_click", toolset_name: "computer", input: { coordinate: [100, 200] } },
        { type: "tool_use", id: "t2", name: "screenshot", toolset_name: "computer", input: {} },
      ],
    });
    const results = adapter.formatResults([
      {
        parsed: parsed[0],
        result: { ok: false, actionType: "click", tabId: 1, url: "https://example.com", error: "Failed", durationMs: 5 },
      },
      {
        parsed: parsed[1],
        skipped: true,
        result: { ok: false, actionType: "take_screenshot", tabId: 1, url: "https://example.com", durationMs: 0 },
      },
    ]);
    expect(results[1].is_error).toBe(true);
    expect(results[1].content).toBe("Not executed: an earlier computer action in this turn failed.");
  });

  it("parses OpenAI computer_call batched actions and pending_safety_checks", () => {
    const adapter = new OpenAIComputerUseAdapter();
    const actions = adapter.parseActions({
      output: [
        {
          type: "computer_call",
          call_id: "cua_1",
          pending_safety_checks: [{ id: "sc_1", message: "Verify checkout" }],
          actions: [
            { type: "click", x: 300, y: 400, button: "left" },
            { type: "keypress", keys: ["CTRL", "L"] },
          ],
        },
      ],
    });
    expect(actions).toHaveLength(2);
    expect(actions[0].safetyDecision?.id).toBe("sc_1");
    expect(actions[1].action.type).toBe("hotkey");
  });

  it("enforces SafetyPolicyEngine URL allowlist and blocklist", () => {
    const engine = new SafetyPolicyEngine({
      allowlist: ["aistudio.google.com"],
      blocklist: ["evil.com"],
    });
    expect(engine.isUrlAllowed("https://aistudio.google.com/docs").allowed).toBe(true);
    expect(engine.isUrlAllowed("https://evil.com").allowed).toBe(false);
    expect(engine.isUrlAllowed("https://other.org").allowed).toBe(false);
  });
});
