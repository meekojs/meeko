import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { compile } from "../src/compiler.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { RouteRecord } from "../src/framework/router.ts";
import type { ClientComponent } from "../src/framework/client.ts";

const runtimeUrl = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
const globals = globalThis as { meekoSelected?: string };

/** Starts with what the test puts in `meekoSelected`: `undefined` in the server, a value in the browser. */
const picker = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const selected = signal<string | undefined>((globalThis as { meekoSelected?: string }).meekoSelected);
const count = signal(1);
</script>
<template><p class="picker">{selected.value ?? "none"}:{count.value}</p></template>`;

const page = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Picker from "./Picker.meeko";
const id = signal<string | undefined>(undefined);
</script>
<template><p class="page">{id.value ?? "no id"}</p><Picker /></template>`;

const broken = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const when = signal(new Date(0));
</script>
<template><p>{when.value.toISOString()}</p></template>`;

async function load(files: Record<string, string>, entry: string): Promise<{ module: ClientComponent & { renderWithState(props: object): { html: string; state: Record<string, unknown> }; hydrate(root: Element, props: object, state?: Record<string, unknown>): () => void }; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "meeko-state-"));
  await writeFile(join(directory, "package.json"), "{}\n");
  for (const [file, source] of Object.entries(files)) {
    let code = compile(source, join(directory, "app", "pages", file)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtimeUrl("src/internal.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtimeUrl("src/index.ts")}`);
    for (const other of Object.keys(files)) code = code.replace(`from "./${other}"`, `from "./${other.replace(/\.meeko$/, ".ts")}"`);
    await writeFile(join(directory, file.replace(/\.meeko$/, ".ts")), code);
  }
  const module = await import(pathToFileURL(join(directory, entry.replace(/\.meeko$/, ".ts"))).href) as Awaited<ReturnType<typeof load>>["module"];
  return { module, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("a signal that holds undefined travels in the SSR state and hydrates as undefined", { timeout: 60_000 }, async () => {
  const { module, cleanup } = await load({ "Picker.meeko": picker, "Page.meeko": page }, "Page.meeko");
  const browser = new HappyWindow();
  try {
    delete globals.meekoSelected;
    const rendered = module.renderWithState({});
    assert.deepEqual(rendered.state, { "meeko:undefined": ["id"] });
    assert.match(rendered.html, /<!--meeko:component:0:[^>]*-->/);
    const root = browser.document.createElement("main");
    root.innerHTML = rendered.html;
    assert.equal(root.querySelector(".picker")!.textContent, "none:1");

    // In the browser the script starts the signal with another value: the SSR state wins, without a mismatch.
    globals.meekoSelected = "browser";
    const release = module.hydrate(root as unknown as Element, {}, JSON.parse(JSON.stringify(rendered.state)) as Record<string, unknown>);
    assert.equal(root.querySelector(".picker")!.textContent, "none:1");
    assert.equal(root.querySelector(".page")!.textContent, "no id");
    release();
  } finally {
    delete globals.meekoSelected;
    await browser.happyDOM.close();
    await cleanup();
  }
});

test("a value that JSON cannot carry names the component and the signal, with a hint", { timeout: 60_000 }, async () => {
  const { module, cleanup } = await load({ "Broken.meeko": broken }, "Broken.meeko");
  try {
    assert.throws(() => module.renderWithState({}), (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /^app\/pages\/Broken\.meeko: the signal "when" cannot be sent to the browser with the SSR state \(Non-plain object at \$\.when\)\. /);
      assert.match(error.message, /a Date as an ISO string/);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test("a framework page with an undefined signal answers 200 and hydrates", { timeout: 60_000 }, async () => {
  const { module, cleanup } = await load({ "Picker.meeko": picker, "Page.meeko": page }, "Page.meeko");
  try {
    const { createFrameworkHandler, mountClientApp } = {
      ...await import(pathToFileURL(resolve("src/framework/server.ts")).href) as typeof import("../src/framework/server.ts"),
      ...await import(pathToFileURL(resolve("src/framework/client.ts")).href) as typeof import("../src/framework/client.ts"),
    };
    const routes: readonly RouteRecord[] = createRouteManifest([{ id: "/", file: "Page.meeko", layouts: [] }]);
    const response = await createFrameworkHandler({ routes, loadPage: async () => module })(new Request("https://example.test/", { headers: { accept: "text/html" } }));
    assert.equal(response.status, 200);
    const html = await response.text();
    const browser = new HappyWindow({ url: "https://example.test/" });
    browser.document.write(html);
    const reported: unknown[] = [];
    globals.meekoSelected = "browser";
    const app = await mountClientApp({
      routes, root: browser.document.getElementById("app") as unknown as Element, payload: browser.document.getElementById("meeko-payload")!.textContent!,
      loadPage: async () => module, browser: browser as unknown as Window, onError: (error) => { reported.push(error); },
    });
    assert.deepEqual(reported, []);
    assert.equal(browser.document.querySelector(".picker")!.textContent, "none:1");
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    delete globals.meekoSelected;
    await cleanup();
  }
});
