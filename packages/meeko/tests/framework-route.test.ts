import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { compile } from "../src/compiler.ts";
import { applyAutoImports, discoverAutoImports } from "../src/autoimports.ts";
import { checkApp } from "../src/framework/check-app.ts";
import { prepareFrameworkTypeDeclarations } from "../src/framework/type-declarations.ts";
import type { ClientComponent, ClientRoute } from "../src/framework/client.ts";
import type { PageSchema } from "../src/framework/page.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { ErrorPageRecord, RouteRecord } from "../src/framework/router.ts";
import { createTempProject } from "./helpers/temp-project.ts";

const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href;

/** The runtime as the compiled components import it, by file URL: one instance for pages, server and browser. */
const runtime = async () => ({
  ...await import(fileUrl("src/framework/server.ts")) as typeof import("../src/framework/server.ts"),
  ...await import(fileUrl("src/framework/client.ts")) as typeof import("../src/framework/client.ts"),
  ...await import(fileUrl("src/framework/prerender.ts")) as typeof import("../src/framework/prerender.ts"),
});

const globals = globalThis as unknown as { meekoRouteCalls?: string[] };

const dataModule = (framework: string): string => `import { createUseApi } from ${framework};
const manifest = { api: [{ clientKey: "notes", pathname: "/api/notes", method: "GET" }], rpc: [] } as const;
const globals = globalThis as unknown as { meekoRouteCalls: string[] };
export const useApi = createUseApi(manifest, {
  baseUrl: "https://example.test",
  fetch: (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    globals.meekoRouteCalls.push(url.pathname + url.search);
    return Response.json([url.searchParams.get("q") ?? ""]);
  }) as typeof fetch,
});
`;

const appShell = `<script lang="ts">
import type { Component } from "@meekojs/meeko";
import { useRoute } from "@meekojs/meeko/framework";
const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
const route = useRoute();
</script>
<template><div class="app" bind:data-path="route.path.value"><component is="props.outlet"></component></div></template>`;

const shell = `<script lang="ts">
import type { Component } from "@meekojs/meeko";
import { useRoute } from "@meekojs/meeko/framework";
const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
const route = useRoute();
const current = (path: string) => route.path.value === path ? "page" : null;
</script>
<template><nav><a class="home" href="/" bind:aria-current="current('/')">Inicio</a><a class="user" href="/users/7" bind:aria-current="current('/users/7')">Usuario</a></nav><p class="route">{route.id.value ?? "none"}|{route.url.value}|{JSON.stringify(route.params.value)}|{JSON.stringify(route.search.value)}</p><main><component is="props.outlet"></component></main></template>`;

const homePage = `<template><p class="home-page">home</p></template>`;

// Reads a parameter only the user route has: a re-run with another route's values would throw.
const userPage = `<script lang="ts">
import { useRoute } from "@meekojs/meeko/framework";
const route = useRoute();
</script>
<template><p class="user-page">{(route.params.value as { id: string }).id.toUpperCase()}</p></template>`;

const notePage = `<script lang="ts">
const props = defineProps<{ data: { text: string } }>();
</script>
<template><p class="note">{props.data.text}</p></template>`;

// The dry pass of a navigation must see the target route to request its data.
const dataPage = `<script lang="ts">
import { useRoute } from "@meekojs/meeko/framework";
import { useApi } from "./data.ts";
const route = useRoute();
const notes = await useApi("/api/notes", { query: { q: String((route.params.value as { id: string }).id) } });
</script>
<template><p class="data">{notes.data.value.join(",")}</p></template>`;

const barePage = `<script lang="ts">
import { useRoute } from "@meekojs/meeko/framework";
const route = useRoute();
</script>
<template><p class="bare">{route.id.value}|{route.url.value}</p></template>`;

const errorPage = `<script lang="ts">
import { useRoute } from "@meekojs/meeko/framework";
const props = defineProps<{ status: number; message: string }>();
const route = useRoute();
</script>
<template><p class="error">{props.status}:{route.id.value ?? "none"}:{route.url.value}:{JSON.stringify(route.search.value)}</p></template>`;

const sources: Record<string, string> = {
  "app.meeko": appShell, "shell.meeko": shell, "home.meeko": homePage, "user.meeko": userPage,
  "note.meeko": notePage, "data-page.meeko": dataPage, "bare.meeko": barePage, "error.meeko": errorPage,
};

/** Compiles the components against the source runtime, so the test does not depend on dist/. */
async function loadModules(): Promise<{ modules: Record<string, ClientComponent>; cleanup: () => Promise<void> }> {
  // An ES module package, like the repository: the components load as ES modules and share one
  // instance of the runtime modules with the test, instead of a CommonJS copy.
  const project = await createTempProject("route-test");
  const directory = project.root;
  await writeFile(join(directory, "package.json"), '{"private":true,"type":"module"}\n');
  const runtimePath = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  await writeFile(join(directory, "data.ts"), dataModule(runtimePath("src/framework.ts")));
  const modules: Record<string, ClientComponent> = {};
  for (const [file, source] of Object.entries(sources)) {
    const code = compile(source, join(directory, file)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtimePath("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko/framework"`, `from ${runtimePath("src/framework.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${runtimePath("src/index.ts")}`);
    const target = join(directory, file.replace(/\.meeko$/, ".ts"));
    await writeFile(target, code);
    modules[file] = await import(pathToFileURL(target).href) as ClientComponent;
  }
  return { modules, cleanup: () => project.remove() };
}

const numericId: PageSchema<unknown, { id: string }> = {
  "~standard": {
    version: 1,
    validate: (value) => typeof value === "object" && value !== null && "id" in value && /^\d+$/.test(String(value.id))
      ? { value: { id: String(value.id) } } : { issues: [{ message: "invalid id" }] },
  },
};

const layouts = ["app.meeko", "shell.meeko"];
const routes: readonly RouteRecord[] = createRouteManifest([
  { id: "/", file: "home.meeko", layouts },
  { id: "/users/[id]", file: "user.meeko", layouts, sidecar: "user.route.ts" },
  { id: "/notes/[id]", file: "note.meeko", layouts, sidecar: "note.route.ts", render: "client" },
  { id: "/data/[id]", file: "data-page.meeko", layouts },
  { id: "/about", file: "home.meeko", layouts, sidecar: "about.route.ts", render: "prerender" },
  { id: "/bare", file: "bare.meeko", layouts: [] },
]);
const appError: ErrorPageRecord = { file: "error.meeko", layouts: ["app.meeko"] };

interface Gate { promise: Promise<void> | undefined }

function sidecars(gate: Gate): Record<string, ClientRoute> {
  return {
    "user.route.ts": { params: numericId },
    "note.route.ts": {
      render: "client",
      load: async ({ params }: { params: Readonly<Record<string, unknown>> }) => {
        if (gate.promise) await gate.promise;
        return { text: `Note ${String(params.id)}` };
      },
    } as ClientRoute,
    "about.route.ts": { render: "prerender" } as ClientRoute,
  };
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index++) await new Promise((done) => setTimeout(done, 0));
};

type Root = { querySelector(selector: string): { textContent: string | null; getAttribute(name: string): string | null } | null };
const text = (root: Root, selector: string): string | null | undefined => root.querySelector(selector)?.textContent;
const current = (root: Root, selector: string): string | null | undefined => root.querySelector(selector)?.getAttribute("aria-current");

async function serve(modules: Record<string, ClientComponent>, gate: Gate) {
  const { createFrameworkHandler } = await runtime();
  const routeFiles = sidecars(gate);
  return createFrameworkHandler({
    routes, errorPage: appError,
    loadPage: async (file) => modules[file]!,
    loadRoute: async (file) => routeFiles[file]! as never,
  });
}

/** Apps and windows that a test opened; `closeAll` releases them even after a failed assertion. */
const opened: (() => void)[] = [];
function closeAll(): void {
  for (const close of opened.splice(0).reverse()) {
    try { close(); }
    catch { /* Already released by the test. */ }
  }
}

/** Renders `url` on the server (without its fragment, which browsers never send) and hydrates it. */
async function boot(modules: Record<string, ClientComponent>, url: string, options: { serverData?: boolean; document?: string; gate?: Gate } = {}) {
  const { mountClientApp } = await runtime();
  const gate = options.gate ?? { promise: undefined };
  const server = await serve(modules, gate);
  const browser = new HappyWindow({ url });
  const requested = new URL(url);
  requested.hash = "";
  const response = await server(new Request(requested, { headers: { accept: "text/html" } }));
  browser.document.write(options.document ?? await response.text());
  const root = browser.document.getElementById("app")!;
  const ssr = { route: text(root as unknown as Root, ".route"), user: current(root as unknown as Root, ".user"), path: root.querySelector(".app")?.getAttribute("data-path") };
  const routeFiles = sidecars(gate);
  const serverData = options.serverData ?? true;
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes, errorPage: appError, root: root as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    loadClientRoute: async (file) => routeFiles[file]!,
    ...(serverData
      ? { serverData: true, fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch }
      : { loadRoute: async (file: string) => routeFiles[file]! }),
    onNavigationError: (error) => { errors.push(error); },
    browser: browser as unknown as Window,
  });
  opened.push(() => browser.happyDOM.abort(), () => app.dispose());
  return { app, browser, root: root as unknown as Root, response, ssr, errors };
}

test("SSR gives layouts and app.meeko the route of the request, and hydration keeps it", { timeout: 30_000 }, async () => {
  globals.meekoRouteCalls = [];
  const { modules, cleanup } = await loadModules();
  try {
    const { root, response, ssr, errors } = await boot(modules, "https://example.test/users/7?tab=a");
    assert.equal(response.status, 200);
    // The SSR document, before hydration.
    assert.equal(ssr.route, '/users/[id]|/users/7?tab=a|{"id":"7"}|{"tab":"a"}');
    assert.equal(ssr.user, "page");
    assert.equal(ssr.path, "/users/7");
    // Hydration checks every text and attribute binding: it did not throw, so the values matched.
    assert.equal(text(root, ".route"), '/users/[id]|/users/7?tab=a|{"id":"7"}|{"tab":"a"}');
    assert.equal(current(root, ".home"), null);
    assert.equal(text(root, ".user-page"), "7");
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("useRoute updates on commit, not while the navigation is pending, and survives history", { timeout: 30_000 }, async () => {
  globals.meekoRouteCalls = [];
  const { modules, cleanup } = await loadModules();
  const gate: Gate = { promise: undefined };
  try {
    const { app, browser, root, errors } = await boot(modules, "https://example.test/users/7", { gate });
    // To a route with fewer parameters: the user page is released before it could read them.
    assert.equal(await app.navigate("/?q=1"), true);
    assert.equal(text(root, ".route"), '/|/?q=1|{}|{"q":"1"}');
    assert.equal(current(root, ".home"), "page");
    assert.equal(current(root, ".user"), null);
    assert.equal(root.querySelector(".app")?.getAttribute("data-path"), "/");

    let open!: () => void;
    gate.promise = new Promise((done) => { open = done; });
    const navigation = app.navigate("/notes/5");
    await flush();
    assert.equal(text(root, ".route"), '/|/?q=1|{}|{"q":"1"}', "the route changes only when the navigation commits");
    assert.equal(current(root, ".home"), "page");
    open();
    gate.promise = undefined;
    assert.equal(await navigation, true);
    assert.equal(text(root, ".note"), "Note 5");
    assert.equal(text(root, ".route"), '/notes/[id]|/notes/5|{"id":"5"}|{}');
    assert.equal(current(root, ".home"), null);

    // Back to "/?q=1" through the browser history.
    const popped = new Promise<void>((done) => browser.addEventListener("popstate", () => done(), { once: true }));
    browser.history.back();
    await popped;
    await flush();
    assert.equal(browser.location.pathname, "/");
    assert.equal(text(root, ".route"), '/|/?q=1|{}|{"q":"1"}');
    assert.equal(current(root, ".home"), "page");
    // Forward again. happy-dom drops the forward entry when the navigator replaces the current
    // one, so the traversal is replayed as the browser performs it: new URL, then popstate.
    browser.history.replaceState(null, "", "/notes/5");
    browser.dispatchEvent(new browser.PopStateEvent("popstate"));
    await flush();
    assert.equal(text(root, ".route"), '/notes/[id]|/notes/5|{"id":"5"}|{}');
    assert.equal(current(root, ".home"), null);
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("a fragment-only navigation changes url but not path", { timeout: 30_000 }, async () => {
  globals.meekoRouteCalls = [];
  const { modules, cleanup } = await loadModules();
  try {
    // The server never sees the fragment: hydration uses the server values, then applies it.
    const { app, browser, root, ssr, errors } = await boot(modules, "https://example.test/users/7#bio");
    assert.equal(ssr.route, '/users/[id]|/users/7|{"id":"7"}|{}');
    assert.equal(text(root, ".route"), '/users/[id]|/users/7#bio|{"id":"7"}|{}');
    assert.equal(await app.navigate("#posts"), true);
    assert.equal(text(root, ".route"), '/users/[id]|/users/7#posts|{"id":"7"}|{}');
    assert.equal(current(root, ".user"), "page");
    const popped = new Promise<void>((done) => browser.addEventListener("popstate", () => done(), { once: true }));
    browser.history.back();
    await popped;
    await flush();
    assert.equal(browser.location.hash, "#bio");
    assert.equal(text(root, ".route"), '/users/[id]|/users/7#bio|{"id":"7"}|{}');
    assert.equal(text(root, ".user-page"), "7");
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("the dry pass of a navigation and a replaced tree read the target route", { timeout: 30_000 }, async () => {
  globals.meekoRouteCalls = [];
  const { modules, cleanup } = await loadModules();
  try {
    const { app, root, errors } = await boot(modules, "https://example.test/", { serverData: false });
    assert.equal(await app.navigate("/data/42"), true);
    assert.equal(text(root, ".data"), "42");
    await flush();
    assert.deepEqual(globals.meekoRouteCalls, ["/api/notes?q=42"], "the dry pass requested the target's data and the commit reused it");
    assert.equal(text(root, ".route"), '/data/[id]|/data/42|{"id":"42"}|{}');
    // A route without the shared layouts replaces the whole tree.
    assert.equal(await app.navigate("/bare?x=1#top"), true);
    assert.equal(text(root, ".bare"), "/bare|/bare?x=1#top");
    assert.equal(root.querySelector(".route"), null);
    assert.equal(await app.navigate("/users/7"), true);
    assert.equal(text(root, ".route"), '/users/[id]|/users/7|{"id":"7"}|{}');
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("the 404 page of app/error.meeko has a null route id in SSR and after hydration", { timeout: 30_000 }, async () => {
  globals.meekoRouteCalls = [];
  const { modules, cleanup } = await loadModules();
  try {
    const { app, root, response, errors } = await boot(modules, "https://example.test/missing?x=1");
    assert.equal(response.status, 404);
    assert.equal(text(root, ".error"), '404:none:/missing?x=1:{"x":"1"}');
    assert.equal(root.querySelector(".app")?.getAttribute("data-path"), "/missing");
    assert.equal(await app.navigate("/"), true);
    assert.equal(root.querySelector(".app")?.getAttribute("data-path"), "/");
    assert.equal(text(root, ".route"), "/|/|{}|{}");
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("render: client and prerendered pages hydrate with the route of their URL", { timeout: 30_000 }, async () => {
  globals.meekoRouteCalls = [];
  const { modules, cleanup } = await loadModules();
  const output = await mkdtemp(join(tmpdir(), "meeko-route-prerender-"));
  try {
    const client = await boot(modules, "https://example.test/notes/3");
    await flush();
    assert.equal(client.ssr.route, '/notes/[id]|/notes/3|{"id":"3"}|{}');
    assert.equal(text(client.root, ".note"), "Note 3");
    assert.equal(text(client.root, ".route"), '/notes/[id]|/notes/3|{"id":"3"}|{}');
    assert.deepEqual(client.errors, []);
    closeAll();

    // Prerendered on another origin at build time: the route has no origin, so it still matches.
    const { prerenderRoutes } = await runtime();
    const server = await serve(modules, { promise: undefined });
    await prerenderRoutes({ routes, handler: server, loadRoute: async (file) => sidecars({ promise: undefined })[file]! as never, outputRoot: output });
    const index = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as { pages: Record<string, { file: string }> };
    const document = await readFile(join(output, index.pages["/about"]!.file), "utf8");
    const prerendered = await boot(modules, "https://example.test/about", { document });
    assert.equal(prerendered.ssr.route, "/about|/about|{}|{}");
    assert.equal(text(prerendered.root, ".route"), "/about|/about|{}|{}");
    assert.deepEqual(prerendered.errors, []);
  } finally {
    closeAll();
    await rm(output, { recursive: true, force: true });
    await cleanup();
  }
});

test("useRoute fails clearly outside a Meeko application", { timeout: 30_000 }, async () => {
  const { useRoute } = await runtime();
  assert.throws(() => useRoute(), /useRoute\(\) necesita una aplicación de Meeko en ejecución/);
});

test("useRoute is a framework autoimport that a project composable of the same name replaces", { timeout: 30_000 }, async () => {
  const project = await createTempProject("route-autoimport");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const filename = join(root, "app", "layouts", "default.meeko");
    const registry = await discoverAutoImports(root);
    assert.match(applyAutoImports("const route = useRoute();", filename, registry, "client"), /import \{ useRoute as useRoute \} from "@meekojs\/meeko\/framework"/);
    await mkdir(join(root, "app", "composables"), { recursive: true });
    await writeFile(join(root, "app", "composables", "route.ts"), "export function useRoute() { return 1; }\n");
    const own = await discoverAutoImports(root);
    assert.equal(own.filter((entry) => entry.name === "useRoute").length, 1);
    assert.match(applyAutoImports("const route = useRoute();", filename, own, "client"), /composables\/route\.js/);
  } finally {
    await project.remove();
  }
});

const sidebarLayout = (active: string) => `<script lang="ts">
import type { Component } from "@meekojs/meeko";

const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
const route = useRoute();
const links = [{ href: "/", label: "Inicio" }, { href: "/users", label: "Usuarios" }];
const isActive = (href: string): boolean => ${active};
</script>
<template><nav><a each:of="links" each:as="link" each:key="link.href" bind:href="link.href" bind:aria-current="isActive(link.href) ? 'page' : null">{link.label}</a></nav><main><component is="props.outlet"></component></main></template>
`;

test("meeko check types the useRoute autoimport in a layout", { timeout: 120_000 }, async () => {
  const project = await createTempProject("route-check");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await mkdir(join(root, "app", "layouts"), { recursive: true });
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await writeFile(join(root, "app", "pages", "index.meeko"), "<template><h1>Inicio</h1></template>\n");
    const layout = join(root, "app", "layouts", "default.meeko");
    await writeFile(layout, sidebarLayout('href === "/" ? route.path.value === "/" : route.path.value.startsWith(href)'));
    await prepareFrameworkTypeDeclarations(root);
    assert.deepEqual((await checkApp(root)).map((item) => `${item.filename}:${item.code}: ${item.message}`), []);
    // `id` is null on the 404 page, and the signals are read-only.
    await writeFile(layout, sidebarLayout("route.id.value.startsWith(href) || (route.path.value = href) === href"));
    const invalid = await checkApp(root);
    assert.ok(invalid.some((item) => item.filename === layout && /TS18047/.test(item.code)), JSON.stringify(invalid));
    assert.ok(invalid.some((item) => item.filename === layout && /TS2540/.test(item.code)), JSON.stringify(invalid));
  } finally {
    await project.remove();
  }
});
