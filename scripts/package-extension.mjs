import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";

const root = process.cwd();
const extDir = path.join(root, "extension");
const outDir = path.join(root, "extension-download");
fs.mkdirSync(outDir, { recursive: true });

const outZip = path.join(outDir, "real-browser-web-bridge-extension.zip");
const output = fs.createWriteStream(outZip);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  console.log(`Packaged ${outZip} (${archive.pointer()} bytes)`);
});

archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(extDir, false);
await archive.finalize();
