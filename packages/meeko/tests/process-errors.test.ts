import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { initFrameworkProject } from "../src/framework/init.ts";
import { linkRepositoryPackages, repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

/**
 * A Node host as `meeko start` runs it: `serveNode` with `handleSignals`, a runtime `onError` that
 * prints what it observes, and API routes that leave failures outside the request flow.
 */
const serverScript = `import { createServerApp, defineApiRoute, defineServerRuntime } from "@meekojs/meeko/server";
import { serveNode } from "@meekojs/meeko/node";

const route = (name, method = "GET") => ({ kind: "api", file: "/" + name + ".ts", pathname: "/api/" + name, method, clientKey: name });
const manifest = {
  version: 1, routes: [],
  server: { api: [route("ok"), route("reject"), route("crash"), route("slow"), route("background")], rpc: [], socket: [] },
  routeMiddleware: [], serverMiddleware: [],
  client: { entry: "/entry.js", css: [], preload: [] },
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const handler = (run) => ({ default: defineApiRoute({ contentType: "response", handler: run }) });
const modules = {
  "/ok.ts": handler(async () => new Response("ok")),
  // A promise nobody awaits, inside the request's asynchronous work.
  "/reject.ts": handler(async ({ context }) => {
    void sleep(5).then(() => { throw new Error("floating in request"); });
    return Response.json({ requestId: context.requestId });
  }),
  // An exception in a timer the request scheduled.
  "/crash.ts": handler(async () => {
    setTimeout(() => { throw new Error("thrown in timer"); }, 20);
    return new Response("scheduled");
  }),
  "/slow.ts": handler(async () => { await sleep(400); return new Response("slow done"); }),
  "/background.ts": handler(async ({ context }) => {
    context.platform.waitUntil(sleep(300).then(() => console.log("BACKGROUND DONE")));
    return new Response("queued");
  }),
};
const runtime = defineServerRuntime(() => ({
  onError: (error, requestId, info) => console.log("OBSERVED " + JSON.stringify({ message: error instanceof Error ? error.message : String(error), requestId, info: info ?? null })),
  close: () => console.log("RUNTIME CLOSED"),
}));
if (process.env.APP_LISTENER) process.on("uncaughtException", (error) => console.log("APP LISTENER " + error.message));
const app = await createServerApp({ manifest, load: async (key) => modules[key], runtime, production: false });
const server = await serveNode(app, { port: 0, handleSignals: true, shutdownTimeout: 2_000 });
console.log(server.url);
// A rejection outside any request.
setTimeout(() => { void Promise.reject(new Error("floating outside")); }, 50);
`;

interface Running {
  readonly child: ChildProcess;
  readonly origin: string;
  logs(): string;
  /** Resolves once `pattern` appears in the output. */
  waitFor(pattern: RegExp): Promise<RegExpMatchArray>;
}

async function startServer(root: string, env: Record<string, string> = {}): Promise<Running> {
  const child = spawn(process.execPath, [join(root, "server.mjs")], {
    cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const waitFor = (pattern: RegExp): Promise<RegExpMatchArray> => new Promise((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const match = logs.match(pattern);
      if (match) { clearInterval(timer); done(match); }
      else if (Date.now() - start > 20_000) { clearInterval(timer); fail(new Error(`${pattern} did not appear: ${logs}`)); }
    }, 20);
  });
  // The script prints serveNode's url (127.0.0.1); meeko dev listens there too but prints localhost.
  const origin = `http://127.0.0.1:${(await waitFor(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)\n/))[1]}`;
  return { child, origin, logs: () => logs, waitFor };
}

function observed(logs: string): Array<{ message: string; requestId: string; info: { kind: string; inRequest: boolean } | null }> {
  return [...logs.matchAll(/^OBSERVED (.+)$/gm)].map((match) => JSON.parse(match[1]!) as never);
}

async function project(context: { after(fn: () => Promise<void>): void }, children: Array<ChildProcess | undefined>): Promise<string> {
  const root = await tempProject(context, "process-errors", async () => { for (const child of children) await stopChild(child, "SIGTERM"); });
  await linkRepositoryPackages(root);
  await writeFile(join(root, "server.mjs"), serverScript);
  return root;
}

test("serveNode with handleSignals reports unhandled rejections to onError and keeps serving", { timeout: 60_000 }, async (context) => {
  const children: Array<ChildProcess | undefined> = [];
  const root = await project(context, children);
  const running = await startServer(root);
  children.push(running.child);
  // Outside a request: a new ID and inRequest false.
  await running.waitFor(/floating outside/);
  const outside = observed(running.logs()).find((entry) => entry.message === "floating outside");
  assert.ok(outside, running.logs());
  assert.deepEqual(outside.info, { kind: "unhandledRejection", inRequest: false });
  assert.match(outside.requestId, /^[0-9a-f-]{36}$/);
  // Inside a request: the ID of its response.
  const response = await fetch(`${running.origin}/api/reject`);
  assert.equal(response.status, 200);
  const { requestId } = await response.json() as { requestId: string };
  assert.equal(response.headers.get("x-request-id"), requestId);
  await running.waitFor(/floating in request/);
  const inside = observed(running.logs()).find((entry) => entry.message === "floating in request");
  assert.deepEqual(inside, { message: "floating in request", requestId, info: { kind: "unhandledRejection", inRequest: true } });
  // The process is still alive and serving.
  assert.equal(running.child.exitCode, null);
  assert.equal(await (await fetch(`${running.origin}/api/ok`)).text(), "ok");
  assert.doesNotMatch(running.logs(), /RUNTIME CLOSED/);
});

test("an uncaught exception reaches onError and closes the Node server in order with code 1", { timeout: 60_000 }, async (context) => {
  const children: Array<ChildProcess | undefined> = [];
  const root = await project(context, children);
  const running = await startServer(root);
  children.push(running.child);
  const exited = once(running.child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
  // Work in flight when the exception arrives: a slow response and a waitUntil task.
  assert.equal(await (await fetch(`${running.origin}/api/background`)).text(), "queued");
  const slow = fetch(`${running.origin}/api/slow`);
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(await (await fetch(`${running.origin}/api/crash`)).text(), "scheduled");
  const [code] = await exited;
  assert.equal(code, 1, running.logs());
  // The open response finished and the background task ran before the runtime closed.
  const finished = await slow;
  assert.equal(finished.status, 200);
  assert.equal(await finished.text(), "slow done");
  const logs = running.logs();
  const crash = observed(logs).find((entry) => entry.message === "thrown in timer");
  assert.ok(crash, logs);
  // The timer was scheduled by the request, so the runtime still knows it.
  assert.deepEqual(crash.info, { kind: "uncaughtException", inRequest: true });
  assert.ok(logs.indexOf("BACKGROUND DONE") >= 0 && logs.indexOf("BACKGROUND DONE") < logs.indexOf("RUNTIME CLOSED"), logs);
});

async function freePort(): Promise<number> {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

test("meeko dev reports an unhandled rejection of the app and keeps serving", { timeout: 90_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const root = await tempProject(context, "dev-process-errors", () => stopChild(child));
  await initFrameworkProject(root);
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
  await mkdir(join(root, "server", "api"), { recursive: true });
  await writeFile(join(root, "server", "api", "floating.get.ts"), `import { defineApiRoute } from "@meekojs/meeko/server";

export default defineApiRoute({ contentType: "response", async handler({ context }) {
  void Promise.resolve().then(() => { throw new Error("dev floating failure"); });
  return Response.json({ requestId: context.requestId });
} });
`);
  const port = await freePort();
  const hmrPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const running = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "dev", root], {
    cwd: root, env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: "0" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child = running;
  let logs = "";
  running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const waitFor = (pattern: RegExp): Promise<void> => new Promise((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (pattern.test(logs)) { clearInterval(timer); done(); }
      else if (running.exitCode !== null) { clearInterval(timer); fail(new Error(`meeko dev exited: ${logs}`)); }
      else if (Date.now() - start > 30_000) { clearInterval(timer); fail(new Error(`${pattern} did not appear: ${logs}`)); }
    }, 25);
  });
  // meeko dev listens on 127.0.0.1 and prints localhost.
  await waitFor(new RegExp(`http://localhost:${port}\\n`));
  const response = await fetch(`${origin}/api/floating`);
  assert.equal(response.status, 200, logs);
  const { requestId } = await response.json() as { requestId: string };
  // Without an onError in server/runtime.ts, the full error goes to the console with the request ID.
  await waitFor(/dev floating failure/);
  assert.match(logs, new RegExp(`\\[meeko\\] unhandledRejection ${requestId} \\(during a request\\)`));
  assert.equal(running.exitCode, null);
  assert.equal((await fetch(`${origin}/api/floating`)).status, 200);
});

test("an application's own uncaughtException listener decides: Meeko only reports", { timeout: 60_000 }, async (context) => {
  const children: Array<ChildProcess | undefined> = [];
  const root = await project(context, children);
  const running = await startServer(root, { APP_LISTENER: "1" });
  children.push(running.child);
  assert.equal(await (await fetch(`${running.origin}/api/crash`)).text(), "scheduled");
  await running.waitFor(/APP LISTENER thrown in timer/);
  await running.waitFor(/OBSERVED .*thrown in timer/);
  await new Promise((done) => setTimeout(done, 200));
  assert.equal(running.child.exitCode, null, running.logs());
  assert.equal(await (await fetch(`${running.origin}/api/ok`)).text(), "ok");
  assert.doesNotMatch(running.logs(), /RUNTIME CLOSED/);
});

test("handleProcessErrors installs once per application: a second call adds no listener and no second report", async () => {
  const { handleProcessErrors } = await import("../src/framework-server/process-errors.ts");
  const app = { close: async () => {} } as unknown as Parameters<typeof handleProcessErrors>[0];
  const reported: unknown[] = [];
  const existing = new Set(process.listeners("unhandledRejection"));
  const before = existing.size;
  const onError = (error: unknown): void => { reported.push(error); };
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => { warnings.push(message); };
  let first!: () => void;
  let second!: () => void;
  try {
    first = handleProcessErrors(app, { onError });
    // The same options are a plain second holder; different ones are ignored, with a warning.
    handleProcessErrors(app, { onError })();
    assert.deepEqual(warnings, []);
    second = handleProcessErrors(app, { onError: (error) => { reported.push(["second", error]); } });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /handleProcessErrors ya estaba instalado .* se mantienen las de la primera llamada/);
  } finally { console.warn = warn; }
  try {
    const added = process.listeners("unhandledRejection").filter((listener) => !existing.has(listener));
    assert.equal(added.length, 1, "one listener for both calls");
    // Called directly: the test runner's own listener would fail the test on a real event.
    const failure = new Error("floating");
    (added[0] as (reason: unknown, promise: Promise<unknown>) => void)(failure, Promise.resolve());
    assert.deepEqual(reported, [failure], "reported once, by the first installation");
    first();
    first();
    assert.equal(process.listeners("unhandledRejection").length, before + 1, "the other call still holds the listeners");
  } finally { second(); }
  assert.equal(process.listeners("unhandledRejection").length, before, "released with the last holder");
  const again = handleProcessErrors(app, { onError: () => {} });
  assert.equal(process.listeners("unhandledRejection").length, before + 1, "a new installation after the release");
  again();
});
