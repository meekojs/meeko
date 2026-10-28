import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { UtilityAutoImports } from "./autoimports.js";

/**
 * Loads the TypeScript or JavaScript module of an `@utilities` at-rule, always fresh.
 *
 * Native `import()` caches every module of the graph for the life of the process: a query on
 * the entry reloads the entry but not the local files it imports. So the module is bundled
 * with rolldown, the bundler Vite 8 ships (resolved through `vite`, an optional peer of this
 * package): the local graph becomes one ES module, imported from a `data:` URL, and its
 * module ids are the exact files to watch. Packages stay external, imported natively from
 * their resolved `file:` URL. Without rolldown (PostCSS outside Vite 8), the entry is imported
 * natively with Node's type stripping and a query per version; its local imports do not reload.
 *
 * With `autoImports`, every local TypeScript module of the graph gets the project's autoimports
 * in the bundle; the native import cannot add them.
 *
 * A loaded module is reused while every file of its graph keeps its modification time and size,
 * and the autoimport registry its key: an export added to or removed from an autoimport folder
 * rebuilds it.
 */

/** The part of rolldown's API this loader uses; rolldown is not a dependency of this package. */
interface RolldownResolved { readonly id: string; readonly external?: boolean | string }
interface RolldownPluginContext {
  resolve(source: string, importer?: string, options?: Record<string, unknown>): Promise<RolldownResolved | null>;
}
interface RolldownPlugin {
  readonly name: string;
  resolveId?(this: RolldownPluginContext, source: string, importer: string | undefined, extra: Record<string, unknown>): Promise<RolldownResolved | string | null>;
  load?(id: string): Promise<null>;
  transform?(code: string, id: string): { code: string } | null;
}
interface RolldownOutputChunk { readonly type: string; readonly code?: string; readonly moduleIds?: readonly string[] }
interface RolldownBundle {
  generate(options: Record<string, unknown>): Promise<{ output: readonly RolldownOutputChunk[] }>;
  close(): Promise<void>;
}
type Rolldown = (options: Record<string, unknown> & { plugins: RolldownPlugin[] }) => Promise<RolldownBundle>;

/** A loaded utility module: its exports and the files whose changes must reload it. */
export interface LoadedUtilityModule {
  readonly exports: Readonly<Record<string, unknown>>;
  /** The entry and, when bundled, every local module it imports: absolute paths. */
  readonly files: readonly string[];
  /** `false` when rolldown was not found and the entry was imported natively. */
  readonly bundled: boolean;
}

interface CachedModule extends LoadedUtilityModule {
  /** `mtimeMs:size` of each file, taken before the bundler read it. */
  readonly stamps: ReadonlyMap<string, string | undefined>;
  /** {@link UtilityAutoImports.key} of the registry the bundle used; `undefined` without autoimports. */
  readonly autoImportsKey: string | undefined;
}

const cache = new Map<string, Promise<CachedModule>>();
let rolldownLoader: Promise<Rolldown | undefined> | undefined;

/**
 * Loads `file`, reusing the previous load while none of its files changed. `autoImports` adds a
 * Meeko project's autoimports to the local modules of the bundle.
 */
export async function loadUtilityModule(file: string, autoImports?: UtilityAutoImports): Promise<LoadedUtilityModule> {
  const cached = cache.get(file);
  if (cached) {
    const entry = await cached.catch(() => undefined);
    if (entry && entry.autoImportsKey === autoImports?.key && await isFresh(entry)) return entry;
    // Another caller already started the reload: share it.
    const current = cache.get(file);
    if (current && current !== cached) return loadUtilityModule(file, autoImports);
  }
  const loading = importModule(file, autoImports);
  cache.set(file, loading);
  // A failed load is not cached: the next transform retries once the file is fixed.
  loading.catch(() => { if (cache.get(file) === loading) cache.delete(file); });
  return loading;
}

async function isFresh(entry: CachedModule): Promise<boolean> {
  for (const [file, stamp] of entry.stamps) if (stamp === undefined || await stampOf(file) !== stamp) return false;
  return true;
}

async function stampOf(file: string): Promise<string | undefined> {
  try {
    const stats = await stat(file);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return undefined;
  }
}

async function importModule(file: string, autoImports: UtilityAutoImports | undefined): Promise<CachedModule> {
  const rolldown = await findRolldown();
  const autoImportsKey = autoImports?.key;
  if (!rolldown) {
    const stamp = await stampOf(file);
    const url = `${pathToFileURL(file).href}?meeko-utilities=${encodeURIComponent(stamp ?? String(Date.now()))}`;
    const exports = await import(url) as Record<string, unknown>;
    return { exports, files: [file], stamps: new Map([[file, stamp]]), bundled: false, autoImportsKey };
  }
  const stamps = new Map<string, string | undefined>();
  const ownPackage = packageRootOf(file);
  const bundle = await rolldown({
    input: file,
    platform: "node",
    cwd: dirname(file),
    logLevel: "silent",
    plugins: [{
      name: "meeko-utilities",
      async resolveId(source, importer, extra) {
        if (!importer || source.startsWith("\0") || isRelativeOrAbsolute(source)) return null;
        if (isBuiltin(source)) return { id: source, external: true };
        const resolved = await this.resolve(source, importer, { ...extra, skipSelf: true });
        if (!resolved || resolved.external || !isAbsolute(resolved.id)) return resolved;
        // A tsconfig path or `#imports` alias of the same package is local code: bundle and watch it.
        if (!/[\\/]node_modules[\\/]/.test(resolved.id) && packageRootOf(resolved.id) === ownPackage) return resolved;
        // A package loads natively, once per process, as in any Node program.
        return { id: pathToFileURL(resolved.id).href, external: true };
      },
      async load(id) {
        // Stamped before rolldown reads the file: an edit in between makes the stamp stale, never the code.
        if (isAbsolute(id)) stamps.set(id, await stampOf(id));
        return null;
      },
      transform(code, id) {
        if (!isAbsolute(id)) return null;
        // The same imports the Vite plugin adds to the module, before rolldown strips its types.
        let result = autoImports?.transform(code, id) ?? code;
        // The bundle runs from a `data:` URL; `import.meta` keeps describing the original file.
        if (/\bimport\.meta\.(?:url|filename|dirname)\b/.test(result)) {
          result = result.replace(/\bimport\.meta\.(url|filename|dirname)\b/g, (_match, key: string) => JSON.stringify(
            key === "url" ? pathToFileURL(id).href : key === "filename" ? id : dirname(id),
          ));
        }
        return result === code ? null : { code: result };
      },
    }],
  });
  let chunk: RolldownOutputChunk | undefined;
  try {
    const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
    chunk = output.find((item) => item.type === "chunk");
  } finally {
    await bundle.close();
  }
  if (!chunk?.code) throw new Error(`rolldown no generó código para ${file}`);
  // Every local module rolldown loaded, also one whose exports it inlined (a constant) and left
  // out of `moduleIds`: a change there still changes the output.
  const files = [...new Set([file, ...stamps.keys(), ...(chunk.moduleIds ?? []).filter((id) => isAbsolute(id))])];
  for (const dependency of files) if (!stamps.has(dependency)) stamps.set(dependency, await stampOf(dependency));
  // Stack traces name the module, not the whole base64 URL.
  const code = `${chunk.code}\n//# sourceURL=${pathToFileURL(file).href}?meeko-utilities-bundle\n`;
  const exports = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`) as Record<string, unknown>;
  return { exports, files, stamps, bundled: true, autoImportsKey };
}

function isRelativeOrAbsolute(specifier: string): boolean {
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../")
    || specifier.startsWith("file:") || isAbsolute(specifier);
}

const packageRoots = new Map<string, string | undefined>();

/** The nearest directory with a `package.json` above `file`. */
function packageRootOf(file: string): string | undefined {
  const start = dirname(file);
  if (packageRoots.has(start)) return packageRoots.get(start);
  let directory = start;
  let found: string | undefined;
  for (;;) {
    if (existsSync(join(directory, "package.json"))) { found = directory; break; }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  packageRoots.set(start, found);
  return found;
}

/**
 * Whether the modules are bundled with rolldown: only then do they receive a Meeko project's
 * autoimports, so without it the registry (which runs `meeko.config.*`) is not read.
 */
export async function canBundleUtilities(): Promise<boolean> {
  return await findRolldown() !== undefined;
}

/**
 * rolldown from the `vite` this package resolves (Vite 8 depends on it), then a `rolldown` or
 * `vite` of the working directory. `undefined` when none is installed.
 */
function findRolldown(): Promise<Rolldown | undefined> {
  return rolldownLoader ??= (async () => {
    const own = createRequire(import.meta.url);
    const project = createRequire(join(process.cwd(), "package.json"));
    const candidates: Array<() => string> = [
      () => createRequire(own.resolve("vite/package.json")).resolve("rolldown"),
      () => own.resolve("rolldown"),
      () => createRequire(project.resolve("vite/package.json")).resolve("rolldown"),
      () => project.resolve("rolldown"),
    ];
    for (const candidate of candidates) {
      let path: string;
      try { path = candidate(); } catch { continue; }
      try {
        const module = await import(pathToFileURL(path).href) as { rolldown?: unknown };
        if (typeof module.rolldown === "function") return module.rolldown as Rolldown;
      } catch {
        continue;
      }
    }
    return undefined;
  })();
}
