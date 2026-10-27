import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { bindComponent, renderComponent } from "../src/dom.ts";
import type { Component, DomScope } from "../src/dom.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { definePageBody } from "../src/framework/page-body.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import type { PageRoute } from "../src/framework/server.ts";

const page = (id: string): ClientComponent => ({
  renderWithState: () => ({ html: `<p id="${id}">${id}</p>`, state: {} }),
  renderToString: () => `<p id="${id}">${id}</p>`,
  hydrateScope: () => () => {},
});

const layout: ClientComponent = {
  renderWithState: (props) => ({ html: `<main>${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, true)}</main>`, state: {} }),
  renderToString: (props) => `<main>${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, false)}</main>`,
  hydrateScope: (scope: DomScope, props) => bindComponent(scope, 0, () => props.outlet as Component<Record<string, unknown>>, () => ({}), "layout"),
};

const modules: Record<string, ClientComponent> = { "app.meeko": layout, "guide.meeko": page("guide"), "plain.meeko": page("plain"), "body.meeko": page("body") };

const sidecars: Record<string, PageRoute> = {
  "guide.route.ts": { head: () => ({ title: "Guía", description: "Cómo empezar <rápido> & bien" }) },
  // `export const head` of top-level server code carries the description too.
  "body.route.ts": definePageBody(undefined, async () => ({ data: {}, head: { title: "Cuerpo", description: "Desde el bloque" } }), true) as PageRoute,
};

const routes = createRouteManifest([
  { id: "/guide", file: "guide.meeko", layouts: ["app.meeko"], sidecar: "guide.route.ts" },
  { id: "/plain", file: "plain.meeko", layouts: ["app.meeko"] },
  { id: "/body", file: "body.meeko", layouts: ["app.meeko"], sidecar: "body.route.ts" },
]);

function handler(hostHead?: string) {
  return createFrameworkHandler({
    routes,
    loadPage: async (file) => modules[file]!,
    loadRoute: async (file) => sidecars[file]!,
    ...(hostHead === undefined ? {} : { document: { head: hostHead } }),
  });
}

const descriptions = (document: HappyWindow["document"]): Array<string | null> =>
  [...document.head.querySelectorAll('meta[name="description"]')].map((meta) => meta.getAttribute("content"));

async function mount(server: ReturnType<typeof handler>, url: string) {
  const browser = new HappyWindow({ url });
  browser.document.write(await (await server(new Request(url, { headers: { accept: "text/html" } }))).text());
  const app = await mountClientApp({
    routes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    serverData: true,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
    onNavigationError: () => {},
    browser: browser as unknown as Window,
  });
  return { app, browser };
}

test("head.description renders an escaped meta tag after the title in SSR", async () => {
  const response = await handler()(new Request("https://example.test/guide", { headers: { accept: "text/html" } }));
  const html = await response.text();
  assert.match(html, /<title>Guía<\/title><meta name="description" content="Cómo empezar &lt;rápido&gt; &amp; bien">/);
  const plain = await (await handler()(new Request("https://example.test/plain", { headers: { accept: "text/html" } }))).text();
  assert.doesNotMatch(plain, /name="description"/);
  const body = await (await handler()(new Request("https://example.test/body", { headers: { accept: "text/html" } }))).text();
  assert.match(body, /<title>Cuerpo<\/title><meta name="description" content="Desde el bloque">/);
  const data = await (await handler()(new Request("https://example.test/guide", { headers: { accept: "application/meeko+json" } }))).json() as { head: unknown };
  assert.deepEqual(data.head, { title: "Guía", description: "Cómo empezar <rápido> & bien" });
});

test("client navigation updates, removes and restores the description", async () => {
  const server = handler();
  const { app, browser } = await mount(server, "https://example.test/guide");
  assert.deepEqual(descriptions(browser.document), ["Cómo empezar <rápido> & bien"]);
  assert.equal(await app.navigate("/plain"), true);
  assert.deepEqual(descriptions(browser.document), [], "a page without description leaves none");
  assert.equal(await app.navigate("/body"), true);
  assert.deepEqual(descriptions(browser.document), ["Desde el bloque"]);
  assert.equal(browser.document.head.querySelector("title + meta")?.getAttribute("name"), "description");
  app.dispose();
  browser.happyDOM.abort();

  // With a host description, a page without one shows the host's again.
  const hosted = handler('<meta name="description" content="Sitio">');
  const second = await mount(hosted, "https://example.test/guide");
  assert.deepEqual(descriptions(second.browser.document), ["Cómo empezar <rápido> & bien", "Sitio"]);
  assert.equal(await second.app.navigate("/plain"), true);
  assert.equal(descriptions(second.browser.document)[0], "Sitio");
  assert.equal(await second.app.navigate("/guide"), true);
  assert.equal(descriptions(second.browser.document)[0], "Cómo empezar <rápido> & bien");
  second.app.dispose();
  second.browser.happyDOM.abort();
});
