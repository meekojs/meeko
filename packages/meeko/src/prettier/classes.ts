import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { isMeekoProject } from "../framework/clean.js";

/** Valores de `meekoSortClasses`. */
export type ClassSortMode = "off" | "stylesheet" | "alphabetical";

/**
 * Opción interna con la que el parser `meeko` pasa a la plantilla el orden de las clases: la hoja
 * global del proyecto y, después, el `<style>` del componente.
 */
export const classOrderOption = "__meekoClassOrder";

/** HTML separates the tokens of `class` with ASCII whitespace only; U+00A0 belongs to a token. */
const htmlWhitespace = /[\t\n\f\r ]+/;

/** The tokens of a `class` value, each once, in the order of their first appearance. */
export function classTokens(value: string): string[] {
  const tokens = new Set<string>();
  for (const token of value.split(htmlWhitespace)) if (token) tokens.add(token);
  return [...tokens];
}

/**
 * Orders the tokens of one `class` value. `stylesheet` keeps the classes the order does not know
 * first, in their order, and then the known ones by their position; `alphabetical` compares code
 * units, independent of the locale.
 */
export function sortClassTokens(tokens: readonly string[], mode: ClassSortMode | undefined, order: ReadonlyMap<string, number> | undefined): string[] {
  if (mode === "alphabetical") return [...tokens].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (mode !== "stylesheet" || !order) return [...tokens];
  const unknown = tokens.filter((token) => !order.has(token));
  const known = tokens.filter((token) => order.has(token)).sort((left, right) => order.get(left)! - order.get(right)!);
  return [...unknown, ...known];
}

/** Every class a stylesheet's selectors name, in source order, including repetitions. Throws if the CSS does not parse. */
export function classNamesOf(css: string): string[] {
  const names: string[] = [];
  const bySelector = new Map<string, readonly string[]>();
  postcss.parse(css).walkRules((rule) => {
    let found = bySelector.get(rule.selector);
    if (!found) {
      const classes: string[] = [];
      try {
        selectorParser((selectors) => { selectors.walkClasses((node) => { classes.push(node.value); }); }).processSync(rule.selector);
      } catch {
        // A selector postcss-selector-parser rejects (a preprocessor's syntax) names no class.
      }
      found = classes;
      bySelector.set(rule.selector, found);
    }
    names.push(...found);
  });
  return names;
}

/** Extends `base` with the classes of `css` that it does not know, after its own. */
export function appendClassOrder(base: ReadonlyMap<string, number>, css: string): ReadonlyMap<string, number> {
  let names: string[];
  try { names = classNamesOf(css); }
  catch { return base; }
  const order = new Map(base);
  for (const name of names) if (!order.has(name)) order.set(name, order.size);
  return order;
}

/** Where the plugin reports why it does not sort; tests replace it. Once per project and reason. */
export const classOrderWarnings = {
  write(message: string): void { process.stderr.write(message); },
};
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  classOrderWarnings.write(`[meeko] Aviso: meekoSortClasses "stylesheet" no ordena las clases: ${message}\n`);
}

/** Files whose presence or contents change which PostCSS configuration Vite loads for the root. */
const postcssConfigNames = [
  "package.json", ".postcssrc", ".postcssrc.json", ".postcssrc.yaml", ".postcssrc.yml",
  ".postcssrc.js", ".postcssrc.cjs", ".postcssrc.mjs", ".postcssrc.ts", ".postcssrc.cts", ".postcssrc.mts",
  "postcss.config.js", "postcss.config.cjs", "postcss.config.mjs", "postcss.config.ts", "postcss.config.cts", "postcss.config.mts",
] as const;
const globalStylesheet = join("app", "styles", "main.css");
/** A failed stylesheet is retried after this long even if none of its known files changed (a fixed `@utilities` module). */
const failureRetryMs = 2000;

interface StylesheetEntry {
  /** `mtimeMs:size` (or `missing`) of the stylesheet, its dependencies and the PostCSS configuration files. */
  readonly stamps: ReadonlyMap<string, string>;
  readonly order: ReadonlyMap<string, number> | undefined;
  readonly retryAt?: number;
}

const entries = new Map<string, Promise<StylesheetEntry>>();

async function stampOf(file: string): Promise<string> {
  try {
    const stats = await stat(file);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "missing";
  }
}

async function isCurrent(entry: StylesheetEntry): Promise<boolean> {
  if (entry.retryAt !== undefined && Date.now() >= entry.retryAt) return false;
  const current = await Promise.all([...entry.stamps].map(async ([file, stamp]) => await stampOf(file) === stamp));
  return current.every(Boolean);
}

/** The first folder above `filepath` with `meeko.config.*` or a `package.json` that depends on `@meekojs/meeko`. */
async function projectRootOf(filepath: string): Promise<string | undefined> {
  let directory = dirname(resolve(filepath));
  for (;;) {
    if (await isMeekoProject(directory)) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

interface ViteApi {
  resolveConfig(config: Record<string, unknown>, command: "serve"): Promise<unknown>;
  preprocessCSS(code: string, filename: string, config: never): Promise<{ code: string; deps?: Set<string> }>;
}

/** The project's Vite, as `meeko dev` runs it; the one next to this package otherwise. */
async function importVite(root: string): Promise<ViteApi> {
  let path: string | undefined;
  try { path = createRequire(join(root, "package.json")).resolve("vite"); }
  catch { path = undefined; }
  return (path ? await import(pathToFileURL(path).href) : await import("vite")) as ViteApi;
}

async function processStylesheet(root: string): Promise<StylesheetEntry> {
  const file = join(root, globalStylesheet);
  const stamps = new Map<string, string>();
  // Stamped before reading: a change while the stylesheet is processed reprocesses it next time.
  for (const watched of [file, ...postcssConfigNames.map((name) => join(root, name))]) stamps.set(watched, await stampOf(watched));
  if (stamps.get(file) === "missing") {
    warnOnce(`${root}\0missing`, `no existe ${globalStylesheet.replaceAll("\\", "/")} en ${root}`);
    return { stamps, order: undefined };
  }
  // Vite and postcss-load-config set NODE_ENV when it is unset; Prettier's process keeps its own.
  const hadNodeEnv = Object.hasOwn(process.env, "NODE_ENV");
  const nodeEnv = process.env.NODE_ENV;
  try {
    const vite = await importVite(root);
    const code = await readFile(file, "utf8");
    // The pipeline of `meeko dev`: the project's postcss.config, Vite's `@import` and `@utilities`.
    const config = await vite.resolveConfig({ root, configFile: false, envDir: false, logLevel: "silent", mode: "development" }, "serve");
    const result = await vite.preprocessCSS(code, file, config as never);
    for (const dependency of result.deps ?? []) {
      const path = resolve(dependency);
      if (!stamps.has(path)) stamps.set(path, await stampOf(path));
    }
    const order = new Map<string, number>();
    for (const name of classNamesOf(result.code)) if (!order.has(name)) order.set(name, order.size);
    return { stamps, order };
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    warnOnce(`${root}\0failed`, `no se pudo procesar ${relative(root, file).replaceAll("\\", "/")} en ${root} (${reason})`);
    return { stamps, order: undefined, retryAt: Date.now() + failureRetryMs };
  } finally {
    if (hadNodeEnv) process.env.NODE_ENV = nodeEnv;
    else delete process.env.NODE_ENV;
  }
}

/**
 * Order of the classes of the project's global stylesheet (`app/styles/main.css` processed as
 * `meeko dev` does), by first appearance. `undefined` when there is no project, no stylesheet or
 * it does not process; a warning says so once. Cached per project while none of the files it was
 * computed from changes.
 */
export async function stylesheetClassOrder(filepath: string | undefined): Promise<ReadonlyMap<string, number> | undefined> {
  if (!filepath) {
    warnOnce("\0nofile", "Prettier no recibió la ruta del archivo (filepath)");
    return undefined;
  }
  const root = await projectRootOf(filepath);
  if (!root) {
    warnOnce("\0noroot", `${filepath} no está en un proyecto Meeko (meeko.config.* o package.json con @meekojs/meeko)`);
    return undefined;
  }
  for (;;) {
    const pending = entries.get(root);
    if (pending) {
      const entry = await pending;
      if (await isCurrent(entry)) return entry.order;
      // Another format call already started the new processing: wait for it.
      if (entries.get(root) !== pending) continue;
    }
    const loading = processStylesheet(root);
    entries.set(root, loading);
    return (await loading).order;
  }
}
