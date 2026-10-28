import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import type { Page } from "playwright-core";
import { buildProject } from "../src/framework/project.ts";
import { previewStatic } from "../src/framework/static-adapter.ts";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";

/** A layout with a toolbar and a page that injects its action there and a notice at the end of <body>. */
async function writeTeleportApp(root: string, staticAdapter: boolean): Promise<void> {
  const prerender = 'import { definePage } from "@meekojs/meeko/framework";\n\nexport const route = definePage({ render: "prerender" });\n';
  const files: Record<string, string> = {
    "package.json": '{"name":"teleport-app","private":true,"type":"module"}\n',
    "meeko.config.mjs": staticAdapter ? 'export default { server: { adapter: "static" } };\n' : "export default {};\n",
    "app/layouts/default.meeko": `<template><header><nav id="toolbar"><MeekoLink to="/" id="brand">Meeko</MeekoLink></nav></header><main><MeekoOutlet /></main></template>\n`,
    "app/pages/index.meeko": `<script lang="ts">
import { signal } from "@meekojs/meeko";
const count = signal(0);
</script>
<template><h1 id="home">Inicio</h1><MeekoLink to="/other" id="to-other">Otra</MeekoLink><MeekoTeleport to="#toolbar"><button type="button" id="save" on:click="() => count.value++">Guardar {count.value}</button></MeekoTeleport><MeekoTeleport to="body"><p id="toast">Hola</p></MeekoTeleport></template>
<style scoped>#save { color: rgb(200, 0, 0); }</style>
`,
    "app/pages/other.meeko": `<template><h1 id="other">Otra</h1><MeekoLink to="/" id="to-home">Inicio</MeekoLink></template>\n`,
    ...(staticAdapter ? { "app/pages/index.route.ts": prerender, "app/pages/other.route.ts": prerender } : {}),
  };
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), contents);
  }
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
}

/**
 * Opens the page in Chrome and checks the teleport: the server's button is already in the toolbar
 * and is the node that hydration keeps, it works with the page's scoped CSS, and navigating away
 * removes it and the notice, without errors or hydration mismatches in the console.
 */
async function assertTeleport(origin: string): Promise<void> {
  const html = await (await fetch(`${origin}/`)).text();
  assert.match(html, /<nav id="toolbar"><a[^>]*id="brand"[^>]*>Meeko<\/a><!--meeko:portal:t0--><button type="button" id="save"/, "the first HTML has the button in the toolbar");
  assert.match(html, /<!--meeko:portal:t1--><p id="toast"[^>]*>Hola<\/p><!--\/meeko:portal:t1--><script/, "and the notice after the application, before the scripts");
  const browser = await chromium.launch({
    ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
    headless: true,
  });
  try {
    const page: Page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") errors.push(`${message.type()}: ${message.text()}`);
    });
    // The button that the HTML parser created, before any script runs.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __ssrSave: Element | null }).__ssrSave = document.getElementById("save");
      });
    });
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);
    assert.equal(await page.evaluate(() => {
      const save = document.getElementById("save");
      return save !== null && save === (window as unknown as { __ssrSave: Element | null }).__ssrSave && save.parentElement?.id === "toolbar";
    }), true, "hydration keeps the server's button in the toolbar");
    assert.equal(await page.locator("#save").evaluate((element) => getComputedStyle(element).color), "rgb(200, 0, 0)", "scoped CSS of the page");
    await page.locator("#toolbar #save").click();
    assert.equal(await page.locator("#save").innerText(), "Guardar 1");
    assert.equal(await page.evaluate(() => document.getElementById("toast")?.parentElement === document.body), true);
    await page.evaluate(() => { (window as unknown as { marker: number }).marker = 1; });
    await page.locator("#to-other").click();
    await page.locator("#other").waitFor();
    assert.equal(await page.locator("#save").count(), 0, "leaving the page removes its action from the toolbar");
    assert.equal(await page.locator("#toast").count(), 0);
    assert.equal(await page.evaluate(() => document.body.innerHTML.includes("meeko:portal")), false, "no orphan nodes");
    await page.locator("#to-home").click();
    await page.locator("#toolbar #save").waitFor();
    assert.equal(await page.locator("#save").innerText(), "Guardar 0", "a new page instance");
    await page.locator("#toolbar #save").click();
    assert.equal(await page.locator("#save").innerText(), "Guardar 1");
    assert.equal(await page.locator("#toast").count(), 1);
    assert.equal(await page.evaluate(() => (window as unknown as { marker?: number }).marker), 1, "every navigation stayed in the client");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

test("Chrome: una página pone su acción en la barra del layout desde el SSR y navegar fuera la quita", { timeout: 240_000 }, async () => {
  const project = await createTempProject("teleport-e2e");
  type ServerModule = typeof import("../src/framework-server.ts");
  type NodeModule = typeof import("../src/node.ts");
  let server: import("node:http").Server | undefined;
  let app: Awaited<ReturnType<ServerModule["createServerApp"]>> | undefined;
  try {
    await writeTeleportApp(project.root, false);
    const built = await buildProject(project.root);
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
    await assertTeleport(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await app?.close();
    await project.remove();
  }
});

test("Chrome: el adaptador static deja el contenido en su destino del HTML prerenderizado", { timeout: 240_000 }, async () => {
  const project = await createTempProject("teleport-static-e2e");
  let server: import("node:http").Server | undefined;
  try {
    await writeTeleportApp(project.root, true);
    await buildProject(project.root);
    const previous = { port: process.env.MEEKO_PORT, host: process.env.MEEKO_HOST };
    process.env.MEEKO_PORT = "0";
    process.env.MEEKO_HOST = "127.0.0.1";
    try { server = await previewStatic(project.root); }
    finally {
      if (previous.port === undefined) delete process.env.MEEKO_PORT; else process.env.MEEKO_PORT = previous.port;
      if (previous.host === undefined) delete process.env.MEEKO_HOST; else process.env.MEEKO_HOST = previous.host;
    }
    await assertTeleport(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await project.remove();
  }
});
