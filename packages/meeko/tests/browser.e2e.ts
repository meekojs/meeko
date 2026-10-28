import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { createServer, preview } from "vite";
import { createExampleServer } from "../examples/counter/server.ts";
import { generateServerContracts } from "../src/framework/contracts-generate.ts";
import { prepareFrameworkTypes } from "../src/framework/check-project.ts";
import { buildProject } from "../src/framework/project.ts";
import { previewStatic } from "../src/framework/static-adapter.ts";
import { startConformanceOutput } from "./conformance/harness.ts";
import { staticAppConfig, writeStaticApp } from "./helpers/static-app.ts";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";

async function assertBrowserBehavior(url: string, development: boolean): Promise<void> {
  const browser = await chromium.launch({
    ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${message.text()} @ ${message.location().url}`);
    });
    await page.goto(url, { waitUntil: "networkidle" });
    if (development) {
      await page.waitForFunction(() => Boolean(window.__MEEKO_DEVTOOLS__));
      const initial = await page.evaluate(() => window.__MEEKO_DEVTOOLS__!.snapshot());
      assert.ok(initial.instances.some((instance) => instance.name === "Counter"));
      assert.ok(initial.instances.some((instance) => instance.name === "Parent"));
      assert.ok(initial.instances.every((instance) => instance.status === "hydrated"));
      await page.locator('[data-meeko-devtools-panel] button[data-action="select"]', { hasText: "Counter" }).click();
      assert.equal(await page.locator('[data-meeko-devtools-panel] h3', { hasText: "Señales" }).count(), 1);
    } else {
      assert.equal(await page.evaluate(() => window.__MEEKO_DEVTOOLS__ === undefined), true);
      assert.equal(await page.locator("[data-meeko-devtools-panel]").count(), 0);
    }
    assert.equal(await page.locator("header img[alt='Meeko']").evaluate((image: HTMLImageElement) => image.naturalWidth > 0), true);
    assert.match(await page.locator("#app button").innerText(), /^2 · doble: 4$/);
    await page.locator("#app button").click();
    assert.match(await page.locator("#app button").innerText(), /^3 · doble: 6$/);
    if (development) {
      const updated = await page.evaluate(() => window.__MEEKO_DEVTOOLS__!.snapshot());
      const counter = updated.instances.find((instance) => instance.name === "Counter");
      assert.ok(counter);
      assert.equal(counter.signals.count, 3);
      assert.equal(updated.protocolVersion, 1);
      const clicked = updated.events.filter((event) => event.kind === "signal" && event.instanceId === counter.id).at(-1);
      assert.ok(clicked?.write?.kind === "assignment" && clicked.write.expression === "count.value++" && clicked.write.file.endsWith("Counter.meeko"));
      assert.ok(clicked.reads?.some((read) => read.kind === "computed"));
      const panel = page.locator("[data-meeko-devtools-panel]");
      await panel.locator('button[data-action="select"]', { hasText: "Counter" }).click();
      await panel.locator('textarea[data-action="edit-value"]').fill("7");
      await panel.locator('button[data-action="edit-apply"]').click();
      await page.locator("#app button", { hasText: "7 · doble: 14" }).waitFor();
      assert.match(await panel.locator(".editor-message").innerText(), /Señal count actualizada/);
      assert.deepEqual(await page.evaluate((id) => window.__MEEKO_DEVTOOLS__!.setSignal(id, "count", 3), counter.id), { ok: true });
      assert.match(await page.locator("#app button").innerText(), /^3 · doble: 6$/);
    }

    await page.locator("#regions button", { hasText: "Prepend" }).click();
    await page.locator("#regions button", { hasText: "Reverse" }).click();
    assert.equal(await page.locator("#regions li").count(), 3);
    assert.equal(await page.locator("#hot button").evaluate((button) => getComputedStyle(button).color), "rgb(29, 78, 216)");
    await page.locator("#hot button").click();
    assert.match(await page.locator("#hot button").innerText(), /^Hot v3 1$/);
    const firstChild = page.locator("#nested section > button").first();
    assert.equal(await firstChild.innerText(), "Root: 0");
    await firstChild.click();
    assert.equal(await firstChild.innerText(), "Root: 1");
    await page.locator("#nested button", { hasText: "Update" }).click();
    assert.equal(await firstChild.innerText(), "Updated: 1");
    await page.locator("#nested button", { hasText: "Reverse" }).click();
    assert.equal(await page.locator("#nested li").first().getAttribute("data-id"), "b");
    await page.locator("#nested button", { hasText: "Toggle" }).click();
    assert.equal(await page.locator("#nested button", { hasText: "Conditional" }).count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

test("Vite en desarrollo hidrata y actualiza componentes en Chrome real", async () => {
  const server = await createServer({
    configFile: resolve("examples/vite/vite.config.ts"),
    root: resolve("examples/vite"),
    server: { host: "127.0.0.1", port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address() as AddressInfo | null;
    if (!address) throw new Error("Vite did not open an HTTP server");
    await assertBrowserBehavior(`http://127.0.0.1:${address.port}/`, true);
  } finally {
    await server.close();
  }
});

test("Vite en producción hidrata y actualiza componentes en Chrome real", async () => {
  const server = await preview({
    configFile: resolve("examples/vite/vite.config.ts"),
    root: resolve("examples/vite"),
    preview: { host: "127.0.0.1", port: 0 },
  });
  try {
    const address = server.httpServer.address() as AddressInfo | null;
    if (!address) throw new Error("Vite preview did not open an HTTP server");
    await assertBrowserBehavior(`http://127.0.0.1:${address.port}/`, false);
  } finally {
    await new Promise<void>((resolveDone, reject) => server.httpServer.close((error) => error ? reject(error) : resolveDone()));
  }
});

test("la página SSR hidrata y vuelve a crear estado al navegar", async () => {
  const server = createExampleServer();
  await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /meeko:text:0-->2/);
    const logoResponse = await fetch(`${url}meeko-logo.png`);
    assert.equal(logoResponse.status, 200);
    assert.match(logoResponse.headers.get("content-type") ?? "", /^image\/png/);
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${message.text()} @ ${message.location().url}`);
    });
    await page.goto(url, { waitUntil: "networkidle" });
    assert.match(await page.locator("#app button").innerText(), /^2 · doble: 4$/);
    await page.locator("#app button").click();
    assert.match(await page.locator("#app button").innerText(), /^3 · doble: 6$/);
    await page.getByRole("link", { name: "Otro valor" }).click();
    assert.match(await page.locator("#app button").innerText(), /^5 · doble: 10$/);
    await page.goBack({ waitUntil: "networkidle" });
    assert.match(await page.locator("#app button").innerText(), /^2 · doble: 4$/);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise<void>((resolveDone, reject) => server.close((error) => error ? reject(error) : resolveDone()));
  }
});

test("una página render: stream es interactiva antes del diferido y respeta una CSP estricta", { timeout: 240_000 }, async () => {
  // Builds the conformance fixture with the Node adapter, then serves its
  // output in-process with a CSP nonce and no 'unsafe-inline'.
  const built = await startConformanceOutput("node");
  type ServerModule = typeof import("../src/framework-server.ts");
  type NodeModule = typeof import("../src/node.ts");
  const { createServerApp } = await import(pathToFileURL(resolve("dist/framework-server.js")).href) as ServerModule;
  const { createNodeAssetReader, toNodeListener } = await import(pathToFileURL(resolve("dist/node.js")).href) as NodeModule;
  const output = await import(pathToFileURL(join(built.output, "index.mjs")).href) as Pick<Parameters<ServerModule["createServerApp"]>[0], "load" | "manifest">;
  const nonce = randomUUID().replaceAll("-", "");
  const policy = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'`;
  const app = await createServerApp({
    manifest: output.manifest, load: output.load, production: false,
    assets: createNodeAssetReader({ root: join(built.output, "client"), assets: output.manifest.assets ?? {} }),
    document: { nonce: () => nonce },
  });
  const server = createHttpServer(toNodeListener(async (request) => {
    const response = await app.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("content-security-policy", policy);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }));
  await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const { port } = server.address() as AddressInfo;
  const delay = 4_000;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${message.text()} @ ${message.location().url}`);
    });
    await page.addInitScript(() => {
      const violations: string[] = [];
      (window as unknown as { __cspViolations: string[] }).__cspViolations = violations;
      document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
    await page.goto(`http://127.0.0.1:${port}/stream?delay=${delay}`, { waitUntil: "commit" });
    await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0, undefined, { timeout: delay });
    assert.equal(await page.locator("#stream-pending").innerText(), "Loading slow data");
    await page.locator("#stream-count").click();
    assert.equal(await page.locator("#stream-count").innerText(), "Count: 1");
    const interactiveAt = await page.evaluate(() => performance.now());
    assert.ok(interactiveAt < delay, `the page became interactive after ${interactiveAt} ms`);
    assert.equal(await page.locator("#stream-value").count(), 0, "the deferred value arrived before the page was interactive");
    await page.locator("#stream-value", { hasText: "Deferred done" }).waitFor({ timeout: delay + 10_000 });
    assert.equal(await page.locator("#stream-pending").count(), 0);
    // Local state survives the deferred update.
    assert.equal(await page.locator("#stream-count").innerText(), "Count: 1");
    assert.ok(await page.evaluate(() => performance.now()) >= delay - 50);
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations), []);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise<void>((resolveDone, reject) => server.close((error) => error ? reject(error) : resolveDone()));
    await app.close();
    await built.stop();
  }
});

test("Chrome real envía las excepciones y los rechazos globales a onError sin duplicados y deja de hacerlo al desmontar", { timeout: 120_000 }, async () => {
  const { build } = await import("esbuild");
  const { createFrameworkHandler } = await import("../src/framework/server.ts");
  const { page: fixturePage, routes } = await import("./fixtures/global-errors/page.ts");
  const bundle = await build({
    entryPoints: [resolve("tests/fixtures/global-errors/client.ts")],
    bundle: true, format: "esm", platform: "browser", target: "es2022", write: false,
  });
  const script = bundle.outputFiles[0]!.text;
  const render = createFrameworkHandler({ routes, loadPage: async () => fixturePage, clientEntry: "/client.js" });
  const server = createHttpServer((request, response) => {
    if (request.url === "/client.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(script);
      return;
    }
    void render(new Request(`http://127.0.0.1${request.url ?? "/"}`, { headers: { accept: "text/html" } })).then(async (page) => {
      response.writeHead(page.status, Object.fromEntries(page.headers));
      response.end(await page.text());
    });
  });
  await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const { port } = server.address() as AddressInfo;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    type Report = { message: string; source: string };
    type FixtureWindow = Window & { __ready?: boolean; __reports: Report[] };
    await page.waitForFunction(() => (window as unknown as FixtureWindow).__ready === true);
    const reports = () => page.evaluate(() => (window as unknown as FixtureWindow).__reports);
    await page.locator("#timer").click();
    await page.waitForFunction(() => (window as unknown as FixtureWindow).__reports.length === 1);
    await page.locator("#reject").click();
    await page.waitForFunction(() => (window as unknown as FixtureWindow).__reports.length === 2);
    assert.deepEqual(await reports(), [
      { message: "timer failure", source: "uncaught" },
      { message: "rejected failure", source: "rejection" },
    ]);
    // Both were prevented: Chrome does not log them a second time.
    assert.ok(!consoleErrors.some((text) => /timer failure|rejected failure/.test(text)), consoleErrors.join("\n"));
    // The same error thrown again by the app is not reported twice.
    await page.locator("#reported").click();
    await page.waitForTimeout(300);
    assert.equal((await reports()).length, 2);
    // After dispose the browser's own report is back and onError hears nothing.
    await page.locator("#dispose").click();
    await page.waitForTimeout(300);
    assert.equal((await reports()).length, 2);
    assert.ok(pageErrors.includes("after dispose"), pageErrors.join("\n"));
  } finally {
    await browser?.close();
    await new Promise<void>((resolveDone, reject) => server.close((error) => error ? reject(error) : resolveDone()));
  }
});

test("el 404.html del adaptador static hidrata en cualquier URL y navega en el cliente bajo su CSP", { timeout: 240_000 }, async () => {
  const project = await createTempProject("static-e2e");
  let server: import("node:http").Server | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await writeStaticApp(project.root, staticAppConfig);
    await buildProject(project.root);
    const previous = { port: process.env.MEEKO_PORT, host: process.env.MEEKO_HOST };
    process.env.MEEKO_PORT = "0";
    process.env.MEEKO_HOST = "127.0.0.1";
    try { server = await previewStatic(project.root); }
    finally {
      if (previous.port === undefined) delete process.env.MEEKO_PORT; else process.env.MEEKO_PORT = previous.port;
      if (previous.host === undefined) delete process.env.MEEKO_HOST; else process.env.MEEKO_HOST = previous.host;
    }
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    const documents: string[] = [];
    const payloads: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      // The browser logs the 404 status of the document and of the missing payload file.
      if (message.type() === "error" && !message.text().includes("404 (Not Found)")) errors.push(`${message.text()} @ ${message.location().url}`);
    });
    page.on("request", (request) => {
      if (request.resourceType() === "document") documents.push(new URL(request.url()).pathname);
      if (request.url().endsWith("index.meeko.json")) payloads.push(new URL(request.url()).pathname);
    });
    await page.addInitScript(() => {
      const violations: string[] = [];
      (window as unknown as { __cspViolations: string[] }).__cspViolations = violations;
      document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
    // /docs/zz matches the dynamic route /docs/[slug], but only a and b were prerendered.
    const response = await page.goto(`${origin}/docs/zz`);
    assert.equal(response?.status(), 404);
    await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
    assert.equal(await page.locator("#error").innerText(), "404");
    assert.equal(await page.evaluate(() => (window as unknown as { boot?: number }).boot), 1, "the inline script allowed by its hash ran");
    await page.evaluate(() => { (window as unknown as { marker: number }).marker = 1; });
    await page.locator("#error-a").click();
    await page.locator("#doc", { hasText: "a" }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/docs/a");
    assert.equal(await page.title(), "Doc a · Test");
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://example.com/docs/a");
    await page.locator("#to-b").click();
    await page.locator("#doc", { hasText: "b" }).waitFor();
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://example.com/docs/b");
    await page.locator("#to-home").click();
    await page.locator("#home").waitFor();
    // A route URL that was not prerendered shows the error page in the client too.
    await page.locator("#to-missing").click();
    await page.locator("#error").waitFor();
    assert.equal(await page.locator('link[rel="canonical"]').count(), 0);
    assert.equal(await page.evaluate(() => (window as unknown as { marker?: number }).marker), 1, "every navigation stayed in the client");
    // History navigation reads the payload files too.
    await page.goBack();
    await page.locator("#home").waitFor();
    assert.equal(await page.evaluate(() => (window as unknown as { marker?: number }).marker), 1);
    assert.deepEqual(documents, ["/docs/zz"]);
    assert.deepEqual(payloads, ["/docs/a/index.meeko.json", "/docs/b/index.meeko.json", "/index.meeko.json", "/docs/zz/index.meeko.json", "/index.meeko.json"]);
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations), []);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await project.remove();
  }
});

/** What `<html>` showed in the first frame and every later change of its theme. */
type ThemeProbe = { first?: { theme: string | null; moon: string; scheme: string }; changes: string[] };

/** Records, from the start of each document, what `<html>` shows before the first paint and every later theme change. */
const themeProbe = (): void => {
  const probe: { first?: unknown; changes: string[] } = { changes: [] };
  (window as unknown as { __theme: unknown }).__theme = probe;
  new MutationObserver((records) => {
    for (const record of records) {
      const value = (record.target as Element).getAttribute("data-theme");
      if (record.attributeName === "data-theme" && record.oldValue !== value) probe.changes.push(`${record.oldValue}→${value}${document.body ? "" : " (before <body>)"}`);
    }
  }).observe(document, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["data-theme"] });
  // The first frame: rendering waits for <head>, so this is what the first paint shows.
  requestAnimationFrame(() => {
    const moon = document.querySelector(".moon");
    probe.first = {
      theme: document.documentElement.getAttribute("data-theme"),
      moon: moon ? getComputedStyle(moon).display : "missing",
      scheme: getComputedStyle(document.documentElement).colorScheme,
    };
  });
  const violations: string[] = [];
  (window as unknown as { __cspViolations: string[] }).__cspViolations = violations;
  document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective} ${event.blockedURI}`));
};

/** A theme toggle with both icons (the CSS shows one) and a text that `useTheme()` renders. */
const themeToggle = `<script lang="ts">
const { resolved, set } = useTheme();
</script>
<template><button id="toggle" type="button" aria-label="Tema oscuro" bind:aria-pressed="String(resolved.value === 'dark')" on:click="() => set(resolved.value === 'dark' ? 'light' : 'dark')"><span class="sun">sol</span><span class="moon">luna</span></button><p id="resolved">{resolved.value}</p></template>
`;

test("el tema llega en el primer byte con la cookie y sin parpadeo en modo sistema, bajo una CSP estricta con nonce", { timeout: 240_000 }, async () => {
  const project = await createTempProject("theme-e2e");
  const root = project.root;
  type ServerModule = typeof import("../src/framework-server.ts");
  type NodeModule = typeof import("../src/node.ts");
  let server: import("node:http").Server | undefined;
  let app: Awaited<ReturnType<ServerModule["createServerApp"]>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const files: Record<string, string> = {
      "package.json": '{"name":"theme-app","private":true,"type":"module"}\n',
      "meeko.config.mjs": "export default { theme: true };\n",
      "app/styles/main.css": ".moon { display: none }\n:root[data-theme=\"dark\"] .sun { display: none }\n:root[data-theme=\"dark\"] .moon { display: inline }\n",
      "app/pages/index.meeko": themeToggle,
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), contents);
    }
    await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
    const built = await buildProject(root);
    const { createServerApp } = await import(pathToFileURL(resolve("dist/framework-server.js")).href) as ServerModule;
    const { createNodeAssetReader, toNodeListener } = await import(pathToFileURL(resolve("dist/node.js")).href) as NodeModule;
    const output = await import(pathToFileURL(join(built.output, "index.mjs")).href) as Pick<Parameters<ServerModule["createServerApp"]>[0], "load" | "manifest">;
    const nonce = randomUUID().replaceAll("-", "");
    // No 'unsafe-inline' anywhere: the theme script runs by its nonce and color-scheme goes through CSSOM.
    const policy = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'`;
    app = await createServerApp({
      manifest: output.manifest, load: output.load, production: false,
      assets: createNodeAssetReader({ root: join(built.output, "client"), assets: output.manifest.assets ?? {} }),
      document: { nonce: () => nonce },
    });
    const running = app;
    const documents: Array<{ hint: string | null; html: string; criticalCh: string | null }> = [];
    server = createHttpServer(toNodeListener(async (request) => {
      const response = await running.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("content-security-policy", policy);
      if (!headers.get("content-type")?.startsWith("text/html")) return new Response(response.body, { status: response.status, headers });
      const html = await response.text();
      documents.push({ hint: request.headers.get("sec-ch-prefers-color-scheme"), html, criticalCh: headers.get("critical-ch") });
      return new Response(html, { status: response.status, headers });
    }));
    await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });
    const open = async (options: { colorScheme: "light" | "dark"; cookie?: string }) => {
      const context = await browser!.newContext({ colorScheme: options.colorScheme });
      if (options.cookie) await context.addCookies([{ name: "meeko-theme", value: options.cookie, url: origin }]);
      await context.addInitScript(themeProbe);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(`${origin}/`);
      await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
      await page.waitForFunction(() => (window as unknown as { __theme: ThemeProbe }).__theme.first !== undefined);
      const probe = () => page.evaluate(() => (window as unknown as { __theme: ThemeProbe }).__theme);
      return { context, page, errors, probe };
    };

    // 1. A dark cookie on a light system: the first HTML already has the theme and the icon.
    documents.length = 0;
    const cookie = await open({ colorScheme: "light", cookie: "dark" });
    const first = documents.at(-1)!;
    assert.match(first.html, /<html data-theme="dark" data-theme-choice="dark">/);
    assert.match(first.html, /<p id="resolved">(?:<!--[^>]*-->)?dark/);
    assert.match(first.html, /aria-pressed="true"/);
    assert.deepEqual((await cookie.probe()).first, { theme: "dark", moon: "inline", scheme: "dark" });
    assert.equal(await cookie.page.locator("#resolved").innerText(), "dark");
    // Hydration changed nothing.
    assert.deepEqual((await cookie.probe()).changes, []);
    // A change applies at once, and the next document comes from the server with it.
    await cookie.page.locator("#toggle").click();
    assert.equal(await cookie.page.evaluate(() => document.documentElement.getAttribute("data-theme")), "light");
    assert.equal(await cookie.page.locator("#resolved").innerText(), "light");
    assert.equal((await cookie.context.cookies(origin)).find((entry) => entry.name === "meeko-theme")?.value, "light");
    await cookie.page.reload();
    await cookie.page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
    assert.match(documents.at(-1)!.html, /<html data-theme="light" data-theme-choice="light">/);
    assert.deepEqual((await cookie.probe()).first, { theme: "light", moon: "none", scheme: "light" });
    assert.deepEqual((await cookie.probe()).changes, []);
    assert.deepEqual(await cookie.page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations), []);
    assert.deepEqual(cookie.errors, []);
    await cookie.context.close();

    // 2. No cookie and a dark system: dark before the first paint, by the client hint or the script.
    documents.length = 0;
    const system = await open({ colorScheme: "dark" });
    assert.deepEqual((await system.probe()).first, { theme: "dark", moon: "inline", scheme: "dark" });
    const served = documents.at(-1)!;
    assert.equal(served.criticalCh, "Sec-CH-Prefers-Color-Scheme");
    // When Chromium sends the hint, the server resolves the theme with it. Under CDP emulation the
    // hint can still say light on the first navigation while matchMedia already says dark (seen on
    // the Windows CI runner): the server then writes light and the script corrects it before the
    // first paint, which the probe above already checked.
    if (served.hint !== null) assert.match(served.html, new RegExp(`<html data-theme="${served.hint.includes("dark") ? "dark" : "light"}">`));
    else assert.match(served.html, /<html><head>/);
    assert.equal(await system.page.locator("#resolved").innerText(), "dark");
    // Whatever the server knew, the theme of <html> never changed after it was first set.
    const changes = (await system.probe()).changes;
    // The script set it before <body> existed, so nothing was painted with another theme.
    // From nothing, or from the light the server wrote with a stale hint: always before <body>.
    assert.ok(changes.every((change) => /^(?:null|light)→dark \(before <body>\)$/.test(change)), JSON.stringify(changes));
    // "system" follows the operating system while the page is open.
    await system.page.emulateMedia({ colorScheme: "light" });
    await system.page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light");
    assert.equal(await system.page.locator("#resolved").innerText(), "light");
    assert.deepEqual(await system.page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations), []);
    assert.deepEqual(system.errors, []);
    console.log(`[theme e2e] hints of the documents in system mode: ${JSON.stringify(documents.map((entry) => entry.hint))}`);
    await system.context.close();
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await app?.close();
    await project.remove();
  }
});

test("una página estática aplica el tema guardado antes del primer pintado con el script permitido por su hash", { timeout: 240_000 }, async () => {
  const project = await createTempProject("theme-static-e2e");
  let server: import("node:http").Server | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await writeStaticApp(project.root, staticAppConfig.replace("sitemap: true,", "sitemap: true,\n  theme: true,"));
    await mkdir(join(project.root, "app", "styles"), { recursive: true });
    await writeFile(join(project.root, "app", "styles", "main.css"), ".moon { display: none }\n:root[data-theme=\"dark\"] .moon { display: inline }\n");
    await writeFile(join(project.root, "app", "pages", "index.meeko"), themeToggle.replace("<template>", '<template><p id="home">Inicio</p>'));
    await buildProject(project.root);
    const previous = { port: process.env.MEEKO_PORT, host: process.env.MEEKO_HOST };
    process.env.MEEKO_PORT = "0";
    process.env.MEEKO_HOST = "127.0.0.1";
    try { server = await previewStatic(project.root); }
    finally {
      if (previous.port === undefined) delete process.env.MEEKO_PORT; else process.env.MEEKO_PORT = previous.port;
      if (previous.host === undefined) delete process.env.MEEKO_HOST; else process.env.MEEKO_HOST = previous.host;
    }
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });
    for (const setup of [{ cookie: "dark" }, { stored: "dark" }]) {
      const context = await browser.newContext({ colorScheme: "light" });
      if (setup.cookie) await context.addCookies([{ name: "meeko-theme", value: setup.cookie, url: origin }]);
      if (setup.stored) await context.addInitScript((value) => { if (!localStorage.getItem("meeko-theme")) localStorage.setItem("meeko-theme", value); }, setup.stored);
      await context.addInitScript(themeProbe);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      const response = await page.goto(`${origin}/`);
      // The prerendered file is the same for everyone: no theme on <html>.
      assert.match(await response!.text(), /^<!doctype html><html lang="es"><head>/);
      await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
      await page.waitForFunction(() => (window as unknown as { __theme: ThemeProbe }).__theme.first !== undefined);
      const probe = await page.evaluate(() => (window as unknown as { __theme: ThemeProbe }).__theme);
      assert.deepEqual(probe.first, { theme: "dark", moon: "inline", scheme: "dark" }, JSON.stringify(setup));
      // Only the inline script set the theme, before <body> existed: nothing was painted light.
      assert.deepEqual(probe.changes, ["null→dark (before <body>)"]);
      // The component rendered the prerendered default and switched once hydration ended.
      assert.equal(await page.locator("#resolved").innerText(), "dark");
      assert.deepEqual(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations), []);
      assert.deepEqual(errors, []);
      // A choice that only localStorage kept goes back to the cookie.
      assert.equal((await context.cookies(origin)).find((entry) => entry.name === "meeko-theme")?.value, "dark");
      await context.close();
    }
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await project.remove();
  }
});

/** What `<MeekoThemeToggle>` showed in the first frame, and every later change inside it. */
type ToggleProbe = { first?: { choice: string | null; theme: string | null; icons: string[]; count: number }; changes: string[] };

/** Records, from the start of each document, the icons that the CSS shows and any DOM change of the toggle. */
const toggleProbe = (): void => {
  // No named function inside: the test runner would wrap it with a helper that the page lacks.
  const probe: ToggleProbe = { changes: [] };
  Object.assign(window, { __toggle: probe });
  // From the end of parsing ("interactive", before the module scripts run): what hydration changes.
  document.addEventListener("readystatechange", () => {
    if (document.readyState !== "interactive") return;
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target as Element : record.target.parentElement;
        if (target?.closest("[data-meeko-theme-toggle]")) probe.changes.push(record.type === "attributes" ? `${(record.target as Element).localName}@${record.attributeName}` : record.type);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  // The first frame: rendering waits for <head>, so this is what the first paint shows.
  requestAnimationFrame(() => {
    probe.first = {
      choice: document.documentElement.getAttribute("data-theme-choice"), theme: document.documentElement.getAttribute("data-theme"),
      icons: [...document.querySelectorAll("[data-meeko-theme-icon]")].filter((icon) => getComputedStyle(icon).display !== "none").map((icon) => icon.getAttribute("data-meeko-theme-icon")!),
      count: document.querySelectorAll("[data-meeko-theme-icon]").length,
    };
  });
  const violations: string[] = [];
  Object.assign(window, { __cspViolations: violations });
  document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective} ${event.blockedURI}`));
};

test("<MeekoThemeToggle> shows the right icon in the first frame, cycles with JavaScript and posts without it, under a strict CSP", { timeout: 240_000 }, async () => {
  const project = await createTempProject("theme-toggle-e2e");
  const root = project.root;
  type ServerModule = typeof import("../src/framework-server.ts");
  type NodeModule = typeof import("../src/node.ts");
  let server: import("node:http").Server | undefined;
  let app: Awaited<ReturnType<ServerModule["createServerApp"]>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const files: Record<string, string> = {
      "package.json": '{"name":"theme-toggle-app","private":true,"type":"module"}\n',
      "meeko.config.mjs": "export default { theme: true };\n",
      "app/pages/index.meeko": '<template><MeekoThemeToggle class="toggle"><snippet name="light"><b>sol</b></snippet><snippet name="dark"><b>luna</b></snippet><snippet name="system"><b>pc</b></snippet></MeekoThemeToggle><p id="home">Inicio</p></template>\n',
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), contents);
    }
    await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
    const built = await buildProject(root);
    const { createServerApp } = await import(pathToFileURL(resolve("dist/framework-server.js")).href) as ServerModule;
    const { createNodeAssetReader, toNodeListener } = await import(pathToFileURL(resolve("dist/node.js")).href) as NodeModule;
    const output = await import(pathToFileURL(join(built.output, "index.mjs")).href) as Pick<Parameters<ServerModule["createServerApp"]>[0], "load" | "manifest">;
    const nonce = randomUUID().replaceAll("-", "");
    // No 'unsafe-inline': the theme script and the style of the icons run by their nonce.
    const policy = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'none'`;
    app = await createServerApp({
      manifest: output.manifest, load: output.load, production: false,
      assets: createNodeAssetReader({ root: join(built.output, "client"), assets: output.manifest.assets ?? {} }),
      document: { nonce: () => nonce },
    });
    const running = app;
    const posts: Array<{ status: number; location: string | null; cookie: string | null }> = [];
    server = createHttpServer(toNodeListener(async (request) => {
      const response = await running.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("content-security-policy", policy);
      if (request.method === "POST") posts.push({ status: response.status, location: headers.get("location"), cookie: headers.get("set-cookie") });
      return new Response(response.body, { status: response.status, headers });
    }));
    await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });

    // 1. "system" without a cookie on a dark system: the first frame already shows the system icon and the dark theme.
    const context = await browser.newContext({ colorScheme: "dark" });
    await context.addInitScript(toggleProbe);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
    await page.waitForFunction(() => (window as unknown as { __toggle: ToggleProbe }).__toggle.first !== undefined);
    const probe = () => page.evaluate(() => (window as unknown as { __toggle: ToggleProbe }).__toggle);
    const visible = () => page.evaluate(() => [...document.querySelectorAll("[data-meeko-theme-icon]")]
      .filter((icon) => getComputedStyle(icon).display !== "none").map((icon) => icon.getAttribute("data-meeko-theme-icon")!));
    assert.deepEqual((await probe()).first, { choice: "system", theme: "dark", icons: ["system"], count: 3 });
    // Hydration changed nothing visible: the same icon, no node of the toggle replaced.
    assert.deepEqual(await visible(), ["system"]);
    assert.ok((await probe()).changes.every((change) => /@(?:aria-label|value|tabindex|aria-checked)$/.test(change)), JSON.stringify((await probe()).changes));
    assert.equal(await page.locator(".toggle button").getAttribute("aria-label"), "Tema: sistema. Cambiar a claro");

    // 2. The cycle: light, dark, system, at once and without a navigation.
    const before = page.url();
    for (const [choice, theme] of [["light", "light"], ["dark", "dark"], ["system", "dark"]] as const) {
      await page.locator(".toggle button").click();
      await page.waitForFunction((expected) => document.documentElement.getAttribute("data-theme-choice") === expected, choice);
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), theme);
      assert.deepEqual(await visible(), [choice]);
    }
    assert.equal(page.url(), before);
    assert.equal(posts.length, 0, "with JavaScript the form never posts");
    assert.equal((await context.cookies(origin)).find((entry) => entry.name === "meeko-theme")?.value, "system");
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations), []);
    assert.deepEqual(errors, []);
    await context.close();

    // 3. Without JavaScript the button is a form: POST, 303 back to the page, and the server renders the new theme.
    const plain = await browser.newContext({ colorScheme: "dark", javaScriptEnabled: false });
    const noScript = await plain.newPage();
    const consoleErrors: string[] = [];
    noScript.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await noScript.goto(`${origin}/`);
    const shown = async (): Promise<string[]> => {
      const icons: string[] = [];
      for (const name of ["light", "dark", "system"]) if (await noScript.locator(`[data-meeko-theme-icon="${name}"]`).isVisible()) icons.push(name);
      return icons;
    };
    // Without a cookie and without the script, the CSS shows the default choice.
    assert.equal(await noScript.locator("html").getAttribute("data-theme-choice"), null);
    assert.deepEqual(await shown(), ["system"]);
    /** Clicks the button and waits for the document that the redirect brings. */
    const submit = async (): Promise<void> => {
      await Promise.all([noScript.waitForEvent("framenavigated"), noScript.locator(".toggle button").click()]);
      await noScript.waitForLoadState("load");
    };
    await submit();
    assert.equal(noScript.url(), `${origin}/`);
    assert.deepEqual(posts.at(-1), { status: 303, location: "/", cookie: "meeko-theme=light; Path=/; Max-Age=31536000; SameSite=Lax" });
    assert.equal(await noScript.locator("html").getAttribute("data-theme-choice"), "light");
    assert.equal(await noScript.locator("html").getAttribute("data-theme"), "light");
    assert.deepEqual(await shown(), ["light"]);
    await submit();
    assert.equal(await noScript.locator("html").getAttribute("data-theme-choice"), "dark");
    assert.deepEqual(await shown(), ["dark"]);
    assert.deepEqual(consoleErrors.filter((message) => /Content Security Policy/i.test(message)), []);
    await plain.close();
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await app?.close();
    await project.remove();
  }
});

const signupSchemas = `export interface SignupInput { email: string; password: string; confirm: string }
export interface SignupResult { email: string }
type Issue = { message: string; path: { key: string }[] };
type Validation<T> = { value: T; issues?: undefined } | { issues: Issue[] };

/** As Valibot would write it, with v.forward(v.partialCheck(...), ["confirm"]) for the confirmation. */
export const signupInput = {
  "~standard": {
    version: 1 as const,
    vendor: "e2e",
    types: undefined as { input: SignupInput; output: SignupInput } | undefined,
    validate(value: unknown): Validation<SignupInput> {
      const input = value as SignupInput;
      const issues: Issue[] = [];
      if (!input.email.includes("@")) issues.push({ message: "Escribe un correo válido.", path: [{ key: "email" }] });
      if (input.password.length < 10) issues.push({ message: "Usa al menos 10 caracteres.", path: [{ key: "password" }] });
      if (input.password !== input.confirm) issues.push({ message: "Las contraseñas no coinciden.", path: [{ key: "confirm" }] });
      return issues.length ? { issues } : { value: input };
    },
  },
};

export const signupResult = {
  "~standard": {
    version: 1 as const,
    vendor: "e2e",
    types: undefined as { input: SignupResult; output: SignupResult } | undefined,
    validate(value: unknown): Validation<SignupResult> { return { value: value as SignupResult }; },
  },
};
`;

const signupRoute = `import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { signupInput, signupResult } from "../../shared/schemas/signup.js";

export default defineApiRoute({
  body: signupInput,
  response: signupResult,
  status: 201,
  handler: ({ body }) => {
    if (body.email === "ada@example.com") {
      throw new ApiError("EMAIL_TAKEN", 409, { message: "duplicate key users_email", issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] });
    }
    return { email: body.email };
  },
});
`;

const signupField = `<script lang="ts">
import type { FormField } from "@meekojs/meeko/framework";
const props = defineProps<{ field: FormField<string>; label: string }>();
</script>
<template>
  <div class="field">
    <label bind:for="props.field.id">{props.label}</label>
    <input type="text" bind:id="props.field.id" bind:name="props.field.name" model="props.field.value"
      bind:aria-invalid="props.field.invalid.value ? 'true' : null" bind:aria-describedby="props.field.describedBy.value ?? null">
    <p class="error" if:when="props.field.error.value" bind:id="props.field.errorId">{props.field.error.value}</p>
  </div>
</template>
`;

const signupPage = `<script lang="ts">
import { signupInput } from "../../shared/schemas/signup.js";
const form = useForm({
  schema: signupInput,
  initial: { email: "", password: "", confirm: "" },
  submit: (values) => api.signup.post({ body: values }),
  focusInvalid: true,
  errorMessage: (failure) => isClientError(failure) ? failure.code : "network",
});
const created = signal("");
async function send(event: SubmitEvent): Promise<void> {
  const outcome = await form.trySubmit(event);
  if (outcome.ok) created.value = outcome.result.email;
}
</script>
<template>
  <form on:submit="send" novalidate>
    <AppField bind:field="form.field('email')" label="Correo" />
    <AppField bind:field="form.field('password')" label="Contraseña" />
    <AppField bind:field="form.field('confirm')" label="Repite la contraseña" />
    <p id="form-error">{form.error.value ?? ""}</p>
    <button id="send">Crear cuenta</button>
    <p id="created">{created.value}</p>
  </form>
</template>
`;

test("useForm en Chrome real: revalida la confirmación, lleva el 409 con issues al campo y enfoca el primer inválido", { timeout: 240_000 }, async () => {
  const project = await createTempProject("form-e2e");
  const root = project.root;
  type ServerModule = typeof import("../src/framework-server.ts");
  type NodeModule = typeof import("../src/node.ts");
  let server: import("node:http").Server | undefined;
  let app: Awaited<ReturnType<ServerModule["createServerApp"]>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const files: Record<string, string> = {
      "package.json": '{"name":"form-app","private":true,"type":"module"}\n',
      "meeko.config.mjs": 'export default { document: { idPrefix: "signup" } };\n',
      "shared/schemas/signup.ts": signupSchemas,
      "server/api/signup.post.ts": signupRoute,
      "app/components/AppField.meeko": signupField,
      "app/pages/index.meeko": signupPage,
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), contents);
    }
    await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
    // The api.* client of the page, as `meeko routes` and `meeko dev` generate it.
    await generateServerContracts(root);
    const built = await buildProject(root);
    const { createServerApp } = await import(pathToFileURL(resolve("dist/framework-server.js")).href) as ServerModule;
    const { createNodeAssetReader, toNodeListener } = await import(pathToFileURL(resolve("dist/node.js")).href) as NodeModule;
    const output = await import(pathToFileURL(join(built.output, "index.mjs")).href) as Pick<Parameters<ServerModule["createServerApp"]>[0], "load" | "manifest">;
    app = await createServerApp({
      manifest: output.manifest, load: output.load, production: false,
      assets: createNodeAssetReader({ root: join(built.output, "client"), assets: output.manifest.assets ?? {} }),
    });
    const running = app;
    server = createHttpServer(toNodeListener((request) => running.fetch(request)));
    await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" && !/409 \(Conflict\)/.test(message.text())) errors.push(message.text()); });
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);

    const input = (name: string) => page.locator(`input[name="${name}"]`);
    const message = (name: string) => page.locator(".field", { has: input(name) }).locator(".error");
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute("name") ?? null);

    // The IDs of form.field link label, control and message, with the prefix of meeko.config.
    const emailId = await input("email").getAttribute("id");
    assert.match(emailId ?? "", /^signup-[A-Za-z0-9_-]+-email$/);
    assert.equal(await page.locator("label", { hasText: "Correo" }).getAttribute("for"), emailId);

    // 1. The schema fails in two fields: the focus goes to the first one, once the messages are painted.
    await input("email").fill("ada@example.com");
    await input("password").fill("corta1");
    await input("confirm").fill("contrasena123");
    await page.locator("#send").click();
    await message("confirm").waitFor();
    assert.equal(await message("password").innerText(), "Usa al menos 10 caracteres.");
    assert.equal(await message("confirm").innerText(), "Las contraseñas no coinciden.");
    await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "password");
    assert.equal(await input("password").getAttribute("aria-invalid"), "true");
    assert.equal(await input("confirm").getAttribute("aria-describedby"), await message("confirm").getAttribute("id"));

    // 2. Fixing the password also clears the confirmation that depended on it.
    await input("password").fill("contrasena123");
    assert.equal(await page.locator(".error").count(), 0);
    assert.equal(await input("confirm").getAttribute("aria-invalid"), null);

    // 3. The server's 409 carries issues: the message lands on the email field, which takes the focus.
    await page.locator("#send").click();
    await message("email").waitFor();
    assert.equal(await message("email").innerText(), "Ese correo ya tiene una cuenta.");
    assert.equal(await page.locator("#form-error").innerText(), "");
    await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "email");
    assert.equal(await focused(), "email");
    assert.equal(await input("email").getAttribute("aria-describedby"), await message("email").getAttribute("id"));

    // 4. Changing the email drops the server's message; the next submission succeeds.
    await input("email").fill("grace@example.com");
    assert.equal(await message("email").count(), 0);
    await page.locator("#send").click();
    await page.locator("#created", { hasText: "grace@example.com" }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await app?.close();
    await project.remove();
  }
});

test("named layouts: the page chooses the layout and its props, the same layout keeps its state and another replaces it", { timeout: 240_000 }, async () => {
  const project = await createTempProject("named-layouts-e2e");
  const root = project.root;
  type ServerModule = typeof import("../src/framework-server.ts");
  type NodeModule = typeof import("../src/node.ts");
  let server: import("node:http").Server | undefined;
  let app: Awaited<ReturnType<ServerModule["createServerApp"]>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const files: Record<string, string> = {
      "package.json": '{"name":"layouts-app","private":true,"type":"module"}\n',
      "app/app.meeko": '<template><div id="shell"><MeekoOutlet /></div></template>\n',
      "app/layouts/dashboard.meeko": `<script lang="ts">
export interface Props { title?: string; showAlert?: boolean }
const props = defineProps<Props>({ title: "Panel", showAlert: false });
const filter = signal("");
</script>
<template><header id="title">{props.title}</header><p id="alert" if:when="props.showAlert">Revisa las conexiones</p><input id="sidebar" model="filter"><nav><MeekoLink to="/a" id="to-a">A</MeekoLink><MeekoLink to="/c" id="to-c">C</MeekoLink><MeekoLink to="/b" id="to-b">B</MeekoLink></nav><main><MeekoOutlet /></main></template>
`,
      "app/layouts/auth.meeko": '<template><section id="auth"><MeekoLink to="/a" id="auth-to-a">A</MeekoLink><MeekoOutlet /></section></template>\n',
      "app/pages/(dashboard)/+group.ts": 'export default defineGroup({ layout: "dashboard" });\n',
      "app/pages/(dashboard)/a.meeko": `<script server lang="ts">
export const route = definePage({ layoutProps: { title: "Conexiones", showAlert: true } });
</script>
<template><p id="page">a</p></template>
`,
      "app/pages/(dashboard)/c.meeko": `<script lang="ts">
const layout = useLayout();
const title = signal("Informe");
layout.set({ title: title.value });
effect(() => layout.set({ title: title.value }));
</script>
<template><p id="page">c</p><input id="c-title" model="title"></template>
`,
      "app/pages/b.meeko": `<script server lang="ts">
export const route = definePage({ layout: "auth" });
</script>
<template><p id="page">b</p></template>
`,
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), contents);
    }
    await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
    const built = await buildProject(root);
    const { createServerApp } = await import(pathToFileURL(resolve("dist/framework-server.js")).href) as ServerModule;
    const { createNodeAssetReader, toNodeListener } = await import(pathToFileURL(resolve("dist/node.js")).href) as NodeModule;
    const output = await import(pathToFileURL(join(built.output, "index.mjs")).href) as Pick<Parameters<ServerModule["createServerApp"]>[0], "load" | "manifest">;
    app = await createServerApp({
      manifest: output.manifest, load: output.load, production: false,
      assets: createNodeAssetReader({ root: join(built.output, "client"), assets: output.manifest.assets ?? {} }),
    });
    const running = app;
    server = createHttpServer(toNodeListener((request) => running.fetch(request)));
    await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    // What the page writes during its setup is in the first HTML, before any script runs.
    const ssr = (await (await fetch(`${origin}/c`)).text()).replace(/<!--[^>]*-->/g, "");
    assert.match(ssr, /<header id="title">Informe<\/header>/);
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/a`);
    await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
    assert.equal(await page.locator("#title").innerText(), "Conexiones");
    assert.equal(await page.locator("#alert").innerText(), "Revisa las conexiones");
    // State of the layout: what the user typed and a mark on its node.
    await page.locator("#sidebar").fill("búsqueda");
    await page.evaluate(() => { (document.getElementById("sidebar") as HTMLInputElement & { mark?: number }).mark = 1; (window as unknown as { kept: number }).kept = 1; });
    await page.locator("#to-c").click();
    await page.locator("#page", { hasText: "c" }).waitFor();
    // Same layout: same node, same value; the props are those of c, nothing of a stays.
    assert.equal(await page.evaluate(() => (document.getElementById("sidebar") as HTMLInputElement & { mark?: number }).mark), 1);
    assert.equal(await page.locator("#sidebar").inputValue(), "búsqueda");
    assert.equal(await page.locator("#title").innerText(), "Informe");
    assert.equal(await page.locator("#alert").count(), 0);
    // The page writes the layout's title reactively.
    await page.locator("#c-title").fill("Informe mensual");
    await page.locator("#title", { hasText: "Informe mensual" }).waitFor();
    assert.equal(await page.evaluate(() => (document.getElementById("sidebar") as HTMLInputElement & { mark?: number }).mark), 1, "a prop change does not remount the layout");
    // Another layout replaces the dashboard.
    await page.locator("#to-b").click();
    await page.locator("#auth").waitFor();
    assert.equal(await page.locator("#sidebar").count(), 0);
    assert.equal(await page.locator("#alert").count(), 0);
    await page.locator("#auth-to-a").click();
    await page.locator("#alert").waitFor();
    assert.equal(await page.locator("#title").innerText(), "Conexiones");
    assert.equal(await page.locator("#sidebar").inputValue(), "", "a new dashboard starts empty");
    assert.equal(await page.evaluate(() => (window as unknown as { kept?: number }).kept), 1, "every navigation stayed in the client");
    // Straight to /c: it hydrates the title its setup wrote on the server, without a mismatch.
    await page.goto(`${origin}/c`);
    await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
    assert.equal(await page.locator("#title").innerText(), "Informe");
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await app?.close();
    await project.remove();
  }
});

/** What `<MeekoAwait>` showed in the first frame, every layout shift and the CSP violations. */
type AwaitProbe = {
  first?: { state: string | null; height: number; skeleton: boolean };
  /** Every `layout-shift` entry, with what moved (`NODE.class YxH->YxH`, top and height) to explain a failure. */
  shifts: Array<{ value: number; time: number; recent: boolean; sources: string }>;
  lists: number[];
};

/** Records, from the start of each document, the first frame of the zone and every `layout-shift` entry. */
const awaitProbe = (): void => {
  // No named function inside: the test runner would wrap it with a helper that the page lacks.
  const probe: AwaitProbe = { shifts: [], lists: [] };
  Object.assign(window, { __await: probe });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as unknown as Array<{ value: number; startTime: number; hadRecentInput: boolean; sources?: Array<{ node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) {
      probe.shifts.push({ value: entry.value, time: entry.startTime, recent: entry.hadRecentInput, sources: (entry.sources ?? []).map((source) => `${source.node?.nodeName}.${(source.node as Element | undefined)?.className ?? ""} ${source.previousRect.y}x${source.previousRect.height}->${source.currentRect.y}x${source.currentRect.height}`).join(" | ") });
    }
  }).observe({ type: "layout-shift", buffered: true });
  // The first frame: rendering waits for <head>, so this is what the first paint shows.
  requestAnimationFrame(() => {
    const zone = document.querySelector("[data-meeko-await]");
    if (zone) probe.first = { state: zone.getAttribute("data-meeko-await"), height: zone.getBoundingClientRect().height, skeleton: zone.querySelector(".skeleton") !== null };
  });
  const violations: string[] = [];
  Object.assign(window, { __cspViolations: violations });
  document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective} ${event.blockedURI}`));
};

/** A card that lists items loaded without await; `reserve` decides whether the zone remembers its height. */
const awaitCard = (reserve: boolean): string => `<script lang="ts">
const items = useApi("/api/items");
</script>
<template><main><MeekoLink id="back" to="/">Inicio</MeekoLink><section class="card"><h2>Items</h2><MeekoAwait for="items"${reserve ? " reserve" : ""}><snippet name="pending"><p class="skeleton">Cargando…</p></snippet><snippet name="error" params="error, retry"><p role="alert">No se pudo cargar. <button on:click="retry">Reintentar</button></p></snippet><ul class="items"><li each:of="items.data.value" each:as="item" each:key="item.id">{item.name}</li></ul></MeekoAwait><button id="reload" type="button" on:click="() => items.refresh()">Recargar</button></section><footer class="after">Pie de página</footer></main></template>
`;

test("<MeekoAwait reserve> keeps a card with late data from shifting the page on a second visit, under a strict CSP", { timeout: 300_000 }, async () => {
  const project = await createTempProject("await-e2e");
  const root = project.root;
  type ServerModule = typeof import("../src/framework-server.ts");
  type NodeModule = typeof import("../src/node.ts");
  let server: import("node:http").Server | undefined;
  let app: Awaited<ReturnType<ServerModule["createServerApp"]>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const files: Record<string, string> = {
      "package.json": '{"name":"await-app","private":true,"type":"module"}\n',
      "app/styles/main.css": [
        "body { margin: 0; font: 16px/20px sans-serif; }",
        "p { margin: 0; }",
        ".card { width: 420px; padding: 8px; }",
        "h2 { margin: 0; height: 30px; }",
        ".skeleton { margin: 0; height: 60px; }",
        ".items { margin: 0; padding: 0; list-style: none; }",
        ".items li { height: 40px; }",
        ".after { height: 400px; background: #eee; }",
      ].join("\n"),
      "app/pages/index.meeko": '<template><main><p id="home">Inicio</p><MeekoLink id="to-reserve" to="/reserve">Con reserva</MeekoLink> <MeekoLink id="to-plain" to="/plain">Sin reserva</MeekoLink></main></template>\n',
      "app/pages/reserve.meeko": awaitCard(true),
      "app/pages/plain.meeko": awaitCard(false),
      // Latency: the data arrives well after the first paint and after the 500 ms that follow a click.
      "shared/schemas/items.ts": `export type Item = { id: number; name: string };
export const items = { "~standard": { version: 1 as const, vendor: "e2e", types: undefined as unknown as { input: Item[]; output: Item[] }, validate: (value: unknown) => ({ value: value as Item[] }) } };
`,
      "server/api/items/index.get.ts": `import { items } from "../../../shared/schemas/items.js";
export default defineApiRoute({
  response: items,
  handler: async () => {
    await new Promise((done) => setTimeout(done, 900));
    return Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: \`Item \${index + 1}\` }));
  },
});
`,
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), contents);
    }
    await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
    // The generated clients autoimport useApi, as meeko build and meeko check prepare them.
    await prepareFrameworkTypes(root);
    const built = await buildProject(root);
    const { createServerApp } = await import(pathToFileURL(resolve("dist/framework-server.js")).href) as ServerModule;
    const { createNodeAssetReader, toNodeListener } = await import(pathToFileURL(resolve("dist/node.js")).href) as NodeModule;
    const output = await import(pathToFileURL(join(built.output, "index.mjs")).href) as Pick<Parameters<ServerModule["createServerApp"]>[0], "load" | "manifest">;
    const nonce = randomUUID().replaceAll("-", "");
    // No 'unsafe-inline': the script of the memory runs by its nonce, its rules go through the CSSOM.
    const policy = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'`;
    app = await createServerApp({
      manifest: output.manifest, load: output.load, production: false,
      assets: createNodeAssetReader({ root: join(built.output, "client"), assets: output.manifest.assets ?? {} }),
      document: { nonce: () => nonce },
    });
    const running = app;
    server = createHttpServer(toNodeListener(async (request) => {
      const response = await running.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("content-security-policy", policy);
      return new Response(response.body, { status: response.status, headers });
    }));
    await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await context.addInitScript(awaitProbe);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const probe = () => page.evaluate(() => (window as unknown as { __await: AwaitProbe }).__await);
    /** Layout shifts since `since` (ms of the document): every entry, also those right after a click. */
    const shiftsSince = async (since: number): Promise<number> => (await probe()).shifts.filter((entry) => entry.time >= since).reduce((total, entry) => total + entry.value, 0);
    /** Waits for the data and for the layout-shift entries of its frame. */
    const ready = async (): Promise<void> => {
      await page.waitForSelector("[data-meeko-await=ready] .items li");
      await page.waitForTimeout(400);
    };
    const load = async (path: string): Promise<void> => {
      await page.goto(`${origin}${path}`);
      await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
    };
    const navigate = async (link: string): Promise<number> => {
      const since = await page.evaluate(() => performance.now());
      await page.locator(link).click();
      return since;
    };
    const measures: Record<string, number> = {};

    // 1. First visit: the skeleton in the first frame; without memory the zone grows once, no more than without reserve.
    await load("/reserve");
    const first = (await probe()).first;
    assert.equal(first?.state, "pending");
    assert.equal(first?.skeleton, true);
    assert.equal(await page.locator("[data-meeko-await]").getAttribute("aria-busy"), "true");
    await ready();
    measures.firstReserve = await shiftsSince(0);
    const zoneHeight = await page.locator("[data-meeko-await]").evaluate((zone) => zone.getBoundingClientRect().height);
    assert.equal(zoneHeight, 320);
    const memory = JSON.parse(await page.evaluate(() => sessionStorage.getItem("meeko:await") ?? "{}")) as Record<string, number>;
    assert.deepEqual(Object.values(memory), [320], "the height with data is remembered");
    await load("/plain");
    await ready();
    measures.firstPlain = await shiftsSince(0);
    assert.ok(measures.firstPlain > 0.05, `the card shifts the page without a reserve: ${measures.firstPlain}`);
    assert.ok(measures.firstReserve <= measures.firstPlain + 0.005, `the first visit shifts no more than the skeleton: ${JSON.stringify(measures)}`);

    // 2. Second visit by client navigation: the zone is inserted with the remembered height.
    await load("/");
    let since = await navigate("#to-reserve");
    await page.waitForSelector("[data-meeko-await=pending]");
    assert.equal(await page.locator("[data-meeko-await]").evaluate((zone) => zone.getBoundingClientRect().height), 320, "reserved while pending");
    await ready();
    measures.navigationReserve = await shiftsSince(since);
    since = await navigate("#back");
    await page.waitForSelector("#to-plain");
    since = await navigate("#to-plain");
    await ready();
    measures.navigationPlain = await shiftsSince(since);
    assert.ok(measures.navigationReserve < 0.01, `no shift with the memory: ${JSON.stringify(measures)} ${JSON.stringify((await probe()).shifts)}`);
    assert.ok(measures.navigationPlain > 0.05, `the same navigation shifts without reserve: ${JSON.stringify(measures)}`);

    // 3. Second visit by a full load: the script of <head> reserves the height before the first paint.
    await load("/reserve");
    const reloaded = (await probe()).first;
    assert.equal(reloaded?.state, "pending");
    assert.equal(reloaded?.height, 320, "the first frame already has the remembered height");
    await ready();
    measures.reloadReserve = await shiftsSince(0);
    await load("/plain");
    await ready();
    measures.reloadPlain = await shiftsSince(0);
    assert.ok(measures.reloadReserve < 0.01, `no shift on a reload with the memory: ${JSON.stringify(measures)}`);
    assert.ok(measures.reloadPlain > 0.05, JSON.stringify(measures));

    // 4. A refresh keeps the list on screen (keepPrevious), marks the zone and never empties it.
    await load("/reserve");
    await ready();
    await page.evaluate(() => {
      const probe = (window as unknown as { __await: AwaitProbe }).__await;
      new MutationObserver(() => { probe.lists.push(document.querySelectorAll(".items li").length); })
        .observe(document.querySelector("[data-meeko-await]")!, { subtree: true, childList: true, attributes: true });
    });
    since = await navigate("#reload");
    await page.waitForSelector("[data-meeko-await][data-meeko-refreshing][aria-busy=true]");
    assert.equal(await page.locator(".items li").count(), 8);
    await page.waitForSelector("[data-meeko-await]:not([data-meeko-refreshing]):not([aria-busy])");
    const lists = (await probe()).lists;
    assert.ok(lists.length > 0 && lists.every((count) => count === 8), `the list never emptied: ${JSON.stringify(lists)}`);
    measures.refresh = await shiftsSince(since);
    assert.ok(measures.refresh < 0.01, JSON.stringify(measures));

    assert.deepEqual(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations), []);
    assert.deepEqual(errors, []);
    console.log(`[await e2e] layout shift (CLS) by visit: ${JSON.stringify(Object.fromEntries(Object.entries(measures).map(([name, value]) => [name, Number(value.toFixed(4))])))}`);
    await context.close();
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await app?.close();
    await project.remove();
  }
});

/** A button that is a link when it receives `href`, with one template for both tags. */
const dynamicButton = `<script lang="ts">
import { computed } from "@meekojs/meeko";
const props = defineProps<{ href?: string; target?: string; type?: "button" | "submit" | "reset"; disabled?: boolean; loading?: boolean }>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
const snippets = defineSnippets<{ default?: []; leading?: []; trailing?: [] }>();
const inactive = computed(() => Boolean(props.disabled || props.loading));
const rel = computed(() => props.target === "_blank" ? "noopener noreferrer" : undefined);
const state = computed(() => ({ "data-loading": props.loading ? "" : undefined, "aria-disabled": inactive.value ? "true" : undefined }));
function onClick(event: MouseEvent): void {
  if (inactive.value) {
    event.preventDefault();
    return;
  }
  emit("click", event);
}
</script>
<template>
  <component is="props.href ? 'a' : 'button'" class="button" bind="state.value" on:click="onClick"
    bind:href="inactive.value ? undefined : props.href" bind:target="props.target" bind:rel="rel.value"
    bind:type="props.type" bind:disabled="props.disabled">
    <span if:when="props.loading" class="button__spinner" aria-hidden="true"></span>
    <span class="button__label"><render snippet="snippets.leading" /><render snippet="snippets.default" /><render snippet="snippets.trailing" /></span>
  </component>
</template>
`;

test("un <component is> con etiqueta pasa de <button> a <a> al recibir href y conserva el foco y el texto", { timeout: 240_000 }, async () => {
  const project = await createTempProject("dynamic-tag-e2e");
  const root = project.root;
  type ServerModule = typeof import("../src/framework-server.ts");
  type NodeModule = typeof import("../src/node.ts");
  let server: import("node:http").Server | undefined;
  let app: Awaited<ReturnType<ServerModule["createServerApp"]>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const files: Record<string, string> = {
      "package.json": '{"name":"dynamic-tag-app","private":true,"type":"module"}\n',
      "meeko.config.mjs": "export default {};\n",
      "app/components/Button.meeko": dynamicButton,
      "app/pages/index.meeko": `<script lang="ts">
import { signal } from "@meekojs/meeko";
const href = signal("");
const clicks = signal(0);
function open(): void {
  clicks.value++;
  href.value = "/docs";
}
</script>
<template><main><Button bind:href="href.value || undefined" type="button" on:click="open"><input class="inside" value="">Abrir</Button><p id="clicks">{clicks.value}</p></main></template>
`,
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), contents);
    }
    await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
    const built = await buildProject(root);
    const { createServerApp } = await import(pathToFileURL(resolve("dist/framework-server.js")).href) as ServerModule;
    const { createNodeAssetReader, toNodeListener } = await import(pathToFileURL(resolve("dist/node.js")).href) as NodeModule;
    const output = await import(pathToFileURL(join(built.output, "index.mjs")).href) as Pick<Parameters<ServerModule["createServerApp"]>[0], "load" | "manifest">;
    app = await createServerApp({
      manifest: output.manifest, load: output.load, production: false,
      assets: createNodeAssetReader({ root: join(built.output, "client"), assets: output.manifest.assets ?? {} }),
    });
    const running = app;
    server = createHttpServer(toNodeListener((request) => running.fetch(request)));
    await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const html = await (await fetch(`${origin}/`)).text();
    // The server renders a <button> with its type and without target or href.
    assert.match(html, /<button class="button" type="button" data-meeko="0">/);
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
    // The text typed in a control inside the button survives the change of tag.
    await page.locator("input.inside").fill("hola");
    await page.locator("button.button").focus();
    await page.keyboard.press("Enter");
    await page.locator("a.button").waitFor();
    assert.equal(await page.locator("#clicks").innerText(), "1");
    const link = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      const anchor = document.querySelector("a.button") as HTMLAnchorElement;
      return {
        focused: active === anchor, href: anchor.getAttribute("href"), type: anchor.hasAttribute("type"),
        text: anchor.innerText.trim(), input: (anchor.querySelector("input.inside") as HTMLInputElement).value, buttons: document.querySelectorAll("button.button").length,
      };
    });
    assert.deepEqual(link, { focused: true, href: "/docs", type: false, text: "Abrir", input: "hola", buttons: 0 });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await app?.close();
    await project.remove();
  }
});
