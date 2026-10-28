import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import postcss from "postcss";
import { createServer } from "vite";
import type { Location } from "vscode-languageserver/node";
import { buildProjectAliases, checkAliasScopes, resolveProjectAliases, viteAliasShadow } from "../src/framework/aliases.ts";
import { checkApp } from "../src/framework/check-app.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { loadMeekoConfig, readMeekoConfigSync } from "../src/framework/config.ts";
import { buildProject } from "../src/framework/project.ts";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { completionList, definition } from "../src/language-server/features.ts";
import { meekoUtilities } from "../src/postcss.ts";
import { meeko } from "../src/vite.ts";
import { languageProject } from "./language-server-workspace.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const file = join(root, ...path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
}

/**
 * A project that uses the four default aliases, an alias of `alias` and a layer: the page reads
 * `@/`, `~/` and `ui/` in its `<script>`, its sidecar `#server/` and `#shared/`, and the layer's
 * page `@/` for one file of its own and one that the project overrides.
 */
const aliasProject: Record<string, string> = {
  "package.json": `${JSON.stringify({ name: "alias-app", private: true, type: "module", dependencies: { "@meekojs/meeko": "*" } })}\n`,
  "meeko.config.mjs": 'export default { layers: ["./layers/base"], alias: { "ui/": "app/ui/" }, server: { adapter: "static" } };\n',
  "server/secret.ts": 'export const secretName = "ada";\n',
  "shared/text.ts": "export const shout = (value: string): string => value.toUpperCase();\n",
  "shared/palette.ts": 'export const palette = ["red", "blue"] as const;\n',
  "app/lib/greeting.ts": 'import { shout } from "#shared/text";\n\nexport const greeting = (name: string): string => `Hola ${shout(name)}`;\n',
  "app/lib/label.ts": 'export const label = "etiqueta";\n',
  "app/lib/shadow.ts": 'export const who = "project";\n',
  "app/lib/scale.ts": "export const scale = (step: number): string => `${step * 4}px`;\n",
  "app/ui/Badge.meeko": '<template><b id="badge">ui</b></template>\n',
  "app/pages/index.meeko": [
    '<script lang="ts">',
    'import { greeting } from "@/lib/greeting";',
    'import { label } from "~/app/lib/label";',
    'import * as Badge from "ui/Badge.meeko";',
    "export interface Props { params: Record<string, string>; search: Record<string, string | string[]>; data: { name: string } }",
    "const props = defineProps<Props>();",
    "</script>",
    '<template><p id="greeting">{greeting(props.data.name)}</p><p id="label">{label}</p><Badge /></template>',
    "",
  ].join("\n"),
  "app/pages/index.route.ts": [
    'import { definePage } from "@meekojs/meeko/framework";',
    'import { secretName } from "#server/secret";',
    'import { shout } from "#shared/text";',
    "",
    'export const route = definePage({ render: "prerender", load: () => ({ name: shout(secretName) }) });',
    "",
  ].join("\n"),
  "layers/base/app/lib/layer-only.ts": 'export const fromLayer = "layer";\n',
  "layers/base/app/lib/shadow.ts": 'export const who = "layer";\n',
  "layers/base/app/pages/base.meeko": [
    '<script lang="ts">',
    'import { fromLayer } from "@/lib/layer-only";',
    'import { who } from "@/lib/shadow";',
    "</script>",
    '<template><p id="base">{fromLayer}:{who}</p></template>',
    "",
  ].join("\n"),
  "layers/base/app/pages/base.route.ts": 'import { definePage } from "@meekojs/meeko/framework";\n\nexport const route = definePage({ render: "prerender" });\n',
};

async function aliasApp(context: { after(fn: () => Promise<void>): void }, prefix: string, extra: Record<string, string> = {}): Promise<string> {
  const root = await tempProject(context, prefix);
  await write(root, { ...aliasProject, ...extra });
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
  return root;
}

test("the default aliases resolve in each source root, alias adds or turns them off and a package.json import wins", async (context) => {
  const root = await tempProject(context, "alias-unit");
  await write(root, {
    "package.json": `${JSON.stringify({ private: true, type: "module", imports: { "#shared/*": "./lib/shared/*" } })}\n`,
    "meeko.config.mjs": 'export default { alias: { "lib/": "app/lib/", "secret/": "server/secret/", "#server/": false, "~/": "src/" } };\n',
  });
  const layer = join(root, "layers", "base");
  const config = await loadMeekoConfig(root);
  const { aliases } = buildProjectAliases(root, [root, layer], config.alias);
  const byPrefix = Object.fromEntries(aliases.map((alias) => [alias.prefix, alias]));
  // `#shared/` yields to the subpath import of package.json, `#server/` is turned off.
  assert.deepEqual(Object.keys(byPrefix).sort(), ["@/", "lib/", "secret/", "~/"]);
  assert.deepEqual(byPrefix["@/"]!.targets, [join(root, "app"), join(layer, "app")]);
  assert.equal(byPrefix["@/"]!.scope, "app");
  // A configured alias names one folder and takes its scope.
  assert.deepEqual(byPrefix["~/"]!.targets, [join(root, "src")]);
  assert.equal(byPrefix["~/"]!.scope, "shared");
  assert.equal(byPrefix["lib/"]!.scope, "app");
  assert.equal(byPrefix["secret/"]!.scope, "server");
  // `meeko dev`, `build` and `check` say once that package.json wins.
  const stderrWrite = process.stderr.write;
  const warnings: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array) => { warnings.push(String(chunk)); return true; }) as typeof process.stderr.write;
  try {
    await resolveProjectAliases(root);
    await resolveProjectAliases(root);
  } finally {
    process.stderr.write = stderrWrite;
  }
  assert.equal(warnings.length, 1, warnings.join(""));
  assert.match(warnings[0]!, /package\.json declara "imports" con "#shared\/\*", que coincide con el alias #shared\/ de Meeko\. Gana el de package\.json/);
  // The editor reads a literal `alias` without running the configuration.
  assert.deepEqual(readMeekoConfigSync(root).alias, { "lib/": "app/lib/", "secret/": "server/secret/", "#server/": false, "~/": "src/" });

  for (const [alias, message] of [
    ['"app/lib/"', /alias must be an object of path prefixes/],
    ['{ "lib": "app/lib/" }', /alias "lib" must be a prefix that ends in \//],
    ['{ "./x/": "app/" }', /alias "\.\/x\/" must be a prefix that ends in \//],
    ['{ "lib/": 1 }', /alias "lib\/" must name a folder of the project/],
    ['{ "lib/": "../outside/" }', /alias "lib\/" must be a relative path inside the project/],
  ] as const) {
    await writeFile(join(root, "meeko.config.mjs"), `export default { alias: ${alias} };\n`);
    await assert.rejects(loadMeekoConfig(root), (error: Error) => error instanceof TypeError && message.test(error.message) && error.message.includes("meeko.config.mjs: alias"));
  }
});

test("meeko check resolves the four aliases, alias and a layer; #server/ outside the server is MEEK108 and @/ in shared/ MEEK118", { timeout: 240_000 }, async (context) => {
  const root = await aliasApp(context, "alias-check");
  await checkFrameworkProject(root);
  const tsconfig = async (name: string): Promise<Record<string, string[]>> =>
    (JSON.parse(await readFile(join(root, ".meeko", `tsconfig.${name}.json`), "utf8")) as { compilerOptions: { paths: Record<string, string[]> } }).compilerOptions.paths;
  const [app, server, shared] = await Promise.all(["app", "server", "shared"].map(tsconfig));
  assert.deepEqual(Object.keys(app!).sort(), ["#shared/*", "@/*", "ui/*", "~/*"]);
  assert.deepEqual(Object.keys(server!).sort(), ["#server/*", "#shared/*", "@/*", "ui/*", "~/*"]);
  assert.deepEqual(Object.keys(shared!).sort(), ["#shared/*", "~/*"]);
  // The project, then the layer; each followed by the declarations of its components.
  assert.deepEqual(app!["@/*"], ["../app/*", "./types/app/*", "../layers/base/app/*", "./types/layers/base/app/*"]);
  assert.deepEqual(server!["#server/*"], ["../server/*", "./types/server/*", "../layers/base/server/*", "./types/layers/base/server/*"]);

  await write(root, {
    "app/lib/leak.ts": 'import { secretName } from "#server/secret";\n\nexport const leak = secretName;\n',
    "shared/reach.ts": 'import type { greeting } from "@/lib/greeting";\n\nexport type Greeting = typeof greeting;\n',
    "app/pages/leak.meeko": '<script lang="ts">\nimport type { secretName } from "#server/secret";\nconst value: typeof secretName = "x";\n</script>\n<template><p>{value}</p></template>\n',
  });
  const diagnostics = await checkApp(root);
  const found = (file: string, code: string): boolean => diagnostics.some((item) => item.filename === join(root, ...file.split("/")) && item.code === code);
  assert.ok(found("app/lib/leak.ts", "MEEK108"), JSON.stringify(diagnostics));
  assert.ok(found("shared/reach.ts", "MEEK118"), JSON.stringify(diagnostics));
  assert.ok(found("app/pages/leak.meeko", "MEEK108"), JSON.stringify(diagnostics));
  const leak = diagnostics.find((item) => item.code === "MEEK108" && item.filename.endsWith("leak.ts"))!;
  assert.equal(leak.location.line, 1);
  assert.match(leak.message, /#server\/secret: el alias #server\/ apunta a código que sólo existe en el servidor/);
});

test("meeko dev resolves the aliases in the browser and SSR graphs, the project before its layers", { timeout: 120_000 }, async (context) => {
  const root = await aliasApp(context, "alias-dev", {
    "layers/base/app/lib/probe.ts": 'import { fromLayer } from "@/lib/layer-only";\nimport { who } from "@/lib/shadow";\n\nexport const probe = `${fromLayer}:${who}`;\n',
    "app/lib/client-leak.ts": 'import { secretName } from "#server/secret";\n\nexport const leak = secretName;\n',
    "app/lib/server-reach.ts": 'export { secretName } from "~/server/secret";\n',
  });
  const server = await createServer({ root, configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "silent" });
  try {
    const greeting = await server.ssrLoadModule("/app/lib/greeting.ts") as { greeting(name: string): string };
    assert.equal(greeting.greeting("ada"), "Hola ADA");
    const probe = await server.ssrLoadModule("/layers/base/app/lib/probe.ts") as { probe: string };
    assert.equal(probe.probe, "layer:project");
    const client = await server.transformRequest("/app/lib/greeting.ts");
    assert.match(client?.code ?? "", /from "\/shared\/text\.ts"/);
    const page = await server.transformRequest("/app/pages/index.meeko");
    assert.match(page?.code ?? "", /"\/app\/ui\/Badge\.meeko(?:\?import)?"/);
    assert.match(page?.code ?? "", /"\/app\/lib\/greeting\.ts"/);
    // The browser graph stops at #server/ and at a server/ module reached through ~/.
    await assert.rejects(server.transformRequest("/app/lib/client-leak.ts"), /MEEK108: .*app\/lib\/client-leak\.ts: #server\/secret: el alias #server\//);
    await assert.rejects(server.transformRequest("/app/lib/server-reach.ts"), /imports server-only module ~\/server\/secret/);
  } finally {
    await server.close();
  }
});

test("meeko build resolves the aliases with the static and bun adapters, and #server/ in a component stops it with MEEK108", { timeout: 300_000 }, async (context) => {
  const root = await aliasApp(context, "alias-build");
  const result = await buildProject(root);
  const read = (file: string): Promise<string> => readFile(join(result.output, ...file.split("/")), "utf8");
  const home = await read("index.html");
  assert.match(home, /<p id="greeting">(?:<!--[^>]*-->)?Hola ADA/);
  assert.match(home, /<p id="label">(?:<!--[^>]*-->)?etiqueta/);
  assert.match(home, /<b id="badge">ui<\/b>/);
  assert.match(await read("base/index.html"), /<p id="base">(?:<!--[^>]*-->)?layer(?:<!--[^>]*-->)?:(?:<!--[^>]*-->)?project/);

  const bun = await buildProject(root, { adapter: "bun" });
  const bundle = await readFile(join(bun.output, "index.js"), "utf8");
  assert.doesNotMatch(bundle, /["']#server\/secret["']|["']@\/lib\/greeting["']/);

  await write(root, { "app/pages/leak.meeko": '<script lang="ts">\nimport { secretName } from "#server/secret";\n</script>\n<template><p>{secretName}</p></template>\n' });
  await assert.rejects(buildProject(root, { adapter: "node" }), /MEEK108[^]*#server\/secret/);
});

test("@utilities modules resolve the aliases, also in the modules they import", { timeout: 120_000 }, async (context) => {
  const root = await aliasApp(context, "alias-utilities", {
    "app/styles/utilities/tokens.ts": [
      'import { defineUtilities } from "@meekojs/meeko/postcss";',
      'import { palette } from "#shared/palette";',
      'import { gap } from "@/styles/utilities/gap";',
      "",
      "export default defineUtilities(({ rule }) => palette.map((color) => rule(`.text-${color}`, { color, padding: gap })));",
      "",
    ].join("\n"),
    "app/styles/utilities/gap.ts": 'import { scale } from "~/app/lib/scale";\n\nexport const gap = scale(2);\n',
    "app/styles/utilities/leak.ts": 'import { secretName } from "#server/secret";\n\nexport default ({ rule }: import("@meekojs/meeko/postcss").UtilityHelpers) => rule(".leak", { content: `"${secretName}"` });\n',
  });
  const generate = (css: string) => postcss([meekoUtilities()]).process(css, { from: join(root, "app", "styles", "main.css") });
  const { css } = await generate('@utilities "./utilities/tokens.ts";\n');
  assert.match(css, /\.text-red \{\s*color: red;\s*padding: 8px/);
  assert.match(css, /\.text-blue \{\s*color: blue;/);
  await assert.rejects(generate('@utilities "./utilities/leak.ts";\n'), /MEEK108: app\/styles\/utilities\/leak\.ts: #server\/secret/);
});

test("the editor completes the folders after an alias, goes to the aliased module and marks #server/ in a component with MEEK108", { timeout: 60_000 }, async () => {
  const workspace = await languageProject("aliases-", {
    "app/lib/greeting.ts": "export const greeting = (name: string): string => `Hola ${name}`;\n",
    "shared/text.ts": "export const shout = (value: string): string => value.toUpperCase();\n",
    "server/secret.ts": 'export const secretName = "ada";\n',
    "app/pages/index.meeko": [
      "<script server lang=\"ts\">",
      'import { secretName } from "#server/secret";',
      "export const name = secretName;",
      "</script>",
      '<script lang="ts">',
      'import { greeting } from "@/lib/greeting";',
      'import { shout } from "#shared/text";',
      'import type {} from "~/";',
      'import type {} from "@/";',
      'import * as Badge from "@/ui/Badge.meeko";',
      "</script>",
      "<template><p>{greeting(shout(\"x\"))}</p><Badge /></template>",
      "",
    ].join("\n"),
    "app/ui/Badge.meeko": "<template><b>ui</b></template>\n",
    "app/pages/leak.meeko": '<script lang="ts">\nimport { secretName } from "#server/secret";\n</script>\n<template><p>{secretName}</p></template>\n',
  });
  try {
    const component = await workspace.open("app/pages/index.meeko");
    const labels = (needle: string, delta: number): string[] =>
      (completionList(component, component.at(needle, delta))?.items ?? []).map((item) => item.label);
    const offers = (needle: string, delta: number, name: string): void => {
      const found = labels(needle, delta);
      assert.ok(found.some((label) => label === name || label === `${name}.js`), `${needle}: ${found.join(", ")}`);
    };
    offers('"@/"', 3, "lib");
    offers('"@/lib/greeting"', 7, "greeting");
    for (const folder of ["app", "server", "shared"]) offers('"~/"', 3, folder);
    offers('"#shared/text"', 9, "text");
    offers('"#server/secret"', 9, "secret");
    const [target] = definition(component, component.at("greeting }", 0)) as Location[];
    assert.ok(target?.uri.endsWith("/app/lib/greeting.ts"), JSON.stringify(target));
    const [server] = definition(component, component.at("secretName }", 0)) as Location[];
    assert.ok(server?.uri.endsWith("/server/secret.ts"), JSON.stringify(server));
    const [badge] = definition(component, component.at("<Badge", 2)) as Location[];
    assert.ok(badge?.uri.endsWith("/app/ui/Badge.meeko"), JSON.stringify(badge));

    // `#server/` in the component's <script> is MEEK108 in the editor too, on the specifier.
    const leak = await workspace.open("app/pages/leak.meeko");
    const diagnostics = await componentDiagnostics(workspace.project, leak.document, workspace.file("app/pages/leak.meeko"), () => undefined);
    const found = diagnostics.find((item) => item.code === "MEEK108");
    assert.ok(found, JSON.stringify(diagnostics));
    assert.equal(found.range.start.line, 1);
  } finally {
    await workspace.dispose();
  }
});

test("a project path in tsconfig.json wins over the alias of Meeko with the same pattern", { timeout: 60_000 }, async (context) => {
  const root = await aliasApp(context, "alias-user-paths", {
    "tsconfig.json": `${JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "Bundler", paths: { "@/*": ["./src/*"] } }, files: [] })}\n`,
  });
  const { generateFrameworkTsconfigs } = await import("../src/framework/type-declarations.ts");
  await generateFrameworkTsconfigs(root);
  const app = JSON.parse(await readFile(join(root, ".meeko", "tsconfig.app.json"), "utf8")) as { compilerOptions: { paths: Record<string, string[]> } };
  assert.deepEqual(app.compilerOptions.paths["@/*"], ["../src/*"]);
  assert.deepEqual(app.compilerOptions.paths["#shared/*"], ["../shared/*", "./types/shared/*", "../layers/base/shared/*", "./types/layers/base/shared/*"]);

  // In Vite, a `resolve.alias` of the project or of a module runs first.
  const server = await createServer({
    root, configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "silent",
    resolve: { alias: [{ find: /^@\/lib\/label$/, replacement: join(root, "layers", "base", "app", "lib", "layer-only.ts") }] },
  });
  try {
    await write(root, { "app/lib/probe.ts": 'export * from "@/lib/label";\n' });
    assert.deepEqual(Object.keys(await server.ssrLoadModule("/app/lib/probe.ts")), ["fromLayer"]);
  } finally {
    await server.close();
  }
});

test("a prefix that tsconfig.json paths or a module's resolve.alias redefine turns off Meeko's alias, its scope checks included", async (context) => {
  const root = await tempProject(context, "alias-shadow");
  const shared = join(root, "shared", "format.ts");
  const sharedSource = 'import { slug } from "@/utils";\nimport { pick } from "#shared/pick";\n\nexport const format = (value: string): string => pick(slug(value));\n';
  await write(root, {
    "package.json": `${JSON.stringify({ private: true, type: "module" })}\n`,
    "meeko.config.mjs": "export default {};\n",
    "shared/format.ts": sharedSource,
  });
  const scopes = async (): Promise<string[]> => (await checkAliasScopes(await resolveProjectAliases(root, undefined, { warn: false }), [shared], async () => sharedSource)).map((item) => item.code);
  // Meeko's @/ names app/, which shared/ does not see.
  assert.deepEqual(await scopes(), ["MEEK118"]);

  // The project's tsconfig.json redefines @/ and a module redefines #shared/ in Vite.
  await write(root, {
    "tsconfig.json": `${JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"], "~/*": ["./*"] } }, files: [] })}\n`,
    "meeko.config.mjs": [
      "const aliaser = {",
      '  meta: { name: "aliaser" },',
      '  setup(_options, meeko) { meeko.extendViteConfig((config) => { config.resolve = { ...config.resolve, alias: { "#shared": "/elsewhere" } }; }); },',
      '  [Symbol.for("meeko.module")]: true,',
      "};",
      "export default { modules: [aliaser] };",
      "",
    ].join("\n"),
  });
  const stderrWrite = process.stderr.write;
  const warnings: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array) => { warnings.push(String(chunk)); return true; }) as typeof process.stderr.write;
  let prefixes: string[];
  try {
    prefixes = (await resolveProjectAliases(root)).aliases.map((alias) => alias.prefix);
    await resolveProjectAliases(root);
  } finally {
    process.stderr.write = stderrWrite;
  }
  // `~/*` → `./*` is the folder Meeko gives ~/: not a redefinition.
  assert.deepEqual(prefixes.sort(), ["#server/", "~/"]);
  assert.equal(warnings.length, 2, warnings.join(""));
  assert.match(warnings.join(""), /"paths" de tsconfig\.json con "@\/\*" redefine el alias @\/ de Meeko/);
  assert.match(warnings.join(""), /resolve\.alias de Vite .* con "#shared" redefine el alias #shared\/ de Meeko/);
  assert.deepEqual(await scopes(), []);

  // Vite matches a string find followed by `/`, or a regular expression.
  assert.equal(viteAliasShadow({ "@": "/src" }, "@/"), "@");
  assert.equal(viteAliasShadow([{ find: /^@\//, replacement: "/src/" }], "@/"), String(/^@\//));
  assert.equal(viteAliasShadow([{ find: "@/", replacement: "/src/" }], "@/"), undefined);
  assert.equal(viteAliasShadow([{ find: /^@\/lib\/label$/, replacement: "/x" }], "@/"), undefined);
});

/** A Standard Schema written by hand, like a Valibot one, for the public contracts below. */
const handSchema = "const schema = <I, O = I>() => ({ \"~standard\": { version: 1 as const, vendor: \"test\", types: undefined as unknown as { input: I; output: O }, validate: (value: unknown) => ({ value: value as O }) } });\n";

/**
 * A project whose API, RPC and Socket contracts import their schemas through `#shared/` and through
 * an alias of `alias` that names a folder of `shared/`; `#lib/` names a folder outside `shared/`.
 */
const contractsProject: Record<string, string> = {
  "package.json": `${JSON.stringify({ name: "alias-contracts", private: true, type: "module", dependencies: { "@meekojs/meeko": "*" } })}\n`,
  "meeko.config.mjs": 'export default { alias: { "schemas/": "shared/schemas/", "#lib/": "lib/" } };\n',
  "shared/schemas/auth.ts": `${handSchema}export const loginInput = schema<{ email: string }>();\nexport const authResult = schema<{ token: string }>();\nexport const userInput = schema<{ id: string }>();\n`,
  "shared/schemas/chat.ts": `${handSchema}export const chatInput = schema<{ text: string }>();\nexport const chatOutput = schema<{ text: string; at: number }>();\n`,
  "lib/schemas.ts": `${handSchema}export const privateInput = schema<{ email: string }>();\n`,
  "server/api/auth/login.post.ts": [
    'import { defineApiRoute } from "@meekojs/meeko/server";',
    'import { authResult, loginInput } from "#shared/schemas/auth";',
    "",
    'export default defineApiRoute({ body: loginInput, response: authResult, handler: async ({ body }) => ({ token: body.email }) });',
    "",
  ].join("\n"),
  "server/rpc/auth/me.ts": [
    'import { defineRpc } from "@meekojs/meeko/server";',
    'import { authResult, userInput } from "schemas/auth";',
    "",
    "export default defineRpc({ input: userInput, output: authResult, handler: async ({ input }) => ({ token: input.id }) });",
    "",
  ].join("\n"),
  "server/socket/chat.ts": [
    'import { defineSocketChannel } from "@meekojs/meeko/server";',
    'import { chatInput } from "#shared/schemas/chat";',
    'import { chatOutput } from "schemas/chat";',
    "",
    "export default defineSocketChannel({ clientToServer: { message: chatInput }, serverToClient: { message: chatOutput } });",
    "",
  ].join("\n"),
  // The generated clients, typed from the schemas: a wrong input is a type error that meeko check expects.
  "app/lib/contracts-probe.ts": [
    "export async function probe(): Promise<void> {",
    '  const session: { token: string } = await api.auth.login.post({ body: { email: "ada@example.com" } });',
    '  const me: { token: string } = await rpc.auth.me({ id: "1" });',
    '  void socket.chat.emit("message", { text: "hola" });',
    "  // @ts-expect-error the API body comes from the shared schema",
    "  void api.auth.login.post({ body: { email: 1 } });",
    "  // @ts-expect-error the RPC input comes from the shared schema",
    "  void rpc.auth.me({ id: 1 });",
    "  // @ts-expect-error the Socket input comes from the shared schema",
    '  void socket.chat.emit("message", { text: 1 });',
    "  void session; void me;",
    "}",
    "",
  ].join("\n"),
  "app/pages/index.meeko": '<script lang="ts">\nconst label = "contratos";\n</script>\n<template><p>{label}</p></template>\n',
};

test("public contracts take schemas imported through #shared/ or an alias of shared/: meeko check, build and the generated clients", { timeout: 300_000 }, async (context) => {
  const root = await tempProject(context, "alias-contracts");
  await write(root, contractsProject);
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
  await checkFrameworkProject(root);
  const declarations = await readFile(join(root, ".meeko", "types", "server-contracts.d.ts"), "utf8");
  // The clients name the schema's file, which the browser bundle resolves without the alias.
  assert.match(declarations, /typeof import\("\.\.\/\.\.\/shared\/schemas\/auth\.js"\)\["loginInput"\]/);
  assert.match(declarations, /"auth\.me": [^\n]*typeof import\("\.\.\/\.\.\/shared\/schemas\/auth\.js"\)\["userInput"\]/);
  assert.doesNotMatch(declarations, /#shared\/|"schemas\//);
  const sockets = await readFile(join(root, ".meeko", "generated", "socket-contracts.ts"), "utf8");
  assert.match(sockets, /from "\.\.\/\.\.\/shared\/schemas\/chat\.js"/);
  assert.doesNotMatch(sockets, /#shared\/|"schemas\//);

  const bun = await buildProject(root, { adapter: "bun" });
  const bundle = await readFile(join(bun.output, "index.js"), "utf8");
  assert.doesNotMatch(bundle, /["']#shared\/schemas\/auth["']|["']schemas\/(?:auth|chat)["']/);

  // An alias of a folder outside shared/ is still a private schema.
  const { generateServerContracts } = await import("../src/framework/contracts-generate.ts");
  const { generateSocketContracts } = await import("../src/framework/socket-contracts-generate.ts");
  await write(root, {
    "server/socket/chat.ts": 'import { defineSocketChannel } from "@meekojs/meeko/server";\nimport { privateInput } from "#lib/schemas";\n\nexport default defineSocketChannel({ clientToServer: { message: privateInput }, serverToClient: {} });\n',
  });
  await assert.rejects(generateSocketContracts(root), /chat\.ts: clientToServer\.message debe venir de shared\//);
  await write(root, {
    "server/socket/chat.ts": contractsProject["server/socket/chat.ts"]!,
    "server/api/auth/login.post.ts": 'import { defineApiRoute } from "@meekojs/meeko/server";\nimport { authResult } from "#shared/schemas/auth";\nimport { privateInput } from "#lib/schemas";\n\nexport default defineApiRoute({ body: privateInput, response: authResult, handler: async ({ body }) => ({ token: body.email }) });\n',
  });
  await assert.rejects(generateServerContracts(root), /login\.post\.ts: body debe venir de shared\//);
});
