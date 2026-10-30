import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { composeServerMiddleware, defineServerMiddleware } from "../src/framework-server/middleware.ts";
import { mountClientApp } from "../src/framework/client.ts";
import { defineRouteMiddleware } from "../src/framework/middleware.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

test("server middleware composes in filename order and can stop an HTTP request", async () => {
  const calls: string[] = [];
  const handler = composeServerMiddleware([
    defineServerMiddleware(async (request, next) => {
      calls.push("first:before");
      const response = await next(request);
      calls.push("first:after");
      return new Response(response.body, { status: response.status, headers: { "x-first": "yes" } });
    }),
    defineServerMiddleware((request, next) => {
      calls.push("second");
      return new URL(request.url).pathname === "/blocked" ? new Response("blocked", { status: 403 }) : next();
    }),
  ], async () => { calls.push("handler"); return new Response("ok"); });
  const blocked = await handler(new Request("https://example.test/blocked"));
  assert.equal(blocked.status, 403);
  assert.equal(await blocked.text(), "blocked");
  assert.equal(blocked.headers.get("x-first"), "yes");
  assert.deepEqual(calls, ["first:before", "second", "first:after"]);
  calls.length = 0;
  assert.equal((await handler(new Request("https://example.test/open"))).status, 200);
  assert.deepEqual(calls, ["first:before", "second", "handler", "first:after"]);
});

test("server middleware observes a downstream failure even when next is not awaited", async () => {
  const handler = composeServerMiddleware([
    defineServerMiddleware((_request, next) => {
      void next();
      return new Response("outer");
    }),
  ], async () => { throw new Error("downstream failed"); });
  await assert.rejects(handler(new Request("https://example.test/")), /downstream failed/);
});

test("server middleware retains both its own failure and an unawaited downstream failure", async () => {
  const handler = composeServerMiddleware([
    defineServerMiddleware((_request, next) => {
      void next();
      throw new Error("middleware failed");
    }),
  ], async () => { throw new Error("downstream failed"); });
  await assert.rejects(handler(new Request("https://example.test/")), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.match(String(error.errors[0]), /middleware failed/);
    assert.match(String(error.errors[1]), /downstream failed/);
    return true;
  });
});

test("route middleware runs before the SSR loader and blocks browser navigation", async () => {
  const routes = createRouteManifest([
    { id: "/", file: "index.meeko", layouts: [] },
    { id: "/private", file: "private.meeko", layouts: [], sidecar: "private.route.ts" },
  ]);
  const calls: string[] = [];
  const page = {
    renderWithState: () => ({ html: "<p>Home</p>", state: {} }),
    renderToString: () => "<p>Home</p>",
    hydrateScope: () => () => {},
  };
  const guard = defineRouteMiddleware(({ match, phase, request }) => {
    calls.push(`${phase}:${match.route.id}`);
    if (phase === "server") assert.ok(request);
    else assert.equal(request, undefined);
    if (match.route.id === "/private") return new Response("denied", { status: 403 });
  });
  const server = createFrameworkHandler({
    routes, loadPage: async () => page,
    loadRoute: async () => ({ load: () => { calls.push("loader"); return { secret: true }; } }),
    loadMiddleware: async () => [guard],
  });
  const blocked = await server(new Request("https://example.test/private"));
  assert.equal(blocked.status, 403);
  assert.equal(await blocked.text(), "denied");
  assert.deepEqual(calls, ["server:/private"]);
  const browser = new HappyWindow({ url: "https://example.test/" });
  browser.document.write(await (await server(new Request("https://example.test/"))).text());
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async () => page,
    loadMiddleware: async () => [guard],
    onNavigationError: (error) => errors.push(error),
    browser: browser as unknown as Window,
  });
  assert.equal(await app.navigate("/private"), false);
  assert.equal(browser.location.pathname, "/");
  assert.equal(browser.document.querySelector("p")?.textContent, "Home");
  assert.match(String(errors[0]), /HTTP 403/);
  assert.deepEqual(calls, ["server:/private", "server:/", "client:/private"]);
  browser.history.replaceState(null, "", "/private");
  browser.dispatchEvent(new browser.Event("popstate"));
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(browser.location.pathname, "/");
  assert.equal(browser.document.querySelector("p")?.textContent, "Home");
  app.dispose();
  browser.happyDOM.abort();
});

test("generated starter discovers app and server middleware in development", { timeout: 35_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const root = await tempProject(context, "starter-middleware", () => stopChild(child));
  const repository = repositoryRoot;
  await initFrameworkProject(root);
  await mkdir(join(root, "app", "middleware"), { recursive: true });
  await mkdir(join(root, "server", "middleware"), { recursive: true });
  await writeFile(join(root, "app", "middleware", "guard.ts"), "import { defineRouteMiddleware } from '@meekojs/meeko/framework';\nexport default defineRouteMiddleware(({ url }) => url.searchParams.has('deny') ? new Response('route denied', { status: 403 }) : undefined);\n");
  await writeFile(join(root, "server", "middleware", "headers.ts"), "import { defineServerMiddleware } from '@meekojs/meeko/server';\nexport default defineServerMiddleware(async (request, next) => { const response = await next(); response.headers.set('x-test-middleware', new URL(request.url).pathname); return response; });\n");
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  const portServer = createServer();
  portServer.listen(0, "127.0.0.1");
  await once(portServer, "listening");
  const address = portServer.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  portServer.close();
  await once(portServer, "close");
  const origin = `http://127.0.0.1:${port}`;
  const running = spawn(process.execPath, [join(repository, "dist", "cli.js"), "dev", root], {
    cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "";
  child = running;
  running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  await new Promise<void>((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (logs.includes(`http://localhost:${port}\n`)) { clearInterval(timer); done(); }
      else if (running.exitCode !== null) { clearInterval(timer); fail(new Error(logs)); }
      else if (Date.now() - start > 20_000) { clearInterval(timer); fail(new Error(`Starter did not listen: ${logs}`)); }
    }, 25);
  });
  const ok = await fetch(origin);
  assert.equal(ok.status, 200, logs);
  assert.equal(ok.headers.get("x-test-middleware"), "/");
  const blocked = await fetch(origin + "/?deny=1");
  assert.equal(blocked.status, 403, logs);
  assert.equal(await blocked.text(), "route denied");
  assert.equal(blocked.headers.get("x-test-middleware"), "/");
});
