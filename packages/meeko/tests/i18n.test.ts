import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compileCatalog } from "../src/modules/i18n/messages.ts";
import { createI18n, localeOf, localizedPath } from "../src/i18n.ts";
import { definePlugin, runPlugins } from "../src/app/definitions/define-plugin.ts";
import { fixedRoute, routeSnapshot } from "../src/app/runtime/navigation.ts";
import { createContext, createRoot, inject } from "../src/core/reactivity.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { buildProject } from "../src/framework/project.ts";
import { linkRepositoryPackages, stopChild, tempProject } from "./helpers/temp-project.ts";
import { chromium } from "playwright-core";

test("catalogs compile nested keys, placeholders and plural categories", () => {
  const catalog = compileCatalog({
    home: { hello: "Hello, {name}!" },
    files: { plural: "total", forms: { one: "{total} file", other: "{total} files" } },
    kind: { select: "role", forms: { admin: "Administrator", other: "Member" } },
  }, "en.json");
  let destination = "";
  const i18n = createI18n("en", catalog, ["en", "es"], (path) => { destination = path; }, () => "/en/files?page=2#top");
  assert.equal(i18n.t("home.hello", { name: "Meeko" }), "Hello, Meeko!");
  assert.equal(i18n.t("files", { total: 1 }), "1 file");
  assert.equal(i18n.t("files", { total: 3 }), "3 files");
  assert.equal(i18n.t("kind", { role: "admin" }), "Administrator");
  assert.equal(i18n.t("kind", { role: "guest" }), "Member");
  assert.throws(() => i18n.t("home.hello"), /Missing i18n value/);
  assert.throws(() => i18n.t("absent"), /Missing i18n message/);
  i18n.switchLocale("es");
  assert.equal(destination, "/es/files?page=2#top");
  assert.equal(localeOf("/es/files", ["en", "es"], "en"), "es");
  assert.equal(localizedPath("/", "es", ["en", "es"]), "/es");
});

test("catalog validation rejects missing plural fallback and mismatched types", () => {
  assert.throws(() => compileCatalog({ files: { plural: "count", forms: { one: "one" } } }, "bad.json"), /forms.other/);
  assert.throws(() => compileCatalog({ files: 2 }, "bad.json"), /must be a message/);
});

test("plugin head and navigation hooks run within an application root", async () => {
  const key = createContext<string>("plugin test");
  const plugin = definePlugin((app) => {
    app.provide(key, "value");
    app.addHead(() => ({ htmlAttrs: { lang: "es" } }));
    app.beforeNavigate((url) => url.pathname !== "/en");
  });
  const route = fixedRoute(routeSnapshot(new URL("http://localhost/es"), "/es", {}, {}, false));
  const plugins = await runPlugins([{ plugin }], { side: "client", route });
  assert.equal(await plugins.beforeNavigate(new URL("http://localhost/es/page"), "/es/page"), true);
  assert.equal(await plugins.beforeNavigate(new URL("http://localhost/en"), "/en"), false);
  createRoot((dispose) => {
    plugins.apply();
    assert.equal(inject(key), "value");
    dispose();
  });
});

test("i18n module builds separate locale chunks and renders request-local SSR", { timeout: 120_000 }, async (context) => {
  let child: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const root = await tempProject(context, "i18n", async () => { await browser?.close(); await stopChild(child, "SIGTERM"); });
  const put = async (path: string, value: string) => {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, value);
  };
  await initFrameworkProject(root);
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
  await put("meeko.config.ts", `import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ modules: [["@meekojs/meeko/i18n/module", {
  defaultLocale: "en", catalogs: {
    en: { common: "app/locales/en/common.json", home: "app/locales/en/home.json", about: "app/locales/en/about.json" },
    es: { common: "app/locales/es/common.json", home: "app/locales/es/home.json", about: "app/locales/es/about.json" }
  },
  routes: { "/en": ["home"], "/es": ["home"], "/en/about": ["about"], "/es/about": ["about"] }
}]] });\n`);
  await put("app/locales/en/common.json", JSON.stringify({ nav: "Navigation" }));
  await put("app/locales/es/common.json", JSON.stringify({ nav: "Navegación" }));
  await put("app/locales/en/home.json", JSON.stringify({ greeting: "Hello {name}" }));
  await put("app/locales/es/home.json", JSON.stringify({ greeting: "Hola {name}" }));
  await put("app/locales/en/about.json", JSON.stringify({ about: "About Meeko" }));
  await put("app/locales/es/about.json", JSON.stringify({ about: "Acerca de Meeko" }));
  const page = `<script lang="ts">\nconst { t } = useI18n();\n</script>\n<template><h1>{t("greeting", { name: "Meeko" })}</h1><a href="/en/about">About</a><a href="/es">Español</a></template>\n`;
  await put("app/pages/en/index.meeko", page);
  await put("app/pages/es/index.meeko", page);
  await put("app/pages/en/about.meeko", `<script lang="ts">const { t } = useI18n();</script><template><h1>{t("about")}</h1><a href="/es">Español</a></template>`);
  await put("app/pages/es/about.meeko", `<script lang="ts">const { t } = useI18n();</script><template><h1>{t("about")}</h1></template>`);
  await put("server/runtime.ts", `import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
export default defineServerRuntime(({ production }) => {
  const memory = new MemorySessionStore();
  return { onError: (error) => console.error(error), sessions: new SessionManager({ secure: false, production, store: {
    persistent: true, get: (id) => memory.get(id), set: (record) => memory.set(record),
    delete: (id) => memory.delete(id), replace: (oldId, record) => memory.replace(oldId, record),
    revokeFamily: (familyId) => memory.revokeFamily(familyId), close: () => memory.close(),
  } }) };
});\n`);
  await put("app/pages/en/invalid.meeko", `<script lang="ts">const { t } = useI18n();</script><template><p>{t("missing.key")}</p></template>`);
  await assert.rejects(checkFrameworkProject(root), /missing\.key/);
  await rm(join(root, "app", "pages", "en", "invalid.meeko"));
  await checkFrameworkProject(root);
  const generated = await readFile(join(root, ".meeko", "types", "i18n.d.ts"), "utf8");
  assert.match(generated, /"greeting": true/);
  assert.match(generated, /"about": true/);
  const built = await buildProject(root, { adapter: "node" });
  const assets = join(built.output, "client", "assets");
  const files = await readdir(assets);
  const chunks = await Promise.all(files.filter((file) => file.endsWith(".js")).map((file) => readFile(join(assets, file), "utf8")));
  assert.ok(chunks.some((chunk) => chunk.includes("Hello") && !chunk.includes("Hola")), "English is a separate chunk");
  assert.ok(chunks.some((chunk) => chunk.includes("Hola") && !chunk.includes("Hello")), "Spanish is a separate chunk");
  child = spawn(process.execPath, [join(built.output, "index.mjs")], {
    cwd: root, env: { ...process.env, PORT: "0", HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  let port: string | undefined;
  for (let attempt = 0; attempt < 300 && !port; attempt++) {
    port = logs.match(/http:\/\/localhost:(\d+)\n/)?.[1];
    if (child.exitCode !== null) throw new Error(logs);
    if (!port) await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(port, logs);
  const [english, spanish] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/en`), fetch(`http://127.0.0.1:${port}/es`),
  ]);
  const [enHtml, esHtml] = await Promise.all([english.text(), spanish.text()]);
  assert.equal(english.status, 200, `${enHtml}\n${logs}`);
  assert.equal(spanish.status, 200, `${esHtml}\n${logs}`);
  assert.match(enHtml, /<html lang="en"/);
  assert.match(esHtml, /<html lang="es"/);
  assert.match(enHtml, /Hello Meeko/);
  assert.match(esHtml, /Hola Meeko/);
  browser = await chromium.launch({
    ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
    headless: true,
  });
  const tab = await browser.newPage();
  const errors: string[] = [];
  tab.on("pageerror", (error) => errors.push(error.message));
  await tab.goto(`http://127.0.0.1:${port}/en`, { waitUntil: "networkidle" });
  assert.equal(await tab.locator("h1").innerText(), "Hello Meeko");
  await tab.getByRole("link", { name: "About" }).click();
  await tab.waitForURL(`http://127.0.0.1:${port}/en/about`);
  assert.equal(await tab.locator("h1").innerText(), "About Meeko");
  await tab.getByRole("link", { name: "Español" }).click();
  await tab.waitForURL(`http://127.0.0.1:${port}/es`);
  assert.equal(await tab.locator("h1").innerText(), "Hola Meeko");
  assert.deepEqual(errors, []);
});
