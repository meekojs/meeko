import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkApp } from "./check-app.js";
import { prepareProject } from "./project.js";
import { prepareFrameworkTypeDeclarations, projectNames } from "./type-declarations.js";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

async function checkTypeScript(configs: readonly string[]): Promise<void> {
  const compiler = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  for (const config of configs) {
    try { await execute(process.execPath, [compiler, "-p", config, "--noEmit"]); }
    catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      throw new Error(`TypeScript check failed (${config}):\n${failure.stdout ?? ""}${failure.stderr ?? ""}`);
    }
  }
}

/** Prepares generated entries, declarations and editor projects without checking sources. */
export async function prepareFrameworkTypes(projectRoot: string): Promise<void> {
  const root = resolve(projectRoot);
  await prepareProject(root);
  await prepareFrameworkTypeDeclarations(root);
}

/** Generates declarations, checks .meeko sources, then checks app/server/shared TS separately. */
export async function checkFrameworkProject(projectRoot: string): Promise<void> {
  const root = resolve(projectRoot);
  await prepareFrameworkTypes(root);
  const sourceDiagnostics = await checkApp(root);
  if (sourceDiagnostics.length > 0) {
    throw new Error(sourceDiagnostics.map((diagnostic) => {
      const { line, column } = diagnostic.location;
      return `${diagnostic.filename}:${line}:${column} ${diagnostic.code}: ${diagnostic.message}`;
    }).join("\n"));
  }
  const configs = projectNames.map((name) => join(root, ".meeko", `tsconfig.${name}.json`));
  await checkTypeScript(configs);
}
