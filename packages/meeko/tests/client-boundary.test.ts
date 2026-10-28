import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { checkComponentBoundary, compileWithAutoImports, discoverAutoImportsSync } from "../src/autoimports.ts";
import type { AutoImport } from "../src/autoimports.ts";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import type { CompileDiagnostic } from "../src/compiler/sfc.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { meeko } from "../src/vite.ts";
import { createTempProject } from "./helpers/temp-project.ts";
import type { TempProject } from "./helpers/temp-project.ts";

const component = (script: string, template = "<p>Page</p>", server?: string) => [
  ...(server === undefined ? [] : ['<script server lang="ts">', server, "</script>", ""]),
  '<script lang="ts">',
  script,
  "</script>",
  `<template>${template}</template>`,
  "",
].join("\n");

let temp: TempProject | undefined;
let root: string;
let registry: readonly AutoImport[];
const page = () => join(root, "app", "pages", "index.meeko");

before(async () => {
  temp = await createTempProject("client-boundary");
  root = temp.root;
  await mkdir(join(root, "server", "utils"), { recursive: true });
  await writeFile(join(root, "server", "utils", "users.ts"), "export function findUser(): { name: string } { return { name: \"Ada\" }; }\n");
  await mkdir(join(root, "app", "utils"), { recursive: true });
  await writeFile(join(root, "app", "utils", "format.ts"), "export function formatName(name: string): string { return name.trim(); }\n");
  registry = discoverAutoImportsSync(root);
});

after(async () => {
  await temp?.remove();
});

/** Warnings of the component, or the error it throws as `{ code, text, message }`. */
function boundary(source: string, filename = page()): { warnings: CompileDiagnostic[] } | { code: string; text: string; message: string } {
  try {
    const compiled = compile(source, filename);
    return { warnings: checkComponentBoundary(source, filename, compiled, registry, [join(root, "server")]) };
  } catch (error) {
    if (!(error instanceof MeekoCompileError)) throw error;
    const { offset } = error.diagnostic.location;
    return { code: error.diagnostic.code, text: source.slice(offset, offset + 16), message: error.diagnostic.message };
  }
}

function failure(source: string, filename?: string): { code: string; text: string; message: string } {
  const result = boundary(source, filename);
  assert.ok("code" in result, `expected an error, got ${JSON.stringify(result)}`);
  return result;
}

function warnings(source: string, filename?: string): Array<[string, string]> {
  const result = boundary(source, filename);
  assert.ok("warnings" in result, `expected no error, got ${JSON.stringify(result)}`);
  return result.warnings.map((item) => [item.code, source.slice(item.location.offset, item.location.offset + 10)]);
}

describe("server-only APIs in a component <script> and template", () => {
  test("framework server definitions are MEEK108 where they are used, with the place where they belong", () => {
    const route = failure(component("const handler = defineApiRoute({});"));
    assert.deepEqual([route.code, route.text.slice(0, 14)], ["MEEK108", "defineApiRoute"]);
    assert.match(route.message, /@meekojs\/meeko\/server, que sólo existe en el servidor/);
    assert.match(route.message, /server\/api/);
    for (const name of ["defineRpc", "defineServerMiddleware", "defineSocketChannel", "defineServerRuntime"]) {
      assert.equal(failure(component(`const value = ${name}({} as never);`)).code, "MEEK108", name);
    }
    // In the template too, and ApiError points at ClientError.
    const template = failure(component("const count = signal(0);", "<p>{String(ApiError)}{count.value}</p>"));
    assert.deepEqual([template.code, template.text.slice(0, 8)], ["MEEK108", "ApiError"]);
    assert.match(template.message, /ClientError/);
  });

  test("a server/utils autoimport is MEEK108 with its file", () => {
    const error = failure(component("const user = findUser();", "<p>{user.name}</p>"));
    assert.deepEqual([error.code, error.text.slice(0, 8)], ["MEEK108", "findUser"]);
    assert.match(error.message, /server\/utils\/users\.ts/);
    assert.equal(failure(component("", "<p>{findUser().name}</p>")).text.slice(0, 8), "findUser");
  });

  test("value imports of server entries and server modules are MEEK108 or MEEK109; type imports are not", () => {
    // /server and /cloudflare fail to load in the browser: an error.
    for (const entry of ["server", "cloudflare"]) {
      const error = failure(component(`import { x } from "@meekojs/meeko/${entry}";\nconsole.log(x);`));
      assert.deepEqual([error.code, error.text.slice(0, 15)], ["MEEK108", '"@meekojs/meeko'], entry);
    }
    assert.match(failure(component('import { ApiError } from "@meekojs/meeko/server";')).message, /import type/);
    // The runtime entries load, and only their functions fail in the browser: a warning until 2.0.
    for (const entry of ["node", "bun", "deno", "password", "build"]) {
      assert.deepEqual(warnings(component(`import { x } from "@meekojs/meeko/${entry}";\nconsole.log(x);`)), [["MEEK109", '"@meekojs/']], entry);
    }
    assert.deepEqual(warnings(component('import "@meekojs/meeko/node";')), [["MEEK109", '"@meekojs/']]);
    assert.equal(failure(component('import { db } from "../../server/db.js";\nconsole.log(db);')).code, "MEEK108");
    assert.equal(failure(component('import { secret } from "./secret.server.js";\nconsole.log(secret);')).code, "MEEK108");
    assert.equal(failure(component('import { findUser as find } from "../../server/utils/users";\nfind();')).code, "MEEK108");
    assert.deepEqual(warnings(component([
      'import type { RequestContext } from "@meekojs/meeko/server";',
      'import { type ApiRouteDefinition } from "@meekojs/meeko/server";',
      'import type { Row } from "../../server/db.js";',
      "let context: RequestContext | undefined;",
      "let route: ApiRouteDefinition<never, never, never> | undefined;",
      "let row: Row | undefined;",
    ].join("\n"))), []);
  });

  test("the request APIs of <script server> are MEEK073 without an import, in the script and the template", () => {
    const script = failure(component("const { params } = usePage();"));
    assert.deepEqual([script.code, script.text.slice(0, 7)], ["MEEK073", "usePage"]);
    assert.match(script.message, /<script server>/);
    assert.equal(failure(component("", '<button on:click="() => redirect(\'/\')">Go</button>')).text.slice(0, 8), "redirect");
    assert.equal(failure(component("function missing() { notFound(); }")).code, "MEEK073");
  });

  test("definePage in the component is the MEEK109 warning, with or without an import", () => {
    assert.deepEqual(warnings(component("const route = definePage({ render: \"client\" });")), [["MEEK109", "definePage"]]);
    assert.deepEqual(warnings(component('import { definePage as page } from "@meekojs/meeko/framework";\nconst route = page({});')), [["MEEK109", "definePage"]]);
    assert.deepEqual(warnings(component("", "<p>{String(definePage)}</p>")), [["MEEK109", "definePage"]]);
  });

  test("browser APIs, local names and components under server/ are left alone", async () => {
    assert.deepEqual(warnings(component([
      "const count = signal(0);",
      "const name = formatName(\" Ada \");",
      "useHead({ title: name });",
      "function redirect(to: string): string { return to; }",
      "const definePage = (value: number) => value;",
      "const findUser = () => ({ name: redirect(\"/\") + definePage(1) });",
      "const route = useRoute();",
    ].join("\n"), "<p>{findUser().name}{count.value}{route.path}</p>")), []);
    // A component under server/ (an e-mail template) only renders on the server.
    const email = join(root, "server", "emails", "Welcome.meeko");
    const source = component("const user = findUser();\nconst error = new ApiError(400, \"BAD\");", "<p>{user.name}{error.code}</p>");
    const compiled = await compileWithAutoImports(source, email, {}, "server", registry);
    assert.match(compiled.code, /findUser/);
    assert.equal(compiled.warnings, undefined);
  });

  test("a render: \"client\" page keeps its route options in <script server> and the browser APIs in <script>", () => {
    const source = component(
      "const props = defineProps<{ data: { name: string } }>();\nconst name = signal(props.data.name);",
      "<p>{name.value}</p>",
      'export const route = definePage({ render: "client", load: async () => ({ name: "Ada" }) });',
    );
    assert.deepEqual(warnings(source), []);
  });
});

describe("component APIs in <script server>", () => {
  const server = (code: string) => component("const props = defineProps<{ data: unknown }>();", "<p>{String(props.data)}</p>", code);

  test("compiler macros and onMounted are MEEK108 in the block", () => {
    for (const [code, name] of [
      ["const props = defineProps<{ id: string }>();\nexport const user = { id: props.id };", "defineProps"],
      ["export const route = definePage({ load: () => { onMounted(() => undefined); return 1; } });", "onMounted"],
      ['import { onMounted } from "@meekojs/meeko";\nexport const route = definePage({});', "onMounted"],
      ["const emit = defineEmits<{ save: [] }>();\nexport const route = definePage({});", "defineEmits"],
      ['export const route = definePage({ render: "client", load: () => { useElementRef("x"); return 1; } });', "useElementRef"],
    ] as const) {
      let error: MeekoCompileError | undefined;
      try { compile(server(code), page()); }
      catch (caught) { if (caught instanceof MeekoCompileError) error = caught; else throw caught; }
      assert.ok(error, name);
      const source = server(code);
      assert.deepEqual([error.diagnostic.code, source.slice(error.diagnostic.location.offset, error.diagnostic.location.offset + name.length)], ["MEEK108", name]);
      assert.match(error.diagnostic.message, /sólo existe en el <script> de un componente/);
    }
  });

  test("the block keeps signal, its own names and the framework APIs", () => {
    assert.doesNotThrow(() => compile(server([
      "const onMounted = (fn: () => void) => fn();",
      "onMounted(() => undefined);",
      "const total = signal(1);",
      "export const count = total.value;",
    ].join("\n")), page()));
  });
});

describe("meeko check, meeko build and the editor report the boundary", () => {
  let created: TempProject | undefined;
  let project: string;

  before(async () => {
    created = await createTempProject("client-boundary-check");
    project = created.root;
    await initFrameworkProject(project);
    await mkdir(join(project, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(project, "node_modules", "@meekojs", "meeko"), "junction");
    await symlink(resolve("node_modules", "vite"), join(project, "node_modules", "vite"), "junction");
    await mkdir(join(project, "server", "utils"), { recursive: true });
    await writeFile(join(project, "server", "utils", "users.ts"), "export function findUser(): { name: string } { return { name: \"Ada\" }; }\n");
  });

  after(async () => {
    await created?.remove();
  });

  test("checkSource reports MEEK108 and MEEK109 at the name; the project check keeps the warning", { timeout: 180_000 }, async () => {
    const file = join(project, "app", "pages", "index.meeko");
    const server = component("const user = findUser();", "<p>{user.name}</p>");
    await writeFile(file, server);
    const errors = await checkSource(server, file);
    assert.deepEqual(errors.map((item) => [item.code, server.slice(item.location.offset, item.location.offset + 8)]), [["MEEK108", "findUser"]]);

    const options = component("const route = definePage({});", "<p>Page</p>");
    await writeFile(file, options);
    const diagnostics = await checkSource(options, file);
    assert.deepEqual(diagnostics.map((item) => [item.code, item.severity]), [["MEEK109", "warning"]]);
    const project_ = await checkFrameworkProject(project);
    assert.ok(project_.some((item) => item.code === "MEEK109" && item.severity === "warning"), JSON.stringify(project_));

    // The Vite plugin stops the browser transform; the SSR one compiles it, as in 1.2, so a component
    // that only server code imports (an email template rendered by an API route) still builds.
    await writeFile(file, server);
    const plugin = meeko();
    const transform = plugin.transform as (this: unknown, source: string, id: string, options?: { ssr?: boolean }) => Promise<{ code: string } | null>;
    const configure = (ssr: boolean): void => (plugin.configResolved as (config: unknown) => void)({ command: "build", build: { ssr }, root: project });
    configure(false);
    await assert.rejects(transform.call({ resolve: async () => null }, server, file, { ssr: false }), /MEEK108/);
    configure(true);
    assert.match((await transform.call({ resolve: async () => null }, server, file, { ssr: true }))!.code, /findUser/);
    const email = join(project, "app", "emails", "Welcome.meeko");
    await mkdir(dirname(email), { recursive: true });
    const emailSource = component('const failure = new ApiError("NOT_FOUND", 404);', "<p>{failure.code}</p>");
    await writeFile(email, emailSource);
    assert.match((await transform.call({ resolve: async () => null }, emailSource, email, { ssr: true }))!.code, /ApiError/);
    configure(false);
    await assert.rejects(transform.call({ resolve: async () => null }, emailSource, email, { ssr: false }), /MEEK108/);
  });
});
