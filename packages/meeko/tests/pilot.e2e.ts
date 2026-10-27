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
type LaunchedBrowser = Awaited<ReturnType<typeof chromium.launch>>;
// A failed browser launch may leave Playwright cleanup pending. The runner uses
// --test-force-exit after all engines report, while per-engine timeouts bound failures.
const browserTimeoutMs = 12_000;
// Budget for one engine's contract: launch, page flow and assertions.
const engineTimeoutMs = 18_000;
// Closing the browser is teardown, not part of the contract. Firefox's graceful
// shutdown (built-in extensions, profile SQLite, telemetry) can take 15-30 s on a
// CPU-starved Windows runner even for a static page, so it runs outside the
// per-engine budget and is bounded by the suite timeout instead.
const suiteTimeoutMs = 150_000;

/** Records how long each step took so a timeout shows where the engine stopped. */
function createTimeline() {
  const started = performance.now();
  let previous = started;
  const steps: string[] = [];
  const notes: string[] = [];
  const elapsed = () => Math.round(performance.now() - started);
  return {
    mark(step: string): void {
      const now = performance.now();
      steps.push(`${step} +${Math.round(now - previous)}ms`);
      previous = now;
    },
    note(text: string): void {
      notes.push(`${text} @${elapsed()}ms`);
    },
    summary(): string {
      const lines = [`steps (${elapsed()}ms): ${steps.join(", ") || "none"}`];
      if (notes.length > 0) lines.push(`browser messages: ${notes.join(" | ")}`);
      return lines.join("\n  ");
    },
  };
}
type Timeline = ReturnType<typeof createTimeline>;

/** Comprueba el HTML servido antes de abrir un navegador. */
async function assertServedHtml(base: string, production: boolean): Promise<void> {
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
}

/** Ejecuta el mismo contrato observable en un navegador ya iniciado. */
async function assertPilotFlow(base: string, browser: LaunchedBrowser, timeline: Timeline): Promise<void> {
  const page = await browser.newPage();
  page.setDefaultTimeout(browserTimeoutMs);
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    timeline.note(`pageerror: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = `${message.text()} @ ${message.location().url}`;
    consoleErrors.push(text);
    timeline.note(`console.error: ${text}`);
  });
  timeline.mark("newPage");
  await page.goto(base, { waitUntil: "networkidle", timeout: browserTimeoutMs });
  timeline.mark("goto");
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
  timeline.mark("hydrated");
  assert.equal(await page.locator(".task-list li").count(), 2);

  const designCard = page.locator('[data-id="design"]');
  await designCard.locator(".task-details").click();
  assert.match(await designCard.innerText(), /Validar jerarquía y accesibilidad/);
  await designCard.locator(".state-button").click();
  assert.equal(await page.locator('[data-id="design"]').count(), 0);
  assert.equal(await page.locator(".summary").innerText(), "1 pendientes");
  await page.locator('[data-id="tests"] .task-details').click();
  timeline.mark("toggle");

  await page.locator("#new-task").fill("Probar formulario");
  await page.getByRole("button", { name: "Agregar" }).click();
  assert.equal(await page.locator(".task-list li").count(), 2);
  assert.match(await page.locator(".task-list li").first().innerText(), /Probar formulario/);
  assert.match(await page.locator('[data-id="tests"]').innerText(), /Probar la página servida/);
  timeline.mark("form");

  await page.getByRole("button", { name: "Sincronizar API" }).click();
  await page.getByRole("status").getByText("Datos actualizados desde la API.").waitFor();
  assert.equal(await page.locator(".task-list li").count(), 3);
  assert.match(await page.locator('[data-id="release"]').innerText(), /Preparar lanzamiento/);
  timeline.mark("sync");

  await page.getByRole("link", { name: "Terminadas" }).click();
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
  assert.equal(new URL(page.url()).pathname, "/completed");
  assert.equal(await page.locator(".task-list li").count(), 1);
  assert.match(await page.locator(".task-list li").first().innerText(), /Documentar el motor/);
  timeline.mark("navigation");

  assert.deepEqual(consoleErrors, []);
  await page.route("**/api/tasks", (route) => route.abort());
  await page.getByRole("button", { name: "Sincronizar API" }).click();
  await page.getByRole("alert").getByText("No se pudieron sincronizar las tareas. Inténtalo de nuevo.").waitFor();
  assert.equal(await page.locator(".task-list li").count(), 1);
  assert.deepEqual(errors, []);
  timeline.mark("sync error");
}

/** Recorre los tres motores; el cierre del navegador queda fuera del presupuesto de cada uno. */
async function runPilotEngines(context: test.TestContext, base: string, production: boolean): Promise<void> {
  const environment = production ? "production" : "development";
  for (const engine of Object.keys(browsers) as PilotBrowser[]) {
    const label = `${environment}/${engine}`;
    const timeline = createTimeline();
    let launching: Promise<LaunchedBrowser> | undefined;
    console.log(`[pilot:e2e] ${label}: start`);
    try {
      await context.test(engine, { timeout: engineTimeoutMs }, async () => {
        await assertServedHtml(base, production);
        timeline.mark("http");
        launching = browsers[engine].launch({
          headless: true,
          timeout: browserTimeoutMs,
          ...(engine === "chromium" && process.env.MEEKO_CHROME_PATH
            ? { executablePath: process.env.MEEKO_CHROME_PATH }
            : {}),
        });
        const browser = await launching;
        timeline.mark("launch");
        await assertPilotFlow(base, browser, timeline);
      });
    } finally {
      console.log(`[pilot:e2e] ${label}: ${timeline.summary()}`);
      const browser = await launching?.catch(() => undefined);
      const closing = performance.now();
      await browser?.close();
      console.log(`[pilot:e2e] ${label}: finished (browser closed in ${Math.round(performance.now() - closing)}ms)`);
    }
  }
}

test("el piloto entrega SSR e hidrata en desarrollo", { timeout: suiteTimeoutMs }, async (context) => {
  const pilot = await createPilotServer();
  await new Promise<void>((ready) => pilot.server.listen(0, "127.0.0.1", ready));
  const address = pilot.server.address() as AddressInfo;
  try {
    await runPilotEngines(context, `http://127.0.0.1:${address.port}`, false);
  } finally {
    await pilot.close();
  }
});

test("el piloto entrega SSR e hidrata los artefactos de producción", { timeout: suiteTimeoutMs }, async (context) => {
  await buildPilot();
  const moduleUrl = pathToFileURL(resolve("examples/pilot/.output/server/http.js")).href;
  const productionModule = await import(moduleUrl) as { createProductionPilotServer(): Promise<import("node:http").Server> };
  const server = await productionModule.createProductionPilotServer();
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address() as AddressInfo;
  try {
    await runPilotEngines(context, `http://127.0.0.1:${address.port}`, true);
  } finally {
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  }
});
