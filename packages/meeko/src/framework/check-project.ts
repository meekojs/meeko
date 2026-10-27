import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { formatDiagnostic, hasErrors } from "../compiler/sfc.js";
import type { CompileDiagnostic } from "../compiler/sfc.js";
import { checkApp } from "./check-app.js";
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
