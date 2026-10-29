import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

/** Entradas que puede dejar un gestor de paquetes antes de generar el proyecto. */
/** What `meeko init` and `meeko init-framework` accept in the destination: a package being started. */
const packageScaffoldEntries = new Set(["package.json", "package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock", "bun.lock", "bun.lockb", "node_modules", ".npmrc", ".git"]);

/**
 * Entries of the destination of `meeko init` and `meeko init-framework`, after checking that it can
 * receive a project: it does not exist, is empty, holds only a `.git` (a fresh `git init`) or holds
 * a `package.json` with only lockfiles, `node_modules`, `.npmrc` and `.git` around it.
 */
export async function scaffoldDestinationEntries(target: string): Promise<string[]> {
  let entries: string[] = [];
  try {
    if (!(await stat(target)).isDirectory()) throw new Error(`El destino no es un directorio: ${target}`);
    entries = await readdir(target);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const unexpected = entries.filter((entry) => !packageScaffoldEntries.has(entry));
  // Lockfiles or node_modules without their package.json belong to something else.
  const orphaned = !entries.includes("package.json") && entries.some((entry) => entry !== ".git");
  if (unexpected.length > 0 || orphaned) {
    throw new Error(`El destino no está vacío: ${target}${unexpected.length > 0 ? ` (${unexpected.join(", ")})` : " (sin package.json)"}`);
  }
  return entries;
}

/** Comprueba que un valor JSON sea un objeto de configuración. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Archivos autocontenidos del proyecto inicial, incluidos en la CLI publicada. */
const starterFiles: Readonly<Record<string, string>> = {
  ".gitignore": "node_modules/\ndist/\n.meeko/\n",
  "index.html": `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Meeko SSR</title></head>
  <body><div id="app"></div><script type="module" src="/src/entry-client.ts"></script></body>
</html>
`,
  "vite.config.ts": `import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({ plugins: [meeko()] });
`,
  "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"], "types": ["node", "vite/client"],
    "strict": true, "noEmit": true, "allowArbitraryExtensions": true,
    "rootDirs": ["src", ".meeko/types/src"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "vite.config.ts", ".meeko/types/routes.d.ts"]
}
`,
  "src/App.meeko": `<script lang="ts">
import { signal } from "@meekojs/meeko";

/** Propiedades transferidas desde el servidor. */
export interface Props { initial: number }

const props = defineProps<Props>();
const count = signal(props.initial);
</script>

<template>
  <main>
    <h1>Meeko SSR</h1>
    <button type="button" on:click="() => count.value++">Contador: {count.value}</button>
  </main>
</template>

<style scoped>
main { max-width: 40rem; margin: 4rem auto; font: 1.2rem system-ui; }
button { cursor: pointer; padding: .65rem 1rem; }
</style>
`,
  "src/entry-server.ts": `import { serializeJson } from "@meekojs/meeko";
import { css, renderWithState } from "./App.meeko";

/** Genera HTML y estado inicial desde el mismo componente que hidrata el cliente. */
export function renderPage(clientSource: string, initial = 1): string {
  const props = { initial };
  const rendered = renderWithState(props);
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meeko SSR</title><style>'
    + css + '</style></head><body><div id="app">' + rendered.html + '</div><script id="meeko-payload" type="application/json">'
    + serializeJson({ props, state: rendered.state }) + '</script><script type="module" src="' + clientSource + '"></script></body></html>';
}
`,
  "src/entry-client.ts": `import { hydrate } from "./App.meeko";
import type { HotState } from "@meekojs/meeko";

const root = document.getElementById("app");
const payloadNode = document.getElementById("meeko-payload");
if (!root || !payloadNode?.textContent) throw new Error("Missing SSR root or payload");
const payload: unknown = JSON.parse(payloadNode.textContent);
if (typeof payload !== "object" || payload === null || !("props" in payload) || !("state" in payload)) throw new TypeError("Invalid SSR payload");
const { props, state } = payload;
if (typeof props !== "object" || props === null || !("initial" in props) || typeof props.initial !== "number" || !Number.isFinite(props.initial)) throw new TypeError("Invalid SSR props");
if (typeof state !== "object" || state === null || !("count" in state) || typeof state.count !== "number" || !Number.isFinite(state.count)) throw new TypeError("Invalid SSR state");
hydrate(root, { initial: props.initial }, { count: state.count } satisfies HotState);
`,
  "server.mjs": `import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer as createViteServer } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes("--production");
const vite = production ? undefined : await createViteServer({ root, server: { middlewareMode: true }, appType: "custom" });
const clientRoot = resolve(root, "dist/client");
let clientSource = "/src/entry-client.ts";
if (production) {
  const manifest = JSON.parse(await readFile(resolve(clientRoot, ".vite/manifest.json"), "utf8"));
  const entry = manifest["index.html"];
  if (!entry?.file) throw new Error("Missing Vite client entry");
  clientSource = "/" + entry.file;
}

const contentTypes = { ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      const module = vite ? await vite.ssrLoadModule("/src/entry-server.ts") : await import(pathToFileURL(resolve(root, "dist/server/entry-server.js")).href);
      const html = module.renderPage(clientSource);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(vite ? await vite.transformIndexHtml(path, html) : html);
      return;
    }
    if (vite) {
      vite.middlewares(request, response, () => { response.writeHead(404); response.end(); });
      return;
    }
    const file = resolve(clientRoot, "." + path);
    if (!file.startsWith(clientRoot + sep)) { response.writeHead(403); response.end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { "content-type": contentTypes[extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch (error) {
    console.error(error);
    response.writeHead(500);
    response.end("Internal server error");
  }
});

const port = Number(process.env.MEEKO_PORT || process.env.PORT || 4173);
server.listen(port, "127.0.0.1", () => console.log("http://127.0.0.1:" + port));
let shutdownPromise;
const closeServer = () => new Promise((resolveClose, rejectClose) => {
  server.close((error) => error ? rejectClose(error) : resolveClose());
});
async function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const results = await Promise.allSettled([
      closeServer(),
      vite?.close() ?? Promise.resolve(),
    ]);
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Meeko server shutdown failed");
  })();
  return shutdownPromise;
}
const onSignal = () => {
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  void shutdown().catch((error) => {
    try { console.error("Meeko server shutdown failed", error); }
    finally { process.exitCode = 1; }
  });
};
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);
`,
  "README.md": `# Meeko SSR starter

Proyecto inicial con renderizado en servidor e hidratación del mismo componente \`.meeko\`.

\`\`\`sh
npm install
npm run dev
\`\`\`

Abre http://127.0.0.1:4173. El servidor produce HTML y transfiere las props y señales al navegador.

\`npm run check\` genera los tipos del componente y comprueba TypeScript. \`npm run build\` compila cliente y servidor; \`npm start\` sirve ambas compilaciones con SSR.
`,
};

/** Crea un proyecto SSR independiente sin sobrescribir archivos del usuario. */
export async function initProject(directory: string): Promise<string> {
  const target = resolve(directory);
  const name = basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "meeko-app";
  const packageMetadata: unknown = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (typeof packageMetadata !== "object" || packageMetadata === null || !("version" in packageMetadata) || typeof packageMetadata.version !== "string") {
    throw new Error("No se puede leer la versión del paquete de Meeko");
  }
  const existingEntries = await scaffoldDestinationEntries(target);
  const existing: unknown = existingEntries.includes("package.json") ? JSON.parse(await readFile(join(target, "package.json"), "utf8")) : {};
  if (!isRecord(existing)) throw new Error(`package.json no válido en ${target}`);
  const existingScripts = existing.scripts ?? {};
  const existingDependencies = existing.dependencies ?? {};
  const existingDevDependencies = existing.devDependencies ?? {};
  const existingEngines = existing.engines ?? {};
  if (!isRecord(existingScripts) || !isRecord(existingDependencies) || !isRecord(existingDevDependencies) || !isRecord(existingEngines)) {
    throw new Error(`package.json no válido en ${target}`);
  }
  const scripts = {
    dev: "node server.mjs",
    check: "meeko types src/App.meeko && tsc --noEmit",
    build: "npm run check && vite build --outDir dist/client --manifest && vite build --ssr src/entry-server.ts --outDir dist/server",
    start: "node server.mjs --production",
  };
  const devDependencies = { "@types/node": "^24.0.0", typescript: "^7.0.2", vite: "^8.3.5" };
  for (const command of Object.keys(scripts)) {
    if (command in existingScripts) throw new Error(`El destino ya define el script ${command}: ${target}`);
  }
  if (Object.keys(existingDependencies).some((dependency) => dependency !== "@meekojs/meeko") || Object.keys(existingDevDependencies).some((dependency) => !(dependency in devDependencies))) {
    throw new Error(`El destino tiene otras dependencias: ${target}`);
  }
  const packageFile = JSON.stringify({
    ...existing,
    name: typeof existing.name === "string" ? existing.name : name,
    private: true,
    type: "module",
    engines: { ...existingEngines, node: ">=24" },
    scripts: { ...existingScripts, ...scripts },
    dependencies: { ...existingDependencies, "@meekojs/meeko": packageMetadata.version },
    devDependencies: { ...existingDevDependencies, ...devDependencies },
  }, null, 2) + "\n";
  await mkdir(target, { recursive: true });
  for (const [filename, content] of Object.entries(starterFiles)) {
    const path = join(target, filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  }
  await writeFile(join(target, "package.json"), packageFile, { encoding: "utf8", flag: existingEntries.includes("package.json") ? "w" : "wx" });
  return target;
}
