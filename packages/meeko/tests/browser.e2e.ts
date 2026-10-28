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
