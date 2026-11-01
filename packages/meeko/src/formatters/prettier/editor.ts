import type { Options, Plugin } from "prettier";

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import plugin from "./plugin";

/** Formateo de un `.meeko` abierto en un editor. */
export interface EditorFormatRequest {
  readonly text: string;
  readonly filename: string;
  readonly tabSize: number;
  readonly insertSpaces: boolean;
  /** `meeko.format.indentSections`; la configuración de Prettier del proyecto prevalece. */
  readonly indentSections?: boolean;
  /**
   * `false` en un workspace no confiable: no se carga el Prettier del proyecto ni su configuración,
   * porque ambos ejecutan código del proyecto. Se usa el Prettier incluido con las opciones del editor.
   */
  readonly trusted: boolean;
}

/** Texto formateado y el Prettier que lo produjo. */
export interface EditorFormatResult {
  readonly text: string;
  /** `project` si se cargó el Prettier resoluble desde el archivo; `bundled` si es el de Meeko. */
  readonly prettier: "project" | "bundled";
  readonly version: string;
  /**
   * `true` si `.prettierignore` o `.gitignore` excluyen el archivo, como en la CLI de Prettier:
   * `text` es entonces el original y el editor no debe aplicar ediciones.
   */
  readonly ignored?: boolean;
}

interface PrettierApi {
  readonly version: string;
  format(source: string, options: Options): Promise<string>;
  getFileInfo(file: string, options: { ignorePath?: string[]; resolveConfig?: boolean }): Promise<{ ignored: boolean }>;
  resolveConfig(file: string, options: { useCache?: boolean; editorconfig?: boolean }): Promise<Options | null>;
}

const ownPluginNames = new Set(["@meekojs/meeko/prettier"]);
const loaded = new Map<string, Promise<PrettierApi | undefined>>();

function importPrettier(path: string): Promise<PrettierApi | undefined> {
  let pending = loaded.get(path);
  if (!pending) {
    pending = import(pathToFileURL(path).href).then((module: { default?: PrettierApi } & Partial<PrettierApi>) => {
      const api = (typeof module.format === "function" ? module : module.default) as PrettierApi | undefined;
      // The plugin implements the Prettier 3 plugin API.
      return api && typeof api.format === "function" && /^3\./.test(api.version) ? api : undefined;
    }, () => undefined);
    loaded.set(path, pending);
  }
  return pending;
}

function resolveFrom(base: string, specifier: string): string | undefined {
  try { return createRequire(base).resolve(specifier); }
  catch { return undefined; }
}

let bundled: Promise<PrettierApi | undefined> | undefined;

/** Prettier incluido con Meeko (o con la extensión); `undefined` si no está instalado. */
function bundledPrettier(): Promise<PrettierApi | undefined> {
  bundled ??= import("prettier").then((module) => module as unknown as PrettierApi, () => undefined);
  return bundled;
}

/** Plugins de la configuración resueltos desde el archivo; el de Meeko se sustituye por este. */
function configPlugins(plugins: Options["plugins"], filename: string): Array<string | URL | Plugin> {
  const resolved: Array<string | URL | Plugin> = [];
  for (const entry of plugins ?? []) {
    if (typeof entry !== "string") resolved.push(entry);
    else if (!ownPluginNames.has(entry)) resolved.push(resolveFrom(filename, entry) ?? entry);
  }
  return resolved;
}

/**
 * `.prettierignore` y `.gitignore` que afectan a `filename`: los de su carpeta y los de cada carpeta
 * superior hasta la raíz del repositorio (la que contiene `.git`) o del disco. Prettier interpreta
 * los patrones de cada archivo relativos a su carpeta, de modo que sirve tanto el de la raíz del
 * workspace como el de un subproyecto. Sólo se leen datos; no se ejecuta código del proyecto.
 */
function ignoreFiles(filename: string): string[] {
  const found: string[] = [];
  let dir = dirname(filename);
  for (;;) {
    for (const name of [".prettierignore", ".gitignore"]) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) found.push(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir || existsSync(join(dir, ".git"))) return found;
    dir = parent;
  }
}

/** Si los archivos de exclusión del proyecto ignoran `filename`; un error al leerlos no lo ignora. */
async function isIgnored(prettier: PrettierApi, filename: string): Promise<boolean> {
  const ignorePath = ignoreFiles(filename);
  if (!ignorePath.length) return false;
  try {
    // `resolveConfig` stays off: it would load the project's plugins, and the ignore patterns do not need them.
    return (await prettier.getFileInfo(filename, { ignorePath, resolveConfig: false })).ignored;
  } catch {
    return false;
  }
}

/**
 * Formatea con el Prettier del proyecto (workspace confiable con `prettier` resoluble desde el
 * archivo) y su configuración, o con el incluido. `undefined` si no hay ningún Prettier disponible.
 * Un archivo que `.prettierignore` o `.gitignore` excluyen, como en la CLI de Prettier, se devuelve
 * sin cambios con `ignored: true`; también en un workspace no confiable, porque sólo se leen esos
 * archivos. Un archivo que no compila rechaza la promesa con el error de sintaxis de Prettier.
 */
export async function formatWithPrettier(request: EditorFormatRequest): Promise<EditorFormatResult | undefined> {
  const projectPath = request.trusted ? resolveFrom(request.filename, "prettier") : undefined;
  let prettier = projectPath ? await importPrettier(projectPath) : undefined;
  const source: EditorFormatResult["prettier"] = prettier ? "project" : "bundled";
  prettier ??= await bundledPrettier();
  if (!prettier) return undefined;
  if (await isIgnored(prettier, request.filename)) return { text: request.text, prettier: source, version: prettier.version, ignored: true };

  const config = request.trusted ? await prettier.resolveConfig(request.filename, { useCache: false, editorconfig: true }) : null;
  const { plugins, ...projectOptions } = config ?? {};
  const options: Options = {
    tabWidth: request.tabSize,
    useTabs: !request.insertSpaces,
    // The editor keeps the document's line endings unless the project configures them.
    endOfLine: "auto",
    meekoIndentSections: request.indentSections === true,
    ...projectOptions,
    // Sorting by the stylesheet or Tailwind runs the project's PostCSS configuration, `@utilities` modules and Tailwind plugins.
    ...(request.trusted ? {} : { meekoSortClasses: "off" }),
    filepath: request.filename,
    parser: "meeko",
  };
  const extra = configPlugins(plugins, request.filename);
  let text: string;
  try {
    text = await prettier.format(request.text, { ...options, plugins: [...extra, plugin] });
  } catch (error) {
    // A project plugin that cannot load must not block formatting .meeko files.
    if (!extra.length || (error as { loc?: unknown }).loc) throw error;
    text = await prettier.format(request.text, { ...options, plugins: [plugin] });
  }
  return { text, prettier: source, version: prettier.version };
}
