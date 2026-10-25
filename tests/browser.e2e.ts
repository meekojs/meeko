import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { createServer, preview } from "vite";
import { createExampleServer } from "../examples/counter/server.ts";
import { startConformanceOutput } from "./conformance/harness.ts";

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
