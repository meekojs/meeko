import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import WebSocket from "ws";
import { prepareFrameworkTypes } from "../src/framework/check-project.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { buildProject } from "../src/framework/project.ts";
import type { ServerLogBatch } from "../src/framework/dev-server-logs.ts";
import { repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

/** Text that only the development server logs put in a response or a bundle. */
const devMarkers = /meeko:server-logs|data-meeko-server-logs|devServerLogs|startServerLogs|meeko\.server-logs/;

const files: Record<string, string> = {
  "shared/schemas/echo.ts": `type Echo = { text: string };
export const echoSchema = { "~standard": { version: 1 as const, vendor: "test", types: undefined as unknown as { input: Echo; output: Echo }, validate: (value: unknown) => ({ value: value as Echo }) } };
`,
  "server/api/ping.get.ts": `import { defineApiRoute } from "@meekojs/meeko/server";
import { echoSchema } from "../../shared/schemas/echo.js";

export default defineApiRoute({
  response: echoSchema,
  handler: ({ context }) => {
    console.log("api ping", { at: "api" });
    context.platform.waitUntil(new Promise<void>((done) => setTimeout(() => { console.warn("api after response"); done(); }, 20)));
    return { text: "pong" };
  },
});
`,
  "server/rpc/echo.ts": `import { defineRpc } from "@meekojs/meeko/server";
import { echoSchema } from "../../shared/schemas/echo.js";

export default defineRpc({
  input: echoSchema,
  output: echoSchema,
  handler: ({ input }) => {
    console.info("rpc echo", input.text);
    return input;
  },
});
`,
  "app/pages/logs.meeko": `<script server lang="ts">
const { url } = usePage();
const circular: Record<string, unknown> = { name: "loop" };
circular.self = circular;
console.log("render of %s", url.pathname, { circular, total: 10n, roles: new Set(["admin"]) });
console.error(new Error("simulated failure", { cause: new TypeError("root cause") }));
export const greeting = "hello";
</script>

<script lang="ts">
onMounted(() => { console.log("client mounted"); });
</script>

<template>
  <section>
    <h1 id="title">{greeting}</h1>
    <MeekoLink to="/other">other</MeekoLink>
    <MeekoLink to="/stream">stream</MeekoLink>
    <button type="button" id="ping" on:click="async () => { await fetch('/api/ping'); }">ping</button>
  </section>
</template>
`,
  "app/pages/other.meeko": `<script server lang="ts">
console.info("navigation render", { page: "other" });
export const label = "other";
</script>

<template><h1 id="title">{label}</h1></template>
`,
  "app/pages/stream.meeko": `<script server lang="ts">
import { defer, definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "stream",
  load: () => {
    console.log("stream critical");
    return {
      slow: defer(async () => {
        await new Promise((done) => setTimeout(done, 100));
        console.log("stream deferred");
        return "ready";
      }, { timeoutMs: 5_000 }),
    };
  },
});
</script>

<script lang="ts">
import type { Deferred } from "@meekojs/meeko/framework";

const props = defineProps<{ params: Record<string, string>; search: Record<string, string | string[]>; data: { slow: Deferred<string> } }>();
</script>

<template><p id="slow">{props.data.slow.status}</p></template>
`,
  "app/pages/slow.meeko": `<script server lang="ts">
const { search } = usePage();
const tag = String(search.tag);
console.log("start " + tag);
await new Promise((done) => setTimeout(done, tag === "a" ? 120 : 10));
console.log("end " + tag);
export const value = tag;
</script>

<template><p>{value}</p></template>
`,
};

async function serverLogsApp(root: string, config?: string): Promise<void> {
  await initFrameworkProject(root);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
  if (config !== undefined) await writeFile(join(root, "meeko.config.ts"), config);
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repositoryRoot, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repositoryRoot, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
}

interface Running { readonly child: ChildProcess; readonly origin: string; readonly hmrPort: number; output(): string }

async function startDev(root: string): Promise<Running> {
  const port = await freePort();
  const hmrPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "dev", root], {
    cwd: root,
    env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), MEEKO_LINK_WATCH: "0", MEEKO_EDITOR_BRIDGE: "0" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  await waitFor(() => output.includes(`http://localhost:${port}\n`), () => `meeko dev did not listen: ${output}`, child, 30_000);
  return { child, origin, hmrPort, output: () => output };
}

async function waitFor(ready: () => boolean, message: () => string, child?: ChildProcess, timeout = 15_000): Promise<void> {
  const start = Date.now();
  while (!ready()) {
    if (child && child.exitCode !== null) throw new Error(message());
    if (Date.now() - start > timeout) throw new Error(message());
    await new Promise((done) => setTimeout(done, 25));
  }
}

function logBlocks(html: string): ServerLogBatch[] {
  return [...html.matchAll(/<script type="application\/json" data-meeko-server-logs>(.*?)<\/script>/g)].map((match) => JSON.parse(match[1]!) as ServerLogBatch);
}

const firstArgs = (batch: ServerLogBatch | undefined): unknown[] => batch?.entries.map((entry) => entry.args[0]) ?? [];

test("meeko dev forwards the server's console to the browser of the request that logged it", { timeout: 120_000 }, async (context) => {
  let running: Running | undefined;
  let hmr: WebSocket | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const root = await tempProject(context, "dev-server-logs", async () => {
    hmr?.close();
    await browser?.close();
    await stopChild(running?.child);
  });
  await serverLogsApp(root);
  running = await startDev(root);
  const { origin } = running;

  // The document carries the logs of its render, with its request ID, and the terminal still has them.
  const page = await fetch(`${origin}/logs`, { headers: { accept: "text/html" } });
  const html = await page.text();
  assert.equal(page.status, 200, running.output());
  const [batch, ...rest] = logBlocks(html);
  assert.deepEqual(rest, []);
  assert.equal(batch?.requestId, page.headers.get("x-request-id"));
  assert.deepEqual([batch?.method, batch?.path], ["GET", "/logs"]);
  assert.deepEqual(batch!.entries.map((entry) => entry.level), ["log", "error"]);
  assert.equal(batch!.entries[0]!.args[0], "render of %s");
  const rendered = batch!.entries[0]!;
  assert.equal(rendered.args[1], "/logs");
  const value = JSON.stringify(rendered.args[2]);
  assert.match(value, /"\$":"ref"/, "the cycle travels as a reference");
  assert.match(value, /"\$":"bigint","v":"10"/);
  const failure = batch!.entries[1]!.args[0] as { $: string; message: string; stack: string; cause: { message: string } };
  assert.equal(failure.$, "error");
  assert.equal(failure.message, "simulated failure");
  assert.match(failure.stack, /logs\.meeko/, "the stack names the server file");
  assert.equal(failure.cause.message, "root cause");
  assert.match(html, /<script src="\/@id\/__x00__meeko:server-logs-console"><\/script><script type="module" async src="\/@id\/__x00__meeko:server-logs"><\/script><\/head>/);
  await waitFor(() => running!.output().includes("render of /logs"), () => `the terminal lost the log: ${running!.output()}`);
  assert.match(running.output(), /simulated failure/);
  // The browser module is served by Vite.
  const module = await fetch(`${origin}/@id/__x00__meeko:server-logs`);
  assert.equal(module.status, 200);
  assert.match(await module.text(), /startServerLogs\(import\.meta\.hot/);

  // Two requests in flight at once keep their own logs.
  const [first, second] = await Promise.all(["a", "b"].map(async (tag) => {
    const response = await fetch(`${origin}/slow?tag=${tag}`, { headers: { accept: "text/html" } });
    return { tag, id: response.headers.get("x-request-id"), blocks: logBlocks(await response.text()) };
  }));
  for (const { tag, id, blocks } of [first!, second!]) {
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.requestId, id);
    assert.deepEqual(firstArgs(blocks[0]), [`start ${tag}`, `end ${tag}`]);
  }

  // A client navigation gets the logs of its data request in the payload.
  const navigation = await fetch(`${origin}/other`, { headers: { accept: "application/meeko+json" } });
  const payload = await navigation.json() as { v: number; route: string; devServerLogs: ServerLogBatch };
  assert.equal(payload.route, "/other");
  assert.equal(payload.devServerLogs.requestId, navigation.headers.get("x-request-id"));
  assert.deepEqual(payload.devServerLogs.entries, [{ level: "info", args: ["navigation render", { $: "object", id: 0, entries: [["page", "other"]] }] }]);

  // API and RPC logs arrive over Vite's HMR channel, labelled with their request.
  const viteClient = await (await fetch(`${origin}/@vite/client`)).text();
  const wsToken = viteClient.match(/const wsToken = "([^"]+)";/)?.[1];
  assert.ok(wsToken);
  hmr = new WebSocket(`ws://127.0.0.1:${running.hmrPort}/?token=${encodeURIComponent(wsToken)}`, "vite-hmr");
  const batches: ServerLogBatch[] = [];
  hmr.on("message", (data) => {
    const message = JSON.parse(String(data)) as { type: string; event?: string; data?: ServerLogBatch };
    if (message.type === "custom" && message.event === "meeko:server-logs") batches.push(message.data!);
  });
  await once(hmr, "open");
  const api = await fetch(`${origin}/api/ping`);
  assert.deepEqual(await api.json(), { text: "pong" });
  const rpc = await fetch(`${origin}/_meeko/rpc/echo`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ text: "hi" }) });
  assert.deepEqual(await rpc.json(), { text: "hi" }, running.output());
  await waitFor(() => batches.length >= 3, () => `HMR batches: ${JSON.stringify(batches)}`);
  const apiBatch = batches.find((entry) => entry.path === "/api/ping" && entry.phase === "request");
  assert.equal(apiBatch?.requestId, api.headers.get("x-request-id"));
  assert.deepEqual(firstArgs(apiBatch), ["api ping"]);
  const late = batches.find((entry) => entry.path === "/api/ping" && entry.phase === "late");
  assert.deepEqual(firstArgs(late), ["api after response"]);
  const rpcBatch = batches.find((entry) => entry.path === "/_meeko/rpc/echo");
  assert.deepEqual([rpcBatch?.method, rpcBatch?.requestId, ...firstArgs(rpcBatch)], ["POST", rpc.headers.get("x-request-id"), "rpc echo"]);
  // Pages never travel twice: none of their logs went over HMR.
  assert.ok(batches.every((entry) => entry.path.startsWith("/api/") || entry.path.startsWith("/_meeko/")), JSON.stringify(batches));

  // Chrome shows the server's logs marked as such, before the page's own logs, and as real values.
  browser = await chromium.launch({
    ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
    headless: true,
  });
  const tab = await browser.newPage();
  const messages: Array<{ type: string; text: string; message: import("playwright-core").ConsoleMessage }> = [];
  tab.on("console", (message) => messages.push({ type: message.type(), text: message.text(), message }));
  const pageErrors: string[] = [];
  tab.on("pageerror", (error) => pageErrors.push(error.message));
  await tab.goto(`${origin}/logs`, { waitUntil: "networkidle" });
  await waitFor(() => messages.some((entry) => entry.text === "client mounted"), () => JSON.stringify(messages.map((entry) => entry.text)));
  const index = (pattern: RegExp): number => messages.findIndex((entry) => pattern.test(entry.text));
  assert.ok(index(/^%cserver%c GET \/logs/) >= 0, "a group labelled with the request");
  const serverRender = messages[index(/%cserver%c render of %s/)];
  assert.ok(serverRender, JSON.stringify(messages.map((entry) => entry.text)));
  assert.ok(index(/%cserver%c render of %s/) < index(/^client mounted$/), "the server's logs come before the page's");
  assert.equal(messages[index(/^client mounted$/)]!.type, "log", "the page's own logs stay as they are");
  const loggedObject = serverRender.message.args()[4]!;
  assert.deepEqual(await loggedObject.evaluate((value: { circular: { self: unknown }; total: bigint; roles: Set<string> }) =>
    [value.circular.self === value.circular, typeof value.total, value.roles instanceof Set && value.roles.has("admin")]), [true, "bigint", true]);
  const errorMessage = messages.find((entry) => entry.type === "error" && /%cserver/.test(entry.text));
  assert.ok(errorMessage);
  assert.deepEqual(await errorMessage.message.args()[2]!.evaluate((error: Error & { cause?: Error }) =>
    [error instanceof Error, /logs\.meeko/.test(error.stack ?? ""), error.cause?.message]), [true, true, "root cause"]);
  // A client navigation prints the logs of its payload; an API call those that arrive over HMR.
  await tab.getByRole("link", { name: "other" }).click();
  await tab.locator("#title", { hasText: "other" }).waitFor();
  await waitFor(() => index(/%cserver%c navigation render/) >= 0, () => JSON.stringify(messages.map((entry) => entry.text)));
  await tab.goto(`${origin}/logs`, { waitUntil: "networkidle" });
  const before = messages.length;
  await tab.locator("#ping").click();
  await waitFor(() => messages.slice(before).some((entry) => /%cserver%c api ping/.test(entry.text)), () => JSON.stringify(messages.slice(before).map((entry) => entry.text)));
  // A streamed navigation prints the logs of each line, and its deferred value still arrives.
  await tab.getByRole("link", { name: "stream" }).click();
  await tab.locator("#slow", { hasText: "resolved" }).waitFor();
  await waitFor(() => index(/%cserver%c stream deferred/) > index(/%cserver%c stream critical/) && index(/%cserver%c stream critical/) > 0, () => JSON.stringify(messages.map((entry) => entry.text)));
  // The first load of a streamed document prints its blocks too.
  await tab.goto(`${origin}/stream`, { waitUntil: "networkidle" });
  await tab.locator("#slow", { hasText: "resolved" }).waitFor();
  await waitFor(() => messages.filter((entry) => /%cserver%c stream deferred/.test(entry.text)).length === 2, () => JSON.stringify(messages.map((entry) => entry.text)));
  assert.deepEqual(pageErrors, []);
});

test("dev.serverLogs: false keeps the server's console in the terminal only", { timeout: 90_000 }, async (context) => {
  let running: Running | undefined;
  const root = await tempProject(context, "dev-server-logs-off", () => stopChild(running?.child));
  await serverLogsApp(root, 'import { defineMeekoConfig } from "@meekojs/meeko/framework";\n\nexport default defineMeekoConfig({ dev: { serverLogs: false } });\n');
  running = await startDev(root);
  const html = await (await fetch(`${running.origin}/logs`, { headers: { accept: "text/html" } })).text();
  assert.match(html, /<h1 id="title">/);
  assert.doesNotMatch(html, devMarkers);
  const payload = await (await fetch(`${running.origin}/other`, { headers: { accept: "application/meeko+json" } })).text();
  assert.doesNotMatch(payload, devMarkers);
  assert.notEqual((await fetch(`${running.origin}/@id/__x00__meeko:server-logs`)).status, 200);
  await waitFor(() => running!.output().includes("render of /logs"), () => running!.output());
});

/** Relative imports reachable from `entries` in the compiled package. */
async function packageGraph(entries: readonly string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  const pending = [...entries];
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, "utf8");
    const specifiers = [
      ...source.matchAll(/^\s*(?:import|export)\b[^;]*?["'](\.{1,2}\/[^"']+\.js)["']/gm),
      ...source.matchAll(/\bimport\(\s*["'](\.{1,2}\/[^"']+\.js)["']\s*\)/g),
    ].map((match) => resolve(dirname(file), match[1]!));
    // A JSDoc example may name a module that is not part of the package.
    for (const specifier of specifiers) if (await readFile(specifier).then(() => true, () => false)) pending.push(specifier);
  }
  return seen;
}

test("the production build and server have no trace of the server logs", { timeout: 180_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const root = await tempProject(context, "dev-server-logs-build", () => stopChild(child));
  await serverLogsApp(root);
  // Production refuses sessions that live only in memory; this store says it persists.
  await writeFile(join(root, "server", "runtime.ts"), `import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(({ production }) => {
  const memory = new MemorySessionStore();
  return { sessions: new SessionManager({ store: {
    persistent: true,
    get: (id) => memory.get(id),
    set: (record) => memory.set(record),
    delete: (id) => memory.delete(id),
    replace: (oldId, record) => memory.replace(oldId, record),
    revokeFamily: (familyId) => memory.revokeFamily(familyId),
    close: () => memory.close(),
  }, production }) };
});
`);
  await prepareFrameworkTypes(root);
  const { output } = await buildProject(root, { adapter: "node" });
  const list = async (directory: string): Promise<string[]> => (await readdir(directory, { withFileTypes: true, recursive: true }))
    .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
  const built = await list(output);
  assert.ok(built.some((file) => file.endsWith(".js") && file.includes(join("client", "assets"))));
  for (const file of built.filter((name) => /\.(?:m?js|html|json)$/.test(name))) {
    assert.doesNotMatch(await readFile(file, "utf8"), devMarkers, file);
  }
  // What the server bundle imports from Meeko never reaches the capture of `meeko dev`.
  const server = (await Promise.all(built.filter((file) => file.endsWith(".mjs")).map((file) => readFile(file, "utf8")))).join("\n");
  const subpaths = new Set([...server.matchAll(/["']@meekojs\/meeko(\/[\w-]+)?["']/g)].map((match) => match[1] ?? ""));
  assert.ok(subpaths.size > 0);
  const exports = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).exports as Record<string, { default: string }>;
  const graph = await packageGraph([...subpaths].map((subpath) => resolve(repositoryRoot, exports[`.${subpath}`]!.default)));
  assert.ok([...graph].some((file) => /framework[\\/]server\.js$/.test(file)), "the walk reaches the page renderer");
  assert.ok(![...graph].some((file) => /dev-server-logs/.test(file)), [...graph].filter((file) => /framework[\\/]/.test(file)).join("\n"));
  // The same walk does find it from the entry of `meeko dev`.
  assert.ok([...await packageGraph([resolve(repositoryRoot, exports["./build"]!.default)])].some((file) => /dev-server-logs\.js$/.test(file)));
  // `meeko start` answers without the logs; its terminal still shows them.
  const port = await freePort();
  child = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "start", root], {
    cwd: root, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(() => logs.includes(String(port)), () => `meeko start did not listen: ${logs}`, child, 30_000);
  const html = await (await fetch(`${origin}/logs`, { headers: { accept: "text/html" } })).text();
  assert.match(html, /<h1 id="title">/);
  assert.doesNotMatch(html, devMarkers);
  assert.doesNotMatch(await (await fetch(`${origin}/other`, { headers: { accept: "application/meeko+json" } })).text(), devMarkers);
  await waitFor(() => logs.includes("render of /logs"), () => logs);
});
