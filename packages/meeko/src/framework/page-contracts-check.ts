import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import ts from "@typescript/typescript6";
import { parseSfc } from "../compiler/sfc.js";
import { prepareFrameworkTypeDeclarations } from "./type-declarations.js";

const execute = promisify(execFile);
const typescriptPackage = fileURLToPath(import.meta.resolve("typescript/package.json"));

export interface PageContractDiagnostic {
  readonly filename: string;
  readonly offset: number;
  readonly code: "MEEK_PAGE_PROPS" | "MEEK_LAYOUT_PROPS" | "MEEK_ERROR_PROPS";
  readonly message: string;
}

function contractSourceOffset(source: string, filename: string): number {
  const script = parseSfc(source, filename).script;
  const ast = ts.createSourceFile(filename, script.content, ts.ScriptTarget.Latest, true);
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "defineProps") {
        return script.contentStart + (call.typeArguments?.[0]?.getStart(ast) ?? call.getStart(ast));
      }
    }
  }
  return script.contentStart;
}

function contractAliases(source: string, filename: string): Map<number, { file: string; kind: PageContractDiagnostic["code"]; sidecar?: string }> {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const aliases = new Map<number, { file: string; kind: PageContractDiagnostic["code"]; sidecar?: string }>();
  const literal = (node: ts.TypeNode | undefined): string | undefined =>
    node && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) ? node.literal.text : undefined;
  for (const statement of ast.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || !ts.isTypeReferenceNode(statement.type)) continue;
    const check = statement.type.typeArguments?.[0];
    if (!check || !ts.isTypeReferenceNode(check)) continue;
    const file = literal(check.typeArguments?.[2]);
    if (!file) continue;
    const kind = statement.name.text.startsWith("__layout") ? "MEEK_LAYOUT_PROPS"
      : statement.name.text.startsWith("__error") ? "MEEK_ERROR_PROPS" : "MEEK_PAGE_PROPS";
    const sidecar = kind === "MEEK_PAGE_PROPS" ? literal(check.typeArguments?.[3]) : undefined;
    aliases.set(ast.getLineAndCharacterOfPosition(statement.getStart(ast)).line + 1, {
      file, kind, ...(sidecar === undefined ? {} : { sidecar }),
    });
  }
  return aliases;
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Checks generated route/component contracts after a saved project change. */
export async function checkFrameworkPageContracts(projectRoot: string): Promise<PageContractDiagnostic[]> {
  const root = resolve(projectRoot);
  await prepareFrameworkTypeDeclarations(root);
  const generated = join(root, ".meeko", "generated", "page-contracts.server.ts");
  const aliases = contractAliases(await readFile(generated, "utf8"), generated);
  // The editor's isolated consumer may not install the optional Vite peer or
  // @types/node. The contract itself only needs component declarations.
  const config = join(root, ".meeko", "tsconfig.page-contracts.json");
  const configSource = `${JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler", lib: ["ES2022", "DOM"],
      types: [], strict: true, noEmit: true, skipLibCheck: true, allowArbitraryExtensions: true,
      rootDirs: ["..", "./types"],
    },
    include: ["generated/page-contracts.server.ts", "types/**/*.d.meeko.ts", "types/routes.d.ts"],
  }, null, 2)}\n`;
  try { if (await readFile(config, "utf8") !== configSource) await writeFile(config, configSource); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") await writeFile(config, configSource); else throw error; }
  const compiler = join(dirname(typescriptPackage), "bin", "tsc");
  let output = "";
  // The language server runs this without a console: a visible window would open on Windows.
  try { await execute(process.execPath, [compiler, "-p", config, "--noEmit", "--pretty", "false"], { windowsHide: true }); }
  catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
    if (!output.trim()) throw error;
  }
  const diagnostics: PageContractDiagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^(.*page-contracts\.server\.ts)\((\d+),\d+\): error TS2344: (.*)$/.exec(line);
    if (!match || !samePath(match[1]!, generated)) continue;
    const alias = aliases.get(Number(match[2]));
    if (!alias) continue;
    const filename = resolve(root, alias.file);
    const source = await readFile(filename, "utf8");
    const unsafe = match[3]!.includes("no pueden ser any, never ni unknown");
    // Whole phrases, so each kind keeps its own article and contraction.
    const owner = alias.kind === "MEEK_PAGE_PROPS" ? "Las props de la página" : alias.kind === "MEEK_LAYOUT_PROPS" ? "Las props del layout" : "Las props de la página de error";
    const message = unsafe ? `${owner} ${alias.file} no pueden ser any, never ni unknown`
      : alias.kind === "MEEK_PAGE_PROPS" ? `${owner} ${alias.file} no coinciden con el loader ${alias.sidecar ?? "(sin sidecar)"}`
        : `${owner} ${alias.file} no coinciden con los valores que aporta Meeko`;
    diagnostics.push({ filename, offset: contractSourceOffset(source, filename), code: alias.kind, message });
  }
  return diagnostics;
}
