import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import * as prettier from "prettier";
import type { MarkupContent } from "vscode-languageserver/node";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import { parseRegionHtml } from "../src/dom.ts";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { hover, semanticTokens, semanticTokensLegend } from "../src/language-server/features.ts";
import plugin from "../src/prettier.ts";
import { decodeTokens, languageProject } from "./language-server-workspace.ts";

interface RuntimeModule {
  renderToString(props: Record<string, never>): string;
  hydrate(root: Element, props: Record<string, never>, state?: Record<string, unknown>): () => void;
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

/** Compiles a component against the source runtime, imported by file URL so both share one instance. */
async function load(source: string): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "html-test-"));
  const code = compile(source, join(directory, "Html.meeko")).code
    .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
    .replaceAll(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
  await writeFile(join(directory, "Html.ts"), code);
  const component = await import(pathToFileURL(join(directory, "Html.ts")).href) as RuntimeModule;
  return { component, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function assertCompileError(source: string, offset: number): void {
  assert.throws(() => compile(source, "Html.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, "MEEK095", error.message);
    assert.equal(error.diagnostic.location.offset, offset, error.message);
    return true;
  });
}

const component = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const body = signal<string | null>("<b>Hola</b> <em>&amp; adiós</em><br/>");
const show = signal(true);
const items = signal(["<i>a</i>", "<i>b</i>"]);
const clicks = signal(0);
function replace(): void {
  body.value = "<strong>Nuevo</strong>";
}
</script>
<template>
<article class="doc" html="body.value"></article>
<section if:when="show.value"><p html="'<u>' + clicks.value + '</u>'"></p></section>
<ul><li each:of="items.value" each:as="item" html="item"></li></ul>
<button type="button" class="replace" on:click="replace">{clicks.value}</button>
<button type="button" class="count" on:click="() => clicks.value++">+</button>
<button type="button" class="clear" on:click="() => body.value = null">x</button>
<button type="button" class="hide" on:click="() => show.value = !show.value">t</button>
<button type="button" class="add" on:click="() => items.value = [...items.value, '<i>c</i>']">a</button>
</template>`;

test("html compiles to unescaped SSR content, a marker and a hydration binding", () => {
  const { code } = compile(component, "Html.meeko");
  assert.match(code, /"<article" \+ " data-meeko-h=\\"0\\"" \+ " class=\\"doc\\"" \+ ">" \+ __meeko\.rawHtml\(body\.value, "article"\) \+ "<\/article>"/);
  assert.match(code, /__meeko\.bindHtml\(__scope, 0, \(\) => \(body\.value\), "Html\.meeko:\d+:\d+ \(html 0\)"\)/);
  assert.match(code, /__meeko\.bindHtml\(__scope, 2, \(\) => \(\(__meeko_item_\d+\.value\)\)/);
  assert.doesNotMatch(code, / html=\\"/, "html is a directive, not an attribute");
});

test("html renders unescaped HTML in SSR and an empty element for null", async () => {
  const { component: module, cleanup } = await load(component);
  try {
    const html = module.renderToString({});
    assert.match(html, /<article data-meeko-h="0" class="doc"><b>Hola<\/b> <em>&amp; adiós<\/em><br\/><\/article>/);
    assert.match(html, /<p data-meeko-h="1"><u>0<\/u><\/p>/);
    assert.match(html, /<li data-meeko-h="2"><i>a<\/i><\/li>.*<li data-meeko-h="2"><i>b<\/i><\/li>/);
    const empty = await load(component.replace(`signal<string | null>("<b>Hola</b> <em>&amp; adiós</em><br/>")`, "signal<string | null>(null)"));
    try { assert.match(empty.component.renderToString({}), /<article data-meeko-h="0" class="doc"><\/article>/); }
    finally { await empty.cleanup(); }
  } finally {
    await cleanup();
  }
});

test("hydration keeps matching HTML, replaces a mismatch and follows the signal", async () => {
  const { component: module, cleanup } = await load(component);
  const window = new Window();
  try {
    const document = window.document;
    const root = document.createElement("main");
    root.innerHTML = module.renderToString({});
    const article = root.querySelector("article")!;
    const bold = article.querySelector("b");
    const item = root.querySelector("li i");
    const release = module.hydrate(root as unknown as Element, {});
    // `<br/>` serializes as `<br>`: the content is the same, so hydration does not touch it.
    assert.equal(article.querySelector("b"), bold, "matching HTML keeps its nodes");
    assert.equal(root.querySelector("li i"), item);
    (root.querySelector("button.replace") as unknown as HTMLButtonElement).click();
    assert.equal(article.innerHTML, "<strong>Nuevo</strong>");
    (root.querySelector("button.count") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector("section p")?.innerHTML, "<u>1</u>");
    (root.querySelector("button.clear") as unknown as HTMLButtonElement).click();
    assert.equal(article.innerHTML, "");
    // Regions render and hydrate html like the rest of the template.
    (root.querySelector("button.hide") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector("section"), null);
    (root.querySelector("button.hide") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector("section p")?.innerHTML, "<u>1</u>");
    (root.querySelector("button.count") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector("section p")?.innerHTML, "<u>2</u>");
    (root.querySelector("button.add") as unknown as HTMLButtonElement).click();
    assert.deepEqual([...root.querySelectorAll("li")].map((li) => li.innerHTML), ["<i>a</i>", "<i>b</i>", "<i>c</i>"]);
    release();
    (root.querySelector("button.replace") as unknown as HTMLButtonElement).click();
    assert.equal(article.innerHTML, "", "a released binding stops updating");

    // HTML that differs from the expression is replaced during hydration.
    const second = document.createElement("main");
    second.innerHTML = module.renderToString({});
    second.querySelector("article")!.innerHTML = "<p>stale</p>";
    const stop = module.hydrate(second as unknown as Element, {});
    assert.equal(second.querySelector("article")!.innerHTML, "<b>Hola</b> <em>&amp; adiós</em><br>");
    stop();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("markers inside inserted HTML do not capture the component's bindings", async () => {
  const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const fake = signal('<button data-meeko="0" class="fake">f</button><!--meeko:text:0-->x<!--/meeko:text:0-->');
const count = signal(0);
</script>
<template><div html="fake.value"></div><button class="real" on:click="() => count.value++">{count.value}</button></template>`;
  const { component: module, cleanup } = await load(source);
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    root.innerHTML = module.renderToString({});
    const release = module.hydrate(root as unknown as Element, {});
    (root.querySelector("button.fake") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector("button.real")?.textContent, "0");
    (root.querySelector("button.real") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector("button.real")?.textContent, "1");
    assert.equal(root.querySelector("div")?.textContent, "fx");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

const unbalanced = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const truncated = signal("<b>Hola");
const closing = signal('x</div><button data-meeko="0" class="fake">f</button>');
const block = signal('<div class="inner">bloque</div><button data-meeko="0" class="fake2">g</button>');
const count = signal(0);
</script>
<template><main><article class="a" html="truncated.value"></article><span class="after">after</span><div class="b" html="closing.value"></div><p class="c" html="block.value"></p><button class="real" on:click="() => count.value++">{count.value}</button></main></template>`;

test("SSR normalizes html so unbalanced content stays inside its element", async () => {
  const { component: module, cleanup } = await load(unbalanced);
  try {
    const html = module.renderToString({});
    // A truncated tag closes inside the element.
    assert.match(html, /<article data-meeko-h="0" class="a"><b>Hola<\/b><\/article><span class="after">/);
    // A stray end tag is dropped, so the value cannot close the element and leave a marker outside.
    assert.match(html, /<div data-meeko-h="1" class="b">x<button data-meeko="0" class="fake">f<\/button><\/div>/);
    // A <div> would close the <p>: the element renders empty and the browser fills it on hydration.
    assert.match(html, /<p data-meeko-h="2" class="c"><\/p>/);
    // In a <pre>, the newline right after the start tag survives the document parser.
    const pre = await load(`<script lang="ts">const code = "\\nlinea";</script><template><pre html="code"></pre></template>`);
    try { assert.equal(pre.component.renderToString({}), `<pre data-meeko-h="0">\n\nlinea</pre>`); }
    finally { await pre.cleanup(); }
  } finally {
    await cleanup();
  }
});

test("hydration of normalized html keeps every node inside its element and ignores fake markers", async () => {
  const { component: module, cleanup } = await load(unbalanced);
  const window = new Window();
  try {
    const root = window.document.createElement("section");
    root.innerHTML = module.renderToString({});
    const release = module.hydrate(root as unknown as Element, {});
    assert.equal(root.querySelector("b span"), null, "the text after the element is not bold");
    assert.equal(root.querySelector("article")?.innerHTML, "<b>Hola</b>");
    assert.equal(root.querySelectorAll("div.inner").length, 1);
    assert.equal(root.querySelector("p.c div.inner")?.textContent, "bloque");
    (root.querySelector("button.fake") as unknown as HTMLButtonElement).click();
    (root.querySelector("button.fake2") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector("button.real")?.textContent, "0");
    (root.querySelector("button.real") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector("button.real")?.textContent, "1");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("scripts inside html never run: hydration, a new value, a late mount and parsed regions", async () => {
  const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const body = signal("<i>a</i><script>globalThis.meekoRan.push('initial')<\\/script>");
const show = signal(false);
</script>
<template><div class="body" html="body.value"></div><section if:when="show.value"><div class="late" html="'<script>globalThis.meekoRan.push(\\'late\\')<\\/script><b>late</b>'"></div></section>
<button class="change" on:click="() => body.value = '<script>globalThis.meekoRan.push(\\'change\\')<\\/script><u>b</u>'">c</button>
<button class="show" on:click="() => show.value = true">s</button></template>`;
  const { component: module, cleanup } = await load(source);
  const window = new Window({ settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  try {
    const ran: string[] = [];
    (window as unknown as { meekoRan: string[] }).meekoRan = ran;
    const document = window.document;
    const root = document.createElement("main");
    document.body.append(root);
    root.innerHTML = module.renderToString({});
    // A stale element: hydration replaces its content.
    root.querySelector("div.body")!.innerHTML = "<p>stale</p>";
    const release = module.hydrate(root as unknown as Element, {});
    assert.match(root.querySelector("div.body")?.innerHTML ?? "", /^<i>a<\/i><script>/);
    (root.querySelector("button.change") as unknown as HTMLButtonElement).click();
    assert.match(root.querySelector("div.body")?.innerHTML ?? "", /<u>b<\/u>$/);
    (root.querySelector("button.show") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector("div.late b")?.textContent, "late");
    assert.equal(root.querySelectorAll("div.late script").length, 1);
    // The parser of late mounts and navigations disarms the scripts of html content only.
    const parsed = parseRegionHtml(root as unknown as Node, `<div data-meeko-h="0"><script>globalThis.meekoRan.push('region')</script></div>`);
    (root as unknown as Element).append(parsed);
    await new Promise((done) => setTimeout(done, 10));
    assert.deepEqual(ran, []);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("html and model on a custom element stay HTML attributes, as in 1.0", async () => {
  const source = `<script lang="ts">const intro = "x";</script>
<template><x-markdown html="intro" model="query"></x-markdown><div html="intro"></div></template>`;
  const { code } = compile(source, "Html.meeko");
  assert.match(code, /"<x-markdown" \+ " html=\\"intro\\"" \+ " model=\\"query\\"" \+ ">"/);
  assert.match(code, /__meeko\.bindHtml\(__scope, 0, \(\) => \(intro\)/);
  assert.equal(code.match(/__meeko\.bindHtml\(/g)?.length, 1, "only the standard element has the directive");
  const { component: module, cleanup } = await load(source);
  try {
    assert.equal(module.renderToString({}), `<x-markdown html="intro" model="query"></x-markdown><div data-meeko-h="0">x</div>`);
  } finally {
    await cleanup();
  }
  // Content and other attributes of a custom element are not restricted by MEEK095 or MEEK065.
  assert.doesNotThrow(() => compile(`<script lang="ts">const a = 1;</script><template><my-input model="a" html="b"><span>{a}</span></my-input></template>`, "Html.meeko"));
  const formatted = await prettier.format(`<script lang="ts">\nconst a = 1;\n</script>\n<template><x-markdown html="Hola  mundo" model="a+  b"></x-markdown><div html="a+  'b'"></div></template>\n`, { filepath: "Html.meeko", plugins: [plugin] });
  assert.match(formatted, /<x-markdown html="Hola {2}mundo" model="a\+ {2}b"><\/x-markdown>/);
  assert.match(formatted, /<div html="a \+ 'b'"><\/div>/);
});

test("html reports MEEK095 for children, contentless elements, <template>, model and an empty value", () => {
  const source = (template: string): string => `<script lang="ts">import { signal } from "@meekojs/meeko";\nconst value = signal("");\nconst text = "<b>x</b>";</script>\n<template>${template}</template>`;
  const children = source(`<div html="text"><span>x</span></div>`);
  assertCompileError(children, children.indexOf("<span>"));
  const interpolation = source(`<div html="text">{text}</div>`);
  assertCompileError(interpolation, interpolation.indexOf("{text}"));
  const comment = source(`<div html="text"><!-- c --></div>`);
  assertCompileError(comment, comment.indexOf("<!--"));
  const empty = source(`<div html=""></div>`);
  assertCompileError(empty, empty.indexOf(`html=""`));
  const image = source(`<img html="text">`);
  assertCompileError(image, image.indexOf(`html="text"`));
  const textarea = source(`<textarea html="text"></textarea>`);
  assertCompileError(textarea, textarea.indexOf(`html="text"`));
  const nested = source(`<template html="text"></template>`);
  assertCompileError(nested, nested.indexOf(`html="text"`));
  const model = source(`<select model="value" html="text"></select>`);
  assertCompileError(model, model.indexOf(`html="text"`));
  // Whitespace is not content.
  assert.doesNotThrow(() => compile(source(`<div html="text">\n  </div>`), "Html.meeko"));
  // On a component tag, html is not a prop.
  const tag = `<script lang="ts">const Child = 1;</script>\n<template><Child html="x" /></template>`;
  assert.throws(() => compile(tag, "Html.meeko"), (error: unknown) => error instanceof MeekoCompileError && error.diagnostic.code === "MEEK032");
});

test("html directives inside a later browser continuation report MEEK057", () => {
  const source = `<script lang="ts">\nconst first = useElementRef("box");\nconst box = await useElementRef("box");\nconst late = "<b>x</b>";\n</script>\n<template><div ref:box html="late"></div></template>`;
  assert.throws(() => compile(source, "Html.meeko"), (error: unknown) => error instanceof MeekoCompileError && error.diagnostic.code === "MEEK057");
});

test("meeko check types the html value as string, null or undefined", { timeout: 90_000 }, async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko", "html-check-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { types: ["node"], paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] } } })}\n`);
  try {
    const valid = `<script lang="ts">\nconst text: string | undefined = "<b>x</b>";\n</script><template><div html="text"></div></template>`;
    assert.deepEqual(await checkSource(valid, join(root, "Valid.meeko")), []);
    const number = `<script lang="ts">\nconst count = 1;\n</script><template><div html="count"></div></template>`;
    const diagnostics = await checkSource(number, join(root, "Number.meeko"));
    assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "TS2345" && diagnostic.location.offset === number.indexOf(`count"></div>`)), JSON.stringify(diagnostics));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the editor types html and its hover warns that it is unsafe with untrusted content", async () => {
  const valid = `<script lang="ts">\nconst text = "<b>x</b>";\n</script>\n<template><div html="text"></div></template>\n`;
  const invalid = `<script lang="ts">\nconst count = 1;\n</script>\n<template><div html="count"></div></template>\n`;
  const workspace = await languageProject("lsp-html-", { "Valid.meeko": valid, "Invalid.meeko": invalid });
  try {
    const context = await workspace.open("Valid.meeko");
    const docs = (hover(context, context.at(`html="`, 1))?.contents as MarkupContent).value;
    assert.match(docs, /sin escapar/);
    assert.match(docs, /Inseguro con contenido no confiable/);
    assert.match(docs, /MEEK095/);
    const value = (hover(context, context.at(`text"></div>`, 1))?.contents as MarkupContent).value;
    assert.match(value, /const text/);
    const broken = await workspace.open("Invalid.meeko");
    const diagnostics = await componentDiagnostics(workspace.project, broken.document, workspace.file("Invalid.meeko"), () => undefined);
    const at = diagnostics.filter((item) => broken.document.getText(item.range) === "count");
    assert.deepEqual(at.map((item) => item.code), ["TS2345"], JSON.stringify(diagnostics));
  } finally {
    await workspace.dispose();
  }
});

test("the editor treats html and model on a custom element as HTML attributes, as the compiler does", async () => {
  const source = `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst intro = signal("<b>x</b>");\n</script>\n<template><x-markdown html="intro" model="query"></x-markdown><div html="intro.value"></div></template>\n`;
  const workspace = await languageProject("lsp-html-custom-", { "Custom.meeko": source });
  try {
    const context = await workspace.open("Custom.meeko");
    const custom = source.indexOf(`html="intro"`);
    const end = source.indexOf("</x-markdown>");
    // The value is text: no `__meeko_html` or model check, so `intro` (a signal) and `query` (undeclared) give no error.
    assert.equal(context.component.code.match(/^__meeko_html\(/gm)?.length, 1, "only <div> types its html value");
    assert.ok(!/^__meeko_writable\(/m.test(context.component.code), "model on a custom element is not a signal");
    const diagnostics = await componentDiagnostics(workspace.project, context.document, workspace.file("Custom.meeko"), () => undefined);
    const inside = diagnostics.filter((item) => {
      const start = context.document.offsetAt(item.range.start);
      return start >= custom && start < end;
    });
    assert.deepEqual(inside, [], JSON.stringify(diagnostics));
    // No directive hover on the attribute name, and the value is not an expression.
    const docs = (offset: number): string => {
      const contents = hover(context, context.document.positionAt(offset))?.contents as MarkupContent | undefined;
      return contents?.value ?? "";
    };
    assert.doesNotMatch(docs(custom + 1), /sin escapar/);
    assert.doesNotMatch(docs(source.indexOf(`intro"`) + 1), /const intro/);
    assert.doesNotMatch(docs(source.indexOf(`query"`) + 1), /query/);
    // No semantic token, reactive or otherwise, inside the custom element's attributes.
    const tokens = decodeTokens(semanticTokens(context).data, semanticTokensLegend);
    const first = context.document.positionAt(custom);
    const last = context.document.positionAt(end);
    assert.deepEqual(tokens.filter((token) => token.line === first.line && token.character >= first.character && token.character < last.character), []);
    // On <div>, html stays a directive: hover with the warning and a typed, reactive expression.
    const div = source.indexOf(`html="intro.value"`);
    assert.match(docs(div + 1), /sin escapar/);
    assert.match(docs(div + `html="`.length + 1), /const intro/);
    const value = context.document.positionAt(div + `html="`.length);
    const token = tokens.find((item) => item.line === value.line && item.character === value.character);
    assert.ok(token?.modifiers.includes("signal"), JSON.stringify(tokens));
  } finally {
    await workspace.dispose();
  }
});

test("Prettier formats the html value as an expression", async () => {
  const source = `<script lang="ts">\nconst a = "x";\n</script>\n<template><div html="a+  'b'"></div><p data-html="a+  'b'"></p></template>\n`;
  const formatted = await prettier.format(source, { filepath: "Html.meeko", plugins: [plugin] });
  assert.match(formatted, /<div html="a \+ 'b'"><\/div>/);
  assert.match(formatted, /data-html="a\+  'b'"/);
  assert.equal(await prettier.format(formatted, { filepath: "Html.meeko", plugins: [plugin] }), formatted);
});
