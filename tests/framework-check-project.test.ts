import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { checkFrameworkProject } from "../src/framework/check-project.js";

test("framework project check generates scoped TS projects and reports server type errors", async () => {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "check-project-"));
  const path = relative(parent, root);
  assert.ok(path && path !== ".." && !path.startsWith(`..${sep}`));
  try {
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await mkdir(join(root, "server"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await writeFile(join(root, "app", "pages", "index.meeko"), [
      '<script lang="ts">',
      "export interface Props { params: Record<string, string>; data: { name: string } }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>Hello</p></template>",
      "",
    ].join("\n"));
    await writeFile(join(root, "app", "pages", "index.route.ts"), [
      'import { definePage } from "@meekojs/meeko/framework";',
      'export const route = definePage({ load: () => ({ name: "Ada" }) });',
      "",
    ].join("\n"));
    await writeFile(join(root, "app", "pages", "[id].meeko"), [
      '<script lang="ts">',
      "export interface Props { params: { id: string }; data: { name: string } }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>{props.params.id}: {props.data.name}</p></template>",
      "",
    ].join("\n"));
    await writeFile(join(root, "app", "pages", "[id].route.ts"), [
      'import { definePage } from "@meekojs/meeko/framework";',
      'export const route = definePage<undefined, undefined, Response | { name: string }>({',
      '  load: ({ params }) => params.id === "redirect" ? new Response(null, { status: 302, headers: { location: "/" } }) : { name: "Ada" },',
      '});',
      "",
    ].join("\n"));
    await writeFile(join(root, "server", "session.ts"), [
      'import { MemorySessionStore, SessionManager } from "@meekojs/meeko/server";',
      "export function createSessionManager(_production: boolean) {",
      "  return new SessionManager({ store: new MemorySessionStore(), production: false });",
      "}",
      "",
    ].join("\n"));
    await checkFrameworkProject(root);
    const shell = (props: string) => `<script lang="ts">const props = defineProps<${props}>();</script><template><p>Shell</p></template>`;
    for (const unsafe of ["never", "any", "unknown"]) {
      await writeFile(join(root, "app", "pages", "index.meeko"), shell(unsafe));
      await assert.rejects(checkFrameworkProject(root), /Page .* props cannot be any, never or unknown/);
    }
    await writeFile(join(root, "app", "pages", "index.meeko"), [
      '<script lang="ts">',
      "export interface Props { params: Record<string, string>; data: { name: string } }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>Hello</p></template>",
      "",
    ].join("\n"));
    for (const file of ["app/app.meeko", "app/layouts/default.meeko"]) {
      await mkdir(join(root, file, ".."), { recursive: true });
      await writeFile(join(root, file), shell("never"));
      await assert.rejects(checkFrameworkProject(root), /Layout .* props cannot be any, never or unknown/);
      await writeFile(join(root, file), shell("{ outlet: object; missing: string }"));
      await assert.rejects(checkFrameworkProject(root), /Layout .* props do not match the values supplied by Meeko/);
      await writeFile(join(root, file), shell("{ outlet: object }"));
      await checkFrameworkProject(root);
    }
    await mkdir(join(root, "app", "pages", "users"), { recursive: true });
    await writeFile(join(root, "app", "pages", "users", "index.meeko"), shell("Record<string, never>"));
    const nestedLayout = join(root, "app", "pages", "users", "+layout.meeko");
    await writeFile(nestedLayout, shell("{ outlet: object; missing: string }"));
    await assert.rejects(checkFrameworkProject(root), /Layout .*users.*\+layout\.meeko props do not match the values supplied by Meeko/);
    await writeFile(nestedLayout, shell("{ outlet: object }"));
    const errorPage = join(root, "app", "pages", "+error.meeko");
    await writeFile(errorPage, shell("unknown"));
    await assert.rejects(checkFrameworkProject(root), /Error page .* props cannot be any, never or unknown/);
    await writeFile(errorPage, shell("{ status: string; message: string }"));
    await assert.rejects(checkFrameworkProject(root), /Error page .*\+error\.meeko props do not match the values supplied by Meeko/);
    await writeFile(errorPage, shell("{ status: number; message: string }"));
    await checkFrameworkProject(root);
    const appConfig = await readFile(join(root, ".meeko", "tsconfig.app.json"), "utf8");
    const serverConfig = await readFile(join(root, ".meeko", "tsconfig.server.json"), "utf8");
    assert.match(appConfig, /autoimports\/client\.d\.ts/);
    assert.doesNotMatch(appConfig, /autoimports\/server\.d\.ts/);
    assert.match(serverConfig, /autoimports\/server\.d\.ts/);
    assert.match(serverConfig, /page-contracts\.server\.ts/);
    assert.match(appConfig, /app\/\*\*\/\*\.server\.ts/);
    assert.match(serverConfig, /app\/\*\*\/\*\.server\.ts/);
    const sharedConfig = await readFile(join(root, ".meeko", "tsconfig.shared.json"), "utf8");
    assert.match(sharedConfig, /app\/\*\*\/\*\.shared\.ts/);
    for (const config of [appConfig, serverConfig, sharedConfig]) {
      const { compilerOptions } = JSON.parse(config) as { compilerOptions: Record<string, unknown> };
      assert.equal(compilerOptions.exactOptionalPropertyTypes, true);
      assert.equal(compilerOptions.noUncheckedIndexedAccess, true);
      assert.equal(compilerOptions.verbatimModuleSyntax, true);
    }

    const strictFixture = join(root, "app", "strict.ts");
    await writeFile(strictFixture, [
      "interface Exact { optional?: string }",
      "export const exact: Exact = { optional: undefined };",
      "",
    ].join("\n"));
    await assert.rejects(checkFrameworkProject(root), /strict\.ts.*TS2375/s);
    await writeFile(strictFixture, [
      "const values: string[] = [];",
      "export const first: string = values[0];",
      "",
    ].join("\n"));
    await assert.rejects(checkFrameworkProject(root), /strict\.ts.*TS2322/s);
    await writeFile(join(root, "app", "strict-types.ts"), "export interface StrictShape { value: string }\n");
    await writeFile(strictFixture, [
      'import { StrictShape } from "./strict-types.js";',
      'export const strictShape: StrictShape = { value: "ok" };',
      "",
    ].join("\n"));
    await assert.rejects(checkFrameworkProject(root), /strict\.ts.*TS1484/s);
    await writeFile(strictFixture, [
      'import type { StrictShape } from "./strict-types.js";',
      'export const strictShape: StrictShape = { value: "ok" };',
      "",
    ].join("\n"));
    await checkFrameworkProject(root);

    await writeFile(join(root, "app", "private.server.ts"), 'export const privateValue: number = "wrong";\n');
    await assert.rejects(checkFrameworkProject(root), /private\.server\.ts.*TS2322/s);
    await writeFile(join(root, "app", "private.server.ts"), "export const privateValue: number = 1;\n");
    await writeFile(join(root, "app", "common.shared.ts"), 'export const sharedValue: number = "wrong";\n');
    await assert.rejects(checkFrameworkProject(root), /common\.shared\.ts.*TS2322/s);
    await writeFile(join(root, "app", "common.shared.ts"), "export const sharedValue: number = 1;\n");
    await mkdir(join(root, "shared"), { recursive: true });
    await writeFile(join(root, "shared", "browser.client.ts"), 'export const browserValue: number = "wrong";\n');
    await assert.rejects(checkFrameworkProject(root), /browser\.client\.ts.*TS2322/s);
    await writeFile(join(root, "shared", "browser.client.ts"), "export const browserValue: number = 1;\n");
    await writeFile(join(root, "shared", "private.server.ts"), 'export const sharedServerValue: number = "wrong";\n');
    await assert.rejects(checkFrameworkProject(root), /private\.server\.ts.*TS2322/s);
    await writeFile(join(root, "shared", "private.server.ts"), "export const sharedServerValue: number = 1;\n");

    const layerRoot = join(root, "features", "base");
    await mkdir(join(layerRoot, "app", "pages"), { recursive: true });
    await mkdir(join(layerRoot, "app", "utils"), { recursive: true });
    await writeFile(join(root, "meeko.config.ts"), 'export default { extends: ["./features/base"] };\n');
    await writeFile(join(layerRoot, "app", "utils", "broken.ts"), 'export const layerValue: number = "wrong";\n');
    await assert.rejects(checkFrameworkProject(root), /features.*base.*broken\.ts.*TS2322/s);
    await writeFile(join(layerRoot, "app", "utils", "broken.ts"), "export const layerValue: number = 1;\n");

    await writeFile(join(root, "app", "pages", "index.meeko"), [
      '<script lang="ts">',
      "export interface Props { params: Record<string, string>; data?: number }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>Hello</p></template>",
      "",
    ].join("\n"));
    await assert.rejects(checkFrameworkProject(root), /Page app\/pages\/index\.meeko props do not match loader app\/pages\/index\.route\.ts/);
    await writeFile(join(root, "app", "pages", "index.meeko"), [
      '<script lang="ts">',
      "export interface Props { params: Record<string, string>; data: { name: string } }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>Hello</p></template>",
      "",
    ].join("\n"));
    await writeFile(join(root, "app", "pages", "index.route.ts"), [
      'import { definePage } from "@meekojs/meeko/framework";',
      'const searchSchema = { "~standard": { version: 1 as const, types: undefined as unknown as { input: { tab: string }; output: { tab: string } }, validate: (_value: unknown) => ({ value: { tab: "profile" } }) } };',
      'export const route = definePage({ search: searchSchema, load: () => ({ name: "Ada" }) });',
      "",
    ].join("\n"));
    await writeFile(join(root, "app", "pages", "index.meeko"), [
      '<script lang="ts">',
      "export interface Props { params: Record<string, string>; search: { tab: number }; data: { name: string } }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>Hello</p></template>",
      "",
    ].join("\n"));
    await assert.rejects(checkFrameworkProject(root), /Page app\/pages\/index\.meeko props do not match loader app\/pages\/index\.route\.ts/);
    await writeFile(join(root, "app", "pages", "index.route.ts"), [
      'import { definePage } from "@meekojs/meeko/framework";',
      'export const route = definePage({ load: () => ({ name: "Ada" }) });',
      "",
    ].join("\n"));
    await writeFile(join(root, "app", "pages", "index.meeko"), [
      '<script lang="ts">',
      "export interface Props { params: Record<string, string>; data: { name: string } }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>Hello</p></template>",
      "",
    ].join("\n"));
    await writeFile(join(root, "app", "pages", "[id].meeko"), [
      '<script lang="ts">',
      "export interface Props { params: { id: number }; data: { name: string } }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>Hello</p></template>",
      "",
    ].join("\n"));
    await assert.rejects(checkFrameworkProject(root), /Page app\/pages\/\[id\]\.meeko props do not match loader app\/pages\/\[id\]\.route\.ts/);
    await writeFile(join(root, "app", "pages", "[id].meeko"), [
      '<script lang="ts">',
      "export interface Props { params: { id: string }; data: { name: string } }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>{props.params.id}: {props.data.name}</p></template>",
      "",
    ].join("\n"));

    await writeFile(join(root, "server", "broken.ts"), 'export const broken: number = "wrong";\n');
    await assert.rejects(checkFrameworkProject(root), /broken\.ts.*TS2322/s);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("framework project check removes only owned declarations for deleted components", async () => {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "check-project-owned-types-"));
  try {
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await mkdir(join(root, "app", "components"), { recursive: true });
    await mkdir(join(root, "app", "feature"), { recursive: true });
    await mkdir(join(root, "server"), { recursive: true });
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await writeFile(join(root, "app", "pages", "index.meeko"), [
      '<script lang="ts">',
      "export interface Props { params: Record<string, string> }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>{props.params.missing}</p></template>",
      "",
    ].join("\n"));
    const component = join(root, "app", "components", "Card.meeko");
    await writeFile(component, [
      '<script lang="ts">',
      "export interface Props { label: string }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>{props.label}</p></template>",
      "",
    ].join("\n"));
    await writeFile(join(root, "app", "feature", "Child.meeko"), [
      '<script lang="ts">',
      "export interface Props { value: string }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><span>{props.value}</span></template>",
      "",
    ].join("\n"));
    await writeFile(join(root, "app", "components", "Parent.meeko"), [
      '<script lang="ts">',
      'import * as Child from "../feature/Child.meeko";',
      "const props = defineProps<Record<string, never>>();",
      "</script>",
      "<template><p>Parent</p></template>",
      "",
    ].join("\n"));
    await writeFile(join(root, "app", "use.ts"), [
      'import type { ComponentProps } from "./components/Card.meeko";',
      'export const props: ComponentProps = { label: "typed" };',
      "",
    ].join("\n"));
    await writeFile(join(root, "server", "session.ts"), [
      'import { MemorySessionStore, SessionManager } from "@meekojs/meeko/server";',
      "export function createSessionManager(_production: boolean) {",
      "  return new SessionManager({ store: new MemorySessionStore(), production: false });",
      "}",
      "",
    ].join("\n"));

    const legacy = join(root, ".meeko", "types", "app", "components", "Legacy.d.meeko.ts");
    const standaloneSource = join(root, "examples", "Standalone.meeko");
    const standaloneType = join(root, ".meeko", "types", "examples", "Standalone.d.meeko.ts");
    const foreign = join(root, ".meeko", "types", "foreign", "Keep.d.meeko.ts");
    await mkdir(join(root, ".meeko", "types", "app", "components"), { recursive: true });
    await mkdir(join(root, ".meeko", "types", "examples"), { recursive: true });
    await mkdir(join(root, ".meeko", "types", "foreign"), { recursive: true });
    await mkdir(join(root, "examples"), { recursive: true });
    const legacyDeclaration = [
      'import * as __meeko from "@meekojs/meeko/internal";',
      "export type ComponentProps = { value: string };",
      'export declare const css = "";',
      "export declare function renderWithState(__inputProps: ComponentProps): { html: string; state: __meeko.HotState };",
      "export declare function renderToString(__inputProps: ComponentProps): string;",
      "export declare function hydrate(root: Element, __inputProps: ComponentProps): () => void;",
      "export declare function hydrateScope(__scope: __meeko.DomScope, __inputProps: ComponentProps): () => void;",
      "",
    ].join("\n");
    await writeFile(legacy, legacyDeclaration);
    await writeFile(standaloneSource, '<script lang="ts">const props = defineProps<{ value: string }>();</script><template>{props.value}</template>');
    await writeFile(standaloneType, legacyDeclaration);
    const foreignDeclaration = [
      'import * as __meeko from "@meekojs/meeko/internal";',
      "/* Text alone must not make this file generator-owned:",
      "export type ComponentProps =",
      "export declare const css =",
      "export declare function renderWithState(__inputProps: ComponentProps)",
      "export declare function renderToString(__inputProps: ComponentProps",
      "export declare function hydrate(root: Element, __inputProps: ComponentProps",
      "export declare function hydrateScope(__scope: __meeko.DomScope, __inputProps: ComponentProps",
      "*/",
      "export interface Keep { value: string }",
      "",
    ].join("\n");
    await writeFile(foreign, foreignDeclaration);

    await checkFrameworkProject(root);
    const generated = join(root, ".meeko", "types", "app", "components", "Card.d.meeko.ts");
    const transitive = join(root, ".meeko", "types", "app", "feature", "Child.d.meeko.ts");
    await assert.rejects(access(legacy), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
    await access(standaloneType);
    await access(generated);
    await access(transitive);
    assert.match(await readFile(generated, "utf8"), /^\/\/ @meeko-generated component-declaration v1/);
    assert.equal(await readFile(foreign, "utf8"), foreignDeclaration);

    await rm(component);
    await assert.rejects(checkFrameworkProject(root), /app[\\/]use\.ts.*TS2307/s);
    await assert.rejects(access(generated), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
    await access(transitive);
    await access(standaloneType);
    assert.equal(await readFile(foreign, "utf8"), foreignDeclaration);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
