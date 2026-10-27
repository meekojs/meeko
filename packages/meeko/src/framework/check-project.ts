import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { formatDiagnostic, hasErrors } from "../compiler/sfc.js";
import type { CompileDiagnostic } from "../compiler/sfc.js";
import { checkApp } from "./check-app.js";
import { loadMeekoConfig } from "./config.js";
import type { MeekoConfig } from "./config.js";
import { prepareProject } from "./project.js";
import { assertNoLegacySessionFile } from "./runtime-migration.js";
import { mapRouteBlockPaths, routeBlockTypeFiles } from "./route-block-types.js";
import { prepareFrameworkTypeDeclarations, projectNames } from "./type-declarations.js";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

async function checkTypeScript(configs: readonly string[], routeBlocks: ReadonlyMap<string, string>): Promise<void> {
  const compiler = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  for (const config of configs) {
    try { await execute(process.execPath, [compiler, "-p", config, "--noEmit"], { windowsHide: true }); }
    catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      // Diagnostics in a `<script server>` copy point at the page, on the same line and column.
      throw new Error(mapRouteBlockPaths(`Falló la comprobación con TypeScript (${config}):\n${failure.stdout ?? ""}${failure.stderr ?? ""}`, routeBlocks));
    }
  }
}

/**
 * TypeScript errors of `meeko.config.ts` (or `.mts`) itself, as `file:line:column TSxxxx: message`.
 * No tsconfig of the project includes the configuration, so it is checked on its own.
 */
async function configTypeErrors(root: string): Promise<string[]> {
  const file = ["meeko.config.ts", "meeko.config.mts"].map((name) => join(root, name)).find((candidate) => existsSync(candidate));
  if (!file) return [];
  const compiler = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  let output: string;
  try {
    await execute(process.execPath, [
      compiler, "--noEmit", "--pretty", "false", "--ignoreConfig", "--strict", "--skipLibCheck", "--allowImportingTsExtensions",
      "--module", "esnext", "--moduleResolution", "bundler", "--target", "es2022", "--lib", "es2022,dom", file,
    ], { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
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
 * Generates declarations, checks .meeko sources, then checks app/server/shared TS separately.
 * Throws on errors; returns the warnings of the .meeko sources.
 */
export async function checkFrameworkProject(projectRoot: string): Promise<CompileDiagnostic[]> {
  const root = resolve(projectRoot);
  assertNoLegacySessionFile(root);
  await prepareFrameworkTypes(root);
  const sourceDiagnostics = await checkApp(root);
  // The error lists the warnings too, so none is lost behind the errors.
  if (hasErrors(sourceDiagnostics)) throw new Error(sourceDiagnostics.map(formatDiagnostic).join("\n"));
  const configs = projectNames.map((name) => join(root, ".meeko", `tsconfig.${name}.json`));
  await checkTypeScript(configs, await routeBlockTypeFiles(root));
  return sourceDiagnostics;
}
