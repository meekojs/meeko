import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { createServer, preview } from "vite";
import { createExampleServer } from "../examples/counter/server.ts";

async function assertBrowserBehavior(url: string): Promise<void> {
  const browser = await chromium.launch({
    ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url, { waitUntil: "networkidle" });
    assert.match(await page.locator("#app button").innerText(), /^2 · doble: 4$/);
    await page.locator("#app button").click();
    assert.match(await page.locator("#app button").innerText(), /^3 · doble: 6$/);

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
    await assertBrowserBehavior(`http://127.0.0.1:${address.port}/`);
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
    await assertBrowserBehavior(`http://127.0.0.1:${address.port}/`);
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
    browser = await chromium.launch({
      ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
      headless: true,
    });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
