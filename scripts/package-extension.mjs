import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "extension");
const targetDirectory = resolve(root, "extension-download");
const target = resolve(targetDirectory, "real-browser-web-bridge-extension.zip");

await mkdir(targetDirectory, { recursive: true });
await rm(target, { force: true });

const output = createWriteStream(target);
const archive = new ZipArchive({ zlib: { level: 9 } });

await new Promise((resolvePromise, reject) => {
  output.on("close", resolvePromise);
  output.on("error", reject);
  archive.on("error", reject);
  archive.pipe(output);
  archive.directory(source, false);
  archive.finalize();
});

console.log(`Extension download package created: ${target}`);
