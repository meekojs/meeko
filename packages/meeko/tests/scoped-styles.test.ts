import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { createServer } from "vite";
import { compile } from "../src/compiler.ts";
import { loadMeekoConfig } from "../src/framework/config.ts";
import { meeko } from "../src/vite.ts";
import { createTempProject } from "./helpers/temp-project.ts";

// `<style scoped>` puts its attribute on every element of the template, or, with
// `scopeAttribute: "matched"` (`css.scopeAttribute` of meeko.config.ts), only on the elements
// that a scoped compound may match.
const matched = { scopeAttribute: "matched" } as const;

interface RuntimeModule {
  renderToString(props: Record<string, never>): string;
  hydrate(root: Element, props: Record<string, never>): () => void;
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

async function load(directory: string, name: string, source: string): Promise<{ module: RuntimeModule; css: string }> {
  const result = compile(source, join(directory, `${name}.meeko`), matched);
  const code = result.code
    .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
    .replaceAll(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
  await writeFile(join(directory, `${name}.ts`), code);
  return { module: await import(pathToFileURL(join(directory, `${name}.ts`)).href) as RuntimeModule, css: result.css };
}

/** The `k` of each element whose compiled opening tag carries the scope attribute, in template order. */
function scopedKeys(source: string, options: Parameters<typeof compile>[2] = matched): string[] {
  const { code } = compile(source, "Scoped.meeko", options);
  const lines = code.split("\n").filter((line) => line.includes("const __meeko_html"));
  assert.equal(lines.length, 1);
  const tags = [...lines[0]!.matchAll(/"<([a-zA-Z][\w-]*)"((?:(?!"<[a-zA-Z/]).)*?)">"/g)];
  return tags.filter((tag) => /data-meeko-s-[0-9a-f]{8}/.test(tag[2]!)).map((tag) => /\bk=\\"([^\\]*)\\"/.exec(tag[2]!)?.[1] ?? tag[1]!);
}

const keysOf = (template: string): string[] => [...template.matchAll(/\bk="([^"]*)"/g)].map((match) => match[1]!);

const template = `<section k="root" class="card">
  <h2 k="title" class="title">t</h2>
  <p k="text">x</p>
  <p k="lead" class="lead Note">x</p>
  <a k="link" href="/x" id="home">x</a>
  <input k="field" type="text" />
  <ul k="list"><li k="item" class="item">a</li></ul>
  <span k="plain">s</span>
</section>`;
const all = keysOf(template);

test("por defecto, el atributo de ámbito va a todos los elementos de la plantilla", () => {
  for (const css of [".missing {}", "p {}", ":global(.card) .item {}"]) {
    const source = `<template>${template}</template><style scoped>${css}</style>`;
    assert.deepEqual(scopedKeys(source, {}), all, css);
    assert.deepEqual(scopedKeys(source, { scopeAttribute: "all" }), all, css);
  }
  assert.deepEqual(scopedKeys(`<script lang="ts">const name = "";</script><template><div k="html" html="name"></div><p k="plain">x</p></template><style scoped>.x {}</style>`, {}), ["html", "plain"]);
});

test("con matched, el atributo de ámbito sólo va a los elementos que puede seleccionar cada clase de selector", () => {
  const cases: Array<[string, string[]]> = [
    ["p {}", ["text", "lead"]],
    ["P {}", ["text", "lead"]],
    [".lead {}", ["lead"]],
    [".note {}", ["lead"]],
    ["#home {}", ["link"]],
    ["[href] {}", ["link"]],
    ["[href^=\"/\"] {}", ["link"]],
    ["[href$=\".pdf\"] {}", []],
    ["[type=\"TEXT\" i] {}", ["field"]],
    ["[class~=\"item\"] {}", ["item"]],
    ["[hidden] {}", []],
    ["* {}", all],
    [":hover {}", all],
    ["a:hover {}", ["link"]],
    ["::before {}", all],
    [".title::before {}", ["title"]],
    ["input::placeholder {}", ["field"]],
    [".missing {}", []],
    [".card .title {}", ["title"]],
    [".card > p {}", ["text", "lead"]],
    [".title + p {}", ["text", "lead"]],
    [".title ~ span {}", ["plain"]],
    [".title, .item {}", ["title", "item"]],
    [".card :global(.title) {}", ["root"]],
    [":global(.card) .item {}", ["item"]],
    [":global(.card) {}", []],
    [":global(body) :is(.title, .item) {}", ["title", "item"]],
    [":where(ul) li {}", ["item"]],
    [":is(.card .lead) {}", ["lead"]],
    [":is(.missing) {}", []],
    [".card:not(.x) {}", ["root"]],
    [":not(.x) {}", all],
    [".card:has(p) {}", ["root"]],
    ["p:nth-child(2 of .lead) {}", ["text", "lead"]],
    [".card { & .title {} &:hover {} }", ["root", "title"]],
    [".title { .card & {} }", ["title"]],
    [".lead { span {} }", ["lead", "plain"]],
    [":global(.theme) { & .item {} }", ["item"]],
    ["@media (min-width: 1px) { .item {} }", ["item"]],
    ["@supports (display: grid) { @media print { ul {} } }", ["list"]],
    ["@keyframes spin { from { opacity: 0; } } .title { animation: spin 1s; }", ["title"]],
    ["[data-meeko-x] {}", all],
  ];
  for (const [css, expected] of cases) {
    assert.deepEqual(scopedKeys(`<template>${template}</template><style scoped>${css}</style>`), expected, css);
  }
});

test("con matched, el atributo de ámbito se conserva en los elementos con atributos que cambian", () => {
  const script = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const on = signal(false);
const name = signal("");
const agree = signal(false);
const size = signal("s");
</script>`;
  const cases: Array<[string, string, string[]]> = [
    // bind:class may add any class; a static class that no selector names stays unscoped.
    [`<p k="dynamic" bind:class="on.value ? 'active' : ''">x</p><p k="static" class="idle">x</p>`, ".active {}", ["dynamic"]],
    [`<p k="dynamic" bind:id="on.value ? 'a' : 'b'">x</p><p k="static" id="c">x</p>`, "#a {}", ["dynamic"]],
    [`<a k="dynamic" bind:aria-current="on.value ? 'page' : undefined">x</a><a k="static">x</a>`, "[aria-current=\"page\"] {}", ["dynamic"]],
    // The script holds the element: through ref: or the currentTarget of an on: handler.
    [`<div k="ref" ref:box>x</div><div k="plain">x</div>`, ".open {}", ["ref"]],
    [`<button k="handler" on:click="() => on.value = true">x</button><button k="plain">x</button>`, ".pressed {}", ["handler"]],
    // A custom element sets its own classes and attributes.
    [`<x-chip k="custom">x</x-chip><b k="plain">x</b>`, "[selected] {}", ["custom"]],
    // model renders value and checked; a <select model> renders selected on its options.
    [`<input k="text" model="name" /><input k="check" type="checkbox" model="agree" /><input k="other" />`, "[value=\"\"] {}", ["text", "check"]],
    [`<input k="check" type="checkbox" model="agree" /><input k="other" type="checkbox" />`, "[checked] {}", ["check"]],
    [`<select k="select" model="size"><option k="s" value="s">s</option></select><select k="free"><option k="m" value="m">m</option></select>`, "[selected] {}", ["s"]],
    // The browser adds open to <details> and <dialog>.
    [`<details k="details"><summary k="summary">x</summary></details><dialog k="dialog">x</dialog>`, "[open] {}", ["details", "dialog"]],
    // Meeko's own markers and the element of an html directive follow the same rule.
    [`<div k="html" class="content" html="name.value"></div><p k="plain">x</p>`, ".content :global(p) {}", ["html"]],
    [`<div k="html" class="content" html="name.value"></div><p k="plain">x</p>`, "p {}", ["plain"]],
  ];
  for (const [markup, css, expected] of cases) {
    assert.deepEqual(scopedKeys(`${script}<template>${markup}</template><style scoped>${css}</style>`), expected, `${markup}\n${css}`);
  }
});

test("sin <style scoped> ningún elemento recibe el atributo; con matched, tampoco sin selectores con ámbito", () => {
  const markup = `<template><section class="card"><p>x</p></section></template>`;
  for (const style of ["", "<style>.card {}</style>"]) {
    for (const options of [{}, matched]) assert.doesNotMatch(compile(`${markup}${style}`, "Scoped.meeko", options).code, /data-meeko-s-/, style);
  }
  for (const style of ["<style scoped></style>", "<style scoped>:global(.card) {}</style>", "<style scoped>@keyframes spin { from { opacity: 0; } }</style>"]) {
    assert.doesNotMatch(compile(`${markup}${style}`, "Scoped.meeko", matched).code, /data-meeko-s-/, style);
    assert.match(compile(`${markup}${style}`, "Scoped.meeko").code, /data-meeko-s-/, style);
  }
});

test("con matched, el contenido de un snippet sigue el ámbito del componente que lo escribe", () => {
  const source = `<script lang="ts">import * as Card from "./Card.meeko";</script>
<template><Card><p k="matched" class="a">x</p><p k="plain">y</p></Card></template><style scoped>.a {}</style>`;
  assert.deepEqual(scopedKeys(source), ["matched"]);
});

test("con matched, SSR, hidratación y regiones emiten el mismo atributo de ámbito", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeko-scoped-"));
  const window = new Window();
  try {
    const { module, css } = await load(directory, "Scoped", `<script lang="ts">
import { signal } from "@meekojs/meeko";
const show = signal(false);
const items = signal(["a"]);
const active = signal("a");
const raw = "<p class=\\"inner\\">raw</p>";
</script>
<template>
<section class="card">
  <p class="lead">lead</p>
  <i>plain</i>
  <p class="extra" if:when="show.value">extra <b>bold</b></p>
  <ul><li each:of="items.value" each:as="item" each:key="item" bind:class="item === active.value ? 'row active' : 'row'"><span>{item}</span></li></ul>
  <div class="content" html="raw"></div>
  <button on:click="() => { show.value = !show.value; items.value = [...items.value, 'b']; active.value = 'b'; }">go</button>
</section>
</template>
<style scoped>
.card { margin-left: 1px; }
.lead, .extra { color: rgb(1, 2, 3); }
.active { font-weight: 700; }
.content :global(.inner) { margin-top: 2px; }
</style>`);
    const scope = /\[(data-meeko-s-[0-9a-f]{8})\]/.exec(css)![1]!;
    const document = window.document;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const root = document.createElement("main");
    document.body.append(root);
    const html = module.renderToString({});
    root.innerHTML = html;
    const scoped = (): string[] => [...root.querySelectorAll(`[${scope}]`)].map((element) => `${element.tagName.toLowerCase()}${element.className ? `.${element.className.split(" ").join(".")}` : ""}`);
    assert.deepEqual(scoped(), ["section.card", "p.lead", "li.row.active", "div.content", "button"]);
    const release = module.hydrate(root as unknown as Element, {});
    assert.equal(root.innerHTML, html);
    (root.querySelector("button") as unknown as HTMLButtonElement).click();
    // The rendered if: region and the new each: row carry the attribute where the server would.
    assert.deepEqual(scoped(), ["section.card", "p.lead", "p.extra", "li.row", "li.row.active", "div.content", "button"]);
    assert.equal(root.querySelector("b")!.hasAttribute(scope), false);
    assert.equal(root.querySelector("li span")!.hasAttribute(scope), false);
    assert.equal(root.querySelector(".inner")!.hasAttribute(scope), false);
    const computed = (selector: string) => window.getComputedStyle(root.querySelector(selector)!);
    assert.equal(computed(".extra").color, "rgb(1, 2, 3)");
    assert.equal(computed("li.active").fontWeight, "700");
    assert.equal(computed("li:not(.active)").fontWeight, "normal");
    assert.equal(computed(".inner").marginTop, "2px");
    const fresh = document.createElement("main");
    fresh.innerHTML = module.renderToString({});
    assert.equal(fresh.innerHTML, html);
    release();
  } finally {
    await window.happyDOM.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("con matched, los estilos calculados no cambian al limitar el atributo a los elementos seleccionables", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeko-scoped-"));
  const window = new Window();
  const rules = [
    ".card", "p", ".lead", "#home", "[href^=\"/\"]", "[type=\"text\"]", ".card > p", ".title + p", ".title ~ span",
    ".card .item", ":is(.title, .item)", ":where(ul) > li", ".card:not(.missing)", ".card:has(.item)", "li:first-child",
    "span:last-child", ".lead::before", "ul :global(li)", ":global(.card) .title", "[aria-current]", ".active", "details[open]",
    ".flagged",
  ];
  try {
    const { module, css } = await load(directory, "Visual", `<script lang="ts">
import { signal } from "@meekojs/meeko";
const current = signal(true);
</script>
<template>
<section class="card">
  <h2 class="title">t</h2>
  <p>x</p>
  <p class="lead">x</p>
  <a href="/x" id="home" bind:aria-current="current.value ? 'page' : undefined">x</a>
  <input type="text" />
  <ul><li class="item">a</li><li bind:class="current.value ? 'active' : ''">b</li></ul>
  <details><summary>s</summary><em>e</em></details>
  <div><b>b</b><i bind:class="current.value ? 'active' : ''">i</i><small ref:note>n</small></div>
  <span>s</span>
</section>
</template>
<style scoped>
${rules.map((rule, index) => `${rule} { --r${index}: ${index}; }`).join("\n")}
</style>`);
    const scope = /\[(data-meeko-s-[0-9a-f]{8})\]/.exec(css)![1]!;
    const document = window.document;
    // Every element starts without the properties, so each one shows only the rules it matches.
    const reset = document.createElement("style");
    reset.textContent = `* { ${rules.map((_, index) => `--r${index}: none;`).join(" ")} }`;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(reset, style);
    const pruned = document.createElement("main");
    pruned.innerHTML = module.renderToString({});
    // Before: every element of the template carried the attribute.
    const everywhere = pruned.cloneNode(true) as typeof pruned;
    for (const element of everywhere.querySelectorAll("*")) element.setAttribute(scope, "");
    document.body.append(pruned, everywhere);
    // The user opens the details, and a script adds a class to the element of a ref.
    for (const root of [pruned, everywhere]) {
      root.querySelector("details")!.setAttribute("open", "");
      root.querySelector("small")!.classList.add("flagged");
    }
    const before = [...everywhere.querySelectorAll("*")];
    const after = [...pruned.querySelectorAll("*")];
    assert.equal(after.length, before.length);
    assert.ok(after.filter((element) => !element.hasAttribute(scope)).length >= 4, "some elements lose the attribute");
    let matched = 0;
    for (const [index, element] of after.entries()) {
      const expected = window.getComputedStyle(before[index]!);
      const actual = window.getComputedStyle(element);
      for (const rule of rules.keys()) {
        const value = actual.getPropertyValue(`--r${rule}`).trim();
        assert.equal(value, expected.getPropertyValue(`--r${rule}`).trim(), `${element.outerHTML}: ${rules[rule]}`);
        if (value !== "none") matched++;
      }
    }
    assert.ok(matched >= rules.length, "the rules match elements");
    // The same holds selector by selector, with the pseudo-element left out.
    const structural = (selector: string): string => selectorParser((root) => {
      root.walkPseudos((pseudo) => { if (pseudo.value.startsWith("::")) pseudo.remove(); });
    }).processSync(selector);
    postcss.parse(css).walkRules((rule) => {
      for (const selector of rule.selectors) {
        const query = structural(selector);
        const indexes = (root: typeof pruned, elements: typeof after) => [...root.querySelectorAll(query)].map((element) => elements.indexOf(element));
        assert.deepEqual(indexes(pruned, after), indexes(everywhere, before), selector);
      }
    });
  } finally {
    await window.happyDOM.close();
    await rm(directory, { recursive: true, force: true });
  }
});

const configured = `<template><section class="card"><p class="lead">x</p><em>y</em></section></template><style scoped>.lead { color: red; }</style>`;
/** Tags whose compiled opening carries the scope attribute; the module repeats the template, so each counts once. */
const scopedTags = (code: string): string[] => [...new Set([...code.matchAll(/"<([a-z]+)"((?:(?!"<[a-zA-Z/]).)*?)">"/g)].filter((tag) => /data-meeko-s-/.test(tag[2]!)).map((tag) => tag[1]!))];

test("meeko.config valida css.scopeAttribute", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-scoped-config-"));
  try {
    assert.deepEqual((await loadMeekoConfig(root)).css, undefined);
    await writeFile(join(root, "meeko.config.mjs"), `export default { css: { scopeAttribute: "matched" } };`);
    assert.equal((await loadMeekoConfig(root)).css?.scopeAttribute, "matched");
    for (const [css, message] of [[`{ scopeAttribute: "some" }`, /css\.scopeAttribute debe ser "all" o "matched"/], [`"matched"`, /css debe ser un objeto/]] as const) {
      await writeFile(join(root, "meeko.config.mjs"), `export default { css: ${css} };`);
      await assert.rejects(loadMeekoConfig(root), message);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("el plugin de Vite y meeko compile aplican css.scopeAttribute del proyecto", async () => {
  const project = await createTempProject("scoped-config");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), `{ "private": true, "type": "module" }`);
    // `meeko compile` type-checks the component against the package.
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await writeFile(join(root, "Card.meeko"), configured);
    const viteTags = async (): Promise<string[]> => {
      const server = await createServer({ root, configFile: false, logLevel: "silent", plugins: [meeko()], server: { middlewareMode: true, hmr: false } });
      try { return scopedTags((await server.transformRequest(join(root, "Card.meeko"), { ssr: true }))!.code); }
      finally { await server.close(); }
    };
    const cliTags = async (): Promise<string[]> => {
      const result = spawnSync(process.execPath, [resolve("dist/cli.js"), "compile", join(root, "Card.meeko"), join(root, "Card.ts")], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return scopedTags(await readFile(join(root, "Card.ts"), "utf8"));
    };
    assert.deepEqual(await viteTags(), ["section", "p", "em"]);
    assert.deepEqual(await cliTags(), ["section", "p", "em"]);
    await writeFile(join(root, "meeko.config.mjs"), `export default { css: { scopeAttribute: "matched" } };`);
    assert.deepEqual(await viteTags(), ["p"]);
    assert.deepEqual(await cliTags(), ["p"]);
  } finally {
    await project.remove();
  }
});
