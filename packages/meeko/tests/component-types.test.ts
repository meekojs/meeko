import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { applyAutoImports, builtinTagTypes, discoverAutoImports, discoverAutoImportsSync } from "../src/autoimports.ts";
import { generateAutoImportTypes } from "../src/autoimports-ts.ts";
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
  for (const [suffix, imported] of [["Props", "ComponentProps"], ["Snippets", "ComponentSnippets"], ["Models", "ComponentModels"], ["Exposed", "ComponentExposed"]] as const) {
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
  assert.match(client, /export import UiButtonProps = __meeko_type_\d+\.ComponentProps;/);
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
  assert.deepEqual(registry.filter((item) => item.name === "MeekoLinkProps").map((item) => [item.file, item.imported]), [[component, "ComponentProps"]]);
  // The other built-in tags keep their types.
  assert.deepEqual(registry.filter((item) => item.name === "MeekoOutletProps").map((item) => item.file), ["@meekojs/meeko/framework"]);
  assert.deepEqual(discoverAutoImportsSync(root).filter((item) => item.name === "MeekoLinkProps").map((item) => item.file), [component]);
  const declarations = await generateAutoImportTypes(root);
  const client = await readFile(declarations.client, "utf8");
  assert.match(client, /export import MeekoLinkProps = __meeko_type_\d+\.ComponentProps;/);
  assert.match(client, /export import MeekoOutletProps = __meeko_type_\d+\.MeekoOutletProps;/);
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => (item.severity ?? "error") === "error").map((item) => `${item.code}: ${item.message}`), []);
});
