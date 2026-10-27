import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { applyAutoImports, discoverAutoImports } from "./autoimports.js";
import type { AutoImport, ImportScope } from "./autoimports.js";
import { readMeekoConfigSync } from "./framework/config.js";
import { legacyLayerEntries } from "./framework/module-loader.js";

export type TypeScriptScope = Exclude<ImportScope, "app">;

function within(root: string, filename: string): string | undefined {
  const path = relative(resolve(root), resolve(filename));
  return path === ".." || path.startsWith(`..${sep}`) || path.startsWith("/") ? undefined : path.replaceAll("\\", "/");
}

/**
 * `app` marks a plain module under `app/` (composables, utils, stores, components): it type-checks
 * in the browser scope but also runs in the SSR graph, like a `.meeko` component.
 */
function scopeWithin(sourceRoot: string, filename: string): ImportScope | undefined {
  const path = within(sourceRoot, filename);
  if (!path || !/\.[cm]?tsx?$/.test(path) || /\.(?:test|spec|d)\.[cm]?tsx?$/.test(path) ||
    !/^(?:app|server|shared)\//.test(path)) return undefined;
  if (/\.shared\.[cm]?tsx?$/.test(path)) return "shared";
  if (/\.server\.[cm]?tsx?$/.test(path)) return "server";
  if (/\.route\.[cm]?tsx?$/.test(path) && /(?:^|\/)app\/pages\//.test(path)) return "server";
  if (/\.client\.[cm]?tsx?$/.test(path)) return "client";
  if (path.startsWith("server/")) return "server";
  if (path.startsWith("app/")) return "app";
  if (path.startsWith("shared/")) return "shared";
  return undefined;
}

function sourceScope(root: string, filename: string, sourceRoots?: readonly string[]): ImportScope | undefined {
  const config = sourceRoots ? undefined : readMeekoConfigSync(root);
  const configured = sourceRoots ?? [
    ...(config?.extends ?? []),
    ...(config?.layers ?? []),
    ...(config ? legacyLayerEntries(root, config) : []),
  ].map((entry) => resolve(root, entry));
  for (const sourceRoot of [...configured, root].sort((a, b) => b.length - a.length)) {
    const scope = scopeWithin(sourceRoot, filename);
    if (scope) return scope;
  }
  return undefined;
}

/** Selects a source scope without executing config; Vite may pass resolved roots for dynamic config. */
export function typeScriptScope(root: string, filename: string, sourceRoots?: readonly string[]): TypeScriptScope | undefined {
  const scope = sourceScope(root, filename, sourceRoots);
  // Plain app/ modules are checked in the browser scope; see `transformTypeScriptAutoImports` for SSR.
  return scope === "app" ? "client" : scope;
}

function publicSpecifier(outputDirectory: string, entry: AutoImport): string {
  if (entry.specifier) return entry.specifier;
  const path = relative(outputDirectory, entry.file).replaceAll("\\", "/");
  const prefixed = path.startsWith(".") ? path : `./${path}`;
  return entry.component ? prefixed : prefixed.replace(/\.[cm]?ts$/, (extension) => extension === ".mts" ? ".mjs" : extension === ".cts" ? ".cjs" : ".js");
}

function scopeEntries(registry: readonly AutoImport[], scope: TypeScriptScope): AutoImport[] {
  return registry.filter((entry) => entry.scope === "shared" || (scope !== "shared" && (entry.scope === scope || entry.scope === "app")));
}

function assertNoCollisions(entries: readonly AutoImport[], scope: TypeScriptScope): void {
  const symbols = new Map<string, AutoImport>();
  for (const entry of entries) {
    const previous = symbols.get(entry.name);
    if (previous) throw new Error(`Autoimport ambiguo ${entry.name} en el ámbito ${scope}: ${previous.file}, ${entry.file}`);
    symbols.set(entry.name, entry);
  }
}

interface TypeTarget {
  readonly file: string;
  readonly imported: string;
}

function projectCompilerOptions(root: string): ts.CompilerOptions {
  const config = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!config) return {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
  };
  const loaded = ts.readConfigFile(config, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  return { ...ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(config)).options, noEmit: true };
}

function typeTargets(root: string, entries: readonly AutoImport[]): Map<string, TypeTarget> {
  const files = [...new Set(entries.filter((entry) => entry.typeOnly && !entry.specifier).map((entry) => entry.file))];
  const targets = new Map<string, TypeTarget>();
  if (files.length === 0) return targets;
  const program = ts.createProgram({ rootNames: files, options: projectCompilerOptions(root) });
  const checker = program.getTypeChecker();
  for (const entry of entries) {
    if (!entry.typeOnly || entry.specifier) continue;
    const file = program.getSourceFile(entry.file);
    const moduleSymbol = file && checker.getSymbolAtLocation(file);
    const exported = moduleSymbol && checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === entry.imported);
    if (!exported) continue;
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const declaration = symbol.declarations?.[0];
    if (!declaration) continue;
    targets.set(`${entry.file}\0${entry.imported}`, {
      file: declaration.getSourceFile().fileName,
      imported: symbol.name,
    });
  }
  return targets;
}

/** Produces global editor declarations for isolated app, server and shared TS projects. */
export async function generateAutoImportTypes(projectRoot: string): Promise<{ client: string; server: string; shared: string }> {
  const root = resolve(projectRoot);
  const outputDirectory = join(root, ".meeko", "types", "autoimports");
  const registry = await discoverAutoImports(root);
  const resolvedTypes = typeTargets(root, registry);
  await mkdir(outputDirectory, { recursive: true });
  const outputs = {} as { client: string; server: string; shared: string };
  for (const scope of ["client", "server", "shared"] as const) {
    const entries = scopeEntries(registry, scope);
    assertNoCollisions(entries, scope);
    const typeModules = new Map<string, string>();
    const imports: string[] = [];
    const namespaceFor = (targetSpecifier: string): string => {
      let namespace = typeModules.get(targetSpecifier);
      if (!namespace) {
        namespace = `__meeko_type_${typeModules.size}`;
        typeModules.set(targetSpecifier, namespace);
        // A declaration-only namespace alias preserves the original symbol's
        // generic parameters, including private constraints and defaults.
        imports.push(`import * as ${namespace} from ${targetSpecifier};`);
      }
      return namespace;
    };
    const declarations = entries.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
      const specifier = JSON.stringify(publicSpecifier(outputDirectory, entry));
      if (entry.typeOnly) {
        const resolvedTarget = resolvedTypes.get(`${entry.file}\0${entry.imported}`);
        const target = resolvedTarget ?? entry;
        const targetSpecifier = resolvedTarget
          ? JSON.stringify(publicSpecifier(outputDirectory, { ...entry, ...resolvedTarget }))
          : specifier;
        return `  export import ${entry.name} = ${namespaceFor(targetSpecifier)}.${target.imported};`;
      }
      // Classes, enums and values merged with a type keep every meaning: the value,
      // the type and, for enums, member types such as `Scope.App`.
      if (entry.alsoType && !entry.component) return `  export import ${entry.name} = ${namespaceFor(specifier)}.${entry.imported};`;
      const value = entry.component ? `typeof import(${specifier})` : `typeof import(${specifier})[${JSON.stringify(entry.imported)}]`;
      return `  const ${entry.name}: ${value};`;
    });
    const path = join(outputDirectory, `${scope}.d.ts`);
    const source = ["// Generated by Meeko. Scope-specific editor declarations.", ...imports, "export {};", "declare global {", ...declarations, "}", ""].join("\n");
    let previous: string | undefined;
    try { previous = await readFile(path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (previous !== source) await writeFile(path, source, "utf8");
    outputs[scope] = path;
  }
  return outputs;
}

/**
 * Vite can call this for app/shared/server TypeScript before its normal TS transform.
 * `scope` overrides the path-based scope, e.g. for a `render: "client"` sidecar
 * transformed for the browser bundle.
 *
 * `ssr` says which graph the module is loaded into. A plain module under `app/` (not
 * `.client.ts`, `.server.ts` or `.shared.ts`) runs on both sides like a `.meeko` component:
 * in the SSR graph its framework autoimports (`api`, `rpc`, `useSocket`…) resolve to the
 * server client, in the browser to the browser client. The names it may use are still the
 * browser ones, so a server-only autoimport fails in both graphs alike.
 */
export function transformTypeScriptAutoImports(source: string, filename: string, root: string, registry: readonly AutoImport[], sourceRoots?: readonly string[], scopeOverride?: TypeScriptScope, ssr = false): string | undefined {
  const detected = sourceScope(root, filename, sourceRoots);
  if (!detected) return undefined;
  let scope: TypeScriptScope;
  if (scopeOverride) scope = scopeOverride;
  else if (detected === "app") {
    if (ssr) {
      // Validates the names against the browser scope before resolving them for the server.
      applyAutoImports(source, filename, registry, "client");
      scope = "server";
    } else scope = "client";
  } else scope = detected;
  const transformed = applyAutoImports(source, filename, registry, scope);
  return transformed === source ? undefined : transformed;
}

/**
 * Reads project TypeScript with the imports that the Vite transform adds, so analysis that
 * walks real imports (public contract generation) sees where an autoimported name comes from.
 * Dependencies and sources outside app/, server/ and shared/ are returned unchanged, and so is
 * a source whose autoimports cannot be resolved: Vite reports that error when it loads it.
 */
export function autoImportSourceReader(root: string, registry: readonly AutoImport[], sourceRoots: readonly string[]): (file: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (file) => {
    const key = resolve(file);
    if (cache.has(key)) return cache.get(key);
    const source = ts.sys.readFile(file);
    let text = source;
    if (source !== undefined && !/[\\/]node_modules[\\/]/.test(key)) {
      try { text = transformTypeScriptAutoImports(source, key, root, registry, sourceRoots) ?? source; }
      catch { text = source; }
    }
    cache.set(key, text);
    return text;
  };
}

/** A compiler host whose source files come from `read`, e.g. an `autoImportSourceReader`. */
export function autoImportCompilerHost(options: ts.CompilerOptions, read: (file: string) => string | undefined): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  host.getSourceFile = (fileName, languageVersion, onError) => {
    const text = read(fileName);
    if (text === undefined) {
      onError?.(`File not found: ${fileName}`);
      return undefined;
    }
    return ts.createSourceFile(fileName, text, languageVersion, true);
  };
  return host;
}

/** Maps the unchanged source body after imports inserted at the start of a TS module. */
export function typeScriptAutoImportMap(source: string, transformed: string, filename: string): {
  version: 3; sources: string[]; sourcesContent: string[]; names: string[]; mappings: string;
} {
  if (!transformed.endsWith(source)) throw new TypeError("Autoimport transform must preserve the original TypeScript body");
  const prefix = transformed.slice(0, -source.length);
  const insertedLines = (prefix.match(/\n/g) ?? []).length;
  const sourceLines = source.split(/\r\n|\r|\n/).length;
  return {
    version: 3, sources: [filename], sourcesContent: [source], names: [],
    mappings: `${";".repeat(insertedLines)}AAAA${";AACA".repeat(Math.max(0, sourceLines - 1))}`,
  };
}

/** Convenience entrypoint for CLI generators. */
export async function generateTypeScriptAutoImports(projectRoot: string): Promise<{ client: string; server: string; shared: string }> {
  return generateAutoImportTypes(projectRoot);
}
