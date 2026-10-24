import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { discoverServerManifest } from "../framework-server/discovery.js";

interface ImportedSymbol { file: string; exported: string; }
interface SchemaReference { file: string; exported: string; }

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function compilerOptions(root: string): ts.CompilerOptions {
  const config = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!config) return { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const loaded = ts.readConfigFile(config, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  return ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(config)).options;
}

function resolveImport(specifier: string, importer: string, options: ts.CompilerOptions): string {
  const target = ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule?.resolvedFileName;
  if (!target) throw new Error(`${importer}: unresolved import ${specifier}`);
  return target;
}

function validateSharedGraph(file: string, root: string, shared: string, options: ts.CompilerOptions, seen: Set<string>): void {
  if (seen.has(file)) return;
  seen.add(file);
  if (!inside(shared, file)) throw new Error(`${file}: public Socket schema must stay inside shared/`);
  const source = ts.sys.readFile(file);
  if (source === undefined) throw new Error(`${file}: Socket schema file missing`);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const check = (specifier: string): void => {
    const target = resolveImport(specifier, file, options);
    if (inside(root, target) && !relative(root, target).split(sep).includes("node_modules")) validateSharedGraph(target, root, shared, options, seen);
  };
  for (const statement of ast.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) check(statement.moduleSpecifier.text);
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) check(node.argument.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const entry = object.properties.find((candidate) => (ts.isPropertyAssignment(candidate) || ts.isShorthandPropertyAssignment(candidate)) && candidate.name && (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) && candidate.name.text === name);
  if (!entry) return undefined;
  return ts.isPropertyAssignment(entry) ? entry.initializer : ts.isShorthandPropertyAssignment(entry) ? entry.name : undefined;
}

function publicSchemas(file: string, root: string, options: ts.CompilerOptions): { clientToServer: Record<string, SchemaReference>; serverToClient: Record<string, SchemaReference> } {
  const source = ts.sys.readFile(file);
  if (source === undefined) throw new Error(`${file}: Socket channel file missing`);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = new Map<string, ImportedSymbol>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const target = resolveImport(statement.moduleSpecifier.text, file, options);
    if (clause.name) imports.set(clause.name.text, { file: target, exported: "default" });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly) imports.set(element.name.text, { file: target, exported: element.propertyName?.text ?? element.name.text });
      }
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) imports.set(clause.namedBindings.name.text, { file: target, exported: "*" });
  }
  const assignment = ast.statements.find((statement): statement is ts.ExportAssignment => ts.isExportAssignment(statement) && !statement.isExportEquals);
  const call = assignment?.expression;
  if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "defineSocketChannel" || !call.arguments[0] || !ts.isObjectLiteralExpression(call.arguments[0])) {
    throw new Error(`${file}: public Socket contract requires export default defineSocketChannel({...})`);
  }
  const shared = join(root, "shared");
  const seen = new Set<string>();
  const direction = (name: "clientToServer" | "serverToClient"): Record<string, SchemaReference> => {
    const object = property(call.arguments[0] as ts.ObjectLiteralExpression, name);
    if (!object || !ts.isObjectLiteralExpression(object)) throw new Error(`${file}: ${name} must be a static object`);
    const result: Record<string, SchemaReference> = Object.create(null);
    for (const entry of object.properties) {
      if (!ts.isPropertyAssignment(entry) || !(ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name))) throw new Error(`${file}: ${name} requires named schema properties`);
      const event = entry.name.text;
      const value = entry.initializer;
      let local: string;
      let member: string | undefined;
      if (ts.isIdentifier(value)) local = value.text;
      else if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) { local = value.expression.text; member = value.name.text; }
      else throw new Error(`${file}: ${name}.${event} must reference an imported shared schema`);
      const imported = imports.get(local);
      if (!imported || !inside(shared, imported.file)) throw new Error(`${file}: ${name}.${event} must come from shared/`);
      const exported = imported.exported === "*" ? member : imported.exported;
      if (!exported || (member && imported.exported !== "*")) throw new Error(`${file}: ${name}.${event} must reference one shared export`);
      validateSharedGraph(imported.file, root, shared, options, seen);
      if (result[event]) throw new Error(`${file}: duplicate Socket event ${name}.${event}`);
      result[event] = { file: imported.file, exported };
    }
    return result;
  };
  return { clientToServer: direction("clientToServer"), serverToClient: direction("serverToClient") };
}

/** Emits browser-safe, inferred Socket contracts from server channel definitions. */
export async function generateSocketContracts(projectRoot: string): Promise<{ file: string; count: number }> {
  const root = resolve(projectRoot);
  const manifest = await discoverServerManifest(root);
  const output = join(root, ".meeko", "generated", "socket-contracts.ts");
  const options = compilerOptions(root);
  const channels = (manifest.socket ?? []).map((endpoint) => ({ name: endpoint.name, schemas: publicSchemas(endpoint.file, root, options) }));
  const sources = [...new Set(channels.flatMap(({ schemas }) => [...Object.values(schemas.clientToServer), ...Object.values(schemas.serverToClient)].map((entry) => entry.file)))].sort();
  const aliases = new Map(sources.map((file, index) => [file, `__schema${index}`]));
  const lines = sources.map((file) => {
    const target = relative(dirname(output), file).replaceAll("\\", "/").replace(/\.(?:ts|mts|cts)$/, (suffix) => suffix === ".mts" ? ".mjs" : suffix === ".cts" ? ".cjs" : ".js");
    return `import * as ${aliases.get(file)} from ${JSON.stringify(target.startsWith(".") ? target : `./${target}`)};`;
  });
  lines.push("export const socketContracts = {");
  for (const channel of channels) {
    lines.push(`  ${JSON.stringify(channel.name)}: {`);
    for (const direction of ["clientToServer", "serverToClient"] as const) {
      lines.push(`    ${direction}: {`);
      for (const [event, schema] of Object.entries(channel.schemas[direction])) lines.push(`      ${JSON.stringify(event)}: ${aliases.get(schema.file)}[${JSON.stringify(schema.exported)}],`);
      lines.push("    },");
    }
    lines.push("  },");
  }
  lines.push("} as const;", "");
  const code = lines.join("\n");
  let previous: string | undefined;
  try { previous = await readFile(output, "utf8"); } catch { /* First generation. */ }
  if (previous !== code) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, code); }
  return { file: output, count: channels.length };
}
