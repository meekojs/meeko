import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import ts from "@typescript/typescript6";
import { discoverAutoImports, discoverAutoImportsSync } from "../autoimports.js";
import type { AutoImport } from "../autoimports.js";
import { projectRoot } from "../compiler/project-root.js";
import { createVirtualComponent, diskVersion, resolveProjectCompilerOptions, virtualFilenameOf } from "./model.js";
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

/**
 * Proyecto TypeScript compartido por los componentes de un paquete. Incluye los archivos del
 * tsconfig y todos los `.meeko` del proyecto para que referencias y renombrados crucen archivos.
 */
export class MeekoProject {
  readonly root: string;
  readonly service: ts.LanguageService;
  private compiler: ProjectCompilerOptions;
  private registry: readonly AutoImport[] = [];
  private registryKey = "";
  private readonly entries = new Map<string, ComponentEntry>();
  private loading: Promise<void>;
  private counter = 0;
  private scanned = false;
  /** Error de la configuración dinámica, si se tuvo que recurrir a la lectura estática. */
  configError: string | undefined;

  constructor(root: string, private readonly options: WorkspaceOptions) {
    this.root = resolve(root);
    this.compiler = resolveProjectCompilerOptions(this.root);
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => this.compiler.options,
      getScriptFileNames: () => [
        ...this.compiler.fileNames,
        ...[...this.entries.values()].filter((entry) => entry.component).map((entry) => entry.virtualFilename),
      ],
      getScriptVersion: (file) => {
        const entry = this.entries.get(pathKey(file.replace(/\.ts$/, "")));
        return entry?.component && entry.virtualFilename === file ? String(entry.version) : diskVersion(file);
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
    };
    this.service = ts.createLanguageService(host, ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, this.root));
    this.loading = this.reloadRegistry();
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

  /** Componente cuyo archivo virtual tiene este nombre en los resultados de TypeScript. */
  virtualEntry(fileName: string): VirtualComponent | undefined {
    if (!fileName.endsWith(".meeko.ts")) return undefined;
    const entry = this.entries.get(pathKey(fileName.slice(0, -3)));
    return entry?.component && pathKey(entry.virtualFilename) === pathKey(fileName) ? entry.component : undefined;
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
    if (configuration) this.compiler = resolveProjectCompilerOptions(this.root);
    if (configuration || sources) this.loading = this.loading.then(() => this.reloadRegistry());
    return affected;
  }

  dispose(): void {
    this.service.dispose();
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
        this.options.log?.(`${this.root}: dynamic Meeko configuration failed, using the static reader: ${this.configError}`);
        registry = this.staticRegistry();
      }
    } else registry = this.staticRegistry();
    const key = JSON.stringify(registry);
    if (key === this.registryKey) return;
    this.registry = registry;
    this.registryKey = key;
    for (const entry of this.entries.values()) this.rebuild(entry);
  }

  private staticRegistry(): readonly AutoImport[] {
    try { return discoverAutoImportsSync(this.root); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.configError ??= message;
      this.options.log?.(`${this.root}: static Meeko configuration failed: ${message}`);
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
