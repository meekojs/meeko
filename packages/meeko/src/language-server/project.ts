import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import ts from "@typescript/typescript6";
import { discoverAutoImports, discoverAutoImportsSync } from "../autoimports.js";
import type { AutoImport } from "../autoimports.js";
import { projectRoot } from "../compiler/project-root.js";
import { readMeekoConfigSync, resolveConfigSources } from "../framework/config.js";
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
  /** Error de la configuración dinámica, si se tuvo que recurrir a la lectura estática. */
  configError: string | undefined;

  constructor(root: string, private readonly options: WorkspaceOptions) {
    this.root = resolve(root);
    this.compiler = resolveProjectCompilerOptions(this.root);
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
        ...[...this.entries.values()].flatMap((entry) => entry.component
          ? [entry.virtualFilename, ...(entry.component.server ? [entry.component.server.virtualFilename] : [])]
          : []),
      ],
      getScriptVersion: (file) => {
        const entry = this.virtualOwner(file);
        return entry ? String(entry.version) : diskVersion(file);
      },
      getScriptSnapshot: (file) => {
        const content = this.readFile(file);
        return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
      },
      getCurrentDirectory: () => this.root,
      getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
      fileExists: (file) => this.virtualEntry(file) !== undefined || ts.sys.fileExists(file),
      readFile: (file) => this.readFile(file),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      realpath: (file) => ts.sys.realpath?.(file) ?? file,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => ts.sys.newLine,
      // With NodeNext resolution TypeScript prefers the `X.d.meeko.ts` that `meeko dev` or
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

  /** Raíces de código del proyecto (app, capas y módulos) según su configuración. */
  sourceRoots(): readonly string[] {
    return this.roots;
  }

  /** Texto de un archivo del programa, virtual o real. */
  readFile(file: string): string | undefined {
    return this.virtualEntry(file)?.code ?? ts.sys.readFile(file);
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
      }
    }
    if (affected) this.index = undefined;
    if (configuration) this.compiler = resolveProjectCompilerOptions(this.root);
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
    visit(this.root);
    for (const path of found) {
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
