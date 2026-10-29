import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { discoverAutoImports, discoverAutoImportsSync } from "../src/autoimports.ts";
import { discoverAppPlugins } from "../src/framework/app-manifest.ts";
import { checkFrameworkProject, prepareFrameworkTypes } from "../src/framework/check-project.ts";
import { discoverConfiguredRoutes, loadConfiguredModules, readMeekoConfigSync, resolveConfigSources, resolveMeekoConfig } from "../src/framework/config.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { defineMeekoModule } from "../src/framework/module.ts";
import { mergeHeadInput, mergeModuleOptions, resolveMeekoModules, satisfiesVersion, warnLegacyLayerEntries } from "../src/framework/module-loader.ts";
import { definePlugin, runPlugins } from "../src/framework/plugin.ts";
import { fixedRoute } from "../src/framework/navigation.ts";
import { buildProject } from "../src/framework/project.ts";
import { inject, createContext, createRoot } from "../src/reactivity.ts";
import { linkRepositoryPackages, repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

const fixture = fileURLToPath(new URL("./fixtures/module-hello", import.meta.url));

async function put(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

async function files(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(path));
    else found.push(path);
  }
  return found;
}

test("version ranges follow npm comparators", () => {
  assert.equal(satisfiesVersion("1.2.0", ">=1.2"), true);
  assert.equal(satisfiesVersion("1.1.9", ">=1.2"), false);
  assert.equal(satisfiesVersion("1.4.2", "^1.2.0"), true);
  assert.equal(satisfiesVersion("2.0.0", "^1.2.0"), false);
  assert.equal(satisfiesVersion("1.2.7", "~1.2.3"), true);
  assert.equal(satisfiesVersion("1.3.0", "~1.2.3"), false);
  assert.equal(satisfiesVersion("1.9.0", ">=1.2 <2"), true);
  assert.equal(satisfiesVersion("2.1.0", "1.x || 2.x"), true);
  assert.equal(satisfiesVersion("3.0.0", "1.x || 2.x"), false);
  assert.equal(satisfiesVersion("1.2.0", ">1.2"), false);
  assert.equal(satisfiesVersion("1.2.0", "*"), true);
  assert.throws(() => satisfiesVersion("1.2.0", "1.0 - 2.0"), /Comparador de rango de versiones no admitido/);
});

test("module options merge defaults, config[configKey] and inline options in order", () => {
  assert.deepEqual(mergeModuleOptions({ a: 1, nested: { x: 1, y: 1 }, list: [1] }, { nested: { y: 2 }, list: [2] }, { a: 3, nested: { z: 3 } }), {
    a: 3, nested: { x: 1, y: 2, z: 3 }, list: [2],
  });
  assert.throws(() => mergeModuleOptions([1]), /objetos planos/);
  assert.deepEqual(mergeHeadInput({ title: "A", meta: [{ name: "a", content: "1" }], htmlAttrs: { lang: "es" } }, { title: "B", meta: [{ name: "b", content: "2" }], htmlAttrs: { dir: "ltr" } }), {
    title: "B", meta: [{ name: "a", content: "1" }, { name: "b", content: "2" }], htmlAttrs: { lang: "es", dir: "ltr" },
  });
});

test("modules run once per configuration with merged options, layers, autoimports and head", async (context) => {
  const root = await tempProject(context, "module-config");
  await linkRepositoryPackages(root);
  await cp(fixture, join(root, "modules", "hello"), { recursive: true });
  await put(root, "app/pages/index.meeko", "<template><p>Home</p></template>\n");
  await put(root, "layers/base/app/pages/base.meeko", "<template><p>Base</p></template>\n");
  await put(root, "legacy/app/pages/legacy.meeko", "<template><p>Legacy</p></template>\n");
  await put(root, "modules/probe/index.ts", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule<{ value: string; from: string[] }>({
  meta: { name: "probe", configKey: "probe" },
  defaults: { value: "default", from: ["defaults"] },
  setup(options, meeko) {
    (globalThis as Record<string, unknown>).__probeRuns = ((globalThis as Record<string, number>).__probeRuns ?? 0) + 1;
    (globalThis as Record<string, unknown>).__probeOptions = options;
    meeko.addHead({ title: "Probe", meta: [{ name: "probe", content: options.value }] });
  },
});
`);
  await put(root, "meeko.config.ts", `import { defineMeekoConfig } from "@meekojs/meeko/framework";
import hello from "./modules/hello/index.ts";

export default defineMeekoConfig({
  extends: ["./layers/base"],
  modules: [[hello, { mark: "inline" }], ["./modules/probe", { value: "inline" }], "./legacy"],
  hello: { greeting: "From config", mark: "config" },
  probe: { from: ["config"] },
  document: { lang: "es", head: { title: "Project", meta: [{ name: "project", content: "yes" }] } },
});
`);
  const { config, modules } = await loadConfiguredModules(root);
  assert.deepEqual(modules.names, ["hello", "probe"]);
  assert.deepEqual((globalThis as Record<string, unknown>).__probeOptions, { value: "inline", from: ["config"] });
  assert.equal(await resolveMeekoModules(root, config), modules, "a configuration object runs its modules once");
  assert.equal((globalThis as Record<string, unknown>).__probeRuns, 1);
  assert.equal(modules.plugins.length, 3);
  assert.deepEqual(modules.plugins.map((plugin) => [plugin.mode, plugin.options]), [
    ["universal", { greeting: "From config" }], ["client", { mark: "inline" }], ["server", undefined],
  ]);
  assert.deepEqual([...modules.publicFiles.keys()], ["robots.txt", "sitemap.xml"]);
  const sources = await resolveConfigSources(root);
  assert.deepEqual(sources.map((source) => [source.kind, source.name]), [["app", "app"], ["layer", "base"], ["module", "legacy"], ["module", "layer"]]);
  const routes = await discoverConfiguredRoutes(root);
  assert.deepEqual(new Set(routes.map((route) => route.id)), new Set(["/", "/base", "/legacy", "/hello"]));
  const registry = await discoverAutoImports(root);
  const entry = (name: string) => registry.find((item) => item.name === name);
  assert.equal(entry("HelloBadge")?.component, true);
  assert.equal(entry("useGreetingText")?.scope, "app");
  assert.equal(entry("useHelloGreeting")?.file, join(root, "modules", "hello", "runtime", "greeting.ts"));
  // Module plugins first, then app/plugins of each layer and of the application, by file name.
  for (const path of ["layers/base/app/plugins/b.ts", "layers/base/app/plugins/a.server.ts", "app/plugins/a.client.ts", "app/plugins/z.ts", "app/plugins/skip.test.ts", "app/plugins/types.d.ts"]) {
    await put(root, path, 'import { definePlugin } from "@meekojs/meeko/framework";\nexport default definePlugin(() => {});\n');
  }
  assert.deepEqual((await discoverAppPlugins(root)).map((plugin) => `${plugin.mode} ${plugin.name}`), [
    "universal hello: modules/hello/runtime/greeting.plugin.ts",
    "client hello: modules/hello/runtime/mark.client.ts",
    "server hello: modules/hello/runtime/stats.server.ts",
    "server layers/base/app/plugins/a.server.ts",
    "universal layers/base/app/plugins/b.ts",
    "client app/plugins/a.client.ts",
    "universal app/plugins/z.ts",
  ]);
  const resolved = await resolveMeekoConfig(root);
  assert.deepEqual(resolved.document, {
    lang: "es",
    head: {
      title: "Project",
      meta: [{ name: "generator", content: "meeko-module-hello" }, { name: "probe", content: "inline" }, { name: "project", content: "yes" }],
      script: [{ children: "document.documentElement.dataset.helloHead = 'early'", key: "hello-early" }],
    },
  });
  // The editor of an untrusted workspace reads only literal strings and never runs a module.
  assert.deepEqual(readMeekoConfigSync(root), { extends: ["./layers/base"], modules: ["./legacy"] });
  const statik = discoverAutoImportsSync(root);
  assert.equal(statik.some((item) => item.name === "HelloBadge"), false);
  const staticSources = await resolveConfigSources(root, readMeekoConfigSync(root));
  assert.deepEqual(staticSources.map((source) => source.name), ["app", "base", "legacy"]);
  // A layer folder in modules keeps working, with one deprecation warning per process.
  const warnings: string[] = [];
  warnLegacyLayerEntries(root, config, (text) => warnings.push(text));
  warnLegacyLayerEntries(root, config, (text) => warnings.push(text));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /"\.\/legacy" en modules .* layers: \["\.\/legacy"\].*Meeko 2\.0/);
});

test("module definitions and entries are validated", async (context) => {
  assert.throws(() => defineMeekoModule({ meta: { name: "" }, setup() {} }), /meta\.name/);
  assert.throws(() => defineMeekoModule({ meta: { name: "x" } } as never), /setup function/);
  const root = await tempProject(context, "module-invalid");
  await linkRepositoryPackages(root);
  await put(root, "app/pages/index.meeko", "<template><p>Home</p></template>\n");
  await put(root, "modules/future/index.ts", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "future", compatibility: { meeko: ">=9" } }, setup() {} });
`);
  await put(root, "modules/plain/index.ts", "export default { meta: { name: 'plain' }, setup() {} };\n");
  await put(root, "legacy-folder/app/pages/legacy.meeko", "<template><p>Legacy</p></template>\n");
  await put(root, "modules/broken/index.ts", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "broken" }, setup(_options, meeko) { meeko.addPlugin("./missing.ts"); } });
`);
  // The theme module of the 1.3 guide: `theme` is Meeko's own option since 1.4.
  for (const [name, key] of [["acme-theme", "theme"], ["acme-site", "site"], ["acme-layers", "layers"]]) {
    await put(root, `modules/${name}/index.ts`, `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "@acme/${name}", configKey: "${key}" }, defaults: { initial: "light" }, setup() {} });
`);
  }
  for (const name of ["dup-a", "dup-b"]) {
    await put(root, `modules/${name}/index.ts`, `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "dup" }, setup() {} });
`);
  }
  const cases: Array<[string, RegExp]> = [
    [`modules: ["./modules/future"]`, /necesita Meeko >=9; este proyecto usa/],
    [`modules: ["./modules/plain"]`, /debe exportar por defecto defineMeekoModule/],
    [`modules: ["./modules/broken"]`, /broken falló en setup: .*plugin .*missing\.ts no existe/],
    [`modules: ["./modules/dup-a", "./modules/dup-b"]`, /El módulo de Meeko dup aparece más de una vez/],
    [`modules: [["./legacy-folder", { a: 1 }]]`, /carpeta de layer, que no admite opciones; muévala a layers/],
    [`modules: [42]`, /modules debe ser un array/],
    [`modules: ["./modules/acme-theme"]`, /El módulo de Meeko @acme\/acme-theme usa meta\.configKey "theme", que es una opción del propio Meeko desde 1\.4: dé al módulo otra configKey .*migration-1.4/],
    [`modules: ["./modules/acme-site"]`, /meta\.configKey "site", que es una opción del propio Meeko desde 1\.3/],
    [`modules: ["./modules/acme-layers"]`, /meta\.configKey "layers", que es una opción del propio Meeko: /],
    [`modules: ["./modules/acme-theme"], theme: { initial: "dark", storageKey: "theme" }`, /theme: campo desconocido initial\. Desde 1\.4, theme es la opción del tema claro\/oscuro de Meeko.*meta\.configKey "theme".*migration-1\.4/],
    [`modules: ["./nowhere"]`, /No se encuentra|no existe/],
  ];
  for (const [modules, error] of cases) {
    await put(root, "meeko.config.mjs", `export default { ${modules} };\n`);
    await assert.rejects(resolveConfigSources(root), error, modules);
  }
  // A layer folder written without "./", as 1.1 accepted it, is still a layer.
  await put(root, "meeko.config.mjs", 'export default { modules: ["legacy-folder"] };\n');
  assert.deepEqual((await resolveConfigSources(root)).map((source) => [source.kind, source.name]), [["app", "app"], ["module", "legacy-folder"]]);
});

test("app plugins run in order, provide values to the render root and collect error observers", async () => {
  const key = createContext<string>("plugin value");
  const order: string[] = [];
  const route = fixedRoute({ url: "/a?x=1", path: "/a", id: "/a", params: {}, search: { x: "1" } });
  const state = await runPlugins([
    { plugin: definePlugin<{ suffix: string }>(async (app, options) => { order.push(`first:${app.side}:${app.route.path.value}`); app.provide(key, `value${options.suffix}`); }), options: { suffix: "!" } },
    { plugin: definePlugin((app) => { order.push(`second:${String(app.request?.url)}`); app.onError(() => {}); }) },
  ], { side: "server", route, request: new Request("http://localhost/a?x=1") });
  assert.deepEqual(order, ["first:server:/a", "second:http://localhost/a?x=1"]);
  assert.equal(state.errorHandlers.length, 1);
  assert.equal(createRoot((dispose) => { state.apply(); const value = inject(key); dispose(); return value; }), "value!");
  await assert.rejects(runPlugins([{ plugin: () => {}, name: "app/plugins/bad.ts" }], { side: "client", route }), /app\/plugins\/bad\.ts must default-export definePlugin/);
});

const appFiles: Readonly<Record<string, string>> = {
  "server/runtime.ts": `import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

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
`,
  "meeko.config.ts": `import { defineMeekoConfig } from "@meekojs/meeko/framework";
import hello from "./modules/hello/index.ts";

export default defineMeekoConfig({
  layers: [],
  modules: [[hello, { mark: "inline" }]],
  hello: { greeting: "Hello from config", siteUrl: "https://hello.test" },
});
`,
  "app/composables/theme.ts": `import { createContext, inject } from "@meekojs/meeko";

export const themeKey = createContext<string>("theme");

export function useTheme(): string {
  return inject(themeKey);
}
`,
  "app/plugins/10-theme.ts": `import { definePlugin } from "@meekojs/meeko/framework";

export default definePlugin((app) => {
  app.provide(themeKey, "dark");
});
`,
  "app/plugins/20-order.client.ts": `import { definePlugin } from "@meekojs/meeko/framework";

export default definePlugin(() => {
  const root = document.documentElement;
  // Module plugins run before the plugins of app/plugins.
  root.dataset.appSawModule = String(root.dataset.helloClient !== undefined);
});
`,
  "app/pages/uses-module.meeko": `<script lang="ts">
const theme = useTheme();
const text = useGreetingText("Page");
</script>

<template>
  <section class="uses-module">
    <p class="theme">theme:{theme}</p>
    <p class="text">{text}</p>
    <HelloBadge />
    <a class="to-hello" href="/hello">Hello page</a>
  </section>
</template>
`,
};

async function moduleApp(root: string): Promise<void> {
  await initFrameworkProject(root);
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
  await cp(fixture, join(root, "modules", "hello"), { recursive: true });
  for (const [path, source] of Object.entries(appFiles)) await put(root, path, source);
}

async function listening(logs: () => string, child: ReturnType<typeof spawn>, pattern: RegExp): Promise<string> {
  return new Promise<string>((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const url = logs().match(pattern)?.[0];
      if (url) { clearInterval(timer); done(url); }
      else if (child.exitCode !== null) { clearInterval(timer); fail(new Error(`Server exited: ${logs()}`)); }
      else if (Date.now() - start > 30_000) { clearInterval(timer); fail(new Error(`Server did not listen: ${logs()}`)); }
    }, 25);
  });
}

/** What the module adds, seen from HTTP and from Chrome. */
async function assertModuleApp(origin: string, logs: () => string, browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<void> {
  const page = await fetch(`${origin}/uses-module`, { headers: { accept: "text/html" } });
  // Without the hydration markers around text and components.
  const html = (await page.text()).replace(/<!--[\s\S]*?-->/g, "");
  assert.equal(page.status, 200, logs());
  assert.equal(page.headers.get("x-hello-module"), "1", "module server middleware");
  assert.match(html, /<meta name="generator" content="meeko-module-hello">/, "module head in the server document");
  assert.match(html, /theme:dark/, "app plugin provide");
  assert.match(html, /Page, welcome/, "module autoimports dir");
  assert.match(html, /<span class="hello-badge"[^>]*data-greeting="Hello from config"/, "module component and universal plugin");
  const stats = await (await fetch(`${origin}/__hello/stats`)).json() as { runs: number; lastRoute: string; side: string; request: boolean; method: string };
  assert.ok(stats.runs >= 1, JSON.stringify(stats));
  assert.deepEqual({ ...stats, runs: 0 }, { runs: 0, lastRoute: "/uses-module", side: "server", request: true, method: "GET" });
  assert.equal(await (await fetch(`${origin}/robots.txt`)).text(), "User-agent: *\nAllow: /\nSitemap: https://hello.test/sitemap.xml\n");
  const sitemap = await fetch(`${origin}/sitemap.xml`);
  assert.match(sitemap.headers.get("content-type") ?? "", /xml/);
  const sitemapText = await sitemap.text();
  assert.match(sitemapText, /<loc>https:\/\/hello\.test\/hello<\/loc>/);
  assert.match(sitemapText, /<loc>https:\/\/hello\.test\/uses-module<\/loc>/);
  const tab = await browser.newPage();
  const errors: string[] = [];
  tab.on("pageerror", (error) => errors.push(error.message));
  tab.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await tab.goto(`${origin}/uses-module`, { waitUntil: "networkidle" });
  const data = await tab.evaluate(() => ({ ...document.documentElement.dataset }));
  assert.equal(data.helloClient, "inline:client:undefined");
  assert.equal(data.helloVite, "from-vite-plugin");
  assert.equal(data.helloDefine, "inline");
  assert.equal(data.helloRoute, "/uses-module");
  assert.equal(data.appSawModule, "true");
  await tab.locator(".hello-clicks").click();
  assert.equal(await tab.locator(".hello-clicks").innerText(), "Clicks: 1", "the module component hydrated");
  await tab.locator(".to-hello").click();
  await tab.waitForFunction(() => document.documentElement.dataset.helloRoute === "/hello", undefined, { timeout: 10_000 });
  assert.equal(await tab.locator("h1").innerText(), "Hello from the module layer");
  assert.deepEqual(errors, [], logs());
  await tab.close();
}

test("a module adds components, autoimports, plugins, middleware, handlers and public files to build and start", { timeout: 180_000 }, async (context) => {
  let child: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const root = await tempProject(context, "module-build", async () => { await browser?.close(); await stopChild(child, "SIGTERM"); });
  await moduleApp(root);
  // meeko check: the module's autoimports and components are known to the type checker.
  await checkFrameworkProject(root);
  const autoimports = await readFile(join(root, ".meeko", "types", "autoimports", "client.d.ts"), "utf8");
  assert.match(autoimports, /const HelloBadge:/);
  assert.match(autoimports, /const useHelloGreeting:/);
  const result = await buildProject(root, { adapter: "node" });
  const output = await files(result.output);
  assert.equal(await readFile(join(result.output, "client", "robots.txt"), "utf8"), "User-agent: *\nAllow: /\nSitemap: https://hello.test/sitemap.xml\n");
  assert.match(await readFile(join(result.output, "client", "sitemap.xml"), "utf8"), /hello\.test\/hello</);
  assert.deepEqual(JSON.parse(await readFile(join(result.output, "hello-build.json"), "utf8")), { adapter: "node", prerendered: ["/"] });
  const client = (await Promise.all(output.filter((file) => file.includes(`${join("client", "assets")}`) && file.endsWith(".js")).map((file) => readFile(file, "utf8")))).join("\n");
  assert.match(client, /helloClient/, "the client plugin is in the client bundle");
  assert.doesNotMatch(client, /x-hello-module|lastRoute|defineMeekoModule|addPublicFile|hello:virtual-info/, "module setup and server code stay out of the client bundle");
  // The head a module adds is document data: client navigation restores it, so it ships as data.
  assert.match(client, /meeko-module-hello/, "the module head reaches the client document config");
  child = spawn(process.execPath, [join(result.output, "index.mjs")], {
    cwd: root, env: { ...process.env, PORT: "0", HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const origin = await listening(() => logs, child, /http:\/\/127\.0\.0\.1:\d+/);
  browser = await chromium.launch({
    ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
    headless: true,
  });
  await assertModuleApp(origin, () => logs, browser);
});

test("meeko dev serves what a module adds", { timeout: 120_000 }, async (context) => {
  let child: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const root = await tempProject(context, "module-dev", async () => { await browser?.close(); await stopChild(child); });
  await moduleApp(root);
  const port = await freePort();
  child = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "dev", root], {
    cwd: root, env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: "", MEEKO_EDITOR_BRIDGE: "0" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const origin = await listening(() => logs, child, new RegExp(`http://127\\.0\\.0\\.1:${port}`));
  assert.match(logs, /\[meeko\] hello: ready \(dev\)/);
  browser = await chromium.launch({
    ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
    headless: true,
  });
  await assertModuleApp(origin, () => logs, browser);
});

test("module setup and server plugins never reach the client bundle", { timeout: 120_000 }, async (context) => {
  const root = await tempProject(context, "module-boundary");
  await moduleApp(root);
  await prepareFrameworkTypes(root);
  const page = join(root, "app", "pages", "uses-module.meeko");
  const original = await readFile(page, "utf8");
  // The page imports it (a client module of the project), or a module file outside the project does.
  const serverOnly = (file: string): RegExp => new RegExp(`imports server-only module \\S*${file}|Server-only module reached the client bundle: \\S*${file}`);
  for (const [specifier, error] of [
    // A `*.server.*` import in a component is MEEK108 before the bundle boundary sees it.
    ["../../modules/hello/runtime/stats.server.ts", /MEEK108: \.\.\/\.\.\/modules\/hello\/runtime\/stats\.server\.ts es un módulo de servidor/],
    ["../../modules/hello/runtime/header.ts", serverOnly("header\\.ts")],
    ["../../modules/hello/runtime/stats-handler.ts", serverOnly("stats-handler\\.ts")],
    ["../../modules/hello/index.ts", /Meeko module setup reached the client bundle: \S*index\.ts/],
  ] as const) {
    await writeFile(page, original.replace('<script lang="ts">', `<script lang="ts">\nimport * as forbidden from "${specifier}";\nconsole.log(forbidden);`));
    await assert.rejects(buildProject(root, { adapter: "node" }), error, specifier);
  }
  // A client file outside the project that imports defineMeekoModule is rejected too.
  await put(root, "modules/hello/runtime/leak.ts", 'import { defineMeekoModule } from "@meekojs/meeko/framework";\nexport const leak = defineMeekoModule;\n');
  await writeFile(page, original.replace('<script lang="ts">', '<script lang="ts">\nimport { leak } from "../../modules/hello/runtime/leak.ts";\nconsole.log(leak);'));
  await assert.rejects(buildProject(root, { adapter: "node" }), /Meeko module setup reached the client bundle: .*leak\.ts/);
});
