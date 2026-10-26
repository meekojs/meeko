import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { compile } from "../src/compiler.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { RouteRecord } from "../src/framework/router.ts";

const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href;

/** The runtime as the compiled components import it, by file URL: one instance of every module. */
const runtime = async () => ({
  ...await import(fileUrl("src/framework/server.ts")) as typeof import("../src/framework/server.ts"),
  ...await import(fileUrl("src/framework/client.ts")) as typeof import("../src/framework/client.ts"),
  ...await import(fileUrl("src/suspense.ts")) as typeof import("../src/suspense.ts"),
});

interface TestComponent extends ClientComponent {
  renderToString(props: Record<string, unknown>): string;
  hydrate(root: Element, props: Record<string, unknown>): () => void;
}

interface DataServer {
  calls: string[];
  signals: AbortSignal[];
  gate: Promise<void> | undefined;
}

const globals = globalThis as unknown as {
  meekoLateData?: DataServer;
  meekoLateFetch?: typeof fetch;
  meekoLog?: string[];
  meekoSocketFactory?: (url: string) => WebSocket;
  window?: unknown;
};

function installDataServer(): DataServer {
  const server: DataServer = { calls: [], signals: [], gate: undefined };
  globals.meekoLateData = server;
  globals.meekoLateFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    server.calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (init?.signal) server.signals.push(init.signal);
    if (server.gate) await server.gate;
    const q = url.searchParams.get("q") ?? "";
    if (q === "boom") return Response.json({ code: "BOOM" }, { status: 500 });
    return Response.json([`${q}1`, `${q}2`]);
  }) as typeof fetch;
  return server;
}

const dataModule = (framework: string): string => `import { createUseApi } from ${framework};
const manifest = { api: [{ clientKey: "notes", pathname: "/api/notes", method: "GET" }], rpc: [] } as const;
const globals = globalThis as unknown as { meekoLateFetch: typeof fetch };
export const useApi = createUseApi(manifest, { baseUrl: "https://example.test", fetch: ((input, init) => globals.meekoLateFetch(input, init)) as typeof fetch });
`;

const notes = `<script lang="ts">
import { onMounted } from "@meekojs/meeko";
import { useApi } from "./data.ts";
const props = defineProps<{ q: string; log: string[] }>();
const notes = await useApi("/api/notes", { query: { q: props.q } });
onMounted(() => { props.log.push(\`mounted:\${props.q}\`); });
</script>
<template><span class="notes">{notes.data.value.join(",")}</span></template>`;

const host = `<script lang="ts">
import { provideErrorHandler, signal } from "@meekojs/meeko";
import * as Notes from "./Notes.meeko";
const props = defineProps<{ log: string[]; errors: string[] }>();
provideErrorHandler((error, source) => { props.errors.push(\`\${source}:\${error instanceof Error ? error.message : String(error)}\`); });
const show = signal(false);
const q = signal("a");
const rows = signal<string[]>([]);
</script>
<template><section><div class="shown" if:when="show.value"><Notes bind:q="q.value" bind:log="props.log" /></div><ul><li each:of="rows.value" each:as="row" each:key="row"><Notes bind:q="row" bind:log="props.log" /></li></ul><button class="toggle" on:click="() => show.value = !show.value">t</button><button class="add" on:click="() => rows.value = [...rows.value, 'r' + rows.value.length]">a</button><button class="boom" on:click="() => q.value = 'boom'">b</button></section></template>`;

const ready = `<script lang="ts">
import { onMounted } from "@meekojs/meeko";
const emit = defineEmits<{ ready: [] }>();
onMounted(() => emit("ready"));
</script>
<template><span>hijo</span></template>`;

const readyParent = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Ready from "./Ready.meeko";
const log = signal<string[]>([]);
const more = signal(false);
</script>
<template><ol><li each:of="log.value" each:as="entry">{entry}</li></ol><Ready on:ready="() => log.value = [...log.value, 'x']" /><p class="summary">{log.value.join(", ") || "vacío"}</p><div if:when="more.value"><Ready on:ready="() => log.value = [...log.value, 'y']" /></div><p class="tail">{log.value.length}</p><button class="more" on:click="() => more.value = true">m</button></template>`;

const plainChild = `<script lang="ts">
const props = defineProps<{ label: string }>();
</script>
<template><b>{props.label}</b></template>`;

const unexposedRef = `<script lang="ts">
import { provideErrorHandler } from "@meekojs/meeko";
import * as Plain from "./Plain.meeko";
const props = defineProps<{ errors: string[] }>();
provideErrorHandler((error, source) => { props.errors.push(\`\${source}:\${error instanceof Error ? error.message : String(error)}\`); });
const kid = await useElementRef("kid");
props.errors.push(\`resolved:\${String(kid)}\`);
</script>
<template><Plain ref:kid bind:label="'k'" /></template>`;

/** Compiles components inside the repository against the source runtime. */
async function load(sources: Record<string, string>): Promise<{ modules: Record<string, TestComponent>; cleanup: () => Promise<void> }> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const directory = await mkdtemp(resolve(".meeko", "late-mount-test-"));
  const target = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  await writeFile(join(directory, "data.ts"), dataModule(target("src/framework.ts")));
  for (const [name, source] of Object.entries(sources)) {
    const code = compile(source, join(directory, `${name}.meeko`)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${target("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko/framework"`, `from ${target("src/framework.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${target("src/index.ts")}`)
      .replaceAll(/from "\.\/(\w+)\.meeko"/g, `from "./$1.ts"`);
    await writeFile(join(directory, `${name}.ts`), code);
  }
  const modules: Record<string, TestComponent> = {};
  for (const name of Object.keys(sources)) modules[name] = await import(pathToFileURL(join(directory, `${name}.ts`)).href) as TestComponent;
  return { modules, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0));
};

type Root = { querySelector(selector: string): { textContent: string | null; click?: () => void } | null; querySelectorAll(selector: string): ArrayLike<{ textContent: string | null }> };

function click(root: Root, selector: string): void {
  (root.querySelector(selector) as unknown as HTMLElement).click();
}

/** Opens a gate that holds every request until the returned function runs. */
function hold(data: DataServer): () => void {
  let open!: () => void;
  data.gate = new Promise((resolve) => { open = resolve; });
  return () => { data.gate = undefined; open(); };
}

async function hydrateHost(modules: Record<string, TestComponent>, window: HappyWindow) {
  const log: string[] = [];
  const errors: string[] = [];
  const root = window.document.createElement("main");
  root.innerHTML = modules["Host"]!.renderToString({ log, errors });
  const release = modules["Host"]!.hydrate(root as unknown as Element, { log, errors });
  return { log, errors, root: root as unknown as Root, release };
}

test("a component that an if: shows later waits for its awaited data in an empty region, then renders and mounts", async () => {
  const data = installDataServer();
  const { modules, cleanup } = await load({ Notes: notes, Host: host });
  const window = new HappyWindow();
  try {
    const { log, errors, root, release } = await hydrateHost(modules, window);
    const open = hold(data);
    click(root, ".toggle");
    assert.equal(root.querySelector(".shown")?.textContent, "", "the region stays empty while the data loads");
    await flush();
    assert.deepEqual(data.calls, ["GET /api/notes?q=a"]);
    assert.equal(root.querySelector(".notes"), null);
    assert.deepEqual(log, [], "nothing mounts before the data arrives");
    open();
    await flush();
    assert.equal(root.querySelector(".notes")?.textContent, "a1,a2");
    assert.deepEqual(log.splice(0), ["mounted:a"]);
    assert.deepEqual(data.calls.splice(0), ["GET /api/notes?q=a"], "the mount reads the loaded data instead of requesting it again");
    assert.deepEqual(errors, []);

    // Shown again: a new instance loads again (there is no application cache outside mountClientApp).
    click(root, ".toggle");
    click(root, ".toggle");
    await flush();
    assert.equal(root.querySelector(".notes")?.textContent, "a1,a2");
    assert.deepEqual(log.splice(0), ["mounted:a"]);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("a new each: row with an awaited component mounts once its data loads", async () => {
  const data = installDataServer();
  const { modules, cleanup } = await load({ Notes: notes, Host: host });
  const window = new HappyWindow();
  try {
    const { log, errors, root, release } = await hydrateHost(modules, window);
    const open = hold(data);
    click(root, ".add");
    await flush();
    assert.equal(root.querySelectorAll("li").length, 1);
    assert.equal(root.querySelectorAll("li")[0]!.textContent, "");
    open();
    await flush();
    assert.equal(root.querySelectorAll("li")[0]!.textContent, "r01,r02");
    click(root, ".add");
    await flush();
    assert.deepEqual([...Array.from(root.querySelectorAll("li"))].map((row) => row.textContent), ["r01,r02", "r11,r12"]);
    assert.deepEqual(log, ["mounted:r0", "mounted:r1"]);
    assert.deepEqual(data.calls, ["GET /api/notes?q=r0", "GET /api/notes?q=r1"]);
    assert.deepEqual(errors, []);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("a failed load of a component that mounts later reaches the nearest provideErrorHandler and leaves the page working", async () => {
  installDataServer();
  const { modules, cleanup } = await load({ Notes: notes, Host: host });
  const window = new HappyWindow();
  try {
    const { log, errors, root, release } = await hydrateHost(modules, window);
    click(root, ".toggle");
    await flush();
    assert.equal(root.querySelector(".notes")?.textContent, "a1,a2");
    // New props that need other data: the child is released and mounts again once they load.
    click(root, ".boom");
    await flush();
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0]!, /^mounted:/);
    assert.equal(root.querySelector(".notes"), null, "the failed child leaves its region empty");
    click(root, ".add");
    await flush();
    assert.equal(root.querySelectorAll("li")[0]!.textContent, "r01,r02", "the rest of the page keeps working");
    assert.deepEqual(log, ["mounted:a", "mounted:r0"]);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("a component released before its data arrives is cancelled without effects", async () => {
  const data = installDataServer();
  const { modules, cleanup } = await load({ Notes: notes, Host: host });
  const window = new HappyWindow();
  try {
    const { log, errors, root, release } = await hydrateHost(modules, window);
    const open = hold(data);
    click(root, ".toggle");
    await flush();
    assert.equal(data.calls.length, 1);
    click(root, ".toggle");
    assert.equal(root.querySelector(".shown"), null);
    assert.equal(data.signals[0]!.aborted, true, "the request is aborted");
    open();
    await flush();
    assert.equal(root.querySelector(".notes"), null);
    assert.deepEqual(log, []);
    assert.deepEqual(errors, []);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("renderToString outside the framework still throws MEEKO_SUSPENDED for a component without its data", async () => {
  installDataServer();
  const { modules, cleanup } = await load({ Notes: notes });
  try {
    const { SuspendedRenderError } = await runtime();
    assert.throws(() => modules["Notes"]!.renderToString({ q: "a", log: [] }), (error: unknown) => error instanceof SuspendedRenderError && error.code === "MEEKO_SUSPENDED");
  } finally {
    await cleanup();
  }
});

test("a child's onMounted runs once its parent has hydrated, so writing parent state never breaks the hydration", async () => {
  const { modules, cleanup } = await load({ Ready: ready, Parent: readyParent });
  const window = new HappyWindow();
  try {
    const root = window.document.createElement("main");
    root.innerHTML = modules["Parent"]!.renderToString({});
    const release = modules["Parent"]!.hydrate(root as unknown as Element, {});
    const view = root as unknown as Root;
    assert.deepEqual(Array.from(view.querySelectorAll("li")).map((row) => row.textContent), ["x"]);
    assert.equal(view.querySelector(".summary")?.textContent, "x");
    assert.equal(view.querySelector(".tail")?.textContent, "1");
    // A later mount defers its callbacks until it has finished too.
    click(view, ".more");
    assert.deepEqual(Array.from(view.querySelectorAll("li")).map((row) => row.textContent), ["x", "y"]);
    assert.equal(view.querySelector(".summary")?.textContent, "x, y");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("await useElementRef on a component without defineExpose rejects with MEEK080 at run time", async () => {
  const { modules, cleanup } = await load({ Plain: plainChild, Unexposed: unexposedRef });
  const window = new HappyWindow();
  try {
    const errors: string[] = [];
    const root = window.document.createElement("main");
    root.innerHTML = modules["Unexposed"]!.renderToString({ errors });
    const release = modules["Unexposed"]!.hydrate(root as unknown as Element, { errors });
    await flush();
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0]!, /^mounted:MEEK080: await useElementRef\("kid"\)/);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("the compiler marks data awaits and the components a template renders", () => {
  const marks = (source: string): string => /export const hasDataAwait[^\n]*\nexport const __meekoChildren[^\n]*/.exec(compile(source, "Marks.meeko").code)![0];
  assert.match(marks(notes), /hasDataAwait: boolean = true;\nexport const __meekoChildren: \(\(\) => readonly unknown\[\]\) \| null = \(\) => \[\];/);
  assert.match(marks(host), /hasDataAwait: boolean = false;[\s\S]*= \(\) => \[Notes\];/);
  const layout = `<script lang="ts">\nconst props = defineProps<{ outlet: unknown }>();\n</script><template><main><component is="props.outlet"></component></main></template>`;
  assert.match(marks(layout), /= \(\) => \[\];/, "a layout's outlet is not a dynamic child");
  const dynamic = `<script lang="ts">\nimport * as A from "./A.meeko";\nconst pick = A;\n</script><template><component is="pick"></component></template>`;
  assert.match(marks(dynamic), /= null;/);
  const browserOnly = `<script lang="ts">\nconst field = await useElementRef("field");\n</script><template><input ref:field></template>`;
  assert.match(marks(browserOnly), /hasDataAwait: boolean = false;/, "a browser await is not a data await");
});

const routes: readonly RouteRecord[] = createRouteManifest([
  { id: "/", file: "Home.meeko", layouts: [] },
  { id: "/live", file: "Live.meeko", layouts: [] },
  { id: "/plain", file: "Plain.meeko", layouts: [] },
]);

const home = `<script lang="ts">
</script>
<template><p class="home">home</p></template>`;

const live = `<script lang="ts">
import { effect, onMounted } from "@meekojs/meeko";
import { useSocketClient } from "@meekojs/meeko/framework";
import { useApi } from "./data.ts";
const g = globalThis as unknown as { meekoLog: string[]; meekoSocketFactory: (url: string) => WebSocket };
g.meekoLog.push("setup");
const chat = typeof window === "undefined" ? undefined : useSocketClient("ws://example.test/chat", { clientToServer: {}, serverToClient: {} }, { webSocketFactory: g.meekoSocketFactory });
effect(() => { g.meekoLog.push("effect"); });
onMounted(() => { g.meekoLog.push("mounted"); });
const notes = await useApi("/api/notes", { query: { q: "live" } });
</script>
<template><p class="live">{notes.data.value.join(",")}:{chat ? chat.state.value : "ssr"}</p></template>`;

const plainPage = `<script lang="ts">
const g = globalThis as unknown as { meekoLog: string[] };
g.meekoLog.push("plain");
</script>
<template><p class="plain">plain</p></template>`;

test("client navigation loads data in a dry pass: no socket, effect, onMounted or continuation runs there, and a page without data awaits skips it", async () => {
  const data = installDataServer();
  const { modules, cleanup } = await load({ Home: home, Live: live, Plain: plainPage });
  const sockets: EventTarget[] = [];
  globals.meekoLog = [];
  globals.meekoSocketFactory = () => {
    const socket = new EventTarget() as EventTarget & { close(): void; readyState: number };
    socket.readyState = 0;
    socket.close = () => {};
    sockets.push(socket);
    return socket as unknown as WebSocket;
  };
  const { createFrameworkHandler, mountClientApp } = await runtime();
  const browser = new HappyWindow({ url: "https://example.test/" });
  try {
    const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file.replace(/\.meeko$/, "")]! });
    browser.document.write(await (await server(new Request("https://example.test/", { headers: { accept: "text/html" } }))).text());
    globals.window = browser;
    const root = browser.document.getElementById("app")! as unknown as Element;
    const app = await mountClientApp({
      routes, root, payload: browser.document.getElementById("meeko-payload")!.textContent!,
      loadPage: async (file) => modules[file.replace(/\.meeko$/, "")]!,
      onNavigationError: (error) => { throw error; },
      browser: browser as unknown as Window,
    });
    assert.equal(await app.navigate("/live"), true);
    await flush();
    assert.equal((root as unknown as Root).querySelector(".live")?.textContent, "live1,live2:connecting");
    assert.equal(sockets.length, 1, "only the mounted page connects");
    const counts = (name: string): number => globals.meekoLog!.filter((entry) => entry === name).length;
    assert.equal(counts("setup"), 4, "two dry passes, the commit render and the hydration");
    assert.equal(counts("effect"), 2, "effects run in the commit render and the hydration, never in a dry pass");
    assert.equal(counts("mounted"), 1);
    assert.deepEqual(data.calls, ["GET /api/notes?q=live"]);

    globals.meekoLog.splice(0);
    assert.equal(await app.navigate("/plain"), true);
    assert.equal((root as unknown as Root).querySelector(".plain")?.textContent, "plain");
    assert.equal(counts("plain"), 2, "no data await: the commit render and the hydration, without a dry pass");
    app.dispose();
  } finally {
    delete globals.window;
    browser.happyDOM.abort();
    await cleanup();
  }
});

test("meeko check: await useElementRef on a component without defineExpose is a type error, and an optional query or input may be left out", { timeout: 120_000 }, async () => {
  const { checkSource } = await import("../src/check.ts");
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko", "late-mount-check-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      types: ["node"],
      paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko/framework": ["../../src/framework.ts"], "@meekojs/meeko": ["../../src/index.ts"] },
    },
  })}\n`);
  await writeFile(join(root, "Plain.meeko"), plainChild);
  await writeFile(join(root, "data.ts"), `import { createApiClient, createUseApi, createUseRpcQuery } from "@meekojs/meeko/framework";
import type { ApiOperation, RpcOperation } from "@meekojs/meeko/framework";
const manifest = {
  api: [{ clientKey: "search", pathname: "/api/search", method: "GET" }, { clientKey: "notes", pathname: "/api/notes", method: "GET" }],
  rpc: [{ id: "stats.get", pathname: "/_meeko/rpc/stats.get" }, { id: "users.get", pathname: "/_meeko/rpc/users.get" }],
} as const;
type ApiContract = {
  search: { get: ApiOperation<undefined, { scope?: string }, undefined, string[]> };
  notes: { get: ApiOperation<undefined, { q: string }, undefined, string[]> };
};
type RpcContract = { "stats.get": RpcOperation<{ scope?: string }, number>; "users.get": RpcOperation<{ id: number }, { name: string }> };
export const api = createApiClient<ApiContract>(manifest);
export const useApi = createUseApi<ApiContract, typeof manifest>(manifest);
export const useRpcQuery = createUseRpcQuery<RpcContract>(manifest);
`);
  const head = `<script lang="ts">\nimport * as Plain from "./Plain.meeko";\nimport { api, useApi, useRpcQuery } from "./data.js";\n`;
  const template = `<template><Plain ref:kid bind:label="'k'" /></template>`;
  const cases = [
    { name: "Optional", source: `${head}const search = await useApi("/api/search");\nconst scoped = useApi("/api/search", { query: { scope: "a" } });\nconst stats = await useRpcQuery("stats.get");\nconst all: Promise<string[]> = api.search.get();\nconst value: number = stats.data.value;\nconst kid = useElementRef("kid");\nconst none: null = kid.value;\n</script>${template.replace("</template>", "<p>{search.data.value.length}{String(scoped)}{value}{String(all)}{String(none)}</p></template>")}`, codes: [] as string[] },
    { name: "Required", source: `${head}const notes = useApi("/api/notes");\nconst user = useRpcQuery("users.get");\nconst sent = api.notes.get();\n</script>${template.replace("</template>", "<p>{String(notes)}{String(user)}{String(sent)}</p></template>")}`, codes: ["TS2554"] },
    { name: "Unexposed", source: `${head}const kid = await useElementRef("kid");\n</script>${template}`, codes: ["MEEK080"], message: /await useElementRef\(\\"kid\\"\) espera el valor del defineExpose de un componente/ },
  ];
  try {
    for (const item of cases) {
      const diagnostics = await checkSource(item.source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
      if (item.codes.length === 0) assert.deepEqual([...codes], [], `${item.name}: ${messages}`);
      for (const code of item.codes) assert.ok(codes.has(code), `${item.name}: ${messages}`);
      if (item.message) assert.match(messages, item.message);
    }
    const required = await checkSource(cases[1]!.source, join(root, "Required.meeko"));
    assert.equal(required.filter((diagnostic) => diagnostic.code === "TS2554").length, 3, JSON.stringify(required));
    // MEEK080 replaces the TypeScript error and points at the `useElementRef` call.
    const unexposed = await checkSource(cases[2]!.source, join(root, "Unexposed.meeko"));
    assert.deepEqual(unexposed.map((diagnostic) => diagnostic.code), ["MEEK080"], JSON.stringify(unexposed));
    assert.equal(unexposed[0]!.location.offset, cases[2]!.source.indexOf("useElementRef(\"kid\")"));
    assert.equal(unexposed[0]!.location.line, 4);
    assert.equal(unexposed[0]!.location.column, "const kid = await ".length + 1);
    assert.doesNotMatch(unexposed[0]!.message, /^MEEK080|not assignable/);
    // `meeko check --json` and the text output report the same code and position.
    const { spawnSync } = await import("node:child_process");
    const file = join(root, "Unexposed.meeko");
    await writeFile(file, cases[2]!.source);
    const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", resolve("src/cli.ts"), "check", file, ...args], { encoding: "utf8" });
    const json = cli("--json");
    assert.equal(json.status, 1, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout), unexposed);
    const text = cli();
    assert.equal(text.status, 1);
    assert.equal(text.stderr, `${file}:4:${"const kid = await ".length + 1} MEEK080: ${unexposed[0]!.message}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the editor rejects await useElementRef on a component without defineExpose", async () => {
  const { createEditorModel } = await import("../src/language-server/model.ts");
  const { default: ts } = await import("@typescript/typescript6");
  const source = `<script lang="ts">
const Plain = { hydrateScope: (() => () => {}) as (scope: object, props: object) => () => void, renderToString: (props: object): string => String(props), renderWithState: (props: object) => ({ html: String(props), state: {} }) };
const value = useElementRef("kid").value;
const kid = await useElementRef("kid");
</script>
<template><Plain ref:kid /><p>{String(value)}{String(kid)}</p></template>`;
  const model = createEditorModel(source, resolve("tests/fixtures/UnexposedModel.meeko"));
  try {
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename).filter((item) => item.code === 1320);
    assert.equal(diagnostics.length, 1);
    assert.equal(model.toSource(diagnostics[0]!.start!), source.indexOf("await useElementRef"));
    assert.equal(diagnostics[0]!.category, ts.DiagnosticCategory.Error);
  } finally {
    model.dispose();
  }
});
