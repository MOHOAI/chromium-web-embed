import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extension = resolve(root, "extension");
const files = ["extension-worker.js", "extension-bridge.js"];

await mkdir(extension, { recursive: true });
for (const file of files) {
  await cp(resolve(root, "dist", file), resolve(extension, file === "extension-worker.js" ? "service-worker.js" : "bridge.js"));
}
