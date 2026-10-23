import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import ts from "@typescript/typescript6";
import { compile } from "./compiler.js";

/** Genera declaraciones TypeScript para un componente y sus imports .meeko relativos. */
export async function generateTypes(source: string, filename: string): Promise<string[]> {
  if (!filename.endsWith(".meeko")) throw new TypeError("Type generation requires a .meeko input file");
  const declarations = new Map<string, string>();
  async function collect(content: string, path: string): Promise<void> {
    if (declarations.has(path)) return;
    const generated = compile(content, path).code;
    const result = ts.transpileDeclaration(generated, {
      fileName: `${path}.ts`,
      compilerOptions: { declaration: true, emitDeclarationOnly: true },
    });
    const error = result.diagnostics?.find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
    declarations.set(path, result.outputText);
    for (const match of generated.matchAll(/\b(?:from\s*|import\s*)["']([^"']+\.meeko)["']/g)) {
      const specifier = match[1]!;
      if (!specifier.startsWith(".")) continue;
      const child = resolve(dirname(path), specifier);
      await collect(await readFile(child, "utf8"), child);
    }
  }
  await collect(source, resolve(filename));
  const outputs: string[] = [];
  for (const [path, declaration] of declarations) {
    const output = path.replace(/\.meeko$/, ".d.meeko.ts");
    await writeFile(output, declaration, "utf8");
    outputs.push(output);
  }
  return outputs;
}
