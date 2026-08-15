import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const popupHtml = readFileSync(resolve(process.cwd(), "extension/popup.html"), "utf8");
const popupScript = readFileSync(resolve(process.cwd(), "extension/popup.js"), "utf8");

describe("مؤشر موافقة الوكيل في نافذة الإضافة", () => {
  it("يعرض مؤشر حالة مرئيًا ويقرأ صلاحية الوكيل من مساحة العمل", () => {
    expect(popupHtml).toContain('id="agent-status"');
    expect(popupHtml).toContain('data-state="unknown"');
    expect(popupScript).toContain('setAgentStatus(workspace.agentControlEnabled)');
    expect(popupScript).toContain('صلاحية الوكيل: مفعّلة');
    expect(popupScript).toContain('صلاحية الوكيل: معطّلة');
  });
});
