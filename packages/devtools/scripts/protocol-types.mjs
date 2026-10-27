// Genera packages/devtools/types/protocol.d.ts desde packages/meeko/src/devtools-protocol.ts.
// Uso: node packages/devtools/scripts/protocol-types.mjs --write | --check (o pnpm run devtools:types en la raíz)
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const extensionRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const sourcePath = join(extensionRoot, "..", "meeko", "src", "devtools-protocol.ts");
export const outputPath = join(extensionRoot, "types", "protocol.d.ts");

const header = "// Generado desde src/devtools-protocol.ts con `pnpm run devtools:types`. No editar a mano.\n";

/** Normaliza saltos de línea para que la comparación no dependa de la plataforma. */
function normalize(text) {
  return text.replace(/\r\n?/g, "\n");
}

/** Emite las declaraciones del contrato serializable compartido con el runtime. */
export async function generateProtocolTypes() {
  const source = await readFile(sourcePath, "utf8");
  const result = ts.transpileDeclaration(source, { fileName: "devtools-protocol.ts", reportDiagnostics: true, compilerOptions: { strict: true } });
  const diagnostics = result.diagnostics ?? [];
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
  }
  return `${header}${normalize(result.outputText)}`;
}

/** Lee la copia versionada, o `undefined` si todavía no existe. */
export async function readProtocolTypes() {
  try {
    return normalize(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const expected = await generateProtocolTypes();
  if (process.argv.includes("--write")) {
    await writeFile(outputPath, expected);
    console.log(`Escrito ${outputPath}`);
  } else if ((await readProtocolTypes()) !== expected) {
    console.error(`${outputPath} está desactualizado. Ejecuta pnpm run devtools:types.`);
    process.exitCode = 1;
  }
}
