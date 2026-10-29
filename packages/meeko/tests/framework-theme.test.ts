import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { compile } from "../src/compiler.ts";
import { applyAutoImports, discoverAutoImports } from "../src/autoimports.ts";
import { checkApp } from "../src/framework/check-app.ts";
import { clientRoutesSource, discoverAppManifest } from "../src/framework/app-manifest.ts";
import { loadMeekoConfig } from "../src/framework/config.ts";
import { buildProject } from "../src/framework/project.ts";
import { prepareFrameworkTypeDeclarations } from "../src/framework/type-declarations.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import type { DocumentConfig } from "../src/framework/head.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { RouteRecord } from "../src/framework/router.ts";
import { resolveThemeConfig, themeScript } from "../src/framework/theme.ts";
import type { ResolvedThemeConfig } from "../src/framework/theme.ts";
import { staticAppConfig, writeStaticApp } from "./helpers/static-app.ts";
import { createTempProject, tempProject } from "./helpers/temp-project.ts";

const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href;
const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

/** The runtime as the compiled components import it, by file URL: one instance for pages, server and browser. */
const runtime = async () => ({
  ...await import(fileUrl("src/framework/server.ts")) as typeof import("../src/framework/server.ts"),
  ...await import(fileUrl("src/framework/client.ts")) as typeof import("../src/framework/client.ts"),
});

const appShell = `<script lang="ts">
import type { Component } from "@meekojs/meeko";
import { useHead } from "@meekojs/meeko/framework";
const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
useHead({ htmlAttrs: { class: "app", style: "margin: 0" } });
</script>
<template><div class="shell"><component is="props.outlet"></component></div></template>`;

/** A toggle that renders its icon from `resolved`, as a component that does not use the CSS-driven pattern. */
const togglePage = `<script lang="ts">
import { useTheme } from "@meekojs/meeko/framework";
const { theme, resolved, themes, set } = useTheme();
</script>
<template><button id="toggle" type="button" aria-label="Tema oscuro" bind:aria-pressed="String(resolved.value === 'dark')" on:click="() => set(resolved.value === 'dark' ? 'light' : 'dark')"><span id="icon">{resolved.value === "dark" ? "moon" : "sun"}</span></button><p id="choice">{theme.value}</p><p id="themes">{themes.join(",")}</p><button id="system" type="button" on:click="() => set('system')">system</button></template>`;

const plainPage = `<template><p id="plain">plain</p></template>`;

const sources: Record<string, string> = { "app.meeko": appShell, "toggle.meeko": togglePage, "plain.meeko": plainPage };

async function loadModules(): Promise<{ modules: Record<string, ClientComponent>; cleanup: () => Promise<void> }> {
  const project = await createTempProject("theme-test");
  const directory = project.root;
  await writeFile(join(directory, "package.json"), '{"private":true,"type":"module"}\n');
  const runtimePath = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  for (const [file, source] of Object.entries(sources)) {
    const code = compile(source, join(directory, file)).code
      .replaceAll(`from "@meekojs/meeko/internal"`, `from ${runtimePath("src/internal.ts")}`)
      .replaceAll(`from "@meekojs/meeko/framework"`, `from ${runtimePath("src/framework.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtimePath("src/index.ts")}`);
    await writeFile(join(directory, file.replace(/\.meeko$/, ".ts")), code);
  }
  const modules: Record<string, ClientComponent> = {};
  for (const file of Object.keys(sources)) {
    modules[file] = await import(pathToFileURL(join(directory, file.replace(/\.meeko$/, ".ts"))).href) as ClientComponent;
  }
  return { modules, cleanup: () => project.remove() };
}

const routes: readonly RouteRecord[] = createRouteManifest([
  { id: "/", file: "toggle.meeko", layouts: ["app.meeko"] },
  { id: "/plain", file: "plain.meeko", layouts: ["app.meeko"] },
]);

const resolved = (value: unknown = true): ResolvedThemeConfig => resolveThemeConfig(value)!;

async function serve(modules: Record<string, ClientComponent>, config: DocumentConfig, nonce?: string, pageRoutes: readonly RouteRecord[] = routes) {
  const { createFrameworkHandler } = await runtime();
  return createFrameworkHandler({
    routes: pageRoutes, loadPage: async (file) => modules[file]!, clientEntry: "/entry.js", onError: () => {},
    document: { config, ...(nonce ? { nonce: () => nonce } : {}) },
  });
}

const page = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers: { accept: "text/html", ...headers } });

/** The body HTML without the hydration markers of text and components. */
const bare = (html: string): string => html.replace(/<!--\/?meeko:(?:text|component)[^>]*-->/g, "");

/** Runs the inline script against a happy-dom window, as the browser runs it while it parses `<head>`. */
function runScript(config: ResolvedThemeConfig, setup: { cookie?: string; stored?: string; dark?: boolean; className?: string } = {}) {
  const browser = new HappyWindow({ url: "https://example.test/", settings: { device: { prefersColorScheme: setup.dark ? "dark" : "light" } } });
  if (setup.cookie !== undefined) browser.document.cookie = setup.cookie;
  if (setup.stored !== undefined) browser.localStorage.setItem("meeko-theme", setup.stored);
  if (setup.className) browser.document.documentElement.className = setup.className;
  new Function("window", "document", "localStorage", "matchMedia", themeScript(config))(
    browser, browser.document, browser.localStorage, browser.matchMedia.bind(browser),
  );
  const root = browser.document.documentElement;
  const result = { theme: root.getAttribute("data-theme"), className: root.className, scheme: root.style.colorScheme };
  browser.happyDOM.abort();
  return result;
}

test("theme options are decided once and invalid ones fail with the field", () => {
  assert.deepEqual(resolveThemeConfig(true), {
    themes: ["light", "dark"], default: "system", system: { light: "light", dark: "dark" }, darkThemes: ["dark"],
    attribute: "data-theme", colorScheme: true, cookie: "meeko-theme", storageKey: "meeko-theme", clientHints: true,
  });
  assert.equal(resolveThemeConfig(undefined), undefined);
  assert.equal(resolveThemeConfig(false), undefined);
  // A resolved configuration resolves to itself: the build bakes it and the runtime reads it again.
  const custom = resolveThemeConfig({ themes: ["day", "night", "sepia"], system: { light: "day", dark: "night" }, attribute: "class", storageKey: false });
  assert.deepEqual(resolveThemeConfig(custom), custom);
  assert.deepEqual(custom!.darkThemes, ["night"]);
  assert.equal(custom!.default, "system");
  assert.equal(resolveThemeConfig({ themes: ["paper", "ink"], system: false })!.default, "paper");
  assert.deepEqual(resolveThemeConfig({ themes: ["light", "dark", "dim"], darkThemes: ["dark", "dim"] })!.darkThemes, ["dark", "dim"]);
  const invalid: Array<[unknown, RegExp]> = [
    ["dark", /debe ser true, false o un objeto/],
    [{ themes: [] }, /al menos un tema/],
    [{ themes: ["light", "light"] }, /nombres repetidos/],
    [{ themes: ["system"] }, /nombre de tema no válido "system"/],
    [{ themes: ['"><script>'] }, /nombre de tema no válido/],
    [{ themes: ["paper", "ink"] }, /system necesita los temas "light" y "dark"/],
    [{ default: "purple" }, /default debe ser uno de los temas de themes/],
    [{ system: false, default: "system" }, /default no puede ser "system"/],
    [{ darkThemes: ["purple"] }, /darkThemes debe ser uno de los temas de themes/],
    [{ attribute: "theme" }, /attribute debe ser "class" o un atributo data-\* en minúsculas/],
    [{ cookie: "my theme" }, /cookie debe ser un nombre de cookie/],
    [{ storageKey: "" }, /storageKey debe ser una cadena no vacía o false/],
    [{ clientHints: "yes" }, /clientHints debe ser un booleano/],
    [{ colours: true }, /campo desconocido colours/],
  ];
  for (const [value, message] of invalid) assert.throws(() => resolveThemeConfig(value), message, JSON.stringify(value));
});

test("the inline script applies the cookie, then localStorage, then the default, and follows the system", () => {
  const config = resolved();
  assert.deepEqual(runScript(config, { cookie: "meeko-theme=dark" }), { theme: "dark", className: "", scheme: "dark" });
  // The cookie wins over a stale localStorage value.
  assert.equal(runScript(config, { cookie: "meeko-theme=light", stored: "dark" }).theme, "light");
  // Without a cookie, the value localStorage kept (the format of the site before 1.4).
  assert.equal(runScript(config, { stored: "dark" }).theme, "dark");
  // "system" and no choice at all follow prefers-color-scheme.
  assert.deepEqual(runScript(config, { dark: true }), { theme: "dark", className: "", scheme: "dark" });
  assert.deepEqual(runScript(config, {}), { theme: "light", className: "", scheme: "light" });
  assert.equal(runScript(config, { cookie: "meeko-theme=system", dark: true }).theme, "dark");
  // A value that is not a theme is ignored, never written.
  assert.equal(runScript(config, { cookie: "meeko-theme=%22%3E%3Cscript%3E", dark: true }).theme, "dark");
  assert.equal(runScript(config, { cookie: "meeko-theme=%E0%A4%A", stored: "dark" }).theme, "dark");
  // The class mode replaces any other theme class and keeps the rest.
  const classes = resolved({ attribute: "class", colorScheme: false });
  assert.deepEqual(runScript(classes, { cookie: "meeko-theme=dark", className: "app light" }), { theme: null, className: "app dark", scheme: "" });
  // Without storage, localStorage is not read.
  assert.equal(runScript(resolved({ storageKey: false }), { stored: "dark" }).theme, "light");
  // The script depends only on the configuration: one CSP hash for every page.
  assert.equal(themeScript(config), themeScript(resolved()));
  assert.doesNotMatch(themeScript(config), /<\/|<!--/);
});

test("SSR reads the cookie: <html> and useTheme() are right in the first byte, with Vary", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const server = await serve(modules, { lang: "es", theme: resolved() }, "n1");
    const response = await server(page("https://example.test/", { cookie: "session=1; meeko-theme=dark" }));
    const html = await response.text();
    // data-theme-choice carries the choice of the cookie, for <MeekoThemeToggle> and the app's CSS.
    assert.match(html, /^<!doctype html><html lang="es" class="app" style="margin: 0" data-theme="dark" data-theme-choice="dark"><head>/);
    // color-scheme is set by the inline script through CSSOM: a style attribute would break a strict CSP.
    assert.doesNotMatch(html, /style="[^"]*color-scheme/);
    assert.match(bare(html), /<span id="icon">moon<\/span>/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(bare(html), /<p id="choice">dark<\/p><p id="themes">light,dark<\/p>/);
    // The inline script carries the nonce of the request, like any useHead script.
    const script = themeScript(resolved());
    assert.ok(html.includes(`<script nonce="n1">${script}</script>`), html);
    assert.equal(response.headers.get("vary"), "Cookie, Sec-CH-Prefers-Color-Scheme");
    assert.equal(response.headers.get("accept-ch"), "Sec-CH-Prefers-Color-Scheme");
    // An explicit choice does not depend on the hint: no retry for it.
    assert.equal(response.headers.get("critical-ch"), null);
    // Hydration renders what the server rendered: its values travel in the page state.
    const payload = JSON.parse(/<script id="meeko-payload" type="application\/json">(.*?)<\/script>/s.exec(html)![1]!) as { sharedState: Record<string, unknown> };
    assert.deepEqual(payload.sharedState["meeko:theme"], { theme: "dark", resolved: "dark", known: true });

    // A page that does not read the theme still gets it on <html>, and no page state.
    const plain = await (await server(page("https://example.test/plain", { cookie: "meeko-theme=light" }))).text();
    assert.match(plain, /<html lang="es" class="app" style="margin: 0" data-theme="light" data-theme-choice="light">/);
    assert.doesNotMatch(plain, /meeko:theme/);
  } finally {
    await cleanup();
  }
});

test("system mode: the client hint resolves it on the server; without it nothing is guessed and Critical-CH asks for it", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const server = await serve(modules, { theme: resolved() });
    const hinted = await server(page("https://example.test/", { "sec-ch-prefers-color-scheme": '"dark"' }));
    const html = await hinted.text();
    assert.match(html, /data-theme="dark"/);
    assert.match(bare(html), /<span id="icon">moon<\/span>/);
    assert.match(bare(html), /<p id="choice">system<\/p>/);
    assert.equal(hinted.headers.get("critical-ch"), "Sec-CH-Prefers-Color-Scheme");
    // Without the hint (Firefox, Safari, a first visit before Accept-CH) <html> keeps no theme, so
    // the CSS of prefers-color-scheme and the inline script decide; useTheme() renders the light theme.
    const unknown = await server(page("https://example.test/"));
    const plain = await unknown.text();
    assert.match(plain, /<html class="app" style="margin: 0">/);
    assert.match(bare(plain), /<span id="icon">sun<\/span>/);
    assert.equal(unknown.headers.get("critical-ch"), "Sec-CH-Prefers-Color-Scheme");
    // An unknown cookie value is ignored and never reflected.
    const forged = await (await server(page("https://example.test/", { cookie: 'meeko-theme="><script>alert(1)</script>', "sec-ch-prefers-color-scheme": "light" }))).text();
    assert.match(forged, /data-theme="light"/);
    assert.doesNotMatch(forged, /alert\(1\)/);
    // A theme other than system ignores the hint.
    const explicit = await (await server(page("https://example.test/", { cookie: "meeko-theme=light", "sec-ch-prefers-color-scheme": "dark" }))).text();
    assert.match(explicit, /data-theme="light"/);
    // clientHints: false neither reads nor asks for the hint.
    const noHints = await serve(modules, { theme: resolved({ clientHints: false }) });
    const ignored = await noHints(page("https://example.test/", { "sec-ch-prefers-color-scheme": "dark" }));
    assert.doesNotMatch(await ignored.text(), /data-theme=/);
    assert.equal(ignored.headers.get("accept-ch"), null);
    assert.equal(ignored.headers.get("vary"), "Cookie");
    // A navigation payload is not a document: no client hints.
    const payload = await server(new Request("https://example.test/", { headers: { accept: "application/meeko+json" } }));
    assert.equal(payload.headers.get("accept-ch"), null);
  } finally {
    await cleanup();
  }
});

test("class mode adds the theme to the classes of <html>; without theme nothing changes", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const server = await serve(modules, { theme: resolved({ attribute: "class", colorScheme: false }) });
    const html = await (await server(page("https://example.test/", { cookie: "meeko-theme=dark" }))).text();
    assert.match(html, /<html class="app dark" style="margin: 0" data-theme-choice="dark"><head>/);
    const off = await serve(modules, { lang: "es" });
    const response = await off(page("https://example.test/plain", { cookie: "meeko-theme=dark" }));
    const plain = await response.text();
    assert.match(plain, /<html lang="es" class="app" style="margin: 0"><head>/);
    assert.doesNotMatch(plain, /prefers-color-scheme/);
    assert.equal(response.headers.get("vary"), null);
  } finally {
    await cleanup();
  }
});

test("the theme script goes before the linked stylesheets of <head>, so it never waits for them", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const server = await serve(modules, {
      theme: resolved(),
      head: { meta: [{ httpEquiv: "Content-Security-Policy", content: "script-src 'self'" }], link: [{ rel: "stylesheet", href: "https://fonts.example.test/css" }], script: [{ src: "/analytics.js", defer: true }] },
    });
    const html = await (await server(page("https://example.test/"))).text();
    const position = (pattern: RegExp): number => {
      const match = pattern.exec(html);
      assert.ok(match, `${pattern} is in the document`);
      return match.index;
    };
    const script = position(/<script>\(function\(\)\{/);
    // A CSP meta tag still applies to the script, and the stylesheet does not block it.
    assert.ok(position(/<meta http-equiv="Content-Security-Policy"/) < script);
    assert.ok(script < position(/<link rel="stylesheet" href="https:\/\/fonts\.example\.test\/css">/));
    assert.ok(script < position(/<script src="\/analytics\.js" defer>/));
  } finally {
    await cleanup();
  }
});

/** Apps and windows that a test opened; `closeAll` releases them even after a failed assertion. */
const opened: (() => void)[] = [];
function closeAll(): void {
  for (const close of opened.splice(0).reverse()) {
    try { close(); }
    catch { /* Already released by the test. */ }
  }
}

async function boot(modules: Record<string, ClientComponent>, config: DocumentConfig, options: { cookie?: string; serverCookie?: string; dark?: boolean; stored?: string; hint?: string; routes?: readonly RouteRecord[]; withoutInlineScript?: boolean; beforeMount?: (document: Document) => void }) {
  const { mountClientApp } = await runtime();
  const pageRoutes = options.routes ?? routes;
  const server = await serve(modules, config, undefined, pageRoutes);
  const browser = new HappyWindow({ url: "https://example.test/", settings: { device: { prefersColorScheme: options.dark ? "dark" : "light" } } });
  if (options.cookie) browser.document.cookie = options.cookie;
  if (options.stored) browser.localStorage.setItem("meeko-theme", options.stored);
  const headers: Record<string, string> = {};
  const serverCookie = options.serverCookie ?? options.cookie;
  if (serverCookie) headers.cookie = serverCookie;
  if (options.hint) headers["sec-ch-prefers-color-scheme"] = options.hint;
  let html = await (await server(page("https://example.test/", headers))).text();
  // happy-dom stops parsing at the `<` of the class-mode script; the cookie already gave SSR the class.
  if (options.withoutInlineScript) html = html.replace(/<script>\(function\(\)\{[\s\S]*?<\/script>/, "");
  browser.document.write(html);
  const ssr = { html: browser.document.documentElement.getAttribute("data-theme"), app: browser.document.getElementById("app")!.innerHTML };
  const mutations: string[] = [];
  const observer = new browser.MutationObserver((records) => {
    for (const record of records) mutations.push(record.type === "attributes" ? `${(record.target as unknown as Element).localName}@${record.attributeName}` : record.type);
  });
  observer.observe(browser.document.getElementById("app")!, { subtree: true, childList: true, characterData: true, attributes: true });
  options.beforeMount?.(browser.document as unknown as Document);
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes: pageRoutes, document: config,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    serverData: true,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
    onError: (error) => { errors.push(error); },
    browser: browser as unknown as Window,
  });
  const appMutations = mutations.splice(0);
  opened.push(() => browser.happyDOM.abort(), () => app.dispose(), () => observer.disconnect());
  return { app, browser, document: browser.document, ssr, appMutations, errors };
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index++) await new Promise((done) => setTimeout(done, 0));
};

test("hydration with the cookie changes nothing, and a change updates <html>, the cookie, localStorage and other tabs", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const { browser, document, ssr, appMutations, errors } = await boot(modules, { theme: resolved() }, { cookie: "meeko-theme=dark" });
    assert.equal(ssr.html, "dark");
    assert.deepEqual(appMutations, [], "hydration did not touch the server HTML");
    assert.equal(document.getElementById("app")!.innerHTML, ssr.app);
    assert.equal(document.documentElement.getAttribute("data-theme"), "dark");
    assert.equal(document.getElementById("icon")!.textContent, "moon");
    (document.getElementById("toggle") as unknown as HTMLElement).click();
    assert.equal(document.documentElement.getAttribute("data-theme"), "light");
    assert.equal(document.documentElement.style.getPropertyValue("color-scheme"), "light");
    assert.match(document.documentElement.getAttribute("style") ?? "", /margin: 0/);
    assert.match(document.documentElement.getAttribute("class") ?? "", /^app$/);
    assert.equal(document.getElementById("icon")!.textContent, "sun");
    assert.equal(document.getElementById("toggle")!.getAttribute("aria-pressed"), "false");
    assert.match(document.cookie, /meeko-theme=light/);
    assert.equal(browser.localStorage.getItem("meeko-theme"), "light");
    // "system" follows prefers-color-scheme (light here) and is stored as a choice.
    (document.getElementById("system") as unknown as HTMLElement).click();
    assert.equal(document.getElementById("choice")!.textContent, "system");
    assert.match(document.cookie, /meeko-theme=system/);
    // Another tab chose dark: the storage event brings it.
    browser.localStorage.setItem("meeko-theme", "dark");
    browser.dispatchEvent(new browser.StorageEvent("storage", { key: "meeko-theme", newValue: "dark", oldValue: "system" }));
    await flush();
    assert.equal(document.getElementById("choice")!.textContent, "dark");
    assert.equal(document.documentElement.getAttribute("data-theme"), "dark");
    // An invalid value from another tab is ignored.
    browser.dispatchEvent(new browser.StorageEvent("storage", { key: "meeko-theme", newValue: "purple" }));
    assert.equal(document.getElementById("choice")!.textContent, "dark");
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("class mode keeps the classes of <html> that other scripts add, through hydration, changes, navigation and dispose", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  const withoutShell: readonly RouteRecord[] = createRouteManifest([
    { id: "/", file: "toggle.meeko", layouts: [] },
    { id: "/plain", file: "plain.meeko", layouts: [] },
  ]);
  const classes = (document: { documentElement: { classList: Iterable<string> } }): string[] => [...document.documentElement.classList].sort();
  try {
    const config = { theme: resolved({ attribute: "class", colorScheme: false }) };
    // A font loader and a `no-js` swap write their classes on <html> before the application mounts.
    const { app, document } = await boot(modules, config, {
      cookie: "meeko-theme=dark", routes: withoutShell, withoutInlineScript: true,
      beforeMount: (document) => document.documentElement.classList.add("js", "wf-active"),
    });
    assert.deepEqual(classes(document), ["dark", "js", "wf-active"]);
    (document.getElementById("toggle") as unknown as HTMLElement).click();
    assert.deepEqual(classes(document), ["js", "light", "wf-active"]);
    await app.navigate("https://example.test/plain");
    assert.ok(document.getElementById("plain"));
    assert.deepEqual(classes(document), ["js", "light", "wf-active"]);
    document.documentElement.classList.add("late");
    await app.navigate("https://example.test/");
    assert.deepEqual(classes(document), ["js", "late", "light", "wf-active"]);
    app.dispose();
    assert.deepEqual(classes(document), ["js", "late", "light", "wf-active"]);
    closeAll();

    // The class of useHead lives next to the theme's.
    const shell = await boot(modules, config, { cookie: "meeko-theme=dark", withoutInlineScript: true });
    assert.deepEqual(classes(shell.document), ["app", "dark"]);
    (shell.document.getElementById("toggle") as unknown as HTMLElement).click();
    assert.deepEqual(classes(shell.document), ["app", "light"]);
    await shell.app.navigate("https://example.test/plain");
    assert.deepEqual(classes(shell.document), ["app", "light"]);
    assert.deepEqual(shell.errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("system mode with the hint hydrates without changes; a page the server could not resolve settles after hydration", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const hinted = await boot(modules, { theme: resolved() }, { dark: true, hint: "dark" });
    assert.equal(hinted.ssr.html, "dark");
    assert.deepEqual(hinted.appMutations, []);
    assert.equal(hinted.document.getElementById("icon")!.textContent, "moon");
    closeAll();
    // A prerendered page or a static host: the server rendered the default, the browser stored dark.
    const stored = await boot(modules, { theme: resolved() }, { cookie: "meeko-theme=dark", serverCookie: "" });
    assert.equal(stored.ssr.html, null);
    // <html> has the real theme before hydration ends; components switch once it has ended.
    assert.equal(stored.document.documentElement.getAttribute("data-theme"), "dark");
    assert.equal(stored.document.getElementById("icon")!.textContent, "moon");
    assert.equal(stored.document.getElementById("choice")!.textContent, "dark");
    assert.deepEqual(stored.errors, []);
    closeAll();
    // A choice that only localStorage remembers goes back to the cookie for the next request.
    const migrated = await boot(modules, { theme: resolved() }, { stored: "dark" });
    assert.match(migrated.document.cookie, /meeko-theme=dark/);
    assert.equal(migrated.document.documentElement.getAttribute("data-theme"), "dark");
  } finally {
    closeAll();
    await cleanup();
  }
});

test("useTheme() rejects an unknown theme, and fails clearly without theme in the configuration", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const failures: unknown[] = [];
    const { createFrameworkHandler } = await runtime();
    const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]!, onError: (error) => failures.push(error) });
    assert.equal((await server(page("https://example.test/"))).status, 500);
    assert.match(String(failures[0]), /useTheme\(\) needs theme in meeko\.config\.ts/);
    // In the browser, an unknown theme is a TypeError and changes nothing.
    const { BrowserTheme } = await import(fileUrl("src/framework/theme.ts")) as typeof import("../src/framework/theme.ts");
    const browser = new HappyWindow({ url: "https://example.test/" });
    const applied: unknown[] = [];
    const theme = new BrowserTheme(browser as unknown as Window, resolved(), { setTheme: (value) => applied.push(value?.resolved) }, undefined);
    try {
      assert.throws(() => theme.state.set("purple"), /useTheme\(\): unknown theme "purple"; use "system", "light", "dark"/);
      assert.throws(() => { theme.state.theme.value = "purple"; }, TypeError);
      assert.equal(theme.state.theme.value, "system");
      theme.state.set("dark");
      assert.equal(theme.state.resolved.value, "dark");
      assert.deepEqual(applied, ["light", "dark"]);
    } finally {
      theme.dispose();
      browser.happyDOM.abort();
    }
    // On the server the theme is read-only: it changes in the browser.
    const { requestTheme } = await import(fileUrl("src/framework/theme.ts")) as typeof import("../src/framework/theme.ts");
    const state = requestTheme(resolved(), page("https://example.test/", { cookie: "meeko-theme=dark" })).state;
    assert.equal(state.theme.value, "dark");
    assert.throws(() => state.set("light"), /changes in the browser/);
    assert.throws(() => { state.theme.value = "light"; }, /changes in the browser/);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("theme is validated in meeko.config.ts and baked into the server and client manifests", { timeout: 30_000 }, async () => {
  const project = await createTempProject("theme-config");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await writeFile(join(root, "app", "pages", "index.meeko"), "<template><h1>Inicio</h1></template>\n");
    await writeFile(join(root, "meeko.config.mjs"), 'export default { theme: { themes: ["light", "dark", "sepia"] } };\n');
    const { manifest } = await discoverAppManifest(root, { entry: "/entry.js", css: [], preload: [] });
    assert.deepEqual(manifest.document?.theme, resolveThemeConfig({ themes: ["light", "dark", "sepia"] }));
    assert.match(await clientRoutesSource(root), /export const documentConfig = \{"theme":\{"themes":\["light","dark","sepia"\]/);
    await writeFile(join(root, "meeko.config.mjs"), 'export default { theme: { default: "sepia" } };\n');
    await assert.rejects(loadMeekoConfig(root), /theme: default debe ser uno de los temas de themes \(light, dark\)/);
    await writeFile(join(root, "meeko.config.mjs"), 'export default { document: { theme: {} } };\n');
    await assert.rejects(loadMeekoConfig(root), /document\.theme no es una opción de meeko\.config\.ts; use theme en el nivel superior/);
  } finally {
    await project.remove();
  }
});

test("useTheme is a framework autoimport that a project composable of the same name replaces", { timeout: 30_000 }, async () => {
  const project = await createTempProject("theme-autoimport");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const filename = join(root, "app", "pages", "index.meeko");
    const registry = await discoverAutoImports(root);
    assert.match(applyAutoImports("useTheme();", filename, registry, "client"), /import \{ useTheme as useTheme \} from "@meekojs\/meeko\/framework"/);
    await mkdir(join(root, "app", "composables"), { recursive: true });
    await writeFile(join(root, "app", "composables", "theme.ts"), "export function useTheme() { return 1; }\n");
    const own = await discoverAutoImports(root);
    assert.equal(own.filter((entry) => entry.name === "useTheme").length, 1);
    assert.match(applyAutoImports("useTheme();", filename, own, "client"), /composables\/theme\.js/);
  } finally {
    await project.remove();
  }
});

const typedPage = (call: string) => `<script lang="ts">
const { theme, resolved, set } = useTheme();
const dark: boolean = resolved.value === "dark";
${call}
</script>
<template><p>{theme.value} {String(dark)}</p></template>
`;

test("meeko check types useTheme() with the literal themes of meeko.config.ts", { timeout: 120_000 }, async () => {
  const project = await createTempProject("theme-check");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await writeFile(join(root, "meeko.config.mjs"), 'export default { theme: { themes: ["light", "dark", "sepia"] } };\n');
    await mkdir(join(root, "app", "pages"), { recursive: true });
    const file = join(root, "app", "pages", "index.meeko");
    await writeFile(file, typedPage('const pick = (): void => set("sepia"); theme.value = "system"; void pick;'));
    await prepareFrameworkTypeDeclarations(root);
    const types = await readFile(join(root, ".meeko", "types", "routes.d.ts"), "utf8");
    assert.match(types, /interface GeneratedTheme \{\n {4}readonly themes: "light" \| "dark" \| "sepia";\n {4}readonly choices: "light" \| "dark" \| "sepia" \| "system";/);
    assert.deepEqual((await checkApp(root)).map((item) => `${item.filename}:${item.code}: ${item.message}`), []);
    await writeFile(file, typedPage('const pick = (): void => set("purple"); void pick;'));
    const invalid = await checkApp(root);
    assert.ok(invalid.some((item) => item.filename === file && item.code === "TS2345" && /purple/.test(item.message)), JSON.stringify(invalid));
  } finally {
    await project.remove();
  }
});

test("the static adapter prerenders the theme script and allows it by its hash in the CSP", { timeout: 180_000 }, async (context) => {
  const root = await tempProject(context, "theme-static");
  await writeStaticApp(root, staticAppConfig.replace("sitemap: true,", "sitemap: true,\n  theme: true,"));
  const result = await buildProject(root);
  const read = (file: string): Promise<string> => readFile(join(result.output, ...file.split("/")), "utf8");
  const script = themeScript(resolved());
  for (const file of ["index.html", "docs/a/index.html", "404.html"]) {
    const html = await read(file);
    // No request, no cookie: <html> carries no theme and the script applies the stored one.
    assert.match(html, /^<!doctype html><html lang="es"><head>/, file);
    assert.ok(html.includes(`<script>${script}</script>`), file);
  }
  const headers = await read("_headers");
  assert.ok(headers.includes(sha256(script)), headers);
  assert.ok(headers.includes(sha256("window.boot = 1")), headers);
});
