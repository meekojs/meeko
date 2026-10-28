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

/**
 * The runtime as the compiled components load it, by file URL: a static import of `../src` can be a
 * second copy of its modules under tsx, with IDs of its own.
 */
const runtime = async () => ({
  ...await import(pathToFileURL(resolve("src/index.ts")).href) as typeof import("../src/index.ts"),
  ...await import(pathToFileURL(resolve("src/framework/head.ts")).href) as typeof import("../src/framework/head.ts"),
  ...await import(pathToFileURL(resolve("src/framework/server.ts")).href) as typeof import("../src/framework/server.ts"),
  ...await import(pathToFileURL(resolve("src/framework/client.ts")).href) as typeof import("../src/framework/client.ts"),
});

/** A field whose label, control and hint are linked by `useId`. */
const field = `<script lang="ts">
import { useId } from "@meekojs/meeko";
const props = defineProps<{ label: string }>();
const id = useId();
const hint = useId();
</script>
<template><label bind:for="id">{props.label}</label><input bind:id="id" bind:aria-describedby="hint"><small bind:id="hint">?</small></template>`;

/** Renders its default snippet twice, in two regions. */
const twice = `<script lang="ts">
const snippets = defineSnippets<{ default: [] }>();
</script>
<template><div class="first"><render snippet="snippets.default" /></div><div class="second"><render snippet="snippets.default" /></div></template>`;

const parent = `<script lang="ts">
import { signal, useId } from "@meekojs/meeko";
import * as Field from "./Field.meeko";
import * as Twice from "./Twice.meeko";
const own = useId();
const rows = signal([{ key: "a", label: "A" }, { key: "b c", label: "B" }]);
const open = signal(true);
const extra = signal(false);
function add(): void { rows.value = [...rows.value, { key: "z", label: "Z" }]; }
function reverse(): void { rows.value = [...rows.value].reverse(); }
</script>
<template><section bind:id="own">
<Field label="top" />
<div each:of="rows.value" each:as="row" each:key="row.key"><Field bind:label="row.label" /></div>
<div if:when="open.value"><Field label="if" /></div>
<div if:when="extra.value"><Field label="later" /></div>
<Twice><Field label="snippet" /></Twice>
<button class="add" on:click="add">+</button>
<button class="reverse" on:click="reverse">r</button>
<button class="show" on:click="() => extra.value = true">show</button>
<button class="toggle" on:click="() => open.value = !open.value">t</button>
</section></template>`;

interface Loaded<P> {
  renderWithState(props: P): { html: string; state: Record<string, unknown> };
  hydrate(root: Element, props: P, state?: Record<string, unknown>): () => void;
}

async function load<P>(files: Record<string, string>, entry: string): Promise<{ module: Loaded<P> & ClientComponent; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "meeko-use-id-"));
  for (const [file, source] of Object.entries(files)) {
    let code = compile(source, join(directory, file)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtimeUrl("src/internal.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtimeUrl("src/index.ts")}`)
      .replace(`from "@meekojs/meeko/framework"`, `from ${runtimeUrl("src/framework.ts")}`);
    for (const other of Object.keys(files)) code = code.replace(`from "./${other}"`, `from "./${other.replace(/\.meeko$/, ".ts")}"`);
    await writeFile(join(directory, file.replace(/\.meeko$/, ".ts")), code);
  }
  const module = await import(pathToFileURL(join(directory, entry.replace(/\.meeko$/, ".ts"))).href) as Loaded<P> & ClientComponent;
  return { module, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

/** Every field: its label's `for`, its control's `id` and `aria-describedby`, and its hint's `id`. */
function fields(root: { querySelectorAll(selector: string): Iterable<unknown> }): Array<{ label: string; for: string; id: string; describedBy: string; hint: string }> {
  return [...root.querySelectorAll("label")].map((node) => {
    const label = node as Element;
    const input = label.nextElementSibling!;
    const hint = input.nextElementSibling!;
    return { label: label.textContent ?? "", for: label.getAttribute("for")!, id: input.getAttribute("id")!, describedBy: input.getAttribute("aria-describedby")!, hint: hint.getAttribute("id")! };
  });
}

function assertLinked(list: ReturnType<typeof fields>): void {
  const ids = list.flatMap((item) => [item.id, item.hint]);
  assert.equal(new Set(ids).size, ids.length, `IDs repeat: ${JSON.stringify(list)}`);
  for (const item of list) {
    assert.equal(item.for, item.id);
    assert.equal(item.describedBy, item.hint);
    assert.match(item.id, /^m-[A-Za-z0-9_-]+$/);
  }
}

test("useId gives the same IDs in SSR and hydration, unique per instance in each, if and snippets", { timeout: 60_000 }, async () => {
  const { module, cleanup } = await load<Record<string, never>>({ "Field.meeko": field, "Twice.meeko": twice, "Parent.meeko": parent }, "Parent.meeko");
  const browser = new HappyWindow();
  try {
    const first = module.renderWithState({});
    assert.equal(module.renderWithState({}).html, first.html, "the render is deterministic");
    const root = browser.document.createElement("main");
    root.innerHTML = first.html;
    const server = fields(root);
    assert.deepEqual(server.map((item) => item.label), ["top", "A", "B", "if", "snippet", "snippet"]);
    assertLinked(server);
    assert.equal(root.querySelector("section")!.getAttribute("id"), "m-0", "the root instance counts from zero");

    // Hydration compares every attribute with the SSR: a different ID would be a mismatch.
    const release = module.hydrate(root as unknown as Element, {}, first.state);
    assert.deepEqual(fields(root), server);
    const click = (selector: string): void => (root.querySelector(selector) as unknown as HTMLButtonElement).click();

    // A row added in the browser and a region that appears later get IDs of their own.
    click(".add");
    click(".show");
    const later = fields(root);
    assert.deepEqual(later.map((item) => item.label), ["top", "A", "B", "Z", "if", "later", "snippet", "snippet"]);
    assertLinked(later);

    // A keyed row keeps its IDs when the list moves; a field that an if recreates gets its IDs back.
    const byLabel = (list: ReturnType<typeof fields>) => Object.fromEntries(list.map((item) => [item.label, item.id]));
    click(".reverse");
    assert.deepEqual(byLabel(fields(root)), byLabel(later));
    click(".toggle");
    click(".toggle");
    assert.equal(byLabel(fields(root)).if, byLabel(server).if);
    release();
  } finally {
    await browser.happyDOM.close();
    await cleanup();
  }
});

test("useId outside a component script returns IDs that do not repeat", async () => {
  const { useId } = await runtime();
  const ids = new Set(Array.from({ length: 5 }, () => useId()));
  assert.equal(ids.size, 5);
  for (const id of ids) assert.match(id, /^m-u[0-9a-z]+$/);
});

test("document.idPrefix gives the IDs of a framework page their prefix in SSR and hydration", { timeout: 60_000 }, async () => {
  const page = `<script lang="ts">
import { useForm } from "@meekojs/meeko/framework";
import { useId } from "@meekojs/meeko";
import * as Field from "./Field.meeko";
const id = useId();
const form = useForm({ initial: { email: "" }, submit: () => {} });
const email = form.field("email");
</script>
<template><p bind:id="id">x</p><Field label="Correo" /><input bind:id="email.id" bind:name="email.name" model="email.value"></template>`;
  const { module, cleanup } = await load<Record<string, never>>({ "Field.meeko": field, "Page.meeko": page }, "Page.meeko");
  try {
    const { createFrameworkHandler, mountClientApp } = await runtime();
    const routes: readonly RouteRecord[] = createRouteManifest([{ id: "/", file: "Page.meeko", layouts: [] }]);
    const server = createFrameworkHandler({ routes, loadPage: async () => module, document: { config: { idPrefix: "shop" } } });
    const html = await (await server(new Request("https://example.test/", { headers: { accept: "text/html" } }))).text();
    const browser = new HappyWindow({ url: "https://example.test/" });
    browser.document.write(html);
    const root = browser.document.getElementById("app")!;
    const ids = [...root.querySelectorAll("[id]")].map((node) => node.getAttribute("id"));
    assert.equal(ids.length, 4);
    for (const id of ids) assert.match(id!, /^shop-/);
    assert.equal(root.querySelector("input[name=email]")!.getAttribute("id"), `${ids[0]!.replace(/-0$/, "")}-1-email`);
    const reported: unknown[] = [];
    const app = await mountClientApp({
      routes, root: root as unknown as Element, payload: browser.document.getElementById("meeko-payload")!.textContent!,
      loadPage: async () => module, browser: browser as unknown as Window, document: { idPrefix: "shop" }, onError: (error) => { reported.push(error); },
    });
    assert.deepEqual(reported, [], "hydration found the same IDs");
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
  const { normalizeDocumentConfig } = await runtime();
  assert.throws(() => normalizeDocumentConfig({ idPrefix: "1app" }, "document"), /idPrefix/);
  assert.throws(() => normalizeDocumentConfig({ idPrefix: "a b" }, "document"), /idPrefix/);
  assert.deepEqual(normalizeDocumentConfig({ idPrefix: "shop_2" }, "document"), { idPrefix: "shop_2" });
});

/** A component with an ID of its own and a default snippet. */
const box = `<script lang="ts">
import { useId } from "@meekojs/meeko";
const snippets = defineSnippets<{ default?: [] }>();
const id = useId();
</script>
<template><aside bind:id="id"><render snippet="snippets.default" /></aside></template>`;

test("<component is> keeps the position and the prefix of the IDs when it swaps a tag and a component", { timeout: 60_000 }, async () => {
  const host = (initial: "div" | "box"): string => `<script lang="ts">
import { signal } from "@meekojs/meeko";
import type { Component } from "@meekojs/meeko";
import * as Box from "./Box.meeko";
import * as Field from "./Field.meeko";
const kind = signal<"div" | "box">(${JSON.stringify(initial)});
const view = (): "div" | Component<Record<string, never>> => kind.value === "box" ? Box : kind.value;
</script>
<template><section><component is="view()"><Field label="inner" /></component><button class="box" on:click="() => kind.value = 'box'">b</button><button class="div" on:click="() => kind.value = 'div'">d</button></section></template>`;
  const files = { "Field.meeko": field, "Box.meeko": box };
  const asTag = await load<Record<string, never>>({ ...files, "Host.meeko": host("div") }, "Host.meeko");
  const asComponent = await load<Record<string, never>>({ ...files, "Host.meeko": host("box") }, "Host.meeko");
  const { withIdRoot } = await import(pathToFileURL(resolve("src/ids.ts")).href) as typeof import("../src/ids.ts");
  const browser = new HappyWindow();
  try {
    const ids = (root: { querySelectorAll(selector: string): Iterable<unknown> }): string[] => [...root.querySelectorAll("[id]")].map((node) => (node as Element).getAttribute("id")!);
    const tagRender = withIdRoot("shop", () => asTag.module.renderWithState({}));
    const componentRender = withIdRoot("shop", () => asComponent.module.renderWithState({}));
    const expected = { tag: ids(Object.assign(browser.document.createElement("main"), { innerHTML: tagRender.html })), component: ids(Object.assign(browser.document.createElement("main"), { innerHTML: componentRender.html })) };
    assert.equal(expected.tag.length, 2);
    assert.equal(expected.component.length, 3);
    for (const id of [...expected.tag, ...expected.component]) assert.match(id, /^shop-/);

    // Tag to component: the component renders and hydrates where the SSR would have put it.
    const root = browser.document.createElement("main");
    browser.document.body.appendChild(root);
    root.innerHTML = tagRender.html;
    const release = withIdRoot("shop", () => asTag.module.hydrate(root as unknown as Element, {}, tagRender.state));
    const click = (selector: string): void => (root.querySelector(selector) as unknown as HTMLButtonElement).click();
    click("button.box");
    assert.ok(root.querySelector("aside"), "the component mounted");
    assert.deepEqual(ids(root), expected.component);

    // Component to tag: the content keeps the prefix and the IDs it had in SSR.
    click("button.div");
    assert.equal(root.querySelector("aside"), null);
    assert.deepEqual(ids(root), expected.tag);
    release();
  } finally {
    await browser.happyDOM.close();
    await asTag.cleanup();
    await asComponent.cleanup();
  }
});
