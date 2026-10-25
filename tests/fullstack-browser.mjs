import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const origin = `http://127.0.0.1:${process.env.MEEKO_TEST_PORT ?? "4387"}`;
const channel = process.env.MEEKO_BROWSER_CHANNEL ?? "chrome";
const browser = await chromium.launch({ channel, headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`${message.text()} @ ${message.location().url}`); });
  page.on("response", (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  assert.equal((await page.goto(`${origin}/`))?.status(), 200);
  await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length === 1);
  await page.locator(".app-shell").evaluate((element) => element.setAttribute("data-kept", "yes"));
  await page.locator('a[href="/users"]').click();
  await page.waitForURL(`${origin}/users`);
  assert.equal(await page.locator("#users-data").innerText(), "Ada");
  assert.equal(await page.locator(".app-shell").getAttribute("data-kept"), "yes");
  await page.locator("#get-user").click();
  await page.waitForFunction(() => document.querySelector("#users-result")?.textContent?.includes("User 123"));
  await page.locator("#post-user").click();
  await page.waitForFunction(() => document.querySelector("#users-result")?.textContent?.includes("Grace"));
  const login = await page.evaluate(async () => {
    const response = await fetch("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: "alice" }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(login.status, 200);
  await page.locator('a[href="/dashboard"]').click();
  await page.waitForURL(`${origin}/dashboard`);
  assert.equal(await page.locator("#dashboard-user").innerText(), "alice");
  await page.locator('a[href="/chat"]').click();
  await page.waitForURL(`${origin}/chat`);
  await page.waitForTimeout(400);
  await page.locator("#send-chat").click();
  await page.waitForFunction(() => document.querySelector("#chat-result")?.textContent?.includes("Hola"));
  await page.locator("#send-direct").click();
  await page.waitForFunction(() => document.querySelector("#direct-result")?.textContent?.includes("Direct"));
  // SSR -> render: "client" -> SSR, keeping the layout instance.
  await page.locator('a[href="/notes"]').click();
  await page.waitForURL(`${origin}/notes`);
  await page.waitForFunction(() => document.querySelector("#notes-data")?.textContent === "Ada");
  assert.equal(await page.title(), "Notes: Ada");
  assert.equal(await page.locator(".app-shell").getAttribute("data-kept"), "yes");
  await page.locator('a[href="/users"]').click();
  await page.waitForURL(`${origin}/users`);
  assert.equal(await page.locator("#users-data").innerText(), "Ada");
  assert.equal(await page.title(), "Users: Ada");
  assert.equal(await page.locator("#notes-data").count(), 0);
  assert.equal(await page.locator(".app-shell").getAttribute("data-kept"), "yes");
  // SSR -> client again, then back through the browser history.
  await page.locator('a[href="/notes"]').click();
  await page.waitForURL(`${origin}/notes`);
  await page.waitForFunction(() => document.querySelector("#notes-data")?.textContent === "Ada");
  await page.goBack();
  await page.waitForURL(`${origin}/users`);
  await page.waitForFunction(() => document.title === "Users: Ada");
  assert.equal(await page.locator("#notes-data").count(), 0);
  await page.goForward();
  await page.waitForURL(`${origin}/notes`);
  await page.waitForFunction(() => document.querySelector("#notes-data")?.textContent === "Ada" && document.title === "Notes: Ada");
  // First load of a client page: the browser loader fills the empty outlet.
  assert.equal((await page.goto(`${origin}/notes`))?.status(), 200);
  await page.waitForFunction(() => document.querySelector("#notes-data")?.textContent === "Ada");
  assert.equal(await page.title(), "Notes: Ada");
  await page.locator('a[href="/dashboard"]').click();
  await page.waitForURL(`${origin}/dashboard`);
  assert.equal(await page.locator("#dashboard-user").innerText(), "alice");
  await page.locator('a[href="/layer-demo"]').click();
  await page.waitForURL(`${origin}/layer-demo`);
  assert.match(await page.locator("#layer-demo").innerText(), /Layer route works/);
  assert.deepEqual(errors, []);
  console.log(`${channel} SSR/hydration, persistent layout, navigation, API, dashboard, client page and WebSocket: OK`);
} finally { await browser.close(); }
