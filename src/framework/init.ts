import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const allowedEntries = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock", "node_modules", ".npmrc", ".git"]);

const files: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\n.meeko/\n",
  "public/.gitkeep": "",
  "meeko.config.ts": `import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  extends: [],
  modules: [],
  imports: { serverDirs: [] },
});
`,
  "vite.config.ts": `import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({
  plugins: [meeko()],
  build: {
    outDir: ".meeko/output/client",
    manifest: true,
    rollupOptions: { input: "app/entry-client.ts" },
  },
});
`,
  "vite.server.config.ts": `import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({
  plugins: [meeko()],
  build: {
    ssr: "server/entry.ts",
    outDir: ".meeko/output/server",
    rollupOptions: { output: { entryFileNames: "entry.js" } },
  },
});
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "vite/client"],
    "strict": true,
    "noEmit": true,
    "allowArbitraryExtensions": true,
    "skipLibCheck": true
  },
  "include": ["vite.config.ts", "vite.server.config.ts"]
}
`,
  "tsconfig.app.json": `{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDirs": [".", ".meeko/types"] },
  "include": ["app/**/*.ts", "layers/**/app/**/*.ts", "modules/**/app/**/*.ts", ".meeko/types/**/*.d.meeko.ts", ".meeko/types/routes.d.ts", ".meeko/types/virtual-pages.d.ts", ".meeko/types/server-contracts.d.ts", ".meeko/types/autoimports/client.d.ts"],
  "exclude": ["app/pages/**/*.route.ts", "layers/**/app/pages/**/*.route.ts", "modules/**/app/pages/**/*.route.ts"]
}
`,
  "tsconfig.server.json": `{
  "extends": "./tsconfig.json",
  "include": ["server/**/*.ts", "app/pages/**/*.route.ts", "layers/**/app/pages/**/*.route.ts", "modules/**/app/pages/**/*.route.ts", "layers/**/server/**/*.ts", "modules/**/server/**/*.ts", ".meeko/types/virtual-pages.d.ts", ".meeko/types/autoimports/server.d.ts"]
}
`,
  "tsconfig.shared.json": `{
  "extends": "./tsconfig.json",
  "include": ["shared/**/*.ts", "layers/**/shared/**/*.ts", "modules/**/shared/**/*.ts", ".meeko/types/autoimports/shared.d.ts"]
}
`,
  "app/pages/index.meeko": `<script lang="ts">
import { signal } from "@meekojs/meeko";

export interface Props {
  params: Record<string, string>;
  search: Record<string, string>;
  data?: unknown;
}

const count = signal(0);
</script>

<template>
  <section>
    <h1>Welcome to Meeko</h1>
    <p>File routes, server rendering, and hydration are ready.</p>
    <button type="button" on:click="() => count.value++">Count: {count.value}</button>
  </section>
</template>
`,
  "app/pages/index.route.ts": `import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender" });
`,
  "app/app.meeko": `<script lang="ts">
import type { ComponentModule } from "@meekojs/meeko";

export interface Props {
  outlet: ComponentModule<Record<string, unknown>>;
}

const props = defineProps<Props>();
</script>

<template>
  <div class="site-root"><component is="props.outlet"></component></div>
</template>
`,
  "app/pages/+layout.meeko": `<script lang="ts">
import type { ComponentModule } from "@meekojs/meeko";

export interface Props {
  outlet: ComponentModule<Record<string, unknown>>;
}

const props = defineProps<Props>();
</script>

<template>
  <div class="app-shell">
    <header><a href="/">Meeko</a></header>
    <main><component is="props.outlet"></component></main>
  </div>
</template>

<style scoped>
.app-shell { max-width: 64rem; margin: 0 auto; padding: 2rem; font-family: system-ui, sans-serif; }
header { margin-bottom: 2rem; }
</style>
`,
  "app/entry-client.ts": `import { mountClientApp, type ClientComponent, type RouteRecord } from "@meekojs/meeko/framework";
import { modules as pages } from "virtual:meeko-client-pages";

const root = document.getElementById("app");
const payload = document.getElementById("meeko-payload")?.textContent;
const routesText = document.getElementById("meeko-routes")?.textContent;
if (!root || !payload || !routesText) throw new Error("Missing Meeko SSR data");
const routes = JSON.parse(routesText) as RouteRecord[];

await mountClientApp({
  root, payload, routes, serverData: true,
  async loadPage(file) {
    const load = pages[file];
    if (!load) throw new Error("Page module missing: " + file);
    return await load() as ClientComponent;
  },
});
`,
  "server/entry.ts": `import { createFrameworkHandler, createLocalServerFetch, createRequestContext, createServerDispatcher, createSocketHub, discoverServerManifest, loadSocketChannels, type FrameworkHandlerOptions } from "@meekojs/meeko/server";
import type { RouteRecord } from "@meekojs/meeko/framework";
import { modules as pages } from "virtual:meeko-server-pages";
import { modules as routeModules } from "virtual:meeko-server-routes";
import { createSessionManager } from "./session.js";

const handlers = import.meta.glob(["/server/api/**/*.ts", "/server/rpc/**/*.ts", "/server/socket/**/*.ts"], { eager: true });

function keyFor(root: string, file: string): string {
  return "/" + file.slice(root.length).replaceAll("\\\\", "/").replace(/^\\//, "");
}

export const loadPage = async (root: string, file: string): Promise<Awaited<ReturnType<FrameworkHandlerOptions["loadPage"]>>> => {
  const key = keyFor(root, file);
  const module = pages[key];
  if (!module) throw new Error("Page module missing: " + key);
  return module as Awaited<ReturnType<FrameworkHandlerOptions["loadPage"]>>;
};

export const loadRoute = async (root: string, file: string): Promise<Awaited<ReturnType<NonNullable<FrameworkHandlerOptions["loadRoute"]>>>> => {
  const key = keyFor(root, file);
  const module = routeModules[key] as Record<string, unknown> | undefined;
  if (!module) throw new Error("Route module missing: " + key);
  return (module.route ?? module.default ?? module) as Awaited<ReturnType<NonNullable<FrameworkHandlerOptions["loadRoute"]>>>;
};

export async function createAppRuntime(root: string, routes: readonly RouteRecord[], clientEntry: string, production: boolean) {
  const sessions = createSessionManager(production);
  const manifest = await discoverServerManifest(root);
  const load = async (file: string) => {
    const module = handlers[keyFor(root, file)];
    if (!module) throw new Error("Server handler missing: " + file);
    return module;
  };
  const services = {};
  const pageHandler = createFrameworkHandler({
    routes,
    loadPage: (file) => loadPage(root, file),
    loadRoute: (file) => loadRoute(root, file),
    clientEntry,
    createContext: async (request) => createRequestContext(request, services, await sessions.load(request)),
    serverFetch: createLocalServerFetch({ manifest, sessions, load }),
  });
  const endpointHandler = createServerDispatcher({ manifest, sessions, services, load });
  const channels = await loadSocketChannels(manifest, load);
  const socketHub = createSocketHub({ channels, sessions, services });
  return { pageHandler, endpointHandler, socketHub, sessions, manifest };
}
`,
  "server/session.ts": `import { MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

export function createSessionManager(production: boolean) {
  if (production) throw new Error("Configure a persistent SessionStore in server/session.ts before production startup");
  return new SessionManager({ store: new MemorySessionStore(), production: false });
}
`,
  "server.mjs": `import { createServer } from "node:http";
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
  file: "/" + relative(root, route.file).replaceAll("\\\\", "/"),
  layouts: route.layouts.map((file) => "/" + relative(root, file).replaceAll("\\\\", "/")),
  ...(route.error ? { error: "/" + relative(root, route.error).replaceAll("\\\\", "/") } : {}),
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
  if (production && /\\.[a-z0-9]+$/i.test(path)) {
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
`,
  "README.md": `# Meeko framework starter

Requires Node 24.

\`\`\`sh
npm install
npm run dev
\`\`\`

Routes live in \`app/pages\`. \`+layout.meeko\` keeps the shared shell during client navigation. Run \`npm run build\` and \`npm start\` for production SSR. Generated files live under \`.meeko/\`.
`,
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Creates a framework project without overwriting unrelated user files. */
export async function initFrameworkProject(directory: string): Promise<string> {
  const target = resolve(directory);
  const name = basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "meeko-app";
  const metadata: unknown = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  if (!record(metadata) || typeof metadata.version !== "string") throw new Error("Meeko package version is unavailable");
  let entries: string[] = [];
  try {
    if (!(await stat(target)).isDirectory()) throw new Error(`Destination is not a directory: ${target}`);
    entries = await readdir(target);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const unexpected = entries.filter((entry) => !allowedEntries.has(entry));
  if (unexpected.length || (entries.length && !entries.includes("package.json"))) {
    throw new Error(`Destination is not empty: ${target}`);
  }
  const existing: unknown = entries.includes("package.json") ? JSON.parse(await readFile(join(target, "package.json"), "utf8")) : {};
  if (!record(existing) || (existing.scripts !== undefined && !record(existing.scripts))
    || (existing.dependencies !== undefined && !record(existing.dependencies))
    || (existing.devDependencies !== undefined && !record(existing.devDependencies))) {
    throw new Error(`Invalid package.json in ${target}`);
  }
  const scripts = {
    dev: "node server.mjs",
    check: "meeko routes . && meeko check-app . && tsc -p tsconfig.json --noEmit && tsc -p tsconfig.shared.json --noEmit && tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.server.json --noEmit",
    build: "npm run check && vite build --config vite.config.ts && vite build --config vite.server.config.ts && meeko prerender .",
    start: "node server.mjs --production",
  };
  const oldScripts = existing.scripts as Record<string, unknown> | undefined;
  for (const command of Object.keys(scripts)) if (oldScripts && command in oldScripts) {
    throw new Error(`Destination already defines the ${command} script: ${target}`);
  }
  const manifest = {
    ...existing,
    name: typeof existing.name === "string" ? existing.name : name,
    private: true,
    type: "module",
    engines: { ...(record(existing.engines) ? existing.engines : {}), node: ">=24" },
    scripts: { ...oldScripts, ...scripts },
    dependencies: { ...(existing.dependencies as Record<string, unknown> | undefined), "@meekojs/meeko": metadata.version },
    devDependencies: {
      ...(existing.devDependencies as Record<string, unknown> | undefined),
      "@types/node": "^24.0.0", typescript: "^7.0.2", vite: "^8.3.5",
    },
  };
  await mkdir(target, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    const output = join(target, filename);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, content, { encoding: "utf8", flag: "wx" });
  }
  await writeFile(join(target, "package.json"), JSON.stringify(manifest, null, 2) + "\n", {
    encoding: "utf8", flag: entries.includes("package.json") ? "w" : "wx",
  });
  return target;
}
