import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Options, Plugin } from "prettier";
import plugin from "./plugin.js";

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
}

interface PrettierApi {
  readonly version: string;
  format(source: string, options: Options): Promise<string>;
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
 * Formatea con el Prettier del proyecto (workspace confiable con `prettier` resoluble desde el
 * archivo) y su configuración, o con el incluido. `undefined` si no hay ningún Prettier disponible.
 * Un archivo que no compila rechaza la promesa con el error de sintaxis de Prettier.
 */
export async function formatWithPrettier(request: EditorFormatRequest): Promise<EditorFormatResult | undefined> {
  const projectPath = request.trusted ? resolveFrom(request.filename, "prettier") : undefined;
  let prettier = projectPath ? await importPrettier(projectPath) : undefined;
  const source: EditorFormatResult["prettier"] = prettier ? "project" : "bundled";
  prettier ??= await bundledPrettier();
  if (!prettier) return undefined;

  const config = request.trusted ? await prettier.resolveConfig(request.filename, { useCache: false, editorconfig: true }) : null;
  const { plugins, ...projectOptions } = config ?? {};
  const options: Options = {
    tabWidth: request.tabSize,
    useTabs: !request.insertSpaces,
    // The editor keeps the document's line endings unless the project configures them.
    endOfLine: "auto",
    meekoIndentSections: request.indentSections === true,
    ...projectOptions,
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
