import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import ts from "@typescript/typescript6";
import { compileWithAutoImports } from "./autoimports.js";
import { moduleSpecifiers, replaceModuleSpecifiers } from "./compiler/import-graph.js";
import { projectRoot } from "./compiler/project-root.js";
import { aliasCandidates } from "./compiler/aliases.js";
import { resolveProjectAliases } from "./framework/aliases.js";

/** Stable ownership marker for generated component declarations. */
export const componentTypeDeclarationMarker = "// @meeko-generated component-declaration v1";

/** Generated declaration of a component, under the project's `.meeko/types`. */
export function componentTypesPath(root: string, filename: string): string {
  return join(root, ".meeko", "types", relative(root, resolve(filename))).replace(/\.meeko$/, ".d.meeko.ts");
}

/** Options of {@link generateTypes}. */
export interface GenerateTypesOptions {
  /** Text of a `.meeko` that is not the saved one, such as a component open in the editor. */
  readonly read?: (filename: string) => string | undefined;
}

/** Genera declaraciones TypeScript para un componente y sus imports .meeko relativos. */
export async function generateTypes(source: string, filename: string, options: GenerateTypesOptions = {}): Promise<string[]> {
  if (!filename.endsWith(".meeko")) throw new TypeError("Type generation requires a .meeko input file");
  const root = projectRoot(filename);
  const aliases = await resolveProjectAliases(root);
  const declarations = new Map<string, string>();
  async function collect(content: string, path: string): Promise<void> {
    if (declarations.has(path)) return;
    const target = relative(root, path).split(/[\\/]/)[0] === "server" ? "server" : "client";
    const generated = (await compileWithAutoImports(content, path, {}, target, undefined, aliases)).code;
    const result = ts.transpileDeclaration(generated, {
      fileName: `${path}.ts`,
      compilerOptions: { declaration: true, emitDeclarationOnly: true },
    });
    // Codes 9005-9039 are isolated-declaration inferences. Only the setup of a component with
    // defineExpose reaches the declaration, through ComponentExposed; there TypeScript still
    // writes the types it infers locally and `any` for the rest, instead of failing.
    const error = result.diagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
      && !(diagnostic.code >= 9005 && diagnostic.code <= 9039 && generated.includes("[__meeko.exposedKey]: __meeko_exposed")));
    if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
    declarations.set(path, `${componentTypeDeclarationMarker}\n${result.outputText}`);
    for (const { value: specifier } of moduleSpecifiers(generated, path)) {
      if (!specifier.endsWith(".meeko")) continue;
      // A component imported through a path alias (`@/widgets/Chart.meeko`): the first file that exists.
      const aliased = specifier.startsWith(".") ? undefined : aliasCandidates(aliases.aliases, specifier);
      if (!specifier.startsWith(".") && !aliased) continue;
      const child = aliased ? aliased.find((candidate) => existsSync(candidate)) : resolve(dirname(path), specifier);
      if (!child) continue;
      await collect(options.read?.(child) ?? await readFile(child, "utf8"), child);
    }
  }
  await collect(source, resolve(filename));
  const outputs: string[] = [];
  for (const [path, declaration] of declarations) {
    const output = componentTypesPath(root, path);
    const rewritten = replaceModuleSpecifiers(declaration, output, ({ value }) => {
      if (!value.startsWith(".") || value.endsWith(".meeko")) return value;
      const original = resolve(dirname(path), value);
      const target = relative(dirname(output), original).replaceAll("\\", "/");
      return target.startsWith(".") ? target : `./${target}`;
    });
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, rewritten, "utf8");
    outputs.push(output);
  }
  return outputs;
}
