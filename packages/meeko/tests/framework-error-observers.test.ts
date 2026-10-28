import assert from "node:assert/strict";
import test from "node:test";
import { defer } from "../src/framework/deferred.ts";
import { definePlugin } from "../src/framework/plugin.ts";
import type { PluginErrorInfo } from "../src/framework/plugin.ts";
import { createServerApp, defineServerRuntime } from "../src/framework-server.ts";
import type { AppManifest, ServerApp } from "../src/framework-server.ts";

// Page failures through the whole server application: the nearest +error.meeko renders, and the
// `onError` of server/runtime.ts and the plugins' `app.onError` observe the private error with the
// request ID of the response, for SSR, `render: "stream"` and its rejected deferred values.

const manifest: AppManifest = {
  version: 1,
  routes: [
    { id: "/ssr", file: "/app/pages/ssr.meeko", layouts: [], error: "/app/pages/+error.meeko" },
    { id: "/stream", file: "/app/pages/stream.meeko", layouts: [], sidecar: "/app/pages/stream.route.ts", render: "stream", error: "/app/pages/+error.meeko" },
    { id: "/stream-broken", file: "/app/pages/ssr.meeko", layouts: [], sidecar: "/app/pages/stream-broken.route.ts", render: "stream", error: "/app/pages/+error.meeko" },
  ],
  server: { api: [], rpc: [], socket: [] },
  routeMiddleware: [],
  serverMiddleware: [],
  client: { entry: "/assets/entry.js", css: [], preload: [] },
};

interface Slow { readonly status: string; readonly error?: { readonly code: string } }

const modules: Record<string, unknown> = {
  "/app/pages/ssr.meeko": { renderWithState: () => { throw new Error("private render failure"); } },
  "/app/pages/stream.meeko": {
    renderWithState: (props: { data: { slow: Slow } }) => ({ html: `<p id="slow">${props.data.slow.status}</p>`, state: {} }),
  },
  "/app/pages/+error.meeko": {
    renderWithState: (props: { status: number; message: string }) => ({ html: `<h1 id="error">${props.status} ${props.message}</h1>`, state: {} }),
  },
  "/app/pages/stream.route.ts": { route: { render: "stream", load: () => ({ slow: defer(new Promise((_resolve, reject) => setTimeout(() => reject(new Error("private deferred failure")), 5))) }) } },
  "/app/pages/stream-broken.route.ts": { route: { render: "stream", load: () => ({ slow: defer(Promise.resolve("never shown")) }) } },
};

async function fixture(): Promise<{ app: ServerApp; host: Array<{ message: string; requestId: string; info: unknown }>; plugin: Array<{ message: string; info: PluginErrorInfo }> }> {
  const host: Array<{ message: string; requestId: string; info: unknown }> = [];
  const plugin: Array<{ message: string; info: PluginErrorInfo }> = [];
  const app = await createServerApp({
    manifest, production: false, load: async (key) => modules[key],
    runtime: defineServerRuntime(() => ({
      onError: (error, requestId, info) => { host.push({ message: (error as Error).message, requestId, info }); },
    })),
    plugins: [{ plugin: definePlugin((setup) => { setup.onError((error, info) => { plugin.push({ message: (error as Error).message, info }); }); }) }],
  });
  return { app, host, plugin };
}

test("an SSR render failure shows +error.meeko and reaches onError and app.onError with the response's request ID", async () => {
  const { app, host, plugin } = await fixture();
  const response = await app.fetch(new Request("http://local.test/ssr", { headers: { accept: "text/html" } }));
  assert.equal(response.status, 500);
  const html = await response.text();
  assert.match(html, /<h1 id="error">500 Internal Server Error<\/h1>/);
  assert.doesNotMatch(html, /private render failure/);
  const requestId = response.headers.get("x-request-id")!;
  assert.deepEqual(host, [{ message: "private render failure", requestId, info: undefined }]);
  assert.deepEqual(plugin, [{ message: "private render failure", info: { side: "server", requestId } }]);
  await app.close();
});

test("a render: \"stream\" page that fails before the first byte shows +error.meeko and reaches both observers", async () => {
  const { app, host, plugin } = await fixture();
  const response = await app.fetch(new Request("http://local.test/stream-broken", { headers: { accept: "text/html" } }));
  assert.equal(response.status, 500);
  assert.match(await response.text(), /<h1 id="error">500 Internal Server Error<\/h1>/);
  const requestId = response.headers.get("x-request-id")!;
  assert.deepEqual(host.map((entry) => [entry.message, entry.requestId]), [["private render failure", requestId]]);
  assert.deepEqual(plugin, [{ message: "private render failure", info: { side: "server", requestId } }]);
  await app.close();
});

test("a rejected deferred value of a stream reaches both observers, in the document and in a navigation", async () => {
  const { app, host, plugin } = await fixture();
  const document = await app.fetch(new Request("http://local.test/stream", { headers: { accept: "text/html" } }));
  assert.equal(document.status, 200);
  const html = await document.text();
  assert.match(html, /data-meeko-deferred="0">\{"deferred":0,"error":\{"code":"INTERNAL_ERROR","status":500\}\}/);
  assert.doesNotMatch(html, /private deferred failure/);
  const navigation = await app.fetch(new Request("http://local.test/stream", { headers: { accept: "application/meeko+json" } }));
  assert.match(navigation.headers.get("content-type") ?? "", /^application\/meeko\+ndjson/);
  const lines = (await navigation.text()).split("\n").filter(Boolean);
  assert.deepEqual(JSON.parse(lines.at(-1)!), { deferred: 0, error: { code: "INTERNAL_ERROR", status: 500 } });
  const ids = [document.headers.get("x-request-id")!, navigation.headers.get("x-request-id")!];
  assert.deepEqual(host.map((entry) => [entry.message, entry.requestId]), ids.map((id) => ["private deferred failure", id]));
  assert.deepEqual(plugin, ids.map((requestId) => ({ message: "private deferred failure", info: { side: "server", requestId } })));
  await app.close();
});
