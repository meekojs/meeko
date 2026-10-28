import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { discoverAutoImports } from "../src/autoimports.ts";
import { generateAutoImportTypes, transformTypeScriptAutoImports } from "../src/autoimports-ts.ts";
import { checkApp } from "../src/framework/check-app.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { generateServerContracts } from "../src/framework/contracts-generate.ts";
import { generateSocketContracts } from "../src/framework/socket-contracts-generate.ts";
import { prepareFrameworkTypeDeclarations } from "../src/framework/type-declarations.ts";

async function project(prefix: string, files: Record<string, string>, linked = true): Promise<string> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko", prefix));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  if (linked) {
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
  }
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return root;
}

const autoImportedModules = {
  "shared/enums/scope.ts": 'export enum Scope { App = "app", Server = "server" }\n',
  // An autoimported enum used as a type, including one of its members.
  "shared/types/row.ts": "export interface Row { readonly folder: string; readonly scope: Scope; readonly app?: Scope.App }\n",
  "shared/constants/rows.ts": 'export const MAX_SLUG_LENGTH = 48;\nexport const ROWS: readonly Row[] = [{ folder: "app/pages", scope: Scope.App }];\n',
  "shared/utils/slugify.ts": "export function slugify(text: string): string { return text.toLowerCase().slice(0, MAX_SLUG_LENGTH); }\n",
  "app/composables/useCounter.ts": "export function useCounter(initial = 0) {\n  const count = signal(initial);\n  const doubled = computed(() => count.value * 2);\n  return { count, doubled };\n}\n",
  "app/stores/reviewed.ts": 'export function useReviewed() { return useState<string[]>("reviewed", () => []); }\n',
  "app/components/Badge.meeko": '<script lang="ts">const label = "badge";</script><template><span>{label}</span></template>\n',
  "app/pages/about.meeko": '<script lang="ts">const title = "About";</script><template><h1>{title}</h1></template>\n',
};

const page = (body: string) => [
  '<script lang="ts">',
  "const counter = useCounter(1);",
  "const reviewed = useReviewed();",
  'const slug = slugify("Hello World");',
  "const first: Row | undefined = ROWS[0];",
  "const scope: Scope = Scope.Server;",
  body,
  "</script>",
  "<template><p>{counter.count.value} {counter.doubled.value} {reviewed.value.length} {slug} {first?.folder} {scope} {link}</p></template>",
  "",
].join("\n");

test("meeko check sees autoimports in .ts modules imported by a page and the generated route ids", async () => {
  const root = await project("check-autoimports-", {
    ...autoImportedModules,
    "app/pages/index.meeko": page('const link = href("/about", { search: { tab: "a" } });'),
  });
  try {
    await prepareFrameworkTypeDeclarations(root);
    const diagnostics = await checkApp(root);
    assert.deepEqual(diagnostics.map((item) => `${item.filename}:${item.code}: ${item.message}`), []);
    await checkFrameworkProject(root);

    // A route id that does not exist is reported once routes.d.ts is part of the program.
    await writeFile(join(root, "app", "pages", "index.meeko"), page('const link = href("/no-existe-xyz");'));
    const invalid = await checkApp(root);
    assert.ok(invalid.some((item) => item.filename === join(root, "app", "pages", "index.meeko") && /TS2769|TS2345/.test(item.code)), JSON.stringify(invalid));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("autoimported enums and classes declare their type as well as their value", async () => {
  const root = await project("autoimports-enum-", {
    "shared/enums/scope.ts": 'export enum Scope { App = "app", Server = "server" }\nexport const enum Flag { On = 1 }\n',
    "shared/utils/box.ts": "class Box { constructor(readonly value: number) {} }\nexport { Box };\nexport class Pair { constructor(readonly left: number, readonly right: number) {} }\n",
    "shared/types/merged.ts": 'export const Mode = { Light: "light" } as const;\nexport type Mode = (typeof Mode)[keyof typeof Mode];\n',
  }, false);
  try {
    const output = await generateAutoImportTypes(root);
    const shared = await readFile(output.shared, "utf8");
    for (const name of ["Scope", "Flag", "Box", "Pair", "Mode"]) {
      assert.match(shared, new RegExp(`export import ${name} = __meeko_type_\\d+\\.${name};`), name);
    }
    const registry = await discoverAutoImports(root);
    const file = join(root, "shared", "utils", "use.ts");
    const asValue = transformTypeScriptAutoImports("export const scope: Scope = Scope.App;", file, root, registry) ?? "";
    assert.match(asValue, /^import \{ Scope as Scope \} from "\.\.\/enums\/scope\.js";$/m);
    const asType = transformTypeScriptAutoImports("export function read(scope: Scope, app: Scope.App, kind: typeof Scope): Mode { return \"light\"; }", file, root, registry) ?? "";
    assert.match(asType, /^import type \{ Scope as Scope \} from "\.\.\/enums\/scope\.js";$/m);
    assert.match(asType, /^import type \{ Mode as Mode \} from "\.\.\/types\/merged\.js";$/m);
    const classes = transformTypeScriptAutoImports("export class Wide extends Pair implements Box {}\nexport const box: Box = new Box(1);", file, root, registry) ?? "";
    assert.match(classes, /^import \{ Pair as Pair \}/m);
    assert.match(classes, /^import \{ Box as Box \}/m);
    const implemented = transformTypeScriptAutoImports("export class Only implements Pair { left = 1; right = 2; }", file, root, registry) ?? "";
    assert.match(implemented, /^import type \{ Pair as Pair \}/m);
    const instantiated = transformTypeScriptAutoImports("export const make = Array<Pair>;\nexport const mode = Mode.Light;", file, root, registry) ?? "";
    assert.match(instantiated, /^import type \{ Pair as Pair \}/m);
    assert.match(instantiated, /^import \{ Mode as Mode \}/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const schemaModules = {
  "shared/utils/schema.ts": [
    "export const schema = <I, O = I>() => ({ \"~standard\": { version: 1 as const, vendor: \"test\", types: undefined as unknown as { input: I; output: O }, validate: (value: unknown) => ({ value: value as O }) } });",
    "export const enumSchema = <E extends Record<string, string>>(values: E) => { void values; return schema<E[keyof E]>(); };",
    "",
  ].join("\n"),
  "shared/enums/scope.ts": 'export enum Scope { App = "app", Server = "server" }\n',
  "shared/schemas/convention.ts": [
    "export const conventionQuery = schema<{ scope?: string | string[] }>();",
    "export const conventionRow = schema<{ folder: string; scope: Scope }>();",
    "export const scopeSchema = enumSchema(Scope);",
    "export const slugInput = schema<{ text: string }>();",
    "",
  ].join("\n"),
};

test("server contracts accept shared schemas and enums reached through autoimports", async () => {
  const root = await project("contracts-autoimports-", {
    ...schemaModules,
    "server/api/conventions.get.ts": [
      'import { defineApiRoute } from "@meekojs/meeko/server";',
      "export default defineApiRoute({ query: conventionQuery, response: conventionRow, handler: async () => ({ folder: \"app\", scope: Scope.App }) });",
      "",
    ].join("\n"),
    "server/rpc/scope.ts": [
      'import { defineRpc } from "@meekojs/meeko/server";',
      "export default defineRpc({ input: slugInput, output: scopeSchema, handler: async () => Scope.Server });",
      "",
    ].join("\n"),
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, skipLibCheck: true, noEmit: true } }),
  });
  try {
    const generated = await generateServerContracts(root);
    assert.equal(generated.apiCount, 1);
    assert.equal(generated.rpcCount, 1);
    const declaration = await readFile(generated.types, "utf8");
    assert.match(declaration, /typeof import\("\.\.\/\.\.\/shared\/schemas\/convention\.js"\)\["conventionQuery"\]/);
    assert.match(declaration, /typeof import\("\.\.\/\.\.\/shared\/schemas\/convention\.js"\)\["scopeSchema"\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("server contracts still reject autoimported schemas that do not live in shared/", async () => {
  const root = await project("contracts-autoimports-private-", {
    ...schemaModules,
    "server/utils/private.ts": "export const privateQuery = schema<{ scope?: string }>();\n",
    "server/api/private.get.ts": [
      'import { defineApiRoute } from "@meekojs/meeko/server";',
      "export default defineApiRoute({ query: privateQuery, response: conventionRow, handler: async () => ({ folder: \"app\", scope: Scope.App }) });",
      "",
    ].join("\n"),
  });
  try {
    await assert.rejects(generateServerContracts(root), /query debe venir de shared\//);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Socket contracts accept shared schemas reached through autoimports", async () => {
  const root = await project("socket-autoimports-", {
    ...schemaModules,
    "server/socket/conventions.ts": "export default defineSocketChannel({ clientToServer: { pick: scopeSchema }, serverToClient: { row: conventionRow } });\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" } }),
  }, false);
  try {
    const generated = await generateSocketContracts(root);
    assert.equal(generated.count, 1);
    const code = await readFile(generated.file, "utf8");
    assert.match(code, /import \* as __schema0 from "\.\.\/\.\.\/shared\/schemas\/convention\.js"/);
    assert.match(code, /"pick": __schema0\["scopeSchema"\]/);
    assert.match(code, /"row": __schema0\["conventionRow"\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("meeko check sees imports.appDirs in components and imports.sharedDirs in server/, each in its scope", { timeout: 180_000 }, async () => {
  const pageWith = (script: string) => `<script lang="ts">\n${script}\n</script>\n<template><p>{label}</p></template>\n`;
  const root = await project("check-import-dirs-", {
    "meeko.config.ts": 'export default { imports: { appDirs: ["app/services"], sharedDirs: ["shared/validators"] } };\n',
    "app/services/price.ts": "export function formatPrice(value: number): string { return `$${value.toFixed(2)}`; }\n",
    "app/services/secret.server.ts": "export function readSecret(): string { return \"secret\"; }\n",
    "shared/validators/email.ts": "export function isEmail(value: string): boolean { return /^[^@\s]+@[^@\s]+$/.test(value); }\n",
    "app/pages/index.meeko": pageWith('const label: string = `${formatPrice(3)} ${isEmail("a@b.c")}`;'),
    "shared/schemas/signup.ts": [
      "export const signupResult = { \"~standard\": {",
      "  version: 1 as const, vendor: \"test\", validate: (value: unknown) => ({ value: value as { valid: boolean } }),",
      "  types: undefined as unknown as { input: { valid: boolean }; output: { valid: boolean } },",
      "} };",
      "",
    ].join("\n"),
    "server/api/signup.post.ts": 'export default defineApiRoute({ response: signupResult, handler: () => ({ valid: isEmail("a@b.c") }) });\n',
  });
  try {
    await checkFrameworkProject(root);

    // An app/ folder is not available to shared/.
    const shared = join(root, "shared", "utils", "total.ts");
    await mkdir(dirname(shared), { recursive: true });
    await writeFile(shared, "export const total: string = formatPrice(1);\n");
    await assert.rejects(checkFrameworkProject(root), /shared[\/]utils[\/]total\.ts.*TS2304.*formatPrice/s);
    await rm(shared);

    // A `.server.ts` module of an app/ folder is server-only: MEEK108 in a component.
    await writeFile(join(root, "app", "pages", "index.meeko"), pageWith("const label: string = readSecret();"));
    const diagnostics = await checkApp(root);
    assert.deepEqual(diagnostics.map((item) => item.code), ["MEEK108"]);
    assert.match(diagnostics[0]!.message, /readSecret viene de .*secret\.server\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
