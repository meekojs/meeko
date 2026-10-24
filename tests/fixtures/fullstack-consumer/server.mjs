import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer as createViteServer } from "vite";
import { attachNodeWebSocketServer, discoverConfiguredRoutes, toNodeListener } from "@meekojs/meeko/server";
import { serializeJson } from "@meekojs/meeko";

const root = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes("--production");
const vite = production ? undefined : await createViteServer({
  root, configFile: resolve(root, "vite.config.ts"),
  server: { middlewareMode: true }, appType: "custom",
});
const clientRoot = resolve(root, ".meeko/output/client");
const publicRoot = resolve(root, "public");
const routes = await discoverConfiguredRoutes(root);
let clientEntry = "/app/entry-client.ts";
if (production) {
  const manifest = JSON.parse(await readFile(resolve(clientRoot, ".vite/manifest.json"), "utf8"));
  const entry = manifest["app/entry-client.ts"];
  if (!entry?.file) throw new Error("Missing client entry in Vite manifest");
  clientEntry = "/" + entry.file;
}
const serverEntry = production
  ? await import(pathToFileURL(resolve(root, ".meeko/output/server/entry.js")).href)
  : await vite.ssrLoadModule("/server/entry.ts");
const portable = routes.map((route) => ({
  id: route.id,
  file: "/" + relative(root, route.file).replaceAll("\\", "/"),
  layouts: route.layouts.map((file) => "/" + relative(root, file).replaceAll("\\", "/")),
  ...(route.error ? { error: "/" + relative(root, route.error).replaceAll("\\", "/") } : {}),
}));
const runtime = await serverEntry.createAppRuntime(root, routes, clientEntry, production);
const handler = runtime.pageHandler;
const decorated = async (request) => {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/_meeko/rpc/")) return runtime.endpointHandler(request);
  const result = await handler(request);
  if (result.status !== 200 || !(result.headers.get("content-type") || "").includes("text/html")) return result;
  let html = (await result.text()).replace("</body>", '<script id="meeko-routes" type="application/json">' + serializeJson(portable) + "</script></body>");
  if (vite) html = await vite.transformIndexHtml(new URL(request.url).pathname, html);
  return new Response(request.method === "HEAD" ? null : html, { status: result.status, headers: result.headers });
};
const pageListener = toNodeListener(decorated);
const types = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
async function readAsset(assetRoot, path) {
  const file = resolve(assetRoot, "." + path);
  if (!file.startsWith(assetRoot + sep)) return { status: 403 };
  let actual;
  try { actual = await realpath(file); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  const actualRoot = await realpath(assetRoot);
  if (!actual.startsWith(actualRoot + sep)) return { status: 403 };
  return { status: 200, body: await readFile(actual) };
}
const server = createServer((request, response) => {
  const path = new URL(request.url || "/", "http://localhost").pathname;
  if (production && /\.[a-z0-9]+$/i.test(path)) {
    void (async () => {
      const asset = await readAsset(clientRoot, path) ?? await readAsset(publicRoot, path);
      if (!asset || asset.status !== 200) { response.writeHead(asset?.status ?? 404); response.end(); return; }
      response.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
      response.end(asset.body);
    })().catch(() => { response.writeHead(404); response.end(); });
    return;
  }
  if (vite) {
    vite.middlewares(request, response, () => pageListener(request, response));
    return;
  }
  pageListener(request, response);
});
const port = Number(process.env.PORT || 4173);
const socketServer = runtime.manifest.socket?.length ? attachNodeWebSocketServer({
  server, hub: runtime.socketHub, publicOrigin: process.env.PUBLIC_ORIGIN || "http://127.0.0.1:" + port,
}) : undefined;
server.listen(port, "127.0.0.1", () => console.log("http://127.0.0.1:" + port));
process.on("SIGINT", () => { void socketServer?.close(); server.close(); void runtime.sessions.close(); void vite?.close(); });
