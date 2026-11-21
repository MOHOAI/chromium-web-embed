import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";

const root = process.cwd();
const agentDir = path.join(root, "desktop-agent");
const outDir = path.join(root, "desktop-agent-download");
fs.mkdirSync(outDir, { recursive: true });

const outZip = path.join(outDir, "moho-desktop-agent-windows.zip");
const output = fs.createWriteStream(outZip);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  console.log(`Packaged ${outZip} (${archive.pointer()} bytes)`);
});

archive.on("error", (err) => {
  throw err;
});

archive.pipe(output);
archive.glob("**/*", {
  cwd: agentDir,
  ignore: [".venv/**", "__pycache__/**", "_sandbox_bridge/**", "*.pyc"],
});
await archive.finalize();
