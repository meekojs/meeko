import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import ts from "@typescript/typescript6";
import { generateRoutes } from "../src/framework/generate.ts";
import { clientEntrySource, serverEntrySource, staticClientEntrySource } from "../src/framework/project-templates.ts";
import { tempProject } from "./helpers/temp-project.ts";

async function put(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

/** The `virtual:` modules that a generated entry imports. */
const virtualImports = (source: string): string[] => [...source.matchAll(/from "(virtual:[^"]+)"/g)].map((match) => match[1]!);

test("the virtual module declarations cover every virtual module of the generated entries", async (context) => {
  const root = await tempProject(context, "generated-entry-virtual-modules");
  await put(root, "app/pages/index.meeko", "<template><p>home</p></template>\n");
  await generateRoutes(root);
  const declarations = await readFile(join(root, ".meeko", "types", "virtual-pages.d.ts"), "utf8");
  const declared = new Set([...declarations.matchAll(/declare module "([^"]+)"/g)].map((match) => match[1]!));
  const imported = new Set([clientEntrySource, staticClientEntrySource, serverEntrySource].flatMap(virtualImports));
  assert.ok(imported.has("virtual:meeko-middleware/client"));
  for (const name of imported) assert.ok(declared.has(name), `${name} is not declared in .meeko/types/virtual-pages.d.ts`);
});

test("the client entry type-checks even when a virtual module has no precise declaration", () => {
  // A declaration without types, as one written by an older meeko dev running at the same time
  // would leave it: every import of the module is any.
  const files: Record<string, string> = {
    "/entry-client.ts": clientEntrySource,
    "/virtual.d.ts": `declare module "@meekojs/meeko/framework" {
  export function mountClientApp(options: { loadPage(file: string): Promise<unknown>; loadClientRoute(file: string): Promise<unknown>; readonly [option: string]: unknown }): Promise<void>;
  export type ClientComponent = unknown;
  export type ClientRoute = unknown;
  export type RouteMiddleware = (context: unknown) => unknown;
}
declare module "virtual:meeko-client-pages";
declare module "virtual:meeko-client-routes";
declare module "virtual:meeko-manifest/client";
declare module "virtual:meeko-plugins/client";
declare module "virtual:meeko-middleware/client";
interface ImportMeta { glob(pattern: string, options?: unknown): Record<string, () => Promise<unknown>>; }
`,
  };
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], types: [], strict: true, noEmit: true, skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language) => Object.hasOwn(files, name)
    ? ts.createSourceFile(name, files[name]!, language) : getSourceFile(name, language);
  host.fileExists = ((exists) => (name: string) => Object.hasOwn(files, name) || exists(name))(host.fileExists.bind(host));
  host.readFile = ((read) => (name: string) => files[name] ?? read(name))(host.readFile.bind(host));
  const program = ts.createProgram(Object.keys(files), options, host);
  const implicitAny = program.getSemanticDiagnostics(program.getSourceFile("/entry-client.ts"))
    .filter((diagnostic) => diagnostic.code === 7006 || diagnostic.code === 7031)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  assert.deepEqual(implicitAny, []);
});

test("routes.d.ts makes RouteMiddlewareName empty when the application has no named middleware", async (context) => {
  const root = await tempProject(context, "generated-middleware-names");
  await put(root, "app/pages/index.meeko", "<template><p>home</p></template>\n");
  await put(root, "app/middleware/10-locale.ts", "export default defineRouteMiddleware(() => undefined);\n");
  await put(root, "app/middleware/session.server.ts", "export default defineServerRouteMiddleware(() => undefined);\n");
  await generateRoutes(root);
  const declarations = await readFile(join(root, ".meeko", "types", "routes.d.ts"), "utf8");
  assert.match(declarations, /interface GeneratedRouteMiddleware \{\n {4}"#none": never;\n {2}\}/);
  await put(root, "app/middleware/auth.server.ts", "export default defineServerRouteMiddleware(() => undefined, { global: false });\n");
  await generateRoutes(root);
  const named = await readFile(join(root, ".meeko", "types", "routes.d.ts"), "utf8");
  assert.match(named, /interface GeneratedRouteMiddleware \{\n {4}"auth": "app\/middleware\/auth\.server\.ts";\n {2}\}/);
  assert.doesNotMatch(named, /#none/);
});
