import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { activateRouteManifest, createRouteManifest } from "../src/app/runtime/router.ts";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/parser/sfc.ts";
import { checkApp } from "../src/framework/check-app.ts";
import { prepareFrameworkTypeDeclarations } from "../src/framework/type-declarations.ts";
import { polymorphicButton } from "./helpers/polymorphic-button.ts";
import { createTempProject } from "./helpers/temp-project.ts";

interface RuntimeModule {
  renderToString(props: Record<string, unknown>): string;
  renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> };
  hydrate(root: Element, props: Record<string, unknown>, state?: Record<string, unknown>): () => void;
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

/** Compiles components inside the repository; the runtime is imported by file URL, as one instance. */
async function load(components: Record<string, string>, entry: string): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "is-names-test-"));
  for (const [name, source] of Object.entries(components)) {
    let code = compile(source, join(directory, `${name}.meeko`)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko/framework"`, `from ${runtime("src/framework.ts")}`)
      .replace(`from "@meekojs/meeko/navigation"`, `from ${runtime("src/app/runtime/navigation.ts")}`)
      .replace(`from "@meekojs/meeko/builtins/link"`, `from ${runtime("src/builtins/link.compiled.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
    for (const other of Object.keys(components)) code = code.replace(`from "./${other}.meeko"`, `from "./${other}.ts"`);
    await writeFile(join(directory, `${name}.ts`), code);
  }
  const component = await import(pathToFileURL(join(directory, `${entry}.ts`)).href) as RuntimeModule;
  return { component, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

async function typeProject(files: Record<string, string>): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parentDirectory = resolve(".meeko");
  await mkdir(parentDirectory, { recursive: true });
  const root = await mkdtemp(join(parentDirectory, "is-names-check-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      types: ["node"],
      paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko/framework": ["../../src/framework.ts"], "@meekojs/meeko": ["../../src/index.ts"] },
    },
  })}\n`);
  for (const [name, source] of Object.entries(files)) await writeFile(join(root, name), source);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function assertCompileError(source: string, code: string, offset: number, options: Parameters<typeof compile>[2] = {}): MeekoCompileError {
  let caught: MeekoCompileError | undefined;
  assert.throws(() => compile(source, "Named.meeko", options), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, code, error.message);
    assert.equal(error.diagnostic.location.offset, offset, error.message);
    caught = error;
    return true;
  });
  return caught!;
}

/** A card component of the project, in the union of `is` next to an HTML tag. */
const card = `<script lang="ts">
const props = defineProps<{ heading: string; tone?: "info" | "warn" }>();
const snippets = defineSnippets<{ default?: [] }>();
</script>
<template><article class="card" bind:data-tone="props.tone"><h2>{props.heading}</h2><render snippet="snippets.default" /></article></template>`;

/** The polymorphic button of docs/api.md with one template: a route, an external link or a button. */
const button = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ to?: string; href?: string; type?: "button" | "submit" }>();
const clicks = signal(0);
</script>
<template><component is="props.to !== undefined ? 'MeekoLink' : props.href !== undefined ? 'a' : 'button'" class="button" bind:to="props.to" bind:href="props.href" bind:type="props.type ?? 'button'" title="Abrir" on:click="() => clicks.value++"><span class="label">Abrir</span><b class="clicks">{clicks.value}</b></component></template>`;

const strip = (html: string): string => html.replace(/<!--\/?meeko:[^>]*-->/g, "");

test("a name in is compiles each branch on its own: <MeekoLink> builds its href, the tags take their attributes", () => {
  const { code } = compile(button, "Button.meeko");
  // One if:when region per branch, whose condition is the path of ?: to its literals.
  assert.match(code, /__meeko\.renderIf\(\d+, \(\(!!\(props\.to !== undefined\)\)\), \(\) => "<a"/);
  assert.match(code, /__meeko\.renderIf\(\d+, \(\(!\(props\.to !== undefined\) && !!\(props\.href !== undefined\)\) \|\| \(!\(props\.to !== undefined\) && !\(props\.href !== undefined\)\)\)/);
  // The link builds its href with the typed href() and never receives href nor type.
  assert.match(code, /__meeko\.renderAttribute\("href", __meeko\.linkHref\(__meeko_links, \(props\.to\), __meeko_href\(props\.to, \{ {2}\}\)\)\)/);
  assert.doesNotMatch(code, /"<a"[^]*?renderAttribute\("href", props\.href\)/);
  // The branch of tags leaves the names out of the value of is.
  assert.match(code, /__meeko\.tagBranch\(props\.to !== undefined \? 'MeekoLink' : props\.href !== undefined \? 'a' : 'button', \["MeekoLink"\], "a"\)/);
  assert.match(code, /__meeko\.tagAttribute\(__meeko_tag_\d+, "href", \["a"\]\)/);
  assert.match(code, /__meeko\.tagAttribute\(__meeko_tag_\d+, "type", \["button"\]\)/);
});

/** A page that provides a fixed route, as the framework does, and switches the props of the button. */
const buttonPage = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import { fixedRoute, provideRoute, routeSnapshot } from "@meekojs/meeko/navigation";
import * as Button from "./Button.meeko";
const props = defineProps<{ initial?: "route" | "link" | "button" }>();
provideRoute(fixedRoute(routeSnapshot(new URL("https://meeko.test/docs"), "/docs", {}, {}, false)));
const mode = signal(props.initial ?? "route");
</script>
<template><main><Button bind:to="mode.value === 'route' ? '/docs' : undefined" bind:href="mode.value === 'link' ? 'https://example.com' : undefined" type="submit" /><i class="route" on:click="() => mode.value = 'route'"></i><i class="link" on:click="() => mode.value = 'link'"></i><i class="plain" on:click="() => mode.value = 'button'"></i></main></template>`;

/** The manifest of `href(id)`, as a running application supplies it. */
const routes = createRouteManifest([{ id: "/docs", file: "docs.meeko", layouts: [] }]);

test("the button renders <MeekoLink>, <a> or <button> in SSR, each with only its attributes", async () => {
  const { component, cleanup } = await load({ Button: button, Page: buttonPage }, "Page");
  const manifest = activateRouteManifest(routes);
  try {
    const rendered = (initial: string): string => strip(component.renderToString({ initial })).replace(/^<main>|<i [^]*$/g, "");
    // The route's <a>: href from href(), aria-current on the current route; neither type nor a written href.
    assert.equal(rendered("route"), '<a class="button" title="Abrir" href="/docs" aria-current="page" data-meeko="0"><span class="label">Abrir</span><b class="clicks">0</b></a>');
    assert.equal(rendered("link"), '<a class="button" href="https://example.com" title="Abrir" data-meeko="1"><span class="label">Abrir</span><b class="clicks">0</b></a>');
    assert.equal(rendered("button"), '<button class="button" type="submit" title="Abrir" data-meeko="1"><span class="label">Abrir</span><b class="clicks">0</b></button>');
  } finally {
    manifest();
    await cleanup();
  }
});

test("the button hydrates and goes from <MeekoLink> to <a> and <button> and back, with its events", async () => {
  const { component, cleanup } = await load({ Button: button, Page: buttonPage }, "Page");
  const window = new Window({ url: "https://meeko.test/" });
  const manifest = activateRouteManifest(routes);
  try {
    const root = window.document.createElement("div");
    window.document.body.appendChild(root);
    const rendered = component.renderWithState({});
    root.innerHTML = rendered.html;
    const element = (): HTMLElement => root.querySelector(".button") as unknown as HTMLElement;
    const click = (selector: string): void => (root.querySelector(selector) as unknown as HTMLElement).click();
    const first = element();
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    // Hydration keeps the server's <a> of the route.
    assert.equal(element(), first);
    assert.equal(first.tagName, "A");
    assert.equal(first.getAttribute("href"), "/docs");
    first.addEventListener("click", (event) => event.preventDefault());
    click(".button");
    assert.equal(element().querySelector(".clicks")!.textContent, "1");
    click(".link");
    assert.equal(element().tagName, "A");
    assert.equal(element().getAttribute("href"), "https://example.com");
    assert.equal(element().hasAttribute("type"), false);
    click(".plain");
    assert.equal(element().tagName, "BUTTON");
    assert.equal(element().getAttribute("type"), "submit");
    assert.equal(element().hasAttribute("href"), false);
    click(".button");
    assert.equal(element().querySelector(".clicks")!.textContent, "2", "every branch reads the same state");
    click(".link");
    assert.equal(element().tagName, "A");
    click(".route");
    assert.equal(element().getAttribute("href"), "/docs");
    assert.equal(root.querySelectorAll(".button").length, 1);
    release();
  } finally {
    manifest();
    await window.happyDOM.close();
    await cleanup();
  }
});

/** `<MeekoLink>` as the component that `resolveComponent("MeekoLink")` loads, passed to `is` as a value. */
const linkPage = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import { fixedRoute, provideRoute, routeSnapshot } from "@meekojs/meeko/navigation";
import * as MeekoLinkComponent from "@meekojs/meeko/builtins/link";
provideRoute(fixedRoute(routeSnapshot(new URL("https://meeko.test/docs"), "/docs", {}, {}, false)));
const clicks = signal(0);
</script>
<template><main><component is="MeekoLinkComponent" to="/docs" class="nav" title="Docs" on:click="(event) => { event.preventDefault(); clicks.value++ }">Docs</component><p class="clicks">{clicks.value}</p></main></template>`;

test("the component of resolveComponent(\"MeekoLink\") renders and hydrates the <a> of the tag", async () => {
  const { component, cleanup } = await load({ Page: linkPage }, "Page");
  const window = new Window({ url: "https://meeko.test/docs" });
  const manifest = activateRouteManifest(routes);
  try {
    const rendered = component.renderWithState({});
    assert.match(strip(rendered.html), /<a class="nav" title="Docs" href="\/docs" aria-current="page" data-meeko="0">Docs<\/a>/);
    const root = window.document.createElement("div");
    window.document.body.appendChild(root);
    root.innerHTML = rendered.html;
    const anchor = root.querySelector("a")!;
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    assert.equal(root.querySelector("a"), anchor);
    (anchor as unknown as HTMLElement).click();
    assert.equal(root.querySelector(".clicks")!.textContent, "1");
    release();
  } finally {
    manifest();
    await window.happyDOM.close();
    await cleanup();
  }
});

/** A page at `/docs` that provides the route, as the framework does, around the links of `Links`. */
const currentPage = `<script lang="ts">
import { fixedRoute, provideRoute, routeSnapshot } from "@meekojs/meeko/navigation";
import * as Links from "./Links.meeko";
const props = defineProps<{ initial: number }>();
provideRoute(fixedRoute(routeSnapshot(new URL("https://meeko.test/docs"), "/docs", {}, {}, false)));
</script>
<template><main><Links bind:initial="props.initial" /></main></template>`;

/** Every way to give a link its own aria-current, all with the value of one signal. */
const currentLinks = `<script lang="ts">
import { computed, signal } from "@meekojs/meeko";
import * as MeekoLinkComponent from "@meekojs/meeko/builtins/link";
const props = defineProps<{ initial: number }>();
// What resolveComponent("MeekoLink") gives: in lowercase, a value of \`is\` decided at run time.
const resolvedLink = MeekoLinkComponent;
const values = ["step", false, undefined, null, "location"] as const;
const index = signal(props.initial);
const value = computed(() => values[index.value]);
const attrs = computed(() => ({ "aria-current": value.value }));
const isLink = signal(true);
</script>
<template><nav>
<MeekoLink to="/docs" class="plain">Sin propio</MeekoLink>
<MeekoLink to="/about" class="other">Otra ruta</MeekoLink>
<MeekoLink to="/docs" aria-current="date" class="written">Escrito</MeekoLink>
<MeekoLink to="/docs" class="bound" bind:aria-current="value.value">Bind</MeekoLink>
<MeekoLink to="/about" class="bound-other" bind:aria-current="value.value">Bind, otra ruta</MeekoLink>
<MeekoLink to="/docs" class="spread" bind="attrs.value">Spread</MeekoLink>
<MeekoLink to="/docs" class="both" bind="{ 'aria-current': 'date' }" bind:aria-current="value.value">Los dos</MeekoLink>
<component is="'MeekoLink'" to="/docs" class="is-bound" bind:aria-current="value.value">is</component>
<component is="'MeekoLink'" to="/docs" class="is-spread" bind="attrs.value">is, spread</component>
<component is="isLink.value ? 'MeekoLink' : 'a'" bind:to="isLink.value ? '/docs' : undefined" bind:href="isLink.value ? undefined : '/x'" class="branch" bind:aria-current="value.value">Rama</component>
<component is="MeekoLinkComponent" to="/docs" class="resolved" bind:aria-current="value.value">Componente</component>
<component is="MeekoLinkComponent" to="/docs" class="resolved-plain">Componente sin propio</component>
<component is="MeekoLinkComponent" to="/docs" aria-current="date" class="resolved-written">Componente escrito</component>
<component is="resolvedLink" to="/docs" class="runtime" bind:aria-current="value.value" data-kind="enlace">Valor</component>
<component is="resolvedLink" to="/docs" class="runtime-plain">Valor sin propio</component>
<component is="resolvedLink" to="/docs" class="runtime-written" aria-current="date">Valor escrito</component>
<component is="resolvedLink" to="/docs" class="runtime-spread" bind="attrs.value">Valor en spread</component>
<i class="next" on:click="() => index.value = (index.value + 1) % values.length"></i>
<i class="to-a" on:click="() => isLink.value = false"></i>
</nav></template>`;

/** What each link of `currentPage` must show for each value of the signal. */
function expectedCurrent(value: string | false | null | undefined): Record<string, string | null> {
  const own = (route: string | null): string | null => value === false ? null : value ?? route;
  return {
    plain: "page",
    other: null,
    written: "date",
    bound: own("page"),
    "bound-other": own(null),
    spread: own("page"),
    both: own("page"),
    "is-bound": own("page"),
    "is-spread": own("page"),
    branch: own("page"),
    resolved: own("page"),
    "resolved-plain": "page",
    "resolved-written": "date",
    runtime: own("page"),
    "runtime-plain": "page",
    "runtime-written": "date",
    "runtime-spread": own("page"),
  };
}

test("an aria-current of its own wins over the route in SSR, hydration and updates, in every form of the link", async () => {
  const { component, cleanup } = await load({ Page: currentPage, Links: currentLinks }, "Page");
  const window = new Window({ url: "https://meeko.test/docs" });
  const manifest = activateRouteManifest(createRouteManifest([{ id: "/docs", file: "docs.meeko", layouts: [] }, { id: "/about", file: "about.meeko", layouts: [] }]));
  const values = ["step", false, undefined, null, "location"] as const;
  try {
    for (let initial = 0; initial < values.length; initial++) {
      const rendered = component.renderWithState({ initial });
      assert.doesNotMatch(rendered.html, /<a [^>]*aria-current="[^"]*"[^>]*aria-current=/, "one attribute per link");
      const root = window.document.createElement("div");
      window.document.body.appendChild(root);
      root.innerHTML = rendered.html;
      const check = (index: number, moment: string): void => {
        for (const [name, current] of Object.entries(expectedCurrent(values[index % values.length]))) {
          assert.equal(root.querySelector(`.${name}`)!.getAttribute("aria-current"), current, `${name}, ${moment}, initial ${String(values[initial])}`);
        }
      };
      check(initial, "SSR");
      assert.equal(root.querySelector(".runtime")!.getAttribute("data-kind"), "enlace", "any aria-* or data-* reaches a component value, as on its tag");
      const anchors = [...root.querySelectorAll("a")];
      // A mismatch throws here: both sides must agree for every value.
      const release = component.hydrate(root as unknown as Element, { initial }, rendered.state);
      assert.deepEqual([...root.querySelectorAll("a")], anchors, "hydration keeps the server's links");
      check(initial, "hydrated");
      for (let step = 1; step <= values.length; step++) {
        (root.querySelector(".next") as unknown as HTMLElement).click();
        check(initial + step, `update ${step}`);
      }
      // The <a> branch of is writes the attribute with no route.
      (root.querySelector(".to-a") as unknown as HTMLElement).click();
      assert.equal(root.querySelector(".branch")!.getAttribute("href"), "/x");
      assert.equal(root.querySelector(".branch")!.getAttribute("aria-current"), values[initial] || null);
      release();
      root.remove();
    }
  } finally {
    manifest();
    await window.happyDOM.close();
    await cleanup();
  }
});

const cardHost = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Card from "./Card.meeko";
const big = signal(true);
const label = signal("Hola");
</script>
<template><main><component is="big.value ? 'Card' : 'section'" class="host" bind:heading="label.value" tone="warn" id="box"><p class="body">{label.value}</p></component><i class="toggle" on:click="() => big.value = !big.value"></i><i class="relabel" on:click="() => label.value = 'Adiós'"></i></main></template>`;

test("a component of the project in the union of is gets its props; the tag, its attributes", async () => {
  const { component, cleanup } = await load({ Card: card, Host: cardHost }, "Host");
  const window = new Window({ url: "https://meeko.test/" });
  try {
    // SSR: the component with its props, without the attributes of the tag.
    const bare = strip(component.renderToString({}));
    assert.match(bare, /^<main><article class="card" data-tone="warn" data-meeko="0"><h2>Hola<\/h2><p class="body">Hola<\/p><\/article>/);
    const root = window.document.createElement("div");
    window.document.body.appendChild(root);
    const rendered = component.renderWithState({});
    root.innerHTML = rendered.html;
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    const click = (selector: string): void => (root.querySelector(selector) as unknown as HTMLElement).click();
    click(".relabel");
    assert.equal(root.querySelector("article h2")!.textContent, "Adiós");
    click(".toggle");
    // The tag: global attributes, its content and no prop of the card.
    const section = root.querySelector("section")!;
    assert.equal(section.getAttribute("class"), "host");
    assert.equal(section.getAttribute("id"), "box");
    assert.equal(section.hasAttribute("tone"), false);
    assert.equal(section.querySelector(".body")!.textContent, "Adiós");
    assert.equal(root.querySelector("article"), null);
    click(".toggle");
    assert.equal(root.querySelector("article h2")!.textContent, "Adiós");
    assert.equal(root.querySelector("section"), null);
    release();
  } finally {
    await window.happyDOM.close();
    await cleanup();
  }
});

test("a single name is that tag, and a value next to names, an unknown name or a ref on several branches are compile errors", () => {
  // `'MeekoLink'` alone is <MeekoLink>.
  const single = compile('<template><component is="\'MeekoLink\'" to="/about">Acerca</component></template>', "Single.meeko");
  assert.match(single.code, /renderAttribute\("href", __meeko\.linkHref\(__meeko_links, "\/about", "\/about"\)\)/);
  assert.doesNotMatch(single.code, /renderIf/);
  // A name the project does not have: MEEK132 on its literal, with the rule of the case.
  const unknown = '<template><component is="x ? \'UIMissing\' : \'a\'">x</component></template>';
  const error = assertCompileError(unknown, "MEEK132", unknown.indexOf("'UIMissing'"), { projectComponents: [] });
  assert.match(error.message, /minúscula.*PascalCase/);
  // Without the project's autoimports the compiler cannot know: meeko check reports the name.
  assert.doesNotThrow(() => compile(unknown, "Named.meeko"));
  // An autoimported component is known.
  assert.doesNotThrow(() => compile(unknown, "Named.meeko", { projectComponents: ["UIMissing"] }));
  // With names, every result is a literal.
  const mixed = '<template><component is="x ? \'MeekoLink\' : tag" to="/">x</component></template>';
  assertCompileError(mixed, "MEEK132", mixed.indexOf("tag\""));
  // <MeekoOutlet> and <MeekoTeleport> render nothing of their own.
  const outlet = '<template><component is="x ? \'MeekoTeleport\' : \'div\'">x</component></template>';
  assertCompileError(outlet, "MEEK132", outlet.indexOf("'MeekoTeleport'"));
  // A ref names one place: with several branches it goes inside each one.
  const ref = '<template><component is="x ? \'MeekoLink\' : \'a\'" to="/" ref:link>x</component></template>';
  assertCompileError(ref, "MEEK052", ref.indexOf("ref:link"));
  // `<MeekoLink>` builds its href: to is required in its branch.
  const noTo = '<template><component is="x ? \'MeekoLink\' : \'button\'">x</component></template>';
  assertCompileError(noTo, "MEEK105", noTo.indexOf("'MeekoLink'"));
});

test("an HTML tag is lowercase and a component PascalCase: 'button' is the tag, 'Button' the component", () => {
  const source = `<script lang="ts">
import * as Button from "./Button.meeko";
</script>
<template><component is="x ? 'Button' : 'button'" type="submit">x</component></template>`;
  const { code } = compile(source, "Case.meeko");
  assert.match(code, /__meeko\.renderComponent<any>\(\d+, Button, __meeko\.branchTag\(\(\) => Button\)/);
  assert.match(code, /__meeko\.tagBranch\([^)]*\["Button"\], "button"\)/);
});

test("meeko check checks each branch with its props, narrowed by its condition", { timeout: 120_000 }, async () => {
  const host = (template: string): string => `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Card from "./Card.meeko";
const props = defineProps<{ kind: "card" | "section" | "link"; heading?: string }>();
const label = signal("x");
void label;
</script>
<template>${template}</template>`;
  const { root, cleanup } = await typeProject({ "Card.meeko": card, "Host.meeko": host("<p>x</p>") });
  const check = async (template: string): Promise<string[]> => {
    await writeFile(join(root, "Host.meeko"), host(template));
    return (await checkSource(host(template), join(root, "Host.meeko"))).map((item) => `${item.code}: ${item.message}`);
  };
  try {
    // The card takes its props; the section takes the attributes of HTML; a narrowed prop is valid.
    assert.deepEqual(await check(`<component is="props.kind === 'card' ? 'Card' : 'section'" bind:heading="props.kind === 'card' ? props.heading ?? '' : ''" tone="info" id="x" class="y">z</component>`), []);
    // The condition narrows the branch: inside 'Card', props.heading may still be undefined.
    const narrowed = await check(`<component is="props.heading !== undefined ? 'Card' : 'section'" bind:heading="props.heading">z</component>`);
    assert.deepEqual(narrowed, []);
    // A prop of the card with a wrong value: the card's own type check.
    const wrong = await check(`<component is="props.kind === 'card' ? 'Card' : 'section'" bind:heading="1">z</component>`);
    assert.ok(wrong.some((item) => /^TS2322:/.test(item)), JSON.stringify(wrong));
    // An attribute that no branch takes: neither a tag nor the card accepts it.
    const nowhere = await check(`<component is="props.kind === 'card' ? 'Card' : 'section'" heading="h" colour="red">z</component>`);
    assert.ok(nowhere.some((item) => /^MEEK112: colour no se aplica a ninguna rama de is/.test(item)), JSON.stringify(nowhere));
    // A prop that is the card's only: it never reaches the <section>.
    assert.deepEqual(await check(`<component is="props.kind === 'card' ? 'Card' : 'section'" heading="h" tone="warn">z</component>`), []);
    // A name that is no component of the project: MEEK132 on the literal.
    const missing = await check(`<component is="props.kind === 'card' ? 'Missing' : 'section'">z</component>`);
    assert.ok(missing.some((item) => /^MEEK132: 'Missing' no es una etiqueta HTML ni un componente conocido/.test(item)), JSON.stringify(missing));
  } finally {
    await cleanup();
  }
});

test("meeko check types the polymorphic button with one template: the route and params of 'MeekoLink', href and type of the tags", { timeout: 180_000 }, async () => {
  const project = await createTempProject("is-names-polymorphic-check");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await mkdir(join(root, "app", "components"), { recursive: true });
    await mkdir(join(root, "app", "pages", "users"), { recursive: true });
    await writeFile(join(root, "app", "pages", "about.meeko"), "<template><h1>Acerca</h1></template>\n");
    await writeFile(join(root, "app", "pages", "users", "[id].meeko"), "<template><h1>Usuario</h1></template>\n");
    await writeFile(join(root, "app", "components", "AppButton.meeko"), polymorphicButton);
    const page = join(root, "app", "pages", "index.meeko");
    const check = async (uses: string, script = ""): Promise<string[]> => {
      await writeFile(page, `<script lang="ts">\nconst id = signal("7");\nconst busy = signal(false);\n${script}\n</script>\n<template>${uses}</template>\n`);
      return (await checkApp(root)).map((item) => `${item.code}: ${item.message}`);
    };
    await prepareFrameworkTypeDeclarations(root);
    // The component itself checks: each branch is narrowed by its condition, so params and to are those of the route.
    const valid = '<AppButton to="/about" label="Acerca" title="Ir" data-kind="internal" />'
      + '<AppButton bind:to="\'/users/[id]\'" bind:params="{ id: id.value }" bind:search="{ tab: \'x\' }" aria-label="Perfil">Perfil</AppButton>'
      + '<AppButton href="https://example.com" target="_blank" label="Externo" id="ext" />'
      + '<AppButton type="submit" label="Enviar" bind:aria-busy="busy.value" />';
    assert.deepEqual(await check(valid), []);
    const wrong: Array<[string, RegExp]> = [
      ['<AppButton to="/nowhere" />', /^TS2322:.*\/nowhere/],
      ['<AppButton bind:to="\'/users/[id]\'" />', /^TS2345:/],
      ['<AppButton to="/about" href="/x" />', /^TS2345:/],
      ['<AppButton href="/x" type="submit" />', /^TS2322:/],
    ];
    for (const [uses, message] of wrong) {
      const diagnostics = await check(uses);
      assert.ok(diagnostics.some((item) => message.test(item)), `${uses}: ${JSON.stringify(diagnostics)}`);
    }
    // In a page: the route and params of the 'MeekoLink' branch are checked like those of <MeekoLink>.
    const inline = (attributes: string): string => `<component is="busy.value ? 'MeekoLink' : 'button'" ${attributes}>x</component>`;
    assert.deepEqual(await check(inline('to="/users/[id]" bind:params="{ id: id.value }" type="button"')), []);
    const route = await check(inline('to="/nowhere"'));
    assert.ok(route.some((item) => /\/nowhere/.test(item)), JSON.stringify(route));
    const params = await check(inline('to="/users/[id]"'));
    assert.ok(params.some((item) => /^TS2345:/.test(item)), JSON.stringify(params));
    // href belongs to <a>: neither <MeekoLink> nor <button> takes it.
    const href = await check(inline('to="/about" href="/x"'));
    assert.ok(href.some((item) => /^MEEK112: href no se aplica a ninguna rama de is/.test(item)), JSON.stringify(href));
    // An autoimported component in the union, by its name, with its props.
    assert.deepEqual(await check('<component is="busy.value ? \'AppButton\' : \'section\'" to="/about" id="x">x</component>'), []);
    // An aria-current of its own, in every form of the link: a value, false or undefined.
    const current = (value: string): string => `<MeekoLink to="/about" bind:aria-current="${value}">a</MeekoLink>`
      + `<MeekoLink to="/about" bind="{ 'aria-current': ${value} }">b</MeekoLink>`
      + `<component is="busy.value ? 'MeekoLink' : 'a'" to="/about" bind:aria-current="${value}">c</component>`
      + `<component is="MeekoLinkComponent" to="/about" bind:aria-current="${value}">d</component>`;
    const componentImport = 'import * as MeekoLinkComponent from "@meekojs/meeko/builtins/link";';
    for (const value of ["'page'", "false", "undefined", "busy.value ? 'step' : false"]) {
      assert.deepEqual(await check(`<MeekoLink to="/about" aria-current="step">w</MeekoLink>${current(value)}`, componentImport), [], value);
    }
    // The value of the standard is still checked on the link (MEEK122), as on any <a>.
    const wrongValue = await check('<MeekoLink to="/about" bind:aria-current="\'nope\'">x</MeekoLink>');
    assert.ok(wrongValue.some((item) => /^MEEK122:.*nope/.test(item)), JSON.stringify(wrongValue));
    const wrongWritten = await check('<MeekoLink to="/about" aria-current="nope">x</MeekoLink>');
    assert.ok(wrongWritten.some((item) => /^MEEK122:.*nope/.test(item)), JSON.stringify(wrongWritten));
    // A written aria-current does not hide a wrong match or route from the type check.
    const wrongMatch = await check('<MeekoLink to="/about" aria-current="step" bind:match="\'other\'">x</MeekoLink>');
    assert.ok(wrongMatch.some((item) => /^TS2345:.*other/.test(item)), JSON.stringify(wrongMatch));
  } finally {
    await project.remove();
  }
});