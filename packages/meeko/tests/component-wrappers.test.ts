import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";

import { compile } from "../src/compiler.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { MeekoProject } from "../src/language-server/project.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

async function put(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

/** A polymorphic base: a route, a link or a button, with exclusive props and one event. */
const baseButton = `<script lang="ts">
interface Shared { class?: string }
interface AsRoute extends Shared { to: string; href?: never; type?: never }
interface AsLink extends Shared { href: string; to?: never; type?: never }
interface AsButton extends Shared { to?: never; href?: never; type?: "button" | "submit" }
type Props = AsRoute | AsLink | AsButton;
const { to, href, type = "button", class: className, ...rest } = defineProps<Props>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
const snippets = defineSnippets<{ default: [] }>();
void rest;
</script>
<template><button bind:class="className" bind:type="type" bind:data-to="to" bind:data-href="href" on:click="(event) => emit('click', event)"><render snippet="snippets.default" /></button></template>
`;

/** The pattern of the docs: props and events of the base, and the wrapper's own. */
const button = `<script lang="ts">
type Props = BaseButtonProps & { label: string };
const { label, ...rest } = defineProps<Props>();
const emit = defineEmits<BaseButtonEmits>();
</script>
<template><BaseButton bind="rest" on:click="(event) => emit('click', event)">{label}</BaseButton></template>
`;

const home = (tag: string): string => `<template>${tag}</template>\n`;

test("a wrapper of a component with a union of props extends <Name>Props, declares <Name>Emits and forwards the rest", { timeout: 240_000 }, async (context) => {
  const root = await tempProject(context, "component-wrappers");
  await linkRepositoryPackages(root);
  await put(root, "package.json", '{"private":true,"type":"module"}\n');
  await put(root, "meeko.config.mjs", "export default {};\n");
  await put(root, "app/components/Base/Button.meeko", baseButton);
  await put(root, "app/components/Button.meeko", button);
  await put(root, "app/pages/index.meeko", home(`<main><Button label="a" to="/x" /><Button label="b" href="/y" on:click="(event) => event.preventDefault()" /><Button label="c" type="submit" /></main>`));
  // The three aliases of a component, each with what it says.
  await put(root, "app/pages/aliases.meeko", `<script lang="ts">
const own: BaseButtonProps = { href: "/x" };
const events: BaseButtonEmits = { click: [new MouseEvent("click")] };
const all: ComponentProps<"BaseButton"> = { href: "/x", onClick: (event) => event.preventDefault() };
const none: "onClick" extends keyof BaseButtonProps ? never : true = true;
void own; void events; void all; void none;
</script>
<template><p>x</p></template>
`);
  assert.deepEqual(await checkFrameworkProject(root), []);

  // The exclusion of the base reaches the parent of the wrapper.
  await put(root, "app/pages/index.meeko", home(`<Button label="a" to="/x" href="/y" />`));
  const rejected = await checkFrameworkProject(root).then((found) => JSON.stringify(found), (error: Error) => error.message);
  assert.match(rejected, /TS2\d{3}/, "to and href together are an error");
  await put(root, "app/pages/index.meeko", home(`<main></main>`));

  // Since 1.8 the alias has no listeners: writing one is an error, and it is where the migration points.
  await put(root, "app/pages/aliases.meeko", `<script lang="ts">
const own: BaseButtonProps = { href: "/x", onClick: () => {} };
void own;
</script>
<template><p>x</p></template>
`);
  const listener = await checkFrameworkProject(root).then((found) => JSON.stringify(found), (error: Error) => error.message);
  assert.match(listener, /onClick/);
  await put(root, "app/pages/aliases.meeko", home("<p>x</p>"));

  // The editor agrees with `meeko check` on the wrapper.
  const project = new MeekoProject(root, { trusted: false });
  try {
    await project.ready();
    const file = join(root, "app", "components", "Button.meeko");
    assert.ok(project.setDocument(file, button), String(project.componentError(file)));
    const found = await componentDiagnostics(project, TextDocument.create(pathToFileURL(file).href, "meeko", 1, button), file, () => undefined);
    assert.deepEqual(found.map((item) => `${String(item.code)}: ${item.message}`), []);
  } finally {
    project.service.dispose();
  }
});

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

test("defineEmits with a map from elsewhere leaves its callbacks out of the rest, in SSR, hydration, updates and release", async () => {
  // Without the names of the events, `onClick` stayed in `rest`, and `bind="rest"` threw MEEK113 in SSR
  // as soon as a parent used `on:click`, though the types were correct.
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "component-wrappers-"));
  const window = new Window();
  try {
    const sources: Record<string, string> = {
      Base: `<script lang="ts">
export type BaseEvents = { click: [value: number] };
const props = defineProps<{ label: string; tone?: string }>();
const emit = defineEmits<{ click: [value: number] }>();
</script>
<template><button bind:title="props.tone" on:click="() => emit('click', 1)">{props.label}</button></template>`,
      Wrapper: `<script lang="ts">
import * as Base from "./Base.meeko";
import type { ComponentEmits } from "./Base.meeko";
const { extra, ...rest } = defineProps<{ label: string; tone?: string; extra?: string; onPlain?: () => void }>();
const emit = defineEmits<ComponentEmits>();
const keys = (): string => Object.keys(rest).sort().join();
</script>
<template><Base bind="rest" on:click="(value) => emit('click', value + 1)" /><i>{extra}</i><s>{keys()}</s></template>`,
      Page: `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Wrapper from "./Wrapper.meeko";
const tone = signal("a");
const clicks = signal<number[]>([]);
</script>
<template><main><Wrapper label="x" bind:tone="tone.value" extra="y" on:click="(value) => clicks.value = [...clicks.value, value]" /><b>{clicks.value.join()}</b><u on:click="() => tone.value = 'b'">t</u></main></template>`,
    };
    for (const [name, source] of Object.entries(sources)) {
      let code = compile(source, join(directory, `${name}.meeko`)).code
        .replace('from "@meekojs/meeko/internal"', `from ${runtime("src/internal.ts")}`)
        .replaceAll('from "@meekojs/meeko"', `from ${runtime("src/index.ts")}`);
      for (const other of Object.keys(sources)) code = code.replaceAll(`from "./${other}.meeko"`, `from "./${other}.ts"`);
      await writeFile(join(directory, `${name}.ts`), code);
    }
    const page = await import(pathToFileURL(join(directory, "Page.ts")).href) as {
      renderWithState(props: object): { html: string; state: Record<string, unknown> };
      hydrate(root: Element, props: object, state: Record<string, unknown>): () => void;
    };
    const rendered = page.renderWithState({});
    assert.match(rendered.html, /<button[^>]* title="a"/);
    // Enumerated, the rest has no callback: not that of the event, nor one of the wrapper's own props.
    assert.match(rendered.html, /<s[^>]*>(?:<!--[^>]*-->)?label,tone/);
    const root = window.document.createElement("div");
    root.innerHTML = rendered.html;
    const release = page.hydrate(root as unknown as Element, {}, rendered.state);
    const button = root.querySelector("button") as unknown as HTMLElement;
    button.click();
    assert.equal(root.querySelector("b")!.textContent, "2");
    (root.querySelector("u") as unknown as HTMLElement).click();
    assert.equal(button.getAttribute("title"), "b");
    release();
    // Released: neither the rest nor the listener follow.
    (root.querySelector("u") as unknown as HTMLElement).click();
    button.click();
    assert.equal(root.querySelector("b")!.textContent, "2");
  } finally {
    window.happyDOM.abort();
    await rm(directory, { recursive: true, force: true });
  }
});
