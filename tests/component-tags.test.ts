import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError, parseSfc } from "../src/compiler/sfc.ts";

const script = `<script lang="ts">const AppButton = {} as never;\nconst Table = {} as never;\nconst Input = {} as never;\nconst items = ["a"];\nconst show = true;\nconst x = 1;\nconst Y = 2;</script>\n`;

function render(template: string): string {
  return compile(`${script}<template>${template}</template>`, "Tags.meeko").code;
}

function assertCompileError(template: string, code: string, at: string): void {
  const source = `${script}<template>${template}</template>`;
  assert.throws(() => compile(source, "Tags.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, code, error.message);
    assert.equal(error.diagnostic.location.offset, source.indexOf(at), error.message);
    return true;
  });
}

test("a PascalCase tag is <component is> for an identifier of the script", () => {
  const tag = render(`<AppButton bind:label="'Save'"></AppButton>`);
  const component = render(`<component is="AppButton" bind:label="'Save'"></component>`);
  assert.match(tag, /__meeko\.renderComponent<any>\(0, AppButton, __meeko\.componentTag\(\(\) => AppButton\)\(\{ "label": 'Save' \}, __meeko\.noChannels, __meeko\.noChannels, __meeko\.noChannels\), __meeko_transfer\)/);
  assert.equal(tag.match(/__meeko\.componentTag\(\(\) => AppButton\)\(\{ "label": 'Save' \}/g)?.length, component.match(/__meeko\.componentTag\(\(\) => AppButton\)\(\{ "label": 'Save' \}/g)?.length);
  assert.match(tag, /__meeko\.bindComponent<any>\(__scope, 0, \(\) => \(AppButton\), \(\) => \(__meeko\.componentTag\(\(\) => \(AppButton\)\)/);
});

test("<Name /> closes itself and keeps the following nodes as siblings", () => {
  const code = render(`<div><AppButton bind:label="'a'" /><p>after</p><AppButton/><span>{x}</span></div><em>tail</em>`);
  assert.match(code, /"<div" \+ ">" \+ __meeko\.renderComponent<any>\(0, AppButton, __meeko\.componentTag\(\(\) => AppButton\)\(\{ "label": 'a' \}, __meeko\.noChannels, __meeko\.noChannels, __meeko\.noChannels\), __meeko_transfer\) \+ "<p" \+ ">" \+ __meeko\.escapeHtml\("after"\) \+ "<\/p>" \+ __meeko\.renderComponent<any>\(1, AppButton, __meeko\.componentTag\(\(\) => AppButton\)\(\{  \}, __meeko\.noChannels, __meeko\.noChannels, __meeko\.noChannels\), __meeko_transfer\) \+ "<span"/);
  assert.match(code, /"<\/div>" \+ "<em"/);
  // At the end of the template and inside a nested <template>.
  assert.match(render(`<AppButton />`), /renderComponent<any>\(0, AppButton/);
  assert.match(render(`<template if:when="show"><AppButton /></template><p>x</p>`), /renderIf\(\d+, show, \(\) => __meeko\.renderComponent<any>\(\d+, AppButton/);
  assert.doesNotThrow(() => parseSfc(`${script}<template><AppButton /></template>`, "Tags.meeko"));
});

test("<component is /> closes itself like a PascalCase tag", () => {
  const code = render(`<div><component is="AppButton" bind:label="'a'" /><p>after</p></div><component is="show ? AppButton : Table"/><em>tail</em>`);
  assert.match(code, /"<div" \+ ">" \+ __meeko\.renderComponent<any>\(0, AppButton, __meeko\.componentTag\(\(\) => AppButton\)\(\{ "label": 'a' \}[^]*?\) \+ "<p" \+ ">" \+ __meeko\.escapeHtml\("after"\) \+ "<\/p>" \+ "<\/div>" \+ __meeko\.renderComponent<any>\(1, show \? AppButton : Table[^]*?\) \+ "<em"/);
  assert.doesNotThrow(() => parseSfc(`${script}<template><component is="AppButton" /></template>`, "Tags.meeko"));
  // Other HTML elements still need their end tag, with a Spanish message that keeps the parser code.
  const source = `${script}<template><div /></template>`;
  assert.throws(() => compile(source, "Tags.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, "MEEK001");
    assert.match(error.diagnostic.message, /^HTML de componente no válido: sólo los elementos vacíos .* \(non-void-html-element-start-tag-with-trailing-solidus\)$/);
    return true;
  });
});

test("names of HTML elements and unquoted values keep component semantics", () => {
  const code = render(`<Table bind:rows="items" /><Input bind:value="x" /><p>after</p>`);
  assert.match(code, /renderComponent<any>\(0, Table, __meeko\.componentTag\(\(\) => Table\)\(\{ "rows": items \}/);
  assert.match(code, /renderComponent<any>\(1, Input, __meeko\.componentTag\(\(\) => Input\)\(\{ "value": x \}/);
  assert.match(code, /"<p" \+ ">" \+ __meeko\.escapeHtml\("after"\)/);
  // `<` inside an attribute value is not a tag.
  assert.match(render(`<button on:click="() => x < Y">{x}</button>`), /\(\) => x < Y/);
  // HTML and custom elements stay DOM elements.
  const dom = render(`<my-widget bind:title="'t'"></my-widget><section></section>`);
  assert.match(dom, /"<my-widget"/);
  assert.doesNotMatch(dom, /renderComponent/);
});

test("PascalCase tags accept if:when and each:of", () => {
  const code = render(`<AppButton if:when="show" bind:label="'c'" /><AppButton each:of="items" each:as="item" each:key="item" bind:label="item"></AppButton>`);
  assert.match(code, /__meeko\.renderIf\(\d+, show, \(\) => __meeko\.renderComponent<any>\(\d+, AppButton, __meeko\.componentTag\(\(\) => AppButton\)\(\{ "label": 'c' \}/);
  assert.match(code, /__meeko\.renderFor\(\d+, items, .*__meeko\.renderComponent<any>\(\d+, AppButton, __meeko\.componentTag\(\(\) => AppButton\)\(\{ "label": item \}/);
});

test("PascalCase tags report bad closing and unsupported attributes", () => {
  // Since 1.1 children are snippets: the type check rejects them for a child without defineSnippets.
  assert.match(render(`<AppButton>text</AppButton>`), /__meeko\.componentTag\(\(\) => AppButton\)\(\{  \}, __meeko\.noChannels, __meeko\.noChannels, \{ "default": __meeko\.snippet\(/);
  assert.doesNotThrow(() => render(`<div><AppButton><span></span></AppButton></div>`));
  assertCompileError(`<AppButton></Table>`, "MEEK008", "</Table>");
  assertCompileError(`<div><AppButton></div>`, "MEEK008", "<AppButton>");
  // Since 1.1 a static attribute is a string prop; reserved and hyphenated names are not props.
  assert.doesNotThrow(() => render(`<AppButton label="x" />`));
  assertCompileError(`<AppButton is="Table" />`, "MEEK032", `is="Table"`);
  assertCompileError(`<AppButton aria-label="x" />`, "MEEK032", `aria-label="x"`);
  assertCompileError(`<p>x</p></AppButton>`, "MEEK008", "</AppButton>");
  assertCompileError(`<AppButton>`, "MEEK008", "<AppButton>");
  // An unclosed HTML element in a nested template is still an error next to <Name />.
  assert.throws(() => render(`<template if:when="show"><AppButton /><div></template>`), /closing-of-element-with-open-child-elements/);
  assert.doesNotThrow(() => render(`<template if:when="show"><li><AppButton /></template>`));
  // A component tag outside every section is not silently dropped.
  const stray = `${script}<template><p>x</p></template><AppButton />`;
  assert.throws(() => parseSfc(stray, "Tags.meeko"), (error: unknown) => error instanceof MeekoCompileError && error.diagnostic.code === "MEEK002" && error.diagnostic.location.offset === stray.lastIndexOf("<AppButton"));
});

test("a PascalCase name that does not resolve is a type error on the tag", { timeout: 60_000 }, async () => {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "component-tags-"));
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { types: ["node"], paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] } } })}\n`);
    const source = `<script lang="ts">const value = 1;</script>\n<template><p>{value}</p><Missing /></template>`;
    const diagnostics = await checkSource(source, join(root, "Unresolved.meeko"));
    assert.ok(diagnostics.length > 0);
    for (const diagnostic of diagnostics) {
      assert.equal(diagnostic.code, "TS2304");
      assert.match(diagnostic.message, /Cannot find name 'Missing'/);
      assert.equal(diagnostic.location.offset, source.indexOf("Missing"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PascalCase children render in SSR and hydrate in conditions and lists", async () => {
  const item = `<script lang="ts">
const props = defineProps<{ label: string }>();
const emit = defineEmits<{ pick: [label: string] }>();
</script>
<template><button on:click="() => emit('pick', props.label)">{props.label}</button></template>`;
  const list = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Item from "./Item.meeko";
const items = signal(["a", "b"]);
const show = signal(true);
const picked = signal("");
</script>
<template><Item each:of="items.value" each:as="label" each:key="label" bind:label="label" on:pick="(value) => picked.value = value" /><Item if:when="show.value" bind:label="'only'" on:pick="(value) => picked.value = value" /><p>{picked.value}</p><button class="toggle" on:click="() => show.value = !show.value">toggle</button></template>`;
  const directory = await mkdtemp(join(tmpdir(), "meeko-tags-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  const window = new Window();
  try {
    for (const [name, source] of [["Item", item], ["List", list]] as const) {
      const code = compile(source, join(directory, `${name}.meeko`)).code
        .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
        .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
        .replace(`from "./Item.meeko"`, `from "./Item.ts"`);
      await writeFile(join(directory, `${name}.ts`), code);
    }
    const component = await import(pathToFileURL(join(directory, "List.ts")).href) as {
      renderToString(props: Record<string, never>): string;
      hydrate(root: Element, props: Record<string, never>): () => void;
    };
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    const labels = (): string[] => [...root.querySelectorAll("button")].map((button) => button.textContent ?? "");
    assert.deepEqual(labels(), ["a", "b", "only", "toggle"]);
    const release = component.hydrate(root as unknown as Element, {});
    const click = (label: string): void => (([...root.querySelectorAll("button")].find((button) => button.textContent === label)) as unknown as HTMLButtonElement).click();
    click("b");
    assert.equal(root.querySelector("p")?.textContent, "b");
    click("only");
    assert.equal(root.querySelector("p")?.textContent, "only");
    click("toggle");
    assert.deepEqual(labels(), ["a", "b", "toggle"]);
    click("toggle");
    click("only");
    assert.equal(root.querySelector("p")?.textContent, "only");
    release();
  } finally {
    window.happyDOM.abort();
    await rm(directory, { recursive: true, force: true });
  }
});

test("static attributes on component tags are string props; a bare attribute passes true", () => {
  const code = render(`<AppButton variant="primary" disabled label='a &amp; "b"' empty="" />`);
  // The tag call types the literals by the child, exactly, so they keep their literal types.
  assert.match(code, /__meeko\.renderComponent<any>\(\d+, AppButton, __meeko\.componentTag\(\(\) => AppButton\)\(\{ "variant": "primary", "disabled": true, "label": "a & \\"b\\"", "empty": "" \}/);
  const dynamic = render(`<component is="AppButton" variant=primary closeOnEscape="no"></component>`);
  assert.match(dynamic, /__meeko\.renderComponent<any>\(\d+, AppButton, __meeko\.componentTag\(\(\) => AppButton\)\(\{ "variant": "primary", "closeOnEscape": "no" \}/);
  // The hydration reads the same props.
  assert.match(code, /__meeko\.bindComponent<any>\(__scope, \d+, \(\) => \(AppButton\), \(\) => \(__meeko\.componentTag\(\(\) => \(AppButton\)\)\(\{ "variant": "primary", "disabled": true/);
  // A static prop and its bind: form are a new MEEK090, in either order; two bind:/on: stay MEEK048.
  assertCompileError(`<AppButton variant="a" bind:variant="'b'" />`, "MEEK090", `bind:variant="'b'"`);
  assertCompileError(`<AppButton bind:variant="'b'" variant="a" />`, "MEEK090", `variant="a"`);
  assertCompileError(`<component is="AppButton" onSave="x" on:save="() => {}"></component>`, "MEEK090", `on:save=`);
  assertCompileError(`<AppButton ref="x" />`, "MEEK032", `ref="x"`);
  assertCompileError(`<AppButton data-id="x" />`, "MEEK032", `data-id="x"`);
});

/** Temporary project under `.meeko/` whose package imports resolve to src/. */
async function checkProject(files: Record<string, string>): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "component-props-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { types: ["node"], paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] } } })}\n`);
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const overlay = `<script lang="ts">
const props = defineProps<{ dismissible?: boolean; closeOnEscape?: boolean }>();
</script>
<template><div>{String(props.dismissible)}{String(props.closeOnEscape)}</div></template>`;

const badge = `<script lang="ts">
const props = defineProps<{ variant: "primary" | "secondary"; disabled?: boolean; label?: string }>();
</script>
<template><span>{props.variant}:{String(props.disabled ?? false)}:{props.label ?? ""}</span></template>`;

test("meeko check reports unknown and mistyped props on <component is> and PascalCase tags", { timeout: 120_000 }, async () => {
  const { root, cleanup } = await checkProject({ "AppOverlay.meeko": overlay, "AppBadge.meeko": badge });
  const head = `<script lang="ts">\nimport * as AppOverlay from "./AppOverlay.meeko";\nimport * as AppBadge from "./AppBadge.meeko";\n</script>\n<template>`;
  const cases: Array<{ name: string; template: string; code?: string; at?: string }> = [
    { name: "Valid", template: `<AppOverlay bind:dismissible="true" closeOnEscape /><component is="AppBadge" variant="primary" disabled label="x"></component><AppBadge bind:variant="'secondary'" />` },
    { name: "UnknownDynamic", template: `<component is="AppOverlay" bind:label="'x'" bind:value="'y'"></component>`, code: "TS2353", at: "label=" },
    { name: "UnknownTag", template: `<AppOverlay bind:label="'x'" bind:value="'y'" />`, code: "TS2353", at: "label=" },
    // Beside a known prop the render call accepts the extra prop; the props check does not.
    { name: "UnknownBesideKnownDynamic", template: `<component is="AppOverlay" bind:dismissible="true" bind:label="'x'"></component>`, code: "TS2353", at: "label=" },
    { name: "UnknownBesideKnownTag", template: `<AppOverlay bind:dismissible="true" bind:label="'x'" />`, code: "TS2353", at: "label=" },
    { name: "UnknownStatic", template: `<AppOverlay dismissible label="x" />`, code: "TS2353", at: "label=" },
    { name: "WrongTypeTag", template: `<AppOverlay bind:dismissible="'yes'" />`, code: "TS2322", at: "dismissible=" },
    { name: "WrongTypeDynamic", template: `<component is="AppOverlay" bind:closeOnEscape="1"></component>`, code: "TS2322", at: "closeOnEscape=" },
    { name: "WrongStaticLiteral", template: `<AppBadge variant="tertiary" />`, code: "TS2322", at: "variant=" },
    { name: "StaticForBoolean", template: `<AppOverlay dismissible="yes" />`, code: "TS2322", at: "dismissible=" },
  ];
  try {
    for (const item of cases) {
      const source = `${head}${item.template}</template>`;
      const diagnostics = await checkSource(source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      if (!item.code) {
        assert.deepEqual(diagnostics, [], `${item.name}: ${messages}`);
        continue;
      }
      const offset = source.indexOf(item.at!, source.indexOf("<template>"));
      assert.ok(diagnostics.some((diagnostic) => diagnostic.code === item.code && diagnostic.location.offset === offset), `${item.name}: ${messages}`);
    }
  } finally {
    await cleanup();
  }
});

test("static props and children without a script render in SSR and hydrate", async () => {
  const note = `<template><em>note</em></template>`;
  const page = `<script lang="ts">
import * as AppBadge from "./AppBadge.meeko";
import * as AppNote from "./AppNote.meeko";
</script>
<template><AppBadge variant="primary" disabled label="Hola" /><component is="AppBadge" variant="secondary"></component><AppNote /></template>`;
  const directory = await mkdtemp(join(tmpdir(), "meeko-static-props-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  const window = new Window();
  try {
    for (const [name, source] of [["AppBadge", badge], ["AppNote", note], ["Page", page]] as const) {
      const code = compile(source, join(directory, `${name}.meeko`)).code
        .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
        .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
        .replace(`from "./AppBadge.meeko"`, `from "./AppBadge.ts"`)
        .replace(`from "./AppNote.meeko"`, `from "./AppNote.ts"`);
      await writeFile(join(directory, `${name}.ts`), code);
    }
    const component = await import(pathToFileURL(join(directory, "Page.ts")).href) as {
      renderToString(props: Record<string, never>): string;
      hydrate(root: Element, props: Record<string, never>): () => void;
    };
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    const text = (): string[] => [...root.querySelectorAll("span, em")].map((element) => element.textContent ?? "");
    assert.deepEqual(text(), ["primary:true:Hola", "secondary:false:", "note"]);
    const first = root.querySelector("span");
    const release = component.hydrate(root as unknown as Element, {});
    // Hydration keeps the server nodes: the props it reads match the ones SSR rendered.
    assert.equal(root.querySelector("span"), first);
    assert.deepEqual(text(), ["primary:true:Hola", "secondary:false:", "note"]);
    release();
  } finally {
    window.happyDOM.abort();
    await rm(directory, { recursive: true, force: true });
  }
});
