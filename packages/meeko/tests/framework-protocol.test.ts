import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import type { PageRoute } from "../src/framework/server.ts";

const page = (name: string): ClientComponent => ({
  renderWithState: () => ({ html: `<p>${name}</p>`, state: {} }),
  renderToString: () => `<p>${name}</p>`,
  hydrateScope: () => () => {},
});

const routes = createRouteManifest([
  { id: "/a", file: "a.meeko", layouts: [], sidecar: "a.route.ts" },
  { id: "/b", file: "b.meeko", layouts: [], sidecar: "b.route.ts" },
]);
const sidecars: Record<string, PageRoute> = {
  "a.route.ts": { head: () => ({ title: "Page A" }) },
  "b.route.ts": { render: "prerender", head: () => ({ title: "Page <B>" }) },
};
const server = createFrameworkHandler({
  routes,
  loadPage: async (file) => page(file),
  loadRoute: async (file) => sidecars[file]!,
  clientEntry: "/entry.js",
  document: {
    head: '<link rel="modulepreload" href="/chunk.js">',
    bodyEnd: "<!--host-end-->",
    nonce: (request) => request.headers.get("x-test-nonce") ?? undefined,
  },
});

test("the payload carries its protocol version, render mode and head", async () => {
  const response = await server(new Request("https://example.test/b", { headers: { accept: "application/meeko+json" } }));
  assert.deepEqual(await response.json(), {
    v: 2, route: "/b", render: "prerender", props: { params: {}, search: {} }, state: {}, sharedState: {}, head: { title: "Page <B>" },
  });
});

test("document options add host markup and a per-request CSP nonce", async () => {
  const html = await (await server(new Request("https://example.test/a", { headers: { "x-test-nonce": "abc\"123" } }))).text();
  // Host markup follows the head that Meeko manages.
  assert.match(html, /<title>Page A<\/title><!--\/meeko:head--><link rel="modulepreload" href="\/chunk.js"><\/head>/);
  assert.match(html, /<script type="module" nonce="abc&quot;123" src="\/entry.js"><\/script><!--host-end--><\/body>/);
  const plain = await (await server(new Request("https://example.test/a"))).text();
  assert.doesNotMatch(plain, /nonce=/);
});

test("document markup reaches error pages and can use the request nonce", async () => {
  const errorRoutes = createRouteManifest([{ id: "/broken", file: "broken.meeko", layouts: [], sidecar: "broken.route.ts", error: "error.meeko" }]);
  const handler = createFrameworkHandler({
    routes: errorRoutes,
    loadPage: async (file) => page(file),
    loadRoute: async () => ({ load: () => { throw new Error("private failure"); }, head: () => ({ title: "" }) }),
    onError: () => {},
    document: {
      head: ({ nonce }) => `<script nonce="${nonce}">window.host = 1</script>`,
      bodyEnd: "<!--host-end-->",
      nonce: () => "n1",
    },
  });
  const html = await (await handler(new Request("https://example.test/broken"))).text();
  assert.match(html, /<title>Error<\/title><!--\/meeko:head--><script nonce="n1">window.host = 1<\/script><\/head>/);
  assert.match(html, /<!--host-end--><\/body>/);
  assert.doesNotMatch(html, /private failure/);
});

test("an empty page title is emitted the same way by SSR and the payload", async () => {
  const titled = createFrameworkHandler({
    routes: createRouteManifest([{ id: "/", file: "home.meeko", layouts: [], sidecar: "home.route.ts" }]),
    loadPage: async (file) => page(file),
    loadRoute: async () => ({ head: () => ({ title: "" }) }),
  });
  assert.match(await (await titled(new Request("https://example.test/"))).text(), /<title><\/title>/);
  const payload = await (await titled(new Request("https://example.test/", { headers: { accept: "application/meeko+json" } }))).json() as { head: unknown };
  assert.deepEqual(payload.head, { title: "" });
});

test("browser navigation applies the next page title after its commit", async () => {
  const browser = new HappyWindow({ url: "https://example.test/a" });
  browser.document.write(await (await server(new Request("https://example.test/a"))).text());
  const app = await mountClientApp({
    routes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => page(file),
    serverData: true,
    fetch: async (input, init) => server(new Request(new URL(String(input), "https://example.test"), init as RequestInit)),
    browser: browser as unknown as Window,
  });
  assert.equal(browser.document.title, "Page A");
  assert.equal(await app.navigate("/b"), true);
  assert.equal(browser.document.title, "Page <B>");
  app.dispose();
  browser.happyDOM.abort();
});

test("a payload from another protocol version is rejected with a clear message", async () => {
  const browser = new HappyWindow({ url: "https://example.test/a" });
  await assert.rejects(mountClientApp({
    routes,
    root: browser.document.body as unknown as Element,
    payload: { route: "/a", props: { params: {}, search: {} }, state: {} },
    loadPage: async (file) => page(file),
    browser: browser as unknown as Window,
  }), /Unsupported Meeko payload version undefined; the server and browser bundles must come from the same build/);
  browser.happyDOM.abort();
});
