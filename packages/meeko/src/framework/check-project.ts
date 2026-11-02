import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { CompileDiagnostic } from "../compiler/parser/sfc";
import type { MeekoConfig } from "./config";

import { typeScriptScope } from "../autoimports/typescript";
import { mapRouteBlockPaths, routeBlockTypeFiles } from "../compiler/codegen/route-block-types";
import { formatDiagnostic, hasErrors } from "../compiler/parser/sfc";
import { tscCommand } from "../typescript-cli";
import { checkApp } from "./check-app";
import { discoverConfiguredRoutes, loadMeekoConfig, resolveConfigSources } from "./config";
import { configTypesPath, moduleTemplatesIndexPath, writeConfigTypesSync } from "./config-types";
import { prepareProject } from "./project";
import { assertNoLegacySessionFile } from "./runtime-migration";
import { prepareFrameworkTypeDeclarations, projectNames } from "./type-declarations";

const execute = promisify(execFile);

/**
 * The output of the server project without the diagnostics of plain `app/` modules. Those modules
 * reach that program only because `server.d.ts` declares their exports with `typeof import(...)`, and
 * there the names only for browser code (`useHead`, `useForm`, `resolveComponent`…) do not exist. They
 * belong to the app project, which has already passed by then: only these lines are skipped here.
 */
function withoutAppModules(output: string, root: string, sourceRoots: readonly string[]): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of output.split(/\r?\n/)) {
    // The indented lines detail the diagnostic above them.
    if (/^\s+\S/.test(line)) {
      if (!skipping) kept.push(line);
      continue;
    }
    if (!line.trim() || /^Found \d+ errors?/.test(line)) continue;
    const file = /^(.+?)\(\d+,\d+\): /.exec(line)?.[1];
    skipping = file !== undefined && typeScriptScope(root, resolve(file), sourceRoots) === "client" && !/\.client\.[cm]?tsx?$/.test(file);
    if (!skipping) kept.push(line);
  }
  return kept.join("\n");
}

async function checkTypeScript(root: string, routeBlocks: ReadonlyMap<string, string>): Promise<void> {
  const sourceRoots = (await resolveConfigSources(root)).map((source) => source.root);
  for (const name of projectNames) {
    const config = join(root, ".meeko", `tsconfig.${name}.json`);
    const tsc = tscCommand(["-p", config, "--noEmit", "--pretty", "false"]);
    try { await execute(tsc.file, tsc.args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); }
    catch (error) {
      const failure = error as Error & { code?: unknown; stdout?: string; stderr?: string };
      let output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
      // A numeric code is tsc reporting diagnostics; anything else (it did not run) always fails.
      if (name === "server" && typeof failure.code === "number") {
        output = withoutAppModules(output, root, sourceRoots);
        if (!output) continue;
      }
      // Diagnostics in a `<script server>` copy point at the page, on the same line and column.
      throw new Error(mapRouteBlockPaths(`Falló la comprobación con TypeScript (${config}):\n${output}`, routeBlocks), { cause: error });
    }
  }
}

/**
 * TypeScript errors of `meeko.config.ts` (or `.mts`) itself, as `file:line:column TSxxxx: message`.
 * The app, server and shared projects do not include the configuration, so it is checked on its
 * own, with `.meeko/types/config.d.ts` when it exists: the modules of `modules` type their keys.
 */
/** Whether @types/node resolves from the project, for `process` in the configuration. */
function nodeTypes(root: string): boolean {
  try { createRequire(join(root, "package.json")).resolve("@types/node/package.json"); return true; }
  catch { return false; }
}

async function configTypeErrors(root: string): Promise<string[]> {
  const file = ["meeko.config.ts", "meeko.config.mts"].map((name) => join(root, name)).find((candidate) => existsSync(candidate));
  if (!file) return [];
  const moduleTypes = join(root, ...configTypesPath.split("/"));
  // The declarations that modules generate (addTypeTemplate) can type their own options too.
  const generatedTypes = join(root, ...moduleTemplatesIndexPath.split("/"));
  const tsc = tscCommand([
    "--noEmit", "--pretty", "false", "--ignoreConfig", "--strict", "--skipLibCheck", "--allowImportingTsExtensions",
    "--module", "esnext", "--moduleResolution", "bundler", "--target", "es2022", "--lib", "es2022,dom",
    // TypeScript 6 no longer loads every @types package: process.env needs @types/node, as in .meeko/tsconfig.*.json.
    ...(nodeTypes(root) ? ["--types", "node"] : []), file,
    ...(existsSync(moduleTypes) ? [moduleTypes] : []),
    ...(existsSync(generatedTypes) ? [generatedTypes] : []),
  ]);
  let output: string;
  try {
    await execute(tsc.file, tsc.args, { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return [];
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
  const same = (path: string): boolean => process.platform === "win32" ? resolve(root, path).toLowerCase() === file.toLowerCase() : resolve(root, path) === file;
  const errors: string[] = [];
  let own = false;
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.*)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
    if (match) {
      own = same(match[1]!);
      if (own) errors.push(`${file}:${match[2]}:${match[3]} ${match[4]}: ${match[5]}`);
    } else if (own && line.trim()) {
      errors[errors.length - 1] += `\n${line}`;
    }
  }
  return errors;
}

/**
 * Carga `meeko.config.*` para `meeko check` y `meeko build`. Si su validación falla, el error
 * empieza por los errores de TypeScript del archivo, con su línea y columna: una función en
 * `document.head.titleTemplate`, por ejemplo, es un error de tipos antes que de ejecución.
 */
export async function loadCheckedMeekoConfig(projectRoot: string): Promise<MeekoConfig> {
  try { return await loadMeekoConfig(projectRoot); }
  catch (error) {
    const typed = await configTypeErrors(resolve(projectRoot)).catch((): string[] => []);
    if (!typed.length) throw error;
    throw new Error(`${typed.join("\n")}\n${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** Prepares generated entries, declarations and editor projects without checking sources. */
export async function prepareFrameworkTypes(projectRoot: string): Promise<void> {
  const root = resolve(projectRoot);
  await prepareProject(root);
  await prepareFrameworkTypeDeclarations(root);
}

/**
 * Generates declarations, checks `meeko.config.ts` with the types of its modules and the .meeko
 * sources, then checks app/server/shared TS separately. Throws on errors; returns the warnings of
 * the .meeko sources.
 */
export async function checkFrameworkProject(projectRoot: string): Promise<CompileDiagnostic[]> {
  const root = resolve(projectRoot);
  assertNoLegacySessionFile(root);
  try { await prepareFrameworkTypes(root); }
  catch (error) {
    // A module that rejects its options in setup: the type error of the option says more. The
    // types of the modules are written first, in case the failure came before them.
    const typed = await loadMeekoConfig(root).then((config) => { writeConfigTypesSync(root, config); return configTypeErrors(root); }).catch((): string[] => []);
    if (!typed.length) throw error;
    throw new Error(`${typed.join("\n")}\n${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  // Since 1.8 the configuration is checked with the types of its modules (their configKey).
  const configErrors = await configTypeErrors(root);
  if (configErrors.length) throw new Error(`Falló la comprobación con TypeScript de la configuración:\n${configErrors.join("\n")}`);
  const sourceDiagnostics = await checkApp(root);
  // The error lists the warnings too, so none is lost behind the errors.
  if (hasErrors(sourceDiagnostics)) throw new Error(sourceDiagnostics.map(formatDiagnostic).join("\n"));
  await checkTypeScript(root, await routeBlockTypeFiles(root, await discoverConfiguredRoutes(root)));
  return sourceDiagnostics;
}
