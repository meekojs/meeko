import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import ts from "@typescript/typescript6";
import { compileWithAutoImports } from "./autoimports.js";
import { moduleSpecifiers, replaceModuleSpecifiers } from "./compiler/import-graph.js";
import { projectRoot } from "./compiler/project-root.js";

/** Genera declaraciones TypeScript para un componente y sus imports .meeko relativos. */
export async function generateTypes(source: string, filename: string): Promise<string[]> {
  if (!filename.endsWith(".meeko")) throw new TypeError("Type generation requires a .meeko input file");
  const root = projectRoot(filename);
  const outputRoot = join(root, ".meeko", "types");
  const declarations = new Map<string, string>();
  async function collect(content: string, path: string): Promise<void> {
    if (declarations.has(path)) return;
    const target = relative(root, path).split(/[\\/]/)[0] === "server" ? "server" : "client";
    const generated = (await compileWithAutoImports(content, path, {}, target)).code;
    const result = ts.transpileDeclaration(generated, {
      fileName: `${path}.ts`,
      compilerOptions: { declaration: true, emitDeclarationOnly: true },
    });
    const error = result.diagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
    declarations.set(path, result.outputText);
    for (const { value: specifier } of moduleSpecifiers(generated, path)) {
      if (!specifier.endsWith(".meeko")) continue;
      if (!specifier.startsWith(".")) continue;
      const child = resolve(dirname(path), specifier);
      await collect(await readFile(child, "utf8"), child);
    }
  }
  await collect(source, resolve(filename));
  const outputs: string[] = [];
  for (const [path, declaration] of declarations) {
    const output = join(outputRoot, relative(root, path)).replace(/\.meeko$/, ".d.meeko.ts");
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
