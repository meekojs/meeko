import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { compile } from "../src/compiler.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";

const page = (name: string): string => `<script lang="ts">
import { onMounted } from "@meekojs/meeko";
const log = (globalThis as unknown as { mountLog: string[] }).mountLog;
onMounted(() => {
  log.push("mounted:${name}");
  return () => { log.push("cleanup:${name}"); };
});
</script>
<template><p data-page="${name}">${name}</p></template>`;

test("onMounted runs once for the hydrated page and for each page a client navigation mounts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeko-client-mounted-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  const log: string[] = [];
  (globalThis as unknown as { mountLog: string[] }).mountLog = log;
  const browser = new HappyWindow({ url: "https://example.test/a" });
  try {
    const modules: Record<string, ClientComponent> = {};
    for (const name of ["a", "b"]) {
      const code = compile(page(name), join(directory, `${name}.meeko`)).code
        .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
        .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
      await writeFile(join(directory, `${name}.ts`), code);
      modules[`${name}.meeko`] = await import(pathToFileURL(join(directory, `${name}.ts`)).href) as ClientComponent;
    }
    const routes = createRouteManifest([
      { id: "/a", file: "a.meeko", layouts: [] },
      { id: "/b", file: "b.meeko", layouts: [] },
    ]);
    const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]! });
    const html = await (await server(new Request("https://example.test/a"))).text();
    assert.deepEqual(log, [], "the server render never runs onMounted");
    browser.document.write(html);
    const root = browser.document.getElementById("app")!;
    const payload = browser.document.getElementById("meeko-payload")!.textContent!;
    const app = await mountClientApp({
      routes, root: root as unknown as Element, payload,
      loadPage: async (file) => modules[file]!,
      browser: browser as unknown as Window,
    });
    assert.deepEqual(log.splice(0), ["mounted:a"]);

    assert.equal(await app.navigate("/b"), true);
    assert.equal(root.querySelector("[data-page]")?.getAttribute("data-page"), "b");
    // The next page renders as HTML first, which ignores onMounted, and mounts once.
    assert.deepEqual(log.splice(0).sort(), ["cleanup:a", "mounted:b"]);

    assert.equal(await app.navigate("/a"), true);
    assert.deepEqual(log.splice(0).sort(), ["cleanup:b", "mounted:a"]);
  } finally {
    browser.happyDOM.abort();
    delete (globalThis as { mountLog?: string[] }).mountLog;
    await rm(directory, { recursive: true, force: true });
  }
});
