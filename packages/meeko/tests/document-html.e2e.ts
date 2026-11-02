import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Browser, Page } from "playwright-core";

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

import type * as framework_server_tsTypes from "../src/framework-server.ts";
import type * as node_tsTypes from "../src/node.ts";

import { buildProject } from "../src/framework/project.ts";
import { previewStatic } from "../src/framework/static-adapter.ts";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";

/** What the pages of the app answer, which the test changes while a document stays open. */
interface GuideState {
  reorder: boolean;
  version: number;
  everyRequest: boolean;
  redirect: boolean;
  slow: AbortSignal[];
}

const state = (): GuideState => (globalThis as unknown as { __documentHtmlE2e: GuideState }).__documentHtmlE2e;

const toggle = `<script lang="ts">
const open = signal(true);
</script>`;
const button = `<button type="button" id="toggle" on:click="() => open.value = !open.value">t</button>`;

async function writeApp(root: string, staticAdapter: boolean): Promise<void> {
  const files: Record<string, string> = staticAdapter ? {
    "package.json": '{"name":"document-html-static","private":true,"type":"module"}\n',
    "meeko.config.mjs": 'export default { server: { adapter: "static" } };\n',
    "app/pages/index.route.ts": `import { trustHtml } from "@meekojs/meeko";
import { definePage, documentHtml } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "prerender",
  load: () => ({ body: documentHtml(trustHtml("<h2 id='stored'>stored</h2>")) }),
});
`,
    "app/pages/index.meeko": `<script lang="ts">
const props = defineProps<{ data: { body: string } }>();
const open = signal(true);
</script>
<template><section if:when="open.value"><article html="props.data.body"></article></section>${button}</template>
`,
  } : {
    "package.json": '{"name":"document-html-app","private":true,"type":"module"}\n',
    "meeko.config.mjs": "export default {};\n",
    // The list of the review: a trusted article and a text that the page shows escaped.
    "app/pages/list.meeko": `<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

const trusted = { id: 1, kind: "html", body: documentHtml(trustHtml("<h2 id='trusted'>trusted</h2>")) };
const text = { id: 2, kind: "text", body: "<b id='injected'>user text</b>" };
export const items = globalThis.__documentHtmlE2e.reorder ? [text, trusted] : [trusted, text];
</script>
${toggle}
<template><section if:when="open.value"><article each:of="items" each:as="item" each:key="item.id"><div if:when="item.kind === 'html'" html="item.body"></div><p if:when="item.kind === 'text'">{item.body}</p></article></section>${button}</template>
`,
    "app/pages/guide.meeko": `<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml, redirect } from "@meekojs/meeko/framework";

const guide = globalThis.__documentHtmlE2e;
if (guide.redirect) redirect("/signin");
if (guide.everyRequest) guide.version++;
export const body = documentHtml(trustHtml("<h2 id='guide'>version " + guide.version + "</h2>"));
</script>
${toggle}
<template><section if:when="open.value"><article html="body"></article></section>${button}</template>
`,
    "app/pages/signin.meeko": `<template><h1 id="signin">Sign in</h1></template>\n`,
    "app/pages/slow.route.ts": `import { trustHtml } from "@meekojs/meeko";
import { defer, definePage, documentHtml } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "stream",
  load: () => ({
    body: documentHtml(trustHtml("<h2 id='slow'>first line</h2>")),
    never: defer((signal) => {
      globalThis.__documentHtmlE2e.slow.push(signal);
      return new Promise(() => {});
    }, { timeoutMs: 120_000 }),
  }),
});
`,
    "app/pages/slow.meeko": `<script lang="ts">
const props = defineProps<{ data: { body: string } }>();
const open = signal(true);
</script>
<template><section if:when="open.value"><article html="props.data.body"></article></section>${button}</template>
`,
  };
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), contents);
  }
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
}

const launch = (): Promise<Browser> => chromium.launch({
  ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
  headless: true,
});

const hydrated = (page: Page): Promise<unknown> => page.waitForFunction(() => performance.getEntriesByName("meeko-hydration").length > 0);

/** Opens `url` in a page that remembers the document it hydrated, so a new document is visible. */
async function openPage(browser: Browser, url: string, waitUntil: "load" | "commit" = "load"): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url, { waitUntil });
  await hydrated(page);
  await page.evaluate(() => { (window as unknown as { sameDocument: boolean }).sameDocument = true; });
  return { page, errors, close: () => context.close() };
}

const sameDocument = (page: Page): Promise<boolean> => page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);

async function repaint(page: Page): Promise<void> {
  await page.locator("#toggle").click();
  await page.locator("#toggle").click();
}

test("Chrome: recuperar un documentHtml sólo inserta lo que la respuesta actual declara marcado", { timeout: 240_000 }, async (context) => {
  const project = await createTempProject("document-html-e2e");
  type ServerModule = typeof framework_server_tsTypes;
  type NodeModule = typeof node_tsTypes;
  (globalThis as unknown as { __documentHtmlE2e: GuideState }).__documentHtmlE2e = { reorder: false, version: 1, everyRequest: false, redirect: false, slow: [] };
  let server: Server | undefined;
  let app: Awaited<ReturnType<ServerModule["createServerApp"]>> | undefined;
  let browser: Browser | undefined;
  try {
    await writeApp(project.root, false);
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
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await launch();

    await context.test("una lista reordenada recupera su artículo y el texto sigue siendo texto", async () => {
      state().reorder = false;
      const { page, errors, close } = await openPage(browser!, `${origin}/list`);
      state().reorder = true;
      await repaint(page);
      await page.locator("#trusted").waitFor();
      assert.equal(await page.locator("#injected").count(), 0, "the text was never inserted as HTML");
      assert.equal(await page.locator("article p").innerText(), "<b id='injected'>user text</b>");
      assert.equal(await sameDocument(page), true);
      assert.deepEqual(errors, []);
      await close();
    });

    await context.test("un contenido republicado carga el documento, que después se recupera sin recargar", async () => {
      state().version = 1;
      const { page, errors, close } = await openPage(browser!, `${origin}/guide`);
      assert.equal(await page.locator("#guide").innerText(), "version 1");
      state().version = 2;
      await page.locator("#toggle").click();
      await page.locator("#toggle").click();
      await page.waitForFunction(() => (window as unknown as { sameDocument?: boolean }).sameDocument !== true);
      await hydrated(page);
      assert.equal(await page.locator("#guide").innerText(), "version 2", "the new document shows what was published");
      await page.evaluate(() => { (window as unknown as { sameDocument: boolean }).sameDocument = true; });
      await repaint(page);
      await page.locator("#guide").waitFor();
      assert.equal(await page.locator("#guide").innerText(), "version 2");
      assert.equal(await sameDocument(page), true);
      assert.deepEqual(errors, []);
      await close();
    });

    await context.test("un valor distinto en cada petición recarga una vez, y después avisa sin bucles", async () => {
      state().everyRequest = true;
      const { page, errors, close } = await openPage(browser!, `${origin}/guide`);
      const documents: string[] = [];
      page.on("request", (request) => {
        if (request.resourceType() === "document") documents.push(request.url());
      });
      await page.locator("#toggle").click();
      await page.locator("#toggle").click();
      await page.waitForFunction(() => (window as unknown as { sameDocument?: boolean }).sameDocument !== true);
      await hydrated(page);
      assert.equal(documents.length, 1);
      await page.evaluate(() => { (window as unknown as { sameDocument: boolean }).sameDocument = true; });
      await page.locator("#toggle").click();
      await page.locator("#toggle").click();
      await page.waitForFunction(() => document.querySelector("article")?.childNodes.length === 1);
      await page.waitForTimeout(1000);
      assert.equal(documents.length, 1, "no second reload");
      assert.equal(await sameDocument(page), true);
      assert.equal(await page.locator("article").innerText(), "", "nothing was inserted");
      assert.match(errors.join("\n"), /Document HTML could not be recovered/);
      state().everyRequest = false;
      await close();
    });

    await context.test("una redirección lleva a su destino y no inserta nada", async () => {
      state().redirect = false;
      const { page, close } = await openPage(browser!, `${origin}/guide`);
      state().redirect = true;
      await page.locator("#toggle").click();
      await page.locator("#toggle").click();
      await page.locator("#signin").waitFor();
      assert.equal(new URL(page.url()).pathname, "/signin");
      state().redirect = false;
      await close();
    });

    await context.test("una ruta stream pinta con su primera línea y cierra la petición", async () => {
      const { page, errors, close } = await openPage(browser!, `${origin}/slow`, "commit");
      const before = state().slow.length;
      await repaint(page);
      await page.locator("#slow").waitFor({ timeout: 10_000 });
      assert.equal(state().slow.length, before + 1, "the recovery asked the server once");
      const started = Date.now();
      while (!state().slow.at(-1)!.aborted && Date.now() - started < 10_000) await new Promise((done) => setTimeout(done, 50));
      assert.equal(state().slow.at(-1)!.aborted, true, "the server saw the connection close, with the deferred value still pending");
      assert.equal(await sameDocument(page), true);
      assert.deepEqual(errors, []);
      await close();
    });
  } finally {
    await browser?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((done) => server!.close(() => done()));
    }
    await app?.close();
    await project.remove();
  }
});

test("Chrome: un sitio estático recupera el valor de su archivo", { timeout: 240_000 }, async () => {
  const project = await createTempProject("document-html-static-e2e");
  let server: Server | undefined;
  let browser: Browser | undefined;
  try {
    await writeApp(project.root, true);
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
    browser = await launch();
    const { page, errors, close } = await openPage(browser, `${origin}/`);
    assert.equal(await page.evaluate(() => JSON.parse(document.getElementById("meeko-payload")!.textContent!).props.data.body), "<!--meeko:document-html:0-->");
    await repaint(page);
    await page.locator("#stored").waitFor();
    assert.equal(await sameDocument(page), true);
    assert.deepEqual(errors, []);
    await close();
  } finally {
    await browser?.close();
    if (server) await new Promise<void>((done) => server!.close(() => done()));
    await project.remove();
  }
});
