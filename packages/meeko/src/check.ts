import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire as createModuleRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { applyAutoImports, compileWithAutoImports, discoverAutoImports } from "./autoimports.js";
import type { AutoImport } from "./autoimports.js";
import { aliasCandidates } from "./compiler/aliases.js";
import { originalOffset } from "./compiler/mapping.js";
import type { SourceMapping } from "./compiler/mapping.js";
import { moduleSpecifiers, replaceModuleSpecifiers } from "./compiler/import-graph.js";
import { projectDeclarationFiles } from "./compiler/project-declarations.js";
import { projectRoot } from "./compiler/project-root.js";
import { compileError, MeekoCompileError, locate } from "./compiler/sfc.js";
import type { CompileDiagnostic } from "./compiler/sfc.js";
import { UnexposedRefError } from "./element-refs.js";
import { routeBlockTypeSource } from "./framework/route-block-types.js";
import { pageRouteId } from "./framework/server-script.js";
import { resolveProjectAliases, resolveProjectAliasesSync } from "./framework/aliases.js";
import type { ProjectAliases } from "./framework/aliases.js";

const execFileAsync = promisify(execFile);
const typescriptPackage = fileURLToPath(import.meta.resolve("typescript/package.json"));
const tscPath = join(dirname(typescriptPackage), "bin", "tsc");
// The JS launcher spawns tsc.exe without windowsHide, which flashes a terminal in VS Code.
const nativeTscPath = process.platform === "win32"
  ? join(dirname(createModuleRequire(typescriptPackage).resolve(`@typescript/typescript-win32-${process.arch}/package.json`)), "lib", "tsc.exe")
  : undefined;
const tscExecutable = nativeTscPath && nativeTscPath.length >= 248 ? `\\\\?\\${nativeTscPath}` : nativeTscPath ?? process.execPath;

interface GeneratedEntry {
  original: string;
  generated: string;
  source: string;
  code: string;
  mappings: SourceMapping[];
  /** TypeScript copy of the page's `<script server>`, which types the exports the page reads. */
  server?: { readonly file: string; readonly code: string };
  /** Compiler warnings of this component. */
  warnings: readonly CompileDiagnostic[];
}

/** Ajustes de `checkSource` para herramientas que no deben ejecutar la configuración del proyecto. */
export interface CheckSourceOptions {
  /** Registro de autoimports por raíz de proyecto; por defecto se carga la configuración como el CLI. */
  readonly autoImports?: (projectRoot: string) => readonly AutoImport[] | Promise<readonly AutoImport[]>;
  /**
   * Aliases de ruta por raíz de proyecto; por defecto se leen de la configuración como el CLI, o sin
   * ejecutarla si se da `autoImports`.
   */
  readonly aliases?: (projectRoot: string) => ProjectAliases | Promise<ProjectAliases>;
}

/** The path aliases of a project, as `options` gives them or as `meeko check` (or the static reader) reads them. */
async function projectAliasesFor(root: string, options: CheckSourceOptions): Promise<ProjectAliases> {
  if (options.aliases) return options.aliases(root);
  return options.autoImports ? resolveProjectAliasesSync(root) : resolveProjectAliases(root);
}

function componentTarget(rootDirectory: string, filename: string): "client" | "server" {
  return relative(rootDirectory, filename).split(/[\\/]/)[0] === "server" ? "server" : "client";
}

/**
 * Generated declarations that the `tsconfig.app.json` and `tsconfig.server.json` projects
 * load: the autoimport globals of the component's scope, which `.ts` modules imported by the
 * component rely on, and the route ids that type `href`. Only existing files are used, so a
 * component outside a framework project is checked as before.
 */
function generatedDeclarations(rootDirectory: string, filename: string): string[] {
  const types = join(rootDirectory, ".meeko", "types");
  return [join(types, "autoimports", `${componentTarget(rootDirectory, filename)}.d.ts`), join(types, "routes.d.ts")]
    .filter((file) => existsSync(file));
}

async function compileGraph(source: string, filename: string, options: CheckSourceOptions): Promise<{ root: GeneratedEntry; entries: Map<string, GeneratedEntry>; tempDirectory: string }> {
  const byOriginal = new Map<string, GeneratedEntry>();
  const byGenerated = new Map<string, GeneratedEntry>();
  const nonce = randomUUID();
  const rootDirectory = projectRoot(filename);
  const generatedDirectory = join(rootDirectory, ".meeko", "check", nonce);
  async function add(original: string, content: string): Promise<GeneratedEntry> {
    const previous = byOriginal.get(original);
    if (previous) return previous;
    const target = componentTarget(rootDirectory, original);
    const registry = options.autoImports ? await options.autoImports(projectRoot(original)) : undefined;
    const aliases = await projectAliasesFor(projectRoot(original), options);
    const compiled = await compileWithAutoImports(content, original, { typeCheck: true }, target, registry, aliases);
    const entry: GeneratedEntry = {
      original, source: content, code: compiled.code,
      generated: join(generatedDirectory, relative(rootDirectory, original) + ".ts"),
      mappings: compiled.mappings.map((mapping) => ({ ...mapping })),
      warnings: compiled.warnings ?? [],
    };
    byOriginal.set(original, entry);
    byGenerated.set(entry.generated, entry);
    const serverSpecifier = `./${basename(original)}.server.js`;
    if (entry.code.includes(`from ${JSON.stringify(serverSpecifier)}`)) {
      entry.server = { file: entry.generated.replace(/\.ts$/, ".server.ts"), code: serverCopy(content, original, entry.generated.replace(/\.ts$/, ".server.ts"), registry ?? await discoverAutoImports(rootDirectory)) };
    }
    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (const specifier of moduleSpecifiers(entry.code, entry.generated)) {
      const { value, start, end } = specifier;
      if (entry.server && value === serverSpecifier) continue;
      if (!value.endsWith(".meeko") && !value.startsWith(".")) continue;
      // Since 1.5 a path alias also names a component (`@/components/Card.meeko`): the first file that exists.
      const aliased = value.startsWith(".") ? undefined : aliasCandidates(aliases.aliases, value);
      if (value.endsWith(".meeko") && !value.startsWith(".") && !aliased) {
        throw compileError(content, original, "MEEK033", "Los imports de componentes deben usar rutas .meeko relativas o un alias de ruta (@/, ~/…)", originalOffset(entry.mappings, start) ?? 0);
      }
      let destination: string;
      if (value.endsWith(".meeko")) {
        const childFilename = aliased?.find((candidate) => existsSync(candidate)) ?? aliased?.[0] ?? resolve(dirname(original), value);
        let childSource: string;
        try {
          childSource = await readFile(childFilename, "utf8");
        } catch {
          throw compileError(content, original, "MEEK034", `No se encuentra el componente importado: ${value}`, originalOffset(entry.mappings, start) ?? 0);
        }
        const child = await add(childFilename, childSource);
        destination = child.generated.replace(/\.ts$/, ".js");
      } else {
        destination = resolve(dirname(original), value);
      }
      let target = relative(dirname(entry.generated), destination).replaceAll("\\", "/");
      if (!target.startsWith("./") && !target.startsWith("../")) target = `./${target}`;
      edits.push({ start, end, text: target });
    }
    for (const edit of edits.reverse()) {
      const delta = edit.text.length - (edit.end - edit.start);
      entry.code = entry.code.slice(0, edit.start) + edit.text + entry.code.slice(edit.end);
      for (const mapping of entry.mappings) {
        if (mapping.generatedStart >= edit.end) mapping.generatedStart += delta;
        if (mapping.generatedEnd >= edit.end) mapping.generatedEnd += delta;
      }
    }
    return entry;
  }
  const root = await add(filename, source);
  return { root, entries: byGenerated, tempDirectory: generatedDirectory };
}

/**
 * The page's `<script server>` as a module beside the compiled page, with its
 * server autoimports and relative imports resolved from the page's folder. Its
 * own diagnostics belong to the server TypeScript project, not to this check.
 */
function serverCopy(source: string, original: string, file: string, registry: readonly AutoImport[]): string {
  const block = routeBlockTypeSource(source, original, pageRouteId(original)) ?? "export {};\n";
  let code = block;
  try { code = applyAutoImports(block, original, registry, "server"); }
  catch { /* An unresolved autoimport is reported by the server project. */ }
  return replaceModuleSpecifiers(code, file, ({ value }) => {
    if (!value.startsWith(".")) return value;
    const target = relative(dirname(file), resolve(dirname(original), value)).replaceAll("\\", "/");
    return target.startsWith(".") ? target : `./${target}`;
  });
}

/** Resolution options of the project tsconfig that `meeko check` shares with the language server. */
const resolutionOptions = ["types", "typeRoots", "customConditions", "resolveJsonModule", "allowImportingTsExtensions"] as const;

/**
 * Reads the module resolution options of `<root>/tsconfig.json` (the file the editor uses for hover
 * and navigation) so a `paths` alias that the editor resolves is not reported by `meeko check`.
 * Type-checking flags stay fixed. TypeScript 7 has no `baseUrl`: it becomes a `*` mapping. Since
 * 1.5 the project's path aliases are `paths` too, also without a tsconfig.
 */
async function projectResolutionOptions(root: string, aliases: ProjectAliases): Promise<Record<string, unknown> | undefined> {
  const { resolveProjectCompilerOptions } = await import("./language-server/model.js");
  const { options } = resolveProjectCompilerOptions(root, aliases);
  const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl : undefined;
  const pathsBase = baseUrl ?? (typeof options["pathsBasePath"] === "string" ? options["pathsBasePath"] : root);
  const absolute = (target: string): string => resolve(pathsBase, target).replaceAll("\\", "/");
  const paths: Record<string, string[]> = {};
  for (const [pattern, targets] of Object.entries(options.paths ?? {})) paths[pattern] = targets.map(absolute);
  if (baseUrl && !paths["*"]) paths["*"] = [absolute("*")];
  const resolution: Record<string, unknown> = Object.keys(paths).length > 0 ? { paths } : {};
  for (const key of resolutionOptions) if (options[key] !== undefined) resolution[key] = options[key];
  return Object.keys(resolution).length > 0 ? resolution : undefined;
}

function generatedOffset(code: string, line: number, column: number): number {
  const lines = code.split("\n");
  let offset = 0;
  for (let index = 0; index < line - 1; index++) offset += (lines[index]?.length ?? 0) + 1;
  return offset + column - 1;
}

function parseTypeScriptOutput(output: string): Array<{ file: string; line: number; column: number; code: string; message: string }> {
  const diagnostics: Array<{ file: string; line: number; column: number; code: string; message: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.*)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
    if (match) diagnostics.push({ file: match[1] ?? "", line: Number(match[2]), column: Number(match[3]), code: `TS${match[4]}`, message: match[5] ?? "" });
    else if (line.trim() && diagnostics.length > 0) diagnostics[diagnostics.length - 1]!.message += `\n${line}`;
  }
  return diagnostics;
}

/**
 * Original span `[start, end)` of the innermost mapping that contains `generated` when that mapping
 * does not keep the expression's length: the compiler rewrote it, so a position inside it is only
 * an approximation. `undefined` for a mapping that copies the source verbatim.
 */
function rewrittenSpan(mappings: readonly SourceMapping[], generated: number): readonly [number, number] | undefined {
  const span = mappings
    .filter((entry) => generated >= entry.generatedStart && generated < entry.generatedEnd)
    .sort((a, b) => (a.generatedEnd - a.generatedStart) - (b.generatedEnd - b.generatedStart))[0];
  if (!span || span.generatedEnd - span.generatedStart === span.originalLength) return undefined;
  return [span.originalStart, span.originalStart + span.originalLength];
}

/** The type error of `UntrustedHtmlMessage` that `checkTrustedHtml` reports for `html="expression"`. */
const untrustedHtmlType = /\bMEEK107: /;

/**
 * Message of the `MEEK107` warning: the value of `html="expression"` is a `string` (or `any`)
 * without the `TrustedHtml` brand. A warning in 1.x; it becomes an error in 2.0.
 */
export const untrustedHtmlMessage = "`html` inserta HTML sin escapar; un `string` puede venir de un usuario (XSS). Sanéelo y márquelo con `trustHtml(…)`, o use `{expr}`, que escapa.";

/** The type error of `RequiredSnippetMessage` that `checkSnippetCondition` reports for `<snippet if:when>`. */
const requiredSnippetType = /\bMEEK110: ([A-Za-z_$][\w$]*) /;

/**
 * Message of `MEEK110`: `if:when` on a `<snippet>` that fills a snippet the child requires, which
 * the child would then render without content.
 */
export function requiredSnippetMessage(name: string): string {
  return `if:when en <snippet name="${name}"> deja de pasar el snippet cuando la condición es falsa, pero el hijo declara ${name} como obligatorio. Decláralo opcional en el defineSnippets del hijo (${name}?: [...]) o quita if:when`;
}

/**
 * Type errors of `<component is>` with a tag (MEEK112, and MEEK031 for a void tag with content) and
 * of `bind="obj"` (MEEK113): the type text carries the code and the message, which the diagnostic
 * keeps without TypeScript's wrapping.
 */
const meekTypeText = /"(MEEK(?:031|112|113)): ([^"]+)"/;

/** Message of a MEEK112, MEEK113 or MEEK031 type error, with what to do about it. */
function meekTypeMessage(code: string, text: string): string {
  if (code === "MEEK112" && text.endsWith("no se aplica a ninguna etiqueta posible de is")) {
    return `${text}: Meeko no lo escribiría nunca; quítalo o añade a is una etiqueta que lo admita`;
  }
  return text;
}

/** The type error of `UnexposedRefMessage` that TypeScript reports for `await useElementRef(...)`. */
const unexposedRefType = /\bMEEK080: /;

/**
 * `await useElementRef("name")` on a component without `defineExpose` fails as a TypeScript
 * assignability error whose type carries the MEEK080 text. It is reported as MEEK080, at the
 * `useElementRef` call of the original source, with the same message as `UnexposedRefError`.
 */
function unexposedRefDiagnostic(entry: GeneratedEntry, generated: number, offset: number | undefined): CompileDiagnostic {
  const ref = /\belementRef<[^>]*>\(\s*("(?:[^"\\]|\\.)*")/.exec(entry.code.slice(Math.max(0, generated - 32), generated + 512));
  let name: string | undefined;
  try { name = ref ? JSON.parse(ref[1]!) as string : undefined; }
  catch { name = undefined; }
  const quoted = name === undefined ? "[^\"'`]*" : name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const calls = [...entry.source.matchAll(new RegExp(`\\buseElementRef\\s*\\(\\s*(["'\`])(${quoted})\\1`, "g"))];
  const call = calls.filter((match) => offset !== undefined && match.index <= offset).at(-1) ?? calls[0];
  const named = name ?? call?.[2] ?? "name";
  return {
    code: "MEEK080",
    message: new UnexposedRefError(named).message.replace(/^MEEK080: /, ""),
    filename: entry.original,
    location: locate(entry.source, call?.index ?? offset ?? 0),
  };
}

/** Comprueba un componente con TypeScript 7 y devuelve errores ubicados en el .meeko original. */
export async function checkSource(source: string, filename: string, options: CheckSourceOptions = {}): Promise<CompileDiagnostic[]> {
  const absolute = resolve(filename);
  let graph: Awaited<ReturnType<typeof compileGraph>>;
  try {
    graph = await compileGraph(source, absolute, options);
  } catch (error) {
    if (error instanceof MeekoCompileError) return [error.diagnostic];
    throw error;
  }

  let output = "";
  try {
    for (const entry of graph.entries.values()) {
      await mkdir(dirname(entry.generated), { recursive: true });
      await writeFile(entry.generated, entry.code, { encoding: "utf8", flag: "wx" });
      if (entry.server) await writeFile(entry.server.file, entry.server.code, { encoding: "utf8", flag: "wx" });
    }
    // Options such as `paths` only exist in a tsconfig, so they go into a temporary one; the
    // command-line flags below still override every type-checking option.
    const rootDirectory = projectRoot(absolute);
    const projectResolution = await projectResolutionOptions(rootDirectory, await projectAliasesFor(rootDirectory, options));
    const files = [graph.root.generated, ...generatedDeclarations(rootDirectory, absolute), ...projectDeclarationFiles(rootDirectory)];
    // The generated declarations name components by their `.meeko` path (the props of each named
    // layout in routes.d.ts), which the declaration tree resolves as in the framework tsconfigs.
    const declarationTree = join(rootDirectory, ".meeko", "types");
    const resolution = existsSync(join(declarationTree, "routes.d.ts"))
      ? { ...projectResolution, rootDirs: [rootDirectory, declarationTree], allowArbitraryExtensions: true }
      : projectResolution;
    const project = resolution ? join(graph.tempDirectory, "tsconfig.json") : undefined;
    if (project) await writeFile(project, JSON.stringify({ compilerOptions: resolution, files }), { encoding: "utf8", flag: "wx" });
    try {
      const result = await execFileAsync(tscExecutable, [
        ...(nativeTscPath ? [] : [tscPath]), ...(project ? ["--project", project] : ["--ignoreConfig"]), "--noEmit", "--pretty", "false", "--strict", "--skipLibCheck",
        "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax",
        "--module", "esnext", "--moduleResolution", "bundler", "--target", "es2022",
        "--lib", "es2022,dom", ...(project ? [] : files),
      ], { cwd: dirname(absolute), maxBuffer: 8 * 1024 * 1024, windowsHide: true });
      output = result.stdout + result.stderr;
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
      if (!output.trim()) throw error;
    }
  } finally {
    await rm(graph.tempDirectory, { recursive: true, force: true });
  }

  const serverCopies = new Set([...graph.entries.values()].flatMap((entry) => entry.server ? [entry.server.file] : []));
  const parsed = parseTypeScriptOutput(output);
  if (parsed.length === 0 && output.trim()) throw new Error(`Falló la comprobación con TypeScript 7: ${output.trim()}`);
  // The server TypeScript project reports errors inside `<script server>` on the page itself.
  const typed = parsed.filter((diagnostic) => !serverCopies.has(resolve(dirname(absolute), diagnostic.file)));
  // Original span of each error whose position comes from a rewritten expression (approximate).
  const approximate = new Map<CompileDiagnostic, readonly [number, number]>();
  const mapped = await Promise.all(typed.map(async (diagnostic): Promise<CompileDiagnostic> => {
    const reported = resolve(dirname(absolute), diagnostic.file);
    const entry = graph.entries.get(reported);
    if (entry) {
      const generated = generatedOffset(entry.code, diagnostic.line, diagnostic.column);
      const offset = originalOffset(entry.mappings, generated);
      if (unexposedRefType.test(diagnostic.message)) return unexposedRefDiagnostic(entry, generated, offset);
      const requiredSnippet = requiredSnippetType.exec(diagnostic.message);
      if (requiredSnippet) {
        return { code: "MEEK110", message: requiredSnippetMessage(requiredSnippet[1]!), filename: entry.original, location: locate(entry.source, offset ?? 0) };
      }
      if (untrustedHtmlType.test(diagnostic.message)) {
        return { code: "MEEK107", message: untrustedHtmlMessage, filename: entry.original, location: locate(entry.source, offset ?? 0), severity: "warning" };
      }
      const meekType = meekTypeText.exec(diagnostic.message);
      if (meekType) {
        return { code: meekType[1]!, message: meekTypeMessage(meekType[1]!, meekType[2]!), filename: entry.original, location: locate(entry.source, offset ?? 0) };
      }
      const result: CompileDiagnostic = {
        code: diagnostic.code,
        message: offset === undefined ? `TypeScript generado: ${diagnostic.message}` : diagnostic.message,
        filename: entry.original,
        location: locate(entry.source, offset ?? 0),
      };
      const span = offset === undefined ? undefined : rewrittenSpan(entry.mappings, generated);
      if (span) approximate.set(result, span);
      return result;
    }
    // TypeScript also checks .ts dependencies imported by the .meeko graph.
    // Their positions already refer to the original file, not generated code.
    let imported: string;
    try { imported = await readFile(reported, "utf8"); }
    catch {
      return { code: diagnostic.code, message: `TypeScript generado: ${diagnostic.message}`, filename: absolute, location: locate(source, 0) };
    }
    return {
      code: diagnostic.code,
      message: diagnostic.message,
      filename: reported,
      location: locate(imported, generatedOffset(imported, diagnostic.line, diagnostic.column)),
    };
  }));
  // The compiler emits a template expression, and the check of each component tag, for several
  // render paths; each error is reported once. The compiler maps the pieces of an expression it
  // rewrites (a snippet parameter read from its arguments, for example); as a fallback, a copy whose
  // position only comes from a rewritten span is dropped when another path places the same error
  // exactly inside that span.
  const sameError = (left: CompileDiagnostic, right: CompileDiagnostic): boolean =>
    left.filename === right.filename && left.code === right.code && left.message === right.message;
  const seen = new Set<string>();
  // Warnings of the checked component only; each imported component reports its own when checked.
  return [...mapped, ...graph.root.warnings].filter((item) => {
    if (item.severity === "warning" && item.filename !== graph.root.original) return false;
    const span = approximate.get(item);
    if (span && mapped.some((other) => other !== item && !approximate.has(other) && sameError(other, item)
      && other.location.offset >= span[0] && other.location.offset < span[1])) return false;
    const key = `${item.filename}:${item.code}:${item.location.offset}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
