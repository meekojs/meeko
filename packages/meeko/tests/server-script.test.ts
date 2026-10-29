import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { createServer as createViteServer } from "vite";
import type { ViteDevServer } from "vite";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { analyzeServerScript } from "../src/compiler/server-script.ts";
import { MeekoCompileError, parseSfc } from "../src/compiler/sfc.ts";
import { checkFrameworkProject, prepareFrameworkTypes } from "../src/framework/check-project.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { defer } from "../src/framework/deferred.ts";
import { definePageBody, notFound, redirect, usePage } from "../src/framework/page-body.ts";
import { prerenderRoutes } from "../src/framework/prerender.ts";
import { routeBlockId } from "../src/framework/route-block.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import type { PageRoute } from "../src/framework/server.ts";
import { serverScriptModule } from "../src/framework/server-script.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { meeko } from "../src/vite.ts";

const page = (server: string, script = "", template = "<p>Page</p>") => [
  '<script server lang="ts">',
  server,
  "</script>",
  "",
  '<script lang="ts">',
  script,
  "</script>",
  `<template>${template}</template>`,
  "",
].join("\n");

const file = "/project/app/pages/users/[id].meeko";

function failure(source: string, filename = file): { code: string; text: string } {
  try { compile(source, filename); }
  catch (error) {
    if (!(error instanceof MeekoCompileError)) throw error;
    const { offset } = error.diagnostic.location;
    return { code: error.diagnostic.code, text: source.slice(offset, offset + 24) };
  }
  assert.fail("expected a compile error");
}

function analyze(source: string) {
  return analyzeServerScript(source, file, parseSfc(source, file).server!);
}

test("a block with only route options keeps working as before", () => {
  for (const server of [
    'import { definePage } from "@meekojs/meeko/framework";\nconst cache = new Map();\nexport const route = definePage({ load: () => ({ size: cache.size }) });',
    'export default { render: "prerender" };',
    "function helper() { return 1; }\nexport const route = { load: helper };",
  ]) {
    const source = page(server, "const props = defineProps<{ data: unknown }>();");
    assert.equal(analyze(source).body, false, server);
    assert.equal(serverScriptModule(source, file), undefined);
    assert.doesNotMatch(compile(source, file).code, /__meeko_server|pageData/);
  }
});

test("top-level code is detected by its exports or its request API calls", () => {
  const script = analyze(page('const { params } = usePage();\nexport const user = { id: params.id };\nexport const head = { title: "x" };\nexport const { a, b: [c] } = { a: 1, b: [2] };'));
  assert.equal(script.body, true);
  assert.deepEqual(script.exports.map((binding) => binding.name), ["user", "a", "c"]);
  assert.equal(script.head?.name, "head");
  assert.deepEqual(script.implicit, ["usePage"]);
  // A guard without exports is top-level code too.
  assert.equal(analyze(page('import { redirect as go } from "@meekojs/meeko/framework";\nif (Date.now() < 0) go("/");')).body, true);
  // A user function named like an API is not the API.
  assert.equal(analyze(page('import { redirect } from "./nav.js";\nexport const route = { load: () => redirect() };')).body, false);
});

test("the compiler rejects the combinations top-level code cannot honour", () => {
  const cases: Array<[string, string, string, string?]> = [
    ["MEEK070", 'export const user = 1;\nexport const route = definePage({ load: () => 2 });', "load: () => 2"],
    ["MEEK071", "export const user = 1;\nexport function helper() {}", "export function helper"],
    ["MEEK071", "export const user = 1;\nexport class Box {}", "export class Box"],
    ["MEEK071", 'export const user = 1;\nexport default { render: "ssr" };', "export default"],
    ["MEEK072", 'export const head = { title: "a" };\nexport const route = definePage({ head: () => ({}) });', "head: () => ({})"],
    ["MEEK073", 'export const user = 1;\nexport const route = definePage({ prerenderEntries: async () => [usePage().params] });', "usePage().params"],
    ["MEEK073", 'export const route = definePage({ load: () => notFound() });', "notFound()"],
    // 1.7: Meeko calls these functions to compute the head, after the top-level code has run.
    ["MEEK073", 'export const user = 1;\nexport const head = () => ({ title: usePage().url.pathname });', "usePage().url"],
    ["MEEK073", 'export const user = 1;\nexport const head = (() => { if (!user) notFound(); return {}; }) satisfies object;', "notFound(); return"],
    ["MEEK073", 'useHead(() => ({ title: usePage().url.pathname }));\nexport const user = 1;', "usePage().url"],
    ["MEEK073", 'import { useSeoMeta as seo } from "@meekojs/meeko/framework";\nseo(function () { return { description: usePage().url.href }; });', "usePage().url"],
    ["MEEK074", 'export const user = 1;\nexport const route = definePage({ render: "client" });', 'render: "client"'],
    ["MEEK076", "const shared = { id: 1 };\nexport const user = shared;\nexport const route = definePage({ prerenderEntries: [shared] });", "shared] });"],
  ];
  for (const [code, server, at] of cases) {
    const result = failure(page(server, "const x = 1;"));
    assert.equal(result.code, code, server);
    assert.ok(result.text.startsWith(at.slice(0, 24)), `${code}: ${result.text}`);
  }
  // A helper that the top-level code calls runs while the page does: it may use the request APIs,
  // as may a head computed from values that the top-level code read.
  for (const server of [
    'function read() { return usePage().url.pathname; }\nexport const path = read();',
    'async function guard() { await Promise.resolve(); if (Date.now() < 0) redirect("/"); }\nawait guard();\nexport const ok = true;',
    'const { url } = usePage();\nexport const head = () => ({ title: url.pathname });\nuseHead(() => ({ title: url.pathname }));',
  ]) assert.equal(analyze(page(server)).body, true, server);
  // The client script cannot import the request APIs, nor redeclare an export.
  assert.deepEqual(failure(page("export const user = 1;", 'import { usePage } from "@meekojs/meeko/framework";')).code, "MEEK073");
  assert.deepEqual(failure(page("const x = 2;", 'import { redirect } from "@meekojs/meeko/framework";'), "/project/app/components/Card.meeko").code, "MEEK073");
  const collision = failure(page("export const user = 1;", "const user = signal(0);"));
  assert.equal(collision.code, "MEEK075");
  assert.ok(collision.text.startsWith("user = signal(0)"));
  assert.equal(failure(page("export const user = 1;", 'import { user } from "./other.js";')).code, "MEEK075");
});

test("the compiled page reads each export from props.data and keeps private server code out", () => {
  const source = page(
    'import { secretKey } from "../../../server/keys.js";\nconst token = secretKey();\nexport const user = { id: 1, name: "Ada" };\nexport const head = { title: token };',
    "const name = signal(user.name);",
    "<h1>{user.name}</h1><p>{name.value}</p>",
  );
  const { code } = compile(source, file);
  assert.match(code, /const __meeko_page_data = __meeko\.pageData\(__props\)/);
  assert.match(code, /const user = __meeko_page_data\.user;/);
  assert.match(code, /import type \* as __meeko_server from "\.\/\[id\]\.meeko\.server\.js";/);
  assert.doesNotMatch(code, /secretKey|token|keys\.js/);
});

test("the generated route module runs the code per request and returns only its exports", () => {
  const source = page([
    'import { definePage } from "@meekojs/meeko/framework";',
    'import { find } from "../../../server/users.js";',
    "const { params } = usePage();",
    "const row = await find(params.id);",
    "if (!row) notFound();",
    "export const user = { id: row.id };",
    "export let count = 1;",
    "count++;",
    "export const head = { title: String(row.id) };",
    "interface Row { id: string }",
    'export const route = definePage({ render: "stream" });',
  ].join("\n"));
  const module = serverScriptModule(source, file)!;
  assert.match(module.code, /^async function __meeko_body\(\) \{/);
  assert.match(module.code, /return \{ data: \{ user, count \}, head \};/);
  assert.match(module.code, /import \{ usePage, notFound \} from "@meekojs\/meeko\/framework";/);
  assert.match(module.code, /const __meeko_route = definePage\(\{ render: "stream" \}\);\nexport const route = __meeko_definePageBody\(__meeko_route, __meeko_body, true\);/);
  // Kept code stays on its line: the 8th line of the file holds the same statement.
  const line = (text: string, needle: string) => text.slice(0, text.indexOf(needle)).split("\n").length;
  assert.equal(line(module.code, "const row = await find"), line(source, "const row = await find"));
  assert.equal(line(module.code, "       const user ="), line(source, "export const user ="));
});

function bodyRoute(options: Record<string, unknown> | undefined, body: () => Promise<{ data: Record<string, unknown>; head?: unknown }>, head = false): PageRoute {
  return definePageBody(options, body, head) as PageRoute;
}

const component = (render: (props: Record<string, unknown>) => string): ClientComponent => ({
  renderWithState: (props) => ({ html: render(props), state: {} }),
  renderToString: render,
  hydrateScope: () => () => {},
});

test("the server runs top-level code per request, with usePage, redirect, notFound and head", async () => {
  let runs = 0;
  const routes = createRouteManifest([{ id: "/users/[id]", file: "user.meeko", layouts: [], sidecar: "user.route", error: "error.meeko" }]);
  const route = bodyRoute({
    params: { "~standard": { version: 1, validate: (value: unknown) => ({ value: { id: Number((value as { id: string }).id) } }) } },
  }, async () => {
    runs++;
    const { params, url, request, signal } = usePage() as unknown as { params: { id: number }; url: URL; request: Request; signal: AbortSignal };
    assert.equal(url.pathname, `/users/${params.id}`);
    assert.ok(request instanceof Request && signal instanceof AbortSignal);
    if (params.id === 0) redirect("/users/1", 303);
    if (params.id === 404) notFound();
    const secret = `private-${params.id}`;
    return { data: { user: { id: params.id, name: `User ${params.id}` }, later: Promise.resolve(runs) }, head: () => ({ title: `${secret.length}:${params.id}` }) };
  }, true);
  const handler = createFrameworkHandler({
    routes,
    loadPage: async (key) => key === "error.meeko"
      ? component((props) => `<h1>Error ${String(props.status)} ${String(props.message)}</h1>`)
      : component((props) => `<h1>${(props.data as { user: { name: string } }).user.name}</h1>`),
    loadRoute: async () => route,
  });
  const html = await (await handler(new Request("https://example.test/users/7", { headers: { accept: "text/html" } }))).text();
  assert.match(html, /<title>9:7<\/title>/);
  assert.match(html, /<h1>User 7<\/h1>/);
  assert.doesNotMatch(html, /private-7/);
  const payload = async () => JSON.parse(await (await handler(new Request("https://example.test/users/7", { headers: { accept: "application/meeko+json" } }))).text()) as { props: { data: unknown }; head: unknown };
  const first = await payload();
  // Exactly the exports, with promises awaited; head stays out of the data.
  assert.deepEqual(first.props.data, { user: { id: 7, name: "User 7" }, later: 2 });
  assert.deepEqual(first.head, { title: "9:7" });
  assert.deepEqual((await payload()).props.data, { user: { id: 7, name: "User 7" }, later: 3 });
  const moved = await handler(new Request("https://example.test/users/0", { headers: { accept: "text/html" } }));
  assert.equal(moved.status, 303);
  assert.equal(moved.headers.get("location"), "/users/1");
  const missing = await handler(new Request("https://example.test/users/404", { headers: { accept: "text/html" } }));
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Error 404 NOT_FOUND/);
  const missingData = await handler(new Request("https://example.test/users/404", { headers: { accept: "application/meeko+json" } }));
  assert.equal(missingData.status, 404);
  assert.equal((await missingData.json() as { code: string }).code, "NOT_FOUND");
  // Outside a running page the request APIs fail with MEEK073.
  assert.throws(() => usePage(), /MEEK073/);
  assert.throws(() => redirect("/"), /MEEK073/);
  assert.throws(() => notFound(), /MEEK073/);
});

test("route options and top-level code exclude each other at run time too", () => {
  const body = async () => ({ data: {} });
  assert.throws(() => definePageBody({ load: () => 1 }, body, false), /MEEK070/);
  assert.throws(() => definePageBody({ render: "client" }, body, false), /MEEK074/);
  assert.throws(() => definePageBody({ head: () => ({}) }, body, true), /MEEK072/);
});

test("a non-serializable export fails the response like loader data", async () => {
  const routes = createRouteManifest([{ id: "/", file: "index.meeko", layouts: [], sidecar: "index.route" }]);
  const errors: unknown[] = [];
  const handler = createFrameworkHandler({
    routes, loadPage: async () => component(() => "<p>x</p>"), onError: (error) => errors.push(error),
    loadRoute: async () => bodyRoute(undefined, async () => ({ data: { when: new Date(0) } })),
  });
  const response = await handler(new Request("https://example.test/", { headers: { accept: "application/meeko+json" } }));
  assert.equal(response.status, 500);
  assert.match(String(errors[0]), /Non-plain object/);
});

test("stream pages send deferred exports after the page", async () => {
  const routes = createRouteManifest([{ id: "/", file: "index.meeko", layouts: [], sidecar: "index.route", render: "stream" }]);
  const handler = createFrameworkHandler({
    routes, loadPage: async () => component((props) => `<p>${(props.data as { title: string }).title}</p>`),
    loadRoute: async () => bodyRoute({ render: "stream" }, async () => ({ data: { title: "Post", comments: defer(async () => ["first"]) } })),
  });
  const response = await handler(new Request("https://example.test/", { headers: { accept: "application/meeko+json" } }));
  assert.equal(response.headers.get("content-type"), "application/meeko+ndjson; charset=utf-8");
  const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual((lines[0]!.props as { data: unknown }).data, { title: "Post", comments: null });
  assert.deepEqual(lines[0]!.deferred, [{ id: 0, path: ["data", "comments"], status: "pending" }]);
  assert.deepEqual(lines[1], { deferred: 0, value: ["first"] });
});

test("prerender runs top-level code at build time", async () => {
  const root = await mkdtemp(join(resolve(".meeko"), "server-script-prerender-"));
  let runs = 0;
  const routes = createRouteManifest([{ id: "/", file: "index.meeko", layouts: [], sidecar: "index.route", render: "prerender" }]);
  const route = bodyRoute({ render: "prerender" }, async () => ({ data: { built: ++runs } }));
  try {
    const handler = createFrameworkHandler({ routes, loadPage: async () => component((props) => `<p>built ${String((props.data as { built: number }).built)}</p>`), loadRoute: async () => route });
    await prerenderRoutes({ routes, outputRoot: join(root, "prerender"), loadRoute: async () => route, handler });
    assert.match(await readFile(join(root, "prerender", "index.html"), "utf8"), /built 1/);
    assert.ok(runs >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("client navigation re-runs top-level code and shows the error page for notFound", async () => {
  const browser = new HappyWindow({ url: "https://example.test/users/1" });
  let runs = 0;
  const routes = createRouteManifest([{ id: "/users/[id]", file: "user.meeko", layouts: [], sidecar: "user.route", error: "error.meeko" }]);
  const modules: Record<string, ClientComponent> = {
    "user.meeko": component((props) => `<p>${(props.data as { name: string }).name}:${String((props.data as { runs: number }).runs)}</p>`),
    "error.meeko": component((props) => `<p>Error ${String(props.status)} ${String(props.message)}</p>`),
  };
  const server = createFrameworkHandler({
    routes, loadPage: async (key) => modules[key]!,
    loadRoute: async () => bodyRoute(undefined, async () => {
      const { params } = usePage();
      if (params.id === "404") notFound();
      return { data: { name: `User ${params.id}`, runs: ++runs } };
    }),
  });
  browser.document.write(await (await server(new Request("https://example.test/users/1", { headers: { accept: "text/html" } }))).text());
  const app = await mountClientApp({
    routes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (key) => modules[key]!,
    serverData: true,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
    browser: browser as unknown as Window,
  });
  try {
    assert.equal(await app.navigate("/users/2"), true);
    assert.equal(browser.document.getElementById("app")!.textContent, "User 2:2");
    assert.equal(await app.navigate("/users/1"), true);
    assert.equal(browser.document.getElementById("app")!.textContent, "User 1:3");
    assert.equal(await app.navigate("/users/404"), true);
    assert.equal(browser.document.getElementById("app")!.textContent, "Error 404 NOT_FOUND");
  } finally {
    app.dispose();
    await browser.happyDOM.abort();
  }
});

const errorPage = `<script lang="ts">
export interface Props { status: number; message: string }
const props = defineProps<Props>();
</script>
<template><h1>Error {props.status}: {props.message}</h1></template>
`;

const userPage = `<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
import { userParams } from "../../../shared/schemas/user.js";
import { findUser, hit } from "../../../server/users.js";

const { params } = usePage();
if (params.id === 0) redirect("/users/1");
const row = await findUser(params.id);
if (!row) notFound();
const privateToken = row.secret;
export const user = { id: row.id, name: row.name };
export const visits = hit();
export const head = { title: \`Profile of \${user.name}\` };
export const route = definePage({ params: userParams });
</script>

<script lang="ts">
const label = signal(user.name);
</script>

<template><h1>{user.name}</h1><p>{label.value}:{visits}</p></template>
`;

const schema = `export const userParams = {
  "~standard": {
    version: 1 as const,
    validate: (value: unknown) => {
      const id = (value as { id?: string }).id;
      return id !== undefined && /^\\d+$/.test(id) ? { value: { id: Number(id) } } : { issues: ["id"] };
    },
    types: undefined as { readonly input: unknown; readonly output: { id: number } } | undefined,
  },
};
`;

const users = `let visits = 0;
export function hit(): number { return ++visits; }
export async function findUser(id: number): Promise<{ id: number; name: string; secret: string } | undefined> {
  return id === 404 ? undefined : { id, name: \`User \${id}\`, secret: \`s3cr3t-\${id}\` };
}
`;

async function project(files: Record<string, string>): Promise<string> {
  const base = resolve(".meeko");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "server-script-"));
  await initFrameworkProject(root);
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(resolve("node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

async function devApp(root: string): Promise<{ vite: ViteDevServer; fetch: (path: string, accept?: string) => Promise<Response>; close(): Promise<void> }> {
  await prepareFrameworkTypes(root);
  const vite = await createViteServer({
    root, configFile: false, plugins: [meeko()], logLevel: "silent", appType: "custom",
    ssr: { external: ["@meekojs/meeko"] }, server: { middlewareMode: true, hmr: false, watch: null },
  });
  let app: { fetch(request: Request): Promise<Response>; close(): Promise<void> };
  try {
    const entry = await vite.ssrLoadModule("/.meeko/generated/entry-server.ts") as { createApp(options: { production: boolean }): Promise<typeof app> };
    app = await entry.createApp({ production: false });
  } catch (error) {
    await vite.close();
    throw error;
  }
  return {
    vite,
    fetch: (path, accept = "text/html") => app.fetch(new Request(`http://127.0.0.1${path}`, { headers: { accept } })),
    async close() { await app.close(); await vite.close(); },
  };
}

test("a page with top-level server code renders, navigates, redirects and 404s through Vite", { timeout: 60_000 }, async () => {
  const root = await project({
    "app/error.meeko": errorPage,
    "app/pages/users/[id].meeko": userPage,
    "shared/schemas/user.ts": schema,
    "server/users.ts": users,
  });
  const dev = await devApp(root);
  try {
    const response = await dev.fetch("/users/7");
    const html = await response.text();
    assert.equal(response.status, 200, html);
    assert.match(html, /<title>Profile of User 7<\/title>/);
    assert.match(html, /<h1>(?:<!--[^>]*-->)?User 7/);
    assert.doesNotMatch(html, /s3cr3t|privateToken/);
    const payload = async () => JSON.parse(await (await dev.fetch("/users/7", "application/meeko+json")).text()) as { props: { data: Record<string, unknown> } };
    const first = await payload();
    assert.deepEqual(Object.keys(first.props.data), ["user", "visits"]);
    assert.deepEqual(first.props.data.user, { id: 7, name: "User 7" });
    assert.equal((await payload()).props.data.visits, (first.props.data.visits as number) + 1);
    const moved = await dev.fetch("/users/0");
    assert.equal(moved.status, 302);
    assert.equal(moved.headers.get("location"), "/users/1");
    const missing = await dev.fetch("/users/404");
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Error (?:<!--[^>]*-->)?404(?:<!--[^>]*-->)?: (?:<!--[^>]*-->)?NOT_FOUND/);
    assert.equal((await dev.fetch("/users/abc")).status, 400);

    // Neither the compiled page nor the client graph carry the server code.
    const pageId = join(root, "app", "pages", "users", "[id].meeko");
    const client = await dev.vite.transformRequest(`/app/pages/users/[id].meeko`);
    assert.ok(client);
    assert.doesNotMatch(client.code, /s3cr3t|privateToken|findUser|users\.js|__meeko_server/);
    assert.doesNotMatch(JSON.stringify(client.map ?? {}), /privateToken|findUser/);
    const plugin = meeko();
    (plugin.configResolved as (config: unknown) => void)({ command: "build", build: { ssr: false }, root });
    const load = plugin.load as (this: unknown, id: string, options?: { ssr?: boolean }) => Promise<unknown>;
    await assert.rejects(load.call({ addWatchFile() {} }, routeBlockId(pageId), { ssr: false }), /reached the client bundle/);
  } finally {
    await dev.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("meeko check types exports in the page, rejects misuse and checks usePage against route schemas", { timeout: 180_000 }, async () => {
  const root = await project({
    "app/error.meeko": errorPage,
    "app/pages/users/[id].meeko": userPage,
    "shared/schemas/user.ts": schema,
    "server/users.ts": users,
  });
  const pageFile = join(root, "app", "pages", "users", "[id].meeko");
  try {
    await checkFrameworkProject(root);
    const diagnosticsOf = async (source: string) => {
      await writeFile(pageFile, source);
      return (await checkSource(source, pageFile)).map((diagnostic) => ({ code: diagnostic.code, text: source.slice(diagnostic.location.offset, diagnostic.location.offset + 12), message: diagnostic.message }));
    };
    // A wrong use in the client script: user.name is a string and read-only.
    const wrong = await diagnosticsOf(userPage.replace("const label = signal(user.name);", "const label = signal(user.name);\nconst count: number = user.name;\nfunction rename() { user.name = \"x\"; }"));
    assert.deepEqual(wrong.map((item) => item.code).sort(), ["TS2322", "TS2540"], JSON.stringify(wrong));
    // A non-serializable export is an error on the export.
    const dated = await diagnosticsOf(userPage.replace("export const visits = hit();", "export const visits = hit();\nexport const when = new Date();\nexport const format = () => 1;"));
    assert.deepEqual(dated.map((item) => [item.code, item.text.slice(0, 6)]).sort(), [["TS2344", "format"], ["TS2344", "when =" ]], JSON.stringify(dated));
    assert.match(dated[0]!.message, /not serializable to JSON/);
    // A TrustedHtml export keeps its brand in the template (the payload is JSON; the brand is only
    // a type); a plain string export gets the MEEK107 warning.
    const html = await diagnosticsOf(userPage
      .replace('import { definePage } from "@meekojs/meeko/framework";', 'import { definePage } from "@meekojs/meeko/framework";\nimport { trustHtml } from "@meekojs/meeko";')
      .replace("export const visits = hit();", 'export const visits = hit();\nexport const bio = trustHtml("<p>" + row.name + "</p>");\nexport const raw = "<p>" + row.name + "</p>";')
      .replace("<template><h1>", '<template><div html="bio"></div><div html="raw"></div><h1>'));
    assert.deepEqual(html.map((item) => [item.code, item.text.slice(0, 3)]), [["MEEK107", "raw"]], JSON.stringify(html));
    // A page that still declares data in its props is compared with the exports.
    const declared = (type: string) => userPage.replace("const label = signal(user.name);", `const props = defineProps<{ params: { id: number }; data: { user: { name: ${type} } } }>();\nconst label = signal(user.name);`);
    await writeFile(pageFile, declared("string"));
    await checkFrameworkProject(root);
    await writeFile(pageFile, declared("number"));
    await assert.rejects(checkFrameworkProject(root), /no coinciden con el loader app\/pages\/users\/\[id\]\.meeko <script server>/);
    // usePage() follows the params schema: without it, params.id is a string.
    await writeFile(pageFile, userPage.replace("export const route = definePage({ params: userParams });", "export const route = definePage({});"));
    await assert.rejects(checkFrameworkProject(root), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[id\]\.meeko\(7,5\): error TS2367|\[id\]\.meeko\(8,\d+\): error TS2345/);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
