import { describe, expect, it } from "vitest";
import { assertAgentControlEnabled } from "../src/agent-control-policy";

describe("agent control policy", () => {
  it("يرفض أوامر الوكيل عندما لم يفعّل المستخدم التحكم", () => {
    expect(() => assertAgentControlEnabled({ agentControlEnabled: false })).toThrow("Agent control is disabled");
  });

  it("يسمح بأوامر الوكيل بعد تفعيل التحكم صراحةً", () => {
    expect(() => assertAgentControlEnabled({ agentControlEnabled: true })).not.toThrow();
  });
});
