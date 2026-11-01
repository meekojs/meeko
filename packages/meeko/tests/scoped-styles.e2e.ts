import type { Browser, Page } from "playwright-core";

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";

import { initFrameworkProject } from "../src/framework/init.ts";
import { linkRepositoryPackages, repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

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

async function until(condition: () => boolean, message: () => string, timeout = 60_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(message());
    await new Promise((done) => setTimeout(done, 50));
  }
}

const card = (color: string, extra = "p { margin: 10px; }") => `<template>
  <article class="card"><h2 class="title">Card</h2><p class="body">Body</p></article>
</template>

<style scoped>
@import "../styles/tokens.css";
.card { color: ${color}; padding: var(--card-padding); display: flex; gap: 8px; }
.card .title { margin: 0; }
${extra}
</style>
`;

/**
 * A project whose global stylesheet has rules with the specificity of the scoped ones: the sheet
 * that comes later in the cascade wins, so any reordering between the first paint and the
 * hydrated page shows in the computed styles.
 */
async function writeProject(root: string): Promise<void> {
  await initFrameworkProject(root);
  await writeFile(join(root, "app", "styles", "main.css"), `.page .card { color: rgb(1, 1, 1); padding: 1px; }
p.body { margin: 3px; }
`);
  await writeFile(join(root, "app", "styles", "tokens.css"), ":root { --card-padding: 24px; }\n");
  await mkdir(join(root, "app", "components"), { recursive: true });
  await writeFile(join(root, "app", "components", "Card.meeko"), card("rgb(200, 0, 0)"));
  await writeFile(join(root, "app", "pages", "index.meeko"), `<script lang="ts">
const count = signal(0);
</script>

<template>
  <section class="page">
    <Card />
    <button id="count" type="button" on:click="() => count.value++">{count.value}</button>
  </section>
</template>

<style scoped>
.page { border: 3px solid rgb(9, 9, 9); }
</style>
`);
  // `meeko start` needs a session store; memory is enough for one test.
  await mkdir(join(root, "server"), { recursive: true });
  await writeFile(join(root, "server", "runtime.ts"), `import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(() => ({ sessions: new SessionManager({ store: new MemorySessionStore(), production: false }) }));
`);
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
}

interface Snapshot {
  readonly styles: Record<string, Record<string, string>>;
  /** The stylesheets of `<head>` in cascade order: `link <href>` or `style <first rule>`. */
  readonly sheets: readonly string[];
}

/** Computed styles of the scoped elements and the stylesheets of the head, in the page. */
function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const styles: Record<string, Record<string, string>> = {};
    for (const selector of [".page", ".card", ".title", ".body", ".app-shell", "header"]) {
      const element = document.querySelector(selector)!;
      const computed = getComputedStyle(element);
      styles[selector] = {
        scope: element.getAttributeNames().filter((name) => name.startsWith("data-meeko-s-")).join(" "),
        color: computed.color, padding: computed.padding, display: computed.display,
        margin: computed.margin, border: computed.borderTopWidth, maxWidth: computed.maxWidth,
      };
    }
    const sheets = [...document.head.querySelectorAll("style, link[rel=stylesheet]")].map((sheet) => sheet instanceof HTMLLinkElement
      ? `link ${new URL(sheet.href).pathname}`
      : `style ${(sheet.textContent ?? "").trim().split("{")[0]!.trim()}`);
    return { styles, sheets };
  });
}

/** The first paint, from the server's HTML alone, and the page once the client has hydrated it. */
async function firstPaintAndHydrated(browser: Browser, url: string): Promise<{ first: Snapshot; hydrated: Snapshot; page: Page }> {
  const withoutScripts = await browser.newContext({ javaScriptEnabled: false });
  const still = await withoutScripts.newPage();
  await still.goto(url);
  const first = await snapshot(still);
  await withoutScripts.close();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator("#count").click();
  await page.locator("#count", { hasText: "1" }).waitFor();
  assert.deepEqual(errors, []);
  return { first, hydrated: await snapshot(page), page };
}

function launch(): Promise<Browser> {
  return chromium.launch({
    ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
    headless: true,
  });
}

function serve(root: string, command: "dev" | "start", port: number, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), command, root], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  const output = { logs: "" };
  child.stdout?.on("data", (chunk: Buffer) => { output.logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { output.logs += chunk.toString(); });
  return { child, output };
}

function environment(port: number, hmrPort: number): NodeJS.ProcessEnv {
  return { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), MEEKO_LINK_WATCH: "0", MEEKO_EDITOR_BRIDGE: "0" };
}

test("meeko dev paints scoped styles the same before and after hydration, without copies, and hot-updates them", { timeout: 150_000 }, async (context) => {
  let server: ReturnType<typeof serve> | undefined;
  let browser: Browser | undefined;
  const root = await tempProject(context, "scoped-styles-dev", async () => {
    await browser?.close();
    await stopChild(server?.child);
  });
  await writeProject(root);
  const port = await freePort();
  server = serve(root, "dev", port, environment(port, await freePort()));
  const { child, output } = server;
  await until(() => output.logs.includes(`http://localhost:${port}\n`) || child.exitCode !== null, () => `meeko dev did not listen: ${output.logs}`);
  browser = await launch();

  const { first, hydrated, page } = await firstPaintAndHydrated(browser, `http://127.0.0.1:${port}/`);
  // The scoped rules win from the first paint: the components' styles follow the global sheet.
  assert.deepEqual(first.styles[".card"], { scope: first.styles[".card"]!.scope, color: "rgb(200, 0, 0)", padding: "24px", display: "flex", margin: "0px", border: "0px", maxWidth: "none" });
  assert.equal(first.styles[".body"]!.margin, "10px");
  assert.equal(first.styles[".app-shell"]!.maxWidth, "1024px", "the layout's scoped style is inlined");
  assert.deepEqual(hydrated.styles, first.styles, "hydration changes no computed style");
  // Vite's client adopts the server's <style> tags: no copy, same order.
  assert.deepEqual(hydrated.sheets, first.sheets);
  // The global sheet first; then the layout, the page and the card (its @import inlined), in tree order.
  const order = [/^link \/app\/styles\/main\.css$/, /^style \.app-shell\[data-meeko-s-\w+\]$/, /^style \.page\[data-meeko-s-\w+\]$/, /^style :root$/];
  assert.equal(first.sheets.length, order.length, first.sheets.join("\n"));
  order.forEach((pattern, index) => assert.match(first.sheets[index]!, pattern));

  const marker = (): Promise<number | undefined> => page.evaluate(() => (window as unknown as { marker?: number }).marker);
  await page.evaluate(() => { (window as unknown as { marker: number }).marker = 1; });

  // Editing a file that the <style> imports updates the component without a reload.
  await writeFile(join(root, "app", "styles", "tokens.css"), ":root { --card-padding: 40px; }\n");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".card")!).padding === "40px");
  assert.equal(await page.locator("#count").innerText(), "1", "the page keeps its state");
  assert.equal(await marker(), 1, "no full reload");

  // Editing the <style> replaces the server's sheet in place: a removed rule stops applying.
  const cardFile = join(root, "app", "components", "Card.meeko");
  await writeFile(cardFile, card("rgb(0, 0, 255)", ""));
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".card")!).color === "rgb(0, 0, 255)");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".body")!).margin === "3px");
  assert.equal(await page.locator("#count").innerText(), "1", "the page keeps its state");
  assert.equal(await marker(), 1, "no full reload");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll("style")].filter((style) => style.textContent?.includes("rgb(200, 0, 0)")).length), 0, "the stale sheet is gone");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".card")!).padding), "40px");
  assert.equal(child.exitCode, null, output.logs);
});

test("meeko build and start paint scoped styles the same before and after hydration", { timeout: 180_000 }, async (context) => {
  let server: ReturnType<typeof serve> | undefined;
  let browser: Browser | undefined;
  const root = await tempProject(context, "scoped-styles-build", async () => {
    await browser?.close();
    await stopChild(server?.child);
  });
  await writeProject(root);
  const port = await freePort();
  const env = environment(port, await freePort());
  const build = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "build", root], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let buildLogs = "";
  build.stdout?.on("data", (chunk: Buffer) => { buildLogs += chunk.toString(); });
  build.stderr?.on("data", (chunk: Buffer) => { buildLogs += chunk.toString(); });
  const [code] = await once(build, "exit") as [number | null];
  assert.equal(code, 0, buildLogs);
  server = serve(root, "start", port, env);
  const { child, output } = server;
  await until(() => /http:\/\/\S+:\d+/.test(output.logs) || child.exitCode !== null, () => `meeko start did not listen: ${output.logs}`);
  assert.equal(child.exitCode, null, output.logs);
  browser = await launch();

  const { first, hydrated } = await firstPaintAndHydrated(browser, `http://127.0.0.1:${port}/`);
  assert.equal(first.styles[".card"]!.color, "rgb(200, 0, 0)");
  assert.equal(first.styles[".card"]!.padding, "24px");
  assert.equal(first.styles[".body"]!.margin, "10px");
  assert.deepEqual(hydrated.styles, first.styles, "hydration changes no computed style");
  // The inline styles follow the global CSS asset; the route chunks' CSS, loaded by the client, comes after them.
  const globalSheet = first.sheets.findIndex((sheet) => /^link \/assets\/entry-client-.*\.css$/.test(sheet));
  const inline = first.sheets.flatMap((sheet, index) => sheet.startsWith("style ") ? [index] : []);
  assert.ok(globalSheet >= 0, first.sheets.join("\n"));
  assert.equal(inline.length, 3, first.sheets.join("\n"));
  assert.ok(inline.every((index) => index > globalSheet), first.sheets.join("\n"));
  assert.deepEqual(hydrated.sheets.slice(0, first.sheets.length), first.sheets, "the client only appends stylesheets");
});
