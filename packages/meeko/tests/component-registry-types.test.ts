import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
