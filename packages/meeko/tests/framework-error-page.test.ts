import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { bindComponent, renderComponent } from "../src/dom.ts";
import type { Component, DomScope } from "../src/dom.ts";
import { href } from "../src/framework.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { clientRoutesSource, discoverAppManifest } from "../src/framework/app-manifest.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { ErrorPageRecord } from "../src/framework/router.ts";
import { discoverErrorPage, discoverRoutes } from "../src/framework/routes-discovery.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import type { PageModule } from "../src/framework/server.ts";
import { createServerApp } from "../src/framework-server/app.ts";

async function project(files: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeko-error-page-"));
  for (const file of files) {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "");
  }
  return root;
}

const page = (render: (props: Record<string, unknown>) => string): ClientComponent => ({
  renderWithState: (props) => ({ html: render(props), state: {} }),
  renderToString: render,
  hydrateScope: () => () => {},
});

const layout = (name: string, released: string[] = []): ClientComponent => ({
  renderWithState: (props) => ({
    html: `<section data-layout="${name}">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, true)}</section>`,
    state: {},
  }),
  renderToString: (props) => `<section data-layout="${name}">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, false)}</section>`,
  hydrateScope: (scope: DomScope, props) => {
    const stop = bindComponent(scope, 0, () => props.outlet as Component<Record<string, unknown>>, () => ({}), "layout");
    return () => { stop(); released.push(name); };
  },
});

const errorPage: ErrorPageRecord = { file: "error.meeko", layouts: ["app.meeko", "default.meeko"] };

function fixture() {
  const modules: Record<string, ClientComponent> = {
    "app.meeko": layout("app"),
    "default.meeko": layout("default"),
    "home.meeko": page(() => `<p id="home">${href("/users/[id]", { params: { id: "a b" } })}</p>`),
    "user.meeko": page((props) => `<p id="user">${(props.params as Record<string, string>).id}</p>`),
    "error.meeko": page((props) => `<p id="error">${String(props.status)}:${String(props.message)}</p>`),
  };
  const routes = createRouteManifest([
    { id: "/", file: "home.meeko", layouts: ["app.meeko", "default.meeko"], error: "error.meeko" },
    { id: "/users/[id]", file: "user.meeko", layouts: ["app.meeko", "default.meeko"], error: "error.meeko" },
  ]);
  const server = createFrameworkHandler({ routes, errorPage, loadPage: async (file) => modules[file]!, clientEntry: "/client.js" });
  return { modules, routes, server };
}

test("href(id) uses the manifest of the running application and keeps the explicit form", async () => {
  const routes = createRouteManifest([{ id: "/users/[id]", file: "user.meeko", layouts: [] }, { id: "/", file: "home.meeko", layouts: [], sidecar: "home.route.ts" }]);
  assert.equal(href(routes, "/users/[id]", { params: { id: "a" }, search: { tab: "x" } }), "/users/a?tab=x");
  assert.throws(() => href("/users/[id]", { params: { id: "a" } }), /href\(id\) needs a running Meeko application/);
  const seen: string[] = [];
  const handler = createFrameworkHandler({
    routes,
    loadRoute: async () => ({
      load: async () => { await Promise.resolve(); seen.push(href("/users/[id]", { params: { id: "loader" } })); return { ok: true }; },
      head: () => ({ title: href("/") }),
    }),
    loadPage: async () => ({ renderWithState: () => ({ html: `<a href="${href("/users/[id]", { params: { id: "render" } })}">x</a>`, state: {} }) }),
  });
  const html = await (await handler(new Request("https://example.test/"))).text();
  assert.deepEqual(seen, ["/users/loader"]);
  assert.match(html, /href="\/users\/render"/);
  assert.match(html, /<title>\/<\/title>/);
  // Each handler serves its own manifest, also concurrently.
  const other = createFrameworkHandler({
    routes: createRouteManifest([{ id: "/", file: "home.meeko", layouts: [] }]),
    loadPage: async () => ({ renderWithState: () => { href("/users/[id]", { params: { id: "x" } }); return { html: "", state: {} }; } }),
  });
  assert.equal((await other(new Request("https://example.test/"))).status, 500);
  assert.throws(() => href("/"), /needs a running Meeko application/);
});

test("href(id) resolves in the browser while the app is mounted", async () => {
  const { modules, routes, server } = fixture();
  const browser = new HappyWindow({ url: "https://example.test/" });
  browser.document.write(await (await server(new Request("https://example.test/"))).text());
  assert.match(browser.document.getElementById("home")!.textContent, /\/users\/a%20b/);
  const app = await mountClientApp({
    routes, errorPage,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    browser: browser as unknown as Window,
  });
  assert.equal(href("/"), "/");
  app.dispose();
  assert.throws(() => href("/"), /needs a running Meeko application/);
  browser.happyDOM.abort();
});

test("app/error.meeko backs routes without +error.meeko and conflicts with app/pages/+error.meeko", async () => {
  const root = await project([
    "app/app.meeko", "app/layouts/default.meeko", "app/error.meeko",
    "app/pages/index.meeko", "app/pages/blog/+error.meeko", "app/pages/blog/post.meeko",
  ]);
  try {
    const routes = await discoverRoutes(root);
    assert.equal(routes.find((route) => route.id === "/")?.error, join(root, "app/error.meeko"));
    assert.equal(routes.find((route) => route.id === "/blog/post")?.error, join(root, "app/pages/blog/+error.meeko"));
    assert.deepEqual(await discoverErrorPage(root), {
      file: join(root, "app/error.meeko"),
      layouts: [join(root, "app/app.meeko"), join(root, "app/layouts/default.meeko")],
    });
    const { manifest, modules } = await discoverAppManifest(root, { entry: "/client.js", css: [], preload: [] });
    assert.deepEqual(manifest.errorPage, { file: "/app/error.meeko", layouts: ["/app/app.meeko", "/app/layouts/default.meeko"] });
    assert.ok(modules.includes("/app/error.meeko"));
    assert.match(await clientRoutesSource(root), /export const errorPage = \{"file":"\/app\/error\.meeko","layouts":\["\/app\/app\.meeko","\/app\/layouts\/default\.meeko"\]\};/);
    await writeFile(join(root, "app/pages/+error.meeko"), "");
    await assert.rejects(discoverRoutes(root), /error\.meeko y .*\+error\.meeko definen los dos la página de error raíz/);
    await assert.rejects(discoverErrorPage(root), /la página de error raíz/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("app/error.meeko wraps in a root +layout.meeko and is absent without the file", async () => {
  const root = await project(["app/pages/+layout.meeko", "app/pages/index.meeko"]);
  try {
    assert.equal(await discoverErrorPage(root), undefined);
    assert.match(await clientRoutesSource(root), /export const errorPage = undefined;/);
    const { manifest } = await discoverAppManifest(root, { entry: "/client.js", css: [], preload: [] });
    assert.equal("errorPage" in manifest, false);
    await writeFile(join(root, "app/error.meeko"), "");
    assert.deepEqual((await discoverErrorPage(root))?.layouts, [join(root, "app/pages/+layout.meeko")]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a page request without a route renders app/error.meeko inside the root layouts with status 404", async () => {
  const { server } = fixture();
  const html = await server(new Request("https://example.test/missing", { headers: { accept: "text/html,application/xhtml+xml" } }));
  assert.equal(html.status, 404);
  assert.match(html.headers.get("content-type") ?? "", /^text\/html/);
  const body = await html.text();
  assert.match(body, /<section data-layout="app">.*<section data-layout="default">.*<p id="error">404:NOT_FOUND<\/p>/s);
  const payload = JSON.parse(/<script id="meeko-payload" type="application\/json">(.*?)<\/script>/.exec(body)![1]!) as Record<string, unknown>;
  assert.equal(payload.error, true);
  assert.equal(payload.render, "ssr");
  assert.deepEqual(payload.props, { status: 404, message: "NOT_FOUND" });
  // Titled like the error document of a matched route, in the markup and in the payload head.
  assert.match(body, /<head>.*<title>Error<\/title>.*<\/head>/s);
  assert.deepEqual(payload.head, { title: "Error" });
  assert.match(body, /src="\/client.js"/);

  const navigation = await server(new Request("https://example.test/missing", { headers: { accept: "application/meeko+json" } }));
  assert.equal(navigation.status, 404);
  assert.match(navigation.headers.get("content-type") ?? "", /^application\/meeko\+json/);
  assert.deepEqual((await navigation.json() as { props: unknown }).props, { status: 404, message: "NOT_FOUND" });

  const head = await server(new Request("https://example.test/missing", { method: "HEAD", headers: { accept: "text/html" } }));
  assert.equal(head.status, 404);
  assert.equal(await head.text(), "");

  for (const [path, accept] of [["/missing.js", "*/*"], ["/api/missing", "text/html"], ["/_meeko/missing", "text/html"]] as const) {
    const plain = await server(new Request(`https://example.test${path}`, { headers: { accept } }));
    assert.equal(plain.status, 404);
    assert.equal(await plain.text(), "Not Found", path);
  }
});

test("without app/error.meeko a URL without a route keeps the plain 404", async () => {
  const handler = createFrameworkHandler({ routes: createRouteManifest([{ id: "/", file: "home.meeko", layouts: [] }]), loadPage: async () => { throw new Error("no page"); } });
  const response = await handler(new Request("https://example.test/missing", { headers: { accept: "text/html" } }));
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not Found");
});

test("a failing route without +error.meeko renders app/error.meeko and the nearest +error wins", async () => {
  const modules: Record<string, PageModule> = {
    "broken.meeko": { renderWithState: () => { throw new Error("private failure"); } },
    "error.meeko": { renderWithState: (props) => ({ html: `<h1>app:${String(props.status)}</h1>`, state: {} }) },
    "+error.meeko": { renderWithState: (props) => ({ html: `<h1>nearest:${String(props.status)}</h1>`, state: {} }) },
  };
  const handler = createFrameworkHandler({
    routes: createRouteManifest([
      { id: "/broken", file: "broken.meeko", layouts: [] },
      { id: "/nested/broken", file: "broken.meeko", layouts: [], error: "+error.meeko" },
    ]),
    errorPage: { file: "error.meeko", layouts: [] },
    loadPage: async (file) => modules[file]!,
    onError: () => {},
  });
  const fallback = await handler(new Request("https://example.test/broken"));
  assert.equal(fallback.status, 500);
  const body = await fallback.text();
  assert.match(body, /app:500/);
  assert.doesNotMatch(body, /private failure/);
  assert.match(await (await handler(new Request("https://example.test/nested/broken"))).text(), /nearest:500/);
});

test("createServerApp passes the manifest error page to the page handler", async () => {
  const modules: Record<string, unknown> = {
    "/app/error.meeko": { renderWithState: (props: Record<string, unknown>) => ({ html: `<p>${String(props.status)}</p>`, state: {} }) },
    "/app/pages/index.meeko": { renderWithState: () => ({ html: "<p>home</p>", state: {} }) },
  };
  const app = await createServerApp({
    manifest: {
      version: 1, routes: [{ id: "/", file: "/app/pages/index.meeko", layouts: [] }],
      errorPage: { file: "/app/error.meeko", layouts: [] },
      server: { api: [], rpc: [] }, routeMiddleware: [], serverMiddleware: [],
      client: { entry: "/client.js", css: [], preload: [] },
    },
    load: async (key) => modules[key],
    production: false,
  });
  try {
    const response = await app.fetch(new Request("https://example.test/nope", { headers: { accept: "text/html" } }));
    assert.equal(response.status, 404);
    assert.match(await response.text(), /<p>404<\/p>/);
  } finally {
    await app.close();
  }
});

test("the browser hydrates a 404 page, keeps its layouts into a route and loads other missing URLs as documents", async () => {
  const { modules, routes, server } = fixture();
  const browser = new HappyWindow({ url: "https://example.test/missing" });
  browser.document.write(await (await server(new Request("https://example.test/missing", { headers: { accept: "text/html" } }))).text());
  const root = browser.document.getElementById("app")!;
  const shell = root.querySelector('[data-layout="default"]');
  const requests: string[] = [];
  const assigned: string[] = [];
  Object.defineProperty(browser.location, "assign", { configurable: true, value: (url: string) => { assigned.push(String(url)); } });
  const app = await mountClientApp({
    routes, errorPage,
    root: root as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    serverData: true,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(String(input));
      return server(new Request(input, init));
    }) as typeof fetch,
    browser: browser as unknown as Window,
  });
  assert.equal(root.querySelector("#error")?.textContent, "404:NOT_FOUND");
  assert.equal(await app.navigate("/users/7"), true);
  assert.equal(root.querySelector("#user")?.textContent, "7");
  assert.equal(root.querySelector('[data-layout="default"]'), shell);
  // A missing URL may belong to a server handler: no probe request, a document load.
  assert.equal(await app.navigate("/another/missing"), false);
  assert.deepEqual(assigned, ["https://example.test/another/missing"]);
  assert.equal(root.querySelector("#user")?.textContent, "7");
  assert.deepEqual(requests, ["https://example.test/users/7"]);
  app.dispose();
  browser.happyDOM.abort();
});

test("a static host's 404.html hydrates at any missing URL and navigates in the client with payload files", async () => {
  const { modules, routes, server } = fixture();
  // A static host answers 404.html, rendered once at build, for every missing file: here a URL
  // that matches the dynamic route /users/[id] but whose page was not prerendered.
  const notFound = await (await server(new Request("https://example.test/404.html", { headers: { accept: "text/html" } }))).text();
  const browser = new HappyWindow({ url: "https://example.test/users/zz" });
  browser.document.write(notFound);
  const root = browser.document.getElementById("app")!;
  const shell = root.querySelector('[data-layout="default"]');
  const requests: string[] = [];
  const assigned: string[] = [];
  Object.defineProperty(browser.location, "assign", { configurable: true, value: (url: string) => { assigned.push(String(url)); } });
  // The host: each prerendered page's payload as a file; any other file is 404.html.
  const host = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.pathname + url.search);
    const page = /^(.*)\/index\.meeko\.json$/.exec(url.pathname)?.[1] || "/";
    if (page === "/users/7") {
      const payload = await server(new Request(new URL(page, url), { headers: { accept: "application/meeko+json" } }));
      return new Response(await payload.text(), { headers: { "content-type": "application/json" } });
    }
    return new Response(notFound, { status: 404, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const app = await mountClientApp({
    routes, errorPage,
    root: root as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    serverData: "static",
    fetch: host,
    browser: browser as unknown as Window,
  });
  assert.equal(root.querySelector("#error")?.textContent, "404:NOT_FOUND");
  assert.equal(await app.navigate("/users/7?tab=x"), true);
  assert.equal(root.querySelector("#user")?.textContent, "7");
  assert.equal(root.querySelector('[data-layout="default"]'), shell, "the layouts stay mounted");
  // A route URL whose payload file is missing shows the error page in the client.
  assert.equal(await app.navigate("/users/8"), true);
  assert.equal(root.querySelector("#error")?.textContent, "404:NOT_FOUND");
  assert.deepEqual(requests, ["/users/7/index.meeko.json", "/users/8/index.meeko.json"]);
  assert.deepEqual(assigned, []);
  app.dispose();
  browser.happyDOM.abort();
});

test("links without a route are left to the browser, so server handlers run once and may redirect anywhere", async () => {
  const { modules, routes, server } = fixture();
  const browser = new HappyWindow({ url: "https://example.test/" });
  browser.document.write(await (await server(new Request("https://example.test/"))).text());
  const root = browser.document.getElementById("app")!;
  const assigned: string[] = [];
  const fetched: string[] = [];
  Object.defineProperty(browser.location, "assign", { configurable: true, value: (url: string) => { assigned.push(String(url)); } });
  const app = await mountClientApp({
    routes, errorPage,
    root: root as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    serverData: true,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetched.push(String(input));
      return server(new Request(input, init));
    }) as typeof fetch,
    browser: browser as unknown as Window,
  });
  const click = (path: string): boolean => {
    const anchor = browser.document.createElement("a");
    anchor.setAttribute("href", path);
    root.append(anchor);
    const event = new browser.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    anchor.dispatchEvent(event);
    anchor.remove();
    return event.defaultPrevented;
  };
  assert.equal(click("/files/report.pdf"), false);
  assert.equal(click("/api/export"), false);
  assert.equal(click("/auth/github"), false);
  assert.equal(click("/nowhere"), false);
  assert.equal(await app.navigate("/auth/login"), false);
  assert.deepEqual(assigned, ["https://example.test/auth/login"]);
  assert.deepEqual(fetched, []);
  app.dispose();
  browser.happyDOM.abort();
});

test("without errorPage the browser leaves URLs without a route to the document load", async () => {
  const { modules, routes, server } = fixture();
  const browser = new HappyWindow({ url: "https://example.test/" });
  browser.document.write(await (await server(new Request("https://example.test/"))).text());
  const app = await mountClientApp({
    routes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    browser: browser as unknown as Window,
  });
  assert.equal(await app.navigate("/missing"), false);
  assert.equal(browser.location.pathname, "/");
  app.dispose();
  // An error payload cannot hydrate without the error page.
  const missing = new HappyWindow({ url: "https://example.test/missing" });
  const html = await (await server(new Request("https://example.test/missing", { headers: { accept: "text/html" } }))).text();
  missing.document.write(html);
  await assert.rejects(mountClientApp({
    routes,
    root: missing.document.getElementById("app") as unknown as Element,
    payload: missing.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    browser: missing as unknown as Window,
  }), /hydration mismatch/);
  missing.happyDOM.abort();
  browser.happyDOM.abort();
});

test("a client loader without +error.meeko falls back to app/error.meeko in the browser", async () => {
  const modules: Record<string, ClientComponent> = {
    "app.meeko": layout("app"),
    "default.meeko": layout("default"),
    "home.meeko": page(() => "<p>home</p>"),
    "note.meeko": page(() => "<p>note</p>"),
    "error.meeko": page((props) => `<p id="error">${String(props.status)}:${String(props.message)}</p>`),
  };
  const routes = createRouteManifest([
    { id: "/", file: "home.meeko", layouts: ["app.meeko", "default.meeko"] },
    { id: "/note", file: "note.meeko", layouts: ["app.meeko", "default.meeko"], sidecar: "note.route.ts", render: "client" },
  ]);
  const server = createFrameworkHandler({ routes, errorPage, loadPage: async (file) => modules[file]! });
  const browser = new HappyWindow({ url: "https://example.test/" });
  browser.document.write(await (await server(new Request("https://example.test/"))).text());
  const app = await mountClientApp({
    routes, errorPage,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    loadClientRoute: async () => ({ load: () => { throw new Error("private"); } }),
    onNavigationError: () => {},
    browser: browser as unknown as Window,
  });
  assert.equal(await app.navigate("/note"), true);
  assert.equal(browser.document.getElementById("error")?.textContent, "500:Internal Server Error");
  app.dispose();
  browser.happyDOM.abort();
});

test("page contracts check app/error.meeko props", async () => {
  const root = await project(["app/pages/index.meeko"]);
  try {
    await writeFile(join(root, "app/error.meeko"), "");
    const { generatePageContracts } = await import("../src/framework/page-contracts-generate.ts");
    const output = await readFile(await generatePageContracts(root), "utf8");
    assert.match(output, /__CheckShell<import\("\.\.\/\.\.\/app\/error\.meeko"\)\.ComponentProps, \{ status: number; message: string \}, "app\/error\.meeko", "Las props de la página de error">/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
