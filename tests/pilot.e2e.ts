import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { chromium, firefox, webkit } from "playwright-core";
import { buildPilot } from "../examples/pilot/build.ts";
import { createPilotServer } from "../examples/pilot/server.ts";

const browsers = { chromium, firefox, webkit } as const;
type PilotBrowser = keyof typeof browsers;
// A failed browser launch may leave Playwright cleanup pending. The runner uses
// --test-force-exit after all engines report, while per-engine timeouts bound failures.
const browserTimeoutMs = 12_000;

/** Ejecuta el mismo contrato observable en un motor y entorno concretos. */
async function assertPilotFlow(base: string, production: boolean, engine: PilotBrowser): Promise<void> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Bandeja de trabajo/);
    assert.match(html, /Revisar el diseño/);
    assert.match(html, /meeko-payload/);
    assert.doesNotMatch(html, /Preparar lanzamiento/);
    if (production) {
      assert.match(html, /src="\/client\.js"/);
      assert.doesNotMatch(html, /\/client\.ts|\/@vite\/client/);
      const client = await fetch(`${base}/client.js`);
      assert.equal(client.status, 200);
      assert.match(client.headers.get("content-type") ?? "", /text\/javascript/);
      assert.equal((await fetch(`${base}/style.css`)).status, 200);
      assert.equal((await fetch(`${base}/meeko-logo.png`)).status, 200);
    }
    const completedResponse = await fetch(`${base}/completed`);
    assert.equal(completedResponse.status, 200);
    assert.match(await completedResponse.text(), /Documentar el motor/);

    browser = await browsers[engine].launch({
      headless: true,
      timeout: browserTimeoutMs,
      ...(engine === "chromium" && process.env.MEEKO_CHROME_PATH
        ? { executablePath: process.env.MEEKO_CHROME_PATH }
        : {}),
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(browserTimeoutMs);
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(`${message.text()} @ ${message.location().url}`);
    });
    await page.goto(base, { waitUntil: "networkidle", timeout: browserTimeoutMs });
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    assert.equal(await page.locator(".task-list li").count(), 2);

    const designCard = page.locator('[data-id="design"]');
    await designCard.locator(".task-details").click();
    assert.match(await designCard.innerText(), /Validar jerarquía y accesibilidad/);
    await designCard.locator(".state-button").click();
    assert.equal(await page.locator('[data-id="design"]').count(), 0);
    assert.equal(await page.locator(".summary").innerText(), "1 pendientes");
    await page.locator('[data-id="tests"] .task-details').click();

    await page.locator("#new-task").fill("Probar formulario");
    await page.getByRole("button", { name: "Agregar" }).click();
    assert.equal(await page.locator(".task-list li").count(), 2);
    assert.match(await page.locator(".task-list li").first().innerText(), /Probar formulario/);
    assert.match(await page.locator('[data-id="tests"]').innerText(), /Probar la página servida/);

    await page.getByRole("button", { name: "Sincronizar API" }).click();
    await page.getByRole("status").getByText("Datos actualizados desde la API.").waitFor();
    assert.equal(await page.locator(".task-list li").count(), 3);
    assert.match(await page.locator('[data-id="release"]').innerText(), /Preparar lanzamiento/);

    await page.getByRole("link", { name: "Terminadas" }).click();
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    assert.equal(new URL(page.url()).pathname, "/completed");
    assert.equal(await page.locator(".task-list li").count(), 1);
    assert.match(await page.locator(".task-list li").first().innerText(), /Documentar el motor/);

    assert.deepEqual(consoleErrors, []);
    await page.route("**/api/tasks", (route) => route.abort());
    await page.getByRole("button", { name: "Sincronizar API" }).click();
    await page.getByRole("alert").getByText("No se pudieron sincronizar las tareas. Inténtalo de nuevo.").waitFor();
    assert.equal(await page.locator(".task-list li").count(), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
  }
}

test("el piloto entrega SSR e hidrata en desarrollo", { timeout: 60_000 }, async (context) => {
  const pilot = await createPilotServer();
  await new Promise<void>((ready) => pilot.server.listen(0, "127.0.0.1", ready));
  const address = pilot.server.address() as AddressInfo;
  try {
    for (const engine of Object.keys(browsers) as PilotBrowser[]) {
      console.log(`[pilot:e2e] development/${engine}: start`);
      await context.test(engine, { timeout: 18_000 }, () => assertPilotFlow(`http://127.0.0.1:${address.port}`, false, engine));
      console.log(`[pilot:e2e] development/${engine}: finished`);
    }
  } finally {
    await pilot.close();
  }
});

test("el piloto entrega SSR e hidrata los artefactos de producción", { timeout: 60_000 }, async (context) => {
  await buildPilot();
  const moduleUrl = pathToFileURL(resolve("examples/pilot/.output/server/http.js")).href;
  const productionModule = await import(moduleUrl) as { createProductionPilotServer(): Promise<import("node:http").Server> };
  const server = await productionModule.createProductionPilotServer();
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address() as AddressInfo;
  try {
    for (const engine of Object.keys(browsers) as PilotBrowser[]) {
      console.log(`[pilot:e2e] production/${engine}: start`);
      await context.test(engine, { timeout: 18_000 }, () => assertPilotFlow(`http://127.0.0.1:${address.port}`, true, engine));
      console.log(`[pilot:e2e] production/${engine}: finished`);
    }
  } finally {
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});
