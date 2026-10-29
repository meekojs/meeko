import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { Window as HappyWindow } from "happy-dom";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CompletionItem, MarkupContent } from "vscode-languageserver/node";
import { builtinOutputs } from "../scripts/builtin-components.ts";
import { compileWithAutoImports } from "../src/autoimports.ts";
import type { AutoImport } from "../src/autoimports.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import { checkApp } from "../src/framework/check-app.ts";
import { readThemeEnabledSync, readThemeOptionSync } from "../src/framework/config.ts";
import { buildProject } from "../src/framework/project.ts";
import { inlineScriptHashes, inlineStyleHashes } from "../src/framework/script-hashes.ts";
import { prepareFrameworkTypeDeclarations } from "../src/framework/type-declarations.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import type { DocumentConfig } from "../src/framework/head.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { ErrorPageRecord, RouteRecord } from "../src/framework/router.ts";
import { themeEndpoint, themeReturnPath } from "../src/framework/theme-endpoint.ts";
import { resolveThemeConfig, THEME_ENDPOINT, themeStyle, themeToggleGroupLabel, themeToggleItems, themeToggleKeyTarget, themeToggleMode, themeToggleStatus } from "../src/framework/theme.ts";
import type { ResolvedThemeConfig, ThemeToggleContext, ThemeToggleOptions } from "../src/framework/theme.ts";
import { contentSecurityPolicy } from "../src/framework-server/csp.ts";
import { completion, componentNameCompletion, definition, directiveNameCompletion, hover } from "../src/language-server/features.ts";
import { staticAppConfig, writeStaticApp } from "./helpers/static-app.ts";
import { createTempProject, tempProject } from "./helpers/temp-project.ts";
import { languageProject } from "./language-server-workspace.ts";

const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href;
const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
const resolved = (value: unknown = true): ResolvedThemeConfig => resolveThemeConfig(value)!;

/** The MEEK code of a compile error, or `undefined` when the source compiles. */
function errorCode(source: string, options: Parameters<typeof compile>[2] = {}): string | undefined {
  try { compile(source, "/project/app/components/Nav.meeko", options); return undefined; }
  catch (error) {
    if (error instanceof MeekoCompileError) return error.diagnostic.code;
    throw error;
  }
}

const iconToggle = `<MeekoThemeToggle class="toggle"><snippet name="light"><i class="sun">sol</i></snippet><snippet name="dark"><i class="moon">luna</i></snippet><snippet name="system"><i class="monitor">pc</i></snippet></MeekoThemeToggle>`;

test("the compiled <MeekoThemeToggle> that the package ships is up to date with its .meeko source", async () => {
  for (const [output, code] of await builtinOutputs()) {
    assert.equal(await readFile(output, "utf8"), code, `${output} is stale: run pnpm run builtins`);
  }
  // The form posts to the endpoint of the server.
  assert.match(await readFile("src/builtins/MeekoThemeToggle.meeko", "utf8"), new RegExp(`action="${THEME_ENDPOINT}"`));
});

test("<MeekoThemeToggle> is the component that Meeko ships, with its props and snippets, and MEEK111 without theme", async () => {
  const { code } = compile(`<template>${iconToggle}<MeekoThemeToggle mode="select" bind:themes="['light', 'dark']" /></template>`, "/project/app/components/Nav.meeko");
  assert.match(code, /__meeko\.renderComponent<any>\(0, __meeko_MeekoThemeToggle, __meeko\.componentTag\(\(\) => __meeko_MeekoThemeToggle\)\(\{ "class": "toggle" \}/);
  assert.match(code, /"light": __meeko\.snippet\(/);
  assert.match(code, /"system": __meeko\.snippet\(/);
  assert.match(code, /\{ "mode": "select", "themes": \['light', 'dark'\] \}/);
  // Its module counts among the children that a navigation may need to load.
  assert.match(code, /__meekoChildren[^\n]*= \(\) => \[__meeko_MeekoThemeToggle\]/);
  // The project's theme decides whether the tag exists; a caller that does not know compiles it.
  assert.equal(errorCode(`<template>${iconToggle}</template>`, { theme: false }), "MEEK111");
  assert.equal(errorCode(`<template>${iconToggle}</template>`, { theme: true }), undefined);
  assert.equal(errorCode(`<template>${iconToggle}</template>`), undefined);
});

test("a project component named MeekoThemeToggle wins over the built-in tag, with MEEK106 and without MEEK111", async () => {
  const source = "<template><MeekoThemeToggle variant=\"x\" /></template>";
  const autoimported = compile(source, "/project/app/components/Nav.meeko", { projectComponents: ["MeekoThemeToggle"], theme: false });
  assert.match(autoimported.code, /__meeko\.renderComponent<any>\(0, MeekoThemeToggle,/);
  assert.doesNotMatch(autoimported.code, /__meeko_MeekoThemeToggle/);
  assert.deepEqual(autoimported.warnings?.map((warning) => warning.code), ["MEEK106"]);
  assert.match(autoimported.warnings![0]!.message, /el selector del tema de theme/);
  const declared = compile("<script lang=\"ts\">\nimport MeekoThemeToggle from \"./Toggle.meeko\";\n</script>\n<template><MeekoThemeToggle /></template>", "/project/app/components/Nav.meeko");
  assert.match(declared.code, /renderComponent<any>\(0, MeekoThemeToggle,/);
  const registry: AutoImport[] = [{ name: "MeekoThemeToggle", imported: "*", file: "/project/app/components/MeekoThemeToggle.meeko", scope: "app", typeOnly: false, component: true }];
  const withImports = await compileWithAutoImports(source, "/project/app/components/Nav.meeko", {}, "client", registry);
  assert.match(withImports.code, /import \* as MeekoThemeToggle from "\.\/MeekoThemeToggle\.meeko";/);
});

test("meeko check and the editor read theme from meeko.config.* without running it", async () => {
  const project = await createTempProject("theme-toggle-config");
  try {
    const root = project.root;
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const filename = join(root, "app", "components", "Nav.meeko");
    const source = `<template>${iconToggle}</template>`;
    // Without a configuration nothing is known: the folder may be a layer with its own package.json.
    assert.equal(readThemeEnabledSync(root), undefined, "no configuration");
    assert.match((await compileWithAutoImports(source, filename, {}, "client", [])).code, /__meeko_MeekoThemeToggle/);
    await writeFile(join(root, "meeko.config.mjs"), "export default {};\n");
    await assert.rejects(compileWithAutoImports(source, filename, {}, "client", []), /MEEK111/);
    const cases: Array<[string, boolean | undefined]> = [
      ["export default { theme: true };\n", true],
      ["export default defineMeekoConfig({ theme: { themes: [\"light\", \"dark\", \"sepia\"] } });\n", true],
      ["export default { theme: false };\n", false],
      ["export default { site: \"https://example.com\" };\n", false],
      ["const theme = true;\nexport default { theme };\n", undefined],
      ["export default { theme: process.env.THEME === \"1\" };\n", undefined],
      ["export default { ...shared };\n", undefined],
    ];
    for (const [config, expected] of cases) {
      await writeFile(join(root, "meeko.config.mjs"), config);
      assert.equal(readThemeEnabledSync(root), expected, config);
    }
    await writeFile(join(root, "meeko.config.mjs"), "export default { theme: true };\n");
    assert.match((await compileWithAutoImports(source, filename, {}, "client", [])).code, /__meeko_MeekoThemeToggle/);
  } finally {
    await project.remove();
  }
});

test("meeko check gives no MEEK111 for a <MeekoThemeToggle> in a layer with its own package.json", { timeout: 180_000 }, async () => {
  const project = await createTempProject("theme-toggle-layer");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await writeFile(join(root, "meeko.config.mjs"), 'export default { theme: true, layers: ["./layers/base"] };\n');
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await writeFile(join(root, "app", "pages", "index.meeko"), "<template><BaseNav /></template>\n");
    // A layer that is its own package: its nearest package.json has no meeko.config.* beside it.
    await mkdir(join(root, "layers", "base", "app", "components"), { recursive: true });
    await mkdir(join(root, "layers", "base", "app", "pages"), { recursive: true });
    await writeFile(join(root, "layers", "base", "package.json"), '{"name":"base-layer","private":true,"type":"module"}\n');
    await writeFile(join(root, "layers", "base", "app", "components", "BaseNav.meeko"), "<template><nav><MeekoThemeToggle /></nav></template>\n");
    await prepareFrameworkTypeDeclarations(root);
    const diagnostics = (await checkApp(root)).map((item) => `${item.code}: ${item.message}`);
    assert.ok(!diagnostics.some((item) => item.startsWith("MEEK111:")), JSON.stringify(diagnostics));
  } finally {
    await project.remove();
  }
});

/** A context like the one `useThemeToggle()` returns, for the pure view. */
function context(config: ResolvedThemeConfig, choice: string, options: { resolved?: string; known?: boolean; interactive?: boolean } = {}): ThemeToggleContext {
  const value = <T>(current: T) => ({ get value() { return current; } });
  return {
    config, known: value(options.known ?? true), interactive: value(options.interactive ?? false),
    state: { theme: { value: choice } as never, resolved: value(options.resolved ?? (choice === "system" ? "light" : choice)), themes: config.themes, set: () => {} },
  };
}

/** The items and the status of a toggle, as the component computes them. */
function view(toggle: ThemeToggleContext, options: ThemeToggleOptions = {}) {
  const items = themeToggleItems(toggle.config, options);
  return { items, ...themeToggleStatus(toggle, items, options) };
}

test("the toggle cycles its list, names the current and next theme, and stays neutral while the choice is unknown", () => {
  const config = resolved();
  const dark = view(context(config, "dark"));
  assert.deepEqual(dark.items, [{ name: "light", label: "Claro", icon: "light" }, { name: "dark", label: "Oscuro", icon: "dark" }, { name: "system", label: "Sistema", icon: "system" }]);
  assert.deepEqual({ ...dark, items: undefined }, { items: undefined, next: "system", label: "Tema: oscuro. Cambiar a sistema", checked: "dark", focused: undefined });
  assert.equal(themeToggleGroupLabel(undefined), "Tema");
  // The same choices from a new `themes` array keep the list, so no row is written again.
  const listed = themeToggleItems(config, { themes: ["light", "dark"] });
  assert.equal(themeToggleItems(config, { themes: ["light", "dark"] }, listed), listed);
  assert.notEqual(themeToggleItems(config, { themes: ["light", "dark"], labels: { dark: "Noche" } }, listed), listed);
  assert.notEqual(themeToggleItems(config, { themes: ["dark", "light"] }, listed), listed);
  assert.equal(view(context(config, "system")).next, "light");
  // A server render without the cookie, or hydration of one: nothing that could be false.
  const unknown = view(context(config, "system", { known: false }));
  assert.equal(unknown.label, "Cambiar tema");
  assert.equal(unknown.checked, undefined);
  // A light/dark toggle in "system": its icons of light and dark stand for system, and it moves on from the theme it shows.
  const pair = view(context(config, "system", { resolved: "dark" }), { themes: ["light", "dark"] });
  assert.deepEqual(pair.items.map((item) => item.icon), ["light system-light", "dark system-dark"]);
  assert.equal(pair.next, "light");
  assert.equal(pair.label, "Tema: sistema. Cambiar a claro");
  assert.equal(pair.checked, undefined, "no radio stands for a choice outside the list");
  // Labels, messages and a roving tabindex once the browser handles the keys.
  const custom = view(context(resolved({ themes: ["light", "dark", "sepia"] }), "sepia", { interactive: true }), {
    labels: { light: "Light", dark: "Dark" },
    messages: { cycle: (current, next) => `Theme: ${current}. Switch to ${next}`, unknown: "Switch theme", group: "Theme" },
  });
  assert.deepEqual(custom.items.map((item) => item.label), ["Light", "Dark", "sepia", "Sistema"]);
  assert.equal(custom.focused, "sepia");
  assert.equal(custom.label, "Theme: sepia. Switch to Sistema");
  assert.equal(themeToggleGroupLabel({ group: "Theme" }), "Theme");
  assert.equal(view(context(config, "system", { known: false, interactive: true })).focused, "light", "the first radio takes the focus when none is checked");
  assert.throws(() => view(context(config, "dark"), { themes: ["purple"] }), /themes has an unknown theme "purple"; use "light", "dark", "system"/);
  assert.throws(() => view(context(resolved({ system: false }), "dark"), { themes: ["system"] }), /unknown theme "system"/);
  assert.throws(() => view(context(config, "dark"), { themes: [] }), /at least one theme/);
  assert.equal(themeToggleMode(undefined), "cycle");
  assert.equal(themeToggleMode("select"), "select");
  assert.throws(() => themeToggleMode("menu"), /mode must be "cycle" or "select"/);
  // The keys of a radio group.
  assert.equal(themeToggleKeyTarget("ArrowRight", 2, 3), 0);
  assert.equal(themeToggleKeyTarget("ArrowUp", 0, 3), 2);
  assert.equal(themeToggleKeyTarget("End", 0, 3), 2);
  assert.equal(themeToggleKeyTarget("Home", 2, 3), 0);
  assert.equal(themeToggleKeyTarget("Enter", 0, 3), undefined);
});

test("the style of <head> hides every icon but the one of data-theme-choice, also for system and without the attribute", () => {
  const style = themeStyle(resolved());
  assert.equal(style, [
    ':root[data-theme-choice="light"] [data-meeko-theme-icon]:not([data-meeko-theme-icon~="light"]){display:none}',
    ':root[data-theme-choice="dark"] [data-meeko-theme-icon]:not([data-meeko-theme-icon~="dark"]){display:none}',
    '@media (prefers-color-scheme:light){:root:is([data-theme-choice="system"],:not([data-theme-choice])) [data-meeko-theme-icon]:not([data-meeko-theme-icon~="system"],[data-meeko-theme-icon~="system-light"]){display:none}}',
    '@media (prefers-color-scheme:dark){:root:is([data-theme-choice="system"],:not([data-theme-choice])) [data-meeko-theme-icon]:not([data-meeko-theme-icon~="system"],[data-meeko-theme-icon~="system-dark"]){display:none}}',
  ].join("\n"));
  // Only display: none, and nothing that could close the element.
  assert.deepEqual([...new Set(style.match(/\{[^{}]*\}/g))], ["{display:none}"]);
  assert.doesNotMatch(style, /<\//);
  // Without system, the default theme also stands for a document without the attribute.
  assert.match(themeStyle(resolved({ themes: ["paper", "ink"], system: false })), /^:root:is\(\[data-theme-choice="paper"\],:not\(\[data-theme-choice\]\)\)/);
  assert.throws(() => resolveThemeConfig({ attribute: "data-theme-choice" }), /attribute cannot be data-theme-choice/);
});

test("contentSecurityPolicy allows inline styles by their hashes, but never overrides 'unsafe-inline'", () => {
  const style = "'sha256-Ab+/0='";
  assert.equal(contentSecurityPolicy({ "default-src": ["'self'"] }, [], [style]), `default-src 'self'; style-src 'self' ${style}`);
  assert.equal(contentSecurityPolicy({ "style-src": ["'self'"] }, [], [style, style]), `style-src 'self' ${style}`);
  // <style> elements follow style-src-elem when there is one.
  assert.equal(contentSecurityPolicy({ "style-src": ["'self'"], "style-src-elem": ["'self'"] }, [], [style]), `style-src 'self'; style-src-elem 'self' ${style}`);
  // A hash would turn off 'unsafe-inline' and block style="…" attributes: the policy stays as it is.
  assert.equal(contentSecurityPolicy({ "style-src": ["'self'", "'unsafe-inline'"] }, [], [style]), "style-src 'self' 'unsafe-inline'");
  assert.equal(contentSecurityPolicy({ "default-src": ["'self'", "'UNSAFE-INLINE'"] }, [], [style]), "default-src 'self' 'UNSAFE-INLINE'");
  assert.equal(contentSecurityPolicy({ "script-src": ["'self'"] }, [], [style]), "script-src 'self'", "no style directive: styles are allowed already");
  assert.throws(() => contentSecurityPolicy({ "default-src": ["'self'"] }, [], ["sha256-x"]), /invalid style hash/);
  // inlineStyleHashes reads every <style> as the browser does, never a style attribute.
  const html = '<!doctype html><html><head><style>a{color:red}</style><style nonce="x">b{}</style></head><body><p style="color:blue"></p><template><style>c{}</style></template></body></html>';
  assert.deepEqual(inlineStyleHashes(html), [sha256("a{color:red}"), sha256("b{}"), sha256("c{}")].sort());
  assert.deepEqual(inlineScriptHashes(html).hashes, []);
});

test("POST /_meeko/theme validates the theme and the Origin, writes the cookie and returns only to this origin", async () => {
  const config = resolved({ themes: ["light", "dark", "sepia"] });
  const origin = "https://example.test";
  const post = (body: string, headers: Record<string, string> = {}, url = `${origin}${THEME_ENDPOINT}`) => themeEndpoint(config, new Request(url, {
    method: "POST", body, headers: { origin, "content-type": "application/x-www-form-urlencoded", ...headers },
  }));
  const done = await post("theme=sepia&return=%2Fdocs%3Ftab%3Da");
  assert.equal(done.status, 303);
  assert.equal(done.headers.get("location"), "/docs?tab=a");
  assert.equal(done.headers.get("set-cookie"), "meeko-theme=sepia; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  assert.equal(done.headers.get("cache-control"), "no-store");
  assert.equal((await themeEndpoint(config, new Request("http://localhost/_meeko/theme", { method: "POST", body: "theme=system", headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded; charset=UTF-8" } }))).headers.get("set-cookie"), "meeko-theme=system; Path=/; Max-Age=31536000; SameSite=Lax");
  // Never an open redirect: anything that is not a path of this origin goes back to /.
  for (const target of ["https://evil.example/", "//evil.example/x", "/\\evil.example", "/\tx", "javascript:alert(1)", "docs", "",
    // Dot segments that leave `//` at the start: a protocol-relative Location once resolved.
    "/.//evil.example", "/..//evil.example", "/a/..//evil.example/x", "/%2e//evil.example", "/%2E%2e//evil.example"]) {
    assert.equal(themeReturnPath(target, origin), "/", JSON.stringify(target));
    assert.equal((await post(`theme=dark&return=${encodeURIComponent(target)}`)).headers.get("location"), "/", JSON.stringify(target));
  }
  assert.equal(themeReturnPath("/a/../b?x=1#top", origin), "/b?x=1#top");
  // Only a theme of the configuration, never a value written to the cookie as it came.
  for (const body of ["theme=purple", "theme=%22%3E%3Cscript%3E", "return=%2F", "theme=light%3B%20Domain%3Devil"]) {
    const rejected = await post(body);
    assert.equal(rejected.status, 400, body);
    assert.equal(rejected.headers.get("set-cookie"), null, body);
  }
  assert.equal((await themeEndpoint(resolved({ system: false }), new Request(`${origin}${THEME_ENDPOINT}`, { method: "POST", body: "theme=system", headers: { origin, "content-type": "application/x-www-form-urlencoded" } }))).status, 400);
  // CSRF: another site, a null or missing Origin cannot change the theme nor use the redirect.
  for (const headers of [{ origin: "https://evil.example" }, { origin: "null" }, { origin: "" }]) {
    const forbidden = await post("theme=dark&return=%2F", headers);
    assert.equal(forbidden.status, 403, JSON.stringify(headers));
    assert.equal(forbidden.headers.get("set-cookie"), null);
  }
  assert.equal((await post("theme=dark", { "content-type": "application/json" })).status, 415);
  assert.equal((await post(`theme=dark&return=/${"x".repeat(4096)}`)).status, 413);
  const get = await themeEndpoint(config, new Request(`${origin}${THEME_ENDPOINT}`));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
});

/** The runtime as the compiled components import it, by file URL: one instance for pages, server and browser. */
const runtime = async () => ({
  ...await import(fileUrl("src/framework/server.ts")) as typeof import("../src/framework/server.ts"),
  ...await import(fileUrl("src/framework/client.ts")) as typeof import("../src/framework/client.ts"),
});

const sources: Record<string, string> = {
  "app.meeko": `<script lang="ts">
import type { Component } from "@meekojs/meeko";
const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
</script>
<template><div class="shell"><component is="props.outlet"></component></div></template>`,
  "toggle.meeko": `<template>${iconToggle}<MeekoThemeToggle mode="select" id="picker" bind:themes="['light', 'dark', 'system']" /></template>`,
  // The 404 page of the static adapter: rendered once for /404.html, served for any missing URL.
  "error.meeko": `<script lang="ts">
import { useRoute } from "@meekojs/meeko/framework";
const route = useRoute();
</script>
<template><p id="where">{route.url.value}</p>${iconToggle}<MeekoThemeToggle mode="select" id="picker" /></template>`,
};

async function loadModules(): Promise<{ modules: Record<string, ClientComponent>; cleanup: () => Promise<void> }> {
  const project = await createTempProject("theme-toggle-test");
  const directory = project.root;
  await writeFile(join(directory, "package.json"), '{"private":true,"type":"module"}\n');
  const runtimePath = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  for (const [file, source] of Object.entries(sources)) {
    const code = compile(source, join(directory, file), { theme: true }).code
      .replaceAll(`from "@meekojs/meeko/internal"`, `from ${runtimePath("src/internal.ts")}`)
      .replaceAll(`from "@meekojs/meeko/builtins/theme-toggle"`, `from ${runtimePath("src/builtins/theme-toggle.compiled.ts")}`)
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

const routes: readonly RouteRecord[] = createRouteManifest([{ id: "/", file: "toggle.meeko", layouts: ["app.meeko"] }]);

async function serve(modules: Record<string, ClientComponent>, config: DocumentConfig, nonce?: string) {
  const { createFrameworkHandler } = await runtime();
  return createFrameworkHandler({
    routes, loadPage: async (file) => modules[file]!, clientEntry: "/entry.js", onError: () => {},
    document: { config, ...(nonce ? { nonce: () => nonce } : {}) },
  });
}

const page = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers: { accept: "text/html", ...headers } });

/** The body HTML without the hydration markers. */
const bare = (html: string): string => html.replace(/<!--\/?meeko:[^>]*-->/g, "");

test("SSR paints every icon and the CSS shows the choice: data-theme-choice with the cookie, the default without it", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const server = await serve(modules, { theme: resolved() }, "n1");
    const html = await (await server(page("https://example.test/", { cookie: "meeko-theme=dark" }))).text();
    assert.match(html, /<html data-theme="dark" data-theme-choice="dark">/);
    // The style of <head> carries the nonce of the request, like the theme script.
    assert.ok(html.includes(`<style nonce="n1">${themeStyle(resolved())}</style>`), html);
    const body = bare(html);
    assert.match(body, /<form method="post" action="\/_meeko\/theme" data-meeko-theme-toggle="cycle" class="toggle" data-meeko="\d+">/);
    assert.match(body, /<input type="hidden" name="theme" value="system" data-meeko="\d+"><input type="hidden" name="return" value="\/" data-meeko="\d+">/);
    assert.match(body, /<button type="submit" aria-label="Tema: oscuro\. Cambiar a sistema" data-meeko="\d+">/);
    // Every icon, each in its span: the server never picks one.
    assert.match(body, /<span data-meeko-theme-icon="light" aria-hidden="true" data-meeko="\d+"><i class="sun">sol<\/i><\/span><span data-meeko-theme-icon="dark" aria-hidden="true" data-meeko="\d+"><i class="moon">luna<\/i><\/span><span data-meeko-theme-icon="system" aria-hidden="true" data-meeko="\d+"><i class="monitor">pc<\/i><\/span>/);
    // The radio group: the labels without snippets, the choice checked, no roving tabindex before JavaScript.
    assert.match(body, /<form method="post" action="\/_meeko\/theme" data-meeko-theme-toggle="select" id="picker" data-meeko="\d+"><input type="hidden" name="return" value="\/" data-meeko="\d+"><div role="radiogroup" aria-label="Tema" data-meeko="\d+">/);
    assert.match(body, /<button type="submit" name="theme" value="dark" role="radio" aria-checked="true" data-meeko-theme-option="dark" data-meeko="\d+">Oscuro<\/button>/);
    assert.doesNotMatch(body, /tabindex/);

    // No cookie and no hint: the server does not know the choice, so it says nothing it could get wrong.
    const unknown = bare(await (await server(page("https://example.test/"))).text());
    assert.match(unknown, /<html>/);
    assert.match(unknown, /aria-label="Cambiar tema"/);
    // Not even "false": a radio group with every radio unchecked would say so until hydration ends.
    assert.doesNotMatch(unknown, /aria-checked/);
    assert.match(unknown, /<button type="submit" name="theme" value="dark" role="radio" data-meeko-theme-option="dark" data-meeko="\d+">Oscuro<\/button>/);
    assert.match(unknown, /data-meeko-theme-icon="system"/);
    // Without theme in the configuration the tag fails at run time too, with MEEK111.
    const failures: unknown[] = [];
    const { createFrameworkHandler } = await runtime();
    const off = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]!, onError: (error) => failures.push(error) });
    assert.equal((await off(page("https://example.test/"))).status, 500);
    assert.match(String(failures[0]), /MEEK111: <MeekoThemeToggle> necesita theme/);
  } finally {
    await cleanup();
  }
});

test("the page handler serves POST /_meeko/theme only with theme, and the next document has the new theme", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const server = await serve(modules, { theme: resolved() });
    const response = await server(new Request(`https://example.test${THEME_ENDPOINT}`, {
      method: "POST", body: "theme=light&return=%2F%3Fx%3D1", headers: { origin: "https://example.test", "content-type": "application/x-www-form-urlencoded" },
    }));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/?x=1");
    assert.ok(response.headers.get("x-request-id"));
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    assert.match(await (await server(page("https://example.test/?x=1", { cookie }))).text(), /<html data-theme="light" data-theme-choice="light">/);
    assert.equal((await server(new Request(`https://example.test${THEME_ENDPOINT}`, { method: "POST", body: "theme=dark", headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" } }))).status, 403);
    // Without theme there is no endpoint: a POST is a page request, which only GET and HEAD reach.
    const off = await serve(modules, {});
    assert.equal((await off(new Request(`https://example.test${THEME_ENDPOINT}`, { method: "POST", body: "theme=dark", headers: { origin: "https://example.test", "content-type": "application/x-www-form-urlencoded" } }))).status, 405);
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

async function boot(modules: Record<string, ClientComponent>, options: { cookie?: string; serverCookie?: string; dark?: boolean }) {
  const { mountClientApp } = await runtime();
  const config: DocumentConfig = { theme: resolved() };
  const server = await serve(modules, config);
  const browser = new HappyWindow({ url: "https://example.test/", settings: { device: { prefersColorScheme: options.dark ? "dark" : "light" } } });
  if (options.cookie) browser.document.cookie = options.cookie;
  const serverCookie = options.serverCookie ?? options.cookie;
  browser.document.write(await (await server(page("https://example.test/", serverCookie ? { cookie: serverCookie } : {}))).text());
  const ssr = browser.document.getElementById("app")!.innerHTML;
  const mutations: string[] = [];
  const observer = new browser.MutationObserver((records) => {
    for (const record of records) mutations.push(record.type === "attributes" ? `${(record.target as unknown as Element).localName}@${record.attributeName}` : record.type);
  });
  observer.observe(browser.document.getElementById("app")!, { subtree: true, childList: true, characterData: true, attributes: true });
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes, document: config,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    serverData: true,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
    onError: (error) => { errors.push(error); },
    browser: browser as unknown as Window,
  });
  const hydration = mutations.splice(0);
  opened.push(() => browser.happyDOM.abort(), () => app.dispose(), () => observer.disconnect());
  const document = browser.document;
  const root = document.documentElement;
  const cycle = document.querySelector("[data-meeko-theme-toggle=cycle]")!;
  return { browser, document, root, cycle, ssr, hydration, mutations, errors };
}

/** What hydration may change: attributes that nothing paints (no element, text or icon). */
const invisible = new Set(["button@tabindex", "button@aria-label", "button@aria-checked", "input@value"]);

test("hydration changes nothing visible, and with JavaScript the form changes the theme at once", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    // With the cookie: the server knew everything; only the roving tabindex of the radios arrives.
    const known = await boot(modules, { cookie: "meeko-theme=dark" });
    assert.deepEqual(known.hydration.filter((change) => !invisible.has(change)), []);
    assert.ok(known.hydration.every((change) => change === "button@tabindex"), JSON.stringify(known.hydration));
    assert.deepEqual([...known.document.querySelectorAll("[role=radio]")].map((radio) => radio.getAttribute("tabindex")), ["-1", "0", "-1"]);
    assert.equal(known.root.getAttribute("data-theme-choice"), "dark");
    // The submit is intercepted: no navigation, the theme of the next choice right away.
    (known.cycle.querySelector("button") as unknown as HTMLButtonElement).click();
    assert.equal(known.root.getAttribute("data-theme-choice"), "system");
    assert.equal(known.root.getAttribute("data-theme"), "light");
    assert.match(known.document.cookie, /meeko-theme=system/);
    assert.equal(known.cycle.querySelector("button")!.getAttribute("aria-label"), "Tema: sistema. Cambiar a claro");
    assert.equal(known.cycle.querySelector("input[name=theme]")!.getAttribute("value"), "light");
    assert.equal(known.browser.location.href, "https://example.test/");
    // A radio is a submit button: its value is the choice.
    (known.document.querySelector("[role=radio][value=dark]") as unknown as HTMLButtonElement).click();
    assert.equal(known.root.getAttribute("data-theme-choice"), "dark");
    assert.equal(known.document.querySelector("[role=radio][value=dark]")!.getAttribute("aria-checked"), "true");
    // The arrow keys move the focus and the choice, as in a radio group.
    const dark = known.document.querySelector("[role=radio][value=dark]") as unknown as HTMLButtonElement;
    dark.focus();
    dark.dispatchEvent(new known.browser.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }) as unknown as Event);
    assert.equal(known.root.getAttribute("data-theme-choice"), "system");
    assert.equal(known.document.activeElement?.getAttribute("value"), "system");
    assert.deepEqual([...known.document.querySelectorAll("[role=radio]")].map((radio) => radio.getAttribute("tabindex")), ["-1", "-1", "0"]);
    assert.deepEqual(known.errors, []);
    closeAll();

    // A prerendered page or a request without the cookie: the server rendered the default (system),
    // the browser kept dark. The spans and their icons stay; only unpainted attributes catch up.
    const stored = await boot(modules, { cookie: "meeko-theme=dark", serverCookie: "" });
    assert.deepEqual(stored.hydration.filter((change) => !invisible.has(change)), []);
    // The server did not know the choice: no radio said checked or not checked, and each radio
    // gets its aria-checked once, when hydration ends.
    assert.doesNotMatch(stored.ssr, /aria-checked/);
    assert.equal(stored.hydration.filter((change) => change === "button@aria-checked").length, 3, JSON.stringify(stored.hydration));
    assert.equal(stored.cycle.querySelector("button")!.getAttribute("aria-label"), "Tema: oscuro. Cambiar a sistema");
    assert.equal(stored.document.querySelector("[role=radio][value=dark]")!.getAttribute("aria-checked"), "true");
    assert.equal(stored.root.getAttribute("data-theme-choice"), "dark");
    assert.deepEqual(stored.errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("a page rendered for one URL hydrates under another: the static 404.html at any URL and a prerendered page with a query", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const { createFrameworkHandler, mountClientApp } = await runtime();
    const config: DocumentConfig = { theme: resolved() };
    const errorPage: ErrorPageRecord = { file: "error.meeko", layouts: ["app.meeko"] };
    const server = createFrameworkHandler({ routes, errorPage, loadPage: async (file) => modules[file]!, clientEntry: "/entry.js", onError: () => {}, document: { config } });
    /** The document that the server rendered for `rendered`, hydrated in a browser at `visited`. */
    const visit = async (rendered: string, visited: string) => {
      const response = await server(page(rendered));
      const browser = new HappyWindow({ url: visited });
      browser.document.write(await response.text());
      opened.push(() => browser.happyDOM.abort());
      const errors: unknown[] = [];
      const app = await mountClientApp({
        routes, errorPage, document: config, root: browser.document.getElementById("app") as unknown as Element,
        payload: browser.document.getElementById("meeko-payload")!.textContent!, loadPage: async (file) => modules[file]!, serverData: true,
        fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
        onError: (error) => { errors.push(error); }, browser: browser as unknown as Window,
      });
      opened.push(() => app.dispose());
      const returns = [...browser.document.querySelectorAll("input[name=return]")].map((input) => input.getAttribute("value"));
      return { status: response.status, browser, document: browser.document, returns, errors };
    };

    // The static adapter renders app/error.meeko for /404.html; the host serves it for any missing
    // file. Hydration starts from the URL the server rendered and then takes the browser's.
    const missing = await visit("https://example.test/404.html", "https://example.test/cualquier-cosa?x=1#top");
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.errors, []);
    assert.equal(missing.document.getElementById("where")!.textContent, "/cualquier-cosa?x=1#top");
    // Without JavaScript the theme form would return to the page the visitor is on.
    assert.deepEqual(missing.returns, ["/cualquier-cosa?x=1#top", "/cualquier-cosa?x=1#top"]);
    closeAll();

    // A static host ignores the query string: the prerendered page of / answers /?utm=mail.
    const query = await visit("https://example.test/", "https://example.test/?utm=mail");
    assert.equal(query.status, 200);
    assert.deepEqual(query.errors, []);
    assert.deepEqual(query.returns, ["/?utm=mail", "/?utm=mail"]);
    // The URL of the payload is a path of this origin, without a fragment.
    const payload = JSON.parse(query.document.getElementById("meeko-payload")!.textContent!) as Record<string, unknown>;
    assert.equal(payload.url, "/");
    for (const url of ["https://evil.example/", "evil", "/#x", 7]) {
      await assert.rejects(mountClientApp({
        routes, root: query.document.getElementById("app") as unknown as Element, payload: { ...payload, url },
        loadPage: async (file) => modules[file]!, browser: query.browser as unknown as Window,
      }), /Invalid Meeko payload URL/, JSON.stringify(url));
    }
  } finally {
    closeAll();
    await cleanup();
  }
});

test("a cookie that the server wrote without JavaScript reaches localStorage on the next load", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const { mountClientApp } = await runtime();
    const config: DocumentConfig = { theme: resolved() };
    const server = await serve(modules, config);
    const browser = new HappyWindow({ url: "https://example.test/" });
    browser.localStorage.setItem("meeko-theme", "light");
    browser.document.cookie = "meeko-theme=dark";
    browser.document.write(await (await server(page("https://example.test/", { cookie: "meeko-theme=dark" }))).text());
    const app = await mountClientApp({
      routes, document: config, root: browser.document.getElementById("app") as unknown as Element,
      payload: browser.document.getElementById("meeko-payload")!.textContent!, loadPage: async (file) => modules[file]!, serverData: true,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch, browser: browser as unknown as Window,
    });
    opened.push(() => browser.happyDOM.abort(), () => app.dispose());
    assert.equal(browser.localStorage.getItem("meeko-theme"), "dark");
  } finally {
    closeAll();
    await cleanup();
  }
});

const typedPage = (template: string) => `<template>${template}</template>\n`;

test("meeko check types the snippets, mode, themes and labels of <MeekoThemeToggle> with meeko.config.ts", { timeout: 180_000 }, async () => {
  const project = await createTempProject("theme-toggle-check");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await writeFile(join(root, "meeko.config.mjs"), 'export default { theme: { themes: ["light", "dark", "sepia"] } };\n');
    await mkdir(join(root, "app", "pages"), { recursive: true });
    const file = join(root, "app", "pages", "index.meeko");
    const check = async (template: string) => {
      await writeFile(file, typedPage(template));
      return (await checkApp(root)).map((item) => `${item.code}: ${item.message}`);
    };
    await prepareFrameworkTypeDeclarations(root);
    assert.deepEqual(await check(`<MeekoThemeToggle mode="select" bind:themes="['sepia', 'system']" bind:labels="{ sepia: 'Sepia' }" class="t"><snippet name="sepia">S</snippet><snippet name="system">PC</snippet></MeekoThemeToggle>`), []);
    const wrong: Array<[string, RegExp]> = [
      ['<MeekoThemeToggle><snippet name="purple">P</snippet></MeekoThemeToggle>', /purple/],
      ['<MeekoThemeToggle mode="menu" />', /"menu"/],
      [`<MeekoThemeToggle bind:themes="['purple']" />`, /purple/],
      [`<MeekoThemeToggle bind:labels="{ purple: 'P' }" />`, /purple/],
      ["<MeekoThemeToggle>loose content</MeekoThemeToggle>", /default/],
    ];
    for (const [template, message] of wrong) {
      const diagnostics = await check(template);
      assert.ok(diagnostics.some((item) => message.test(item)), `${template}: ${JSON.stringify(diagnostics)}`);
    }
    // "system" is a choice only with system on.
    await writeFile(join(root, "meeko.config.mjs"), 'export default { theme: { themes: ["paper", "ink"], system: false } };\n');
    await prepareFrameworkTypeDeclarations(root);
    assert.ok((await check('<MeekoThemeToggle><snippet name="system">PC</snippet></MeekoThemeToggle>')).some((item) => /system/.test(item)));
    assert.deepEqual(await check('<MeekoThemeToggle><snippet name="ink">I</snippet></MeekoThemeToggle>'), []);
    // Without theme, the tag is MEEK111.
    await writeFile(join(root, "meeko.config.mjs"), "export default {};\n");
    assert.ok((await check("<MeekoThemeToggle />")).some((item) => item.startsWith("MEEK111:")));
  } finally {
    await project.remove();
  }
});

test("the editor completes <MeekoThemeToggle>, its props and its snippets, and explains it on hover", { timeout: 60_000 }, async () => {
  const text = `<script lang="ts"></script>\n<template><MeekoThemeToggle m><snippet name="d"></snippet></MeekoThemeToggle></template>`;
  const workspace = await languageProject("lsp-theme-toggle-", {
    "meeko.config.ts": "export default { theme: true };\n",
    "theme.d.ts": 'import "@meekojs/meeko/framework";\ndeclare module "@meekojs/meeko/framework" {\n  interface GeneratedTheme { readonly themes: "light" | "dark"; readonly choices: "light" | "dark" | "system" }\n}\n',
    "app/pages/index.meeko": text,
  });
  try {
    const opened = await workspace.open("app/pages/index.meeko");
    // `<Meek` while it is typed: the tag is offered with MeekoLink.
    const typing = TextDocument.create(opened.document.uri, "meeko", 2, `<script lang="ts"></script>\n<template><Meek</template>`);
    const typed = typing.positionAt(typing.getText().indexOf("<Meek") + 5);
    const names = componentNameCompletion(workspace.project, typing, opened.component.filename, typed)!.map((item) => item.label);
    assert.ok(names.includes("MeekoThemeToggle") && names.includes("MeekoLink"), JSON.stringify(names));
    const items = directiveNameCompletion(opened.document, opened.at("MeekoThemeToggle m", 18))!;
    const attributes = items.map((item) => item.label);
    // `mode` offers its two values.
    assert.equal((items.find((item) => item.label === "mode")?.textEdit as { newText?: string } | undefined)?.newText, 'mode="${1|cycle,select|}"');
    assert.deepEqual(attributes.slice(0, 6), ["mode", "bind:themes", "bind:labels", "bind:messages", "class", "id"]);
    assert.ok(attributes.includes("model:") && !attributes.includes("href"), JSON.stringify(attributes));
    assert.equal(directiveNameCompletion(opened.document, opened.at("MeekoThemeToggle m", 18), new Set(["MeekoThemeToggle"]))!.some((item) => item.label === "mode"), false, "a project component has its own props");
    const snippets = (completion(opened, opened.at('name="d"', 6)) ?? []).map((item: CompletionItem) => item.label);
    assert.deepEqual(snippets.sort(), ["dark", "light", "system"]);
    // The hover is the card of the built-in tags: its props with the types of MeekoThemeToggleProps
    // and one snippet per choice of the application.
    const docs = (hover(opened, opened.at("MeekoThemeToggle", 3))?.contents as MarkupContent | undefined)?.value ?? "";
    assert.match(docs, /^```ts\n<MeekoThemeToggle\n {2}mode\?: "cycle" \| "select"\n {2}bind:themes\?: readonly \("light" \| "dark" \| "system"\)\[\]\n/);
    assert.match(docs, /\n {2}light\?\(\)\n {2}dark\?\(\)\n {2}system\?\(\)\n<\/MeekoThemeToggle>\n```/);
    assert.match(docs, /Etiqueta de Meeko · componente · props: \[`MeekoThemeToggleProps`\]/);
    assert.match(docs, /data-theme-choice/);
    assert.match(docs, /\[Guía de `<MeekoThemeToggle>`\]\([^)]+#meekothemetoggle\)/);
    const [target] = definition(opened, opened.at("MeekoThemeToggle", 3)) ?? [];
    assert.ok(target, "go to definition opens MeekoThemeToggleProps");
    const declaration = await readFile(new URL(target.uri), "utf8");
    assert.equal(TextDocument.create(target.uri, "typescript", 0, declaration).getText(target.range), "MeekoThemeToggleProps");
    // Without theme the tag is not offered.
    await writeFile(workspace.file("meeko.config.ts"), "export default { theme: false };\n");
    const off = componentNameCompletion(workspace.project, typing, opened.component.filename, typed)!.map((item) => item.label);
    assert.ok(!off.includes("MeekoThemeToggle"), JSON.stringify(off));
  } finally {
    await workspace.dispose();
  }
});

test("the editor types <MeekoThemeToggle> with the themes of meeko.config.ts before meeko check generates them", { timeout: 60_000 }, async () => {
  // As in a project of `meeko init`, the tsconfig does not include .meeko/types/routes.d.ts, which
  // does not exist before the first meeko check or meeko dev.
  const page = '<script lang="ts">\nconst theme = useTheme();\n</script>\n<template><MeekoThemeToggle><snippet name="s"></snippet></MeekoThemeToggle></template>';
  const workspace = await languageProject("lsp-theme-config-", {
    "meeko.config.ts": 'export default defineMeekoConfig({ theme: { themes: ["light", "dark", "sepia"] } });\n',
    "app/pages/index.meeko": page,
  });
  try {
    const opened = await workspace.open("app/pages/index.meeko");
    const docs = (hover(opened, opened.at("MeekoThemeToggle", 3))?.contents as MarkupContent | undefined)?.value ?? "";
    assert.match(docs, /\n {2}bind:themes\?: readonly \("light" \| "dark" \| "sepia" \| "system"\)\[\]\n {2}bind:labels\?: Partial<Record<"light" \| "dark" \| "sepia" \| "system", string>>\n/, docs);
    assert.match(docs, /\n {2}sepia\?\(\)\n {2}system\?\(\)\n<\/MeekoThemeToggle>/);
    const names = (completion(opened, opened.at('name="s"', 6)) ?? []).map((item: CompletionItem) => item.label);
    assert.deepEqual(names.sort(), ["dark", "light", "sepia", "system"]);
    // An unknown snippet or theme is a type error of the editor's program too, as in meeko check.
    const diagnose = async (template: string) => {
      const changed = await workspace.open("app/pages/index.meeko", page.replace(/<template>.*<\/template>/, `<template>${template}</template>`));
      return workspace.project.service.getSemanticDiagnostics(changed.component.virtualFilename).map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
    };
    assert.ok((await diagnose('<MeekoThemeToggle><snippet name="purple">P</snippet></MeekoThemeToggle>')).some((message) => /'purple' does not exist/.test(message)));
    assert.ok((await diagnose(`<MeekoThemeToggle bind:themes="['purple']" />`)).some((message) => /purple/.test(message)));
    assert.deepEqual(await diagnose(`<MeekoThemeToggle bind:themes="['sepia', 'system']"><snippet name="sepia">S</snippet></MeekoThemeToggle>`), []);

    // A change of meeko.config.ts reaches the editor; a theme that only running it tells stays string.
    await writeFile(workspace.file("meeko.config.ts"), "export default { theme: true };\n");
    workspace.project.filesChanged([workspace.file("meeko.config.ts")]);
    const reopened = await workspace.open("app/pages/index.meeko", page);
    assert.match((hover(reopened, reopened.at("MeekoThemeToggle", 3))?.contents as MarkupContent).value, /bind:themes\?: readonly \("light" \| "dark" \| "system"\)\[\]/);
    await writeFile(workspace.file("meeko.config.ts"), "const theme = true;\nexport default { theme };\n");
    workspace.project.filesChanged([workspace.file("meeko.config.ts")]);
    const dynamic = await workspace.open("app/pages/index.meeko", page);
    assert.match((hover(dynamic, dynamic.at("MeekoThemeToggle", 3))?.contents as MarkupContent).value, /bind:themes\?: readonly string\[\]/);
    // Its snippets are then the choices of theme: true, as its hover lists them.
    assert.deepEqual((completion(dynamic, dynamic.at('name="s"', 6)) ?? []).map((item: CompletionItem) => item.label), ["light", "dark", "system"]);
  } finally {
    await workspace.dispose();
  }
});

test("readThemeOptionSync reads a literal theme of meeko.config.* without running it", async () => {
  const project = await createTempProject("theme-option");
  try {
    const cases: Array<[string, unknown]> = [
      ["export default { theme: true };\n", true],
      ['export default defineMeekoConfig({ theme: { themes: ["paper", "ink"], system: false, default: "ink" } as const });\n', { themes: ["paper", "ink"], system: false, default: "ink" }],
      ["export default { theme: false };\n", false],
      ['export default { site: "https://example.com" };\n', undefined],
      ['const themes = ["a"];\nexport default { theme: { themes } };\n', undefined],
      ['export default { theme: { themes: [...base, "b"] } };\n', undefined],
    ];
    for (const [config, expected] of cases) {
      await writeFile(join(project.root, "meeko.config.ts"), config);
      assert.deepEqual(readThemeOptionSync(project.root), expected, config);
    }
  } finally {
    await project.remove();
  }
});

test("the static adapter allows the theme style by its hash in a CSP without 'unsafe-inline'", { timeout: 180_000 }, async (context) => {
  const root = await tempProject(context, "theme-toggle-static");
  const strict = staticAppConfig.replace("sitemap: true,", "sitemap: true,\n  theme: true,").replace(`"style-src": ["'self'", "'unsafe-inline'"]`, `"style-src": ["'self'"]`);
  assert.notEqual(strict, staticAppConfig);
  await writeStaticApp(root, strict);
  await writeFile(join(root, "app", "pages", "index.meeko"), `<template><p id="home">Inicio</p>${iconToggle}</template>\n`);
  const result = await buildProject(root);
  const html = await readFile(join(result.output, "index.html"), "utf8");
  const style = themeStyle(resolved());
  assert.ok(html.includes(`<style>${style}</style>`), html);
  // A prerendered page is the same for everyone: no data-theme-choice, the script writes it.
  assert.match(html, /^<!doctype html><html lang="es"><head>/);
  const headers = await readFile(join(result.output, "_headers"), "utf8");
  assert.match(headers, new RegExp(`style-src 'self'[^\\n]*${sha256(style).replace(/[+/]/g, "\\$&")}`));
  const index = JSON.parse(await readFile(join(root, ".meeko", "build", "prerender", "manifest.json"), "utf8")) as { pages: Record<string, { styleHashes?: string[] }> };
  assert.ok(index.pages["/"]?.styleHashes?.includes(sha256(style)), JSON.stringify(index.pages["/"]));
});
