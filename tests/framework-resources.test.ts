import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { compile } from "../src/compiler.ts";
import type { ClientComponent, ClientRoute } from "../src/framework/client.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { RouteRecord } from "../src/framework/router.ts";

const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href;

/**
 * The framework runtime as the compiled pages import it, by file URL: one instance of the
 * reactivity, lifecycle and resource modules for the pages, the server and the browser app.
 */
const runtime = async () => ({
  ...await import(fileUrl("src/framework/server.ts")) as typeof import("../src/framework/server.ts"),
  ...await import(fileUrl("src/framework/client.ts")) as typeof import("../src/framework/client.ts"),
  ...await import(fileUrl("src/suspense.ts")) as typeof import("../src/suspense.ts"),
});

/** HTML without the hydration markers of text bindings. */
const visible = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, "");

interface DataServer {
  calls: string[];
  headers: Headers[];
  gate: Promise<void> | undefined;
  csrf: string | undefined;
}

const globals = globalThis as unknown as { meekoData?: DataServer; meekoDataFetch?: typeof fetch; meekoCsrf?: () => string | undefined };

/** Answers the endpoints of the test application and records every request. */
function installDataServer(): DataServer {
  const server: DataServer = { calls: [], headers: [], gate: undefined, csrf: undefined };
  globals.meekoData = server;
  globals.meekoCsrf = () => server.csrf;
  globals.meekoDataFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    server.calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}${init?.body ? ` ${String(init.body)}` : ""}`);
    server.headers.push(new Headers(init?.headers));
    if (server.gate) await server.gate;
    if (url.pathname === "/api/notes") {
      const q = url.searchParams.get("q") ?? "";
      if (q === "boom") return Response.json({ code: "BOOM" }, { status: 500 });
      return Response.json([`${q}1`, `${q}2`]);
    }
    if (url.pathname === "/_meeko/rpc/users.get") return Response.json({ name: `User ${(JSON.parse(String(init!.body)) as { id: number }).id}` });
    if (url.pathname === "/_meeko/rpc/notes.add") return Response.json({ saved: (JSON.parse(String(init!.body)) as { text: string }).text });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return server;
}

const dataModule = (framework: string): string => `import { createUseApi, createUseRpcMutation, createUseRpcQuery } from ${framework};
const manifest = {
  api: [{ clientKey: "notes", pathname: "/api/notes", method: "GET" }],
  rpc: [{ id: "users.get", pathname: "/_meeko/rpc/users.get" }, { id: "notes.add", pathname: "/_meeko/rpc/notes.add" }],
} as const;
const globals = globalThis as unknown as { meekoDataFetch: typeof fetch; meekoCsrf: () => string | undefined };
const options = { baseUrl: "https://example.test", fetch: ((input, init) => globals.meekoDataFetch(input, init)) as typeof fetch, csrfToken: () => globals.meekoCsrf() };
export const useApi = createUseApi(manifest, options);
export const useRpcQuery = createUseRpcQuery(manifest, options);
export const useRpcMutation = createUseRpcMutation(manifest, options);
`;

const notesPage = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import { useApi, useRpcQuery } from "./data.ts";
const q = signal("a");
const notes = await useApi("/api/notes", { query: { q } });
const user = await useRpcQuery("users.get", { id: 7 });
const later = useApi("/api/notes", { query: { q: "later" } });
</script>
<template><p class="notes">{notes.data.value.join(",")}</p><p class="user">{user.data.value.name}</p><p class="later">{later.data.value ? later.data.value.join(",") : (later.pending.value ? "pending" : "none")}</p><button class="next" on:click="() => q.value = 'b'">n</button><button class="refresh" on:click="() => notes.refresh()">r</button></template>`;

const brokenPage = `<script lang="ts">
import { useApi } from "./data.ts";
const notes = await useApi("/api/notes", { query: { q: "boom" } });
</script>
<template><p class="notes">{notes.data.value.join(",")}</p></template>`;

const homePage = `<script lang="ts">
import { useNavigation } from "@meekojs/meeko/framework";
const navigation = useNavigation();
</script>
<template><p class="home">home:{String(navigation.pending.value)}</p></template>`;

const errorPage = `<script lang="ts">
const props = defineProps<{ status: number; message: string }>();
</script>
<template><p class="error">{props.status}:{props.message}</p></template>`;

const mutationPage = `<script lang="ts">
import { useRpcMutation } from "./data.ts";
const add = useRpcMutation("notes.add");
</script>
<template><p class="state">{add.pending.value ? "saving" : add.data.value ? add.data.value.saved : "idle"}</p><button class="add" on:click="() => { void add.mutate({ text: 'hi' }); }">a</button></template>`;

const pages: Record<string, string> = {
  "notes.meeko": notesPage, "broken.meeko": brokenPage, "home.meeko": homePage,
  "error.meeko": errorPage, "mutation.meeko": mutationPage,
};

/** Compiles the pages against the source runtime, so the test does not depend on dist/. */
async function loadPages(): Promise<{ modules: Record<string, ClientComponent>; cleanup: () => Promise<void> }> {
  // Inside the repository, so the pages and the test share one instance of the runtime modules.
  await mkdir(resolve(".meeko"), { recursive: true });
  const directory = await mkdtemp(resolve(".meeko", "resources-test-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  await writeFile(join(directory, "data.ts"), dataModule(runtime("src/framework.ts")));
  const modules: Record<string, ClientComponent> = {};
  for (const [file, source] of Object.entries(pages)) {
    const code = compile(source, join(directory, file)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko/framework"`, `from ${runtime("src/framework.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
    const target = join(directory, file.replace(/\.meeko$/, ".ts"));
    await writeFile(target, code);
    modules[file] = await import(pathToFileURL(target).href) as ClientComponent;
  }
  return { modules, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const routes: readonly RouteRecord[] = createRouteManifest([
  { id: "/", file: "home.meeko", layouts: [] },
  { id: "/notes", file: "notes.meeko", layouts: [], error: "error.meeko" },
  { id: "/broken", file: "broken.meeko", layouts: [], error: "error.meeko" },
  { id: "/stream", file: "notes.meeko", layouts: [], sidecar: "stream.route.ts", render: "stream" },
  { id: "/spa", file: "notes.meeko", layouts: [], sidecar: "client.route.ts", render: "client", error: "error.meeko" },
  { id: "/spa-broken", file: "broken.meeko", layouts: [], sidecar: "client.route.ts", render: "client", error: "error.meeko" },
  { id: "/mutation", file: "mutation.meeko", layouts: [] },
]);

const sidecars: Record<string, ClientRoute> = {
  "stream.route.ts": { render: "stream", load: () => ({}) } as ClientRoute,
  "client.route.ts": { render: "client" } as ClientRoute,
};

async function boot(modules: Record<string, ClientComponent>, url: string, serverData = true) {
  const { createFrameworkHandler, mountClientApp } = await runtime();
  const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]!, loadRoute: async (file) => sidecars[file]! as never });
  const browser = new HappyWindow({ url });
  const response = await server(new Request(url, { headers: { accept: "text/html" } }));
  const document = await response.text();
  browser.document.write(document);
  const root = browser.document.getElementById("app")!;
  const payload = browser.document.getElementById("meeko-payload")!.textContent!;
  const app = await mountClientApp({
    routes, root: root as unknown as Element, payload,
    loadPage: async (file) => modules[file]!,
    loadClientRoute: async (file) => sidecars[file]!,
    ...(serverData ? { serverData: true, fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch } : {}),
    onNavigationError: () => {},
    browser: browser as unknown as Window,
  });
  return { app, browser, root, html: visible(document), payload: JSON.parse(payload) as Record<string, unknown>, response };
}

const text = (root: { querySelector(selector: string): { textContent: string | null } | null }, selector: string): string | null | undefined => root.querySelector(selector)?.textContent;

test("SSR loads awaited data into the HTML and the payload, and hydration reads it without requesting it again", async () => {
  const data = installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    const { app, browser, root, html, payload, response } = await boot(modules, "https://example.test/notes");
    assert.equal(response.status, 200);
    assert.match(html, /<p class="notes">a1,a2<\/p>/);
    assert.match(html, /<p class="user">User 7<\/p>/);
    assert.match(html, /<p class="later">pending<\/p>/, "a composable without await does not load in SSR");
    assert.deepEqual(payload.resources, {
      'GET /api/notes {"query":{"q":"a"}}': ["a1", "a2"],
      'RPC users.get {"id":7}': { name: "User 7" },
    });
    await flush();
    // SSR requested the awaited data once; hydration requests only the data that was not awaited.
    assert.deepEqual(data.calls.splice(0), ["GET /api/notes?q=a", 'POST /_meeko/rpc/users.get {"id":7}', "GET /api/notes?q=later"]);
    assert.equal(text(root, ".notes"), "a1,a2");
    assert.equal(text(root, ".later"), "later1,later2");

    (root.querySelector(".next") as unknown as HTMLButtonElement).click();
    await flush();
    assert.deepEqual(data.calls.splice(0), ["GET /api/notes?q=b"], "a signal of the input loads the data again");
    assert.equal(text(root, ".notes"), "b1,b2");

    (root.querySelector(".refresh") as unknown as HTMLButtonElement).click();
    await flush();
    assert.deepEqual(data.calls.splice(0), ["GET /api/notes?q=b"], "refresh() loads the current input again");
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("a stream route loads awaited data before the first byte", async () => {
  const data = installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    const { createFrameworkHandler } = await runtime();
    const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]!, loadRoute: async (file) => sidecars[file]! as never });
    const response = await server(new Request("https://example.test/stream", { headers: { accept: "text/html" } }));
    const html = visible(await response.text());
    assert.match(html, /<p class="notes">a1,a2<\/p>/);
    assert.match(html, /"resources":\{"GET \/api\/notes/);
    assert.equal(data.calls.length, 2);
  } finally {
    await cleanup();
  }
});

test("a failed awaited request in SSR renders the route error page", async () => {
  installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    const { createFrameworkHandler } = await runtime();
    const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]!, loadRoute: async (file) => sidecars[file]! as never });
    const response = await server(new Request("https://example.test/broken", { headers: { accept: "text/html" } }));
    assert.equal(response.status, 500);
    assert.match(visible(await response.text()), /<p class="error">500:Internal Server Error<\/p>/);
  } finally {
    await cleanup();
  }
});

test("renderToString stays synchronous and fails clearly when a component awaits data", async () => {
  installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    const { SuspendedRenderError } = await runtime();
    const page = modules["notes.meeko"] as unknown as { renderToString(props: Record<string, unknown>): string };
    assert.throws(() => page.renderToString({}), (error: unknown) => {
      assert.ok(error instanceof SuspendedRenderError, String(error));
      assert.equal(error.code, "MEEKO_SUSPENDED");
      assert.match(error.message, /useApi\("\/api\/notes"\)/);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test("client navigation loads the next page's data before the commit, with pending navigation and the error page on failure", async () => {
  const data = installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    const { app, browser, root } = await boot(modules, "https://example.test/", false);
    assert.equal(text(root, ".home"), "home:false");
    let open!: () => void;
    data.gate = new Promise((resolve) => { open = resolve; });
    const navigation = app.navigate("/notes");
    await flush();
    assert.equal(text(root, ".home"), "home:true", "the previous page stays visible while the data loads");
    assert.equal(root.querySelector(".notes"), null);
    data.gate = undefined;
    open();
    assert.equal(await navigation, true);
    assert.equal(text(root, ".notes"), "a1,a2");
    assert.equal(text(root, ".user"), "User 7");
    await flush();
    assert.deepEqual(data.calls.splice(0), ["GET /api/notes?q=a", 'POST /_meeko/rpc/users.get {"id":7}', "GET /api/notes?q=later"], "the commit reads the loaded data instead of requesting it again");

    assert.equal(await app.navigate("/broken"), true);
    assert.equal(text(root, ".error"), "500:Internal Server Error");
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("navigation to an SSR route reuses the data of the server payload", async () => {
  const data = installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    const { app, browser, root } = await boot(modules, "https://example.test/");
    assert.equal(await app.navigate("/notes"), true);
    assert.equal(text(root, ".notes"), "a1,a2");
    await flush();
    assert.deepEqual(data.calls.splice(0), ["GET /api/notes?q=a", 'POST /_meeko/rpc/users.get {"id":7}', "GET /api/notes?q=later"]);
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("render: client routes load awaited data in the browser before the commit", async () => {
  const data = installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    const { app, browser, root, html } = await boot(modules, "https://example.test/spa");
    assert.doesNotMatch(html, /a1,a2/);
    await flush();
    assert.equal(text(root, ".notes"), "a1,a2");
    assert.deepEqual(data.calls.splice(0), ["GET /api/notes?q=a", 'POST /_meeko/rpc/users.get {"id":7}', "GET /api/notes?q=later"]);
    assert.equal(await app.navigate("/spa-broken"), true);
    assert.equal(text(root, ".error"), "500:Internal Server Error");
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("useRpcMutation never runs in SSR and sends the CSRF token when mutate is called", async () => {
  const data = installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    data.csrf = "token-1";
    const { app, browser, root, html } = await boot(modules, "https://example.test/mutation");
    assert.match(html, /<p class="state">idle<\/p>/);
    assert.deepEqual(data.calls, []);
    (root.querySelector(".add") as unknown as HTMLButtonElement).click();
    assert.equal(text(root, ".state"), "saving");
    await flush();
    assert.equal(text(root, ".state"), "hi");
    assert.deepEqual(data.calls.splice(0), ['POST /_meeko/rpc/notes.add {"text":"hi"}']);
    assert.equal(data.headers[0]!.get("x-meeko-csrf"), "token-1");
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("hydration fails clearly when the payload lacks awaited data", async () => {
  installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    const { createFrameworkHandler, mountClientApp } = await runtime();
    const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]! });
    const browser = new HappyWindow({ url: "https://example.test/notes" });
    browser.document.write(await (await server(new Request("https://example.test/notes", { headers: { accept: "text/html" } }))).text());
    const payload = JSON.parse(browser.document.getElementById("meeko-payload")!.textContent!) as Record<string, unknown>;
    delete payload.resources;
    await assert.rejects(mountClientApp({
      routes, root: browser.document.getElementById("app") as unknown as Element, payload: JSON.stringify(payload),
      loadPage: async (file) => modules[file]!, browser: browser as unknown as Window,
    }), /MEEKO_RESOURCE_MISSING: useApi\("\/api\/notes"\)/);
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("renderWithSuspense stops after a bounded number of passes", async () => {
  const { renderWithSuspense, suspend } = await runtime();
  let passes = 0;
  await assert.rejects(renderWithSuspense(() => {
    passes++;
    suspend(Promise.resolve(), `request ${passes}`);
  }, { maxPasses: 3 }), /still suspended after 3 passes/);
  assert.equal(passes, 3);
});

test("meeko check types useApi, useRpcQuery and useRpcMutation from the contracts and narrows awaited data", { timeout: 90_000 }, async () => {
  const { checkSource } = await import("../src/check.ts");
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko", "resources-check-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      types: ["node"],
      paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko/framework": ["../../src/framework.ts"], "@meekojs/meeko": ["../../src/index.ts"] },
    },
  })}\n`);
  await writeFile(join(root, "data.ts"), `import { createUseApi, createUseRpcMutation, createUseRpcQuery } from "@meekojs/meeko/framework";
import type { ApiOperation, RpcOperation } from "@meekojs/meeko/framework";
const manifest = {
  api: [{ clientKey: "notes", pathname: "/api/notes", method: "GET" }, { clientKey: "notes", pathname: "/api/notes", method: "POST" }, { clientKey: "notes.item", pathname: "/api/notes/[id]", method: "GET" }],
  rpc: [{ id: "users.get", pathname: "/_meeko/rpc/users.get" }],
} as const;
type ApiContract = {
  notes: { get: ApiOperation<undefined, { q: string }, undefined, string[]>; post: ApiOperation<undefined, undefined, { text: string }, { id: number }> };
  "notes.item": { get: ApiOperation<{ id: string }, undefined, undefined, { text: string }> };
};
type RpcContract = { "users.get": RpcOperation<{ id: number }, { name: string }>; "notes.add": RpcOperation<{ text: string }, { saved: string }> };
export const useApi = createUseApi<ApiContract, typeof manifest>(manifest);
export const useRpcQuery = createUseRpcQuery<RpcContract>(manifest);
export const useRpcMutation = createUseRpcMutation<RpcContract>(manifest);
`);
  const head = `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nimport { useApi, useRpcMutation, useRpcQuery } from "./data.js";\nconst q = signal("a");\n`;
  const cases = [
    { name: "Typed", source: `${head}const notes = await useApi("/api/notes", { query: { q } });\nconst first: string | undefined = notes.data.value[0];\nconst note = await useApi("/api/notes/[id]", () => ({ params: { id: q.value } }));\nconst text: string = note.data.value.text;\nconst user = await useRpcQuery("users.get", { id: 1 });\nconst name: string = user.data.value.name;\nconst lazy = useApi("/api/notes", { query: { q: "x" } });\nconst maybe: string[] | null = lazy.data.value;\nconst add = useRpcMutation("notes.add");\nconst save = (): Promise<{ saved: string }> => add.mutate({ text: "x" });\nconst saved: { saved: string } | null = add.data.value;\n</script><template><p on:click="save">{first}{text}{name}{String(maybe)}{String(saved)}</p></template>`, codes: [] as string[] },
    { name: "Nullable", source: `${head}const lazy = useApi("/api/notes", { query: { q } });\nconst size: number = lazy.data.value.length;\n</script><template><p>{size}</p></template>`, codes: ["TS18047"], at: "lazy.data.value.length" },
    { name: "UnknownPath", source: `${head}const notes = await useApi("/api/missing", { query: { q } });\n</script><template><p>{String(notes)}</p></template>`, codes: ["TS2345"], at: "\"/api/missing\"" },
    { name: "WrongQuery", source: `${head}const notes = await useApi("/api/notes", { query: { q: 1 } });\n</script><template><p>{String(notes)}</p></template>`, codes: ["TS2322"] },
    { name: "WrongInput", source: `${head}const user = await useRpcQuery("users.get", { id: "1" });\n</script><template><p>{String(user)}</p></template>`, codes: ["TS2322"] },
    { name: "Nested", source: `${head}const load = () => useApi("/api/notes", { query: { q } });\n</script><template><p on:click="load">x</p></template>`, codes: ["MEEK054"], at: "useApi(\"/api/notes\", { query: { q } })" },
    { name: "AwaitedMutation", source: `${head}const add = await useRpcMutation("notes.add");\n</script><template><p>{String(add)}</p></template>`, codes: ["MEEK055"], at: "await useRpcMutation" },
    { name: "WrongMutation", source: `${head}const add = useRpcMutation("notes.add");\nconst run = () => add.mutate({ body: 1 });\n</script><template><p on:click="run">x</p></template>`, codes: ["TS2353"] },
  ];
  try {
    for (const item of cases) {
      const diagnostics = await checkSource(item.source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
      if (item.codes.length === 0) assert.deepEqual([...codes], [], `${item.name}: ${messages}`);
      for (const code of item.codes) assert.ok(codes.has(code), `${item.name}: ${messages}`);
      if (item.at) assert.ok(diagnostics.some((diagnostic) => diagnostic.location.offset === item.source.indexOf(item.at!)), `${item.name}: ${messages}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
