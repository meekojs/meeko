import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { bindComponent, renderComponent } from "../src/dom.ts";
import type { Component, DomScope } from "../src/dom.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent, ClientRoute } from "../src/framework/client.ts";
import { definePageBody, notFound } from "../src/framework/page-body.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { ErrorPageRecord } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import type { PageRoute } from "../src/framework/server.ts";

const page = (render: (props: Record<string, unknown>) => string): ClientComponent => ({
  renderWithState: (props) => ({ html: render(props), state: {} }),
  renderToString: render,
  hydrateScope: () => () => {},
});

const layout: ClientComponent = {
  renderWithState: (props) => ({
    html: `<section data-layout="app">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, true)}</section>`,
    state: {},
  }),
  renderToString: (props) => `<section data-layout="app">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, false)}</section>`,
  hydrateScope: (scope: DomScope, props) => bindComponent(scope, 0, () => props.outlet as Component<Record<string, unknown>>, () => ({}), "layout"),
};

const modules: Record<string, ClientComponent> = {
  "app.meeko": layout,
  "titled.meeko": page(() => '<p id="titled">titled</p>'),
  "plain.meeko": page(() => '<p id="plain">plain</p>'),
  "note.meeko": page(() => '<p id="note">note</p>'),
  "error.meeko": page((props) => `<p id="error">${String(props.status)}:${String(props.message)}</p>`),
  "gone.meeko": page(() => '<p id="gone">gone</p>'),
  "lost.meeko": page(() => '<p id="lost">lost</p>'),
  "+error.meeko": page((props) => `<p id="route-error">${String(props.status)}:${String(props.message)}</p>`),
};

/** A `<script server>` whose top-level code calls notFound(). */
const missing = (): PageRoute & ClientRoute => definePageBody(undefined, async () => notFound(), false) as PageRoute & ClientRoute;

const sidecars: Record<string, PageRoute & ClientRoute> = {
  "titled.route.ts": { head: () => ({ title: "Titled" }) },
  "note.route.ts": { render: "client", load: () => { throw new Error("private"); } } as PageRoute & ClientRoute,
  "gone.route.ts": missing(),
  "lost.route.ts": missing(),
};

const routes = createRouteManifest([
  { id: "/titled", file: "titled.meeko", layouts: ["app.meeko"], sidecar: "titled.route.ts" },
  { id: "/plain", file: "plain.meeko", layouts: ["app.meeko"] },
  { id: "/note", file: "note.meeko", layouts: ["app.meeko"], sidecar: "note.route.ts", render: "client" },
  { id: "/gone", file: "gone.meeko", layouts: ["app.meeko"], sidecar: "gone.route.ts" },
  { id: "/lost", file: "lost.meeko", layouts: ["app.meeko"], sidecar: "lost.route.ts", error: "+error.meeko" },
]);
const errorPage: ErrorPageRecord = { file: "error.meeko", layouts: ["app.meeko"] };

function handler(hostHead: string | undefined) {
  return createFrameworkHandler({
    routes, errorPage,
    loadPage: async (file) => modules[file]!,
    loadRoute: async (file) => sidecars[file]!,
    ...(hostHead === undefined ? {} : { document: { head: hostHead } }),
  });
}

/** document.title of the SSR document for `url`, as a full page load shows it. */
async function ssrTitle(server: ReturnType<typeof handler>, url: string): Promise<string> {
  const browser = new HappyWindow({ url });
  browser.document.write(await (await server(new Request(url, { headers: { accept: "text/html" } }))).text());
  const title = browser.document.title;
  browser.happyDOM.abort();
  return title;
}

async function mount(server: ReturnType<typeof handler>, url: string, mode: "server" | "browser") {
  const browser = new HappyWindow({ url });
  browser.document.write(await (await server(new Request(url, { headers: { accept: "text/html" } }))).text());
  const app = await mountClientApp({
    routes, errorPage,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    loadClientRoute: async (file) => sidecars[file]!,
    ...(mode === "server"
      ? { serverData: true, fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch }
      : { loadRoute: async (file: string) => sidecars[file]! }),
    onNavigationError: () => {},
    browser: browser as unknown as Window,
  });
  return { app, browser };
}

test("navigating to a page without head.title restores the host document title", async () => {
  const server = handler("<title>Site</title>");
  assert.equal(await ssrTitle(server, "https://example.test/titled"), "Titled");
  assert.equal(await ssrTitle(server, "https://example.test/plain"), "Site");
  const { app, browser } = await mount(server, "https://example.test/titled", "server");
  assert.equal(browser.document.title, "Titled");
  assert.equal(await app.navigate("/plain"), true);
  assert.equal(browser.document.getElementById("plain")?.textContent, "plain");
  assert.equal(browser.document.title, "Site");
  assert.equal(await app.navigate("/titled"), true);
  assert.equal(browser.document.title, "Titled");
  // A failing browser loader shows app/error.meeko with the title of an SSR error document.
  assert.equal(await app.navigate("/note"), true);
  assert.equal(browser.document.getElementById("error")?.textContent, "500:Internal Server Error");
  assert.equal(browser.document.title, "Error");
  assert.equal(await app.navigate("/plain"), true);
  assert.equal(browser.document.title, "Site");
  app.dispose();
  browser.happyDOM.abort();
});

test("without a host title, a page without head.title leaves the document untitled", async () => {
  const server = handler(undefined);
  assert.equal(await ssrTitle(server, "https://example.test/plain"), "");
  const { app, browser } = await mount(server, "https://example.test/titled", "server");
  assert.equal(browser.document.title, "Titled");
  assert.equal(await app.navigate("/plain"), true);
  assert.equal(browser.document.title, "");
  app.dispose();
  browser.happyDOM.abort();
});

test("the 404 page from app/error.meeko takes the title of its SSR document", async () => {
  for (const host of ["<title>Site</title>", undefined]) {
    const server = handler(host);
    const untitled = host === undefined ? "" : "Site";
    // Like the error document of a matched route, the 404 document is titled "Error".
    assert.equal(await ssrTitle(server, "https://example.test/missing"), "Error");
    const { app, browser } = await mount(server, "https://example.test/titled", "browser");
    assert.equal(browser.document.title, "Titled");
    assert.equal(await app.navigate("/missing"), true);
    assert.equal(browser.document.getElementById("error")?.textContent, "404:NOT_FOUND");
    assert.equal(browser.document.title, "Error");
    assert.equal(await app.navigate("/plain"), true);
    assert.equal(browser.document.title, untitled);
    app.dispose();
    browser.happyDOM.abort();
    // Hydrated from the 404 document, the host title follows the "Error" title.
    const fromMissing = await mount(server, "https://example.test/missing", "browser");
    assert.equal(fromMissing.browser.document.title, "Error");
    assert.equal(await fromMissing.app.navigate("/titled"), true);
    assert.equal(fromMissing.browser.document.title, "Titled");
    assert.equal(await fromMissing.app.navigate("/plain"), true);
    assert.equal(fromMissing.browser.document.title, untitled);
    fromMissing.app.dispose();
    fromMissing.browser.happyDOM.abort();
  }
});

test("notFound() after a browser navigation shows the error page with the title of its SSR document", async () => {
  for (const host of ["<title>Site</title>", undefined]) {
    const server = handler(host);
    const untitled = host === undefined ? "" : "Site";
    // The SSR error document of a matched route is titled "Error", before the host markup.
    assert.equal(await ssrTitle(server, "https://example.test/gone"), "Error");
    assert.equal(await ssrTitle(server, "https://example.test/lost"), "Error");
    const { app, browser } = await mount(server, "https://example.test/titled", "server");
    // app/error.meeko backs a route without +error.meeko.
    assert.equal(await app.navigate("/gone"), true);
    assert.equal(browser.document.getElementById("error")?.textContent, "404:NOT_FOUND");
    assert.equal(browser.document.title, "Error");
    assert.equal(await app.navigate("/plain"), true);
    assert.equal(browser.document.title, untitled);
    // The route's own +error.meeko.
    assert.equal(await app.navigate("/lost"), true);
    assert.equal(browser.document.getElementById("route-error")?.textContent, "404:NOT_FOUND");
    assert.equal(browser.document.title, "Error");
    assert.equal(await app.navigate("/titled"), true);
    assert.equal(browser.document.title, "Titled");
    // A URL without a route has the same title in its hydratable 404 document.
    assert.equal(await ssrTitle(server, "https://example.test/missing"), "Error");
    app.dispose();
    browser.happyDOM.abort();
  }
});
