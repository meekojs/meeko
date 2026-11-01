import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { generateAppTypes } from "../src/framework/check-app.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { generateComponentRegistryTypes } from "../src/framework/type-declarations.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

const button = `<script lang="ts">
const props = defineProps<{ label: string; tone?: "primary" | "quiet" }>();
const emit = defineEmits<{ save: [value: number] }>();
</script>
<template><button>{props.label}</button></template>
`;

test("registered modules keep their real props and reject invalid names and inputs", { timeout: 180_000 }, async (context) => {
  const root = await tempProject(context, "component-registry-types");
  await linkRepositoryPackages(root);
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "meeko.config.ts"), 'export default { components: { dirs: [{ path: "app/components", prefix: "" }, { path: "app/widgets", prefix: "Ui" }] } };\n');
  await mkdir(join(root, "app", "components"), { recursive: true });
  await mkdir(join(root, "app", "widgets"), { recursive: true });
  await mkdir(join(root, "app", "pages"), { recursive: true });
  await mkdir(join(root, "app", "utils"), { recursive: true });
  await writeFile(join(root, "app", "components", "Button.meeko"), button);
  const plain = join(root, "app", "components", "Plain.meeko");
  await writeFile(plain, "<template><p>Plain</p></template>\n");
  const badge = join(root, "app", "widgets", "Badge.meeko");
  await writeFile(badge, `<script lang="ts">const props = defineProps<{ count: number }>();</script>
<template><span>{props.count}</span></template>
`);
  await writeFile(join(root, "app", "pages", "index.meeko"), `<script lang="ts">
type P = ComponentProps<"Button">;
const example: P = { label: "Home" };
const selected = signal<ResolvedComponent<"Button"> | undefined>(undefined);
async function open(): Promise<void> {
  selected.value = await resolveComponent("Button", { label: "Save", onSave: (id) => id.toFixed() });
}
</script>
<template><main>{example.label}<button type="button" on:click="open">Open</button><component if:when="selected.value" is="selected.value!" bind:tone="'quiet'" on:save="(id) => id.toFixed()" /></main></template>
`);
  const consumer = join(root, "app", "utils", "consumer.ts");
  await writeFile(consumer, `import type { ComponentName as Names, ComponentOf as Of, ComponentProps as Props, ComponentArgs as Args } from "@meekojs/meeko";
const name: Names = "Button";
const props: Props<"Button"> = { label: "Save", tone: "primary" };
type Direct = import("../components/Button.meeko").ComponentProps;
const direct: Direct = props;
const module: Of<"Button"> = Button;
const html: string = module.renderToString(props);
type AutoName = ComponentName;
type AutoProps = ComponentProps<"Button">;
const auto: AutoProps = { label: "Save" };
const globalArgs: ComponentArgs = ["Button", auto];
const plain: Props<"Plain"> = {};
const badge: Props<"UiBadge"> = { count: 2 };
function openModal(...args: Args): void { void args; }
function loadModal(...args: Args): Promise<ResolvedComponent> { return resolveComponent(...args); }
void loadModal;
openModal("Button", { label: "Save" });
openModal("UiBadge", { count: 2 });
const current: "Button" | "UiBadge" = Math.random() > 0.5 ? "Button" : "UiBadge";
// @ts-expect-error a union name cannot be paired with unrelated props
openModal(current, { label: "Save" });
// @ts-expect-error the badge does not accept Button props
openModal("UiBadge", { label: "Save" });
// @ts-expect-error the button does not accept Badge props
openModal("Button", { count: 2 });
// @ts-expect-error nonexistent component name
const missing: Names = "Missing";
// @ts-expect-error required label
const absent: Props<"Button"> = {};
// @ts-expect-error invalid literal
const wrong: Props<"Button"> = { label: "Save", tone: "other" };
// @ts-expect-error no props are declared by Plain
const extra: Props<"Plain"> = { extra: true };
// @ts-expect-error badge count is required
const emptyBadge: Props<"UiBadge"> = {};
const bound: Promise<ResolvedComponent<"Button">> = resolveComponent("Button", { label: "Save", onSave: (id) => id.toFixed() });
bound.then((module) => { module.renderToString(); module.renderToString({ label: "Override" }); });
resolveComponent("Plain", {});
resolveComponent("Button").then((module) => {
  module.renderToString({ label: "Original" });
  // @ts-expect-error the original one-argument form still requires the props
  module.renderToString();
});
// @ts-expect-error required label is checked at resolution
resolveComponent("Button", {});
// @ts-expect-error unknown component
resolveComponent("Missing", {});
// @ts-expect-error invalid literal
resolveComponent("Button", { label: "Save", tone: "other" });
// @ts-expect-error unknown prop beside a valid prop
resolveComponent("Button", { label: "Save", extra: true });
// @ts-expect-error no props are declared by Plain
resolveComponent("Plain", { extra: true });
// @ts-expect-error events retain their payload type
resolveComponent("Button", { label: "Save", onSave: (id: string) => id });
// @ts-expect-error an unrelated pair with a union name is rejected
resolveComponent(current, { label: "Save" });
// @ts-expect-error even an explicitly widened name must remain correlated with props
resolveComponent<"Button" | "UiBadge">("UiBadge", { label: "Save" });
// @ts-expect-error passing undefined is different from the one-argument loader
resolveComponent("Button", undefined);
void name; void html; void direct; void auto; void globalArgs; void plain; void badge; void missing; void absent; void wrong; void extra; void emptyBadge;
`);
  const declaration = await generateComponentRegistryTypes(root);
  assert.match(await readFile(declaration, "utf8"), /readonly "Button": typeof import\("\.\.\/\.\.\/app\/components\/Button\.meeko"\)/);
  assert.match(await readFile(declaration, "utf8"), /readonly "Plain": typeof import\("\.\.\/\.\.\/app\/components\/Plain\.meeko"\)/);
  assert.match(await readFile(declaration, "utf8"), /readonly "UiBadge": typeof import\("\.\.\/\.\.\/app\/widgets\/Badge\.meeko"\)/);
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => (item.severity ?? "error") === "error"), []);
  const badgeDeclaration = join(root, ".meeko", "types", "app", "widgets", "Badge.d.meeko.ts");
  assert.match(await readFile(badgeDeclaration, "utf8"), /ComponentProps/);

  await writeFile(consumer, `import type { ComponentName, ComponentProps } from "@meekojs/meeko";
const invalid: ComponentName = "Missing";
const wrong: ComponentProps<"Button"> = { tone: "quiet" };
void invalid; void wrong;
`);
  await assert.rejects(checkFrameworkProject(root), /TS2322.*Missing|TS2741.*label/s);
  await rm(plain);
  await rm(badge);
  await generateAppTypes(root);
  await generateComponentRegistryTypes(root);
  assert.doesNotMatch(await readFile(declaration, "utf8"), /readonly "Plain"/);
  assert.doesNotMatch(await readFile(declaration, "utf8"), /readonly "UiBadge"/);
  await assert.rejects(readFile(badgeDeclaration, "utf8"), /ENOENT/);
});

test("resolveComponent loads <MeekoLink> and a module's UI component by name, with typed props", { timeout: 180_000 }, async (context) => {
  const root = await tempProject(context, "component-registry-link");
  await linkRepositoryPackages(root);
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  // A module that contributes UI-prefixed components, as @meekojs/ui does.
  await mkdir(join(root, "modules", "kit", "components"), { recursive: true });
  await writeFile(join(root, "modules", "kit", "index.ts"), 'import { defineMeekoModule } from "@meekojs/meeko/framework";\nexport default defineMeekoModule({ meta: { name: "kit" }, setup(_options, meeko) { meeko.addComponentsDir("./modules/kit/components", { prefix: "UI" }); } });\n');
  await writeFile(join(root, "modules", "kit", "components", "Card.meeko"), '<script lang="ts">const props = defineProps<{ heading: string }>();</script>\n<template><article>{props.heading}</article></template>\n');
  await writeFile(join(root, "meeko.config.ts"), 'import kit from "./modules/kit/index.ts";\nexport default { modules: [kit] };\n');
  await mkdir(join(root, "app", "pages", "users"), { recursive: true });
  await mkdir(join(root, "app", "utils"), { recursive: true });
  await writeFile(join(root, "app", "pages", "about.meeko"), "<template><h1>Acerca</h1></template>\n");
  await writeFile(join(root, "app", "pages", "users", "[id].meeko"), "<template><h1>Usuario</h1></template>\n");
  await writeFile(join(root, "app", "pages", "index.meeko"), `<script lang="ts">
const link = signal<ResolvedComponent<"MeekoLink"> | undefined>(undefined);
async function open(): Promise<void> {
  link.value = await resolveComponent("MeekoLink", { to: "/users/[id]", params: { id: "7" }, class: "nav" });
}
</script>
<template><main><button type="button" on:click="open">Open</button><component if:when="link.value" is="link.value!">Perfil</component></main></template>
`);
  await writeFile(join(root, "app", "utils", "consumer.ts"), `const names: ComponentName[] = ["MeekoLink", "UICard"];
resolveComponent("MeekoLink", { to: "/about" });
resolveComponent("UICard", { heading: "Hola" });
// @ts-expect-error a route that does not exist
resolveComponent("MeekoLink", { to: "/nowhere" });
// @ts-expect-error the params of a dynamic route are required
resolveComponent("MeekoLink", { to: "/users/[id]" });
// @ts-expect-error <MeekoLink> builds its href
resolveComponent("MeekoLink", { to: "/about", href: "/x" });
// @ts-expect-error the heading of the card is required
resolveComponent("UICard", {});
void names;
`);
  const declaration = await generateComponentRegistryTypes(root);
  const text = await readFile(declaration, "utf8");
  assert.match(text, /readonly "MeekoLink": typeof import\("@meekojs\/meeko\/builtins\/link"\)/);
  assert.match(text, /readonly "UICard": typeof import\(/);
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => (item.severity ?? "error") === "error"), []);
  // A component of the project called MeekoLink takes the name.
  await mkdir(join(root, "app", "components"), { recursive: true });
  await writeFile(join(root, "app", "components", "MeekoLink.meeko"), "<template><a>own</a></template>\n");
  assert.doesNotMatch(await readFile(await generateComponentRegistryTypes(root), "utf8"), /builtins\/link/);
});

test("a project without registered components still has a valid generated resolver", async (context) => {
  const root = await tempProject(context, "empty-component-registry");
  await linkRepositoryPackages(root);
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
  await mkdir(join(root, "app", "pages"), { recursive: true });
  await writeFile(join(root, "app", "pages", "index.meeko"), "<template><main>Empty registry</main></template>");
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => (item.severity ?? "error") === "error"), []);
});

test("a modal composable forwards correlated props and keeps only Modal-prefixed component results", async (context) => {
  const root = await tempProject(context, "modal-component-registry");
  await linkRepositoryPackages(root);
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
  await mkdir(join(root, "app", "components", "Modal"), { recursive: true });
  await mkdir(join(root, "app", "pages"), { recursive: true });
  await mkdir(join(root, "app", "composables"), { recursive: true });
  await writeFile(join(root, "app", "components", "Button.meeko"), button);
  await writeFile(join(root, "app", "components", "Modal", "UserCreate.meeko"), '<script lang="ts">const props = defineProps<{ name: string }>();</script><template><p>{props.name}</p></template>');
  await writeFile(join(root, "app", "components", "Modal", "Confirm.meeko"), '<script lang="ts">const props = defineProps<{ message: string; danger?: boolean }>();</script><template><p>{props.message}</p></template>');
  await writeFile(join(root, "app", "pages", "index.meeko"), '<template><main>Modals</main></template>');
  await writeFile(join(root, "app", "composables", "useModal.client.ts"), `
type ModalName = Extract<ComponentName, \`Modal\${string}\`>;
type ModalArgs = Extract<ComponentArgs, [name: ModalName, props: unknown]>;
interface ModalInstance { id: number; component: ResolvedComponent<ModalName> }
export function useModal() {
  const selected = signal<ResolvedComponent<ModalName> | undefined>(undefined);
  async function open(...request: ModalArgs) {
    selected.value = await resolveComponent(...request);
  }
  return { open, selected };
}
const modal = useModal();
modal.open("ModalUserCreate", { name: "Diego" });
modal.open("ModalConfirm", { message: "Continue?", danger: true });
// @ts-expect-error a non-modal cannot be opened by this composable
modal.open("Button", { label: "Save" });
// @ts-expect-error the creation form does not accept confirmation props
modal.open("ModalUserCreate", { message: "Wrong" });
// @ts-expect-error required form name is checked
modal.open("ModalUserCreate", {});
// @ts-expect-error wrong property type
modal.open("ModalConfirm", { message: 123 });
declare const name: ModalName;
// @ts-expect-error a union name is not enough to correlate an arbitrary props object
modal.open(name, { name: "Diego" });
async function instance(): Promise<ModalInstance> {
  return { id: 1, component: await resolveComponent("ModalUserCreate", { name: "Diego" }) };
}
void instance;
`);
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => (item.severity ?? "error") === "error"), []);
});

test("bound components keep required models, snippets and exact template overrides", async (context) => {
  const root = await tempProject(context, "bound-component-channels");
  await linkRepositoryPackages(root);
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
  await mkdir(join(root, "app", "components"), { recursive: true });
  await mkdir(join(root, "app", "pages"), { recursive: true });
  await writeFile(join(root, "app", "components", "Field.meeko"), `<script lang="ts">
const props = defineProps<{ label: string }>();
const count = defineModel<number>();
const snippets = defineSnippets<{ detail: [value: number] }>();
defineExpose({ label: () => props.label });
</script><template><p>{props.label}:{count.value}<render snippet="snippets.detail" args="count.value" /></p></template>`);
  const page = join(root, "app", "pages", "index.meeko");
  const source = `<script lang="ts">
const field = signal<ResolvedComponent<"Field"> | undefined>(undefined);
const count = signal(1);
async function open(): Promise<void> { field.value = await resolveComponent("Field", { label: "Count" }); }
</script><template><button type="button" on:click="open">Open</button><component if:when="field.value" is="field.value!" model="count" bind:label="'Override'"><snippet name="detail" params="value">{value.toFixed()}</snippet></component></template>`;
  await writeFile(page, source);
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => (item.severity ?? "error") === "error"), []);
  await writeFile(page, source.replace(' model="count"', ""));
  await assert.rejects(checkFrameworkProject(root), /default|model/i);
  await writeFile(page, source.replace('<snippet name="detail" params="value">{value.toFixed()}</snippet>', ""));
  await assert.rejects(checkFrameworkProject(root), /detail|snippet/i);
  await writeFile(page, source.replace('bind:label="\'Override\'"', 'bind:label="123"'));
  await assert.rejects(checkFrameworkProject(root), /TS2322|TS2345/);
  await writeFile(page, source.replace('bind:label="\'Override\'"', 'bind:missing="123"'));
  await assert.rejects(checkFrameworkProject(root), /missing|TS2353/);
});

test("external component modules require resolvable adjacent declarations", { timeout: 120_000 }, async (context) => {
  const root = await tempProject(context, "external-component-registry-types");
  await linkRepositoryPackages(root);
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "meeko.config.ts"), 'export default { components: { dirs: [{ path: "node_modules/vendor/components", prefix: "Vendor" }] } };\n');
  const directory = join(root, "node_modules", "vendor", "components");
  await mkdir(directory, { recursive: true });
  await mkdir(join(root, "app", "pages"), { recursive: true });
  await mkdir(join(root, "app", "utils"), { recursive: true });
  await writeFile(join(root, "app", "pages", "index.meeko"), "<template><main>Home</main></template>\n");
  await writeFile(join(directory, "External.meeko"), "<template><p>Vendor</p></template>\n");
  await assert.rejects(generateComponentRegistryTypes(root), /componente externo VendorExternal necesita una declaración adyacente/);
  await writeFile(join(directory, "External.d.meeko.ts"), `export type ComponentProps = { value: "ready" | "idle" };
export declare function renderToString(props: ComponentProps): string;
export declare function renderWithState(props: ComponentProps): { html: string; state: Record<string, unknown> };
export declare function hydrateScope(scope: import("@meekojs/meeko").DomScope, props: ComponentProps): import("@meekojs/meeko").ComponentRelease;
`);
  await writeFile(join(root, "app", "utils", "external.ts"), `import type { ComponentProps } from "@meekojs/meeko";
const props: ComponentProps<"VendorExternal"> = { value: "ready" };
// @ts-expect-error preserve vendor's literal union
const invalid: ComponentProps<"VendorExternal"> = { value: "other" };
void props; void invalid;
`);
  const declaration = await generateComponentRegistryTypes(root);
  assert.match(await readFile(declaration, "utf8"), /VendorExternal/);
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => (item.severity ?? "error") === "error"), []);
});

test("a component of a module outside the project keeps its own declaration and nothing is written outside .meeko", { timeout: 120_000 }, async (context) => {
  // A workspace: the app in apps/meeko imports a component of packages/ui, as a linked module does.
  const workspace = await tempProject(context, "external-component-declarations");
  const root = join(workspace, "apps", "meeko");
  const vendor = join(workspace, "packages", "ui", "dist", "app", "components");
  await mkdir(join(root, "app", "pages"), { recursive: true });
  await mkdir(vendor, { recursive: true });
  await linkRepositoryPackages(root);
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(vendor, "Widget.meeko"), "<script lang=\"ts\">const props = defineProps<{ value: \"ready\" | \"idle\" }>();</script><template><p>{props.value}</p></template>\n");
  const shipped = `export type ComponentProps = { value: "ready" | "idle" };
export declare function renderToString(props: ComponentProps): string;
export declare function renderWithState(props: ComponentProps): { html: string; state: Record<string, unknown> };
export declare function hydrateScope(scope: import("@meekojs/meeko").DomScope, props: ComponentProps): import("@meekojs/meeko").ComponentRelease;
`;
  await writeFile(join(vendor, "Widget.d.meeko.ts"), shipped);
  const page = join(root, "app", "pages", "index.meeko");
  const source = `<script lang="ts">import * as Widget from "../../../../packages/ui/dist/app/components/Widget.meeko";</script><template><Widget value="ready" /></template>\n`;
  await writeFile(page, source);
  const outputs = await generateAppTypes(root);
  assert.deepEqual(outputs, [join(root, ".meeko", "types", "app", "pages", "index.d.meeko.ts")]);
  // Before, the declaration of Widget went to apps/meeko/packages/ui/dist/app/components.
  assert.deepEqual((await readdir(root)).filter((name) => name !== "node_modules").sort(), [".meeko", "app", "package.json"]);
  assert.equal(await readFile(join(vendor, "Widget.d.meeko.ts"), "utf8"), shipped);
  // The page is still typed against the declaration the module ships.
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => (item.severity ?? "error") === "error"), []);
  await writeFile(page, source.replace('value="ready"', 'value="other"'));
  await assert.rejects(checkFrameworkProject(root), /TS2322|other/);
  assert.deepEqual((await readdir(root)).filter((name) => name !== "node_modules").sort(), [".meeko", "app", "package.json"]);
});
