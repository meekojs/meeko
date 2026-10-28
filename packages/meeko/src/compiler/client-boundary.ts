import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "@typescript/typescript6";
import type { AutoImport, FreeReference } from "../autoimports.js";
import type { SourceMapping } from "./mapping.js";
import { frameworkModule, pageRequestApis } from "./server-script.js";
import { compileError, locate, parseSfc } from "./sfc.js";
import type { CompileDiagnostic } from "./sfc.js";

/**
 * Package entries whose module fails to load in the browser: they create an `AsyncLocalStorage` of
 * `node:async_hooks`, which the browser bundle replaces with an empty module (`MEEK108`).
 */
const failingEntries: ReadonlySet<string> = new Set(["@meekojs/meeko/server", "@meekojs/meeko/cloudflare"]);

/**
 * Package entries that load in the browser bundle but whose functions only work in a server
 * runtime (Node, Bun or Deno): an import compiles today, so it is the `MEEK109` warning until 2.0.
 */
const runtimeEntries: ReadonlySet<string> = new Set([
  "@meekojs/meeko/node", "@meekojs/meeko/bun", "@meekojs/meeko/deno", "@meekojs/meeko/password", "@meekojs/meeko/build",
]);

const serverEntries: ReadonlySet<string> = new Set([...failingEntries, ...runtimeEntries]);

/** Where each server definition of the framework belongs, for the message. */
const serverHints: Readonly<Record<string, string>> = {
  defineApiRoute: "en los handlers de server/api",
  defineRpc: "en los procedimientos de server/rpc",
  defineServerMiddleware: "en server/middleware",
  defineSocketChannel: "en los canales de server/socket",
  defineServerRuntime: "en server/runtime.ts",
  ApiError: "en server/, en <script server> o en un loader; en el navegador, los errores de API llegan como ClientError",
};

/** Package files behind the server entries, relative to the package: what `serverEntries` load. */
const serverPackageFile = /^(?:dist|src)\/(?:framework-server(?:\/|\.)|framework\/server\.|(?:node|bun|deno|password|build|cloudflare)\.)/;

/** APIs of `<script server>` and of the route options that a component cannot use (`MEEK073`, `MEEK109`). */
export const pageOnlyApis: ReadonlySet<string> = new Set([...pageRequestApis, "definePage"]);

const packageRoots = new Map<string, string | undefined>();

/** The root of the `@meekojs/meeko` package that contains `file`, installed or linked. */
function meekoPackageRoot(file: string): string | undefined {
  let directory = dirname(resolve(file));
  const visited: string[] = [];
  let found: string | undefined;
  for (;;) {
    if (packageRoots.has(directory)) { found = packageRoots.get(directory); break; }
    visited.push(directory);
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      try { found = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name === "@meekojs/meeko" ? directory : undefined; }
      catch { found = undefined; }
      break;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  for (const entry of visited) packageRoots.set(entry, found);
  return found;
}

/**
 * Whether an auto-import completion comes from Meeko: `module` is a specifier (`@meekojs/meeko/…`)
 * or a file of the package. `server` narrows it to the server entries and their files.
 */
export function meekoModule(module: string, server = false): boolean {
  if (module === "@meekojs/meeko" || module.startsWith("@meekojs/meeko/")) return !server || serverEntries.has(module);
  if (!/[\\/]/.test(module)) return false;
  const root = meekoPackageRoot(module);
  return root !== undefined && (!server || serverPackageFile.test(relative(root, module).replaceAll("\\", "/")));
}

/**
 * Whether the editor should leave an auto-import completion out of a component's `<script>` and
 * template: a server entry of Meeko or one of its files, a module of `server/` or a `*.server.*`
 * module, and the page APIs of {@link pageOnlyApis}.
 */
export function serverOnlyCompletion(name: string, module: string | undefined, serverDirectories: readonly string[]): boolean {
  if (module === undefined) return false;
  if (meekoModule(module, true)) return true;
  if (pageOnlyApis.has(name) && meekoModule(module)) return true;
  if (!/[\\/]/.test(module)) return false;
  if (/\.server(?:\.d)?(?:\.[cm]?[jt]sx?)?$/.test(module)) return true;
  // A relative specifier says nothing about where it resolves; the file name of the entry does.
  return isAbsolute(module) && serverDirectories.some((directory) => within(directory, module));
}

/** What `checkClientBoundary` needs of a compiled component. */
export interface ClientBoundaryInput {
  readonly source: string;
  readonly filename: string;
  /** The compiled module before its autoimports, and its map to the `.meeko`. */
  readonly code: string;
  readonly mappings: readonly SourceMapping[];
  /** Free references of `code`, from `freeReferences`. */
  readonly references: readonly FreeReference[];
  readonly registry: readonly AutoImport[];
  /** The `server/` folders of the project and its layers. */
  readonly serverDirectories: readonly string[];
}

interface Finding {
  readonly diagnostic: CompileDiagnostic;
  readonly error: boolean;
}

const browserScope = "el <script> y la plantilla de un componente también se ejecutan en el navegador";

function within(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

/** The `.meeko` offset of a free reference of the compiled code, or `undefined` for generated code. */
function sourceOffset(input: ClientBoundaryInput, reference: FreeReference): number | undefined {
  const spans = input.mappings
    .filter((entry) => reference.start >= entry.generatedStart && reference.start < entry.generatedEnd)
    .sort((a, b) => (a.generatedEnd - a.generatedStart) - (b.generatedEnd - b.generatedStart));
  const span = spans[0];
  if (!span) return undefined;
  const exact = span.originalStart + (reference.start - span.generatedStart);
  if (input.source.startsWith(reference.name, exact)) return exact;
  // A rewritten expression (a list item, an instrumented statement): the name inside its span.
  const text = input.source.slice(span.originalStart, span.originalStart + span.originalLength);
  const match = new RegExp(`(?<![\\w$])${reference.name.replace(/\$/g, "\\$")}(?![\\w$])`).exec(text);
  return match ? span.originalStart + match.index : undefined;
}

/** Whether a relative import of the component names a module that only runs on the server. */
function serverModule(input: ClientBoundaryInput, specifier: string): boolean {
  const target = resolve(dirname(input.filename), specifier);
  if (/\.server(?:\.[cm]?[jt]sx?)?$/.test(basename(target))) return true;
  if (input.serverDirectories.some((directory) => within(directory, target))) return true;
  const stem = target.replace(/\.[cm]?[jt]sx?$/, "");
  return input.registry.some((entry) => entry.scope === "server" && !entry.specifier && entry.file.replace(/\.[cm]?[jt]sx?$/, "") === stem);
}

/** Origin of a server autoimport, as the message shows it. */
function origin(input: ClientBoundaryInput, entry: AutoImport): string {
  if (entry.specifier) return entry.specifier;
  const root = input.serverDirectories.map((directory) => dirname(directory)).find((candidate) => within(candidate, entry.file));
  return (root ? relative(root, entry.file) : basename(entry.file)).replaceAll("\\", "/");
}

/**
 * Checks that a component's `<script>` and template only use what exists in the browser, where
 * they also run. Errors, for what already fails today: `MEEK108` for a server-only autoimport, a
 * value import of `/server` or `/cloudflare` (they fail to load in the browser) and an import of
 * `server/` or of a `*.server.*` module; `MEEK073` for the request APIs of `<script server>`
 * (`usePage`, `redirect`, `notFound`). Warnings, returned, for what compiles and loads today and
 * becomes an error in 2.0: `MEEK109` for `definePage`, which has no effect there, and for a value
 * import of `/node`, `/bun`, `/deno`, `/password` or `/build`. Throws the first error.
 */
export function checkClientBoundary(input: ClientBoundaryInput): CompileDiagnostic[] {
  const { source, filename } = input;
  const findings: Finding[] = [];
  const add = (code: string, message: string, offset: number, error = true): void => {
    const diagnostic: CompileDiagnostic = { code, message, filename, location: locate(source, offset), ...(error ? {} : { severity: "warning" as const }) };
    findings.push({ diagnostic, error });
  };
  const pageOptions = (offset: number): void => add(
    "MEEK109",
    "definePage no tiene efecto en el <script> ni en la plantilla de un componente: las opciones de ruta de una página se declaran en <script server> (export const route = definePage({ ... })) o en un sidecar *.route.ts. Desde 2.0 será un error",
    offset,
    false,
  );

  const script = parseSfc(source, filename).script;
  if (!script.implicit) {
    const file = ts.createSourceFile(filename, script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : undefined;
      // `import { type A } from "x"` loads nothing under verbatimModuleSyntax only if every name is a type.
      const values = !clause || clause.name !== undefined || !named || named.some((element) => !element.isTypeOnly);
      const specifier = statement.moduleSpecifier.text;
      const at = script.contentStart + statement.moduleSpecifier.getStart(file);
      if (values && failingEntries.has(specifier)) {
        add("MEEK108", `${specifier} sólo existe en el servidor y no se puede cargar en el navegador: ${browserScope}. Mueve ese código a <script server> o a server/; para usar sus tipos, impórtalos con import type`, at);
      } else if (values && runtimeEntries.has(specifier)) {
        add("MEEK109", `${specifier} sólo funciona en el servidor: ${browserScope}, donde sus funciones fallan. Mueve ese código a <script server> o a server/; para usar sus tipos, impórtalos con import type. Desde 2.0 será un error`, at, false);
      } else if (values && specifier.startsWith(".") && serverModule(input, specifier)) {
        add("MEEK108", `${specifier} es un módulo de servidor (server/ o *.server.*) y no puede llegar al bundle del navegador: ${browserScope}. Úsalo en <script server> o pide los datos con useApi o useRpcQuery; para sus tipos, usa import type`, at);
      } else if (specifier === frameworkModule && named) {
        for (const element of named) {
          if (!element.isTypeOnly && (element.propertyName ?? element.name).text === "definePage") pageOptions(script.contentStart + element.getStart(file));
        }
      }
    }
  }

  for (const reference of input.references) {
    if (!reference.value) continue;
    const candidates = input.registry.filter((entry) => entry.name === reference.name);
    const browser = candidates.filter((entry) => entry.scope !== "server");
    const request = candidates.length === 0 && (pageRequestApis as readonly string[]).includes(reference.name);
    const server = candidates.length > 0 && browser.length === 0;
    const page = reference.name === "definePage" && browser.length === 1 && browser[0]!.specifier === frameworkModule;
    if (!request && !server && !page) continue;
    const offset = sourceOffset(input, reference);
    if (offset === undefined) continue;
    if (request) {
      add("MEEK073", `${reference.name}() sólo funciona en el código de nivel superior del <script server> de una página: ${browserScope}`, offset);
    } else if (server) {
      const entry = candidates[0]!;
      const where = serverHints[reference.name] ?? "en <script server>, en server/ o en un módulo *.server.ts; en el componente, pide los datos con useApi o useRpcQuery";
      add("MEEK108", `${reference.name} viene de ${origin(input, entry)}, que sólo existe en el servidor: ${browserScope}. Úsalo ${where}`, offset);
    } else pageOptions(offset);
  }

  const seen = new Set<string>();
  const unique = findings
    .sort((a, b) => a.diagnostic.location.offset - b.diagnostic.location.offset)
    .filter(({ diagnostic }) => {
      const key = `${diagnostic.code}:${diagnostic.location.offset}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const error = unique.find((finding) => finding.error);
  if (error) throw compileError(source, filename, error.diagnostic.code, error.diagnostic.message, error.diagnostic.location.offset);
  return unique.map((finding) => finding.diagnostic);
}
