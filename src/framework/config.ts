import { realpath, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { composeFrameworkRoutes } from "./modules.js";
import type { RouteRecord } from "./router.js";
import type { MeekoConfig } from "./config-type.js";

export type { MeekoConfig } from "./config-type.js";

export interface ConfigSource {
  readonly name: string;
  readonly root: string;
  readonly kind: "app" | "layer" | "module";
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function configFile(root: string): Promise<string | undefined> {
  const files = ["meeko.config.ts", "meeko.config.mts", "meeko.config.js", "meeko.config.mjs"];
  const found: string[] = [];
  for (const name of files) {
    const file = resolve(root, name);
    try { if ((await stat(file)).isFile()) found.push(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (found.length > 1) throw new Error(`Multiple Meeko configuration files: ${found.join(", ")}`);
  return found[0];
}

/** Loads the optional project configuration using Node 24's TypeScript support. */
export async function loadMeekoConfig(projectRoot: string): Promise<MeekoConfig> {
  const root = resolve(projectRoot);
  const file = await configFile(root);
  if (!file) return {};
  const url = pathToFileURL(file);
  url.searchParams.set("mtime", String((await stat(file)).mtimeMs));
  let loaded: unknown;
  try { loaded = (await import(url.href) as { default?: unknown }).default; }
  catch (error) { throw new Error(`Cannot load ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new TypeError(`${file} must export a Meeko configuration object`);
  const config = loaded as MeekoConfig;
  for (const [key, entries] of [["extends", config.extends], ["modules", config.modules], ["imports.serverDirs", config.imports?.serverDirs]] as const) {
    if (entries !== undefined && (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string" || !entry))) {
      throw new TypeError(`${file}: ${key} must be an array of nonempty paths`);
    }
  }
  return config;
}

/** Resolves sources and rejects accidental escape or duplicate names before discovery. */
/** Reads static server import directories for synchronous editor discovery. */
export function readMeekoConfigSync(projectRoot: string): MeekoConfig {
  const file = ["meeko.config.ts", "meeko.config.mts", "meeko.config.js", "meeko.config.mjs"]
    .map((name) => resolve(projectRoot, name)).find(existsSync);
  if (!file) return {};
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const exported = source.statements.find(ts.isExportAssignment);
  const expression = exported?.expression;
  const config = expression && ts.isCallExpression(expression) ? expression.arguments[0] : expression;
  if (!config || !ts.isObjectLiteralExpression(config)) return {};
  const property = (node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
    const item = node.properties.find((entry) => ts.isPropertyAssignment(entry) &&
      ((ts.isIdentifier(entry.name) && entry.name.text === name) || (ts.isStringLiteral(entry.name) && entry.name.text === name)));
    return item && ts.isPropertyAssignment(item) ? item.initializer : undefined;
  };
  const strings = (node: ts.ObjectLiteralExpression, name: string): readonly string[] | undefined => {
    const value = property(node, name);
    if (!value) return undefined;
    if (!ts.isArrayLiteralExpression(value) || value.elements.some((entry) => !ts.isStringLiteral(entry))) {
      throw new TypeError(`${file}: ${name} must be a static string array for editor discovery`);
    }
    return value.elements.map((entry) => (entry as ts.StringLiteral).text);
  };
  const imports = property(config, "imports");
  const serverDirs = imports && ts.isObjectLiteralExpression(imports) ? strings(imports, "serverDirs") : undefined;
  const extensions = strings(config, "extends");
  const modules = strings(config, "modules");
  return {
    ...(extensions ? { extends: extensions } : {}),
    ...(modules ? { modules } : {}),
    ...(serverDirs ? { imports: { serverDirs } } : {}),
  };
}

export async function resolveConfigSources(projectRoot: string, config?: MeekoConfig): Promise<readonly ConfigSource[]> {
  config ??= await loadMeekoConfig(projectRoot);
  const root = resolve(projectRoot);
  const actualRoot = await realpath(root);
  const result: ConfigSource[] = [{ name: "app", root, kind: "app" }];
  const names = new Set(["app"]);
  const roots = new Set([actualRoot.toLowerCase()]);
  for (const [kind, entries] of [["layer", config.extends], ["module", config.modules]] as const) {
    for (const entry of entries ?? []) {
      const target = resolve(root, entry);
      if (!inside(root, target)) throw new Error(`${kind} ${entry} escapes project root ${root}`);
      let actualTarget: string;
      try { actualTarget = await realpath(target); }
      catch { throw new Error(`${kind} ${entry} does not exist: ${target}`); }
      if (!inside(actualRoot, actualTarget)) throw new Error(`${kind} ${entry} escapes project root ${root}`);
      if (roots.has(actualTarget.toLowerCase())) throw new Error(`Duplicate Meeko source root: ${target}`);
      const name = basename(target, extname(target));
      if (!/^[a-z][a-z0-9-]*$/.test(name) || names.has(name)) throw new Error(`Invalid or duplicate Meeko source name ${name}: ${target}`);
      try { if (!(await stat(resolve(target, "app", "pages"))).isDirectory()) throw new Error("not a directory"); }
      catch { throw new Error(`${kind} ${entry} has no app/pages directory: ${target}`); }
      roots.add(actualTarget.toLowerCase()); names.add(name);
      result.push({ name, root: target, kind });
    }
  }
  return result;
}

export async function discoverConfiguredRoutes(projectRoot: string): Promise<readonly RouteRecord[]> {
  const sources = await resolveConfigSources(projectRoot);
  return composeFrameworkRoutes({
    projectRoot,
    layers: sources.slice(1).map(({ name, root }) => ({ name, root })),
  });
}
