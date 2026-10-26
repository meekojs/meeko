import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { build } from "vite";
import { bindComponent, renderComponent } from "../src/dom.ts";
import type { Component, DomScope } from "../src/dom.ts";
import type { ReadonlySignal } from "../src/reactivity.ts";
import { mountClientApp, useNavigation } from "../src/framework/client.ts";
import type { ClientComponent, ClientRoute } from "../src/framework/client.ts";
import { definePage } from "../src/framework/page.ts";
import type { PageSchema } from "../src/framework/page.ts";
import { prerenderRoutes } from "../src/framework/prerender.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { RouteRecord } from "../src/framework/router.ts";
import { discoverRoutes, extractRouteRender } from "../src/framework/routes-discovery.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import type { PageRoute } from "../src/framework/server.ts";
import { meeko } from "../src/vite.ts";

const numericId: PageSchema<unknown, { id: string }> = {
  "~standard": {
    version: 1,
    validate: (value) => typeof value === "object" && value !== null && "id" in value && /^\d+$/.test(String(value.id))
      ? { value: { id: String(value.id) } } : { issues: ["invalid id"] },
  },
};

function page(render: (props: Record<string, unknown>) => string, onHydrate?: () => void): ClientComponent {
  return {
    renderWithState: (props) => ({ html: render(props), state: {} }),
    renderToString: render,
    hydrateScope: () => { onHydrate?.(); return () => {}; },
  };
}

function layout(name: string, onHydrate?: () => void): ClientComponent {
  return {
    renderWithState: (props) => ({
      html: `<section data-layout="${name}">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, true)}</section>`,
      state: {},
    }),
    renderToString: (props) =>
      `<section data-layout="${name}">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, false)}</section>`,
    hydrateScope: (scope: DomScope, props) => {
      onHydrate?.();
      return bindComponent(scope, 0, () => props.outlet as Component<Record<string, unknown>>, () => ({}), "layout");
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

interface Fixture {
  routes: readonly RouteRecord[];
  modules: Record<string, ClientComponent>;
  sidecars: Record<string, PageRoute & ClientRoute>;
  serverLoads: string[];
}

function fixture(layouts: readonly string[] = ["shell.meeko"]): Fixture {
  const serverLoads: string[] = [];
  const routes = createRouteManifest([
    { id: "/ssr", file: "ssr.meeko", layouts, sidecar: "ssr.route.ts" },
    { id: "/notes/[id]", file: "note.meeko", layouts, sidecar: "note.route.ts", render: "client", error: "error.meeko" },
  ]);
  const modules: Record<string, ClientComponent> = {
    "ssr.meeko": page((props) => `<p id="ssr">${(props.data as { name: string }).name}</p>`),
    "note.meeko": page((props) => `<p id="note">${(props.data as { text: string }).text}</p>`),
    "error.meeko": page((props) => `<p id="error">${String(props.status)}:${String(props.message)}</p>`),
    "shell.meeko": layout("shell"),
  };
  const sidecars: Record<string, PageRoute & ClientRoute> = {
    "ssr.route.ts": {
      load: () => { serverLoads.push("ssr"); return { name: "Server data" }; },
      head: () => ({ title: "SSR page" }),
    },
    "note.route.ts": definePage({
      render: "client",
      params: numericId,
      load: ({ params, url, signal }) => {
        assert.ok(url instanceof URL);
        assert.ok(signal instanceof AbortSignal);
        if (params.id === "500") throw new Error("private failure");
        return { text: `Note ${params.id}` };
      },
      head: ({ data }) => ({ title: data.text }),
    }) as unknown as PageRoute & ClientRoute,
  };
  return { routes, modules, sidecars, serverLoads };
}

async function boot(f: Fixture, url: string, options: { onError?: (error: unknown) => void } = {}) {
  const server = createFrameworkHandler({
    routes: f.routes,
    loadPage: async (file) => f.modules[file]!,
    loadRoute: async (file) => f.sidecars[file]!,
  });
  const browser = new HappyWindow({ url });
  const response = await server(new Request(url));
  assert.equal(response.status, 200);
  browser.document.write(await response.text());
  const root = browser.document.getElementById("app")!;
  const app = await mountClientApp({
    routes: f.routes,
    root: root as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => f.modules[file]!,
    loadClientRoute: async (file) => f.sidecars[file]!,
    serverData: true,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
    browser: browser as unknown as Window,
    ...(options.onError ? { onNavigationError: options.onError } : {}),
  });
  return { app, browser, root, server };
}

test("definePage accepts render: client with a browser loader context", () => {
  const route = definePage({
    render: "client",
    load: ({ url, params, search, signal, state }) => ({ path: url.pathname, params, search, aborted: signal.aborted, state }),
    head: ({ data }) => ({ title: data.path }),
  });
  assert.equal(route.render, "client");
  assert.throws(() => definePage({ render: "client", prerenderEntries: [{}] } as never), /render: "client" cannot be prerendered/);
  if (false) {
    // @ts-expect-error A client loader runs in the browser and has no Request.
    definePage({ render: "client", load: ({ request }) => request.url });
    // @ts-expect-error A client loader has no server request context.
    definePage({ render: "client", load: ({ context }) => context });
    // @ts-expect-error Client pages cannot be prerendered.
    definePage({ render: "client", prerenderEntries: [{}] });
  }
});

test("render extraction accepts client and discovery rejects prerendering it", async () => {
  const file = "/project/app/pages/index.route.ts";
  assert.equal(extractRouteRender(file, 'export const route = definePage({ render: "client" });\n'), "client");
  const root = await mkdtemp(join(tmpdir(), "meeko-client-render-"));
  try {
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await writeFile(join(root, "app", "pages", "index.meeko"), "<template><p>Home</p></template>");
    await writeFile(join(root, "app", "pages", "index.route.ts"), 'export const route = definePage({ render: "client" });\n');
    assert.equal((await discoverRoutes(root))[0]?.render, "client");
    await writeFile(join(root, "app", "pages", "index.route.ts"), 'export const route = definePage({ render: "client", prerenderEntries: [{}] });\n');
    await assert.rejects(discoverRoutes(root), /index\.route\.ts: una página render: "client" no se puede prerenderizar; quita prerenderEntries o usa render: "prerender"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SSR of a client page renders layouts around an empty outlet without running its loader", async () => {
  let loads = 0;
  const f = fixture();
  f.sidecars["note.route.ts"] = { ...f.sidecars["note.route.ts"]!, load: () => { loads++; return { text: "never" }; } };
  const server = createFrameworkHandler({ routes: f.routes, loadPage: async (file) => f.modules[file]!, loadRoute: async (file) => f.sidecars[file]! });
  const html = await (await server(new Request("https://example.test/notes/7?tab=x"))).text();
  assert.equal(loads, 0);
  assert.match(html, /<div id="app"><section data-layout="shell"><!--meeko:component:0:%7B%7D--><!--\/meeko:component:0--><\/section><\/div>/);
  assert.doesNotMatch(html, /<title>/);
  const payload = JSON.parse(html.match(/<script id="meeko-payload" type="application\/json">(.*?)<\/script>/)![1]!) as Record<string, unknown>;
  assert.equal(payload.render, "client");
  assert.deepEqual(payload.props, { params: { id: "7" }, search: { tab: "x" } });
  assert.deepEqual(payload.head, {});
  const invalid = await server(new Request("https://example.test/notes/nope"));
  assert.equal(invalid.status, 400);
  const bare = fixture([]);
  const bareServer = createFrameworkHandler({ routes: bare.routes, loadPage: async (file) => bare.modules[file]!, loadRoute: async (file) => bare.sidecars[file]! });
  assert.match(await (await bareServer(new Request("https://example.test/notes/7"))).text(), /<div id="app"><\/div>/);
});

test("the server rejects a sidecar whose render no longer matches the built manifest", async () => {
  const failures: unknown[] = [];
  const check = async (manifestRender: RouteRecord["render"], sidecarRender: PageRoute["render"]) => {
    const routes = createRouteManifest([{ id: "/", file: "index.meeko", layouts: [], sidecar: "index.route.ts", ...(manifestRender ? { render: manifestRender } : {}) }]);
    const server = createFrameworkHandler({
      routes,
      loadPage: async () => page(() => "<p>Home</p>"),
      loadRoute: async () => (sidecarRender ? { render: sidecarRender } : {}),
      onError: (error) => failures.push(error),
    });
    return (await server(new Request("https://example.test/"))).status;
  };
  assert.equal(await check("client", undefined), 500);
  assert.equal(await check(undefined, "client"), 500);
  assert.equal(await check("client", "ssr"), 500);
  assert.equal(await check("client", "client"), 200);
  assert.equal(failures.length, 3);
  assert.match(String(failures[0]), /Route \/ declares render "ssr" but its manifest says "client"; rebuild the application/);
  assert.match(String(failures[1]), /Route \/ declares render "client" but its manifest says "ssr"; rebuild the application/);
});

test("prerendering a client page fails with an explicit error", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-client-prerender-"));
  try {
    const routes = createRouteManifest([{ id: "/app", file: "app.meeko", layouts: [], sidecar: "app.route.ts", render: "client" }]);
    await assert.rejects(prerenderRoutes({
      routes, outputRoot: root,
      loadRoute: async () => ({ render: "client", prerenderEntries: [{}] }),
      handler: async () => new Response("<html><head></head></html>", { headers: { "content-type": "text/html" } }),
    }), /Route \/app uses render: "client" and cannot be prerendered/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("first load of a client page hydrates its layout and commits the page from the client loader", async () => {
  const f = fixture();
  const { app, browser, root } = await boot(f, "https://example.test/notes/7");
  const shell = root.querySelector('[data-layout="shell"]');
  assert.ok(shell);
  assert.equal(root.querySelector("#note")?.textContent, "Note 7");
  assert.equal(root.querySelector('[data-layout="shell"]'), shell);
  assert.equal(browser.document.title, "Note 7");
  assert.equal(browser.location.pathname, "/notes/7");
  app.dispose();
  browser.happyDOM.abort();
});

test("first load of a client page without layouts renders into the empty root", async () => {
  const f = fixture([]);
  const { app, browser, root } = await boot(f, "https://example.test/notes/3");
  assert.equal(root.querySelector("#note")?.textContent, "Note 3");
  assert.equal(browser.document.title, "Note 3");
  assert.equal(await app.navigate("/notes/4"), true);
  assert.equal(root.querySelectorAll("#note").length, 1);
  assert.equal(root.querySelector("#note")?.textContent, "Note 4");
  app.dispose();
  browser.happyDOM.abort();
});

test("navigation moves between SSR and client pages in both directions", async () => {
  const f = fixture();
  const { app, browser, root } = await boot(f, "https://example.test/ssr");
  const shell = root.querySelector('[data-layout="shell"]');
  assert.equal(root.querySelector("#ssr")?.textContent, "Server data");
  assert.deepEqual(f.serverLoads, ["ssr"]);
  assert.equal(await app.navigate("/notes/9"), true);
  assert.equal(root.querySelector("#note")?.textContent, "Note 9");
  assert.equal(root.querySelector("#ssr"), null);
  assert.equal(root.querySelector('[data-layout="shell"]'), shell);
  assert.equal(browser.document.title, "Note 9");
  assert.deepEqual(f.serverLoads, ["ssr"], "a client page does not ask the server for data");
  assert.equal(await app.navigate("/ssr"), true);
  assert.equal(root.querySelector("#ssr")?.textContent, "Server data");
  assert.equal(root.querySelector("#note"), null);
  assert.equal(browser.document.title, "SSR page");
  assert.deepEqual(f.serverLoads, ["ssr", "ssr"]);
  app.dispose();
  browser.happyDOM.abort();
});

test("a client loader error renders the nearest error page in the browser", async () => {
  const errors: unknown[] = [];
  const f = fixture();
  const { app, browser, root } = await boot(f, "https://example.test/notes/500", { onError: (error) => errors.push(error) });
  assert.equal(root.querySelector("#error")?.textContent, "500:Internal Server Error");
  assert.ok(root.querySelector('[data-layout="shell"]'));
  assert.match(String(errors[0]), /private failure/);
  assert.equal(await app.navigate("/notes/8"), true);
  assert.equal(root.querySelector("#note")?.textContent, "Note 8");
  assert.equal(root.querySelector("#error"), null);
  assert.equal(await app.navigate("/notes/500"), true);
  assert.equal(browser.location.pathname, "/notes/500");
  assert.equal(root.querySelector("#error")?.textContent, "500:Internal Server Error");
  app.dispose();
  browser.happyDOM.abort();
});

test("useNavigation exposes pending while a navigation loads", async () => {
  const f = fixture();
  let pending: ReadonlySignal<boolean> | undefined;
  f.modules["shell.meeko"] = layout("shell", () => { pending = useNavigation().pending; });
  const gate = deferred<void>();
  const original = f.sidecars["note.route.ts"]!;
  f.sidecars["note.route.ts"] = { ...original, load: async (context) => { await gate.promise; return original.load!(context as never); } };
  const { app, browser, root } = await boot(f, "https://example.test/ssr");
  assert.equal(pending?.value, false);
  const navigation = app.navigate("/notes/5");
  await new Promise((done) => setTimeout(done, 0));
  assert.equal(pending?.value, true);
  gate.resolve();
  assert.equal(await navigation, true);
  assert.equal(pending?.value, false);
  assert.equal(root.querySelector("#note")?.textContent, "Note 5");
  app.dispose();
  browser.happyDOM.abort();
});

test("useNavigation is idle outside a browser application", () => {
  assert.equal(useNavigation().pending.value, false);
});

async function clientBuild(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "meeko-client-sidecar-build-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), content);
    }
    await writeFile(join(root, "entry.ts"), 'import { modules } from "virtual:meeko-client-routes";\nexport default Object.keys(modules);\n');
    const result = await build({
      root, configFile: false, plugins: [meeko()], logLevel: "silent",
      build: { outDir: join(root, "dist"), write: false, minify: false, rollupOptions: { input: join(root, "entry.ts") } },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Array<{ output: Array<{ type: string; code?: string }> }>;
    return outputs.flatMap((entry) => entry.output).map((chunk) => chunk.code ?? "").join("\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("client sidecars enter the client graph and cannot reach server-only modules", { timeout: 60_000 }, async () => {
  const page = "<template><p>Notes</p></template>";
  const bundle = await clientBuild({
    "app/pages/notes.meeko": page,
    "app/pages/notes.route.ts": 'export const route = { render: "client", load: () => ({ text: "ok" }) };\n',
    "app/pages/private.meeko": page,
    "app/pages/private.route.ts": 'import { secret } from "../../server/secret.ts";\nexport const route = { load: () => secret };\n',
    "server/secret.ts": 'export const secret = "private";\n',
  });
  assert.match(bundle, /text: "ok"/);
  assert.doesNotMatch(bundle, /private/, "an SSR sidecar must stay out of the client graph");
  await assert.rejects(clientBuild({
    "app/pages/notes.meeko": page,
    "app/pages/notes.route.ts": 'import { secret } from "../../server/secret.ts";\nexport const route = { render: "client", load: () => ({ secret }) };\n',
    "server/secret.ts": 'export const secret = "private";\n',
  }), /notes\.route\.ts imports server-only module \.\.\/\.\.\/server\/secret\.ts/);
  await assert.rejects(clientBuild({
    "app/pages/notes.meeko": page,
    "app/pages/notes.route.ts": 'export const route = { render: "client", load: () => ({ secret: readSecret() }) };\n',
    "server/utils/secret.ts": 'export function readSecret() { return "private"; }\n',
  }), /notes\.route\.ts.*autoimport readSecret/s);
});
