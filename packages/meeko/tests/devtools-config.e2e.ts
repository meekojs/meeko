import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";

import { initFrameworkProject } from "../src/framework/init.ts";
import { createTempProject, linkRepositoryPackages, repositoryRoot } from "./helpers/temp-project.ts";

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

async function until(condition: () => boolean, message: () => string, timeout = 30_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(message());
    await new Promise((done) => setTimeout(done, 50));
  }
}

const page = `<script lang="ts">
const count = signal(0);
</script>

<template>
  <button id="count" type="button" on:click="() => count.value++">{count.value}</button>
</template>
`;

// `devtools: true` in meeko.config.ts: meeko dev mounts the in-page panel without application code.
test("meeko dev mounts the DevTools panel in Chrome with devtools: true", { timeout: 90_000 }, async (context) => {
  const project = await createTempProject("devtools-config");
  const root = project.root;
  await initFrameworkProject(root);
  await writeFile(join(root, "app", "pages", "index.meeko"), page);
  await writeFile(join(root, "meeko.config.ts"), `import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ devtools: { position: "bottom-left" } });
`);
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
  const port = await freePort();
  const child = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "dev", root], {
    cwd: root,
    env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(await freePort()), MEEKO_LINK_WATCH: "0", MEEKO_EDITOR_BRIDGE: "0" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const browser = await chromium.launch({
    ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
    headless: true,
  });
  context.after(async () => {
    await browser.close();
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGINT"); await exited; }
    await project.remove();
  });
  await until(() => logs.includes(`http://localhost:${port}\n`) || child.exitCode !== null, () => `meeko dev did not listen: ${logs}`);
  assert.equal(child.exitCode, null, logs);
  assert.doesNotMatch(logs, /desconocida/, "devtools is a known key");

  const tab = await browser.newPage();
  const errors: string[] = [];
  tab.on("pageerror", (error) => errors.push(error.message));
  await tab.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  const panel = tab.locator("[data-meeko-devtools-panel]");
  await panel.waitFor({ state: "attached" });
  assert.equal(await panel.count(), 1, "one panel");
  assert.equal(await panel.getAttribute("data-position"), "bottom-left");
  // The panel reads the hook of the hydrated page: the page's instance is in its tree.
  await panel.locator(".tree-node > button", { hasText: "index" }).first().waitFor();
  const box = await panel.evaluate((host) => {
    const rect = host.getBoundingClientRect();
    return { left: rect.left, bottom: window.innerHeight - rect.bottom };
  });
  assert.deepEqual(box, { left: 16, bottom: 16 }, "the panel sits in the bottom-left corner");
  // The application still works beside the panel.
  await tab.locator("#count").click();
  await tab.locator("#count", { hasText: "1" }).waitFor();

  // Meeko's colors: dark by default here (the emulated system), light with the page's data-theme.
  const surface = () => panel.locator(".panel").evaluate((node) => getComputedStyle(node).backgroundColor);
  await tab.emulateMedia({ colorScheme: "dark" });
  assert.equal(await surface(), "rgb(16, 17, 21)");
  await tab.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await tab.waitForFunction(() => getComputedStyle(document.querySelector("[data-meeko-devtools-panel]")!.shadowRoot!.querySelector(".panel")!).backgroundColor === "rgb(255, 255, 255)");
  await tab.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  await tab.waitForFunction(() => getComputedStyle(document.querySelector("[data-meeko-devtools-panel]")!.shadowRoot!.querySelector(".panel")!).backgroundColor === "rgb(16, 17, 21)");

  // Minimize: the pill counts the events that arrive while folded, and a click restores the panel.
  const minimize = panel.getByRole("button", { name: /^Minimizar Meeko DevTools/ });
  assert.equal(await minimize.getAttribute("aria-expanded"), "true");
  await minimize.click();
  const pill = panel.getByRole("button", { name: /^Restaurar Meeko DevTools/ });
  await pill.waitFor();
  assert.equal(await panel.locator(".panel").isVisible(), false);
  assert.ok(await pill.evaluate((node) => node.getRootNode() instanceof ShadowRoot && (node.getRootNode() as ShadowRoot).activeElement === node), "focus moves to the pill");
  await tab.locator("#count").click();
  await tab.locator("#count").click();
  await panel.getByRole("button", { name: /Restaurar Meeko DevTools · 2 eventos nuevos/ }).waitFor();
  assert.equal(await panel.locator(".badge").innerText(), "2");

  // The folded state survives a reload; the shortcut restores it.
  await tab.reload({ waitUntil: "networkidle" });
  await panel.locator(".pill").waitFor();
  assert.equal(await panel.getAttribute("data-minimized"), "");
  await tab.keyboard.press("Alt+Shift+KeyM");
  await panel.locator(".panel").waitFor();
  assert.equal(await panel.getAttribute("data-minimized"), null);
  assert.equal(await tab.evaluate(() => JSON.parse(localStorage.getItem("meeko:devtools-panel") ?? "{}").minimized), false);
  await pill.waitFor({ state: "hidden" });
  await panel.getByRole("button", { name: /^Minimizar/ }).click();
  await panel.getByRole("button", { name: /^Restaurar/ }).click();
  await panel.locator(".panel").waitFor();

  // Dragging the handle to the upper right moves the panel there, and a reload keeps it.
  const handle = panel.locator(".handle");
  const start = await handle.boundingBox();
  assert.ok(start);
  await tab.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await tab.mouse.down();
  await tab.mouse.move(1000, 100, { steps: 6 });
  await tab.mouse.up();
  assert.equal(await panel.getAttribute("data-position"), "top-right");
  await tab.reload({ waitUntil: "networkidle" });
  await panel.locator(".panel").waitFor();
  assert.equal(await panel.getAttribute("data-position"), "top-right");
  assert.deepEqual(errors, []);
});
