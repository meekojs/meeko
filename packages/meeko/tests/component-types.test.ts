import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

import { builtinTagTypes, discoverAutoImports, discoverAutoImportsSync } from "../src/autoimports/registry.ts";
import { applyAutoImports } from "../src/autoimports/transform.ts";
import { generateAutoImportTypes } from "../src/autoimports/typescript.ts";
import { checkApp } from "../src/framework/check-app.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { builtinTags } from "../src/language-server/builtin-tags.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

async function put(root: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
}

/** The card and the modal of a real application: the modal reuses the card's snippets. */
const card = `<script lang="ts">
const props = defineProps<{ title?: string }>();
const snippets = defineSnippets<{ header?: []; default: []; footer?: [] }>();
const open = defineModel<boolean>("open", { default: true });
function toggle(): void { open.value = !open.value; }
defineExpose({ toggle });
</script>
<template><article if:when="open.value"><h2 if:when="props.title">{props.title}</h2><header if:when="snippets.header"><render snippet="snippets.header" /></header><render snippet="snippets.default" /><footer if:when="snippets.footer"><render snippet="snippets.footer" /></footer></article></template>
`;

const modal = (snippets: string, imports = ""): string => `<script lang="ts">
${imports}const props = defineProps<AppCardProps & { label: string }>();
const open = defineModel<boolean>({ default: true });
const snippets = defineSnippets<${snippets}>();
function close(): void { open.value = false; }
</script>
<template><dialog bind:open="open.value" bind:aria-label="props.label"><AppCard bind:title="props.title"><snippet name="header" if:when="snippets.header"><render snippet="snippets.header" /></snippet><render snippet="snippets.default" /><snippet name="footer" if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></snippet></AppCard></dialog></template>
`;

const plain = `<script lang="ts">
const label = "plain";
</script>
<template><p>{label}</p></template>
`;

const uiModule = `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({
  meta: { name: "ui" },
  setup(_options, meeko) {
    meeko.addComponentsDir(new URL("./components", import.meta.url), { prefix: "Ui" });
  },
});
`;

const uiButton = `<script lang="ts">
const props = defineProps<{ tone: "neutral" | "accent" }>();
</script>
<template><button bind:data-tone="props.tone">ok</button></template>
`;

test("each autoimported component gives its Props, Snippets, Models and Exposed types, with module prefixes and project types first", { timeout: 300_000 }, async (context) => {
  const root = await tempProject(context, "component-types");
  await linkRepositoryPackages(root);
  await put(root, {
    "package.json": '{"private":true,"type":"module"}\n',
    "meeko.config.ts": 'import ui from "./modules/ui/index.ts";\nexport default { modules: [ui] };\n',
    "modules/ui/index.ts": uiModule,
    "modules/ui/components/Button.meeko": uiButton,
    "app/components/App/Card.meeko": card,
    "app/components/App/Modal.meeko": modal('Omit<AppCardSnippets, "footer"> & { actions?: [close: () => void] }'),
    "app/components/Plain.meeko": plain,
    // A project type with the name of a component type wins over it.
    "app/types/plain.ts": "export interface PlainProps { readonly custom: true }\n",
    "app/pages/index.meeko": `<script lang="ts">
import { signal } from "@meekojs/meeko";
const open = signal(true);
const tone: UiButtonProps["tone"] = "accent";
const own: PlainProps = { custom: true };
const none: [PlainSnippets, PlainModels, PlainExposed] = [null, null, null];
const card: AppCardProps = { title: "Card" };
const models: keyof AppCardModels = "open";
const ref: AppCardExposed | undefined = undefined;
const header: NonNullable<AppModalSnippets["header"]> | undefined = undefined;
</script>
<template><AppModal label="Hi" model="open"><p>Body {tone} {String(own.custom)} {String(none[0])} {card.title} {models} {String(ref)} {String(header)}</p><snippet name="actions" params="close"><button on:click="close">Close</button></snippet></AppModal><UiButton tone="neutral" /></template>
`,
    "app/utils/card.ts": "export function cardTitle(props: AppCardProps): string { return props.title ?? \"\"; }\n",
  });

  const registry = await discoverAutoImports(root);
  const entry = (name: string) => registry.filter((item) => item.name === name);
  const cardFile = join(root, "app", "components", "App", "Card.meeko");
  for (const [suffix, imported] of [["Props", "__MeekoPropsOnly"], ["Emits", "ComponentEmits"], ["Snippets", "ComponentSnippets"], ["Models", "ComponentModels"], ["Exposed", "ComponentExposed"]] as const) {
    assert.deepEqual(entry(`AppCard${suffix}`), [{ name: `AppCard${suffix}`, imported, file: cardFile, scope: "app", typeOnly: true, component: false, componentType: true }]);
  }
  assert.deepEqual(entry("UiButtonProps").map((item) => item.file), [join(root, "modules", "ui", "components", "Button.meeko")]);
  assert.deepEqual(entry("PlainProps").map((item) => item.file), [join(root, "app", "types", "plain.ts")]);
  assert.equal(entry("PlainSnippets").length, 1);
  // The static registry of the editor names the project's components the same way.
  assert.ok(discoverAutoImportsSync(root).some((item) => item.name === "AppCardSnippets" && item.componentType));

  // A component's script and template import them as types, from the component's module.
  const imported = applyAutoImports("type S = AppCardSnippets;\n", join(root, "app", "pages", "x.meeko"), registry, "client");
  assert.match(imported, /^import type \{ ComponentSnippets as AppCardSnippets \} from "\.\.\/components\/App\/Card\.meeko";$/m);
  assert.throws(() => applyAutoImports("type S = AppCardSnippets;\n", join(root, "shared", "utils", "x.ts"), registry, "shared"), /AppCardSnippets no está disponible en el ámbito shared/);

  // Global declarations for app/ (and every scope that sees components), never for shared/.
  const declarations = await generateAutoImportTypes(root);
  const client = await readFile(declarations.client, "utf8");
  assert.match(client, /export import AppCardSnippets = (__meeko_type_\d+)\.ComponentSnippets;/);
  const namespace = /export import AppCardSnippets = (__meeko_type_\d+)\./.exec(client)![1]!;
  assert.match(client, new RegExp(`^import \\* as ${namespace} from "\\.\\./\\.\\./\\.\\./app/components/App/Card\\.meeko";$`, "m"));
  assert.match(client, /export import UiButtonProps = __meeko_type_\d+\.__MeekoPropsOnly;/);
  assert.match(client, /export import PlainProps = __meeko_type_\d+\.PlainProps;/);
  assert.doesNotMatch(await readFile(declarations.shared, "utf8"), /AppCard/);

  // `meeko check`: components, pages and app/ modules type-check with them.
  assert.deepEqual((await checkFrameworkProject(root)).map((item) => `${item.code}: ${item.message}`), []);

  // Used where its component is not available, the name is not known.
  await put(root, { "shared/utils/card.ts": "export function sharedTitle(props: AppCardProps): string { return props.title ?? \"\"; }\n" });
  await assert.rejects(checkFrameworkProject(root), /shared[\\/]utils[\\/]card\.ts.*TS2304.*AppCardProps/s);
  await rm(join(root, "shared"), { recursive: true });

  // The modal of the application, also with the generic name imported from the card's module.
  await put(root, { "app/components/App/Modal.meeko": modal('Omit<CardSnippets, "footer"> & { actions?: [close: () => void] }', 'import type { ComponentSnippets as CardSnippets } from "./Card.meeko";\n') });
  assert.deepEqual((await checkApp(root)).map((item) => `${item.filename}: ${item.code}: ${item.message}`), []);

  // The page passes the modal's snippets with the parameters the card and the modal declare.
  const page = await readFile(join(root, "app", "pages", "index.meeko"), "utf8");
  await put(root, { "app/pages/index.meeko": page.replace('<snippet name="actions" params="close">', '<snippet name="footer">x</snippet><snippet name="actions" params="close, extra">') });
  const wrong = await checkApp(root);
  assert.ok(wrong.some((item) => item.code === "TS2353" && /footer/.test(item.message)), JSON.stringify(wrong));
  assert.ok(wrong.some((item) => item.code === "TS2345"), JSON.stringify(wrong));
});

/**
 * What `meeko types` of the published `@meekojs/meeko@1.7.1` writes for a component with props, events,
 * a model, snippets and `defineExpose`, as it is: the declaration that a package published with it ships.
 */
const declaration171 = `// @meeko-generated component-declaration v1
import * as __meeko from "@meekojs/meeko/internal";
type __MeekoEmits = __meeko.Emits<{
    press: [event: MouseEvent];
}>;
type __MeekoEmitProps = __meeko.EmitProps<__MeekoEmits>;
type __MeekoDeclaredProps = {
    label: string;
    tone?: "neutral" | "danger";
};
export type ComponentProps = __MeekoDeclaredProps & __MeekoEmitProps;
declare function __setup(__props: ComponentProps): {
    [__meeko.exposedKey]: any;
    [__meeko.borrowedKey]: any;
    props: Readonly<{
        label: string;
        tone?: "neutral" | "danger";
    }>;
    emit: __meeko.Emit<__meeko.Emits<{
        press: [event: MouseEvent];
    }>>;
    open: __meeko.Signal<boolean>;
    snippets: __meeko.SnippetMap<__meeko.SnippetTypes<{
        default: [];
    }>>;
};
export type ComponentExposed = ReturnType<typeof __setup>[typeof __meeko.exposedKey];
type __MeekoModels = {
    "default": boolean;
};
export type ComponentModels = {
    "default"?: __meeko.Signal<__MeekoModels["default"]>;
};
type __MeekoSnippets = __meeko.SnippetTypes<{
    default: [];
}>;
export type ComponentSnippets = __meeko.SnippetMap<__MeekoSnippets>;
export declare const __meekoChannels: {
    readonly models: ComponentModels;
    readonly snippets: ComponentSnippets;
};
type __MeekoTagProps<P> = P extends unknown ? {
    [K in keyof P]: {} extends Record<K, unknown> ? P[K] : {} extends Pick<P, K> ? P[K] | undefined : P[K];
} : never;
export declare const __meekoTag: (props: __MeekoTagProps<ComponentProps> & __meeko.ExtraProps, events: NoInfer<__meeko.EventNames<ComponentProps>>, models: NoInfer<ComponentModels>, snippets: NoInfer<ComponentSnippets>) => __meeko.TagInput<ComponentExposed>;
export declare const css = "";
export declare const hasDataAwait: boolean;
export declare const __meekoChildren: (() => readonly unknown[]) | null;
export declare const __meekoReactiveProps: boolean;
export declare function renderWithState(__inputProps: ComponentProps): {
    html: string;
    state: __meeko.HotState;
};
export declare function renderToString(__inputProps: ComponentProps, __state?: __meeko.HotState): string;
export declare function hydrate(root: Element, __inputProps: ComponentProps, __state?: __meeko.HotState): () => void;
export declare function hydrateScope(__scope: __meeko.DomScope, __inputProps: ComponentProps, __state?: __meeko.HotState): __meeko.ComponentRelease<ComponentExposed>;
export {};
`;

/** The generic one of the same release: its types take the parameters of the component. */
const genericDeclaration171 = `// @meeko-generated component-declaration v1
import * as __meeko from "@meekojs/meeko/internal";
export type ComponentProps<T> = {
    items: readonly T[];
};
export type ComponentExposed<T> = null;
export type ComponentModels<T> = null;
export type ComponentSnippets<T> = null;
declare function __meeko_channels<T>(): {
    readonly models: ComponentModels<T>;
    readonly snippets: ComponentSnippets<T>;
};
export declare const __meekoChannels: ReturnType<typeof __meeko_channels>;
type __MeekoTagProps<P> = P extends unknown ? {
    [K in keyof P]: {} extends Record<K, unknown> ? P[K] : {} extends Pick<P, K> ? P[K] | undefined : P[K];
} : never;
export declare const __meekoTag: <T>(props: __MeekoTagProps<ComponentProps<T>> & __meeko.ExtraProps, events: NoInfer<__meeko.EventNames<ComponentProps<T>>>, models: __meeko.NoModels, snippets: __meeko.NoSnippets) => __meeko.TagInput<ComponentExposed<T>>;
export declare const css = "";
export declare const hasDataAwait: boolean;
export declare const __meekoChildren: (() => readonly unknown[]) | null;
export declare const __meekoReactiveProps: boolean;
export declare function renderWithState<T>(__inputProps: ComponentProps<T>): {
    html: string;
    state: __meeko.HotState;
};
export declare function renderToString<T>(__inputProps: ComponentProps<T>, __state?: __meeko.HotState): string;
export declare function hydrate<T>(root: Element, __inputProps: ComponentProps<T>, __state?: __meeko.HotState): () => void;
export declare function hydrateScope<T>(__scope: __meeko.DomScope, __inputProps: ComponentProps<T>, __state?: __meeko.HotState): __meeko.ComponentRelease<ComponentExposed<T>>;
export {};
`;

const legacyModule = `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({
  meta: { name: "kit" },
  setup(_options, meeko) {
    meeko.addComponentsDir("./node_modules/published-kit/components");
  },
});
`;

/** A project that installed a package of components, with a declaration of each generation. */
const publishedPackage = (declaration: string): Record<string, string> => ({
  "package.json": '{"private":true,"type":"module"}\n',
  "meeko.config.mjs": 'export default { modules: ["./modules/kit"] };\n',
  "modules/kit/index.mjs": legacyModule,
  "node_modules/published-kit/package.json": '{"name":"published-kit","version":"1.0.0","type":"module"}\n',
  // The source of `declaration171`: `meeko check` compiles it for a `.meeko` that uses it, and TypeScript
  // reads the declaration for a `.ts` and for the global types.
  "node_modules/published-kit/components/Legacy.meeko": `<script lang="ts">
const props = defineProps<{ label: string; tone?: "neutral" | "danger" }>();
const emit = defineEmits<{ press: [event: MouseEvent] }>();
const open = defineModel<boolean>({ default: false });
const snippets = defineSnippets<{ default: [] }>();
defineExpose({ focus: (): void => {} });
</script>
<template><button type="button" bind:data-open="open.value ? '' : undefined" on:click="(event) => emit('press', event)">{props.label}<render snippet="snippets.default" /></button></template>
`,
  "node_modules/published-kit/components/Legacy.d.meeko.ts": declaration,
});

test("a package published before 1.8 keeps its types without republishing: <Name>Props is its ComponentProps", { timeout: 300_000 }, async (context) => {
  const root = await tempProject(context, "legacy-declaration");
  await linkRepositoryPackages(root);
  await put(root, {
    ...publishedPackage(declaration171),
    "node_modules/published-kit/components/LegacyList.meeko": '<script lang="ts" generic="T">\nconst props = defineProps<{ items: readonly T[] }>();\n</script>\n<template><ul><li each:of="props.items" each:as="item">{String(item)}</li></ul></template>\n',
    "node_modules/published-kit/components/LegacyList.d.meeko.ts": genericDeclaration171,
    // As the application wrote it with 1.7: the callbacks are in the type, and it does not touch it.
    "app/utils/legacy.ts": 'export const label = (props: LegacyProps): string => props.label;\nexport const full: LegacyProps = { label: "a", tone: "danger", onPress: () => {} };\nexport const list: LegacyListProps<number> = { items: [1, 2] };\n',
    "app/pages/index.meeko": `<script lang="ts">
const props: LegacyProps = { label: "a" };
const models: LegacyModels = {};
const snippets: LegacySnippets = { default: undefined as never };
const list: LegacyListProps<string> = { items: ["x"] };
void props; void models; void snippets; void list;
</script>
<template><main><Legacy label="a" on:press="() => {}">x</Legacy><LegacyList bind:items="[1, 2]" /></main></template>
`,
  });

  const registry = await discoverAutoImports(root);
  const imported = (name: string) => registry.filter((item) => item.name === name).map((item) => item.imported);
  assert.deepEqual(imported("LegacyProps"), ["ComponentProps"]);
  assert.deepEqual(imported("LegacyListProps"), ["ComponentProps"]);
  assert.deepEqual(imported("LegacySnippets"), ["ComponentSnippets"]);
  assert.deepEqual(imported("LegacyModels"), ["ComponentModels"]);
  assert.deepEqual(imported("LegacyExposed"), ["ComponentExposed"]);
  // Its declaration has no map of events: the name it never had does not exist.
  assert.deepEqual(imported("LegacyEmits"), []);
  // The static registry of the editor, which does not run modules, reads the declaration of a layer the same.
  const layered = await tempProject(context, "legacy-declaration-static");
  await put(layered, {
    "package.json": '{"private":true,"type":"module"}\n',
    "meeko.config.mjs": 'export default { extends: ["./base"] };\n',
    "base/app/components/Legacy.meeko": "<template><p>x</p></template>\n",
    "base/app/components/Legacy.d.meeko.ts": declaration171,
  });
  assert.deepEqual(discoverAutoImportsSync(layered).filter((item) => item.name === "LegacyProps" || item.name === "LegacyEmits").map((item) => [item.name, item.imported]), [["LegacyProps", "ComponentProps"]]);

  // The cases of the review: the import of a script and the global of a declaration.
  assert.match(applyAutoImports("export const label = (props: LegacyProps) => props.label;\n", join(root, "app", "utils", "x.ts"), registry, "client"), /^import type \{ ComponentProps as LegacyProps \} from "[^"]*Legacy\.meeko";$/m);
  const client = await readFile((await generateAutoImportTypes(root)).client, "utf8");
  assert.match(client, /export import LegacyProps = __meeko_type_\d+\.ComponentProps;/);
  assert.doesNotMatch(client, /__MeekoPropsOnly|ComponentEmits|LegacyEmits/);

  // `meeko check` of a project that upgraded: no error, and no need to touch anything.
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => (item.severity ?? "error") === "error").map((item) => `${item.code}: ${item.message}`), []);

  // It is really the type of the component, not an `any`.
  await put(root, { "app/utils/legacy.ts": 'export const wrong: LegacyProps = { label: 1 };\n' });
  await assert.rejects(checkFrameworkProject(root), /legacy\.ts.*TS2322/s);
  // <Name>Emits is an honest "cannot find name" where it would say nothing about the component.
  await put(root, { "app/utils/legacy.ts": 'export const events: LegacyEmits = {};\n' });
  await assert.rejects(checkFrameworkProject(root), /legacy\.ts.*TS2304.*LegacyEmits/s);
});

test("a declaration of 1.8 gives <Name>Props without callbacks and <Name>Emits, a project source has no declaration to read, and an export * keeps the names of 1.7", { timeout: 300_000 }, async (context) => {
  const root = await tempProject(context, "current-declaration");
  await linkRepositoryPackages(root);
  const current = `// @meeko-generated component-declaration v1
type __MeekoEmits = { press: [event: MouseEvent] };
type __MeekoDeclaredProps = { label: string };
export type ComponentProps = __MeekoDeclaredProps & { onPress?: (event: MouseEvent) => void };
type __MeekoPropsOnly = __MeekoDeclaredProps;
export type { __MeekoPropsOnly };
export type { __MeekoEmits as ComponentEmits };
export type ComponentSnippets = null;
export type ComponentModels = null;
export type ComponentExposed = null;
`;
  await put(root, {
    ...publishedPackage(current),
    "node_modules/published-kit/components/Forwarded.meeko": "<template><p>x</p></template>\n",
    "node_modules/published-kit/components/Forwarded.d.meeko.ts": 'export * from "./Legacy.meeko";\n',
    "app/components/Own.meeko": '<script lang="ts">\nconst props = defineProps<{ title: string }>();\nconst emit = defineEmits<{ close: [] }>();\n</script>\n<template><button type="button" on:click="() => emit(\'close\')">{props.title}</button></template>\n',
    "app/pages/index.meeko": `<script lang="ts">
const own: OwnProps = { title: "a" };
const events: OwnEmits = { close: [] };
const props: LegacyProps = { label: "a" };
const press: LegacyEmits = { press: [new MouseEvent("click")] };
void own; void events; void props; void press;
</script>
<template><main><Own title="a" on:close="() => {}" /><Legacy label="a" on:press="() => {}">x</Legacy></main></template>
`,
  });
  const registry = await discoverAutoImports(root);
  const imported = (name: string) => registry.filter((item) => item.name === name).map((item) => item.imported);
  assert.deepEqual(imported("LegacyProps"), ["__MeekoPropsOnly"]);
  assert.deepEqual(imported("LegacyEmits"), ["ComponentEmits"]);
  assert.deepEqual(imported("OwnProps"), ["__MeekoPropsOnly"]);
  assert.deepEqual(imported("OwnEmits"), ["ComponentEmits"]);
  // What an `export *` brings is not read: only what every declaration has always had is assumed.
  assert.deepEqual(imported("ForwardedProps"), ["ComponentProps"]);
  assert.deepEqual(imported("ForwardedEmits"), []);
  assert.deepEqual(imported("ForwardedSnippets"), ["ComponentSnippets"]);
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => (item.severity ?? "error") === "error").map((item) => `${item.code}: ${item.message}`), []);
  // Without callbacks, as the migration guide says.
  await put(root, { "app/utils/wrong.ts": 'export const wrong: LegacyProps = { label: "a", onPress: () => {} };\n' });
  await assert.rejects(checkFrameworkProject(root), /wrong\.ts.*TS2353/s);
});

test("the props types of the built-in tags and RouteId are autoimported from the framework, and a project type wins", { timeout: 300_000 }, async (context) => {
  const root = await tempProject(context, "builtin-tag-types");
  await linkRepositoryPackages(root);
  await put(root, {
    "package.json": '{"private":true,"type":"module"}\n',
    "app/pages/index.meeko": '<script lang="ts"></script><template><NavLink href="/about" home="/" label="Acerca de" /></template>\n',
    "app/pages/about.meeko": '<script lang="ts"></script><template><p>About</p></template>\n',
    // The case of a real application: a component that receives the ID of a route.
    "app/components/NavLink.meeko": `<script lang="ts">
const props = defineProps<{ href: MeekoLinkProps["to"]; home: RouteId; label: string }>();
const outlet: MeekoOutletProps = {};
</script>
<template><a bind:href="href(props.href)" bind:data-home="href(props.home)" bind:data-outlet="String(Object.keys(outlet).length)">{props.label}</a></template>
`,
  });
  const registry = await discoverAutoImports(root);
  const entry = (name: string) => registry.filter((item) => item.name === name);
  for (const name of builtinTagTypes) {
    assert.deepEqual(entry(name), [{ name, imported: name, file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "app", typeOnly: true, component: false, componentType: true }]);
  }
  // Every built-in tag of the editor has its props type autoimported.
  assert.deepEqual(builtinTags.map((tag) => tag.propsType).filter((name) => !builtinTagTypes.includes(name)), []);
  assert.deepEqual(entry("RouteId").map((item) => [item.scope, item.specifier, item.typeOnly]), [["shared", "@meekojs/meeko/framework", true]]);
  const imported = applyAutoImports('type To = MeekoLinkProps["to"];\n', join(root, "app", "components", "x.meeko"), registry, "client");
  assert.match(imported, /^import type \{ MeekoLinkProps as MeekoLinkProps \} from "@meekojs\/meeko\/framework";$/m);
  assert.throws(() => applyAutoImports("type P = MeekoLinkProps;\n", join(root, "shared", "utils", "x.ts"), registry, "shared"), /MeekoLinkProps no está disponible en el ámbito shared/);
  const declarations = await generateAutoImportTypes(root);
  assert.match(await readFile(declarations.client, "utf8"), /export import MeekoLinkProps = __meeko_type_\d+\.MeekoLinkProps;/);

  // `meeko check` types `href` with the routes of the application, without an import.
  assert.deepEqual((await checkFrameworkProject(root)).map((item) => `${item.code}: ${item.message}`), []);
  await put(root, { "app/pages/index.meeko": '<script lang="ts"></script><template><NavLink href="/nowhere" home="/" label="x" /></template>\n' });
  const wrong = await checkApp(root);
  assert.ok(wrong.some((item) => /"\/nowhere"/.test(item.message)), JSON.stringify(wrong));

  // A type of the project with the same name wins.
  await put(root, { "app/types/outlet.ts": "export interface MeekoOutletProps { readonly own: true }\n" });
  assert.deepEqual((await discoverAutoImports(root)).filter((item) => item.name === "MeekoOutletProps").map((item) => item.file), [join(root, "app", "types", "outlet.ts")]);
});

test("a project component named like a built-in tag keeps its own Props type, and the declarations are generated", { timeout: 300_000 }, async (context) => {
  const root = await tempProject(context, "builtin-tag-shadowed");
  await linkRepositoryPackages(root);
  await put(root, {
    "package.json": '{"private":true,"type":"module"}\n',
    "app/pages/index.meeko": '<script lang="ts"></script><template><MeekoLink label="Inicio" /></template>\n',
    // A project from before 1.2 with its own `MeekoLink` (MEEK106): its props are not the built-in's.
    "app/components/MeekoLink.meeko": `<script lang="ts">
const props = defineProps<{ label: string }>();
</script>
<template><a href="/">{props.label}</a></template>
`,
    "app/components/LinkLabel.meeko": `<script lang="ts">
const props = defineProps<{ link: MeekoLinkProps }>();
</script>
<template><span>{props.link.label}</span></template>
`,
  });
  const component = join(root, "app", "components", "MeekoLink.meeko");
  const registry = await discoverAutoImports(root);
  assert.deepEqual(registry.filter((item) => item.name === "MeekoLinkProps").map((item) => [item.file, item.imported]), [[component, "__MeekoPropsOnly"]]);
  // The other built-in tags keep their types.
  assert.deepEqual(registry.filter((item) => item.name === "MeekoOutletProps").map((item) => item.file), ["@meekojs/meeko/framework"]);
  assert.deepEqual(discoverAutoImportsSync(root).filter((item) => item.name === "MeekoLinkProps").map((item) => item.file), [component]);
  const declarations = await generateAutoImportTypes(root);
  const client = await readFile(declarations.client, "utf8");
  assert.match(client, /export import MeekoLinkProps = __meeko_type_\d+\.__MeekoPropsOnly;/);
  assert.match(client, /export import MeekoOutletProps = __meeko_type_\d+\.MeekoOutletProps;/);
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => (item.severity ?? "error") === "error").map((item) => `${item.code}: ${item.message}`), []);
});
