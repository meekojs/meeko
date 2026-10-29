import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { clientMiddlewareSource, clientRoutesSource, discoverAppManifest } from "../src/framework/app-manifest.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { discoverConfiguredRoutes } from "../src/framework/config.ts";
import { routeOptionsKey } from "../src/framework/dev-watch.ts";
import { generateRoutes } from "../src/framework/generate.ts";
import { discoverRouteMiddleware, extractRouteMiddlewareOptions } from "../src/framework/route-middleware-discovery.ts";
import { discoverRoutes } from "../src/framework/routes-discovery.ts";
import type { RouteRecord } from "../src/framework/router.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { buildProject } from "../src/framework/project.ts";
import { assertStaticApp } from "../src/framework/static-adapter.ts";
import { linkRepositoryPackages, stopChild, tempProject } from "./helpers/temp-project.ts";

async function put(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

const isomorphic = "export default defineRouteMiddleware(() => undefined, { global: false });\n";
const serverGlobal = "export default defineServerRouteMiddleware(() => undefined);\n";
const serverNamed = "export default defineServerRouteMiddleware(({ session }) => { if (!session.current) return new Response(null, { status: 401 }); }, { global: false });\n";
const page = (name: string): string => `<template><p>${name}</p></template>\n`;
const withOptions = (options: string, name = "p"): string => `<script server lang="ts">
export const route = definePage(${options});
</script>
<template><p>${name}</p></template>
`;

/** Paths relative to `root`. */
const relativeTo = (root: string) => (file: string): string => file.slice(root.length + 1).replaceAll("\\", "/");

/** The isomorphic and server named middleware of each route, relative to `root`. */
function chains(root: string, routes: readonly RouteRecord[]): Record<string, { readonly middleware: string[]; readonly server: string[] }> {
  const relative = relativeTo(root);
  return Object.fromEntries(routes.map((route) => [route.id, {
    middleware: (route.middleware ?? []).map(relative),
    server: (route.serverMiddleware ?? []).map(relative),
  }]));
}

const serverFile = "/project/app/middleware/auth.server.ts";

test("{ global } of defineServerRouteMiddleware is read without running a *.server.ts file", () => {
  assert.deepEqual(extractRouteMiddlewareOptions(serverFile, serverGlobal), { global: true });
  assert.deepEqual(extractRouteMiddlewareOptions(serverFile, serverNamed), { global: false });
  assert.deepEqual(extractRouteMiddlewareOptions(serverFile, 'import { defineServerRouteMiddleware as guard } from "@meekojs/meeko/framework";\nconst auth = guard(() => undefined, { global: false });\nexport { auth as default };\n'), { global: false });
  assert.deepEqual(extractRouteMiddlewareOptions(serverFile, 'import * as meeko from "@meekojs/meeko/framework";\nexport default meeko.defineServerRouteMiddleware(() => undefined);\n'), { global: true });
  assert.deepEqual(extractRouteMiddlewareOptions(serverFile, "const guard = defineServerRouteMiddleware(() => undefined, { global: false } as const) as const;\nexport default guard;\n"), { global: false });
  // In an isomorphic file, a plain default function is global, as every route middleware was before 1.6.
  assert.deepEqual(extractRouteMiddlewareOptions("/project/app/middleware/auth.ts", "export default function guard() {}\n"), { global: true });
  // A *.server.ts file was ignored until 1.5: any default export that is not defineServerRouteMiddleware(...)
  // is a helper, which stops discovery instead of running on every SSR as global server middleware.
  const helper = /auth\.server\.ts: un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware\(\.\.\.\);.*mueve los helpers a server\/utils/;
  for (const source of [
    "export default function parseCookies(header: string) { return header.split(\";\"); }\n",
    "export default class Cookies {}\n",
    "const parseCookies = (header: string) => header.split(\";\");\nexport default parseCookies;\n",
    "function parseCookies() {}\nexport { parseCookies as default };\n",
    "export default createParser({ strict: true });\n",
    'export { default } from "./cookies.ts";\n',
    "export default { parse: () => undefined };\n",
  ]) assert.throws(() => extractRouteMiddlewareOptions(serverFile, source), helper, source);
  // Each kind of file uses its own definition.
  assert.throws(() => extractRouteMiddlewareOptions(serverFile, isomorphic), /auth\.server\.ts: un archivo \*\.server\.ts de app\/middleware es middleware de ruta de servidor; decláralo con defineServerRouteMiddleware/);
  assert.throws(() => extractRouteMiddlewareOptions("/project/app/middleware/auth.ts", serverNamed), /auth\.ts: defineServerRouteMiddleware sólo se admite en un archivo \*\.server\.ts de app\/middleware.*renombra el archivo a auth\.server\.ts/);
  // Before 1.6 these files were ignored: a helper without a default export stops discovery.
  assert.throws(() => extractRouteMiddlewareOptions(serverFile, "export const helper = 1;\n"), helper);
  assert.throws(() => extractRouteMiddlewareOptions(serverFile, "export default defineServerRouteMiddleware(() => undefined, options);\n"), /las opciones de defineServerRouteMiddleware deben ser un objeto literal/);
  assert.throws(() => extractRouteMiddlewareOptions(serverFile, "export default defineServerRouteMiddleware(() => undefined, { name: \"x\" });\n"), /opción de middleware desconocida "name"; defineServerRouteMiddleware admite global/);
});

test("*.server.ts files of app/middleware are server route middleware, global or named, sharing names with the isomorphic ones", async (context) => {
  const root = await tempProject(context, "server-middleware-names");
  await put(root, "app/middleware/10-locale.ts", "export default defineRouteMiddleware(() => undefined);\n");
  await put(root, "app/middleware/05-session.server.ts", serverGlobal);
  await put(root, "app/middleware/auth.server.ts", serverNamed);
  await put(root, "app/middleware/admin.ts", isomorphic);
  await put(root, "app/middleware/team/10-role.server.ts", serverNamed);
  const relative = relativeTo(root);
  const discovered = await discoverRouteMiddleware(root);
  assert.deepEqual(discovered.global.map(relative), ["app/middleware/10-locale.ts"]);
  assert.deepEqual(discovered.serverGlobal.map(relative), ["app/middleware/05-session.server.ts"]);
  assert.deepEqual(Object.fromEntries(Object.entries(discovered.named).map(([name, file]) => [name, relative(file)])), {
    admin: "app/middleware/admin.ts",
    auth: "app/middleware/auth.server.ts",
    "team/role": "app/middleware/team/10-role.server.ts",
  });
  // auth.ts and auth.server.ts give the same name.
  await put(root, "app/middleware/auth.ts", isomorphic);
  await assert.rejects(discoverRouteMiddleware(root), /auth\.server\.ts y .*auth\.ts declaran el mismo middleware "auth"/);
  await rm(join(root, "app", "middleware", "auth.ts"));
});

test("routes split their named middleware into isomorphic and server, inherited from groups, in declared order", async (context) => {
  const root = await tempProject(context, "server-middleware-routes");
  await put(root, "app/middleware/10-locale.ts", "export default defineRouteMiddleware(() => undefined);\n");
  await put(root, "app/middleware/05-session.server.ts", serverGlobal);
  await put(root, "app/middleware/auth.server.ts", serverNamed);
  await put(root, "app/middleware/owner.server.ts", serverNamed);
  await put(root, "app/middleware/admin.ts", isomorphic);
  await put(root, "app/pages/index.meeko", page("home"));
  await put(root, "app/pages/(dashboard)/+group.ts", 'export default defineGroup({ middleware: ["auth", "admin"] });\n');
  await put(root, "app/pages/(dashboard)/panel.meeko", withOptions('{ middleware: ["owner", "auth"] }'));
  await put(root, "app/pages/(dashboard)/feed.meeko", withOptions('{ render: "stream" }'));
  await put(root, "app/pages/(dashboard)/public.meeko", withOptions("{ middleware: false }"));
  const routes = await discoverRoutes(root);
  // serverMiddleware is the whole server chain: the global ones (which middleware: false keeps), then the named ones.
  const session = "app/middleware/05-session.server.ts";
  assert.deepEqual(chains(root, routes), {
    "/": { middleware: [], server: [session] },
    "/feed": { middleware: ["app/middleware/admin.ts"], server: [session, "app/middleware/auth.server.ts"] },
    "/panel": { middleware: ["app/middleware/admin.ts"], server: [session, "app/middleware/auth.server.ts", "app/middleware/owner.server.ts"] },
    "/public": { middleware: [], server: [session] },
  });

  // The server manifest lists the chain on each route and loads every file.
  const { manifest, modules } = await discoverAppManifest(root, { entry: "/client.js", css: [], preload: [] });
  assert.deepEqual(manifest.routeMiddleware, ["/app/middleware/10-locale.ts"]);
  assert.equal(Object.hasOwn(manifest, "serverRouteMiddleware"), false);
  assert.deepEqual(manifest.routes.find((route) => route.id === "/")?.serverMiddleware, ["/app/middleware/05-session.server.ts"]);
  assert.deepEqual(manifest.routes.find((route) => route.id === "/panel")?.serverMiddleware, ["/app/middleware/05-session.server.ts", "/app/middleware/auth.server.ts", "/app/middleware/owner.server.ts"]);
  for (const key of ["/app/middleware/05-session.server.ts", "/app/middleware/auth.server.ts", "/app/middleware/owner.server.ts"]) assert.ok(modules.includes(key), key);

  // Nothing of the server middleware reaches the browser: neither its modules nor its paths.
  assert.doesNotMatch(await clientMiddlewareSource(root), /\.server\.ts/);
  assert.doesNotMatch(await clientRoutesSource(root), /\.server\.ts|serverMiddleware/);

  // Types and the portable manifest name them like the isomorphic ones.
  await generateRoutes(root);
  const declarations = await readFile(join(root, ".meeko", "types", "routes.d.ts"), "utf8");
  assert.match(declarations, /interface GeneratedRouteMiddleware \{\n {4}"admin": "app\/middleware\/admin\.ts";\n {4}"auth": "app\/middleware\/auth\.server\.ts";\n {4}"owner": "app\/middleware\/owner\.server\.ts";\n {2}\}/);
  assert.doesNotMatch(declarations, /"session"/);
  const portable = JSON.parse(await readFile(join(root, ".meeko", "manifests", "routes.json"), "utf8")) as { routes: RouteRecord[] };
  assert.deepEqual(portable.routes.find((route) => route.id === "/panel")?.serverMiddleware, [session, "app/middleware/auth.server.ts", "app/middleware/owner.server.ts"]);

  // A global server middleware is not a name a route can ask for.
  await put(root, "app/pages/index.meeko", withOptions('{ middleware: ["session"] }'));
  await assert.rejects(discoverRoutes(root), /index\.meeko: el middleware "session" \(.*05-session\.server\.ts\) es global y ya se ejecuta en todas las rutas; quítalo de middleware o decláralo con defineServerRouteMiddleware\(\.\.\., \{ global: false \}\)/);
});

test("a render: \"client\" or \"prerender\" page that asks for server middleware stops discovery; a global one leaves them alone", async (context) => {
  const root = await tempProject(context, "server-middleware-render");
  await put(root, "app/middleware/05-session.server.ts", serverGlobal);
  await put(root, "app/middleware/auth.server.ts", serverNamed);
  await put(root, "app/pages/(dashboard)/+group.ts", 'export default defineGroup({ middleware: ["auth"] });\n');
  await put(root, "app/pages/(dashboard)/panel.meeko", page("panel"));
  await put(root, "app/pages/(dashboard)/editor.meeko", page("editor"));
  await put(root, "app/pages/(dashboard)/editor.route.ts", 'export const route = definePage({ render: "client" });\n');
  await assert.rejects(discoverRoutes(root),
    /\(dashboard\)[\\/]\+group\.ts: el middleware de servidor "auth" \(.*auth\.server\.ts\) necesita una página con datos del servidor, pero .*editor\.route\.ts usa render: "client" y su navegación no pide datos al servidor.*Usa render: "ssr" o "stream", o quítalo de esa página con middleware: false/);
  await put(root, "app/pages/(dashboard)/editor.route.ts", 'export const route = definePage({ render: "client", middleware: false });\n');
  await put(root, "app/pages/docs.meeko", withOptions('{ render: "prerender", middleware: ["auth"] }'));
  await assert.rejects(discoverRoutes(root), /docs\.meeko: el middleware de servidor "auth" .* usa render: "prerender" y se renderiza al hacer el build, sin la petición ni la sesión de cada visitante/);
  await put(root, "app/pages/docs.meeko", withOptions('{ render: "prerender" }'));
  // The global server middleware does not stop these pages: it does not run there.
  const routes = await discoverRoutes(root);
  assert.deepEqual(chains(root, routes)["/docs"], { middleware: [], server: [] });
  assert.deepEqual(chains(root, routes)["/editor"], { middleware: [], server: [] });

  // The static adapter: every page is prerendered, so only a global one can exist, and it warns.
  await rm(join(root, "app", "pages", "(dashboard)"), { recursive: true });
  const written: string[] = [];
  const write = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { written.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try { await assertStaticApp(root); }
  finally { process.stderr.write = write; }
  assert.match(written.join(""), /Con el adaptador static, el middleware de ruta de servidor \(app\/middleware\/05-session\.server\.ts\) no se ejecuta/);
});

test("meeko dev rebuilds the app when a server middleware appears, changes { global } or a route asks for it", async (context) => {
  const root = await tempProject(context, "server-middleware-dev-watch");
  await put(root, "app/pages/(dashboard)/+group.ts", "export default defineGroup({});\n");
  await put(root, "app/pages/(dashboard)/panel.meeko", page("panel"));
  const key = async (): Promise<string> => {
    const middleware = await discoverRouteMiddleware(root);
    return routeOptionsKey(await discoverConfiguredRoutes(root), [...middleware.global, ...middleware.serverGlobal]);
  };
  const empty = await key();
  await put(root, "app/middleware/auth.server.ts", serverGlobal);
  const global = await key();
  assert.notEqual(global, empty);
  await put(root, "app/middleware/auth.server.ts", serverNamed);
  const named = await key();
  assert.notEqual(named, global);
  await put(root, "app/pages/(dashboard)/+group.ts", 'export default defineGroup({ middleware: ["auth"] });\n');
  assert.notEqual(await key(), named);
});

async function files(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(path));
    else found.push(path);
  }
  return found;
}

test("a server route middleware imports #server/ without MEEK108, stays out of the client bundle and guards the built app", { timeout: 300_000 }, async (context) => {
  let child: ReturnType<typeof spawn> | undefined;
  const root = await tempProject(context, "server-middleware-build", () => stopChild(child, "SIGTERM"));
  await initFrameworkProject(root);
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
  // Production needs a persistent session store: a memory store that says it is one.
  await put(root, "server/runtime.ts", `import { MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(({ production }) => {
  const memory = new MemorySessionStore();
  return { sessions: new SessionManager({ secure: false, production, store: {
    persistent: true,
    get: (id) => memory.get(id),
    set: (record) => memory.set(record),
    delete: (id) => memory.delete(id),
    replace: (oldId, record) => memory.replace(oldId, record),
    revokeFamily: (familyId) => memory.revokeFamily(familyId),
    close: () => memory.close(),
  } }) };
});
`);
  await put(root, "server/guard.ts", 'export const guardMarker = "server-guard-marker-7f3a";\nexport function signedIn(user: unknown): boolean { return user !== undefined; }\n');
  await put(root, "app/middleware/auth.server.ts", `import { redirect } from "@meekojs/meeko/framework";
import { guardMarker, signedIn } from "#server/guard";

export default defineServerRouteMiddleware(({ session, url }) => {
  if (!signedIn(session.current)) redirect(\`/login?next=\${encodeURIComponent(url.pathname)}&from=\${guardMarker}\`);
}, { global: false });
`);
  await put(root, "app/pages/(dashboard)/+group.ts", 'export default defineGroup({ middleware: ["auth"] });\n');
  await put(root, "app/pages/(dashboard)/panel.meeko", page("panel"));
  await put(root, "app/pages/login.meeko", page("login"));
  // meeko check: the autoimport, the types of the context and #server/ in a *.server.ts, without MEEK108.
  await checkFrameworkProject(root);
  const result = await buildProject(root, { adapter: "node" });
  const output = await files(result.output);
  const client = (await Promise.all(output.filter((file) => file.includes(join("client", "assets")) && file.endsWith(".js")).map((file) => readFile(file, "utf8")))).join("\n");
  assert.ok(client.length > 0);
  assert.doesNotMatch(client, /server-guard-marker-7f3a|auth\.server|defineServerRouteMiddleware/, "the server route middleware stays out of the client bundle");
  const server = (await Promise.all(output.filter((file) => !file.startsWith(join(result.output, "client")) && /\.m?js$/.test(file)).map((file) => readFile(file, "utf8")))).join("\n");
  assert.match(server, /server-guard-marker-7f3a/, "the server bundle carries it");
  child = spawn(process.execPath, [join(result.output, "index.mjs")], {
    cwd: root, env: { ...process.env, PORT: "0", HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const running = child;
  const origin = await new Promise<string>((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const url = /http:\/\/127\.0\.0\.1:\d+/.exec(logs)?.[0];
      if (url) { clearInterval(timer); done(url); }
      else if (running.exitCode !== null) { clearInterval(timer); fail(new Error(`Server exited: ${logs}`)); }
      else if (Date.now() - start > 30_000) { clearInterval(timer); fail(new Error(`Server did not listen: ${logs}`)); }
    }, 25);
  });
  for (const accept of ["text/html", "application/meeko+json"]) {
    const response = await fetch(`${origin}/panel`, { headers: { accept }, redirect: "manual" });
    assert.equal(response.status, 302, `${accept}\n${logs}`);
    assert.equal(response.headers.get("location"), "/login?next=%2Fpanel&from=server-guard-marker-7f3a");
  }
  assert.equal((await fetch(`${origin}/login`, { headers: { accept: "text/html" } })).status, 200, logs);
});
