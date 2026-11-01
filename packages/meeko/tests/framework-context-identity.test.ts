import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { type DevModuleGraph, type DevModuleNode, hotFileKey, type HotModuleNode, invalidateDevModules, isModuleScript, keepServerModules, reachesEagerModule } from "../src/framework/dev-watch.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { installedModulePackages } from "../src/framework/module-loader.ts";
import { withSourcePackages } from "../src/framework/project.ts";
import { repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

/**
 * A context key from `createContext` is a module value: the provider and the consumers find each
 * other only while they import one evaluation of the module that creates it. These tests cover
 * the two ways an application ended up with two: a Meeko module installed in node_modules (its
 * autoimport and its plugin reached the same file by a package name and by a path), and an edit
 * in `meeko dev` that re-evaluated the key for the pages but not for the plugin providing it.
 */

interface TestNode extends HotModuleNode {
  readonly importers: Set<TestNode>;
  readonly acceptedHmrDeps: Set<TestNode>;
}

function node(file: string | null, isSelfAccepting = false): TestNode {
  return { file, isSelfAccepting, importers: new Set(), acceptedHmrDeps: new Set() };
}

function imports(importer: TestNode, imported: TestNode): void {
  imported.importers.add(importer);
}

test("an edit reaches the eager server modules only through importers that do not take the update", () => {
  const plugin = node("/app/app/plugins/modal.ts");
  const runtime = node("/app/server/runtime.ts");
  const page = node("/app/app/pages/index.meeko", true);
  const key = node("/app/app/utils/modal.ts");
  const helper = node("/app/app/utils/helper.ts");
  const entry = node(null);
  const eager = new Set([plugin.file!, runtime.file!].map(hotFileKey));
  imports(entry, plugin);
  imports(entry, runtime);
  imports(entry, page);
  imports(page, key);
  imports(plugin, key);
  imports(key, helper);
  // The plugin imports the key: the app must be built again, whatever else imports it.
  assert.equal(reachesEagerModule([key], eager), true);
  assert.equal(reachesEagerModule([helper], eager), true);
  assert.equal(reachesEagerModule([plugin], eager), true);
  // A page takes its own update, and its imports stop there.
  const label = node("/app/app/utils/label.ts");
  imports(page, label);
  assert.equal(reachesEagerModule([page], eager), false);
  assert.equal(reachesEagerModule([label], eager), false);
  // An importer that accepts the update of a dependency stops the walk too.
  const accepted = node("/app/app/utils/accepted.ts");
  const accepting = node("/app/app/utils/accepting.ts");
  imports(accepting, accepted);
  imports(plugin, accepting);
  accepting.acceptedHmrDeps.add(accepted);
  assert.equal(reachesEagerModule([accepted], eager), false);
  // Import cycles end.
  const left = node("/app/app/utils/left.ts");
  const right = node("/app/app/utils/right.ts");
  imports(left, right);
  imports(right, left);
  assert.equal(reachesEagerModule([left], eager), false);
  assert.equal(reachesEagerModule([key], new Set()), false);
});

test("eager files compare by path whatever the separators, and without case on Windows", () => {
  assert.equal(hotFileKey("C:\\app\\app\\plugins\\modal.ts"), hotFileKey("C:/app/app/plugins/modal.ts"));
  if (process.platform === "win32") assert.equal(hotFileKey("c:/App/plugin.ts"), hotFileKey("C:/app/plugin.ts"));
  const plugin = node("C:/app/app/plugins/modal.ts");
  assert.equal(reachesEagerModule([plugin], new Set([hotFileKey("C:\\app\\app\\plugins\\modal.ts")])), true);
});

interface GraphNode extends DevModuleNode {
  readonly importedModules: Set<GraphNode>;
}

/** A module graph that records what is invalidated, with Vite's propagation to the importers. */
function graph(nodes: readonly GraphNode[]): { graph: DevModuleGraph<GraphNode>; invalidated: Set<GraphNode>; all: () => boolean } {
  const invalidated = new Set<GraphNode>();
  let all = false;
  const importersOf = (target: GraphNode): GraphNode[] => nodes.filter((candidate) => candidate.importedModules.has(target));
  return {
    invalidated,
    all: () => all,
    graph: {
      idToModuleMap: new Map(nodes.map((entry, index) => [`${index}:${entry.file}`, entry])),
      invalidateModule(target, seen = new Set()) {
        if (seen.has(target)) return;
        seen.add(target);
        invalidated.add(target);
        for (const importer of importersOf(target)) this.invalidateModule(importer, seen);
      },
      invalidateAll() { all = true; for (const entry of nodes) invalidated.add(entry); },
    },
  };
}

function graphNode(file: string | null, ...imported: GraphNode[]): GraphNode {
  return { file, importedModules: new Set(imported) };
}

test("a full reload invalidates every server module except what the development app keeps", () => {
  const helper = graphNode("/app/app/utils/helper.ts");
  const key = graphNode("/app/app/utils/modal.ts", helper);
  const plugin = graphNode("/app/app/plugins/modal.ts", key);
  const runtime = graphNode("/app/server/runtime.ts");
  const label = graphNode("/app/app/utils/label.ts");
  const page = graphNode("/app/app/pages/index.meeko", key, label);
  const entry = graphNode(null, plugin, runtime);
  const nodes = [helper, key, plugin, runtime, label, page, entry];
  let mixed = 0;
  const server = (ssr: DevModuleGraph<GraphNode>, client = graph(nodes)) => ({
    moduleGraph: { invalidateAll: () => { mixed++; } },
    environments: { client: { moduleGraph: client.graph }, ssr: { moduleGraph: ssr } },
    client,
  });
  // Without an app registered, as in a Vite project with the Meeko plugin alone, every graph is invalidated.
  invalidateDevModules(server(graph(nodes).graph));
  assert.equal(mixed, 1);
  const kept = graph(nodes);
  const keeping = server(kept.graph);
  keepServerModules(kept.graph, new Set([plugin.file!, runtime.file!].map(hotFileKey)));
  invalidateDevModules(keeping);
  assert.equal(mixed, 1);
  assert.equal(keeping.client.all(), true, "the browser reloads every module");
  assert.equal(kept.all(), false);
  // The page and its own imports are evaluated again, and read the key the plugin provided. The
  // entry, an importer of the plugin, is invalidated too: the app imports it again only when rebuilt.
  assert.deepEqual(kept.invalidated, new Set([label, page, entry]));
  // Registered per graph: a new graph after a restart starts without what the old app kept.
  invalidateDevModules(server(graph(nodes).graph));
  assert.equal(mixed, 2);
});

test("the scripts of a module are the scripts under its folders", () => {
  const directories = ["/repo/packages/ui/dist", "/repo/node_modules/ctx-mod/"];
  assert.equal(isModuleScript("/repo/packages/ui/dist/runtime.js", directories), true);
  assert.equal(isModuleScript("/repo/packages/ui/dist/app/composables/useModal.js", directories), true);
  assert.equal(isModuleScript("/repo/node_modules/ctx-mod/key.mjs", directories), true);
  assert.equal(isModuleScript("/repo/packages/ui/src/key.ts", directories), false);
  // Components keep their hot updates, and neither declarations nor stylesheets are loaded scripts.
  assert.equal(isModuleScript("/repo/packages/ui/dist/app/components/App.meeko", directories), false);
  assert.equal(isModuleScript("/repo/packages/ui/dist/runtime.d.ts", directories), false);
  assert.equal(isModuleScript("/repo/packages/ui/dist/app/styles/main.css", directories), false);
  assert.equal(isModuleScript("/repo/packages/ui/distant/runtime.js", directories), false);
  if (process.platform === "win32") assert.equal(isModuleScript("d:\\Repo\\packages\\ui\\dist\\runtime.js", ["D:/repo/packages/ui/dist"]), true);
});

test("the packages compiled as source are the installed packages that own files of the modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-module-packages-"));
  const directory = async (path: string, manifest?: object): Promise<string> => {
    const full = join(root, path);
    await mkdir(full, { recursive: true });
    if (manifest) await writeFile(join(full, "package.json"), JSON.stringify(manifest));
    return full;
  };
  try {
    await directory(".", { name: "the-app" });
    await directory("node_modules/ctx-mod", { name: "ctx-mod" });
    const components = await directory("node_modules/ctx-mod/components");
    await directory("node_modules/@scope/ui", { name: "@scope/ui" });
    // A nested manifest without a name is not the package.
    const plugins = await directory("node_modules/@scope/ui/dist", { type: "module" });
    await mkdir(join(plugins, "app", "plugins"), { recursive: true });
    await directory("node_modules/.pnpm/pnpm-mod@1.0.0/node_modules/pnpm-mod", { name: "pnpm-mod" });
    const pnpm = await directory("node_modules/.pnpm/pnpm-mod@1.0.0/node_modules/pnpm-mod/runtime");
    const meeko = await directory("node_modules/@meekojs/meeko", { name: "@meekojs/meeko" });
    // A linked package resolves outside node_modules, where Vite already compiles it as source.
    const linked = await directory("vendor/linked", { name: "linked" });
    // A folder of node_modules without a manifest never borrows the application's.
    const nameless = await directory("node_modules/nameless/lib");
    assert.deepEqual(installedModulePackages([
      join(root, "node_modules", "ctx-mod"), components, join(plugins, "app", "plugins"), pnpm, meeko, linked, nameless, join(root, "app"),
    ]), ["ctx-mod", "@scope/ui", "pnpm-mod"]);
    assert.deepEqual(installedModulePackages([]), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the packages compiled as source join ssr.noExternal and optimizeDeps.exclude", () => {
  const base = { root: "/app", ssr: { external: ["@meekojs/meeko"] } };
  assert.equal(withSourcePackages(base, []), base);
  assert.deepEqual(withSourcePackages(base, ["ctx-mod"]), {
    root: "/app", ssr: { external: ["@meekojs/meeko"], noExternal: ["ctx-mod"] }, optimizeDeps: { exclude: ["ctx-mod"] },
  });
  // A self-contained bundle stays one.
  assert.equal(withSourcePackages({ ssr: { noExternal: true } }, ["ctx-mod"]).ssr?.noExternal, true);
  assert.deepEqual(withSourcePackages({ ssr: { noExternal: /^lib-/ }, optimizeDeps: { include: ["a"], exclude: ["b"] } }, ["ctx-mod", "@scope/ui"]), {
    ssr: { noExternal: [/^lib-/, "ctx-mod", "@scope/ui"] }, optimizeDeps: { include: ["a"], exclude: ["b", "ctx-mod", "@scope/ui"] },
  });
});

async function freePort(): Promise<number> {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

async function linkMeeko(root: string): Promise<void> {
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repositoryRoot, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repositoryRoot, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
}

interface Running { readonly child: ChildProcess; readonly logs: () => string }

/** Runs the CLI on `root`; with `port`, waits until it listens, otherwise until it exits successfully. */
async function cli(root: string, args: readonly string[], port?: number, hmrPort?: number): Promise<Running> {
  let logs = "";
  const child = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), ...args, root], {
    cwd: root, env: { ...process.env, ...port ? { PORT: String(port), MEEKO_HMR_PORT: String(hmrPort ?? await freePort()) } : {}, MEEKO_EDITOR_BRIDGE: "0" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  if (port === undefined) {
    const [code] = await once(child, "exit") as [number | null];
    assert.equal(code, 0, logs);
    return { child, logs: () => logs };
  }
  const start = Date.now();
  while (!logs.includes(`:${port}\n`)) {
    if (child.exitCode !== null || Date.now() - start > 30_000) throw new Error(`The server did not listen: ${logs}`);
    await new Promise((done) => setTimeout(done, 25));
  }
  return { child, logs: () => logs };
}

async function html(port: number, path = "/"): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { accept: "text/html" } });
  return { status: response.status, body: await response.text() };
}

async function waitForPage(port: number, path: string, pattern: RegExp, logs: () => string): Promise<string> {
  const start = Date.now();
  let result = await html(port, path);
  while (!(result.status === 200 && pattern.test(result.body)) && Date.now() - start < 20_000) {
    await new Promise((done) => setTimeout(done, 100));
    result = await html(port, path);
  }
  assert.equal(result.status, 200, `${result.body.slice(0, 500)}\n${logs()}`);
  assert.match(result.body, pattern);
  return result.body;
}

test("meeko dev keeps a plugin's context key working after edits of the key, the plugin and the pages", { timeout: 90_000 }, async (context) => {
  let running: Running | undefined;
  const root = await tempProject(context, "context-hmr", () => stopChild(running?.child));
  await initFrameworkProject(root);
  for (const directory of ["app/utils", "app/plugins"]) await mkdir(join(root, directory), { recursive: true });
  const keyFile = join(root, "app", "utils", "modal.ts");
  const pluginFile = join(root, "app", "plugins", "modal.ts");
  const labelFile = join(root, "app", "utils", "label.ts");
  await writeFile(keyFile, 'import { createContext } from "@meekojs/meeko";\n\nexport interface ModalContext { name: string }\nexport const modalKey = createContext<ModalContext>("modal");\n');
  await writeFile(pluginFile, 'import { definePlugin } from "@meekojs/meeko/framework";\nimport { modalKey } from "../utils/modal";\n\nexport default definePlugin((app) => { app.provide(modalKey, { name: "modal-one" }); });\n');
  // The page reads the key through the autoimport of app/utils.
  await writeFile(join(root, "app", "pages", "index.meeko"), '<script lang="ts">\nimport { inject } from "@meekojs/meeko";\nconst modal = inject(modalKey);\n</script>\n<template><p id="modal">{modal.name}</p></template>\n');
  await writeFile(labelFile, 'export const label = "label-one";\n');
  await writeFile(join(root, "app", "pages", "other.meeko"), '<script lang="ts">\nimport { label } from "../utils/label";\n</script>\n<template><p id="label">{label}</p></template>\n');
  // Each app the dev server builds runs server/runtime.ts once.
  await mkdir(join(root, "server"), { recursive: true });
  await writeFile(join(root, "server", "runtime.ts"), 'import { defineServerRuntime } from "@meekojs/meeko/server";\n\nconsole.log("[runtime-evaluated]");\nexport default defineServerRuntime(() => ({}));\n');
  await linkMeeko(root);
  const port = await freePort();
  running = await cli(root, ["dev"], port);
  const { logs } = running;
  const builds = (): number => logs().split("[runtime-evaluated]").length - 1;
  const waitForBuilds = async (count: number): Promise<void> => {
    const start = Date.now();
    while (builds() < count && Date.now() - start < 20_000) await new Promise((done) => setTimeout(done, 50));
    assert.equal(builds(), count, logs());
  };
  await waitForPage(port, "/", /modal-one/, logs);
  assert.equal(builds(), 1, logs());

  // Vite evaluates the key module again for the pages; the app is built again so that the plugin
  // provides the new key. The page used to fail with "Missing Meeko context: modal".
  await writeFile(keyFile, `${await readFile(keyFile, "utf8")}// edited\n`);
  await waitForBuilds(2);
  await waitForPage(port, "/", /modal-one/, logs);
  assert.doesNotMatch(logs(), /Missing Meeko context/);

  // An edit of the plugin applies on the server too.
  await writeFile(pluginFile, (await readFile(pluginFile, "utf8")).replace("modal-one", "modal-two"));
  await waitForBuilds(3);
  await waitForPage(port, "/", /modal-two/, logs);

  // Pages and what only they import take hot updates: the app, and its sessions in memory, stay.
  await writeFile(labelFile, 'export const label = "label-two";\n');
  await waitForPage(port, "/other", /label-two/, logs);
  const otherFile = join(root, "app", "pages", "other.meeko");
  await writeFile(otherFile, (await readFile(otherFile, "utf8")).replace("</p>", " edited</p>"));
  await waitForPage(port, "/other", /edited/, logs);
  await new Promise((done) => setTimeout(done, 300));
  assert.equal(builds(), 3, logs());
  assert.doesNotMatch(logs(), /Missing Meeko context/);
});

/**
 * An installed Meeko module, as `npm install` leaves it: its plugin (added by path) provides a key
 * that a page reads through the module's autoimport (a package name) and that one of its
 * components reads through a relative import.
 */
async function writeInstalledContextModule(root: string): Promise<void> {
  const directory = join(root, "node_modules", "ctx-mod");
  await mkdir(join(directory, "components"), { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "ctx-mod", type: "module", exports: { ".": "./module.js", "./runtime": "./runtime.js" } }));
  await writeFile(join(directory, "module.js"), `import { defineMeekoModule } from "@meekojs/meeko/framework";

export default defineMeekoModule({
  meta: { name: "ctx-mod" },
  setup(_options, meeko) {
    meeko.addAutoImports([{ name: "useCtx", from: "ctx-mod/runtime", scope: "app", componentOnly: true }]);
    meeko.addPlugin(new URL("./plugin.js", import.meta.url));
    meeko.addComponentsDir(new URL("./components", import.meta.url), { prefix: "Ctx" });
  },
});
`);
  await writeFile(join(directory, "runtime.js"), `import { createContext, inject } from "@meekojs/meeko";

const key = createContext("ctx-mod");
export function useCtx() { return inject(key); }
export function provideCtx(app) { app.provide(key, { name: "ctx-provided" }); }
`);
  await writeFile(join(directory, "runtime.d.ts"), "export declare function useCtx(): { name: string };\nexport declare function provideCtx(app: unknown): void;\n");
  await writeFile(join(directory, "plugin.js"), `import { definePlugin } from "@meekojs/meeko/framework";
import { provideCtx } from "./runtime.js";

export default definePlugin((app) => provideCtx(app));
`);
  const component = join(directory, "components", "Label.meeko");
  await writeFile(component, '<script lang="ts">\nimport { useCtx as read } from "../runtime.js";\nconst ctx = read();\n</script>\n<template><span id="label">{ctx.name}</span></template>\n');
  const generated = execFileSync(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "types", component], { cwd: root, encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/)[0]!;
  await writeFile(join(directory, "components", "Label.d.meeko.ts"), await readFile(generated, "utf8"));
  const config = join(root, "meeko.config.ts");
  await writeFile(config, (await readFile(config, "utf8")).replace("modules: []", 'modules: ["ctx-mod"]'));
  await writeFile(join(root, "app", "pages", "index.meeko"), '<script lang="ts">\nconst ctx = useCtx();\n</script>\n<template><p id="page">{ctx.name}</p><CtxLabel /></template>\n');
}

const providedTwice = /id="page">(?:<!--[^>]*-->)?ctx-provided[\s\S]*id="label">(?:<!--[^>]*-->)?ctx-provided/;

test("meeko dev serves an installed module's runtime as one module to the server and the browser", { timeout: 90_000 }, async (context) => {
  let running: Running | undefined;
  const root = await tempProject(context, "context-module-dev", () => stopChild(running?.child));
  await initFrameworkProject(root);
  await linkMeeko(root);
  await writeInstalledContextModule(root);
  const port = await freePort();
  running = await cli(root, ["dev"], port);
  await waitForPage(port, "/", providedTwice, running.logs);
  // The browser imports the autoimport from the file the plugin imports, not from a pre-bundled copy:
  // the copy in node_modules/.vite/deps created a second key and hydration failed.
  const response = await fetch(`http://127.0.0.1:${port}/app/pages/index.meeko?import`);
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /from\s*["']\/node_modules\/ctx-mod\/runtime\.js(?:\?[^"']*)?["']/, page.slice(0, 2000));
  assert.doesNotMatch(page, /\.vite\/deps\/ctx-mod/);
});

test("the server build bundles an installed module's runtime once", { timeout: 180_000 }, async (context) => {
  let running: Running | undefined;
  const root = await tempProject(context, "context-module-build", () => stopChild(running?.child));
  await initFrameworkProject(root);
  await linkMeeko(root);
  await writeInstalledContextModule(root);
  await writePersistentRuntime(root);
  await cli(root, ["build"]);
  const port = await freePort();
  // The plugin used to be bundled and the autoimport stayed external: Node loaded
  // node_modules/ctx-mod/runtime.js a second time and the page failed with "Missing Meeko context".
  running = await cli(root, ["start"], port);
  await waitForPage(port, "/", providedTwice, running.logs);
  assert.doesNotMatch(running.logs(), /Missing Meeko context/);
});

/** Production requires a persistent session store; this one keeps them in memory. */
async function writePersistentRuntime(root: string): Promise<void> {
  await mkdir(join(root, "server"), { recursive: true });
  await writeFile(join(root, "server", "runtime.ts"), `import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

const memory = new MemorySessionStore();
const store = {
  persistent: true as const,
  get: (id: string) => memory.get(id),
  set: (record: Parameters<MemorySessionStore["set"]>[0]) => memory.set(record),
  delete: (id: string) => memory.delete(id),
  replace: (oldId: string, record: Parameters<MemorySessionStore["replace"]>[1]) => memory.replace(oldId, record),
  revokeFamily: (familyId: string) => memory.revokeFamily(familyId),
};
export default defineServerRuntime(() => ({ sessions: new SessionManager({ store }) }));
`);
}

/** Where the package of a module lives: in node_modules (`installed`) or linked from outside it, as in a workspace (`linked`). */
type ModuleLayout = "installed" | "linked";

/**
 * A Meeko module registered by its package name (`modules: ["ctx-mod"]`), laid out as `@meekojs/ui`:
 * `key.js` creates the key, which its plugin and one of its components import by path, while the
 * pages read it through the autoimport of `runtime.js`, a file that only re-exports it. Returns the
 * real directory of the package.
 */
async function writeNamedContextModule(root: string, layout: ModuleLayout): Promise<string> {
  const directory = layout === "installed" ? join(root, "node_modules", "ctx-mod") : join(root, "vendor", "ctx-mod");
  await mkdir(join(directory, "components"), { recursive: true });
  if (layout === "linked") await symlink(directory, join(root, "node_modules", "ctx-mod"), "junction");
  await writeFile(join(directory, "package.json"), JSON.stringify({
    name: "ctx-mod", type: "module", keywords: ["meeko-module"], exports: { ".": "./module.js", "./runtime": "./runtime.js" },
  }));
  await writeFile(join(directory, "module.js"), `import { defineMeekoModule } from "@meekojs/meeko/framework";

export default defineMeekoModule({
  meta: { name: "ctx-mod" },
  setup(_options, meeko) {
    meeko.addAutoImports([{ name: "useCtx", from: "ctx-mod/runtime", scope: "app", componentOnly: true }]);
    meeko.addPlugin(new URL("./plugin.js", import.meta.url));
    meeko.addComponentsDir(new URL("./components", import.meta.url), { prefix: "Ctx" });
  },
});
`);
  await writeFile(join(directory, "key.js"), `import { createContext, inject } from "@meekojs/meeko";

const key = createContext("ctx-mod");
export function useCtx() { return inject(key); }
export function provideCtx(app) { app.provide(key, { name: "ctx-provided" }); }
`);
  await writeFile(join(directory, "key.d.ts"), "export declare function useCtx(): { name: string };\nexport declare function provideCtx(app: unknown): void;\n");
  await writeFile(join(directory, "runtime.js"), 'export { useCtx } from "./key.js";\n');
  await writeFile(join(directory, "runtime.d.ts"), "export declare function useCtx(): { name: string };\n");
  await writeFile(join(directory, "plugin.js"), `import { definePlugin } from "@meekojs/meeko/framework";
import { provideCtx } from "./key.js";

export default definePlugin((app) => provideCtx(app));
`);
  const component = join(directory, "components", "Label.meeko");
  await writeFile(component, '<script lang="ts">\nimport { useCtx as read } from "../key.js";\nconst ctx = read();\n</script>\n<template><span id="label">{ctx.name}</span></template>\n');
  const generated = execFileSync(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "types", component], { cwd: root, encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/)[0]!;
  await writeFile(join(directory, "components", "Label.d.meeko.ts"), await readFile(generated, "utf8"));
  const config = join(root, "meeko.config.ts");
  await writeFile(config, (await readFile(config, "utf8")).replace("modules: []", 'modules: ["ctx-mod"]'));
  await writeFile(join(root, "app", "pages", "index.meeko"), '<script lang="ts">\nconst ctx = useCtx();\n</script>\n<template><p id="page">{ctx.name}</p><CtxLabel /></template>\n');
  return directory;
}

/** The messages that Vite's client receives from the HMR server of `meeko dev`. */
async function hotMessages(hmrPort: number): Promise<{ readonly messages: Array<{ readonly type: string }>; close(): void }> {
  const messages: Array<{ readonly type: string }> = [];
  const socket = new WebSocket(`ws://127.0.0.1:${hmrPort}/`, "vite-hmr");
  socket.addEventListener("message", (event) => { messages.push(JSON.parse(String(event.data)) as { type: string }); });
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });
  await until(() => messages.some((message) => message.type === "connected"), "The HMR socket did not connect");
  return { messages, close: () => socket.close() };
}

async function until(check: () => boolean, message: string): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > 20_000) throw new Error(message);
    await new Promise((done) => setTimeout(done, 25));
  }
}

for (const layout of ["linked", "installed"] as const) {
  test(`meeko dev keeps the context of a module registered by name (${layout}) across full reloads`, { timeout: 120_000 }, async (context) => {
    let running: Running | undefined;
    let hot: Awaited<ReturnType<typeof hotMessages>> | undefined;
    const root = await tempProject(context, `context-named-dev-${layout}`, () => { hot?.close(); return stopChild(running?.child); });
    await initFrameworkProject(root);
    await linkMeeko(root);
    const directory = await writeNamedContextModule(root, layout);
    const port = await freePort();
    const hmrPort = await freePort();
    running = await cli(root, ["dev"], port, hmrPort);
    const { logs } = running;
    await waitForPage(port, "/", providedTwice, logs);
    hot = await hotMessages(hmrPort);
    const { messages } = hot;
    const reloaded = async (edit: () => Promise<void>): Promise<void> => {
      messages.length = 0;
      await edit();
      await until(() => messages.some((message) => message.type === "full-reload"), `No full reload\n${logs()}`);
    };

    // An edited page reloads the browser and invalidates the server modules. The pages used to
    // evaluate key.js again while the plugin of the app kept providing the first key: every page
    // failed with "Missing Meeko context" until meeko dev restarted.
    const page = join(root, "app", "pages", "index.meeko");
    await reloaded(async () => writeFile(page, (await readFile(page, "utf8")).replace("</template>", "<i>page-edited</i></template>")));
    assert.match(await waitForPage(port, "/", /page-edited/, logs), providedTwice);
    // So did a component added to the project.
    await mkdir(join(root, "app", "components"), { recursive: true });
    await reloaded(() => writeFile(join(root, "app", "components", "Extra.meeko"), "<template><b>extra</b></template>\n"));
    await waitForPage(port, "/", providedTwice, logs);

    // Vite does not watch node_modules: only a linked package changes while meeko dev runs.
    if (layout === "linked") {
      // A rebuilt package rewrites its runtime and the key at once. A component update for the
      // runtime that the browser applied after the key changed imported a second key: the browser
      // reloads instead, as for app/utils of the project.
      const runtime = join(directory, "runtime.js");
      // The browser loads the page, whose imports put the module's files in the client graph.
      assert.equal((await fetch(`http://127.0.0.1:${port}/app/pages/index.meeko?import`)).status, 200);
      await reloaded(async () => writeFile(runtime, `${await readFile(runtime, "utf8")}// rebuilt\n`));
      await new Promise((done) => setTimeout(done, 300));
      assert.deepEqual(messages.filter((message) => message.type === "update"), [], "no hot update for a module script");
      await waitForPage(port, "/", providedTwice, logs);
      // An edit of the key reaches the plugin: the app is built again.
      const key = join(directory, "key.js");
      await reloaded(async () => writeFile(key, `${await readFile(key, "utf8")}// rebuilt\n`));
      await waitForPage(port, "/", providedTwice, logs);
    }
    assert.doesNotMatch(logs(), /Missing Meeko context/);
  });

  test(`meeko build and start keep the context of a module registered by name (${layout})`, { timeout: 180_000 }, async (context) => {
    let running: Running | undefined;
    const root = await tempProject(context, `context-named-build-${layout}`, () => stopChild(running?.child));
    await initFrameworkProject(root);
    await linkMeeko(root);
    await writeNamedContextModule(root, layout);
    await writePersistentRuntime(root);
    await cli(root, ["build"]);
    const port = await freePort();
    running = await cli(root, ["start"], port);
    await waitForPage(port, "/", providedTwice, running.logs);
    assert.doesNotMatch(running.logs(), /Missing Meeko context/);
  });
}
