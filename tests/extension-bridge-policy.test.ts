import { describe, expect, it } from "vitest";
import { SUPPORTED_WEB_APP_ORIGINS, isSupportedWebAppUrl } from "../src/extension-bridge-policy";

describe("extension bridge origin policy", () => {
  it("supports regular HTTP and HTTPS web applications", () => {
    expect(SUPPORTED_WEB_APP_ORIGINS).toEqual(["http://*/*", "https://*/*"]);
    expect(isSupportedWebAppUrl("http://localhost:3000/")).toBe(true);
    expect(isSupportedWebAppUrl("https://app.example.com/")).toBe(true);
    expect(isSupportedWebAppUrl("https://moho-web-6ffzierb.manus.space/")).toBe(true);
  });

  it("rejects browser-internal, file, malformed and non-web URLs before injection", () => {
    expect(isSupportedWebAppUrl("chrome://extensions/")).toBe(false);
    expect(isSupportedWebAppUrl("file:///tmp/test.html")).toBe(false);
    expect(isSupportedWebAppUrl("not a url")).toBe(false);
  });
});
