import assert from "node:assert/strict";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import { directiveNameCompletion } from "../src/language-server/features.ts";
import { linkRouteCompletion } from "../src/language-server/nav.ts";
import { linkCurrent } from "../src/link.ts";
import type { RouteRecord } from "../src/framework/router.ts";

const layout = "/project/app/layouts/default.meeko";

/** The MEEK code of a compile error, or `undefined` when the source compiles. */
function errorCode(source: string, filename: string): string | undefined {
  try { compile(source, filename); return undefined; }
  catch (error) {
    if (error instanceof MeekoCompileError) return error.diagnostic.code;
    throw error;
  }
}

test("<MeekoOutlet /> renders the outlet that Meeko passes, without declared props", () => {
  const { code } = compile("<template><main><MeekoOutlet /></main></template>", layout);
  assert.match(code, /const __meeko_outlet_props = __props as unknown as \{ readonly outlet:/);
  assert.match(code, /__meeko\.renderComponent<any>\(0, __meeko_outlet_props\.outlet/);
  // The prefetch marks leave the outlet out, as for <component is="props.outlet">.
  assert.match(code, /__meekoChildren[^\n]*= \(\) => \[\]/);
  for (const host of ["/project/app/app.meeko", "/project/app/pages/admin/+layout.meeko", "C:\\project\\app\\layouts\\admin\\shell.meeko"]) {
    assert.equal(errorCode("<template><MeekoOutlet /></template>", host), undefined, host);
  }
  assert.equal(errorCode("<template><MeekoOutlet /></template>", "/project/app/components/Card.meeko"), "MEEK104");
  assert.equal(errorCode("<template><MeekoOutlet class=\"x\" /></template>", layout), "MEEK104");
});

test("<MeekoLink> is an <a> with a typed href, aria-current and every other attribute", () => {
  const source = `<script lang="ts">\nconst id = signal("7");\n</script>\n<template><MeekoLink to="/users/[id]" bind:params="{ id: id.value }" bind:search="{ tab: 'perfil' }" class="nav" data-kind="user" on:click="() => id.value = '8'">Perfil</MeekoLink></template>`;
  const { code } = compile(source, "/project/app/components/Nav.meeko");
  assert.match(code, /import \{ href as __meeko_href_overloads, useRoute as __meeko_useRoute \} from "@meekojs\/meeko\/framework"/);
  assert.match(code, /const __meeko_route = __meeko_useRoute\(\);/);
  assert.match(code, /__meeko_href\("\/users\/\[id\]", \{ params: \{ id: id\.value \}, search: \{ tab: 'perfil' \} \}\)/);
  assert.match(code, /__meeko\.linkCurrent\(__meeko_route, /);
  assert.match(code, /"<a"/);
  assert.match(code, /class=\\"nav\\"/);
  assert.match(code, /data-kind=\\"user\\"/);
  assert.match(code, /bindEvent/);
  assert.doesNotMatch(code, /renderComponent|bindComponent/, "an element, not a component");
  assert.equal(errorCode("<template><MeekoLink to=\"/\" href=\"/x\">x</MeekoLink></template>", layout), "MEEK105");
  assert.equal(errorCode("<template><MeekoLink to=\"/\" params=\"x\">x</MeekoLink></template>", layout), "MEEK105");
  assert.equal(errorCode("<template><MeekoLink>x</MeekoLink></template>", layout), "MEEK105");
});

test("a static <MeekoLink> keeps its href in the HTML and binds only aria-current", () => {
  const { code } = compile("<template><MeekoLink to=\"/docs\">Docs</MeekoLink></template>", layout);
  assert.match(code, / href=\\"\/docs\\"/);
  assert.match(code, /__meeko\.linkCurrent\(__meeko_route, /);
  assert.doesNotMatch(code, /bindAttribute\(__scope, \d+, "href"/, "a fixed href needs no binding");
  // A route with parameters still goes through the typed href().
  const dynamic = compile("<template><MeekoLink to=\"/users/[id]\" bind:params=\"{ id: '7' }\">x</MeekoLink></template>", layout).code;
  assert.match(dynamic, /bindAttribute\(__scope, 0, "href"/);
});

test("an element with several bindings carries a single data-meeko marker", () => {
  const source = `<script lang="ts">\nconst title = signal("a");\nconst box = useElementRef<HTMLElement>("box");\n</script>\n<template><p ref:box bind:title="title.value" on:click="() => title.value = 'b'">x</p><span bind:title="title.value">y</span></template>`;
  const { code } = compile(source, "/project/app/components/Marked.meeko");
  assert.match(code, /data-meeko=\\"0\\"/);
  assert.match(code, /data-meeko=\\"1\\"/);
  assert.doesNotMatch(code, /data-meeko-[aemr]-/);
  assert.match(code, /bindAttribute\(__scope, 0, "title"/);
  assert.match(code, /bindEvent\(__scope, 0, "click"/);
  assert.match(code, /bindAttribute\(__scope, 1, "title"/);
});

test("aria-current compares the path of the link, without its query or fragment", () => {
  const route = { path: { value: "/users/7" } };
  assert.equal(linkCurrent(route, "/users/7?tab=perfil#bio"), "page");
  assert.equal(linkCurrent(route, "/users/8"), undefined);
});

test("a static <MeekoLink> with a non-ASCII path is encoded like href() and matches the route's path", () => {
  const { code } = compile("<template><MeekoLink to=\"/categorías/menú\">Categorías</MeekoLink></template>", layout);
  assert.match(code, / href=\\"\/categor%C3%ADas\/men%C3%BA\\"/, "the HTML href is the encoded path");
  assert.match(code, /__meeko\.linkCurrent\(__meeko_route, "\/categor%C3%ADas\/men%C3%BA"\)/);
  // useRoute().path is url.pathname: always encoded.
  const route = { path: { value: new URL("https://x.test/categorías/menú").pathname } };
  assert.equal(route.path.value, "/categor%C3%ADas/men%C3%BA");
  assert.equal(linkCurrent(route, "/categor%C3%ADas/men%C3%BA"), "page");
  assert.equal(linkCurrent(route, "/categorías/menú"), "page", "a raw href is the same route");
  assert.equal(linkCurrent({ path: { value: "/a%40b" } }, "/a@b"), "page", "characters that URL keeps but href() encodes");
  assert.equal(linkCurrent({ path: { value: "/categor%C3%ADas" } }, "/categorias"), undefined);
  assert.equal(linkCurrent({ path: { value: "/bad%E0%A4" } }, "/bad%E0%A4"), "page", "a malformed escape compares as written");
});

test("the editor completes the attributes of <MeekoLink> and the routes of to=\"\"", () => {
  const text = `<script lang="ts"></script>\n<template><MeekoLink c></MeekoLink><MeekoLink to=""></MeekoLink></template>`;
  const document = TextDocument.create("file:///Nav.meeko", "meeko", 1, text);
  const attributes = directiveNameCompletion(document, document.positionAt(text.indexOf("MeekoLink c") + 11))!.map((item) => item.label);
  assert.deepEqual(attributes.slice(0, 3), ["to", "bind:params", "bind:search"]);
  assert.ok(attributes.includes("on:") && attributes.includes("if:when") && attributes.includes("class"), JSON.stringify(attributes));
  assert.ok(!attributes.includes("href") && !attributes.includes("model:"), "the href is built; MeekoLink is not a component");
  const routes: RouteRecord[] = [
    { id: "/", file: "/project/app/pages/index.meeko", layouts: [] },
    { id: "/users/[id]", file: "/project/app/pages/users/[id].meeko", layouts: [] },
  ];
  const items = linkRouteCompletion(document, document.positionAt(text.indexOf('to=""') + 4), { routes, api: [], rpc: [] }, "/project")!;
  assert.deepEqual(items.map((item) => [item.label, item.detail]), [["/", "app/pages/index.meeko"], ["/users/[id]", "app/pages/users/[id].meeko"]]);
  assert.equal(linkRouteCompletion(document, document.positionAt(text.indexOf("MeekoLink c") + 11), { routes, api: [], rpc: [] }, "/project"), undefined);
});
