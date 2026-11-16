import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const extDir = path.join(root, "extension");
const manifestPath = path.join(extDir, "manifest.json");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

manifest.version = pkg.version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Prepared extension/manifest.json at v${manifest.version}`);
