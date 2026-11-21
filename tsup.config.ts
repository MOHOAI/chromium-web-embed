import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    extension: "src/extension.ts",
    "providers/index": "src/providers/index.ts",
    "safety-policy": "src/safety-policy.ts",
    "agent-runner": "src/agent-runner.ts",
    "desktop-agent": "src/desktop-agent.ts",
    "local-folder-brain": "src/local-folder-brain.ts",
    webmcp: "src/webmcp.ts",
    "sandbox-terminal": "src/sandbox-terminal.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
});
