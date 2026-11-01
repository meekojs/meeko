import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import type { RouteState } from "../src/app/runtime/navigation.ts";

import { definePlugin, runPlugins } from "../src/app/definitions/define-plugin.ts";
import { fixedRoute, routeSnapshot } from "../src/app/runtime/navigation.ts";
import { activateRouteManifest, createRouteManifest } from "../src/app/runtime/router.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/parser/sfc.ts";
import { createRoot } from "../src/core/reactivity.ts";
import { linkHref, linkHreflang, linkResolver } from "../src/shared/link.ts";

const layout = "/project/app/layouts/default.meeko";

interface RuntimeModule {
  renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> };
  hydrate(root: Element, props: Record<string, unknown>, state?: Record<string, unknown>): () => void;
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

/** Compiles components inside the repository; the runtime is imported by file URL, as one instance. */
async function load(components: Record<string, string>, entry: string): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "link-resolver-test-"));
  for (const [name, source] of Object.entries(components)) {
    let code = compile(source, join(directory, `${name}.meeko`)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko/framework"`, `from ${runtime("src/framework.ts")}`)
      .replace(`from "@meekojs/meeko/navigation"`, `from ${runtime("src/app/runtime/navigation.ts")}`)
      .replace(`from "@meekojs/meeko/builtins/link"`, `from ${runtime("src/builtins/link.compiled.ts")}`)
      .replace(`from "#link"`, `from ${runtime("src/shared/link.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
    for (const other of Object.keys(components)) code = code.replace(`from "./${other}.meeko"`, `from "./${other}.ts"`);
    await writeFile(join(directory, `${name}.ts`), code);
  }
  const component = await import(pathToFileURL(join(directory, `${entry}.ts`)).href) as RuntimeModule;
  return { component, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function errorCode(source: string): string | undefined {
  try { compile(source, layout); return undefined; }
  catch (error) {
    if (error instanceof MeekoCompileError) return error.diagnostic.code;
    throw error;
  }
}

test("<MeekoLink> passes its route, hreflang and bind:resolve to the application's link resolver", () => {
  const fixed = compile("<template><MeekoLink to=\"/docs\" hreflang=\"en\">Docs</MeekoLink></template>", layout).code;
  assert.match(fixed, /const __meeko_links = __meeko\.linkResolver\(\);/);
  assert.match(fixed, /renderAttribute\("href", __meeko\.linkHref\(__meeko_links, "\/docs", "\/docs", "en"\)\)/);
  assert.match(fixed, /hreflang=\\"en\\"/, "hreflang stays an attribute of the <a>");
  assert.doesNotMatch(fixed, /bindAttribute\(__scope, \d+, "href"/, "a static route with a fixed hreflang needs no binding");
  assert.match(fixed, /__meeko\.linkCurrent\(__meeko_route, __meeko\.linkHref\(__meeko_links, "\/docs", "\/docs", "en"\)\)/, "aria-current compares the resolved href");
  const bound = compile("<script lang=\"ts\">\nconst lang = signal(\"es\");\n</script>\n<template><MeekoLink to=\"/docs\" bind:hreflang=\"lang.value\" bind:resolve=\"lang.value !== 'es'\">Docs</MeekoLink></template>", layout).code;
  assert.match(bound, /bindAttribute\(__scope, 0, "href", \(\) => \(__meeko\.linkHref\(__meeko_links, "\/docs", "\/docs", \(lang\.value\), lang\.value !== 'es'\)\)/);
  assert.doesNotMatch(bound, /resolve=/, "resolve is not an attribute of the <a>");
  const spread = compile("<script lang=\"ts\">\nconst attrs = { hreflang: \"en\" };\n</script>\n<template><MeekoLink to=\"/docs\" bind=\"attrs\">Docs</MeekoLink></template>", layout).code;
  assert.match(spread, /__meeko\.linkHref\(__meeko_links, "\/docs", "\/docs", __meeko\.linkHreflang\(attrs\)\)/);
  assert.match(spread, /bindAttribute\(__scope, 0, "href"/, "a spread can change the hreflang");
  // The type check reads only bind:resolve, at its own offset.
  const checked = compile("<template><MeekoLink to=\"/docs\" bind:resolve=\"false\">Docs</MeekoLink></template>", layout, { typeCheck: true }).code;
  assert.match(checked, /__meeko\.linkHref\(__meeko_links, "", __meeko_href\("\/docs", \{  \}\), undefined, false\)/);
  assert.equal(errorCode("<template><MeekoLink to=\"/docs\" resolve=\"false\">x</MeekoLink></template>"), "MEEK105");
  // `<component is>` with 'MeekoLink' gives bind:resolve to the link branch only.
  const branch = compile("<script lang=\"ts\">\nconst to = signal<string | undefined>(\"/docs\");\n</script>\n<template><component is=\"to.value ? 'MeekoLink' : 'a'\" bind:to=\"to.value\" bind:resolve=\"false\">x</component></template>", layout).code;
  assert.match(branch, /__meeko\.linkHref\(__meeko_links, \(to\.value\), [^\n]*, undefined, false\)/);
});

test("linkHref keeps the href without a resolver or with resolve false, and passes a non-empty hreflang", () => {
  const seen: unknown[] = [];
  const resolver = (link: { to: string; href: string; hreflang: string | undefined }): string => { seen.push(link); return `/en${link.href}`; };
  assert.equal(linkHref(undefined, "/docs", "/docs", "en"), "/docs");
  assert.equal(linkHref(resolver, "/docs", "/docs", "en", false), "/docs");
  assert.equal(linkHref(resolver, "/docs", "/docs?q=1#a", ""), "/en/docs?q=1#a");
  assert.equal(linkHref(resolver, "/users/[id]", "/users/7", "es", true), "/en/users/7");
  assert.deepEqual(seen, [{ to: "/docs", href: "/docs?q=1#a", hreflang: undefined }, { to: "/users/[id]", href: "/users/7", hreflang: "es" }]);
  assert.equal(linkHreflang({ hreflang: "en" }), "en");
  assert.equal(linkHreflang({ hreflang: "" }), undefined);
  assert.equal(linkHreflang(undefined), undefined);
  assert.equal(linkHreflang({ hreflang: 3 }), undefined);
});

test("app.resolveLink publishes one resolver that chains the plugins' resolvers in order", async () => {
  const route = fixedRoute(routeSnapshot(new URL("https://meeko.test/"), "/", {}, {}, false)) as RouteState;
  const state = await runPlugins([
    { plugin: definePlugin((app) => app.resolveLink(({ href, hreflang }) => `/${hreflang ?? "en"}${href}`)) },
    { plugin: definePlugin((app) => app.resolveLink(({ href }) => `/docs${href}`)) },
  ], { side: "server", route });
  const resolved = createRoot(() => {
    state.apply();
    return linkResolver()?.({ to: "/guide", href: "/guide", hreflang: "fr" });
  });
  assert.equal(resolved, "/docs/fr/guide");
  assert.equal(createRoot(() => linkResolver()), undefined, "no resolver outside an application");
  const none = await runPlugins([{ plugin: definePlugin(() => {}) }], { side: "server", route });
  assert.equal(createRoot(() => { none.apply(); return linkResolver(); }), undefined, "no resolver when no plugin registers one");
  await assert.rejects(runPlugins([{ plugin: definePlugin((app) => app.resolveLink("x" as never)), name: "app/plugins/bad.ts" }], { side: "server", route }), /app\/plugins\/bad\.ts: resolveLink requires a function/);
});

/** A page at `/en/docs` that publishes a resolver, as a plugin does, around the links of `Nav`. */
const page = `<script lang="ts">
import { provide } from "@meekojs/meeko";
import { fixedRoute, provideRoute, routeSnapshot } from "@meekojs/meeko/navigation";
import { linkResolverKey } from "#link";
import * as Nav from "./Nav.meeko";
provideRoute(fixedRoute(routeSnapshot(new URL("https://meeko.test/en/docs"), "/en/docs", {}, {}, false)));
provide(linkResolverKey, ({ href, hreflang }) => \`/\${hreflang ?? "en"}\${href}\`);
</script>
<template><main><Nav /></main></template>`;

const nav = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as MeekoLinkComponent from "@meekojs/meeko/builtins/link";
const attrs = { hreflang: "fr" };
const lang = signal<string | undefined>(undefined);
</script>
<template><nav>
<MeekoLink to="/docs" class="current">Docs</MeekoLink>
<MeekoLink to="/docs" hreflang="es" class="forced">Docs ES</MeekoLink>
<MeekoLink to="/docs" bind:resolve="false" class="raw">Raw</MeekoLink>
<MeekoLink to="/docs" bind="attrs" class="spread">Spread</MeekoLink>
<MeekoLink to="/users/[id]" bind:params="{ id: '7' }" class="params">User</MeekoLink>
<MeekoLink to="/docs" bind:hreflang="lang.value" class="bound">Bound</MeekoLink>
<component is="MeekoLinkComponent" to="/docs" hreflang="es" class="component">Component</component>
<component is="true ? 'MeekoLink' : 'a'" to="/docs" bind:resolve="false" class="branch">Branch</component>
<i class="switch" on:click="() => lang.value = 'es'"></i>
</nav></template>`;

const routes = createRouteManifest([
  { id: "/docs", file: "docs.meeko", layouts: [] },
  { id: "/users/[id]", file: "user.meeko", layouts: [] },
]);

test("resolved links render, hydrate and update with the resolver's href and aria-current", async () => {
  const { component, cleanup } = await load({ Page: page, Nav: nav }, "Page");
  const window = new Window({ url: "https://meeko.test/en/docs" });
  const manifest = activateRouteManifest(routes);
  try {
    const rendered = component.renderWithState({});
    const root = window.document.createElement("div");
    window.document.body.appendChild(root);
    root.innerHTML = rendered.html;
    const link = (name: string) => root.querySelector(`.${name}`)!;
    const expect = (name: string, href: string, current: string | null, hreflang: string | null = null): void => {
      assert.equal(link(name).getAttribute("href"), href, name);
      assert.equal(link(name).getAttribute("aria-current"), current, `${name} aria-current`);
      assert.equal(link(name).getAttribute("hreflang"), hreflang, `${name} hreflang`);
    };
    const all = (): void => {
      expect("current", "/en/docs", "page");
      expect("forced", "/es/docs", null, "es");
      expect("raw", "/docs", null);
      expect("spread", "/fr/docs", null, "fr");
      expect("params", "/en/users/7", null);
      expect("component", "/es/docs", null, "es");
      expect("branch", "/docs", null);
    };
    all();
    expect("bound", "/en/docs", "page");
    const anchors = [...root.querySelectorAll("a")];
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    // Hydration keeps the server's <a> and their hrefs: both sides resolve the same way.
    assert.deepEqual([...root.querySelectorAll("a")], anchors);
    all();
    (link("switch") as unknown as HTMLElement).click();
    expect("bound", "/es/docs", null, "es");
    release();
  } finally {
    manifest();
    await window.happyDOM.close();
    await cleanup();
  }
});
