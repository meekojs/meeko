import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { bindComponent, renderComponent } from "../src/dom.ts";
import type { Component, DomScope } from "../src/dom.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { discoverConfiguredRoutes } from "../src/framework/config.ts";
import { composeFrameworkRoutes } from "../src/framework/modules.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";

async function page(root: string, path: string): Promise<void> {
  const filename = join(root, "app/pages", path);
  await mkdir(dirname(filename), { recursive: true });
  await writeFile(filename, "<template><p>Route</p></template>");
}

test("explicit app, layer and module routes compose without overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-layers-"));
  const app = join(root, "app");
  const layer = join(root, "layer");
  try {
    await page(app, "index.meeko");
    await page(layer, "help.meeko");
    const routes = await composeFrameworkRoutes({
      projectRoot: app,
      layers: [{ name: "help", root: layer }],
      modules: [{
        name: "account",
        routes: () => [{ id: "/account", file: "virtual:account", layouts: [] }],
      }],
    });
    assert.deepEqual(new Set(routes.map((route) => route.id)), new Set(["/", "/help", "/account"]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("layer collisions and duplicate source identifiers fail visibly", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-layers-"));
  const app = join(root, "app");
  const layer = join(root, "layer");
  try {
    await page(app, "users/[id].meeko");
    await page(layer, "users/[name].meeko");
    await assert.rejects(composeFrameworkRoutes({
      projectRoot: app,
      layers: [{ name: "users", root: layer }],
    }), /Route collision/);
    await assert.rejects(composeFrameworkRoutes({
      projectRoot: app,
      layers: [{ name: "same", root: layer }, { name: "same", root: layer }],
    }), /duplicate route source name/);
    await assert.rejects(composeFrameworkRoutes({
      projectRoot: app,
      layers: [{ name: "same", root: app }],
    }), /Duplicate route root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function file(root: string, path: string, source = "<template><p>File</p></template>"): Promise<void> {
  const filename = join(root, path);
  await mkdir(dirname(filename), { recursive: true });
  await writeFile(filename, source);
}

test("layer pages render inside the project's shell and fall back to its error page", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-layer-shell-"));
  const docs = join(root, "layers", "docs");
  const full = join(root, "layers", "full");
  try {
    for (const path of ["app/app.meeko", "app/layouts/default.meeko", "app/error.meeko", "app/pages/index.meeko"]) await file(root, path);
    for (const path of ["app/pages/+layout.meeko", "app/pages/help.meeko", "app/pages/guide/+layout.meeko", "app/pages/guide/+error.meeko", "app/pages/guide/intro.meeko"]) {
      await file(docs, path);
    }
    // A layer's own shell and root layout give way to the project's; its app/error.meeko still backs its pages.
    for (const path of ["app/app.meeko", "app/layouts/default.meeko", "app/error.meeko", "app/pages/full.meeko"]) await file(full, path);
    const routes = await composeFrameworkRoutes({ projectRoot: root, layers: [{ name: "docs", root: docs }, { name: "full", root: full }] });
    const byId = new Map(routes.map((route) => [route.id, route]));
    const shell = [join(root, "app", "app.meeko"), join(root, "app", "layouts", "default.meeko")];
    assert.deepEqual(byId.get("/")?.layouts, shell);
    assert.deepEqual(byId.get("/help")?.layouts, [...shell, join(docs, "app", "pages", "+layout.meeko")]);
    assert.equal(byId.get("/help")?.error, join(root, "app", "error.meeko"));
    assert.deepEqual(byId.get("/guide/intro")?.layouts, [...shell, join(docs, "app", "pages", "+layout.meeko"), join(docs, "app", "pages", "guide", "+layout.meeko")]);
    assert.equal(byId.get("/guide/intro")?.error, join(docs, "app", "pages", "guide", "+error.meeko"));
    assert.deepEqual(byId.get("/full")?.layouts, shell);
    assert.equal(byId.get("/full")?.error, join(full, "app", "error.meeko"));
    // Without a project shell, a layer keeps its own app shell and root layout.
    await rm(join(root, "app", "app.meeko"));
    await rm(join(root, "app", "layouts"), { recursive: true });
    await rm(join(root, "app", "error.meeko"));
    await file(root, "app/pages/+layout.meeko");
    await file(root, "app/pages/+error.meeko");
    const bare = new Map((await composeFrameworkRoutes({ projectRoot: root, layers: [{ name: "docs", root: docs }, { name: "full", root: full }] })).map((route) => [route.id, route]));
    assert.deepEqual(bare.get("/full")?.layouts, [join(full, "app", "app.meeko"), join(root, "app", "pages", "+layout.meeko")]);
    assert.deepEqual(bare.get("/help")?.layouts, [join(root, "app", "pages", "+layout.meeko"), join(docs, "app", "pages", "+layout.meeko")]);
    // The project's root app/pages/+error.meeko backs layer pages like app/error.meeko.
    assert.equal(bare.get("/help")?.error, join(root, "app", "pages", "+error.meeko"));
    // Configured layers and modules receive the same shell.
    await file(root, "meeko.config.mjs", `export default { extends: ["./layers/docs"], modules: ["./layers/full"] };`);
    const configured = new Map((await discoverConfiguredRoutes(root)).map((route) => [route.id, route]));
    assert.deepEqual(configured.get("/help")?.layouts, bare.get("/help")?.layouts);
    assert.deepEqual(configured.get("/full")?.layouts, bare.get("/full")?.layouts);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const component = (render: (props: Record<string, unknown>) => string): ClientComponent => ({
  renderWithState: (props) => ({ html: render(props), state: {} }),
  renderToString: render,
  hydrateScope: () => () => {},
});

const layout = (name: string): ClientComponent => ({
  renderWithState: (props) => ({
    html: `<section data-layout="${name}">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, true)}</section>`,
    state: {},
  }),
  renderToString: (props) => `<section data-layout="${name}">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, false)}</section>`,
  hydrateScope: (scope: DomScope, props) => bindComponent(scope, 0, () => props.outlet as Component<Record<string, unknown>>, () => ({}), "layout"),
});

test("SSR and client navigation keep the project's layouts around a layer page", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-layer-render-"));
  const layer = join(root, "layers", "docs");
  try {
    for (const path of ["app/app.meeko", "app/layouts/default.meeko", "app/pages/index.meeko"]) await file(root, path);
    for (const path of ["app/pages/+layout.meeko", "app/pages/help.meeko"]) await file(layer, path);
    const routes = await composeFrameworkRoutes({ projectRoot: root, layers: [{ name: "docs", root: layer }] });
    const modules: Record<string, ClientComponent> = {
      [join(root, "app", "app.meeko")]: layout("app"),
      [join(root, "app", "layouts", "default.meeko")]: layout("default"),
      [join(root, "app", "pages", "index.meeko")]: component(() => '<p id="home">home</p>'),
      [join(layer, "app", "pages", "+layout.meeko")]: layout("layer"),
      [join(layer, "app", "pages", "help.meeko")]: component(() => '<p id="help">help</p>'),
    };
    const server = createFrameworkHandler({ routes, loadPage: async (key) => modules[key]! });
    const html = await (await server(new Request("https://example.test/help", { headers: { accept: "text/html" } }))).text();
    assert.match(html, /<section data-layout="app">.*<section data-layout="default">.*<section data-layout="layer">.*<p id="help">help<\/p>/s);
    const browser = new HappyWindow({ url: "https://example.test/" });
    browser.document.write(await (await server(new Request("https://example.test/", { headers: { accept: "text/html" } }))).text());
    const root$ = browser.document.getElementById("app")!;
    const app = await mountClientApp({
      routes,
      root: root$ as unknown as Element,
      payload: browser.document.getElementById("meeko-payload")!.textContent!,
      loadPage: async (key) => modules[key]!,
      serverData: true,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
      browser: browser as unknown as Window,
    });
    const shell = root$.querySelector('[data-layout="default"]');
    assert.ok(shell);
    assert.equal(await app.navigate("/help"), true);
    assert.equal(root$.querySelector('[data-layout="default"]'), shell);
    assert.equal(root$.querySelector('[data-layout="default"] [data-layout="layer"] #help')?.textContent, "help");
    assert.equal(await app.navigate("/"), true);
    assert.equal(root$.querySelector('[data-layout="default"]'), shell);
    assert.equal(root$.querySelector('[data-layout="layer"]'), null);
    assert.equal(root$.querySelector("#home")?.textContent, "home");
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
