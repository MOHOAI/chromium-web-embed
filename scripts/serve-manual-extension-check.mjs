import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("./manual-extension-check.html", import.meta.url));
createServer((request, response) => {
  if (request.url !== "/") return response.writeHead(404).end("Not found");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
}).listen(41731, "127.0.0.1", () => console.log("http://127.0.0.1:41731"));
