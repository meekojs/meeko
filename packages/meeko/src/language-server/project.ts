import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import ts from "@typescript/typescript6";
import { discoverAutoImports, discoverAutoImportsSync } from "../autoimports.js";
import type { AutoImport } from "../autoimports.js";
import { projectDeclarationFiles } from "../compiler/project-declarations.js";
import { projectRoot } from "../compiler/project-root.js";
import { readMeekoConfigSync, readThemeOptionSync, resolveConfigSources } from "../framework/config.js";
import { generatedThemeLines } from "../framework/generate.js";
import { resolveThemeConfig } from "../framework/theme.js";
import { emptyAppIndex, loadAppIndex } from "./app-index.js";
import type { AppIndex } from "./app-index.js";
import { createVirtualComponent, diskVersion, resolveProjectCompilerOptions, serverVirtualSuffix, virtualFilenameOf } from "./model.js";
import type { ProjectCompilerOptions, VirtualComponent } from "./model.js";

/** Políticas comunes a todos los proyectos de un servidor de lenguaje. */
export interface WorkspaceOptions {
  /**
   * En un workspace de confianza se ejecuta la configuración del proyecto como `meeko check`.
   * Si no, sólo se lee su forma estática y nunca se importa código del proyecto.
   */
  readonly trusted: boolean;
  readonly log?: (message: string) => void;
}

interface ComponentEntry {
  readonly filename: string;
  readonly virtualFilename: string;
  source: string;
  version: number;
  open: boolean;
  component?: VirtualComponent | undefined;
  error?: unknown;
}

const ignoredDirectories = new Set(["node_modules", "dist", ".output"]);
const maximumComponents = 2000;

/**
 * The `@meekojs/meeko` the project resolves, by {@link pathKey}: its folder (also the real one, for a
 * package linked with `link:` or a junction) and the files of its public `exports` entries, each
 * with its module specifier (`@meekojs/meeko/framework`).
 */
interface PackageFiles {
  readonly roots: readonly string[];
  readonly entries: ReadonlyMap<string, string>;
}

/** Subpaths of `exports` that only compiled components import. */
const privateEntries = new Set(["./internal"]);

function meekoPackage(root: string): PackageFiles | undefined {
  for (let directory = root; ; directory = dirname(directory)) {
    const folder = join(directory, "node_modules", "@meekojs", "meeko");
    if (existsSync(join(folder, "package.json"))) {
      let real = folder;
      try { real = realpathSync(folder); } catch { /* A broken link: only its own path. */ }
      const roots = [...new Set([pathKey(folder), pathKey(real)])];
      const entries = new Map<string, string>();
      try {
        const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as { exports?: Record<string, unknown> };
        for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
          if (privateEntries.has(subpath)) continue;
          const files = typeof target === "string" ? [target] : target && typeof target === "object" ? Object.values(target).filter((value): value is string => typeof value === "string") : [];
          const specifier = `@meekojs/meeko${subpath === "." ? "" : subpath.slice(1)}`;
          for (const file of files) for (const base of [folder, real]) if (!entries.has(pathKey(join(base, file)))) entries.set(pathKey(join(base, file)), specifier);
        }
      } catch { /* Without a readable manifest, no file of the package is an entry. */ }
      return { roots, entries };
    }
    if (dirname(directory) === directory) return undefined;
  }
}

/** The file that exports an auto-import entry, and its module specifier once TypeScript resolved it. */
function entryModule(entry: ts.CompletionEntry): { file?: string; specifier?: string } {
  const specifier = entry.data?.moduleSpecifier ?? (entry.source && !/^[a-zA-Z]:[\\/]|^\//.test(entry.source) ? entry.source : undefined);
  const file = entry.data?.fileName;
  return { ...(file ? { file } : {}), ...(specifier ? { specifier } : {}) };
}

/**
 * How the completion offers an auto-import of `@meekojs/meeko`: `undefined` as TypeScript does (an
 * import from a public entry, or another module), `hidden` if no public entry exports it (a file of
 * its `dist/` or `src/`, its `internal` entry), or the public entry to import it from. A package
 * linked with `link:` resolves outside node_modules, so TypeScript may write a path into it
 * (`../../Clients/meeko/packages/meeko/dist/framework/middleware.js`) even for a public export.
 * TypeScript names the module that declares the export (`dist/framework/module.d.ts`), also for
 * `MeekoModule` from `@meekojs/meeko/framework`: the module specifier and the public exports decide.
 */
export function meekoAutoImport(project: MeekoProject, entry: ts.CompletionEntry): { readonly hidden: true } | { readonly specifier: string } | undefined {
  if (!entry.hasAction) return undefined;
  const specifier = entry.data?.moduleSpecifier;
  const name = entry.data?.exportName ?? entry.name;
  if (specifier && /^@meekojs\/meeko(?:\/|$)/.test(specifier)) {
    const subpath = `.${specifier.slice("@meekojs/meeko".length)}`;
    if (!privateEntries.has(subpath) && !/^\.\/(?:dist|src)(?:\/|$)/.test(subpath)) return undefined;
    const publicEntry = project.publicMeekoExports().get(name);
    return publicEntry ? { specifier: publicEntry } : { hidden: true };
  }
  const meeko = project.meekoPackage();
  const file = entry.data?.fileName;
  if (!meeko || !file) return undefined;
  const key = pathKey(file);
  if (!meeko.roots.some((root) => key.startsWith(`${root}/`))) return undefined;
  const publicEntry = project.publicMeekoExports().get(name);
  return publicEntry ? { specifier: publicEntry } : { hidden: true };
}

/**
 * An auto-import from a package (`@meekojs/meeko/framework`, a dependency), which the completion
 * lists after the local names and the project's own auto-imports.
 */
export function packageCompletion(project: MeekoProject, entry: ts.CompletionEntry): boolean {
  if (!entry.hasAction) return false;
  const { file, specifier } = entryModule(entry);
  if (file && /[\\/]node_modules[\\/]/.test(file)) return true;
  const meeko = project.meekoPackage();
  if (file && meeko?.roots.some((root) => pathKey(file).startsWith(`${root}/`))) return true;
  return specifier !== undefined && !/^[.#~]|^@\/|^[a-zA-Z]:[\\/]|^\//.test(specifier) && !project.isPathAlias(specifier);
}

/** Clave estable de una ruta, sin distinguir mayúsculas donde el sistema no lo hace. */
export function pathKey(path: string): string {
  const normalized = resolve(path).replaceAll("\\", "/");
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
}

/** The module specifier cache of tsserver; `ts.server.createModuleSpecifierCache` is internal. */
interface SpecifierCache {
  clear(): void;
}

/**
 * tsserver's cache of auto-import paths, keyed by the importing file. It is internal to
 * TypeScript 6, so without it the completions still work, only slower.
 */
function createSpecifierCache(root: string): SpecifierCache | undefined {
  const internal = ts as unknown as {
    toPath?: (file: string, base: string, canonical: (file: string) => string) => string;
    server?: { createModuleSpecifierCache?: (host: { toPath(file: string): string; watchNodeModulesForPackageJsonChanges(directory: string): { close(): void } }) => SpecifierCache };
  };
  const create = internal.server?.createModuleSpecifierCache;
  const toPath = internal.toPath;
  if (!create || !toPath) return undefined;
  const canonical = (file: string): string => ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase();
  // Changes inside node_modules are not watched; an install changes the project's package.json or
  // lockfile, and filesChanged clears the cache then.
  return create({ toPath: (file) => toPath(file, root, canonical), watchNodeModulesForPackageJsonChanges: () => ({ close() {} }) });
}

/**
 * Proyecto TypeScript compartido por los componentes de un paquete. Incluye los archivos del
 * tsconfig y todos los `.meeko` del proyecto para que referencias y renombrados crucen archivos.
 */
export class MeekoProject {
  readonly root: string;
  readonly service: ts.LanguageService;
  private compiler: ProjectCompilerOptions;
  /**
   * Module resolutions shared by every file of the program. Without it each import walks the
   * `node_modules` folders again with `stat` and `realpath`: about 20 s on the first diagnostics.
   */
  private moduleCache: ts.ModuleResolutionCache;
  /** Import paths already computed for auto-import completions, as tsserver keeps them. */
  private specifierCache: SpecifierCache | undefined;
  /** Files whose imports this host resolved, by TypeScript path. */
  private readonly resolvedFiles = new Set<string>();
  /**
   * Files that must resolve their imports again: a created or removed file can change them, and
   * the language service otherwise keeps the program while no script version changes.
   */
  private invalidatedFiles = new Set<string>();
  private registry: readonly AutoImport[] = [];
  private registryKey = "";
  private roots: readonly string[];
  private readonly entries = new Map<string, ComponentEntry>();
  private loading: Promise<void>;
  private counter = 0;
  private scanned = false;
  private index: Promise<AppIndex> | undefined;
  private packageFiles: PackageFiles | undefined | null = null;
  private publicExports: { readonly program: ts.Program; readonly names: ReadonlyMap<string, string> } | undefined;
  /** Error de la configuración dinámica, si se tuvo que recurrir a la lectura estática. */
  configError: string | undefined;
  /** The themes of `meeko.config.*` that the program declares; see {@link editorThemeDeclaration}. */
  private theme: EditorTheme | undefined;

  constructor(root: string, private readonly options: WorkspaceOptions) {
    this.root = resolve(root);
    this.compiler = resolveProjectCompilerOptions(this.root);
    this.theme = editorThemeDeclaration(this.root, this.compiler, undefined);
    this.moduleCache = this.createModuleCache();
    this.specifierCache = createSpecifierCache(this.root);
    this.roots = [this.root];
    // The language service passes getModuleResolutionCache on to the program, which shares its
    // package.json cache with auto-import completions; it is not in the public host type.
    const host: ts.LanguageServiceHost & {
      getModuleResolutionCache(): ts.ModuleResolutionCache;
      getModuleSpecifierCache(): SpecifierCache | undefined;
      hasInvalidatedResolutions(path: string): boolean;
    } = {
      getCompilationSettings: () => this.compiler.options,
      hasInvalidatedResolutions: (path) => this.invalidatedFiles.has(path),
      getModuleResolutionCache: () => this.moduleCache,
      getModuleSpecifierCache: () => this.specifierCache,
      getScriptFileNames: () => [
        ...this.compiler.fileNames,
        // Augmentations such as MeekoSession reach components only as program roots.
        ...this.roots.flatMap((root) => projectDeclarationFiles(root)),
        ...this.theme ? [this.theme.file] : [],
        ...[...this.entries.values()].flatMap((entry) => entry.component
          ? [entry.virtualFilename, ...(entry.component.server ? [entry.component.server.virtualFilename] : [])]
          : []),
      ],
      getScriptVersion: (file) => {
        const entry = this.virtualOwner(file);
        if (entry) return String(entry.version);
        return this.theme && pathKey(file) === pathKey(this.theme.file) ? `theme:${this.theme.version}` : diskVersion(file);
      },
      getScriptSnapshot: (file) => {
        const content = this.readFile(file);
        return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
      },
      getCurrentDirectory: () => this.root,
      getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
      fileExists: (file) => this.virtualEntry(file) !== undefined || this.themeText(file) !== undefined || ts.sys.fileExists(file),
      readFile: (file) => this.readFile(file),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: (file) => ts.sys.realpath?.(file) ?? file,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => ts.sys.newLine,
      // With NodeNext or Bundler resolution TypeScript prefers the `X.d.meeko.ts` that `meeko dev` or
      // `meeko types` generate, which may be stale and lack what the editor models (the type
      // arguments of a generic tag, for example): a component of this project resolves to its
      // live virtual module instead.
      resolveModuleNameLiterals: (literals, containingFile, redirectedReference, options, containingSourceFile) => {
        // TypeScript paths are canonical: forward slashes, lowercase without case sensitivity.
        const path = ts.sys.useCaseSensitiveFileNames ? containingFile : containingFile.toLowerCase();
        this.resolvedFiles.add(path);
        this.invalidatedFiles.delete(path);
        return this.resolveLiterals(host, literals, containingFile, redirectedReference, options, containingSourceFile);
      },
    };
    this.service = ts.createLanguageService(host, ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, this.root));
    this.loading = this.reloadRegistry();
  }

  private resolveLiterals(
    host: ts.ModuleResolutionHost, literals: readonly ts.StringLiteralLike[], containingFile: string,
    redirectedReference: ts.ResolvedProjectReference | undefined, options: ts.CompilerOptions, containingSourceFile: ts.SourceFile,
  ): ts.ResolvedModuleWithFailedLookupLocations[] {
    return literals.map((literal) => {
      const resolved = ts.resolveModuleName(
        literal.text, containingFile, options, host, this.moduleCache, redirectedReference,
        ts.getModeForUsageLocation(containingSourceFile, literal, options),
      );
      const owner = resolved.resolvedModule && this.declarationOwner(resolved.resolvedModule.resolvedFileName);
      return owner ? { ...resolved, resolvedModule: { ...resolved.resolvedModule!, resolvedFileName: owner, extension: ts.Extension.Ts } } : resolved;
    });
  }

  /** Espera la configuración y el registro de autoimports vigentes. */
  async ready(): Promise<void> {
    for (;;) {
      const current = this.loading;
      await current;
      if (current === this.loading) return;
    }
  }

  /** Registro de autoimports vigente, dinámico o estático según la confianza. */
  autoImports(): readonly AutoImport[] {
    return this.registry;
  }

  get trusted(): boolean {
    return this.options.trusted;
  }

  get compilerOptions(): ts.CompilerOptions {
    return this.compiler.options;
  }

  /** Sincroniza el texto de un documento abierto en el editor. */
  setDocument(filename: string, source: string): VirtualComponent | undefined {
    this.scan();
    const entry = this.entry(filename);
    entry.open = true;
    if (entry.source !== source || (!entry.component && entry.error === undefined)) {
      entry.source = source;
      this.rebuild(entry);
    }
    return entry.component;
  }

  /** Al cerrar un documento se vuelve a usar su contenido guardado. */
  closeDocument(filename: string): void {
    const entry = this.entries.get(pathKey(filename));
    if (!entry) return;
    entry.open = false;
    this.reloadFromDisk(entry);
  }

  /** Componente analizado de un archivo `.meeko`, abierto o del disco. */
  component(filename: string): VirtualComponent | undefined {
    this.scan();
    return this.entries.get(pathKey(filename))?.component;
  }

  /**
   * Los `.meeko` del proyecto con su texto: el del editor si están abiertos, si no el guardado.
   * Lo leen los índices que no necesitan el modelo, como el de clases CSS.
   */
  componentSources(): readonly { readonly filename: string; readonly source: string }[] {
    this.scan();
    return [...this.entries.values()];
  }

  /** Error que impidió modelar un componente, por ejemplo HTML inválido. */
  componentError(filename: string): unknown {
    return this.entries.get(pathKey(filename))?.error;
  }

  /**
   * Documento virtual con este nombre en los resultados de TypeScript: el de un componente
   * (`x.meeko.ts`) o el de su bloque `<script server>` (`x.meeko.server.ts`).
   */
  virtualEntry(fileName: string): VirtualComponent | undefined {
    const entry = this.virtualOwner(fileName);
    if (!entry?.component) return undefined;
    return fileName.endsWith(`.meeko${serverVirtualSuffix}`) ? entry.component.server : entry.component;
  }

  /**
   * Páginas, endpoints API y procedimientos RPC del proyecto, descubiertos como los manifiestos de
   * `.meeko/manifests`. Se calcula al primer uso y se invalida con cualquier cambio en disco.
   */
  appIndex(): Promise<AppIndex> {
    this.index ??= loadAppIndex(this.root, this.options.trusted).catch(() => emptyAppIndex);
    return this.index;
  }

  /** El `@meekojs/meeko` que resuelve el proyecto, enlazado o instalado; se calcula al primer uso. */
  meekoPackage(): PackageFiles | undefined {
    if (this.packageFiles === null) this.packageFiles = meekoPackage(this.root);
    return this.packageFiles;
  }

  /**
   * Nombres que exportan las entradas públicas de `@meekojs/meeko` presentes en el programa actual,
   * con el especificador de la entrada (`@meekojs/meeko/framework`); gana la primera de `exports`.
   */
  publicMeekoExports(): ReadonlyMap<string, string> {
    const program = this.service.getProgram();
    const meeko = this.meekoPackage();
    if (!program || !meeko) return new Map();
    if (this.publicExports?.program === program) return this.publicExports.names;
    const checker = program.getTypeChecker();
    const found = new Map<string, Map<string, string>>();
    for (const source of program.getSourceFiles()) {
      const specifier = meeko.entries.get(pathKey(source.fileName));
      const symbol = specifier === undefined ? undefined : checker.getSymbolAtLocation(source);
      if (!symbol) continue;
      const names = new Map<string, string>();
      for (const exported of checker.getExportsOfModule(symbol)) names.set(exported.name, specifier!);
      found.set(specifier!, names);
    }
    // In the order of `exports`: `@meekojs/meeko` before `@meekojs/meeko/framework`.
    const names = new Map<string, string>();
    for (const specifier of new Set(meeko.entries.values())) {
      for (const [name, entry] of found.get(specifier) ?? []) if (!names.has(name)) names.set(name, entry);
    }
    this.publicExports = { program, names };
    return names;
  }

  /** Si un especificador empieza por un alias de `paths` del tsconfig, como `@lib/greet.js`. */
  isPathAlias(specifier: string): boolean {
    return Object.keys(this.compiler.options.paths ?? {}).some((pattern) => {
      const star = pattern.indexOf("*");
      return star < 0 ? specifier === pattern : specifier.startsWith(pattern.slice(0, star));
    });
  }

  /** Raíces de código del proyecto (app, capas y módulos) según su configuración. */
  sourceRoots(): readonly string[] {
    return this.roots;
  }

  /** Texto de un archivo del programa, virtual o real. */
  readFile(file: string): string | undefined {
    return this.virtualEntry(file)?.code ?? this.themeText(file) ?? ts.sys.readFile(file);
  }

  /** Text of the declaration of the themes, when `file` is it. */
  private themeText(file: string): string | undefined {
    return this.theme && pathKey(file) === pathKey(this.theme.file) ? this.theme.text : undefined;
  }

  /** Atiende cambios del sistema de archivos y devuelve si afectan a este proyecto. */
  filesChanged(paths: readonly string[]): boolean {
    let affected = false;
    let configuration = false;
    let sources = false;
    for (const path of paths) {
      if (!pathKey(path).startsWith(`${pathKey(this.root)}/`)) continue;
      affected = true;
      const name = basename(path);
      if (/^tsconfig.*\.json$/.test(name) || /^meeko\.config\.[cm]?[jt]s$/.test(name)) configuration = true;
      if (/\.(?:meeko|[cm]?ts)$/.test(name) && !/[\\/]\.meeko[\\/]/.test(path)) sources = true;
      if (name.endsWith(".meeko")) {
        const entry = this.entries.get(pathKey(path));
        if (entry && !entry.open) this.reloadFromDisk(entry);
        else if (!entry && this.scanned) this.reloadFromDisk(this.entry(path));
      } else if (this.directoryChanged(path)) sources = true;
    }
    if (affected) {
      this.index = undefined;
      // An install or a `link:` may change which @meekojs/meeko the project resolves.
      this.packageFiles = null;
    }
    if (configuration) {
      this.compiler = resolveProjectCompilerOptions(this.root);
      this.theme = editorThemeDeclaration(this.root, this.compiler, this.theme);
    }
    // A file created, removed or renamed can change where an import resolves.
    if (configuration) this.moduleCache = this.createModuleCache();
    else if (affected) this.moduleCache.clear();
    if (affected) {
      this.specifierCache?.clear();
      this.invalidatedFiles = new Set(this.resolvedFiles);
    }
    if (configuration || sources) this.loading = this.loading.then(() => this.reloadRegistry());
    return affected;
  }

  dispose(): void {
    this.service.dispose();
  }

  /**
   * A folder created, removed or renamed (`app/components/Layout`): the editor's watcher may report
   * only the folder, not each `.meeko` inside. Returns whether it changed the components.
   */
  private directoryChanged(path: string): boolean {
    let directory = false;
    try { directory = statSync(path).isDirectory(); } catch { /* Removed. */ }
    if (directory) {
      if (/[\\/](?:\.meeko|node_modules)(?:[\\/]|$)/.test(path)) return false;
      if (!this.scanned) return true;
      let changed = false;
      for (const file of meekoFiles(path)) {
        const entry = this.entries.get(pathKey(file));
        if (entry?.open) continue;
        this.reloadFromDisk(entry ?? this.entry(file));
        changed = true;
      }
      return changed;
    }
    const prefix = `${pathKey(path)}/`;
    let removed = false;
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(prefix) || entry.open) continue;
      this.entries.delete(key);
      removed = true;
    }
    return removed;
  }

  private createModuleCache(): ts.ModuleResolutionCache {
    const canonical = (file: string): string => ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase();
    return ts.createModuleResolutionCache(this.root, canonical, this.compiler.options);
  }

  /**
   * Módulo virtual del componente de este proyecto cuya declaración generada `X.d.meeko.ts`
   * (junto a `X.meeko` o bajo `.meeko/types`) resolvió TypeScript, si existe.
   */
  private declarationOwner(fileName: string): string | undefined {
    if (!fileName.endsWith(".d.meeko.ts")) return undefined;
    const sibling = `${fileName.slice(0, -".d.meeko.ts".length)}.meeko`;
    const types = join(this.root, ".meeko", "types");
    const generated = pathKey(sibling).startsWith(`${pathKey(types)}/`);
    const virtual = virtualFilenameOf(generated ? join(this.root, relative(types, sibling)) : sibling);
    return this.virtualEntry(virtual) ? virtual : undefined;
  }

  /** Entrada del componente al que pertenece un archivo virtual, si existe. */
  private virtualOwner(fileName: string): ComponentEntry | undefined {
    const server = fileName.endsWith(`.meeko${serverVirtualSuffix}`);
    if (!server && !fileName.endsWith(".meeko.ts")) return undefined;
    const entry = this.entries.get(pathKey(fileName.slice(0, -(server ? serverVirtualSuffix : ".ts").length)));
    const virtual = server ? entry?.component?.server : entry?.component;
    return virtual && pathKey(virtual.virtualFilename) === pathKey(fileName) ? entry : undefined;
  }

  private entry(filename: string): ComponentEntry {
    const key = pathKey(filename);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { filename: resolve(filename), virtualFilename: virtualFilenameOf(filename), source: "", version: 0, open: false };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private rebuild(entry: ComponentEntry): void {
    entry.version = ++this.counter;
    try {
      entry.component = createVirtualComponent(entry.source, entry.filename, { registry: this.registry, tolerant: true });
      entry.error = undefined;
    } catch (error) {
      entry.component = undefined;
      entry.error = error;
    }
  }

  private reloadFromDisk(entry: ComponentEntry): void {
    let source: string;
    try { source = readFileSync(entry.filename, "utf8"); }
    catch {
      this.entries.delete(pathKey(entry.filename));
      return;
    }
    if (source !== entry.source || !entry.component) {
      entry.source = source;
      this.rebuild(entry);
    }
  }

  /** Incorpora los componentes guardados del proyecto la primera vez que se necesitan. */
  private scan(): void {
    if (this.scanned) return;
    this.scanned = true;
    for (const path of meekoFiles(this.root)) {
      const entry = this.entry(path);
      if (!entry.open && !entry.component) this.reloadFromDisk(entry);
    }
  }

  private async reloadRegistry(): Promise<void> {
    let registry: readonly AutoImport[] = [];
    this.configError = undefined;
    if (this.options.trusted) {
      try { registry = await discoverAutoImports(this.root); }
      catch (error) {
        this.configError = error instanceof Error ? error.message : String(error);
        this.options.log?.(`${this.root}: falló la configuración dinámica de Meeko; se usa el lector estático: ${this.configError}`);
        registry = this.staticRegistry();
      }
    } else registry = this.staticRegistry();
    this.roots = await this.resolveSourceRoots();
    const key = JSON.stringify(registry);
    if (key === this.registryKey) return;
    this.registry = registry;
    this.registryKey = key;
    for (const entry of this.entries.values()) this.rebuild(entry);
  }

  /** Como `meeko check`: la configuración se ejecuta sólo en un workspace de confianza. */
  private async resolveSourceRoots(): Promise<readonly string[]> {
    if (this.options.trusted) {
      try { return (await resolveConfigSources(this.root)).map((source) => source.root); }
      catch { /* The static reader below reports the same configuration problem. */ }
    }
    try { return (await resolveConfigSources(this.root, readMeekoConfigSync(this.root))).map((source) => source.root); }
    catch { return [this.root]; }
  }

  private staticRegistry(): readonly AutoImport[] {
    try { return discoverAutoImportsSync(this.root); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.configError ??= message;
      this.options.log?.(`${this.root}: falló la configuración estática de Meeko: ${message}`);
      return [];
    }
  }
}

/** The saved `.meeko` files under a folder, without dependencies, build output or hidden folders. */
function meekoFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    let items;
    try { items = readdirSync(directory, { withFileTypes: true }); }
    catch { return; }
    for (const item of items) {
      if (found.length >= maximumComponents) return;
      const path = join(directory, item.name);
      if (item.isDirectory()) {
        if (!item.name.startsWith(".") && !ignoredDirectories.has(item.name)) visit(path);
      } else if (item.name.endsWith(".meeko")) found.push(path);
    }
  };
  visit(root);
  return found;
}

/** Conjunto de proyectos, uno por raíz de paquete. */
export class MeekoWorkspace {
  private readonly projects = new Map<string, MeekoProject>();

  constructor(readonly options: WorkspaceOptions) {}

  /** Proyecto que contiene un archivo; se crea al primer uso. */
  projectFor(filename: string): MeekoProject {
    const root = projectRoot(filename);
    const key = pathKey(root);
    let project = this.projects.get(key);
    if (!project) {
      project = new MeekoProject(root, this.options);
      this.projects.set(key, project);
    }
    return project;
  }

  /** Proyectos afectados por cambios en disco. */
  filesChanged(paths: readonly string[]): MeekoProject[] {
    return [...this.projects.values()].filter((project) => project.filesChanged(paths));
  }

  all(): readonly MeekoProject[] {
    return [...this.projects.values()];
  }

  dispose(): void {
    for (const project of this.projects.values()) project.dispose();
    this.projects.clear();
  }
}

/** Versions of the declarations of the themes: a new text is never an older version. */
let editorThemeVersion = 0;

/** The declaration of the themes that the editor adds to a project's program. */
interface EditorTheme {
  readonly file: string;
  readonly text: string;
  readonly version: number;
}

/**
 * `GeneratedTheme` from `theme` of `meeko.config.*`, read without running it, as
 * `.meeko/types/routes.d.ts` declares it for `meeko check`: the editor types `useTheme()`, the
 * props and the snippets of `<MeekoThemeToggle>` with the application's themes, also before the
 * first `meeko check` or `meeko dev`. None when the tsconfig already includes that file, without
 * `theme` or when only running the configuration tells (`ThemeChoice` stays `string`). The file
 * is virtual: the editor never writes it.
 */
function editorThemeDeclaration(root: string, compiler: ProjectCompilerOptions, previous: EditorTheme | undefined): EditorTheme | undefined {
  const generated = pathKey(join(root, ".meeko", "types", "routes.d.ts"));
  if (compiler.fileNames.some((file) => pathKey(file) === generated)) return undefined;
  let theme;
  // An invalid theme is an error of `meeko check` and of the server; the editor then leaves it out.
  try { theme = resolveThemeConfig(readThemeOptionSync(root)); }
  catch { theme = undefined; }
  if (!theme) return undefined;
  const text = [
    "// The themes of meeko.config.* for the editor; meeko check declares them in .meeko/types/routes.d.ts.",
    'import "@meekojs/meeko/framework";',
    'declare module "@meekojs/meeko/framework" {',
    ...generatedThemeLines(theme),
    "}",
    "export {};",
    "",
  ].join("\n");
  if (previous?.text === text) return previous;
  return { file: join(root, ".meeko", "types", "theme.editor.d.ts"), text, version: ++editorThemeVersion };
}
